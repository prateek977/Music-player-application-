import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from './supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [preferences, setPreferences] = useState({
    genres: [],
    artists: [],
    languages: [],
    moods: [],
    activities: [],
    explicit_content_preference: true
  });
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const userRef = useRef(null);
  userRef.current = user;
  const fetchingUserIdRef = useRef(null);

  // Fetch full user profile & preferences from Supabase (or fallback adapter)
  const fetchUserData = useCallback(async (userId, fallbackMeta) => {
    if (!userId) return;
    if (fetchingUserIdRef.current === userId) return; // Prevent duplicate concurrent fetch
    fetchingUserIdRef.current = userId;

    try {
      // Check local cache first for instant reliable state
      const localCachedProfileStr = localStorage.getItem(`listenup_profile_${userId}`);
      let cachedProf = null;
      if (localCachedProfileStr) {
        try { cachedProf = JSON.parse(localCachedProfileStr); } catch (e) {}
      }
      const hasCompletedLocally = localStorage.getItem(`listenup_onboarding_completed_${userId}`) === 'true';
      const needsOnboarding = localStorage.getItem(`listenup_needs_onboarding_${userId}`) === 'true' || 
                              sessionStorage.getItem('listenup_just_signed_up') === 'true';

      // 1. Fetch Profile
      let profileData = null;
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        if (!error && data) {
          profileData = data;
        }
      } catch (e) {
        console.warn('Supabase profile query warning:', e);
      }

      if (profileData) {
        // If local record is already completed, or DB is completed, or it's an existing account (not freshly signed up)
        const isCompleted = profileData.onboarding_completed === true || 
                            hasCompletedLocally || 
                            cachedProf?.onboarding_completed === true ||
                            !needsOnboarding;

        const resolvedProf = { ...profileData, onboarding_completed: isCompleted };
        setProfile(resolvedProf);
        localStorage.setItem(`listenup_profile_${userId}`, JSON.stringify(resolvedProf));
      } else {
        // Fallback default profile if trigger hasn't finished yet or DB is offline
        const meta = fallbackMeta || userRef.current?.user_metadata || {};
        // CRITICAL FIX: Only set onboarding_completed = false if they EXPLICITLY just created an account!
        // On normal refresh or existing users, onboarding_completed MUST be true so onboarding doesn't pop up!
        const isCompleted = hasCompletedLocally || 
                            (cachedProf?.onboarding_completed === true) || 
                            (!needsOnboarding && !sessionStorage.getItem('listenup_just_signed_up'));

        const defaultProf = {
          id: userId,
          display_name: meta.full_name || meta.name || userRef.current?.email?.split('@')[0] || 'Listener',
          avatar_url: meta.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${userId}`,
          onboarding_completed: isCompleted
        };
        setProfile(defaultProf);
        localStorage.setItem(`listenup_profile_${userId}`, JSON.stringify(defaultProf));
      }

      // 2. Fetch User Preferences
      if (isSupabaseConfigured) {
        try {
          const [genresRes, artistsRes, langsRes, prefsRes] = await Promise.all([
            supabase.from('user_genres').select('genre_id, genres(name, slug)').eq('user_id', userId),
            supabase.from('user_favorite_artists').select('artist_id, artists(name, image_url)').eq('user_id', userId),
            supabase.from('user_languages').select('language_id, custom_language, languages(name, code)').eq('user_id', userId),
            supabase.from('user_listening_preferences').select('*').eq('user_id', userId).maybeSingle()
          ]);

          const loadedGenres = (genresRes.data || []).map(g => g.genres?.slug || g.genres?.name || g.genre_id);
          const loadedArtists = (artistsRes.data || []).map(a => a.artists?.name || a.artist_id);
          const loadedLangs = (langsRes.data || []).map(l => l.custom_language || l.languages?.name || l.language_id);
          const listeningPrefs = prefsRes.data || {};

          setPreferences({
            genres: loadedGenres,
            artists: loadedArtists,
            languages: loadedLangs,
            moods: listeningPrefs.preferred_moods || [],
            activities: listeningPrefs.listening_activities || [],
            explicit_content_preference: listeningPrefs.explicit_content_preference ?? true
          });
        } catch (dbErr) {
          console.warn('Failed to load nested relational preferences from Supabase:', dbErr);
        }
      } else {
        // From LocalStorage Adapter
        const savedPrefs = localStorage.getItem(`listenup_user_prefs_${userId}`);
        if (savedPrefs) {
          try {
            setPreferences(JSON.parse(savedPrefs));
          } catch (e) {
            console.error('Error parsing local user preferences:', e);
          }
        }
      }
    } catch (err) {
      console.error('Error in fetchUserData:', err);
    } finally {
      fetchingUserIdRef.current = null;
    }
  }, []);

  // Auth state listener & session restoration - strictly initialized once
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        if (mounted) {
          setSession(initialSession);
          const currentUser = initialSession?.user || null;
          setUser(currentUser);
          if (currentUser) {
            await fetchUserData(currentUser.id, currentUser.user_metadata);
          }
        }
      } catch (err) {
        console.error('Error restoring session:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      const currentUser = newSession?.user || null;
      setUser(currentUser);
      if (currentUser) {
        await fetchUserData(currentUser.id, currentUser.user_metadata);
      } else {
        setProfile(null);
        setPreferences({
          genres: [],
          artists: [],
          languages: [],
          moods: [],
          activities: [],
          explicit_content_preference: true
        });
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe?.();
    };
  }, [fetchUserData]);

  // Sign In
  const signIn = async ({ email, password }) => {
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });
      if (error) throw error;
      return { success: true, data };
    } catch (err) {
      setAuthError(err.message || 'Login failed');
      return { success: false, error: err.message };
    }
  };

  // Sign Up (First time account creation)
  const signUp = async ({ email, password, displayName }) => {
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: displayName || email.split('@')[0],
            avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${displayName || email}`
          }
        }
      });
      if (error) throw error;
      if (data?.user) {
        // Explicitly flag that this user just created an account and needs onboarding
        sessionStorage.setItem('listenup_just_signed_up', 'true');
        localStorage.setItem(`listenup_needs_onboarding_${data.user.id}`, 'true');
        localStorage.removeItem(`listenup_onboarding_completed_${data.user.id}`);
      }
      return { success: true, data };
    } catch (err) {
      setAuthError(err.message || 'Sign up failed');
      return { success: false, error: err.message };
    }
  };

  // Sign Out
  const signOut = async () => {
    setAuthError(null);
    try {
      await supabase.auth.signOut();
      setSession(null);
      setUser(null);
      setProfile(null);
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  // Password Reset
  const resetPassword = async (email) => {
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`
      });
      if (error) throw error;
      return { success: true, data };
    } catch (err) {
      setAuthError(err.message || 'Password reset request failed');
      return { success: false, error: err.message };
    }
  };

  // Update Profile
  const updateProfile = async (updates) => {
    if (!user) return { success: false, error: 'Not authenticated' };
    try {
      const updated = {
        ...profile,
        ...updates,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('profiles')
        .upsert(updated);

      if (error) {
        console.warn('Supabase profile update warning:', error.message);
      }
      setProfile(updated);
      return { success: true, data: updated };
    } catch (err) {
      console.error('Error updating profile:', err);
      // Still update local profile state so UI is responsive
      if (updates) {
        setProfile(prev => ({ ...(prev || {}), ...updates }));
        return { success: true, data: { ...profile, ...updates } };
      }
      return { success: false, error: err.message };
    }
  };

  // Save Onboarding Data & Mark Onboarding Completed
  const saveOnboardingData = async ({
    genres = [],
    artists = [],
    languages = [],
    moods = [],
    activities = [],
    explicitContent = true
  }) => {
    if (!user) {
      // Guest completion support
      localStorage.setItem('listenup_onboarding_completed_guest', 'true');
      localStorage.removeItem('listenup_onboarding_draft');
      return { success: true };
    }

    try {
      // 1. Immediately persist completion to localStorage so ANY refresh keeps it permanently
      localStorage.setItem(`listenup_onboarding_completed_${user.id}`, 'true');
      localStorage.removeItem(`listenup_needs_onboarding_${user.id}`);
      sessionStorage.removeItem('listenup_just_signed_up');
      localStorage.removeItem('listenup_onboarding_draft');

      // 2. Update Profile to completed
      const profileUpdates = {
        id: user.id,
        onboarding_completed: true,
        updated_at: new Date().toISOString()
      };
      
      const newProfile = { ...(profile || {}), ...profileUpdates };
      setProfile(newProfile);
      localStorage.setItem(`listenup_profile_${user.id}`, JSON.stringify(newProfile));

      try {
        await supabase.from('profiles').upsert(profileUpdates);
      } catch (profErr) {
        console.warn('Profiles table upsert warning:', profErr);
      }

      // 2. Persist listening preferences
      const listeningPayload = {
        user_id: user.id,
        preferred_moods: moods,
        listening_activities: activities,
        explicit_content_preference: explicitContent,
        updated_at: new Date().toISOString()
      };
      try {
        await supabase.from('user_listening_preferences').upsert(listeningPayload);
      } catch (prefsErr) {
        console.warn('Preferences table upsert warning:', prefsErr);
      }

      // 3. Persist local user preferences cache
      const newPrefs = {
        genres,
        artists,
        languages,
        moods,
        activities,
        explicit_content_preference: explicitContent
      };
      setPreferences(newPrefs);
      localStorage.setItem(`listenup_user_prefs_${user.id}`, JSON.stringify(newPrefs));

      // 4. If Supabase is connected, sync join tables
      if (isSupabaseConfigured) {
        try {
          // Clear and sync user_genres
          await supabase.from('user_genres').delete().eq('user_id', user.id);
          if (genres.length > 0) {
            // Find matching genre IDs or insert
            const { data: dbGenres } = await supabase.from('genres').select('id, slug, name');
            const genreInserts = genres.map(g => {
              const match = (dbGenres || []).find(dg => dg.slug === g || dg.name.toLowerCase() === g.toLowerCase());
              return match ? { user_id: user.id, genre_id: match.id } : null;
            }).filter(Boolean);
            if (genreInserts.length > 0) {
              await supabase.from('user_genres').insert(genreInserts);
            }
          }

          // Clear and sync user_favorite_artists
          await supabase.from('user_favorite_artists').delete().eq('user_id', user.id);
          if (artists.length > 0) {
            const { data: dbArtists } = await supabase.from('artists').select('id, name');
            const artistInserts = [];
            for (const art of artists) {
              const artName = typeof art === 'string' ? art : art.name;
              let match = (dbArtists || []).find(da => da.name.toLowerCase() === artName.toLowerCase());
              if (!match) {
                // Insert new artist into catalog
                const { data: newArt } = await supabase.from('artists').insert({
                  name: artName,
                  image_url: typeof art === 'object' ? art.imageUrl : null
                }).select().single();
                match = newArt;
              }
              if (match) {
                artistInserts.push({ user_id: user.id, artist_id: match.id });
              }
            }
            if (artistInserts.length > 0) {
              await supabase.from('user_favorite_artists').insert(artistInserts);
            }
          }

          // Clear and sync user_languages
          await supabase.from('user_languages').delete().eq('user_id', user.id);
          if (languages.length > 0) {
            const { data: dbLangs } = await supabase.from('languages').select('id, name');
            const langInserts = languages.map(lang => {
              const match = (dbLangs || []).find(dl => dl.name.toLowerCase() === lang.toLowerCase());
              return match 
                ? { user_id: user.id, language_id: match.id } 
                : { user_id: user.id, language_id: dbLangs?.[0]?.id, custom_language: lang };
            }).filter(Boolean);
            if (langInserts.length > 0) {
              await supabase.from('user_languages').insert(langInserts);
            }
          }
        } catch (syncErr) {
          console.warn('Error syncing relational tables in Supabase:', syncErr);
        }
      }

      return { success: true };
    } catch (err) {
      console.error('Error saving onboarding data:', err);
      return { success: false, error: err.message };
    }
  };

  // Restart onboarding
  const restartOnboarding = async () => {
    if (!user) return;
    try {
      localStorage.setItem(`listenup_needs_onboarding_${user.id}`, 'true');
      localStorage.removeItem(`listenup_onboarding_completed_${user.id}`);
      await updateProfile({ onboarding_completed: false });
    } catch (e) {
      console.error('Error restarting onboarding:', e);
    }
  };

  // Skip onboarding and immediately launch app
  const skipOnboarding = async () => {
    const targetId = user?.id || 'guest';
    localStorage.setItem(`listenup_onboarding_completed_${targetId}`, 'true');
    localStorage.removeItem(`listenup_needs_onboarding_${targetId}`);
    localStorage.removeItem('listenup_onboarding_draft');
    sessionStorage.removeItem('listenup_just_signed_up');

    if (user) {
      const updated = { ...(profile || {}), onboarding_completed: true };
      setProfile(updated);
      localStorage.setItem(`listenup_profile_${user.id}`, JSON.stringify(updated));
      try {
        await supabase.from('profiles').upsert({ id: user.id, onboarding_completed: true });
      } catch (e) {
        console.warn('Skip onboarding upsert warning:', e);
      }
    } else {
      setProfile(prev => ({ ...(prev || {}), onboarding_completed: true }));
    }
    return { success: true };
  };

  // Migrate guest favorites and playlists into user's account
  const migrateGuestData = async (guestFavorites = [], guestPlaylists = []) => {
    if (!user) return { success: false };
    try {
      if (isSupabaseConfigured) {
        // Sync favorites
        if (guestFavorites.length > 0) {
          const favRows = guestFavorites.map(song => ({
            user_id: user.id,
            song_id: song.id,
            song_data: song
          }));
          await supabase.from('user_favorites').upsert(favRows, { onConflict: 'user_id, song_id' });
        }
        // Sync playlists
        if (guestPlaylists.length > 0) {
          const playlistRows = guestPlaylists.map(pl => ({
            user_id: user.id,
            name: pl.name,
            songs: pl.songs || []
          }));
          await supabase.from('user_playlists').insert(playlistRows);
        }
      }
      return { success: true };
    } catch (e) {
      console.warn('Error migrating guest data to cloud:', e);
      return { success: false, error: e.message };
    }
  };

  const value = {
    session,
    user,
    profile,
    preferences,
    loading,
    authError,
    isSupabaseConfigured,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updateProfile,
    saveOnboardingData,
    restartOnboarding,
    skipOnboarding,
    migrateGuestData,
    refreshUserData: () => user && fetchUserData(user.id)
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
