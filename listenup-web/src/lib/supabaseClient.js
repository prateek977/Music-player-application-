import { createClient } from '@supabase/supabase-js';

// Retrieve publishable configuration from Vite environment variables or defaults
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://jtwkwrtxewuwdwkjpzwx.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_gz0SebFP6vUTc5GnkvnDZg_ZvNKP87X';

// Check if valid Supabase URL is provided
export const isSupabaseConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes('your-project-id') &&
  supabaseUrl.startsWith('https://')
);

/**
 * In-memory / LocalStorage Demo Mock Adapter for development
 * Enables full end-to-end testing of Auth, Onboarding, Preferences, and RLS
 * even before Supabase project credentials are provided.
 */
class LocalAuthStorageAdapter {
  constructor() {
    this.STORAGE_KEY = 'listenup_mock_auth_state';
    this.subscribers = new Set();
    this.state = this._loadState();
  }

  _loadState() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Error loading mock auth state:', e);
    }
    return {
      session: null,
      users: {}, // email -> { user, password, profile, preferences, favorites, playlists }
    };
  }

  _saveState() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
      this.subscribers.forEach(cb => cb(this.state.session ? 'SIGNED_IN' : 'SIGNED_OUT', this.state.session));
    } catch (e) {
      console.warn('Error saving mock auth state:', e);
    }
  }

  onAuthStateChange(callback) {
    this.subscribers.add(callback);
    // Initial call
    setTimeout(() => {
      callback(this.state.session ? 'SIGNED_IN' : 'INITIAL_SESSION', this.state.session);
    }, 10);
    return {
      data: {
        subscription: {
          unsubscribe: () => this.subscribers.delete(callback),
        },
      },
    };
  }

  async getSession() {
    return { data: { session: this.state.session }, error: null };
  }

  async getUser() {
    return { data: { user: this.state.session?.user || null }, error: null };
  }

  async signUp({ email, password, options = {} }) {
    await new Promise(r => setTimeout(r, 200));
    const normalizedEmail = email.trim().toLowerCase();
    
    if (this.state.users[normalizedEmail]) {
      return { data: null, error: { message: 'An account with this email already exists.' } };
    }

    const userId = 'usr_' + Math.random().toString(36).substr(2, 9);
    const displayName = options.data?.full_name || options.data?.name || email.split('@')[0];
    const user = {
      id: userId,
      email: normalizedEmail,
      user_metadata: { full_name: displayName },
      created_at: new Date().toISOString(),
    };

    const session = {
      access_token: 'demo-token-' + userId,
      token_type: 'bearer',
      user,
    };

    this.state.users[normalizedEmail] = {
      user,
      password,
      profile: {
        id: userId,
        display_name: displayName,
        avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${displayName}`,
        onboarding_completed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      preferences: {
        genres: [],
        artists: [],
        languages: [],
        moods: [],
        activities: [],
        explicit_content_preference: true,
      },
      favorites: [],
      playlists: [],
    };

    this.state.session = session;
    this._saveState();
    return { data: { user, session }, error: null };
  }

  async signInWithPassword({ email, password }) {
    await new Promise(r => setTimeout(r, 200));
    const normalizedEmail = email.trim().toLowerCase();
    const account = this.state.users[normalizedEmail];

    if (!account) {
      return { data: null, error: { message: 'Invalid login credentials. User not found.' } };
    }

    if (account.password !== password) {
      return { data: null, error: { message: 'Invalid password. Please check your credentials.' } };
    }

    const session = {
      access_token: 'demo-token-' + account.user.id,
      token_type: 'bearer',
      user: account.user,
    };

    this.state.session = session;
    this._saveState();
    return { data: { user: account.user, session }, error: null };
  }

  async signOut() {
    this.state.session = null;
    this._saveState();
    return { error: null };
  }

  async resetPasswordForEmail(email) {
    await new Promise(r => setTimeout(r, 200));
    const normalizedEmail = email.trim().toLowerCase();
    if (!this.state.users[normalizedEmail]) {
      return { data: null, error: { message: 'No registered user with this email.' } };
    }
    return { data: {}, error: null };
  }

  // Database Query Emulator
  from(tableName) {
    const currentSession = this.state.session;
    const currentUserEmail = currentSession?.user?.email;
    const account = currentUserEmail ? this.state.users[currentUserEmail] : null;

    return {
      select: (columns = '*') => ({
        eq: (field, value) => ({
          single: async () => {
            if (tableName === 'profiles') {
              if (account && (field === 'id' ? account.user.id === value : true)) {
                return { data: account.profile, error: null };
              }
              return { data: null, error: { message: 'Profile not found' } };
            }
            if (tableName === 'user_listening_preferences') {
              if (account) {
                return { data: account.preferences, error: null };
              }
              return { data: null, error: null };
            }
            return { data: null, error: null };
          },
          maybeSingle: async () => {
            if (tableName === 'profiles' && account) {
              return { data: account.profile, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      upsert: async (record) => {
        if (tableName === 'profiles' && account) {
          account.profile = { ...account.profile, ...record, updated_at: new Date().toISOString() };
          this._saveState();
          return { data: account.profile, error: null };
        }
        if (tableName === 'user_listening_preferences' && account) {
          account.preferences = { ...account.preferences, ...record, updated_at: new Date().toISOString() };
          this._saveState();
          return { data: account.preferences, error: null };
        }
        return { data: record, error: null };
      },
      insert: async (records) => {
        if (tableName === 'user_genres' && account) {
          account.preferences.genres = Array.isArray(records) ? records.map(r => r.genre_id) : [records.genre_id];
          this._saveState();
        }
        if (tableName === 'user_favorite_artists' && account) {
          account.preferences.artists = Array.isArray(records) ? records.map(r => r.artist_id) : [records.artist_id];
          this._saveState();
        }
        if (tableName === 'user_languages' && account) {
          account.preferences.languages = Array.isArray(records) ? records.map(r => r.language_id) : [records.language_id];
          this._saveState();
        }
        return { data: records, error: null };
      },
      delete: () => ({
        eq: (field, value) => ({
          then: async (resolve) => {
            if (tableName.startsWith('user_') && account) {
              // clear previous list before re-inserting
            }
            resolve({ data: null, error: null });
          }
        })
      })
    };
  }
}

// Create real or fallback client
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : new (class MockSupabaseClient {
      constructor() {
        this.adapter = new LocalAuthStorageAdapter();
        this.auth = this.adapter;
      }
      from(table) {
        return this.adapter.from(table);
      }
    })();
