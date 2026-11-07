import React, { useState, useMemo } from 'react';
import { STARTER_ARTISTS } from '../../lib/starterCatalog';

export default function Step2Artists({ selectedArtists, onToggleArtist, onAddCustomArtist }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [customInput, setCustomInput] = useState('');

  // Filter artists based on search
  const filteredArtists = useMemo(() => {
    if (!searchQuery.trim()) return STARTER_ARTISTS;
    const q = searchQuery.toLowerCase();
    return STARTER_ARTISTS.filter(a => 
      a.name.toLowerCase().includes(q) || 
      a.genre.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleAddCustom = (e) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    const name = customInput.trim();
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    onAddCustomArtist({
      id,
      name,
      genre: 'Custom Favorite',
      imageUrl: `https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80`
    });
    setCustomInput('');
  };

  const count = selectedArtists.length;
  const isRequirementMet = count >= 3;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center max-w-xl mx-auto space-y-2">
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400 bg-cyan-400/10 px-3 py-1 rounded-full border border-cyan-400/20">
          Step 2 • Favourite Artists
        </span>
        <h2 className="text-2xl sm:text-3xl font-heading font-extrabold text-white tracking-tight">
          Which artists do you love listening to?
        </h2>
        <p className="text-sm text-slate-400">
          Pick your top musical icons. We’ll curate personalized artist stations and track highlights for you.
        </p>

        {/* Counter Badge */}
        <div className="inline-flex items-center gap-2 mt-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08]">
          <span className={`w-2 h-2 rounded-full ${isRequirementMet ? 'bg-cyan-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className="text-xs font-mono font-medium text-slate-300">
            <strong className={isRequirementMet ? 'text-cyan-400 font-bold' : 'text-amber-400 font-bold'}>
              {count}
            </strong> of 3 minimum selected
          </span>
        </div>
      </div>

      {/* Search & Custom Add Bar */}
      <div className="flex flex-col sm:flex-row gap-2.5 max-w-xl mx-auto">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search artists by name or style..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2.5 pl-10 rounded-xl bg-white/[0.04] border border-white/[0.08] focus:border-cyan-400 focus:outline-none text-white text-sm placeholder:text-slate-500 transition-all"
          />
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        {searchQuery && filteredArtists.length === 0 && (
          <form onSubmit={handleAddCustom} className="flex gap-2">
            <input
              type="text"
              placeholder={`Add "${searchQuery}"`}
              value={customInput || searchQuery}
              onChange={(e) => setCustomInput(e.target.value)}
              className="px-3 py-2.5 rounded-xl bg-white/[0.04] border border-cyan-400/40 text-white text-sm focus:outline-none"
            />
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-black font-bold text-xs whitespace-nowrap cursor-pointer transition-all"
            >
              + Add Artist
            </button>
          </form>
        )}
      </div>

      {/* Artists Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 max-h-[50vh] overflow-y-auto custom-scrollbar p-1">
        {filteredArtists.map((artist) => {
          const isSelected = selectedArtists.some(a => (typeof a === 'string' ? a : a.id) === artist.id || (typeof a === 'string' ? a : a.name) === artist.name);
          return (
            <div
              key={artist.id}
              onClick={() => onToggleArtist(artist)}
              className={`relative rounded-2xl p-3 border transition-all duration-200 cursor-pointer flex flex-col items-center text-center group ${
                isSelected
                  ? 'bg-gradient-to-b from-cyan-950/60 to-slate-900 border-cyan-400 shadow-lg shadow-cyan-950/60 scale-[1.02]'
                  : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] hover:border-white/[0.15]'
              }`}
            >
              {/* Checkmark indicator */}
              <div className={`absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center border transition-all z-10 ${
                isSelected 
                  ? 'bg-cyan-400 border-cyan-400 text-black shadow-sm shadow-cyan-400/50' 
                  : 'border-white/20 bg-black/40'
              }`}>
                {isSelected && (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>

              {/* Artist Avatar Photo */}
              <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden mb-3 border border-white/[0.08] group-hover:border-cyan-400/50 transition-colors shadow-md">
                <img
                  src={artist.imageUrl}
                  alt={artist.name}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>

              <h4 className="font-heading font-bold text-white text-xs sm:text-sm truncate w-full">
                {artist.name}
              </h4>
              <p className="text-[10px] text-slate-400 truncate w-full mt-0.5">
                {artist.genre}
              </p>
            </div>
          );
        })}
      </div>

      {!isRequirementMet && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs text-center max-w-md mx-auto flex items-center justify-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Please select at least <strong>{3 - count} more artist{3 - count > 1 ? 's' : ''}</strong> to continue.</span>
        </div>
      )}
    </div>
  );
}
