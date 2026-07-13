'use strict';

/**
 * YouTube caption adapter for ShinaYuu Music.
 *
 * This module consumes subtitle tracks exposed by yt-dlp metadata and converts
 * YouTube JSON3/SRV3/WebVTT timing into the YRC-compatible line/word model that
 * the existing ShinaYuu Music renderer already understands. It intentionally
 * contains no UI code so the current lyric stage, Desktop Lyrics, particles,
 * transitions, camera, and playback clocks remain unchanged.
 */

const DEFAULT_CACHE_TTL = 30 * 60 * 1000;
const MAX_CAPTION_BYTES = 8 * 1024 * 1024;
const FORMAT_PRIORITY = Object.freeze({ json3: 50, ttml: 40, srv3: 35, vtt: 25 });

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code) || 32))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16) || 32));
}

function stripMarkup(value) {
  return decodeEntities(String(value || '').replace(/<[^>]*>/g, ''));
}

function compactLineText(value) {
  return stripMarkup(value)
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim();
}

function normalizeSegmentText(value) {
  return stripMarkup(value)
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\r?\n/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

function splitVisibleLines(value) {
  return compactLineText(value).split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

function makeLine(startMs, durationMs, rawSegments, fallbackText, sourceFormat) {
  const lineStartMs = Math.max(0, Number(startMs) || 0);
  const lineDurationMs = Math.max(80, Number(durationMs) || 0);
  const segments = Array.isArray(rawSegments) ? rawSegments : [];
  let text = '';
  const words = [];

  segments.forEach((segment, index) => {
    let part = normalizeSegmentText(segment && segment.text);
    if (!part) return;

    // Preserve author-provided whitespace when present. If consecutive chunks
    // contain plain word tokens with no boundary, insert one readable space.
    if (text && !/\s$/.test(text) && !/^\s|^[,.;:!?…'’”"\-)]/.test(part)) part = ` ${part}`;
    const c0 = text.length;
    text += part;

    const start = Number(segment && segment.startMs);
    let end = Number(segment && segment.endMs);
    if (!Number.isFinite(start)) return;
    if (!Number.isFinite(end) || end <= start) {
      const next = segments.slice(index + 1).find((candidate) => Number.isFinite(Number(candidate && candidate.startMs)));
      end = next ? Number(next.startMs) : lineStartMs + lineDurationMs;
    }
    words.push({
      text: part,
      startMs: Math.max(lineStartMs, start),
      endMs: Math.max(start + 40, end),
      c0,
      c1: text.length,
    });
  });

  if (!text.trim()) text = normalizeSegmentText(fallbackText);
  const leading = (text.match(/^\s+/) || [''])[0].length;
  text = text.replace(/[ \t]+/g, ' ').trim();
  if (!text) return null;

  words.forEach((word) => {
    word.c0 = clamp(word.c0 - leading, 0, text.length);
    word.c1 = clamp(word.c1 - leading, word.c0, text.length);
    word.text = text.slice(word.c0, word.c1) || word.text.trim();
  });

  const usefulWords = words.filter((word) => word.c1 > word.c0 && word.text.trim());
  return {
    startMs: lineStartMs,
    endMs: lineStartMs + lineDurationMs,
    durationMs: lineDurationMs,
    text,
    words: usefulWords,
    sourceFormat,
  };
}

function finalizeLines(input) {
  const sorted = (Array.isArray(input) ? input : [])
    .filter((line) => line && Number.isFinite(line.startMs) && line.text)
    .sort((a, b) => a.startMs - b.startMs || a.text.localeCompare(b.text));
  const lines = [];

  sorted.forEach((line) => {
    const previous = lines[lines.length - 1];
    const sameText = previous && previous.text.toLowerCase() === line.text.toLowerCase();
    const overlaps = previous && line.startMs <= previous.endMs + 120;
    if (sameText && overlaps) {
      // Keep the richer of two rolling-caption duplicates.
      if ((line.words || []).length > (previous.words || []).length) lines[lines.length - 1] = line;
      else previous.endMs = Math.max(previous.endMs, line.endMs);
      return;
    }
    lines.push(line);
  });

  lines.forEach((line, index) => {
    const next = lines[index + 1];
    const authoredEnd = Number(line.endMs || 0);
    const inferredEnd = next && next.startMs > line.startMs ? next.startMs : line.startMs + 4800;
    line.endMs = authoredEnd > line.startMs ? authoredEnd : inferredEnd;
    if (next && line.endMs > next.startMs + 300) line.endMs = Math.max(line.startMs + 80, next.startMs);
    line.durationMs = clamp(line.endMs - line.startMs, 80, 18000);

    const words = Array.isArray(line.words) ? line.words : [];
    words.sort((a, b) => a.startMs - b.startMs || a.c0 - b.c0);
    words.forEach((word, wordIndex) => {
      const nextWord = words[wordIndex + 1];
      if (!Number.isFinite(word.endMs) || word.endMs <= word.startMs) {
        word.endMs = nextWord ? nextWord.startMs : line.startMs + line.durationMs;
      }
      word.startMs = clamp(word.startMs, line.startMs, line.startMs + line.durationMs);
      word.endMs = clamp(word.endMs, word.startMs + 40, line.startMs + line.durationMs);
    });
  });

  return lines;
}

function parseJson3(payload) {
  let data = payload;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_) { return []; }
  }
  const events = Array.isArray(data && data.events) ? data.events : [];
  const lines = [];

  events.forEach((event) => {
    if (!event || !Array.isArray(event.segs) || !event.segs.length) return;
    const eventStartMs = Math.max(0, Number(event.tStartMs) || 0);
    const eventDurationMs = Math.max(80, Number(event.dDurationMs) || 0);
    const rawText = event.segs.map((segment) => String(segment && segment.utf8 || '')).join('');
    const visibleLines = splitVisibleLines(rawText);
    if (!visibleLines.length) return;

    // YouTube caption windows can contain multiple rolling rows. The newest row
    // is the one tied to the current event timestamp and is the safest lyric cue.
    const targetText = visibleLines[visibleLines.length - 1];
    let seenTarget = false;
    const segments = [];
    event.segs.forEach((segment, index) => {
      let text = String(segment && segment.utf8 || '');
      if (!text) return;
      if (text.includes('\n')) {
        const pieces = text.split(/\n/);
        text = pieces[pieces.length - 1];
        seenTarget = true;
      } else if (visibleLines.length > 1 && !seenTarget) {
        return;
      }
      if (!text) return;
      const offset = Number(segment && segment.tOffsetMs);
      const startMs = Number.isFinite(offset) ? eventStartMs + Math.max(0, offset) : NaN;
      let endMs = NaN;
      for (let nextIndex = index + 1; nextIndex < event.segs.length; nextIndex += 1) {
        const nextOffset = Number(event.segs[nextIndex] && event.segs[nextIndex].tOffsetMs);
        if (Number.isFinite(nextOffset)) {
          endMs = eventStartMs + Math.max(0, nextOffset);
          break;
        }
      }
      if (!Number.isFinite(endMs)) endMs = eventStartMs + eventDurationMs;
      segments.push({ text, startMs, endMs });
    });

    const line = makeLine(eventStartMs, eventDurationMs, segments, targetText, 'json3');
    if (line) lines.push(line);
  });

  return finalizeLines(lines);
}

function attributeValue(attributes, name) {
  const expression = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
  const match = String(attributes || '').match(expression);
  return match ? match[2] : '';
}

function parseSrv3(xmlText) {
  const xml = String(xmlText || '');
  const lines = [];
  const paragraphPattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let paragraph;

  while ((paragraph = paragraphPattern.exec(xml))) {
    const attributes = paragraph[1] || '';
    const body = paragraph[2] || '';
    const startMs = Number(attributeValue(attributes, 't'));
    const durationMs = Number(attributeValue(attributes, 'd'));
    if (!Number.isFinite(startMs)) continue;

    const rawSegments = [];
    const spanPattern = /<s\b([^>]*)>([\s\S]*?)<\/s>/gi;
    let span;
    const spans = [];
    while ((span = spanPattern.exec(body))) {
      spans.push({
        offsetMs: Number(attributeValue(span[1], 't')),
        text: span[2] || '',
      });
    }
    spans.forEach((item, index) => {
      const offsetMs = Number.isFinite(item.offsetMs) ? Math.max(0, item.offsetMs) : NaN;
      const nextOffset = index + 1 < spans.length && Number.isFinite(spans[index + 1].offsetMs)
        ? Math.max(0, spans[index + 1].offsetMs)
        : Math.max(80, Number(durationMs) || 0);
      rawSegments.push({
        text: item.text,
        startMs: Number.isFinite(offsetMs) ? startMs + offsetMs : NaN,
        endMs: Number.isFinite(offsetMs) ? startMs + Math.max(offsetMs + 40, nextOffset) : NaN,
      });
    });

    const line = makeLine(startMs, durationMs, rawSegments, body, 'srv3');
    if (line) lines.push(line);
  }

  return finalizeLines(lines);
}

function parseClock(value) {
  const match = String(value || '').trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!match) return NaN;
  return ((Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0)) * 1000 + (Number(match[4]) || 0);
}

function parseVtt(vttText) {
  const text = String(vttText || '').replace(/^\ufeff/, '').replace(/\r/g, '');
  const blocks = text.split(/\n{2,}/);
  const lines = [];

  blocks.forEach((block) => {
    const rows = block.split('\n').filter((row) => row.trim());
    const timingIndex = rows.findIndex((row) => row.includes('-->'));
    if (timingIndex < 0) return;
    const timing = rows[timingIndex].match(/([^\s]+)\s*-->\s*([^\s]+)/);
    if (!timing) return;
    const startMs = parseClock(timing[1]);
    const endMs = parseClock(timing[2]);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
    const body = rows.slice(timingIndex + 1).join('\n');

    const timestampPattern = /<((?:\d+:)?\d{2}:\d{2}[.,]\d{3})>/g;
    const stamps = [];
    let match;
    while ((match = timestampPattern.exec(body))) {
      stamps.push({ index: match.index, endIndex: timestampPattern.lastIndex, timeMs: parseClock(match[1]) });
    }

    const segments = [];
    if (stamps.length) {
      stamps.forEach((stamp, index) => {
        const next = stamps[index + 1];
        const segmentText = body.slice(stamp.endIndex, next ? next.index : body.length);
        segments.push({
          text: segmentText,
          startMs: stamp.timeMs,
          endMs: next ? next.timeMs : endMs,
        });
      });
    }

    const line = makeLine(startMs, endMs - startMs, segments, body.replace(timestampPattern, ''), 'vtt');
    if (line) lines.push(line);
  });

  return finalizeLines(lines);
}


function parseTtmlTime(value) {
  const text = String(value || '').trim();
  if (!text) return NaN;
  if (/^-?\d+(?:\.\d+)?ms$/i.test(text)) return Number.parseFloat(text) || 0;
  if (/^-?\d+(?:\.\d+)?s$/i.test(text)) return (Number.parseFloat(text) || 0) * 1000;
  if (/^-?\d+(?:\.\d+)?m$/i.test(text)) return (Number.parseFloat(text) || 0) * 60000;
  if (/^-?\d+(?:\.\d+)?h$/i.test(text)) return (Number.parseFloat(text) || 0) * 3600000;
  const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (clock) {
    const fraction = String(clock[4] || '').padEnd(3, '0').slice(0, 3);
    return ((Number(clock[1]) || 0) * 3600 + (Number(clock[2]) || 0) * 60 + (Number(clock[3]) || 0)) * 1000 + (Number(fraction) || 0);
  }
  return NaN;
}

function parseTtml(ttmlText) {
  const xml = String(ttmlText || '').replace(/^\ufeff/, '');
  const lines = [];
  const paragraphPattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let paragraph;

  while ((paragraph = paragraphPattern.exec(xml))) {
    const attributes = paragraph[1] || '';
    const body = paragraph[2] || '';
    const beginMs = parseTtmlTime(attributeValue(attributes, 'begin'));
    const endMs = parseTtmlTime(attributeValue(attributes, 'end'));
    const durMs = parseTtmlTime(attributeValue(attributes, 'dur'));
    const legacyStart = Number(attributeValue(attributes, 't'));
    const legacyDuration = Number(attributeValue(attributes, 'd'));
    const startMs = Number.isFinite(beginMs) ? beginMs : (Number.isFinite(legacyStart) ? legacyStart : NaN);
    if (!Number.isFinite(startMs)) continue;
    const durationMs = Number.isFinite(endMs) && endMs > startMs
      ? endMs - startMs
      : (Number.isFinite(durMs) && durMs > 0 ? durMs : (Number.isFinite(legacyDuration) ? legacyDuration : 4000));

    const rawSegments = [];
    const spanPattern = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
    let span;
    while ((span = spanPattern.exec(body))) {
      const spanAttributes = span[1] || '';
      const spanText = span[2] || '';
      let spanStart = parseTtmlTime(attributeValue(spanAttributes, 'begin'));
      let spanEnd = parseTtmlTime(attributeValue(spanAttributes, 'end'));
      const spanDur = parseTtmlTime(attributeValue(spanAttributes, 'dur'));
      if (!Number.isFinite(spanStart)) {
        const offset = Number(attributeValue(spanAttributes, 't'));
        if (Number.isFinite(offset)) spanStart = startMs + offset;
      }
      if (Number.isFinite(spanStart) && spanStart < startMs && !/:/.test(attributeValue(spanAttributes, 'begin'))) {
        spanStart += startMs;
      }
      if (!Number.isFinite(spanEnd) && Number.isFinite(spanStart) && Number.isFinite(spanDur)) spanEnd = spanStart + spanDur;
      if (Number.isFinite(spanEnd) && spanEnd < startMs && !/:/.test(attributeValue(spanAttributes, 'end'))) {
        spanEnd += startMs;
      }
      rawSegments.push({ text: spanText, startMs: spanStart, endMs: spanEnd });
    }

    const fallbackText = body.replace(/<br\s*\/?>/gi, '\n');
    const line = makeLine(startMs, durationMs, rawSegments, fallbackText, 'ttml');
    if (line) lines.push(line);
  }

  return finalizeLines(lines);
}

const NON_LYRIC_CUE = /^(?:[\[(（【]?\s*(?:music|instrumental|applause|cheering|laughter|intro|outro|foreign|singing|humming|vocalizing|âm nhạc|nhạc|vỗ tay|tiếng cười|dạo nhạc)\s*[\])）】]?|[♪♫♬♩\s._-]+)$/i;

function isNonLyricCueText(value) {
  const text = compactLineText(value).replace(/^[-–—]\s*/, '').trim();
  if (!text) return true;
  return NON_LYRIC_CUE.test(text);
}

function filterCaptionLyricLines(lines) {
  return (Array.isArray(lines) ? lines : []).filter((line) => line && !isNonLyricCueText(line.text));
}

function captionLooksLikeLyrics(lines) {
  const useful = filterCaptionLyricLines(lines);
  const text = useful.map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  if (useful.length >= 3 && text.length >= 30) return true;
  if (useful.length >= 2 && words.length >= 4 && text.length >= 18) return true;
  return false;
}

function parseCaptionPayload(payload, extension) {
  const ext = String(extension || '').toLowerCase();
  if (ext === 'json3') return parseJson3(payload);
  if (ext === 'srv3') return parseSrv3(payload);
  if (ext === 'ttml') return parseTtml(payload);
  if (ext === 'vtt') return parseVtt(payload);
  return [];
}

function languageBase(value) {
  return String(value || '').toLowerCase().replace(/-orig$/i, '').split(/[-_]/)[0];
}

function nameText(entry) {
  if (!entry) return '';
  if (typeof entry.name === 'string') return entry.name;
  if (entry.name && typeof entry.name.simpleText === 'string') return entry.name.simpleText;
  if (entry.name && Array.isArray(entry.name.runs)) return entry.name.runs.map((run) => run && run.text || '').join('');
  return '';
}

function captionTrackCandidates(info, options = {}) {
  const preferred = Array.isArray(options.languages) ? options.languages.map(languageBase).filter(Boolean) : [];
  const candidates = [];
  const addGroup = (group, automatic) => {
    Object.entries(group && typeof group === 'object' ? group : {}).forEach(([language, formats]) => {
      if (String(language).toLowerCase() === 'live_chat' || !Array.isArray(formats)) return;
      formats.forEach((format) => {
        const ext = String(format && format.ext || '').toLowerCase();
        const url = String(format && format.url || '').trim();
        if (!url || !FORMAT_PRIORITY[ext]) return;
        const label = nameText(format);
        const original = /(?:^|-)orig$/i.test(language) || /\boriginal\b/i.test(label);
        let score = FORMAT_PRIORITY[ext];
        if (original) score += 120;
        if (!automatic) score += 70;
        if (preferred.includes(languageBase(language))) score += 35 - preferred.indexOf(languageBase(language)) * 3;
        if (/translated|translation/i.test(label)) score -= 80;
        candidates.push({
          language,
          label,
          ext,
          url,
          automatic,
          original,
          score,
        });
      });
    });
  };

  // Original auto-captions often contain word offsets while manually uploaded
  // tracks often contain only line timing. Scoring decides the final order.
  addGroup(info && info.subtitles, false);
  addGroup(info && info.automatic_captions, true);
  return candidates.sort((a, b) => b.score - a.score || a.language.localeCompare(b.language));
}

function lineHasUsefulWordTiming(line) {
  const words = Array.isArray(line && line.words) ? line.words : [];
  if (words.length < 2) return false;
  return words.some((word, index) => index > 0 && word.startMs > words[index - 1].startMs + 20);
}

function linesToYrc(lines) {
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const startMs = Math.max(0, Math.round(Number(line.startMs) || 0));
    const durationMs = Math.max(80, Math.round(Number(line.durationMs) || Number(line.endMs) - startMs || 0));
    const words = Array.isArray(line.words) ? line.words : [];
    if (!words.length) return `[${startMs},${durationMs}]${line.text}`;
    const body = words.map((word) => {
      const wordStart = Math.max(startMs, Math.round(Number(word.startMs) || startMs));
      const wordDuration = Math.max(40, Math.round((Number(word.endMs) || wordStart + 80) - wordStart));
      return `(${wordStart},${wordDuration},0)${word.text}`;
    }).join('');
    return `[${startMs},${durationMs}]${body || line.text}`;
  }).join('\n');
}

