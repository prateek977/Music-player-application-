import React, { useState } from 'react';

/**
 * PlaybackProgress
 * Smooth seekable progress bar with elapsed & total duration timestamps.
 * Styled with lime-green accent indicator (#D5F36A) and touch-friendly thumb.
 */
export default function PlaybackProgress({
  currentTime = 0,
  duration = 0,
  onSeek,
  disabled = false,
  formatTime,
  className = ''
}) {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);

  const activeDuration = duration > 0 ? duration : 100;
  const displayTime = isScrubbing ? scrubValue : currentTime;
  const progressPercent = Math.min(Math.max((displayTime / activeDuration) * 100, 0), 100);

  const defaultFormatTime = (secs) => {
    if (isNaN(secs) || secs === null || secs === undefined || secs < 0) return '0:00';
    const total = Math.floor(secs);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const remainingSecs = total % 60;
    const padSecs = remainingSecs < 10 ? `0${remainingSecs}` : `${remainingSecs}`;

    if (hrs > 0) {
      const padMins = mins < 10 ? `0${mins}` : `${mins}`;
      return `${hrs}:${padMins}:${padSecs}`;
    }
    return `${mins}:${padSecs}`;
  };

  const formatter = formatTime || defaultFormatTime;

  const handleChange = (e) => {
    const val = parseFloat(e.target.value);
    setScrubValue(val);
  };

  const handleStart = () => {
    setIsScrubbing(true);
    setScrubValue(currentTime);
  };

  const handleEnd = (e) => {
    setIsScrubbing(false);
    const val = parseFloat(e.target.value);
    onSeek?.({ target: { value: val } });
  };

  return (
    <div className={`w-full px-1 ${className}`}>
      {/* Slider Track Container */}
      <div className="relative group flex items-center py-2 cursor-pointer">
        {/* Background Rail */}
        <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden relative">
          {/* Active Fill with Soft Lime-Green Accent */}
          <div
            className="h-full rounded-full bg-[#D5F36A] shadow-[0_0_10px_rgba(213,243,106,0.35)] transition-[width] duration-100 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Real Range Input */}
        <input
          type="range"
          min="0"
          max={activeDuration}
          step="0.2"
          value={displayTime}
          disabled={disabled || !duration}
          onMouseDown={handleStart}
          onTouchStart={handleStart}
          onChange={handleChange}
          onMouseUp={handleEnd}
          onTouchEnd={handleEnd}
          role="slider"
          aria-label="Seek playback position"
          aria-valuemin="0"
          aria-valuemax={Math.round(activeDuration)}
          aria-valuenow={Math.round(displayTime)}
          aria-valuetext={`${formatter(displayTime)} of ${duration > 0 ? formatter(duration) : 'unknown'}`}
          className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-20"
        />

        {/* Scrubber Thumb Indicator */}
        <div
          className="absolute w-3.5 h-3.5 bg-[#D5F36A] rounded-full shadow-[0_0_8px_rgba(213,243,106,0.8)] pointer-events-none transition-transform group-hover:scale-125 z-10 -ml-1.5"
          style={{ left: `${progressPercent}%` }}
        />
      </div>

      {/* Timestamp labels */}
      <div className="flex justify-between items-center text-xs font-mono text-[#9999A6] mt-0.5 select-none">
        <span>{formatter(displayTime)}</span>
        <span>{duration > 0 ? formatter(duration) : '--:--'}</span>
      </div>
    </div>
  );
}
