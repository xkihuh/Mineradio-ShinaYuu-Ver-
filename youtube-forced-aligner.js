'use strict';

/**
 * Local YouTube lyric forced-alignment service for ShinaYuu Music.
 *
 * The renderer is intentionally not involved. The service combines a trusted
 * lyric transcript (normally LRCLIB) with word timestamps generated locally by
 * whisper.cpp, then converts the result to the YRC structure already consumed
 * by the current lyric renderer. UI, UX, Desktop Lyrics, camera, particles,
 * transitions, and playback clocks remain unchanged.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const WHISPER_VERSION = 'v1.9.1';
const WHISPER_WINDOWS_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`;
const WHISPER_WINDOWS_SHA256 = '7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539';
const WHISPER_MODEL_NAME = 'ggml-base-q5_1.bin';
const WHISPER_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_NAME}?download=true`;
const WHISPER_MODEL_SHA256 = '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898';
const CACHE_SCHEMA = 1;
const DEFAULT_RETRY_AFTER_MS = 10 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const WORD_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeUnlink(file) {
  try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function readJson(file, fallback = null) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, JSON.stringify(value), 'utf8');
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
  fs.renameSync(temporary, file);
}

function commandExists(command) {
  try {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    const output = execFileSync(checker, [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    return String(output || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  } catch (_) {
    return '';
  }
}

function runChild(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const maxOutput = Number(options.maxOutput || 64 * 1024 * 1024);
    const timeoutMs = Number(options.timeoutMs || 20 * 60 * 1000);
    let stdout = '';
    let stderr = '';
    let completed = false;
    const timer = setTimeout(() => {
      if (completed) return;
      completed = true;
      try { child.kill(); } catch (_) {}
      const error = new Error(`Process timed out after ${timeoutMs} ms`);
      error.code = 'PROCESS_TIMEOUT';
      reject(error);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < maxOutput) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < maxOutput) stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr, code });
      const error = new Error((stderr || stdout || `Process exited with ${code}`).trim());
      error.code = `PROCESS_EXIT_${code}`;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function downloadVerified(url, target, expectedSha256, options = {}) {
  ensureDir(path.dirname(target));
  const partial = `${target}.download`;
  safeUnlink(partial);
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable');
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': options.userAgent || 'ShinaYuu Music',
      Accept: 'application/octet-stream,*/*',
    },
  });
  if (!response || !response.ok) throw new Error(`Download failed with HTTP ${response && response.status}`);
  const declared = Number(response.headers && response.headers.get && response.headers.get('content-length') || 0);
  const maxBytes = Number(options.maxBytes || MAX_DOWNLOAD_BYTES);
  if (declared > maxBytes) throw new Error('Download is larger than the allowed limit');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error('Download is larger than the allowed limit');
  const digest = sha256Buffer(bytes);
  if (expectedSha256 && digest.toLowerCase() !== String(expectedSha256).toLowerCase()) {
    throw new Error(`Checksum mismatch for ${path.basename(target)}`);
  }
  fs.writeFileSync(partial, bytes);
  try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch (_) {}
  fs.renameSync(partial, target);
  return target;
}

function findFileRecursive(root, names) {
  const wanted = new Set((Array.isArray(names) ? names : [names]).map((name) => String(name).toLowerCase()));
  if (!root || !fs.existsSync(root)) return '';
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isFile() && wanted.has(entry.name.toLowerCase())) return full;
      if (entry.isDirectory()) queue.push(full);
    }
  }
  return '';
}

function normalizeToken(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}']/gu, '')
    .trim();
}

