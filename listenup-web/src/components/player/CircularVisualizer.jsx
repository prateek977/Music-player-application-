import React, { useRef, useEffect } from 'react';

/**
 * CircularVisualizer
 * Renders a high-performance 60fps Canvas 2D circular audio-reactive waveform ring
 * surrounding the circular album artwork.
 * 
 * Features:
 * - Layered yellow, amber, muted red, cyan, and teal color gradients
 * - Multi-harmonic organic waveform contours
 * - Radial frequency-accent bars around the circumference
 * - Responsive to playback states: playing, paused, buffering, seeking
 * - Smooth dampening / lerping so transitions are cinematic and never jarring
 * - High-DPI canvas scaling
 * - Respects prefers-reduced-motion
 */
export default function CircularVisualizer({
  isPlaying = false,
  isBuffering = false,
  currentTime = 0,
  artworkRadius = 140, // radius of the inner circular art
  className = ''
}) {
  const canvasRef = useRef(null);
  const stateRef = useRef({
    isPlaying,
    isBuffering,
    currentTime,
    energy: 0,
    targetEnergy: isPlaying ? 1 : 0,
    phase: 0,
    particles: []
  });

  // Keep stateRef up to date without re-triggering the RAF loop
  useEffect(() => {
    stateRef.current.isPlaying = isPlaying;
    stateRef.current.isBuffering = isBuffering;
    stateRef.current.currentTime = currentTime;
    stateRef.current.targetEnergy = isPlaying ? 1 : isBuffering ? 0.35 : 0;
  }, [isPlaying, isBuffering, currentTime]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    let animationFrameId;
    let lastTime = performance.now();

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Initialize ambient orbiting particles
    const particleCount = 28;
    const particles = Array.from({ length: particleCount }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: (0.2 + Math.random() * 0.4) * (Math.random() > 0.5 ? 1 : -1),
      distance: artworkRadius + 22 + Math.random() * 45,
      radius: 1 + Math.random() * 1.8,
      alpha: 0.15 + Math.random() * 0.6,
      color: ['#fbbf24', '#f59e0b', '#f43f5e', '#00e5f0', '#2dd4bf'][Math.floor(Math.random() * 5)]
    }));
    stateRef.current.particles = particles;

    // Handle high-DPI sizing
    const handleResize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    handleResize();
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas);

    // Number of radial bars around the ring
    const barCount = 84;
    const barHeights = new Float32Array(barCount);

    const render = (now) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const centerX = width / 2;
      const centerY = height / 2;

      // Base radius wraps right beneath the circular album art perimeter
      // If artworkRadius is not passed, calculate it proportionally to the canvas (33% of width)
      const baseRadius = artworkRadius ? artworkRadius : (width * 0.33);

      // Smooth energy dampening (lerp)
      const st = stateRef.current;
      st.energy += (st.targetEnergy - st.energy) * Math.min(dt * 5.0, 1.0);

      if (!prefersReducedMotion) {
        st.phase += (st.isPlaying ? 2.4 : st.isBuffering ? 3.8 : 0.4) * dt;
      }

      ctx.clearRect(0, 0, width, height);

      // 1. Subtle Outer Glow Halo
      const glowGradient = ctx.createRadialGradient(
        centerX, centerY, baseRadius - 10,
        centerX, centerY, baseRadius + 60
      );
      const glowAlpha = 0.08 + st.energy * 0.18;
      glowGradient.addColorStop(0, `rgba(245, 158, 11, ${glowAlpha})`);
      glowGradient.addColorStop(0.4, `rgba(0, 229, 240, ${glowAlpha * 0.7})`);
      glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius + 65, 0, Math.PI * 2);
      ctx.fillStyle = glowGradient;
      ctx.fill();

      // 2. Multi-Harmonic Inner Waveform Ring (Continuous smooth ribbon)
      ctx.save();
      ctx.beginPath();
      const wavePoints = 120;
      for (let i = 0; i <= wavePoints; i++) {
        const theta = (i / wavePoints) * Math.PI * 2;
        // Harmonic synthesis: 3 overlapping sine/cosine oscillations
        const h1 = Math.sin(theta * 5 + st.phase) * (4 + st.energy * 10);
        const h2 = Math.cos(theta * 9 - st.phase * 1.3) * (2 + st.energy * 7);
        const h3 = Math.sin(theta * 13 + st.phase * 2.1) * (1 + st.energy * 4);
        const r = baseRadius + 4 + h1 + h2 + h3;

        const x = centerX + Math.cos(theta) * r;
        const y = centerY + Math.sin(theta) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(0, 229, 240, ${0.35 + st.energy * 0.45})`;
      ctx.lineWidth = 1.8;
      ctx.shadowColor = '#00e5f0';
      ctx.shadowBlur = st.energy * 12;
      ctx.stroke();
      ctx.restore();

      // 3. Counter-Waveform Ring (Warm Golden / Amber Glow)
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= wavePoints; i++) {
        const theta = (i / wavePoints) * Math.PI * 2;
        const h1 = Math.sin(theta * 4 - st.phase * 1.5) * (3 + st.energy * 8);
        const h2 = Math.cos(theta * 7 + st.phase * 1.1) * (2 + st.energy * 5);
        const r = baseRadius + 2 + h1 + h2;

        const x = centerX + Math.cos(theta) * r;
        const y = centerY + Math.sin(theta) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(251, 191, 36, ${0.3 + st.energy * 0.4})`;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = st.energy * 10;
      ctx.stroke();
      ctx.restore();

      // 4. Radial Frequency Waveform Bars (Yellow -> Amber -> Red -> Cyan -> Teal)
      for (let i = 0; i < barCount; i++) {
        const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
        const normalizedAngle = (i / barCount); // 0 to 1

        // Deterministic frequency envelope simulation
        // Simulates audio spectrum: bass pulse + mid harmonics + shimmering treble
        const t = st.currentTime || (now / 1000);
        const bassMod = Math.sin(t * 4.2 + i * 0.2) * 0.5 + 0.5;
        const midMod = Math.cos(t * 6.5 + i * 0.4) * 0.5 + 0.5;
        const trebleMod = Math.sin(t * 11.0 + i * 0.8) * 0.5 + 0.5;
        
        // Target bar height in pixels
        const minHeight = 3.0;
        let maxHeight = 28;
        if (normalizedAngle < 0.3) {
          // Low frequencies (Bass sector)
          maxHeight = 36 * bassMod;
        } else if (normalizedAngle < 0.7) {
          // Mid frequencies
          maxHeight = 28 * midMod;
        } else {
          // High frequencies
          maxHeight = 22 * trebleMod;
        }

        const targetHeight = minHeight + maxHeight * st.energy;
        // Smoothly interpolate current bar heights for fluid motion
        barHeights[i] += (targetHeight - barHeights[i]) * Math.min(dt * 14.0, 1.0);

        const currentBarH = barHeights[i];
        const rStart = baseRadius + 7;
        const rEnd = rStart + currentBarH;

        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        const x1 = centerX + cosA * rStart;
        const y1 = centerY + sinA * rStart;
        const x2 = centerX + cosA * rEnd;
        const y2 = centerY + sinA * rEnd;

        // Dynamic 4-color palette progression around circumference
        let barColor;
        if (normalizedAngle < 0.25) {
          // Golden Amber / Warm Yellow
          barColor = `rgba(251, 191, 36, ${0.45 + st.energy * 0.5})`;
        } else if (normalizedAngle < 0.5) {
          // Muted Coral / Warm Red
          barColor = `rgba(244, 63, 94, ${0.45 + st.energy * 0.5})`;
        } else if (normalizedAngle < 0.75) {
          // Neon Cyan / Electric Blue
          barColor = `rgba(0, 229, 240, ${0.5 + st.energy * 0.5})`;
        } else {
          // Emerald / Teal
          barColor = `rgba(45, 212, 191, ${0.45 + st.energy * 0.5})`;
        }

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = barColor;
        ctx.lineWidth = Math.max(1.8, (baseRadius * 2 * Math.PI) / (barCount * 3.2));
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // 5. Floating Orbital Ambient Sparks (Active when playing)
      if (st.energy > 0.1 && !prefersReducedMotion) {
        ctx.save();
        for (const p of st.particles) {
          p.angle += p.speed * dt * (0.8 + st.energy * 0.8);
          const px = centerX + Math.cos(p.angle) * (p.distance + Math.sin(st.phase + p.angle) * 6);
          const py = centerY + Math.sin(p.angle) * (p.distance + Math.sin(st.phase + p.angle) * 6);

          ctx.beginPath();
          ctx.arc(px, py, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.alpha * st.energy * 0.85;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 8;
          ctx.fill();
        }
        ctx.restore();
      }

      // Next frame
      if (!prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    if (prefersReducedMotion) {
      // Just render one static frame
      render(performance.now());
    } else {
      animationFrameId = requestAnimationFrame(render);
    }

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, [artworkRadius]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none w-full h-full z-0 ${className}`}
      aria-hidden="true"
    />
  );
}
