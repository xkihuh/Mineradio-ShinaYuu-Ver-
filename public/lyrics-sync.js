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

  function normalizeTimelineRate(value, fallback = 1) {
    const parsed = Number(value);
    const defaultValue = Number(fallback);
    return clamp(Number.isFinite(parsed) ? parsed : (Number.isFinite(defaultValue) ? defaultValue : 1), 0.94, 1.06);
  }

  // Return a conservative automatic timeline stretch. The rate represents how
  // much the lyric timestamps need to be stretched to match the audible track.
  // 1.01 means the lyric timeline should run 1% slower / finish 1% later.
  function automaticTimelineRate(sourceDuration, targetDuration, score) {
    const source = normalizeDurationSeconds(sourceDuration);
    const target = normalizeDurationSeconds(targetDuration);
    const confidence = Number(score) || 0;
    if (!source || !target || confidence < 48) return 1;
    const compatibility = durationCompatibility(source, target);
    if (!compatibility.compatible) return 1;
    const ratio = target / source;
    // Ignore sub-second metadata rounding. Restrict automatic correction to a
    // safe range so a wrong live/remix match cannot distort the whole song.
    if (compatibility.delta < 0.75 || ratio < 0.965 || ratio > 1.035) return 1;
    return normalizeTimelineRate(ratio, 1);
  }

  function lyricTimelineAnchor(lines) {
    if (!Array.isArray(lines)) return 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const time = Number(line && line.t);
      if (Number.isFinite(time) && time >= 0 && !(line && line.fallback)) return time;
    }
    return 0;
  }

  // Map the real playback clock to the unmodified lyric timeline. Keeping the
  // first lyric as the pivot fixes progressive drift without moving the first
  // line that was already aligned by the LRC offset / per-track delay.
  function mapPlaybackToLyricSeconds(currentSeconds, delaySeconds, timelineRate, anchorSeconds) {
    const compensated = compensatedPlaybackSeconds(currentSeconds, delaySeconds);
    const rate = normalizeTimelineRate(timelineRate, 1);
    const anchor = Math.max(0, Number(anchorSeconds) || 0);
    if (Math.abs(rate - 1) < 0.00001 || compensated <= anchor) return compensated;
    return Math.max(0, anchor + (compensated - anchor) / rate);
  }

  function scaleLyricTimeline(lines, factor, anchorSeconds) {
    const ratio = Number(factor);
    const anchor = Math.max(0, Number(anchorSeconds) || 0);
    if (!Array.isArray(lines) || !Number.isFinite(ratio) || Math.abs(ratio - 1) < 0.0001) return Array.isArray(lines) ? lines : [];
    return lines.map((line) => {
      const copy = { ...line, timelineScale: ratio };
      if (Number.isFinite(Number(copy.t))) copy.t = Math.max(0, anchor + (Number(copy.t) - anchor) * ratio);
      if (Number.isFinite(Number(copy.duration))) copy.duration = Math.max(0.01, Number(copy.duration) * ratio);
      if (Array.isArray(line.words)) {
        copy.words = line.words.map((word) => {
          const next = { ...word };
          if (Number.isFinite(Number(next.t))) next.t = Math.max(0, anchor + (Number(next.t) - anchor) * ratio);
          if (Number.isFinite(Number(next.d))) next.d = Math.max(0.01, Number(next.d) * ratio);
          return next;
        });
      }
      return copy;
    });
  }

  // Select the upcoming line slightly before its authored timestamp so the
  // renderer and Electron IPC can prepare it before the exact audible onset.
  // This does not change the lyric timestamp or karaoke progress.
  function visualLookupSeconds(currentSeconds, lookaheadSeconds, enabled) {
    const current = Math.max(0, Number(currentSeconds) || 0);
    if (!enabled) return current;
    return current + clamp(Number(lookaheadSeconds) || 0, 0, 0.35);
  }


  function visualEntranceProgress(currentSeconds, lineStartSeconds, durationSeconds, enabled) {
    const current = Math.max(0, Number(currentSeconds) || 0);
    const start = Math.max(0, Number(lineStartSeconds) || 0);
    const duration = clamp(Number(durationSeconds) || 0.18, 0.08, 0.35);
    if (!enabled || current >= start) return 1;
    return clamp(1 - (start - current) / duration, 0, 1);
  }

  function findLyricIndex(lines, timeSeconds) {
    if (!Array.isArray(lines) || !lines.length) return -1;
    const time = Math.max(0, Number(timeSeconds) || 0);
    let low = 0;
    let high = lines.length - 1;
    let result = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const lineTime = Math.max(0, Number(lines[mid] && lines[mid].t) || 0);
      if (lineTime <= time) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }

  function monotonicPositionSeconds(snapshotSeconds, receivedAtMs, playing, playbackRate, nowMs, durationSeconds) {
    let position = Math.max(0, Number(snapshotSeconds) || 0);
    const received = Number(receivedAtMs) || 0;
    const now = Number(nowMs) || received;
    if (playing && received > 0 && now > received) {
      position += (now - received) * 0.001 * clamp(Number(playbackRate) || 1, 0.25, 4);
    }
    const duration = normalizeDurationSeconds(durationSeconds);
    if (duration > 0) position = Math.min(position, duration);
    return Math.max(0, position);
  }

  return {
    parseLrcOffsetSeconds,
    normalizeDelaySeconds,
    resolveDelaySeconds,
    compensatedPlaybackSeconds,
    normalizeDurationSeconds,
    durationCompatibility,
    timelineScaleFactor,
    normalizeTimelineRate,
    automaticTimelineRate,
    lyricTimelineAnchor,
    mapPlaybackToLyricSeconds,
    scaleLyricTimeline,
    visualLookupSeconds,
    visualEntranceProgress,
    findLyricIndex,
    monotonicPositionSeconds,
  };
});