function foldToken(value) {
  return normalizeToken(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

function tokenizeText(text) {
  const source = String(text || '');
  const tokens = [];
  WORD_RE.lastIndex = 0;
  let match;
  while ((match = WORD_RE.exec(source))) {
    const raw = match[0];
    const norm = normalizeToken(raw);
    if (!norm) continue;
    tokens.push({
      text: raw,
      c0: match.index,
      c1: match.index + raw.length,
      norm,
      fold: foldToken(raw),
    });
  }
  return tokens;
}

function levenshtein(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = new Uint16Array(right.length + 1);
  const current = new Uint16Array(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) previous[j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous.set(current);
  }
  return previous[right.length];
}

function tokenSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a.norm === b.norm) return 1;
  if (a.fold && a.fold === b.fold) return 0.96;
  const left = a.fold || a.norm;
  const right = b.fold || b.norm;
  if (!left || !right) return 0;
  if (Math.min(left.length, right.length) >= 4 && (left.includes(right) || right.includes(left))) return 0.82;
  const distance = levenshtein(left, right);
  return clamp(1 - distance / Math.max(left.length, right.length), 0, 1);
}

function parseClockSeconds(value) {
  const match = String(value || '').trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!match) return NaN;
  return (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0) + (Number(match[4]) || 0) / 1000;
}

function parseWhisperConsole(text) {
  const output = [];
  const pattern = /\[((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\]\s*(.*)$/gm;
  let match;
  while ((match = pattern.exec(String(text || '')))) {
    const start = parseClockSeconds(match[1]);
    const end = parseClockSeconds(match[2]);
    const rawText = String(match[3] || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !rawText) continue;
    if (/^\[(?:blank_audio|music|silence|applause|inaudible)\]$/i.test(rawText)) continue;
    const subtokens = tokenizeText(rawText);
    if (!subtokens.length) continue;
    const totalWeight = subtokens.reduce((sum, item) => sum + Math.max(1, item.text.length), 0);
    let cursor = start;
    subtokens.forEach((item, index) => {
      const weight = Math.max(1, item.text.length) / totalWeight;
      const tokenEnd = index === subtokens.length - 1 ? end : cursor + (end - start) * weight;
      output.push({
        text: item.text,
        norm: item.norm,
        fold: item.fold,
        start: cursor,
        end: Math.max(cursor + 0.02, tokenEnd),
      });
      cursor = tokenEnd;
    });
  }
  return output;
}

function parseLrcOffsetSeconds(text) {
  const match = String(text || '').match(/^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/im);
  return match ? (Number(match[1]) || 0) / 1000 : 0;
}

function parseSyncedLyrics(text, durationSeconds = 0) {
  const source = String(text || '');
  const offset = parseLrcOffsetSeconds(source);
  const timestamp = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const lines = [];
  source.split(/\r?\n/).forEach((row) => {
    const times = [];
    let match;
    timestamp.lastIndex = 0;
    while ((match = timestamp.exec(row))) {
      let fraction = 0;
      if (match[3]) fraction = Number(match[3]) / Math.pow(10, Math.min(3, match[3].length));
      times.push(Math.max(0, (Number(match[1]) || 0) * 60 + (Number(match[2]) || 0) + fraction + offset));
    }
    const lineText = row.replace(timestamp, '').trim();
    if (!lineText || !times.length) return;
    times.forEach((time) => lines.push({ start: time, text: lineText }));
  });
  lines.sort((a, b) => a.start - b.start);
  lines.forEach((line, index) => {
    const next = lines[index + 1];
    line.end = next && next.start > line.start
      ? next.start
      : Math.max(line.start + 2.2, Number(durationSeconds || 0) || line.start + 4.8);
    line.end = clamp(line.end, line.start + 0.2, line.start + 15);
  });
  return lines;
}

function parsePlainLyrics(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\[(?:verse|chorus|bridge|intro|outro|hook|pre-chorus).*\]$/i.test(line))
    .map((line) => ({ start: NaN, end: NaN, text: line }));
}

function buildLyricTokenList(lines) {
  const tokens = [];
  lines.forEach((line, lineIndex) => {
    line.tokens = tokenizeText(line.text);
    line.tokens.forEach((token, wordIndex) => {
      tokens.push({ ...token, lineIndex, wordIndex, matchIndex: -1, similarity: 0 });
    });
  });
  return tokens;
}

function alignTokenSequences(lyrics, transcript) {
  const n = lyrics.length;
  const m = transcript.length;
  if (!n || !m) return { pairs: [], coverage: 0, averageSimilarity: 0 };
  const width = m + 1;
  const scores = new Float32Array((n + 1) * width);
  const steps = new Uint8Array((n + 1) * width);
  const lyricGap = -0.72;
  const transcriptGap = -0.48;
  for (let i = 1; i <= n; i += 1) {
    scores[i * width] = scores[(i - 1) * width] + lyricGap;
    steps[i * width] = 2;
  }
  for (let j = 1; j <= m; j += 1) {
    scores[j] = scores[j - 1] + transcriptGap;
    steps[j] = 3;
  }

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const similarity = tokenSimilarity(lyrics[i - 1], transcript[j - 1]);
      const diagonal = scores[(i - 1) * width + j - 1] + (similarity >= 0.5 ? 3.2 * similarity : -1.35);
      const up = scores[(i - 1) * width + j] + lyricGap;
      const left = scores[i * width + j - 1] + transcriptGap;
      const index = i * width + j;
      if (diagonal >= up && diagonal >= left) {
        scores[index] = diagonal;
        steps[index] = 1;
      } else if (up >= left) {
        scores[index] = up;
        steps[index] = 2;
      } else {
        scores[index] = left;
        steps[index] = 3;
      }
    }
  }

  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = steps[i * width + j];
    if (step === 1) {
      const similarity = tokenSimilarity(lyrics[i - 1], transcript[j - 1]);
      if (similarity >= 0.54) pairs.push({ lyricIndex: i - 1, transcriptIndex: j - 1, similarity });
      i -= 1;
      j -= 1;
    } else if (step === 2 && i > 0) {
      i -= 1;
    } else if (j > 0) {
      j -= 1;
    } else {
      break;
    }
  }
  pairs.reverse();
  const averageSimilarity = pairs.length ? pairs.reduce((sum, pair) => sum + pair.similarity, 0) / pairs.length : 0;
  return { pairs, coverage: pairs.length / Math.max(1, n), averageSimilarity };
}

