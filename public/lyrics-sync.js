'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShinaYuuLyricsSync = api;
})(typeof window !== 'undefined' ? window : globalThis, function createLyricsSync() {
  function clamp(value, min, max) {
    value = Number(value);
    if (!Number.isFinite(value)) value = min;
    return Math.max(min, Math.min(max, value));
  }

  function parseLrcOffsetSeconds(text) {
    const match = String(text || '').match(/\[offset\s*:\s*([+-]?\d+)\s*\]/i);
    if (!match) return 0;
    return clamp(Number.parseInt(match[1], 10) / 1000, -10, 10);
  }

  function normalizeDelaySeconds(value, fallback = 0.35) {
    const parsed = Number(value);
    const defaultValue = Number(fallback);
    return clamp(Number.isFinite(parsed) ? parsed : (Number.isFinite(defaultValue) ? defaultValue : 0.35), -5, 5);
  }

  function resolveDelaySeconds(defaultDelay, trackDelay) {
    const hasTrackDelay = trackDelay !== null && trackDelay !== undefined && trackDelay !== '';
    const parsedTrack = Number(trackDelay);
    return normalizeDelaySeconds(hasTrackDelay && Number.isFinite(parsedTrack) ? parsedTrack : defaultDelay, 0.35);
  }

  function compensatedPlaybackSeconds(currentSeconds, delaySeconds) {
    const current = Math.max(0, Number(currentSeconds) || 0);
    const delay = normalizeDelaySeconds(delaySeconds, 0.35);
    return Math.max(0, current - delay);
  }

  function normalizeDurationSeconds(value) {
    let duration = Number(value) || 0;
    if (duration > 10000) duration /= 1000;
    return Math.max(0, duration);
  }

  function durationCompatibility(candidateDuration, targetDuration) {
    const candidate = normalizeDurationSeconds(candidateDuration);
    const target = normalizeDurationSeconds(targetDuration);
    if (!candidate || !target) return { compatible: true, delta: 0, tolerance: 0 };
    const delta = Math.abs(candidate - target);
    const tolerance = Math.max(8, Math.min(18, target * 0.055));
    return { compatible: delta <= tolerance, delta, tolerance };
  }

  function timelineScaleFactor(sourceDuration, targetDuration) {
    const source = normalizeDurationSeconds(sourceDuration);
    const target = normalizeDurationSeconds(targetDuration);
    if (!source || !target || !durationCompatibility(source, target).compatible) return 1;
    const ratio = target / source;
    if (ratio < 0.97 || ratio > 1.03 || Math.abs(ratio - 1) < 0.003) return 1;
    return ratio;
  }

  function scaleLyricTimeline(lines, factor) {
    const ratio = Number(factor);
    if (!Array.isArray(lines) || !Number.isFinite(ratio) || Math.abs(ratio - 1) < 0.0001) return Array.isArray(lines) ? lines : [];
    return lines.map((line) => {
      const copy = { ...line, timelineScale: ratio };
      if (Number.isFinite(Number(copy.t))) copy.t = Math.max(0, Number(copy.t) * ratio);
      if (Number.isFinite(Number(copy.duration))) copy.duration = Math.max(0.01, Number(copy.duration) * ratio);
      if (Array.isArray(line.words)) {
        copy.words = line.words.map((word) => {
          const next = { ...word };
          if (Number.isFinite(Number(next.t))) next.t = Math.max(0, Number(next.t) * ratio);
          if (Number.isFinite(Number(next.d))) next.d = Math.max(0.01, Number(next.d) * ratio);
          return next;
        });
      }
      return copy;
    });
  }

  return {
    parseLrcOffsetSeconds,
    normalizeDelaySeconds,
    resolveDelaySeconds,
    compensatedPlaybackSeconds,
    normalizeDurationSeconds,
    durationCompatibility,
    timelineScaleFactor,
    scaleLyricTimeline,
  };
});
