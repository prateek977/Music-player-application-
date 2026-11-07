import React, { useState, useEffect, useRef } from 'react';
import AlbumArtwork from './AlbumArtwork';
import TrackMetadata from './TrackMetadata';
import PlaybackProgress from './PlaybackProgress';
import PlaybackControls from './PlaybackControls';

/**
 * NowPlayingScreen
 * Full-screen immersive dark music player inspired by the reference design:
 * - Deep black atmospheric surface (#08080D)
 * - Large square artwork with rounded corners & soft elevation
 * - Subtle blurred ambient background derived from album artwork
 * - Clean typography hierarchy (#F5F5F7 & #9999A6)
 * - Lime-green accents (#D5F36A) for playback progress & master play/pause
 * - Smooth touch-drag dismiss & in-screen queue sheet
 */
export default function NowPlayingScreen({
  isOpen = false,
  onClose,
  currentSong,
  isPlaying = false,
  isBuffering = false,
  currentTime = 0,
  duration = 0,
  onPlayPause,
  onPrevious,
  onNext,
  onSeek,
  formatTime,
  shuffle = false,
  onToggleShuffle,
  repeat = 'off',
  onToggleRepeat,
  favorites = [],
  onToggleFavorite,
  queue = [],
  onPlayFromQueue,
  activeRoom = null,
  volume = 100,
  isMuted = false,
  onVolumeChange,
  onToggleMute
}) {
  const [isQueueDrawerOpen, setIsQueueDrawerOpen] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const containerRef = useRef(null);

  // Keyboard accessibility
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.key === 'Escape') {
        onClose?.();
      } else if (e.key === ' ') {
        e.preventDefault();
        onPlayPause?.();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onSeek?.({ target: { value: Math.min(currentTime + 5, duration || 100) } });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onSeek?.({ target: { value: Math.max(currentTime - 5, 0) } });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onPlayPause, onSeek, currentTime, duration]);

  // Touch swipe-down to dismiss
  const handleTouchStart = (e) => {
    setTouchStart(e.targetTouches[0].clientY);
  };

  const handleTouchMove = (e) => {
    if (!touchStart) return;
    const currentY = e.targetTouches[0].clientY;
    const diff = currentY - touchStart;
    if (diff > 120 && !isQueueDrawerOpen) {
      onClose?.();
      setTouchStart(null);
    }
  };

  const handleTouchEnd = () => {
    setTouchStart(null);
  };

  if (!isOpen) return null;

  const thumbnailUrl = currentSong?.thumbnailUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';
  const isFavorite = currentSong ? favorites.some(s => s.id === currentSong.id) : false;

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="fixed inset-0 z-50 overflow-hidden flex flex-col justify-between bg-[#08080D] text-[#F5F5F7] select-none animate-fadeIn"
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))'
      }}
    >
      {/* 1. Ambient Blurred Artwork & Deep Background Layers */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        {/* Enlarged blurred artwork with gentle opacity */}
        <div
          className="absolute inset-0 bg-cover bg-center transition-all duration-700 scale-125 filter blur-3xl opacity-25"
          style={{ backgroundImage: `url(${thumbnailUrl})` }}
        />
        {/* Deep charcoal black gradient overlay ensuring crisp contrast */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#08080D]/85 via-[#08080D]/95 to-[#08080D]" />
        
        {/* Subtle lime ambient light at top */}
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[500px] h-[350px] bg-[#D5F36A]/5 rounded-full filter blur-[120px] pointer-events-none" />
      </div>

      {/* 2. Top Header Navigation Bar */}
      <header className="relative z-20 w-full max-w-lg mx-auto flex items-center justify-between px-4 sm:px-6 py-2">
        {/* Minimize / Back Button */}
        <button
          onClick={onClose}
          aria-label="Collapse Now Playing"
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-[#9999A6] hover:text-[#F5F5F7] hover:bg-white/[0.08] active:scale-90 transition-all cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {/* Center Context Label */}
        <div className="text-center min-w-0 px-2">
          <p className="text-[10px] font-bold tracking-widest uppercase text-[#9999A6]">
            {activeRoom ? `Room • ${activeRoom}` : 'Now Playing'}
          </p>
          <p className="text-xs font-semibold text-[#F5F5F7] truncate max-w-[200px] sm:max-w-[260px]">
            {currentSong ? currentSong.title : 'ListenUp Stream'}
          </p>
        </div>

        {/* Queue Button in Header */}
        <button
          onClick={() => setIsQueueDrawerOpen(!isQueueDrawerOpen)}
          aria-label="Toggle Queue"
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-all cursor-pointer relative ${
            isQueueDrawerOpen ? 'text-[#D5F36A] bg-white/[0.08]' : 'text-[#9999A6] hover:text-[#F5F5F7] hover:bg-white/[0.08]'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
          {queue.length > 0 && (
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#D5F36A]" />
          )}
        </button>
      </header>

      {/* 3. Center Section: Large Square Album Artwork with Rounded Corners */}
      <main className="relative z-20 flex-1 flex flex-col items-center justify-center px-6 py-2 min-h-0 w-full max-w-lg mx-auto">
        {/* Large Square Artwork Container */}
        <div className="w-full max-w-[320px] sm:max-w-[360px] md:max-w-[380px] aspect-square flex items-center justify-center">
          <AlbumArtwork
            src={thumbnailUrl}
            alt={currentSong ? currentSong.title : 'ListenUp Artwork'}
            isPlaying={isPlaying}
            className="w-full h-full"
          />
        </div>

        {/* Track Title, Artist, and Favorite Toggle */}
        <div className="w-full mt-6 sm:mt-8">
          <TrackMetadata
            song={currentSong}
            isFavorite={isFavorite}
            onToggleFavorite={onToggleFavorite}
          />
        </div>
      </main>

      {/* 4. Bottom Controls & Progress Section */}
      <footer className="relative z-20 w-full max-w-lg mx-auto flex flex-col items-center gap-3 pb-2 px-4 sm:px-6">
        {/* Playback Scrubber Bar */}
        <PlaybackProgress
          currentTime={currentTime}
          duration={duration}
          onSeek={onSeek}
          formatTime={formatTime}
          disabled={!currentSong}
        />

        {/* Master Playback Controls */}
        <PlaybackControls
          isPlaying={isPlaying}
          isBuffering={isBuffering}
          onPlayPause={onPlayPause}
          onPrevious={onPrevious}
          onNext={onNext}
          shuffle={shuffle}
          onToggleShuffle={onToggleShuffle}
          repeat={repeat}
          onToggleRepeat={onToggleRepeat}
          isPrevDisabled={queue.length === 0}
          isNextDisabled={queue.length === 0}
          onToggleQueue={() => setIsQueueDrawerOpen(!isQueueDrawerOpen)}
          isQueueOpen={isQueueDrawerOpen}
          queueCount={queue.length}
          volume={volume}
          isMuted={isMuted}
          onVolumeChange={onVolumeChange}
          onToggleMute={onToggleMute}
        />
      </footer>

      {/* 5. In-Screen Queue Drawer (Slide-up sheet) */}
      {isQueueDrawerOpen && (
        <div 
          className="fixed inset-x-0 bottom-0 top-20 z-40 bg-[#101017]/98 backdrop-blur-2xl border-t border-white/[0.08] rounded-t-[32px] shadow-[0_-20px_50px_rgba(0,0,0,0.95)] flex flex-col animate-slideUp"
          style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
        >
          {/* Drawer Handle & Header */}
          <div className="w-full flex flex-col items-center pt-3 pb-2 px-6 border-b border-white/[0.08]">
            <div className="w-10 h-1 rounded-full bg-white/20 mb-3 cursor-pointer" onClick={() => setIsQueueDrawerOpen(false)} />
            <div className="w-full flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[#F5F5F7] flex items-center gap-2">
                  <span>Up Next</span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#191922] text-[#D5F36A] border border-white/[0.08]">
                    {queue.length}
                  </span>
                </h3>
                <p className="text-xs text-[#9999A6]">Tap any song to play instantly</p>
              </div>
              <button
                onClick={() => setIsQueueDrawerOpen(false)}
                className="p-2 rounded-full hover:bg-white/[0.08] text-[#9999A6] hover:text-[#F5F5F7] transition-colors cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Queue Song List */}
          <div className="flex-1 overflow-y-auto px-4 py-2 custom-scrollbar divide-y divide-white/[0.04]">
            {queue.length === 0 ? (
              <div className="py-16 text-center text-[#666674]">
                <p className="text-sm">Queue is empty.</p>
                <p className="text-xs mt-1">Search or browse to add tracks to the queue.</p>
              </div>
            ) : (
              queue.map((song, index) => {
                const isCurrent = currentSong?.id === song.id;
                return (
                  <div
                    key={`${song.id}-${index}`}
                    onClick={() => {
                      onPlayFromQueue?.(song);
                      setIsQueueDrawerOpen(false);
                    }}
                    className={`flex items-center gap-3 py-2.5 px-3 rounded-2xl transition-all cursor-pointer ${
                      isCurrent ? 'bg-[#191922] border border-[#D5F36A]/40' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="text-xs font-mono text-[#666674] w-5 text-center">
                      {index + 1}
                    </span>
                    <div className="w-11 h-11 rounded-xl overflow-hidden bg-black/60 flex-shrink-0">
                      <img src={song.thumbnailUrl} alt={song.title} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className={`text-xs sm:text-sm font-semibold truncate ${isCurrent ? 'text-[#D5F36A]' : 'text-[#F5F5F7]'}`}>
                        {song.title}
                      </h4>
                      <p className="text-[11px] text-[#9999A6] truncate mt-0.5">{song.artist}</p>
                    </div>
                    {isCurrent && isPlaying && (
                      <span className="w-2 h-2 rounded-full bg-[#D5F36A] animate-ping flex-shrink-0" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