function weightedBoundaries(tokens, start, end) {
  const total = tokens.reduce((sum, token) => sum + Math.max(1, String(token.text || '').length), 0) || tokens.length || 1;
  let cursor = start;
  return tokens.map((token, index) => {
    const fraction = Math.max(1, String(token.text || '').length) / total;
    const tokenEnd = index === tokens.length - 1 ? end : cursor + (end - start) * fraction;
    const value = { start: cursor, end: Math.max(cursor + 0.04, tokenEnd) };
    cursor = tokenEnd;
    return value;
  });
}

function fillLineWordTimes(line, transcript, defaultStart, defaultEnd) {
  const tokens = Array.isArray(line.tokens) ? line.tokens : [];
  if (!tokens.length) return [];
  const known = tokens
    .map((token, index) => ({ index, token, transcript: token.matchIndex >= 0 ? transcript[token.matchIndex] : null }))
    .filter((item) => item.transcript);
  const lineStart = Number.isFinite(line.start) ? line.start : (known[0] ? known[0].transcript.start : defaultStart);
  const lineEndCandidate = Number.isFinite(line.end) ? line.end : (known.length ? known[known.length - 1].transcript.end + 0.35 : defaultEnd);
  const lineEnd = Math.max(lineStart + 0.25, lineEndCandidate);
  const times = new Array(tokens.length);

  known.forEach((item) => {
    times[item.index] = {
      start: clamp(item.transcript.start, lineStart, lineEnd - 0.02),
      end: clamp(item.transcript.end, lineStart + 0.02, lineEnd),
      matched: true,
    };
  });

  const anchors = [{ index: -1, time: lineStart }];
  known.forEach((item) => anchors.push({ index: item.index, time: times[item.index].start }));
  anchors.push({ index: tokens.length, time: lineEnd });
  for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex += 1) {
    const left = anchors[anchorIndex];
    const right = anchors[anchorIndex + 1];
    const first = left.index + 1;
    const last = right.index - 1;
    if (first > last) continue;
    const slice = tokens.slice(first, last + 1);
    const generated = weightedBoundaries(slice, left.time, right.time);
    generated.forEach((item, offset) => {
      const index = first + offset;
      if (!times[index]) times[index] = { ...item, matched: false };
    });
  }

  for (let index = 0; index < times.length; index += 1) {
    if (!times[index]) times[index] = { start: lineStart, end: lineEnd, matched: false };
    if (index > 0) times[index].start = Math.max(times[index].start, times[index - 1].start + 0.01);
    const nextStart = index + 1 < times.length ? times[index + 1] && times[index + 1].start : lineEnd;
    times[index].end = Math.max(times[index].start + 0.04, Math.min(times[index].end, Number.isFinite(nextStart) ? nextStart : lineEnd, lineEnd));
  }

  return tokens.map((token, index) => ({ ...token, ...times[index] }));
}

