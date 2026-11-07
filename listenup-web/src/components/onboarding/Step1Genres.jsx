import React from 'react';
import { STARTER_GENRES } from '../../lib/starterCatalog';

export default function Step1Genres({ selectedGenres, onToggleGenre }) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center max-w-xl mx-auto space-y-2">
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400 bg-cyan-400/10 px-3 py-1 rounded-full border border-cyan-400/20">
          Step 1 • Musical Taste
        </span>
        <h2 className="text-2xl sm:text-3xl font-heading font-extrabold text-white tracking-tight">
          What kind of music do you enjoy?
        </h2>
        <p className="text-sm text-slate-400">
          Select all genres that match your vibe. We’ll tailor your daily mixes and category shelves accordingly.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4 max-h-[55vh] overflow-y-auto custom-scrollbar p-1">
        {STARTER_GENRES.map((genre) => {
          const isSelected = selectedGenres.includes(genre.id);
          return (
            <button
              type="button"
              key={genre.id}
              onClick={() => onToggleGenre(genre.id)}
              className={`relative p-4 rounded-2xl text-left border transition-all duration-200 cursor-pointer flex flex-col justify-between group ${
                isSelected
                  ? 'bg-gradient-to-b from-cyan-950/50 to-slate-900 border-cyan-400 shadow-lg shadow-cyan-950/50 scale-[1.02]'
                  : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] hover:border-white/[0.15]'
              }`}
            >
              <div className="flex items-start justify-between w-full mb-3">
                <span className="text-2xl group-hover:scale-110 transition-transform">
                  {genre.icon}
                </span>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                  isSelected 
                    ? 'bg-cyan-400 border-cyan-400 text-black shadow-sm shadow-cyan-400/50' 
                    : 'border-white/20 bg-black/20'
                }`}>
                  {isSelected && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-heading font-bold text-white text-sm">
                  {genre.name}
                </h4>
                <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                  {genre.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {selectedGenres.length === 0 && (
        <p className="text-center text-xs text-amber-400/90 font-medium">
          Please select at least one genre to continue.
        </p>
      )}
    </div>
  );
}
