import React, { useState } from 'react';

/**
 * AlbumArtwork
 * Premium square album artwork with rounded corners, subtle inner rim,
 * soft ambient shadow, and smooth crossfade transition between tracks.
 */
export default function AlbumArtwork({
  src,
  alt = 'Album Artwork',
  isPlaying = false,
  className = ''
}) {
  const [imageError, setImageError] = useState(false);
  const fallbackUrl = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';

  const imageSrc = imageError || !src ? fallbackUrl : src;

  return (
    <div className={`relative aspect-square w-full select-none flex items-center justify-center ${className}`}>
      {/* Soft Ambient Glow Halo behind artwork */}
      <div 
        className={`absolute inset-4 rounded-[28px] transition-all duration-700 pointer-events-none ${
          isPlaying 
            ? 'opacity-60 scale-102 bg-[#D5F36A]/15 blur-2xl' 
            : 'opacity-25 scale-98 bg-black/60 blur-xl'
        }`}
      />

      {/* Main Square Artwork Container with Rounded Corners */}
      <div 
        className={`relative w-full h-full rounded-[24px] sm:rounded-[28px] overflow-hidden bg-[#101017] border border-white/[0.1] shadow-[0_20px_50px_rgba(0,0,0,0.85)] transition-transform duration-500 ease-out z-10 ${
          isPlaying ? 'scale-[1.01]' : 'scale-100'
        }`}
      >
        <img
          key={imageSrc}
          src={imageSrc}
          alt={alt}
          onError={() => setImageError(true)}
          className="w-full h-full object-cover rounded-[24px] sm:rounded-[28px] transition-opacity duration-300 animate-fadeIn"
          loading="eager"
        />

        {/* Subtle glass reflection overlay */}
        <div className="absolute inset-0 rounded-[24px] sm:rounded-[28px] bg-gradient-to-tr from-black/40 via-transparent to-white/[0.08] pointer-events-none" />

        {/* Inner subtle rim highlight */}
        <div className="absolute inset-0 rounded-[24px] sm:rounded-[28px] ring-1 ring-inset ring-white/[0.1] pointer-events-none" />
      </div>
    </div>
  );
}
