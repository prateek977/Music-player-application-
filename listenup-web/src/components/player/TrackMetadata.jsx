import React from 'react';

/**
 * TrackMetadata
 * Large elegant track title, artist metadata, and quick favorite toggle.
 */
export default function TrackMetadata({
  song,
  isFavorite = false,
  onToggleFavorite,
  className = ''
}) {
  const title = song?.title || 'No Track Selected';
  const artist = song?.artist || 'Ready to Stream';

  return (
    <div className={`w-full flex items-center justify-between gap-4 px-1 ${className}`}>
      {/* Title & Artist */}
      <div className="min-w-0 flex-1">
        <h2 
          className="text-xl sm:text-2xl font-bold text-[#F5F5F7] tracking-tight truncate"
          title={title}
        >
          {title}
        </h2>
        <p 
          className="text-sm sm:text-base font-medium text-[#9999A6] truncate mt-1 flex items-center gap-2"
          title={artist}
        >
          <span>{artist}</span>
          {song?.duration && (
            <>
              <span className="w-1 h-1 rounded-full bg-[#666674] inline-block" />
              <span className="text-xs text-[#666674] font-mono">
                {typeof song.duration === 'number' 
                  ? `${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, '0')}` 
                  : song.duration}
              </span>
            </>
          )}
        </p>
      </div>

      {/* Favorite Button */}
      <button
        onClick={() => song && onToggleFavorite?.(song)}
        disabled={!song}
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/[0.08] active:scale-90 transition-all cursor-pointer flex-shrink-0 ${
          isFavorite ? 'text-rose-500 scale-105' : 'text-[#9999A6] hover:text-[#F5F5F7]'
        } disabled:opacity-30 disabled:pointer-events-none`}
      >
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          viewBox="0 0 24 24" 
          fill={isFavorite ? 'currentColor' : 'none'} 
          strokeWidth="2" 
          stroke="currentColor" 
          className="w-6 h-6 sm:w-7 sm:h-7 transition-colors drop-shadow"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" 
          />
        </svg>
      </button>
    </div>
  );
}