function attachSegmentText(lineText, timedWords) {
  let previousEnd = 0;
  return timedWords.map((word, index) => {
    const endIndex = index === timedWords.length - 1 ? lineText.length : word.c1;
    const text = lineText.slice(previousEnd, endIndex);
    const segment = { ...word, text: text || word.text, c0: previousEnd, c1: endIndex };
    previousEnd = endIndex;
    return segment;
  });
}

function buildAlignedLines(rawLines, transcriptWords, durationSeconds = 0) {
  const lines = rawLines.map((line) => ({ ...line }));
  const lyricTokens = buildLyricTokenList(lines);
  const alignment = alignTokenSequences(lyricTokens, transcriptWords);
  alignment.pairs.forEach((pair) => {
    lyricTokens[pair.lyricIndex].matchIndex = pair.transcriptIndex;
    lyricTokens[pair.lyricIndex].similarity = pair.similarity;
  });
  lyricTokens.forEach((token) => {
    const lineToken = lines[token.lineIndex].tokens[token.wordIndex];
    lineToken.matchIndex = token.matchIndex;
    lineToken.similarity = token.similarity;
  });

  let fallbackCursor = 0;
  const totalLines = Math.max(1, lines.length);
  const targetDuration = Math.max(Number(durationSeconds || 0), transcriptWords.length ? transcriptWords[transcriptWords.length - 1].end : 0, totalLines * 3.2);
  lines.forEach((line, index) => {
    const defaultStart = Number.isFinite(line.start) ? line.start : fallbackCursor;
    const defaultEnd = Number.isFinite(line.end)
      ? line.end
      : targetDuration * (index + 1) / totalLines;
    const timed = fillLineWordTimes(line, transcriptWords, defaultStart, defaultEnd);
    const words = attachSegmentText(line.text, timed);
    const matched = words.filter((word) => word.matched);
    const start = Number.isFinite(line.start)
      ? line.start
      : (matched[0] ? Math.max(0, matched[0].start - 0.08) : defaultStart);
    const end = Number.isFinite(line.end)
      ? line.end
      : (matched.length ? matched[matched.length - 1].end + 0.16 : defaultEnd);
    line.start = Math.max(0, start);
    line.end = Math.max(line.start + 0.25, end);
    line.words = words.map((word) => ({
      text: word.text,
      start: clamp(word.start, line.start, line.end - 0.02),
      end: clamp(word.end, line.start + 0.02, line.end),
      c0: word.c0,
      c1: word.c1,
      matched: !!word.matched,
    }));
    fallbackCursor = line.end;
  });

  return {
    lines,
    coverage: alignment.coverage,
    averageSimilarity: alignment.averageSimilarity,
    matchedWords: alignment.pairs.length,
    totalWords: lyricTokens.length,
  };
}

function linesToYrc(lines) {
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const startMs = Math.max(0, Math.round(Number(line.start) * 1000 || 0));
    const endMs = Math.max(startMs + 80, Math.round(Number(line.end) * 1000 || startMs + 4800));
    const durationMs = endMs - startMs;
    const words = Array.isArray(line.words) ? line.words : [];
    if (!words.length) return `[${startMs},${durationMs}]${line.text}`;
    const body = words.map((word) => {
      const wordStartMs = clamp(Math.round(Number(word.start) * 1000 || startMs), startMs, endMs - 40);
      const wordEndMs = clamp(Math.round(Number(word.end) * 1000 || wordStartMs + 80), wordStartMs + 40, endMs);
      return `(${wordStartMs},${wordEndMs - wordStartMs},0)${word.text}`;
    }).join('');
    return `[${startMs},${durationMs}]${body || line.text}`;
  }).join('\n');
}

