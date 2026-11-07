import React from 'react';
import { STARTER_GENRES } from '../../lib/starterCatalog';

export default function Step5Review({
  selectedGenres,
  selectedArtists,
  selectedLanguages,
  customLanguage,
  selectedMoods,
  selectedActivities,
  explicitPreference,
  onGoToStep,
  onSave,
  saving,
  error
}) {
  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400 bg-cyan-400/10 px-3 py-1 rounded-full border border-cyan-400/20">
          Step 5 • Review & Complete
        </span>
        <h2 className="text-2xl sm:text-3xl font-heading font-extrabold text-white tracking-tight">
          Your Personalized Music Profile
        </h2>
        <p className="text-sm text-slate-400">
          Double-check your choices. You can tap edit on any section or change them later in Profile & Settings.
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-4 max-h-[50vh] overflow-y-auto custom-scrollbar p-1">
        {/* Section 1: Genres */}
        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white uppercase tracking-wider">
                Music Genres
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-400/10 text-cyan-300 border border-cyan-400/20">
                {selectedGenres.length} selected
              </span>
            </div>
            <button
              type="button"
              onClick={() => onGoToStep(1)}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer"
            >
              Edit
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedGenres.map(gid => {
              const item = STARTER_GENRES.find(g => g.id === gid);
              return (
                <span key={gid} className="px-2.5 py-1 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 flex items-center gap-1.5">
                  <span>{item?.icon || '🎵'}</span>
                  <span>{item?.name || gid}</span>
                </span>
              );
            })}
          </div>
        </div>

        {/* Section 2: Favourite Artists */}
        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white uppercase tracking-wider">
                Favourite Artists
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-400/10 text-cyan-300 border border-cyan-400/20">
                {selectedArtists.length} selected (min 3)
              </span>
            </div>
            <button
              type="button"
              onClick={() => onGoToStep(2)}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer"
            >
              Edit
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedArtists.map(artist => {
              const name = typeof artist === 'string' ? artist : artist.name;
              const img = typeof artist === 'object' ? artist.imageUrl : null;
              return (
                <span key={name} className="pl-1 pr-3 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200 flex items-center gap-2">
                  {img ? (
                    <img src={img} alt={name} className="w-5 h-5 rounded-full object-cover" />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center text-[10px]">★</span>
                  )}
                  <span>{name}</span>
                </span>
              );
            })}
          </div>
        </div>

        {/* Section 3: Languages */}
        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white uppercase tracking-wider">
                Preferred Languages
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-400/10 text-cyan-300 border border-cyan-400/20">
                {selectedLanguages.length} selected
              </span>
            </div>
            <button
              type="button"
              onClick={() => onGoToStep(3)}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer"
            >
              Edit
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedLanguages.map(lang => (
              <span key={lang} className="px-2.5 py-1 rounded-lg bg-white/[0.05] border border-white/[0.08] text-xs text-slate-200">
                {lang === 'Other' && customLanguage ? `${customLanguage} (Other)` : lang}
              </span>
            ))}
          </div>
        </div>

        {/* Section 4: Listening Preferences */}
        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white uppercase tracking-wider">
              Listening Moods & Activities
            </span>
            <button
              type="button"
              onClick={() => onGoToStep(4)}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer"
            >
              Edit
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedMoods.length > 0 ? (
              selectedMoods.map(m => (
                <span key={m} className="px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs">
                  Mood: {m}
                </span>
              ))
            ) : (
              <span className="text-xs text-slate-500 italic">No specific moods selected</span>
            )}
            {selectedActivities.map(a => (
              <span key={a} className="px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs">
                Activity: {a}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Explicit Content: <strong className="text-white">{explicitPreference ? 'Enabled' : 'Restricted'}</strong>
          </p>
        </div>
      </div>

      {/* Confirmation Button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-black font-extrabold text-sm tracking-wide shadow-xl shadow-cyan-500/25 transition-all transform active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
        >
          {saving ? (
            <>
              <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              <span>Saving Preferences & Launching ListenUp...</span>
            </>
          ) : (
            <>
              <span>Launch ListenUp With My Vibe</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