function plainTextFromLines(lines) {
  return (Array.isArray(lines) ? lines : []).map((line) => line.text).filter(Boolean).join('\n');
}

async function readResponseText(response, limit = MAX_CAPTION_BYTES) {
  const contentLength = Number(response && response.headers && response.headers.get && response.headers.get('content-length') || 0);
  if (contentLength > limit) throw new Error('YouTube caption response is too large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) throw new Error('YouTube caption response is too large');
  return bytes.toString('utf8');
}

function createProvider(options = {}) {
  const cache = new Map();
  const ttlMs = Number(options.cacheTtlMs || DEFAULT_CACHE_TTL);

  async function fetchForVideo(videoId, context = {}) {
    const id = String(videoId || '').trim();
    if (!id) return null;
    const cached = cache.get(id);
    if (cached && Date.now() - cached.at < ttlMs) return cached.value;

    const getInfo = context.getInfo || options.getInfo;
    const fetchImpl = context.fetchImpl || options.fetchImpl || global.fetch;
    if (typeof getInfo !== 'function' || typeof fetchImpl !== 'function') return null;

    let info;
    try { info = await getInfo(id); } catch (error) {
      if (context.log !== false) console.warn('[YouTubeCaptions] yt-dlp metadata unavailable:', error.message || String(error));
      cache.set(id, { at: Date.now(), value: null });
      return null;
    }

    const languages = context.languages || options.languages || [];
    const tracks = captionTrackCandidates(info, { languages }).slice(0, 12);
    let bestLineTimed = null;

    for (const track of tracks) {
      try {
        const response = await fetchImpl(track.url, {
          redirect: 'follow',
          headers: {
            'User-Agent': context.userAgent || options.userAgent || 'ShinaYuu Music',
            Accept: track.ext === 'json3' ? 'application/json,text/plain,*/*' : 'text/plain,application/xml,*/*',
            ...(info && info.http_headers || {}),
          },
        });
        if (!response || !response.ok) continue;
        const payload = await readResponseText(response);
        const parsedLines = parseCaptionPayload(payload, track.ext);
        const lines = filterCaptionLyricLines(parsedLines);
        if (!lines.length || !captionLooksLikeLyrics(lines)) continue;

        const wordSynced = lines.some(lineHasUsefulWordTiming);
        const result = {
          lyric: '',
          tlyric: '',
          yrc: linesToYrc(lines),
          plainLyric: plainTextFromLines(lines),
          source: `youtube-captions-${track.ext}`,
          exactVideoTiming: true,
          caption: {
            language: track.language,
            label: track.label,
            automatic: !!track.automatic,
            original: !!track.original,
            format: track.ext,
            wordSynced,
            lineCount: lines.length,
          },
        };
        if (wordSynced) {
          cache.set(id, { at: Date.now(), value: result });
          return result;
        }
        if (!bestLineTimed) bestLineTimed = result;
      } catch (error) {
        if (context.log !== false) console.warn('[YouTubeCaptions] Track failed:', track.language, track.ext, error.message || String(error));
      }
    }

    cache.set(id, { at: Date.now(), value: bestLineTimed });
    return bestLineTimed;
  }

  function clearCache() {
    cache.clear();
  }

  return { fetchForVideo, clearCache };
}

module.exports = {
  parseJson3,
  parseSrv3,
  parseTtml,
  parseVtt,
  parseCaptionPayload,
  captionTrackCandidates,
  lineHasUsefulWordTiming,
  linesToYrc,
  plainTextFromLines,
  isNonLyricCueText,
  filterCaptionLyricLines,
  captionLooksLikeLyrics,
  createProvider,
};