function alignedResultToPayload(aligned, input = {}) {
  const lines = aligned.lines || [];
  return {
    lyric: String(input.syncedLyric || ''),
    tlyric: '',
    yrc: linesToYrc(lines),
    plainLyric: lines.map((line) => line.text).join('\n'),
    source: aligned.coverage >= 0.18 ? 'youtube-forced-alignment' : 'youtube-lrclib-estimated-word',
    exactVideoTiming: aligned.coverage >= 0.18,
    forcedAlignment: {
      engine: 'whisper.cpp',
      model: WHISPER_MODEL_NAME,
      coverage: Number(aligned.coverage.toFixed(4)),
      averageSimilarity: Number(aligned.averageSimilarity.toFixed(4)),
      matchedWords: aligned.matchedWords,
      totalWords: aligned.totalWords,
      lineCount: lines.length,
    },
  };
}

function cacheKey(videoId, input = {}) {
  const lyricText = String(input.syncedLyric || input.plainLyric || '');
  return `${String(videoId || '').replace(/[^A-Za-z0-9_-]/g, '_')}-${sha256Text(lyricText).slice(0, 16)}`;
}

function publicStatus(status) {
  if (!status) return { status: 'idle' };
  return {
    status: status.status,
    stage: status.stage || '',
    message: status.message || '',
    startedAt: status.startedAt || 0,
    updatedAt: status.updatedAt || 0,
  };
}

