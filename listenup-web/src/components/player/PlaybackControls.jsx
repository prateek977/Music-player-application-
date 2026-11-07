import React from 'react';

/**
 * PlaybackControls
 * Premium minimalist audio controls:
 * - Shuffle (with lime-green active indicator)
 * - Previous Track (44px target)
 * - Large Lime-Green Play/Pause button (#D5F36A)
 * - Next Track (44px target)
 * - Repeat (off / all / one)
 * - Secondary controls: Queue toggle, Volume mute/slider
 */
export default function PlaybackControls({
  isPlaying = false,
  isBuffering = false,
  onPlayPause,
  onPrevious,
  onNext,
  shuffle = false,
  onToggleShuffle,
  repeat = 'off', // 'off' | 'all' | 'one'
  onToggleRepeat,
  isNextDisabled = false,
  isPrevDisabled = false,
  onToggleQueue,
  isQueueOpen = false,
  queueCount = 0,
  volume = 100,
  isMuted = false,
  onVolumeChange,
  onToggleMute,
  className = ''
}) {
  return (
    <div className={`w-full flex flex-col items-center gap-4 ${className}`}>
      {/* Primary 5-Button Control Row */}
      <div className="w-full max-w-md flex items-center justify-between px-2 sm:px-6">
        {/* Shuffle Toggle */}
        <button
          onClick={onToggleShuffle}
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors cursor-pointer relative ${
            shuffle ? 'text-[#D5F36A]' : 'text-[#9999A6] hover:text-[#F5F5F7]'
          }`}
          title={shuffle ? 'Shuffle On' : 'Shuffle Off'}
          aria-label={shuffle ? 'Shuffle On' : 'Shuffle Off'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
          </svg>
          {shuffle && (
            <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-[#D5F36A]" />
          )}
        </button>

        {/* Previous Track */}
        <button
          onClick={onPrevious}
          disabled={isPrevDisabled}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#F5F5F7] hover:text-[#D5F36A] active:scale-90 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          title="Previous Track"
          aria-label="Previous Track"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 sm:w-7 sm:h-7">
            <path d="M18 6l-8.5 6 8.5 6V6zM8 6v12H6V6h2z"/>
          </svg>
        </button>

        {/* Primary Play/Pause Button - Large Lime-Green Circle (#D5F36A) */}
        <button
          onClick={onPlayPause}
          className="w-16 h-16 sm:w-18 sm:h-18 rounded-full bg-[#D5F36A] hover:bg-[#BDE84A] text-black flex items-center justify-center shadow-[0_0_24px_rgba(213,243,106,0.35)] active:scale-95 transition-all flex-shrink-0 cursor-pointer"
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isBuffering ? (
            <div className="w-6 h-6 border-3 border-black/30 border-t-black rounded-full animate-spin" />
          ) : isPlaying ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 sm:w-8 sm:h-8">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 sm:w-8 sm:h-8 translate-x-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Next Track */}
        <button
          onClick={onNext}
          disabled={isNextDisabled}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#F5F5F7] hover:text-[#D5F36A] active:scale-90 transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          title="Next Track"
          aria-label="Next Track"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 sm:w-7 sm:h-7">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
          </svg>
        </button>

        {/* Repeat Toggle */}
        <button
          onClick={onToggleRepeat}
          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors cursor-pointer relative ${
            repeat !== 'off' ? 'text-[#D5F36A]' : 'text-[#9999A6] hover:text-[#F5F5F7]'
          }`}
          title={`Repeat: ${repeat}`}
          aria-label={`Repeat: ${repeat}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          {repeat === 'one' && (
            <span className="absolute -top-0.5 -right-0.5 text-[9px] font-bold bg-[#D5F36A] text-black px-1 rounded-full">
              1
            </span>
          )}
          {repeat === 'all' && (
            <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-[#D5F36A]" />
          )}
        </button>
      </div>

      {/* Secondary Bottom Control Bar (Queue Drawer Toggle + Volume Control) */}
      <div className="w-full flex items-center justify-between px-4 sm:px-6 pt-1 text-[#9999A6] border-t border-white/[0.06]">
        {/* Queue Drawer Button */}
        <button
          onClick={onToggleQueue}
          className={`min-w-[44px] min-h-[44px] flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full hover:bg-white/[0.08] transition-colors cursor-pointer ${
            isQueueOpen ? 'text-[#D5F36A] bg-white/[0.08]' : 'text-[#9999A6] hover:text-[#F5F5F7]'
          }`}
          title="Open Queue"
          aria-label="Open Queue"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
          <span>Queue</span>
          {queueCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#191922] text-[#D5F36A] border border-white/[0.08] font-mono">
              {queueCount}
            </span>
          )}
        </button>

        {/* Ambient Room / Quality Info */}
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#666674] font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-[#D5F36A] animate-pulse" />
          <span>High Fidelity • 48kHz</span>
        </div>

        {/* Volume Button with Slider */}
        <div className="relative flex items-center">
          <button
            onClick={onToggleMute}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#9999A6] hover:text-[#F5F5F7] transition-colors cursor-pointer"
            title={isMuted ? 'Unmute' : 'Mute'}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted || volume === 0 ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5 text-rose-500">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6L4.5 9H1.5v6h3l4.5 3.75V5.25z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            )}
          </button>

          <div className="flex items-center ml-1">
            <input
              type="range"
              min="0"
              max="100"
              value={isMuted ? 0 : volume}
              onChange={(e) => onVolumeChange?.(parseInt(e.target.value, 10))}
              aria-label="Volume"
              className="w-16 sm:w-20 accent-[#D5F36A] h-1 rounded-full cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
