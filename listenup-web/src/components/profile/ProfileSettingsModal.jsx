import React, { useState, useEffect } from 'react';
import { useAuth } from '../../lib/authContext';
import { STARTER_GENRES, STARTER_ARTISTS, STARTER_LANGUAGES, LISTENING_MOODS, LISTENING_ACTIVITIES } from '../../lib/starterCatalog';

export default function ProfileSettingsModal({ isOpen, onClose }) {
  const { user, profile, preferences, updateProfile, saveOnboardingData, restartOnboarding, signOut } = useAuth();

  const [activeTab, setActiveTab] = useState('profile'); // 'profile' | 'preferences'
  const [displayName, setDisplayName] = useState('');
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [selectedArtists, setSelectedArtists] = useState([]);
  const [selectedLanguages, setSelectedLanguages] = useState([]);
  const [selectedMoods, setSelectedMoods] = useState([]);
  const [selectedActivities, setSelectedActivities] = useState([]);
  const [explicitPreference, setExplicitPreference] = useState(true);
  const [artistSearch, setArtistSearch] = useState('');
  
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Sync state when modal opens or profile/preferences change
  useEffect(() => {
    if (isOpen) {
      setDisplayName(profile?.display_name || user?.user_metadata?.full_name || '');
      setSelectedGenres(preferences?.genres || []);
      setSelectedArtists(preferences?.artists || []);
      setSelectedLanguages(preferences?.languages || []);
      setSelectedMoods(preferences?.moods || []);
      setSelectedActivities(preferences?.activities || []);
      setExplicitPreference(preferences?.explicit_content_preference ?? true);
      setErrorMsg('');
      setSaveSuccess(false);
    }
  }, [isOpen, profile, preferences, user]);

  if (!isOpen) return null;

  const handleToggleGenre = (gid) => {
    setSelectedGenres(prev => 
      prev.includes(gid) ? prev.filter(g => g !== gid) : [...prev, gid]
    );
  };

  const handleToggleArtist = (artist) => {
    const artistName = typeof artist === 'string' ? artist : artist.name;
    setSelectedArtists(prev => {
      const exists = prev.some(a => (typeof a === 'string' ? a : a.name) === artistName);
      if (exists) {
        if (prev.length <= 3) {
          setErrorMsg('You must keep at least 3 favourite artists.');
          return prev;
        }
        return prev.filter(a => (typeof a === 'string' ? a : a.name) !== artistName);
      }
      setErrorMsg('');
      return [...prev, artist];
    });
  };

  const handleToggleLanguage = (lid) => {
    setSelectedLanguages(prev => 
      prev.includes(lid) ? prev.filter(l => l !== lid) : [...prev, lid]
    );
  };

  const handleToggleMood = (mid) => {
    setSelectedMoods(prev => 
      prev.includes(mid) ? prev.filter(m => m !== mid) : [...prev, mid]
    );
  };

  const handleToggleActivity = (aid) => {
    setSelectedActivities(prev => 
      prev.includes(aid) ? prev.filter(a => a !== aid) : [...prev, aid]
    );
  };

  const handleSaveAll = async () => {
    setErrorMsg('');
    setSaveSuccess(false);

    if (selectedGenres.length === 0) {
      setErrorMsg('Please select at least 1 music genre.');
      return;
    }

    if (selectedArtists.length < 3) {
      setErrorMsg('Please select at least 3 favourite artists.');
      return;
    }

    if (selectedLanguages.length === 0) {
      setErrorMsg('Please select at least 1 language.');
      return;
    }

    setSaving(true);
    try {
      // 1. Update Display Name in profile
      if (displayName.trim()) {
        await updateProfile({ display_name: displayName.trim() });
      }

      // 2. Update preferences
      const res = await saveOnboardingData({
        genres: selectedGenres,
        artists: selectedArtists,
        languages: selectedLanguages,
        moods: selectedMoods,
        activities: selectedActivities,
        explicitContent: explicitPreference
      });

      if (res.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setErrorMsg(res.error || 'Failed to update preferences.');
      }
    } catch (e) {
      setErrorMsg(e.message || 'Error saving settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleRestartOnboardingFlow = async () => {
    if (window.confirm('Restart musical taste onboarding? You can re-select your genres, artists, and languages from scratch.')) {
      await restartOnboarding();
      onClose();
    }
  };

  const handleLogout = async () => {
    await signOut();
    onClose();
  };

  const filteredArtists = STARTER_ARTISTS.filter(a => 
    !artistSearch.trim() || 
    a.name.toLowerCase().includes(artistSearch.toLowerCase()) || 
    a.genre.toLowerCase().includes(artistSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div 
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl bg-[#101017] border border-white/[0.08] shadow-2xl text-white overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 rounded-full overflow-hidden border-2 border-[#D5F36A]/50 shadow-md">
              <img 
                src={profile?.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${user?.id || 'listener'}`} 
                alt="Avatar" 
                className="w-full h-full object-cover" 
              />
            </div>
            <div>
              <h3 className="font-heading font-bold text-lg text-white">
                {profile?.display_name || user?.email?.split('@')[0] || 'My Profile'}
              </h3>
              <p className="text-xs text-[#9999A6]">
                {user?.email}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full text-[#9999A6] hover:text-white bg-white/[0.04] hover:bg-white/[0.1] transition-all cursor-pointer"
            aria-label="Close dialog"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-white/[0.08] px-6 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`pb-3 px-3 text-xs font-bold transition-all relative cursor-pointer ${
              activeTab === 'profile' ? 'text-[#D5F36A]' : 'text-[#9999A6] hover:text-white'
            }`}
          >
            Profile & Account
            {activeTab === 'profile' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D5F36A] rounded-full" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('preferences')}
            className={`pb-3 px-3 text-xs font-bold transition-all relative cursor-pointer ${
              activeTab === 'preferences' ? 'text-[#D5F36A]' : 'text-[#9999A6] hover:text-white'
            }`}
          >
            Music Preferences & Artists ({selectedArtists.length})
            {activeTab === 'preferences' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D5F36A] rounded-full" />
            )}
          </button>
        </div>

        {/* Alerts */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {saveSuccess && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <span>✓</span>
            <span>Settings and musical taste updated successfully!</span>
          </div>
        )}

        {/* Body content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          {activeTab === 'profile' && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your listener name"
                  className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] focus:border-cyan-400 text-white text-sm focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Account Email
                </label>
                <input
                  type="text"
                  disabled
                  value={user?.email || ''}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] text-slate-400 text-sm cursor-not-allowed"
                />
              </div>

              <div className="pt-4 border-t border-white/[0.08] space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Onboarding & Actions
                </h4>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleRestartOnboardingFlow}
                    className="px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-semibold text-slate-200 transition-all cursor-pointer"
                  >
                    ↻ Retake Taste Onboarding
                  </button>

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-xs font-semibold text-rose-300 transition-all cursor-pointer"
                  >
                    Log Out of Account
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'preferences' && (
            <div className="space-y-6">
              {/* Genres */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Favourite Genres ({selectedGenres.length})
                  </label>
                  <span className="text-[11px] text-slate-400">At least 1 required</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {STARTER_GENRES.map(g => {
                    const isSelected = selectedGenres.includes(g.id);
                    return (
                      <button
                        type="button"
                        key={g.id}
                        onClick={() => handleToggleGenre(g.id)}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-[#D5F36A]/20 border-[#D5F36A] text-[#D5F36A]'
                            : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-slate-400'
                        }`}
                      >
                        <span>{g.icon}</span>
                        <span>{g.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Artists */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Favourite Artists ({selectedArtists.length})
                  </label>
                  <span className="text-[11px] text-[#D5F36A] font-mono font-bold">
                    Minimum 3 enforced
                  </span>
                </div>

                <input
                  type="text"
                  placeholder="Filter or search artists..."
                  value={artistSearch}
                  onChange={(e) => setArtistSearch(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] focus:border-[#D5F36A] text-xs text-white focus:outline-none"
                />

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-48 overflow-y-auto custom-scrollbar p-1">
                  {filteredArtists.map(artist => {
                    const isSelected = selectedArtists.some(a => (typeof a === 'string' ? a : a.name) === artist.name);
                    return (
                      <div
                        key={artist.id}
                        onClick={() => handleToggleArtist(artist)}
                        className={`p-2 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-[#D5F36A]/15 border-[#D5F36A] text-white'
                            : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-slate-300'
                        }`}
                      >
                        <img src={artist.imageUrl} alt={artist.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                        <div className="truncate flex-1">
                          <p className="text-xs font-bold truncate">{artist.name}</p>
                          <p className="text-[10px] text-slate-400 truncate">{artist.genre}</p>
                        </div>
                        {isSelected && <span className="text-[#D5F36A] text-xs">✓</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Languages */}
              <div className="space-y-2.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Preferred Languages ({selectedLanguages.length})
                </label>
                <div className="flex flex-wrap gap-2">
                  {STARTER_LANGUAGES.map(lang => {
                    const isSelected = selectedLanguages.includes(lang.id);
                    return (
                      <button
                        type="button"
                        key={lang.id}
                        onClick={() => handleToggleLanguage(lang.id)}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#D5F36A]/20 border-[#D5F36A] text-[#D5F36A]'
                            : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-slate-400'
                        }`}
                      >
                        {lang.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Moods & Activities */}
              <div className="space-y-2.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Listening Moods
                </label>
                <div className="flex flex-wrap gap-2">
                  {LISTENING_MOODS.map(m => {
                    const isSelected = selectedMoods.includes(m.id);
                    return (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => handleToggleMood(m.id)}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-[#D5F36A]/20 border-[#D5F36A] text-[#D5F36A]'
                            : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-slate-400'
                        }`}
                      >
                        <span>{m.icon}</span>
                        <span>{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/[0.08] flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSaveAll}
            disabled={saving}
            className="px-6 py-2.5 rounded-xl bg-[#D5F36A] hover:bg-[#BDE84A] text-black font-extrabold text-xs tracking-wide shadow-lg shadow-[#D5F36A]/20 transition-all transform active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                <span>Saving Changes...</span>
              </>
            ) : (
              <span>Save Changes</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