function createProvider(options = {}) {
  const appData = typeof options.appDataDir === 'function' ? options.appDataDir : () => String(options.appDataDir || process.cwd());
  const jobs = new Map();
  const statuses = new Map();
  const retryAfterMs = Number(options.retryAfterMs || DEFAULT_RETRY_AFTER_MS);
  const childRunner = options.runChild || runChild;

  function rootDir() {
    return ensureDir(path.join(appData(), 'youtube-forced-alignment'));
  }

  function cacheFileFor(key) {
    return path.join(rootDir(), 'cache', `${key}.json`);
  }

  function setStatus(key, next) {
    const previous = statuses.get(key) || {};
    const value = {
      ...previous,
      ...next,
      updatedAt: Date.now(),
      startedAt: previous.startedAt || next.startedAt || Date.now(),
    };
    statuses.set(key, value);
    return value;
  }

  async function prepareWhisper() {
    if (typeof options.prepareWhisper === 'function') return options.prepareWhisper();
    const configured = String(process.env.WHISPER_CPP_PATH || '').trim();
    if (configured && fs.existsSync(configured)) return configured;
    const targetRoot = ensureDir(path.join(rootDir(), 'tools', `whisper-${WHISPER_VERSION}`));
    let executable = findFileRecursive(targetRoot, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
    if (executable) return executable;
    if (process.platform !== 'win32') {
      executable = commandExists('whisper-cli');
      if (executable) return executable;
      throw new Error('whisper.cpp automatic setup is currently available on Windows only');
    }
    const archive = path.join(targetRoot, 'whisper-bin-x64.zip');
    if (!fs.existsSync(archive) || sha256Buffer(fs.readFileSync(archive)) !== WHISPER_WINDOWS_SHA256) {
      await downloadVerified(WHISPER_WINDOWS_URL, archive, WHISPER_WINDOWS_SHA256, {
        fetchImpl: options.fetchImpl,
        userAgent: options.userAgent,
        maxBytes: 32 * 1024 * 1024,
      });
    }
    const extracted = ensureDir(path.join(targetRoot, 'runtime'));
    const extractZip = require('extract-zip');
    await extractZip(archive, { dir: extracted });
    executable = findFileRecursive(extracted, 'whisper-cli.exe');
    if (!executable) throw new Error('whisper-cli.exe was not found after extraction');
    return executable;
  }

  async function prepareModel() {
    if (typeof options.prepareModel === 'function') return options.prepareModel();
    const configured = String(process.env.WHISPER_MODEL_PATH || '').trim();
    if (configured && fs.existsSync(configured)) return configured;
    const target = path.join(rootDir(), 'models', WHISPER_MODEL_NAME);
    if (fs.existsSync(target)) {
      try {
        if (sha256Buffer(fs.readFileSync(target)) === WHISPER_MODEL_SHA256) return target;
      } catch (_) {}
      safeUnlink(target);
    }
    await downloadVerified(WHISPER_MODEL_URL, target, WHISPER_MODEL_SHA256, {
      fetchImpl: options.fetchImpl,
      userAgent: options.userAgent,
      maxBytes: 128 * 1024 * 1024,
    });
    return target;
  }

  function resolveFfmpeg() {
    if (typeof options.resolveFfmpeg === 'function') return options.resolveFfmpeg();
    const configured = String(process.env.FFMPEG_PATH || '').trim();
    if (configured && fs.existsSync(configured)) return configured;
    try {
      const binary = require('ffmpeg-static');
      if (binary && fs.existsSync(binary)) return binary;
    } catch (_) {}
    return commandExists(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') || commandExists('ffmpeg');
  }

  async function downloadAudio(videoId, workDir, context = {}) {
    if (typeof options.downloadAudio === 'function') return options.downloadAudio(videoId, workDir, context);
    const engine = await context.getYtDlpEngine();
    const executable = engine && engine.executable;
    if (!executable) throw new Error('yt-dlp is unavailable');
    ensureDir(workDir);
    for (const file of fs.readdirSync(workDir)) safeUnlink(path.join(workDir, file));
    const template = path.join(workDir, 'source.%(ext)s');
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      '--force-overwrites',
      '--socket-timeout', '20',
      '--retries', '2',
      '--fragment-retries', '2',
      '--format', 'bestaudio/best',
      '--output', template,
    ];
    const nodeRuntime = typeof context.findNodeRuntime === 'function' ? context.findNodeRuntime() : '';
    if (nodeRuntime) args.push('--js-runtimes', `node:${nodeRuntime}`);
    args.push(`https://www.youtube.com/watch?v=${encodeURIComponent(String(videoId || ''))}`);
    await childRunner(executable, args, { cwd: workDir, timeoutMs: 3 * 60 * 1000, maxOutput: 16 * 1024 * 1024 });
    const input = fs.readdirSync(workDir)
      .map((name) => path.join(workDir, name))
      .find((file) => fs.statSync(file).isFile() && !/\.part$/i.test(file));
    if (!input) throw new Error('yt-dlp did not create an audio file');
    return input;
  }

  async function convertToWhisperWav(input, workDir) {
    if (typeof options.convertToWhisperWav === 'function') return options.convertToWhisperWav(input, workDir);
    const ffmpeg = resolveFfmpeg();
    if (!ffmpeg) throw new Error('FFmpeg is unavailable');
    const output = path.join(workDir, 'whisper-input.wav');
    safeUnlink(output);
    await childRunner(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
      output,
    ], { cwd: workDir, timeoutMs: 3 * 60 * 1000, maxOutput: 8 * 1024 * 1024 });
    if (!fs.existsSync(output) || fs.statSync(output).size < 44) throw new Error('FFmpeg did not create a valid WAV file');
    return output;
  }

  async function transcribe(wavFile, language, whisperExecutable, modelPath, workDir) {
    if (typeof options.transcribe === 'function') return options.transcribe(wavFile, language, whisperExecutable, modelPath, workDir);
    const threads = clamp(Math.floor(Number(process.env.WHISPER_THREADS || 0)) || Math.max(2, Math.min(8, require('os').cpus().length - 1)), 1, 16);
    const args = [
      '-m', modelPath,
      '-f', wavFile,
      '-ml', '1',
      '-t', String(threads),
      '-l', String(language || 'auto'),
    ];
    const result = await childRunner(whisperExecutable, args, {
      cwd: workDir,
      timeoutMs: 20 * 60 * 1000,
      maxOutput: 96 * 1024 * 1024,
    });
    const words = parseWhisperConsole(`${result.stdout || ''}\n${result.stderr || ''}`);
    if (!words.length) throw new Error('whisper.cpp returned no timed words');
    return words;
  }

  async function runAlignment(videoId, input, context, key) {
    const synced = parseSyncedLyrics(input.syncedLyric, input.duration);
    const lines = synced.length ? synced : parsePlainLyrics(input.plainLyric);
    if (!lines.length) throw new Error('No lyric transcript is available for forced alignment');
    const workDir = ensureDir(path.join(rootDir(), 'work', key));
    setStatus(key, { status: 'processing', stage: 'preparing', message: 'Preparing local alignment engine' });
    const [whisperExecutable, modelPath] = await Promise.all([prepareWhisper(), prepareModel()]);
    setStatus(key, { status: 'processing', stage: 'downloading_audio', message: 'Downloading YouTube audio for local analysis' });
    const audio = await downloadAudio(videoId, workDir, context);
    setStatus(key, { status: 'processing', stage: 'converting_audio', message: 'Converting audio to 16 kHz mono WAV' });
    const wav = await convertToWhisperWav(audio, workDir);
    setStatus(key, { status: 'processing', stage: 'transcribing', message: 'Generating local word timestamps' });
    const transcript = await transcribe(wav, input.language || 'auto', whisperExecutable, modelPath, workDir);
    setStatus(key, { status: 'processing', stage: 'aligning', message: 'Aligning lyric text to the YouTube audio' });
    const aligned = buildAlignedLines(lines, transcript, input.duration);
    const payload = alignedResultToPayload(aligned, input);
    const record = {
      schema: CACHE_SCHEMA,
      createdAt: Date.now(),
      videoId: String(videoId),
      lyricHash: sha256Text(input.syncedLyric || input.plainLyric || ''),
      payload,
    };
    writeJsonAtomic(cacheFileFor(key), record);
    setStatus(key, { status: 'ready', stage: 'ready', message: 'Word-aligned lyrics are ready' });
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
    return payload;
  }

  async function request(videoId, input = {}, context = {}) {
    const id = String(videoId || '').trim();
    if (!id) return { status: 'failed', stage: 'metadata', message: 'YouTube Video ID is missing' };
    const key = cacheKey(id, input);
    const cached = readJson(cacheFileFor(key), null);
    if (cached && cached.schema === CACHE_SCHEMA && cached.payload && cached.lyricHash === sha256Text(input.syncedLyric || input.plainLyric || '')) {
      setStatus(key, { status: 'ready', stage: 'cache', message: 'Loaded cached word-aligned lyrics' });
      return { status: 'ready', result: cached.payload, key };
    }
    const current = statuses.get(key);
    if (current && current.status === 'failed' && Date.now() - current.updatedAt < retryAfterMs) {
      return { ...publicStatus(current), key };
    }
    if (!jobs.has(key)) {
      const promise = runAlignment(id, input, context, key)
        .catch((error) => {
          setStatus(key, {
            status: 'failed',
            stage: statuses.get(key) && statuses.get(key).stage || 'failed',
            message: error && error.message || String(error),
          });
          return null;
        })
        .finally(() => jobs.delete(key));
      jobs.set(key, promise);
    }
    return { ...publicStatus(statuses.get(key) || setStatus(key, { status: 'processing', stage: 'queued', message: 'Queued local forced alignment' })), key };
  }

  async function waitFor(videoId, input = {}, context = {}) {
    const first = await request(videoId, input, context);
    if (first.status === 'ready' || first.status === 'failed') return first;
    const job = jobs.get(first.key);
    if (job) await job;
    return request(videoId, input, context);
  }

  function clearCache() {
    try { fs.rmSync(path.join(rootDir(), 'cache'), { recursive: true, force: true }); } catch (_) {}
    statuses.clear();
  }

  return { request, waitFor, clearCache };
}

module.exports = {
  WHISPER_VERSION,
  WHISPER_MODEL_NAME,
  normalizeToken,
  foldToken,
  tokenizeText,
  tokenSimilarity,
  parseWhisperConsole,
  parseSyncedLyrics,
  parsePlainLyrics,
  alignTokenSequences,
  buildAlignedLines,
  linesToYrc,
  alignedResultToPayload,
  createProvider,
};
