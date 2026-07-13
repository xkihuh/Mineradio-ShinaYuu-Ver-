'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const UA = 'ShinaYuu Music/1.1.3';
const CONFIG_FILE = process.env.MUSIC_SOURCE_CONFIG_FILE || path.join(__dirname, '.music-sources.json');
const TOKEN_FILE = process.env.SPOTIFY_TOKEN_FILE || path.join(__dirname, '.spotify-token.json');
const LRCLIB_BASE = 'https://lrclib.net/api';
// Spotify does not publish a lyrics endpoint in the public Web API. This
// compatibility bridge mirrors the timed-lyrics response used by Spotify's
// own web player. It is deliberately isolated and always falls back to
// LRCLIB when Spotify rejects or changes the response.
const SPOTIFY_LYRICS_BASE = 'https://spclient.wg.spotify.com/color-lyrics/v2/track';
const lyricSync = require('./public/lyrics-sync');
const youtubeCaptions = require('./youtube-caption-provider');
const youtubeForcedAligner = require('./youtube-forced-aligner');

const spotifyTrackCache = new Map();
const youtubePodcastCache = new Map();
const youtubeTrackCache = new Map();
const youtubeSearchCache = new Map();
const spotifyAuthRequests = new Map();
const spotifyAuthResults = new Map();
const spotifyAudioAnalysisCache = new Map();
const spotifyLyricsCache = new Map();
const youtubeMusicLyricsCache = new Map();
const youtubeStreamTokens = new Map();
const youtubeYtDlpInfoCache = new Map();
const youtubeCaptionService = youtubeCaptions.createProvider({ userAgent: UA });
const youtubeForcedAlignmentService = youtubeForcedAligner.createProvider({
  appDataDir,
  runChild,
  userAgent: UA,
});
let youtubeClientPromise = null;
let youtubeEnginePreparePromise = null;
let youtubeEngineLastStatus = { ready: false, engine: 'yt-dlp', message: 'not_prepared' };
let spotifyRefreshPromise = null;
let spotifyProfilePromise = null;
let spotifyProfileRetryTimer = null;
let spotifyRateLimitUntil = 0;

const SPOTIFY_AUTH_TTL = 15 * 60 * 1000;
const SPOTIFY_PROFILE_RETRY_FALLBACK = 15 * 1000;
const SPOTIFY_REQUEST_TIMEOUT = 15 * 1000;

const YTDLP_VERSION = '2026.07.04';
const YTDLP_WINDOWS_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp.exe`;
const YTDLP_WINDOWS_SHA256 = '52fe3c26dcf71fbdc85b528589020bb0b8e383155cfa81b64dd447bbe35e24b8';
const STREAM_TOKEN_TTL = 12 * 60 * 1000;


function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.warn('[MusicProviders] write failed:', file, error.message);
    return false;
  }
}

function providerConfig() {
  const stored = readJson(CONFIG_FILE, {});
  return {
    spotifyClientId: String(process.env.SPOTIFY_CLIENT_ID || stored.spotifyClientId || '').trim(),
    spotifyMarket: String(process.env.SPOTIFY_MARKET || stored.spotifyMarket || 'VN').trim().toUpperCase(),
    language: String(stored.language || 'vi').trim().toLowerCase() === 'en' ? 'en' : 'vi',
  };
}

function updateProviderConfig(input) {
  const previous = providerConfig();
  const next = {
    spotifyClientId: String(input && input.spotifyClientId != null ? input.spotifyClientId : previous.spotifyClientId).trim(),
    spotifyMarket: String(input && input.spotifyMarket != null ? input.spotifyMarket : previous.spotifyMarket).trim().toUpperCase() || 'VN',
    language: String(input && input.language != null ? input.language : previous.language).trim().toLowerCase() === 'en' ? 'en' : 'vi',
  };
  writeJson(CONFIG_FILE, next);
  if (previous.spotifyClientId !== next.spotifyClientId) {
    clearSpotifyToken();
  }
  return publicProviderConfig(next);
}


function spotifyRedirectUri(baseUrl = '') {
  const configured = String(process.env.SPOTIFY_REDIRECT_URI || '').trim();
  if (configured) return configured;
  let port = Number(process.env.PORT || 43821) || 43821;
  try {
    const parsed = new URL(baseUrl || `http://127.0.0.1:${port}`);
    port = Number(parsed.port || port) || port;
  } catch (_) {}
  // Spotify requires an exact redirect URI match. Always use the loopback IP,
  // never localhost, so the value shown in the app is stable and copyable.
  return `http://127.0.0.1:${port}/api/spotify/callback`;
}

function appDataDir() {
  return String(process.env.SHINAYUU_DATA_DIR || path.dirname(CONFIG_FILE) || __dirname);
}

function youtubeToolsDir() {
  return path.join(appDataDir(), 'tools');
}

function cleanYoutubeStreamTokens() {
  const now = Date.now();
  for (const [token, item] of youtubeStreamTokens) {
    if (!item || Number(item.expiresAt || 0) <= now) youtubeStreamTokens.delete(token);
  }
}

function saveYoutubeStreamDescriptor(descriptor) {
  cleanYoutubeStreamTokens();
  const token = randomUrlSafe(24);
  youtubeStreamTokens.set(token, {
    ...descriptor,
    expiresAt: Date.now() + STREAM_TOKEN_TTL,
  });
  return token;
}

function getYouTubeStreamDescriptor(token) {
  cleanYoutubeStreamTokens();
  const item = youtubeStreamTokens.get(String(token || ''));
  if (!item) return null;
  return { ...item };
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function commandExists(command) {
  try {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    const output = execFileSync(checker, [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return String(output || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  } catch (_) {
    return '';
  }
}

function findNodeRuntime() {
  const candidates = [
    process.env.SHINAYUU_NODE_PATH,
    process.env.npm_node_execpath,
    process.env.NODE,
    commandExists(process.platform === 'win32' ? 'node.exe' : 'node'),
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return candidates.find((value) => fs.existsSync(value)) || '';
}

function ytDlpCandidatePaths() {
  const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  return [
    String(process.env.YTDLP_PATH || '').trim(),
    path.join(youtubeToolsDir(), name),
    commandExists(name),
    commandExists('yt-dlp'),
  ].filter(Boolean);
}

async function downloadYtDlpWindows(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.download`;
  const response = await fetch(YTDLP_WINDOWS_URL, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'application/octet-stream' },
  });
  if (!response.ok) throw new Error(`yt-dlp download HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(partial, bytes);
  const digest = sha256File(partial);
  if (digest.toLowerCase() !== YTDLP_WINDOWS_SHA256.toLowerCase()) {
    try { fs.unlinkSync(partial); } catch (_) {}
    throw new Error('yt-dlp checksum verification failed');
  }
  try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch (_) {}
  fs.renameSync(partial, target);
  return target;
}

function runChild(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const cwd = options.cwd || appDataDir();
    try { fs.mkdirSync(cwd, { recursive: true }); } catch (_) {}
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
      cwd,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const max = Number(options.maxOutput || 12 * 1024 * 1024);
    const timeoutMs = Number(options.timeoutMs || 45000);
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      const error = new Error(`Process timed out after ${timeoutMs} ms`);
      error.code = 'PROCESS_TIMEOUT';
      reject(error);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > max) {
        try { child.kill(); } catch (_) {}
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
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

async function prepareYouTubeEngine() {
  if (youtubeEnginePreparePromise) return youtubeEnginePreparePromise;
  youtubeEnginePreparePromise = (async () => {
    let executable = ytDlpCandidatePaths().find((candidate) => {
      try { return fs.existsSync(candidate) && fs.statSync(candidate).isFile(); } catch (_) { return false; }
    });
    if (!executable && process.platform === 'win32') {
      executable = await downloadYtDlpWindows(path.join(youtubeToolsDir(), 'yt-dlp.exe'));
    }
    if (!executable) {
      const error = new Error('yt-dlp is not installed. Set YTDLP_PATH or install yt-dlp.');
      error.code = 'YTDLP_NOT_FOUND';
      throw error;
    }
    const versionResult = await runChild(executable, ['--version'], { timeoutMs: 15000, maxOutput: 1024 * 64 });
    const nodeRuntime = findNodeRuntime();
    youtubeEngineLastStatus = {
      ready: true,
      engine: 'yt-dlp',
      executable,
      version: String(versionResult.stdout || '').trim(),
      nodeRuntime,
      message: nodeRuntime ? 'ready' : 'ready_without_node_runtime',
    };
    return youtubeEngineLastStatus;
  })().catch((error) => {
    youtubeEngineLastStatus = { ready: false, engine: 'yt-dlp', message: error.message, code: error.code || '' };
    youtubeEnginePreparePromise = null;
    throw error;
  });
  return youtubeEnginePreparePromise;
}

function youtubeEngineStatus() {
  return { ...youtubeEngineLastStatus };
}

function cacheYouTubeYtDlpInfo(videoId, info) {
  const id = String(videoId || '').trim();
  if (!id || !info || typeof info !== 'object') return;
  youtubeYtDlpInfoCache.set(id, { at: Date.now(), info });
}

function cachedYouTubeYtDlpInfo(videoId) {
  const id = String(videoId || '').trim();
  const cached = youtubeYtDlpInfoCache.get(id);
  if (!cached || Date.now() - cached.at > 20 * 60 * 1000) {
    if (cached) youtubeYtDlpInfoCache.delete(id);
    return null;
  }
  return cached.info;
}

function ytDlpMetadataArgs(videoId) {
  const nodeRuntime = findNodeRuntime();
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '--dump-single-json',
    '--skip-download',
    '--socket-timeout', '20',
    '--retries', '2',
  ];
  if (nodeRuntime) args.push('--js-runtimes', `node:${nodeRuntime}`);
  args.push(`https://www.youtube.com/watch?v=${encodeURIComponent(String(videoId || ''))}`);
  return args;
}

async function youtubeInfoViaYtDlp(videoId) {
  const cached = cachedYouTubeYtDlpInfo(videoId);
  if (cached) return cached;
  const engine = await prepareYouTubeEngine();
  const result = await runChild(engine.executable, ytDlpMetadataArgs(videoId), {
    timeoutMs: 60000,
    maxOutput: 24 * 1024 * 1024,
  });
  let info;
  try { info = JSON.parse(result.stdout); }
  catch (_) { throw new Error('yt-dlp returned invalid YouTube metadata'); }
  cacheYouTubeYtDlpInfo(videoId, info);
  return info;
}

function ytDlpArgs(videoId, quality = '') {
  const nodeRuntime = findNodeRuntime();
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '--dump-single-json',
    '--socket-timeout', '20',
    '--retries', '2',
    '--fragment-retries', '2',
    '--format', String(quality || '').toLowerCase() === 'standard' ? 'bestaudio[abr<=160]/bestaudio/best' : 'bestaudio/best',
  ];
  if (nodeRuntime) args.push('--js-runtimes', `node:${nodeRuntime}`);
  args.push(`https://www.youtube.com/watch?v=${encodeURIComponent(String(videoId || ''))}`);
  return args;
}

async function youtubeAudioViaYtDlp(videoId, quality = '') {
  const engine = await prepareYouTubeEngine();
  const result = await runChild(engine.executable, ytDlpArgs(videoId, quality), {
    timeoutMs: 70000,
    maxOutput: 18 * 1024 * 1024,
  });
  let info;
  try { info = JSON.parse(result.stdout); }
  catch (_) { throw new Error('yt-dlp returned invalid metadata'); }
  cacheYouTubeYtDlpInfo(videoId, info);
  const selected = Array.isArray(info.requested_downloads) && info.requested_downloads[0] || info;
  const directUrl = String(selected.url || info.url || '').trim();
  if (!directUrl) throw new Error('yt-dlp did not return an audio URL');
  const headers = { ...(info.http_headers || {}), ...(selected.http_headers || {}) };
  const descriptor = {
    url: directUrl,
    headers,
    mimeType: String(selected.mime_type || info.mime_type || ''),
    bitrate: Number(selected.abr || selected.tbr || info.abr || info.tbr || 0) * 1000,
    audioQuality: String(selected.format_note || selected.format || info.format_note || ''),
    videoId: String(videoId || ''),
  };
  const streamToken = saveYoutubeStreamDescriptor(descriptor);
  return {
    ...descriptor,
    streamToken,
    proxyUrl: `/api/audio?stream=${encodeURIComponent(streamToken)}`,
    engine: 'yt-dlp',
  };
}

function publicProviderConfig(config = providerConfig(), baseUrl = '') {
  return {
    spotifyClientId: config.spotifyClientId,
    spotifyConfigured: !!config.spotifyClientId,
    spotifyMarket: config.spotifyMarket,
    language: config.language,
    spotifyRedirectUri: spotifyRedirectUri(baseUrl),
    youtubeConfigured: true,
  };
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function randomUrlSafe(bytes = 32) {
  return base64Url(crypto.randomBytes(bytes));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function spotifyToken() {
  return readJson(TOKEN_FILE, {});
}

function writeSpotifyToken(value) {
  const target = path.resolve(TOKEN_FILE);
  const directory = path.dirname(target);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
    try {
      fs.renameSync(temporary, target);
    } catch (_) {
      fs.copyFileSync(temporary, target);
      fs.unlinkSync(temporary);
    }
    return true;
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
    console.warn('[SpotifyAuth] token write failed:', error.message);
    return false;
  }
}

function saveSpotifyToken(token) {
  const current = spotifyToken();
  const now = Date.now();
  const config = providerConfig();
  const merged = {
    ...current,
    ...token,
    clientId: config.spotifyClientId || current.clientId || '',
  };
  if (token.access_token || token.expires_in != null) {
    merged.obtainedAt = now;
    merged.expiresAt = now + Math.max(30, Number(token.expires_in || 3600) - 30) * 1000;
  }
  if (!token.refresh_token && current.refresh_token) merged.refresh_token = current.refresh_token;
  if (!writeSpotifyToken(merged)) {
    const error = new Error('SPOTIFY_TOKEN_SAVE_FAILED');
    error.status = 500;
    throw error;
  }
  return merged;
}

function updateSpotifyTokenMetadata(patch) {
  const current = spotifyToken();
  const merged = { ...current, ...(patch || {}) };
  if (!writeSpotifyToken(merged)) {
    const error = new Error('SPOTIFY_TOKEN_SAVE_FAILED');
    error.status = 500;
    throw error;
  }
  return merged;
}

function clearSpotifyAuthRuntime() {
  spotifyAuthRequests.clear();
  spotifyAuthResults.clear();
  spotifyProfilePromise = null;
  spotifyRefreshPromise = null;
  spotifyRateLimitUntil = 0;
  if (spotifyProfileRetryTimer) clearTimeout(spotifyProfileRetryTimer);
  spotifyProfileRetryTimer = null;
}

function clearSpotifyToken() {
  try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch (_) {}
  clearSpotifyAuthRuntime();
}

function spotifyRetryAfterMs(response, fallback = SPOTIFY_PROFILE_RETRY_FALLBACK) {
  const raw = response && response.headers && response.headers.get ? response.headers.get('retry-after') : '';
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, Math.ceil(seconds * 1000));
  return fallback;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = SPOTIFY_REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || SPOTIFY_REQUEST_TIMEOUT));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      const timeoutError = new Error('SPOTIFY_REQUEST_TIMEOUT');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function spotifyTokenRequest(params) {
  const body = new URLSearchParams(params);
  const response = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error_description || data.error || `Spotify token HTTP ${response.status}`);
    error.status = response.status;
    if (response.status === 429) {
      error.retryAfterMs = spotifyRetryAfterMs(response);
      error.retryAt = Date.now() + error.retryAfterMs;
    }
    throw error;
  }
  if (String(params && params.grant_type || '') === 'authorization_code') {
    data.profile = null;
    data.profileFetchedAt = 0;
    data.profileRetryAt = 0;
    data.profileRetryCount = 0;
  }
  return saveSpotifyToken(data);
}

async function refreshSpotifyAccessToken() {
  if (spotifyRefreshPromise) return spotifyRefreshPromise;
  spotifyRefreshPromise = (async () => {
    const config = providerConfig();
    const token = spotifyToken();
    if (!config.spotifyClientId || !token.refresh_token) return null;
    return spotifyTokenRequest({
      client_id: config.spotifyClientId,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    });
  })();
  try {
    return await spotifyRefreshPromise;
  } finally {
    spotifyRefreshPromise = null;
  }
}

async function validSpotifyToken(required = false) {
  const config = providerConfig();
  let token = spotifyToken();
  if (token.clientId && config.spotifyClientId && token.clientId !== config.spotifyClientId) {
    clearSpotifyToken();
    token = {};
  }
  if (token.access_token && Number(token.expiresAt || 0) > Date.now()) return token;
  try {
    token = await refreshSpotifyAccessToken();
  } catch (error) {
    console.warn('[SpotifyAuth] refresh failed:', error.message);
    if (error.status === 400 || error.status === 401) clearSpotifyToken();
    token = null;
  }
  if (required && (!token || !token.access_token)) {
    const error = new Error('SPOTIFY_LOGIN_REQUIRED');
    error.status = 401;
    throw error;
  }
  return token;
}

async function spotifyApi(endpoint, options = {}) {
  if (!options.ignoreRateLimit && spotifyRateLimitUntil > Date.now()) {
    const error = new Error('SPOTIFY_RATE_LIMITED');
    error.status = 429;
    error.retryAt = spotifyRateLimitUntil;
    error.retryAfterMs = Math.max(1000, spotifyRateLimitUntil - Date.now());
    throw error;
  }
  let token = await validSpotifyToken(options.required !== false);
  if (!token || !token.access_token) return null;
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    'User-Agent': UA,
    ...(options.headers || {}),
  };
  const request = () => fetchWithTimeout(`https://api.spotify.com/v1${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body,
  }, options.timeoutMs || SPOTIFY_REQUEST_TIMEOUT);
  let response = await request();
  if (response.status === 401 && token.refresh_token) {
    token = await refreshSpotifyAccessToken();
    if (!token || !token.access_token) {
      const error = new Error('SPOTIFY_LOGIN_REQUIRED');
      error.status = 401;
      throw error;
    }
    headers.Authorization = `Bearer ${token.access_token}`;
    response = await request();
  }
  if (response.status === 204) return {};
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error && data.error.message || `Spotify HTTP ${response.status}`);
    error.status = response.status;
    error.payload = data;
    if (response.status === 429) {
      error.retryAfterMs = spotifyRetryAfterMs(response);
      error.retryAt = Date.now() + error.retryAfterMs;
      spotifyRateLimitUntil = Math.max(spotifyRateLimitUntil, error.retryAt);
    }
    throw error;
  }
  return data;
}


function spotifyLyricsTrackId(value) {
  const raw = String(value || '').trim();
  const uriMatch = raw.match(/^spotify:track:([A-Za-z0-9]{16,32})$/i);
  const urlMatch = raw.match(/open\.spotify\.com\/track\/([A-Za-z0-9]{16,32})/i);
  const id = uriMatch ? uriMatch[1] : (urlMatch ? urlMatch[1] : raw);
  return /^[A-Za-z0-9]{16,32}$/.test(id) ? id : '';
}

function spotifyLyricsTimestamp(milliseconds) {
  const total = Math.max(0, Math.round(Number(milliseconds) || 0));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}]`;
}

function normalizeSpotifyLyricsPayload(payload, metadata = {}) {
  const lyrics = payload && payload.lyrics && typeof payload.lyrics === 'object' ? payload.lyrics : {};
  const syncType = String(lyrics.syncType || '').trim().toUpperCase();
  const rawLines = Array.isArray(lyrics.lines) ? lyrics.lines : [];
  const lines = rawLines.map((line) => {
    const words = String(line && line.words || '').replace(/\r?\n/g, ' ').trim();
    const startTimeMs = Number(line && line.startTimeMs);
    const endTimeMs = Number(line && line.endTimeMs);
    const syllables = Array.isArray(line && line.syllables) ? line.syllables.map((item) => {
      const text = String(item && (item.text || item.word || item.words) || '').replace(/\r?\n/g, ' ');
      const syllableStart = Number(item && item.startTimeMs);
      const syllableEnd = Number(item && item.endTimeMs);
      return {
        text,
        startTimeMs: Number.isFinite(syllableStart) ? Math.max(0, syllableStart) : -1,
        endTimeMs: Number.isFinite(syllableEnd) ? Math.max(0, syllableEnd) : 0,
      };
    }).filter((item) => item.text || item.startTimeMs >= 0) : [];
    return {
      words,
      startTimeMs: Number.isFinite(startTimeMs) ? Math.max(0, startTimeMs) : -1,
      endTimeMs: Number.isFinite(endTimeMs) ? Math.max(0, endTimeMs) : 0,
      syllables,
    };
  }).filter((line) => line.words || line.startTimeMs >= 0);
  const timed = syncType !== 'UNSYNCED' && lines.some((line) => line.startTimeMs >= 0);
  if (!lines.length) return null;
  const durationSeconds = lyricSync.normalizeDurationSeconds(metadata.duration || metadata.durationMs || 0);
  const plainLyric = lines.map((line) => line.words).filter(Boolean).join('\n');
  if (!timed) {
    return {
      lyric: '',
      tlyric: '',
      yrc: '',
      plainLyric,
      instrumental: false,
      source: 'spotify-native-unsynced',
      metadataProvider: 'spotify',
      metadata,
      spotifyLyrics: {
        syncType: syncType || 'UNSYNCED',
        language: String(lyrics.language || ''),
        provider: String(lyrics.providerDisplayName || lyrics.provider || 'Spotify'),
        lineCount: lines.length,
        timed: false,
        lines,
      },
    };
  }
  const timedLines = lines.filter((line) => line.startTimeMs >= 0);
  const lyric = timedLines.map((line) => `${spotifyLyricsTimestamp(line.startTimeMs)}${line.words}`).join('\n');
  return {
    lyric,
    tlyric: '',
    yrc: '',
    plainLyric,
    instrumental: false,
    source: 'spotify-native',
    metadataProvider: 'spotify',
    metadata,
    match: {
      id: String(lyrics.providerLyricsId || metadata.spotifyId || metadata.id || ''),
      score: 100,
      track: String(metadata.track || metadata.name || ''),
      artist: String(metadata.artist || ''),
      album: String(metadata.album || ''),
      duration: durationSeconds,
      synced: true,
    },
    spotifyLyrics: {
      syncType: syncType || 'LINE_SYNCED',
      language: String(lyrics.language || ''),
      provider: String(lyrics.providerDisplayName || lyrics.provider || 'Spotify'),
      lineCount: timedLines.length,
      timed: true,
      // Preserve Spotify's raw millisecond timeline. Converting to LRC and
      // parsing it again loses blank timing rows, endTimeMs and any available
      // syllable timing, which makes the app visibly diverge from Spotify.
      lines: timedLines,
    },
  };
}

async function spotifyNativeLyrics(id, metadata = {}) {
  if (/^(0|false|off|disabled)$/i.test(String(process.env.SPOTIFY_NATIVE_LYRICS || '').trim())) return null;
  const trackId = spotifyLyricsTrackId(id || metadata.spotifyId || metadata.id);
  if (!trackId) return null;
  const cached = spotifyLyricsCache.get(trackId);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.value;

  let token = await validSpotifyToken(false);
  if (!token || !token.access_token) return null;
  const endpoint = `${SPOTIFY_LYRICS_BASE}/${encodeURIComponent(trackId)}?format=json&vocalRemoval=false&market=from_token`;
  const request = (accessToken) => fetchWithTimeout(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'App-Platform': 'WebPlayer',
      'User-Agent': UA,
    },
  }, 10000);

  try {
    let response = await request(token.access_token);
    if (response.status === 401 && token.refresh_token) {
      token = await refreshSpotifyAccessToken();
      if (token && token.access_token) response = await request(token.access_token);
    }
    if (!response.ok) {
      if (![401, 403, 404].includes(response.status)) {
        console.warn('[SpotifyLyrics] HTTP', response.status, trackId);
      }
      return null;
    }
    const payload = await response.json().catch(() => null);
    const value = normalizeSpotifyLyricsPayload(payload, {
      ...metadata,
      spotifyId: trackId,
      id: trackId,
    });
    if (!value || value.source !== 'spotify-native') return null;
    spotifyLyricsCache.set(trackId, { at: Date.now(), value });
    if (spotifyLyricsCache.size > 120) {
      const oldest = [...spotifyLyricsCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, spotifyLyricsCache.size - 96);
      oldest.forEach(([key]) => spotifyLyricsCache.delete(key));
    }
    return value;
  } catch (error) {
    console.warn('[SpotifyLyrics]', trackId, error && (error.message || error));
    return null;
  }
}

function normalizeSpotifyProfile(profile) {
  profile = profile || {};
  return {
    id: String(profile.id || ''),
    displayName: String(profile.display_name || profile.id || 'Spotify'),
    avatar: String(profile.images && profile.images[0] && profile.images[0].url || ''),
    country: String(profile.country || providerConfig().spotifyMarket || 'VN'),
    product: String(profile.product || ''),
    email: String(profile.email || ''),
  };
}

function cachedSpotifyProfile(token = spotifyToken()) {
  const profile = token && token.profile;
  return profile && profile.id ? normalizeSpotifyProfile({
    id: profile.id,
    display_name: profile.displayName || profile.display_name,
    images: profile.avatar ? [{ url: profile.avatar }] : profile.images,
    country: profile.country,
    product: profile.product,
    email: profile.email,
  }) : null;
}

function scheduleSpotifyProfileRefresh(delayMs) {
  const delay = Math.max(1000, Number(delayMs) || SPOTIFY_PROFILE_RETRY_FALLBACK);
  if (spotifyProfileRetryTimer) clearTimeout(spotifyProfileRetryTimer);
  spotifyProfileRetryTimer = setTimeout(() => {
    spotifyProfileRetryTimer = null;
    ensureSpotifyProfile({ force: true }).catch((error) => {
      if (error && error.status !== 429) console.warn('[SpotifyAuth] profile retry failed:', error.message);
    });
  }, delay);
  if (spotifyProfileRetryTimer.unref) spotifyProfileRetryTimer.unref();
}

async function ensureSpotifyProfile(options = {}) {
  const current = spotifyToken();
  const cached = cachedSpotifyProfile(current);
  if (cached && !options.force) return cached;
  if (spotifyProfilePromise) return spotifyProfilePromise;
  const retryAt = Math.max(Number(current.profileRetryAt || 0), spotifyRateLimitUntil);
  if (retryAt > Date.now()) {
    scheduleSpotifyProfileRefresh(retryAt - Date.now());
    const error = new Error('SPOTIFY_PROFILE_RATE_LIMITED');
    error.status = 429;
    error.retryAt = retryAt;
    error.retryAfterMs = retryAt - Date.now();
    throw error;
  }
  spotifyProfilePromise = (async () => {
    try {
      const raw = await spotifyApi('/me', { required: true });
      const profile = normalizeSpotifyProfile(raw);
      if (!profile.id) {
        const error = new Error('SPOTIFY_PROFILE_INVALID');
        error.status = 502;
        throw error;
      }
      updateSpotifyTokenMetadata({
        profile,
        profileFetchedAt: Date.now(),
        profileRetryAt: 0,
        profileRetryCount: 0,
      });
      console.log(`[SpotifyAuth] profile cached user=${profile.id}`);
      return profile;
    } catch (error) {
      if (error && error.status === 429) {
        const delay = Math.max(1000, Number(error.retryAfterMs || SPOTIFY_PROFILE_RETRY_FALLBACK));
        updateSpotifyTokenMetadata({
          profileRetryAt: Date.now() + delay,
          profileRetryCount: Number(current.profileRetryCount || 0) + 1,
        });
        scheduleSpotifyProfileRefresh(delay);
      } else if (error && error.status === 401) {
        clearSpotifyToken();
      } else {
        const retryCount = Number(current.profileRetryCount || 0) + 1;
        if (retryCount <= 5) {
          const delay = Math.min(60 * 1000, 5000 * Math.pow(2, retryCount - 1));
          updateSpotifyTokenMetadata({
            profileRetryAt: Date.now() + delay,
            profileRetryCount: retryCount,
          });
          scheduleSpotifyProfileRefresh(delay);
        }
      }
      throw error;
    }
  })();
  try {
    return await spotifyProfilePromise;
  } finally {
    spotifyProfilePromise = null;
  }
}

function spotifyPlaybackScopesReady(token) {
  const granted = new Set(String(token && token.scope || '').split(/\s+/).filter(Boolean));
  return ['streaming', 'user-read-playback-state', 'user-modify-playback-state'].every((scope) => granted.has(scope));
}

function spotifyStatusFromProfile(config, token, profile, baseUrl = '') {
  const premium = profile.product === 'premium';
  return {
    provider: 'spotify',
    loggedIn: true,
    authorized: true,
    profilePending: false,
    configured: true,
    userId: profile.id || '',
    nickname: profile.displayName || profile.id || 'Spotify',
    avatar: profile.avatar || '',
    country: profile.country || config.spotifyMarket,
    product: profile.product || '',
    vipType: premium ? 1 : 0,
    vipLevel: premium ? 'premium' : (profile.product || 'unknown'),
    isVip: premium,
    isSvip: false,
    vipLabel: premium ? 'Premium' : '',
    playbackScopesReady: spotifyPlaybackScopesReady(token),
    grantedScopes: String(token.scope || '').split(/\s+/).filter(Boolean),
    redirectUri: spotifyRedirectUri(baseUrl),
  };
}

async function spotifyLoginStatus(baseUrl = '') {
  const config = providerConfig();
  const token = await validSpotifyToken(false);
  if (!config.spotifyClientId) {
    return {
      provider: 'spotify',
      loggedIn: false,
      authorized: false,
      configured: false,
      message: 'SPOTIFY_CLIENT_ID_REQUIRED',
      redirectUri: spotifyRedirectUri(baseUrl),
    };
  }
  if (!token || !token.access_token) {
    return {
      provider: 'spotify',
      loggedIn: false,
      authorized: false,
      configured: true,
      redirectUri: spotifyRedirectUri(baseUrl),
    };
  }
  const profile = cachedSpotifyProfile(token);
  if (profile) return spotifyStatusFromProfile(config, token, profile, baseUrl);

  // Status checks never call /me repeatedly. At most one background profile
  // request is active, and 429 cooldown is respected globally.
  ensureSpotifyProfile().catch((error) => {
    if (error && error.status !== 429) console.warn('[SpotifyAuth] profile load pending:', error.message);
  });
  const retryAt = Math.max(Number(token.profileRetryAt || 0), spotifyRateLimitUntil);
  return {
    provider: 'spotify',
    loggedIn: false,
    authorized: true,
    profilePending: true,
    configured: true,
    playbackScopesReady: spotifyPlaybackScopesReady(token),
    grantedScopes: String(token.scope || '').split(/\s+/).filter(Boolean),
    retryAt,
    retryAfterMs: retryAt > Date.now() ? retryAt - Date.now() : 0,
    message: retryAt > Date.now() ? 'SPOTIFY_PROFILE_RATE_LIMITED' : 'SPOTIFY_PROFILE_LOADING',
    redirectUri: spotifyRedirectUri(baseUrl),
  };
}

function cleanSpotifyAuthTransactions() {
  const now = Date.now();
  for (const [key, value] of spotifyAuthRequests) {
    if (!value || now - Number(value.createdAt || 0) > SPOTIFY_AUTH_TTL) spotifyAuthRequests.delete(key);
  }
  for (const [key, value] of spotifyAuthResults) {
    if (!value || now - Number(value.createdAt || 0) > SPOTIFY_AUTH_TTL) spotifyAuthResults.delete(key);
  }
}

function beginSpotifyLogin(baseUrl) {
  const config = providerConfig();
  if (!config.spotifyClientId) {
    const error = new Error('SPOTIFY_CLIENT_ID_REQUIRED');
    error.status = 400;
    throw error;
  }
  cleanSpotifyAuthTransactions();
  const redirectUri = spotifyRedirectUri(baseUrl);
  const state = randomUrlSafe(18);
  const verifier = randomUrlSafe(64);
  const challenge = base64Url(sha256(verifier));
  spotifyAuthRequests.set(state, { verifier, redirectUri, createdAt: Date.now() });
  spotifyAuthResults.set(state, { state, stage: 'authorization', complete: false, createdAt: Date.now() });
  const scopes = [
    'user-read-private',
    'user-read-email',
    'user-library-read',
    'user-library-modify',
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-private',
    'playlist-modify-public',
    'user-top-read',
    'streaming',
    'user-read-playback-state',
    'user-read-currently-playing',
    'user-modify-playback-state',
  ];
  const params = new URLSearchParams({
    client_id: config.spotifyClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: scopes.join(' '),
    show_dialog: 'true',
  });
  console.log(`[SpotifyAuth] started state=${state}`);
  return {
    ok: true,
    provider: 'spotify',
    authUrl: `https://accounts.spotify.com/authorize?${params.toString()}`,
    redirectUri,
    state,
  };
}

async function completeSpotifyLogin(query) {
  cleanSpotifyAuthTransactions();
  const state = String(query.state || '');
  const pending = spotifyAuthRequests.get(state);
  if (query.error) {
    spotifyAuthRequests.delete(state);
    spotifyAuthResults.set(state, {
      state,
      complete: true,
      ok: false,
      error: String(query.error),
      createdAt: Date.now(),
    });
    const error = new Error(String(query.error));
    error.status = 400;
    throw error;
  }
  if (!pending || !query.code) {
    const error = new Error('SPOTIFY_OAUTH_STATE_INVALID');
    error.status = 400;
    throw error;
  }
  spotifyAuthRequests.delete(state);
  const config = providerConfig();
  try {
    const token = await spotifyTokenRequest({
      client_id: config.spotifyClientId,
      grant_type: 'authorization_code',
      code: String(query.code),
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
    });
    spotifyAuthResults.set(state, {
      state,
      complete: false,
      ok: true,
      stage: 'profile',
      tokenAccepted: true,
      createdAt: Date.now(),
    });
    console.log(`[SpotifyAuth] token accepted state=${state}; loading profile once`);
    try {
      const profile = await ensureSpotifyProfile({ force: true });
      const status = spotifyStatusFromProfile(config, spotifyToken(), profile, pending.redirectUri.replace(/\/api\/spotify\/callback$/, ''));
      spotifyAuthResults.set(state, {
        state,
        complete: true,
        ok: true,
        status,
        createdAt: Date.now(),
      });
      console.log(`[SpotifyAuth] connected state=${state} user=${profile.id}`);
      return { ok: true, complete: true, status };
    } catch (profileError) {
      if (profileError && profileError.status === 429) {
        spotifyAuthResults.set(state, {
          state,
          complete: false,
          ok: true,
          stage: 'profile',
          tokenAccepted: true,
          retryAt: profileError.retryAt || Date.now() + Number(profileError.retryAfterMs || SPOTIFY_PROFILE_RETRY_FALLBACK),
          createdAt: Date.now(),
        });
        console.warn(`[SpotifyAuth] profile rate limited state=${state}; retry scheduled`);
        return { ok: true, complete: false, pending: true, retryAt: profileError.retryAt || 0 };
      }
      // The access token remains valid. A transient profile failure is retried
      // once in the background instead of restarting OAuth or hammering /me.
      scheduleSpotifyProfileRefresh(SPOTIFY_PROFILE_RETRY_FALLBACK);
      spotifyAuthResults.set(state, {
        state,
        complete: false,
        ok: true,
        stage: 'profile',
        tokenAccepted: true,
        message: profileError.message || 'SPOTIFY_PROFILE_LOADING',
        retryAt: Date.now() + SPOTIFY_PROFILE_RETRY_FALLBACK,
        createdAt: Date.now(),
      });
      return { ok: true, complete: false, pending: true };
    }
  } catch (error) {
    spotifyAuthResults.set(state, {
      state,
      complete: true,
      ok: false,
      error: error.message || 'SPOTIFY_LOGIN_FAILED',
      createdAt: Date.now(),
    });
    throw error;
  }
}

async function spotifyLoginResult(state, baseUrl = '') {
  cleanSpotifyAuthTransactions();
  const key = String(state || '');
  const result = spotifyAuthResults.get(key);
  if (!result) {
    return { ok: false, complete: true, error: 'SPOTIFY_LOGIN_TRANSACTION_NOT_FOUND' };
  }
  if (result.complete) return { ...result };
  const token = await validSpotifyToken(false);
  const profile = cachedSpotifyProfile(token || {});
  if (token && token.access_token && profile) {
    const status = spotifyStatusFromProfile(providerConfig(), token, profile, baseUrl);
    const completed = { state: key, complete: true, ok: true, status, createdAt: result.createdAt || Date.now() };
    spotifyAuthResults.set(key, completed);
    return completed;
  }
  const current = spotifyToken();
  const retryAt = Math.max(Number(current.profileRetryAt || 0), spotifyRateLimitUntil, Number(result.retryAt || 0));
  return {
    ...result,
    ok: true,
    complete: false,
    pending: true,
    retryAt,
    retryAfterMs: retryAt > Date.now() ? retryAt - Date.now() : 0,
  };
}

function spotifyArtists(raw) {
  return (raw || []).map((artist) => ({ id: artist.id || '', name: artist.name || '' })).filter((artist) => artist.name);
}

function mapSpotifyTrack(track) {
  track = track && (track.item || track.track) ? (track.item || track.track) : track || {};
  const artists = spotifyArtists(track.artists);
  const album = track.album || {};
  const song = {
    provider: 'netease',
    realProvider: 'spotify',
    source: 'netease',
    type: 'song',
    id: track.id || '',
    spotifyId: track.id || '',
    spotifyUri: track.uri || '',
    name: track.name || '',
    artist: artists.map((artist) => artist.name).join(' / '),
    artists,
    artistId: artists[0] && artists[0].id || '',
    album: album.name || '',
    albumId: album.id || '',
    cover: album.images && album.images[0] && album.images[0].url || '',
    duration: Number(track.duration_ms || 0),
    explicit: !!track.explicit,
    popularity: Number(track.popularity || 0),
    externalIds: track.external_ids || {},
    isrc: track.external_ids && track.external_ids.isrc || '',
    playable: track.is_playable !== false,
    externalUrl: track.external_urls && track.external_urls.spotify || '',
    playbackTransport: 'spotify',
    lyricsMetadataProvider: 'spotify',
  };
  if (song.id) spotifyTrackCache.set(song.id, song);
  return song;
}

async function spotifySearch(query, limit = 18) {
  const config = providerConfig();
  const token = await validSpotifyToken(false);
  if (!config.spotifyClientId || !token) return [];

  // Since Spotify's February 2026 Development Mode changes, /search accepts
  // at most 10 items per request. Paginate instead of sending the legacy 18/50
  // limit, which makes Spotify return HTTP 400 and previously caused the UI to
  // silently show only YouTube results.
  const target = Math.max(1, Math.min(30, Number(limit) || 18));
  const songs = [];
  let offset = 0;
  while (songs.length < target) {
    const pageSize = Math.min(10, target - songs.length);
    const params = new URLSearchParams({
      q: String(query || ''),
      type: 'track',
      limit: String(pageSize),
      offset: String(offset),
      market: config.spotifyMarket,
    });
    const data = await spotifyApi(`/search?${params.toString()}`);
    const page = ((data && data.tracks && data.tracks.items) || [])
      .map(mapSpotifyTrack)
      .filter((song) => song.id && song.name);
    songs.push(...page);
    if (page.length < pageSize || !(data && data.tracks && data.tracks.next)) break;
    offset += pageSize;
  }
  return songs.slice(0, target);
}

async function spotifyUserPlaylists(limit = 50) {
  const data = await spotifyApi(`/me/playlists?limit=${Math.max(1, Math.min(50, Number(limit) || 50))}`);
  return ((data && data.items) || []).map((playlist) => ({
    provider: 'netease',
    realProvider: 'spotify',
    source: 'netease',
    id: playlist.id || '',
    name: playlist.name || '',
    cover: playlist.images && playlist.images[0] && playlist.images[0].url || '',
    trackCount: playlist.items && playlist.items.total || playlist.tracks && playlist.tracks.total || 0,
    playCount: 0,
    creator: playlist.owner && (playlist.owner.display_name || playlist.owner.id) || '',
    subscribed: true,
    specialType: 0,
    collaborative: !!playlist.collaborative,
    public: playlist.public,
  })).filter((playlist) => playlist.id);
}

async function spotifyPlaylistTracks(id, limit = 100) {
  const encodedId = encodeURIComponent(id);
  const market = encodeURIComponent(providerConfig().spotifyMarket);
  const [playlist, firstPage] = await Promise.all([
    spotifyApi(`/playlists/${encodedId}?market=${market}`),
    spotifyApi(`/playlists/${encodedId}/items?market=${market}&limit=50`),
  ]);
  const tracks = [];
  let page = firstPage;
  while (page && tracks.length < limit) {
    (page.items || []).forEach((entry) => {
      const item = entry && (entry.item || entry.track);
      if (tracks.length < limit && item && item.id && item.type !== 'episode') tracks.push(mapSpotifyTrack(item));
    });
    if (!page.next || tracks.length >= limit) break;
    const next = new URL(page.next);
    page = await spotifyApi(next.pathname.replace(/^\/v1/, '') + next.search);
  }
  return {
    playlist: {
      id: playlist.id || id,
      name: playlist.name || '',
      cover: playlist.images && playlist.images[0] && playlist.images[0].url || '',
      trackCount: Number(firstPage && firstPage.total || tracks.length),
      creator: playlist.owner && (playlist.owner.display_name || playlist.owner.id) || '',
    },
    tracks,
  };
}

function spotifyTrackUri(id) {
  return `spotify:track:${String(id || '').trim()}`;
}

async function spotifyLikedCheck(ids) {
  const safe = (ids || []).filter(Boolean).slice(0, 40);
  if (!safe.length) return [];
  const uris = safe.map(spotifyTrackUri).join(',');
  const data = await spotifyApi(`/me/library/contains?uris=${encodeURIComponent(uris)}`);
  return Array.isArray(data) ? data : [];
}

async function spotifySetLiked(id, like) {
  const uri = spotifyTrackUri(id);
  await spotifyApi(`/me/library?uris=${encodeURIComponent(uri)}`, { method: like ? 'PUT' : 'DELETE' });
  return true;
}

async function spotifyCreatePlaylist(name) {
  const profile = await spotifyApi('/me');
  const data = await spotifyApi('/me/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: String(name || 'New playlist').slice(0, 100), public: false }),
  });
  return {
    id: data.id || '',
    name: data.name || name || '',
    cover: data.images && data.images[0] && data.images[0].url || '',
    trackCount: 0,
    creator: profile.display_name || profile.id || '',
  };
}

async function spotifyAddSongToPlaylist(playlistId, trackId) {
  await spotifyApi(`/playlists/${encodeURIComponent(playlistId)}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
  });
  return true;
}

async function getYouTubeClient() {
  if (!youtubeClientPromise) {
    youtubeClientPromise = (async () => {
      const yt = await import('youtubei.js');
      if (yt.Platform && yt.Platform.shim) {
        yt.Platform.shim.eval = async (data) => new Function(data.output)();
      }
      return yt.Innertube.create({
        lang: providerConfig().language === 'en' ? 'en' : 'vi',
        location: providerConfig().spotifyMarket || 'VN',
        retrieve_player: true,
        enable_session_cache: true,
        generate_session_locally: false,
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
      });
    })().catch((error) => {
      youtubeClientPromise = null;
      throw error;
    });
  }
  return youtubeClientPromise;
}

const YOUTUBE_MUSIC_LYRICS_CACHE_TTL = 30 * 60 * 1000;
const YOUTUBE_MUSIC_LYRICS_MISS_TTL = 5 * 60 * 1000;

function normalizeYouTubeMusicLyricsText(value) {
  let text = '';
  if (value && typeof value.toString === 'function') text = value.toString();
  else text = String(value || '');
  if (text === 'N/A') text = '';
  return text
    .replace(/\r/g, '')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeYouTubeMusicLyricsShelf(shelf, videoId = '') {
  if (!shelf || typeof shelf !== 'object') return null;
  const plainLyric = normalizeYouTubeMusicLyricsText(shelf.description);
  if (!plainLyric) return null;
  const footer = normalizeYouTubeMusicLyricsText(shelf.footer);
  return {
    lyric: '',
    tlyric: '',
    yrc: '',
    plainLyric,
    source: 'youtube-music',
    syncType: 'UNSYNCED',
    videoId: String(videoId || ''),
    provider: footer || 'YouTube Music',
  };
}

async function youtubeMusicNativeLyrics(videoId) {
  const id = String(videoId || '').trim();
  if (!id) return null;
  const now = Date.now();
  const cached = youtubeMusicLyricsCache.get(id);
  if (cached && now - cached.at < (cached.value ? YOUTUBE_MUSIC_LYRICS_CACHE_TTL : YOUTUBE_MUSIC_LYRICS_MISS_TTL)) {
    return cached.value ? { ...cached.value } : null;
  }
  try {
    const yt = await getYouTubeClient();
    const shelf = await yt.music.getLyrics(id);
    const value = normalizeYouTubeMusicLyricsShelf(shelf, id);
    youtubeMusicLyricsCache.set(id, { at: now, value });
    return value ? { ...value } : null;
  } catch (error) {
    youtubeMusicLyricsCache.set(id, { at: now, value: null });
    console.warn('[YouTubeMusicLyrics]', id, error && error.message || String(error));
    return null;
  }
}

function youtubeThumbnail(item) {
  const list = item && item.thumbnail && (item.thumbnail.contents || item.thumbnail) || [];
  const first = Array.isArray(list) ? list[0] : null;
  return first && first.url || '';
}

function mapYouTubeMusicItem(item) {
  if (!item) return null;
  const id = item.id || item.endpoint && item.endpoint.payload && item.endpoint.payload.videoId || '';
  if (!id) return null;
  const artists = (item.artists || []).map((artist) => ({
    id: artist.channel_id || artist.id || '',
    name: artist.name || '',
  })).filter((artist) => artist.name);
  if (!artists.length && item.author && item.author.name) artists.push({ id: item.author.channel_id || '', name: item.author.name });
  const song = {
    provider: 'qq',
    realProvider: 'youtube',
    source: 'qq',
    type: 'qq',
    id,
    mid: id,
    songmid: id,
    youtubeId: id,
    name: item.title && item.title.toString ? item.title.toString() : String(item.title || item.name || ''),
    artist: artists.map((artist) => artist.name).join(' / ') || String(item.subtitle || ''),
    artists,
    artistId: artists[0] && artists[0].id || '',
    artistMid: artists[0] && artists[0].id || '',
    album: item.album && item.album.name || '',
    albumId: item.album && item.album.id || '',
    cover: youtubeThumbnail(item),
    duration: item.duration && Number(item.duration.seconds || 0) * 1000 || 0,
    playable: true,
    externalUrl: `https://music.youtube.com/watch?v=${id}`,
  };
  youtubeTrackCache.set(id, song);
  return song;
}

function youtubeSearchItems(result) {
  const output = [];
  const shelves = result && result.contents ? Array.from(result.contents) : [];
  shelves.forEach((shelf) => {
    const items = shelf && shelf.contents ? Array.from(shelf.contents) : [];
    items.forEach((item) => {
      const mapped = mapYouTubeMusicItem(item);
      if (mapped) output.push(mapped);
    });
  });
  return output;
}

async function youtubeSearch(query, limit = 18) {
  const key = `${String(query || '').trim().toLowerCase()}|${limit}`;
  const cached = youtubeSearchCache.get(key);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.items.map((item) => ({ ...item }));
  const yt = await getYouTubeClient();
  let result;
  try {
    result = await yt.music.search(String(query || ''), { type: 'song' });
  } catch (_) {
    result = await yt.search(String(query || ''), { type: 'video' });
  }
  let songs = youtubeSearchItems(result);
  if (!songs.length && result && result.results) {
    songs = Array.from(result.results).map(mapYouTubeMusicItem).filter(Boolean);
  }
  songs = songs.slice(0, Math.max(1, Math.min(50, Number(limit) || 18)));
  youtubeSearchCache.set(key, { at: Date.now(), items: songs });
  return songs;
}

async function youtubeAudioUrl(videoId, quality = '') {
  let ytDlpError = null;
  try {
    return await youtubeAudioViaYtDlp(videoId, quality);
  } catch (error) {
    ytDlpError = error;
    console.warn('[YouTubeEngine] yt-dlp failed:', error.message);
  }

  // Compatibility fallback. youtubei.js can still work on some player revisions,
  // but yt-dlp is the primary engine because YouTube frequently changes ciphers.
  try {
    const yt = await getYouTubeClient();
    const requested = String(quality || '').toLowerCase();
    const format = await yt.getStreamingData(String(videoId), {
      type: 'audio',
      quality: requested === 'standard' ? 'bestefficiency' : 'best',
      format: 'any',
    });
    const directUrl = format && format.url || '';
    if (!directUrl) throw new Error('youtubei.js returned no audio URL');
    const streamToken = saveYoutubeStreamDescriptor({
      url: directUrl,
      headers: {},
      mimeType: format && format.mime_type || '',
      bitrate: format && format.bitrate || 0,
      audioQuality: format && format.audio_quality || '',
      videoId: String(videoId || ''),
    });
    return {
      url: directUrl,
      proxyUrl: `/api/audio?stream=${encodeURIComponent(streamToken)}`,
      streamToken,
      engine: 'youtubei.js-fallback',
      mimeType: format && format.mime_type || '',
      bitrate: format && format.bitrate || 0,
      audioQuality: format && format.audio_quality || '',
      level: requested || 'exhigh',
      quality: requested === 'standard' ? 'Standard' : 'YouTube Music',
    };
  } catch (fallbackError) {
    const error = new Error(`YouTube engine unavailable: ${ytDlpError && ytDlpError.message || 'yt-dlp failed'}; ${fallbackError.message}`);
    error.code = 'YOUTUBE_ENGINE_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
}

// Spotify and YouTube are intentionally independent playback sources.
// Spotify tracks are never matched or resolved through YouTube.


async function spotifyAudioAnalysis(trackId) {
  const id = String(trackId || '').trim();
  if (!/^[A-Za-z0-9]{16,32}$/.test(id)) {
    const error = new Error('SPOTIFY_TRACK_ID_REQUIRED');
    error.status = 400;
    throw error;
  }
  const cached = spotifyAudioAnalysisCache.get(id);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.value;
  const data = await spotifyApi(`/audio-analysis/${encodeURIComponent(id)}`, { required: true });
  const compactEvent = (row) => ({
    start: Number(row && row.start || 0),
    duration: Number(row && row.duration || 0),
    confidence: Number(row && row.confidence || 0),
  });
  const value = {
    trackId: id,
    track: data && data.track ? {
      duration: Number(data.track.duration || 0),
      tempo: Number(data.track.tempo || 0),
      tempoConfidence: Number(data.track.tempo_confidence || 0),
      timeSignature: Number(data.track.time_signature || 4),
      timeSignatureConfidence: Number(data.track.time_signature_confidence || 0),
      loudness: Number(data.track.loudness || 0),
      endOfFadeIn: Number(data.track.end_of_fade_in || 0),
      startOfFadeOut: Number(data.track.start_of_fade_out || 0),
    } : null,
    beats: Array.isArray(data && data.beats) ? data.beats.slice(0, 12000).map(compactEvent) : [],
    bars: Array.isArray(data && data.bars) ? data.bars.slice(0, 4000).map(compactEvent) : [],
    sections: Array.isArray(data && data.sections) ? data.sections.slice(0, 1000).map((row) => ({
      ...compactEvent(row),
      loudness: Number(row && row.loudness || 0),
      tempo: Number(row && row.tempo || 0),
      tempoConfidence: Number(row && row.tempo_confidence || 0),
      timeSignature: Number(row && row.time_signature || 4),
    })) : [],
  };
  spotifyAudioAnalysisCache.set(id, { at: Date.now(), value });
  if (spotifyAudioAnalysisCache.size > 80) {
    const oldest = [...spotifyAudioAnalysisCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, spotifyAudioAnalysisCache.size - 64);
    oldest.forEach(([key]) => spotifyAudioAnalysisCache.delete(key));
  }
  return value;
}

async function spotifyPlayerToken() {
  const token = await validSpotifyToken(true);
  if (!token || !token.access_token) {
    const error = new Error('SPOTIFY_LOGIN_REQUIRED');
    error.status = 401;
    throw error;
  }
  return {
    accessToken: token.access_token,
    expiresAt: Number(token.expiresAt || 0),
    tokenType: token.token_type || 'Bearer',
    scope: token.scope || '',
    playbackScopesReady: spotifyPlaybackScopesReady(token),
  };
}

async function spotifyDevices() {
  const data = await spotifyApi('/me/player/devices');
  return (data && data.devices || []).map((device) => ({
    id: device.id || '',
    name: device.name || 'Spotify',
    type: device.type || '',
    isActive: !!device.is_active,
    isPrivateSession: !!device.is_private_session,
    isRestricted: !!device.is_restricted,
    volumePercent: Number(device.volume_percent == null ? 100 : device.volume_percent),
    supportsVolume: device.supports_volume !== false,
  })).filter((device) => device.id);
}

async function spotifyPlaybackState() {
  const data = await spotifyApi('/me/player', { required: true });
  if (!data || !data.item) return { active: false, isPlaying: false, progressMs: 0, durationMs: 0, device: data && data.device || null };
  return {
    active: true,
    isPlaying: !!data.is_playing,
    progressMs: Number(data.progress_ms || 0),
    durationMs: Number(data.item.duration_ms || 0),
    shuffleState: !!data.shuffle_state,
    repeatState: data.repeat_state || 'off',
    device: data.device || null,
    track: mapSpotifyTrack(data.item),
  };
}

async function spotifyTransferPlayback(deviceId, play = false) {
  if (!deviceId) throw Object.assign(new Error('SPOTIFY_DEVICE_REQUIRED'), { status: 400 });
  await spotifyApi('/me/player', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_ids: [String(deviceId)], play: !!play }),
  });
  return true;
}

async function spotifyStartPlayback({ deviceId, uri, positionMs = 0 } = {}) {
  if (!uri || !/^spotify:track:[A-Za-z0-9]+$/.test(String(uri))) {
    throw Object.assign(new Error('SPOTIFY_TRACK_URI_REQUIRED'), { status: 400 });
  }
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  const normalizedUri = String(uri);
  const normalizedPositionMs = Math.max(0, Math.round(Number(positionMs) || 0));
  await spotifyApi(`/me/player/play${query}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [normalizedUri], position_ms: normalizedPositionMs }),
  });
  return { uri: normalizedUri, deviceId: String(deviceId || ''), positionMs: normalizedPositionMs };
}

async function spotifyPausePlayback(deviceId = '') {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  await spotifyApi(`/me/player/pause${query}`, { method: 'PUT' });
  return true;
}

async function spotifyResumePlayback(deviceId = '') {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  await spotifyApi(`/me/player/play${query}`, { method: 'PUT' });
  return true;
}

async function spotifySeekPlayback(positionMs, deviceId = '') {
  const params = new URLSearchParams({ position_ms: String(Math.max(0, Math.round(Number(positionMs) || 0))) });
  if (deviceId) params.set('device_id', deviceId);
  await spotifyApi(`/me/player/seek?${params.toString()}`, { method: 'PUT' });
  return true;
}

async function spotifySetPlaybackVolume(volumePercent, deviceId = '') {
  const params = new URLSearchParams({ volume_percent: String(Math.max(0, Math.min(100, Math.round(Number(volumePercent) || 0)))) });
  if (deviceId) params.set('device_id', deviceId);
  await spotifyApi(`/me/player/volume?${params.toString()}`, { method: 'PUT' });
  return true;
}

async function resolveSpotifyPlayback(trackId, quality) {
  const status = await spotifyLoginStatus();
  if (!status.loggedIn) {
    return {
      url: null,
      proxyUrl: null,
      playable: false,
      provider: 'spotify',
      playbackProvider: 'spotify',
      transport: 'spotify',
      reason: 'login_required',
      message: 'Spotify sign-in is required for direct Spotify playback.',
      restriction: { provider: 'spotify', category: 'login_required', action: 'login' },
    };
  }
  if (!status.playbackScopesReady) {
    return {
      url: null,
      proxyUrl: null,
      playable: false,
      provider: 'spotify',
      playbackProvider: 'spotify',
      transport: 'spotify',
      reason: 'reauthorization_required',
      message: 'Reconnect Spotify to grant direct playback permissions.',
      restriction: { provider: 'spotify', category: 'login_required', action: 'reauthorize' },
    };
  }
  if (status.vipLevel !== 'premium') {
    return {
      url: null,
      proxyUrl: null,
      playable: false,
      provider: 'spotify',
      playbackProvider: 'spotify',
      transport: 'spotify',
      reason: 'premium_required',
      message: 'Spotify Premium is required for on-demand playback.',
      restriction: { provider: 'spotify', category: 'vip_required', action: 'upgrade' },
    };
  }
  let track = spotifyTrackCache.get(String(trackId));
  if (!track) {
    track = mapSpotifyTrack(await spotifyApi(`/tracks/${encodeURIComponent(trackId)}?market=${encodeURIComponent(providerConfig().spotifyMarket)}`));
  }
  if (!track || !track.spotifyUri) {
    return {
      url: null,
      proxyUrl: null,
      playable: false,
      provider: 'spotify',
      playbackProvider: 'spotify',
      transport: 'spotify',
      reason: 'track_not_found',
      message: 'Spotify track metadata is unavailable.',
    };
  }
  return {
    url: null,
    proxyUrl: null,
    playable: track.playable !== false,
    provider: 'spotify',
    playbackProvider: 'spotify',
    transport: 'spotify',
    spotifyId: track.spotifyId || track.id,
    spotifyUri: track.spotifyUri,
    metadata: track,
    trial: false,
    requestedQuality: quality || '',
    level: 'spotify',
    quality: 'spotify',
    sourceLabel: 'Spotify',
    lyricsMetadataProvider: 'spotify',
  };
}

async function resolveYouTubePlayback(videoId, quality) {
  const stream = await youtubeAudioUrl(videoId, quality);
  return {
    ...stream,
    provider: 'youtube',
    playbackProvider: 'youtube',
    trial: false,
    playable: !!(stream.url || stream.proxyUrl),
    requestedQuality: quality || '',
  };
}

async function youtubePlaylistTracks(id, limit = 200) {
  const yt = await getYouTubeClient();
  const playlist = await yt.music.getPlaylist(String(id).replace(/^VL/, ''));
  const tracks = [];
  let page = playlist;
  while (page && tracks.length < limit) {
    (Array.from(page.items || page.contents || [])).forEach((item) => {
      const mapped = mapYouTubeMusicItem(item);
      if (mapped && tracks.length < limit) tracks.push(mapped);
    });
    if (!page.has_continuation || tracks.length >= limit) break;
    page = await page.getContinuation();
  }
  const header = playlist.header || {};
  const title = header.title && header.title.toString ? header.title.toString() : String(header.title || 'YouTube Music');
  const thumbs = header.thumbnails || header.thumbnail && header.thumbnail.contents || [];
  return {
    playlist: {
      id,
      name: title,
      cover: thumbs[0] && thumbs[0].url || '',
      trackCount: tracks.length,
      creator: 'YouTube Music',
    },
    tracks,
  };
}

async function youtubeArtistDetail(channelId, limit = 36) {
  const yt = await getYouTubeClient();
  const artistPage = await yt.music.getArtist(channelId);
  const header = artistPage.header || {};
  let items = [];
  for (const section of Array.from(artistPage.sections || [])) {
    const sectionItems = Array.from(section.contents || []);
    for (const item of sectionItems) {
      const mapped = mapYouTubeMusicItem(item);
      if (mapped) items.push(mapped);
      if (items.length >= limit) break;
    }
    if (items.length >= limit) break;
  }
  if (!items.length) {
    try {
      const shelf = await artistPage.getAllSongs();
      items = Array.from(shelf && shelf.contents || []).map(mapYouTubeMusicItem).filter(Boolean).slice(0, limit);
    } catch (_) {}
  }
  const thumbs = header.thumbnails || header.thumbnail && header.thumbnail.contents || [];
  return {
    id: channelId,
    artist: {
      id: channelId,
      name: header.title && header.title.toString ? header.title.toString() : String(header.title || ''),
      avatar: thumbs[0] && thumbs[0].url || '',
      brief: header.description && header.description.toString ? header.description.toString() : String(header.description || ''),
      musicSize: items.length,
      albumSize: 0,
    },
    songs: items.slice(0, limit),
  };
}

async function spotifyArtistDetail(artistId, limit = 36) {
  const artist = await spotifyApi(`/artists/${encodeURIComponent(artistId)}`);
  const target = Math.max(1, Math.min(30, Number(limit) || 20));
  const songs = [];
  let offset = 0;
  while (songs.length < target) {
    const pageSize = Math.min(10, target - songs.length);
    const params = new URLSearchParams({
      q: `artist:${artist.name || ''}`,
      type: 'track',
      limit: String(pageSize),
      offset: String(offset),
      market: providerConfig().spotifyMarket,
    });
    const page = await spotifyApi(`/search?${params.toString()}`);
    const mapped = ((page && page.tracks && page.tracks.items) || [])
      .filter((track) => (track.artists || []).some((item) => String(item.id || '') === String(artistId)))
      .map(mapSpotifyTrack)
      .filter((song) => song.id);
    songs.push(...mapped.filter((song) => !songs.some((existing) => existing.id === song.id)));
    if (!page || !page.tracks || !page.tracks.next || mapped.length < pageSize) break;
    offset += pageSize;
  }
  return {
    id: artistId,
    artist: {
      id: artist.id || artistId,
      name: artist.name || '',
      avatar: artist.images && artist.images[0] && artist.images[0].url || '',
      brief: (artist.genres || []).join(' · '),
      musicSize: songs.length,
      albumSize: 0,
    },
    songs: songs.slice(0, target),
  };
}

function songMetadata(id, provider) {
  if (provider === 'youtube') return youtubeTrackCache.get(String(id)) || {};
  return spotifyTrackCache.get(String(id)) || {};
}

function normalizeLyricMatchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(feat(?:uring)?|ft)\.?\s+[^()\[\]-]+/gi, ' ')
    .replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function lyricTitleVariants(title) {
  const raw = String(title || '').trim();
  const variants = [raw];
  const withoutBrackets = raw.replace(/\s*[\[(（【][^\])）】]*[\])）】]\s*/g, ' ').trim();
  const withoutVersion = withoutBrackets
    .replace(/\s*[-–—:]\s*(remaster(?:ed)?|radio edit|edit|version|sped\s*up|slowed(?:\s*down)?|super\s*slowed|ultra\s*slowed|nightcore|live|instrumental|karaoke|remix).*$/i, '')
    .trim();
  [withoutBrackets, withoutVersion].forEach((item) => {
    if (item && !variants.some((existing) => normalizeLyricMatchText(existing) === normalizeLyricMatchText(item))) variants.push(item);
  });
  return variants;
}

function lyricArtistVariants(artist) {
  const raw = String(artist || '').trim();
  const variants = [raw];
  raw.split(/\s*(?:\/|,|&|;|\bx\b|\bfeat\.?\b|\bft\.?\b)\s*/i).forEach((item) => {
    item = String(item || '').trim();
    if (item && !variants.some((existing) => normalizeLyricMatchText(existing) === normalizeLyricMatchText(item))) variants.push(item);
  });
  return variants.filter(Boolean).slice(0, 4);
}

function tokenOverlapScore(left, right) {
  const a = new Set(normalizeLyricMatchText(left).split(' ').filter(Boolean));
  const b = new Set(normalizeLyricMatchText(right).split(' ').filter(Boolean));
  if (!a.size || !b.size) return 0;
  let hit = 0;
  a.forEach((token) => { if (b.has(token)) hit += 1; });
  return hit / Math.max(a.size, b.size);
}

function scoreLyricCandidate(candidate, meta) {
  if (!candidate || typeof candidate !== 'object') return -Infinity;
  const candidateTitle = candidate.trackName || candidate.name || '';
  const candidateArtist = candidate.artistName || '';
  const candidateAlbum = candidate.albumName || '';
  const titleA = normalizeLyricMatchText(candidateTitle);
  const titleB = normalizeLyricMatchText(meta.name);
  const artistOverlap = tokenOverlapScore(candidateArtist, meta.artist);
  let score = 0;
  if (titleA && titleB && titleA === titleB) score += 90;
  else if (titleA && titleB && (titleA.includes(titleB) || titleB.includes(titleA))) score += 54;
  else score += tokenOverlapScore(candidateTitle, meta.name) * 45;
  score += artistOverlap * 55;
  if (candidateAlbum && meta.album) score += tokenOverlapScore(candidateAlbum, meta.album) * 12;
  const candidateDuration = Number(candidate.duration || 0);
  const metaDuration = Number(meta.durationSeconds || 0);
  if (candidateDuration > 0 && metaDuration > 0) {
    const delta = Math.abs(candidateDuration - metaDuration);
    if (delta <= 2) score += 34;
    else if (delta <= 5) score += 22;
    else if (delta <= 10) score += 9;
    else if (delta <= 18) score -= 18;
    else score -= 62;
  }
  if (candidate.syncedLyrics) score += 16;
  else if (candidate.plainLyrics) score += 7;
  if (candidate.instrumental) score += titleA === titleB ? 4 : -8;
  return score;
}

async function fetchLrclibJson(pathname, params) {
  const response = await fetch(`${LRCLIB_BASE}${pathname}?${params.toString()}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  const data = await response.json().catch(() => (pathname === '/search' ? [] : {}));
  if (!response.ok) return pathname === '/search' ? [] : null;
  return data;
}

async function spotifyMetadataForLyrics(id, query) {
  let meta = songMetadata(id, 'spotify');
  // A song can come from a restored queue or playlist after the in-memory cache
  // has been cleared. Fetch the track by ID so lyrics always use exact Spotify
  // metadata rather than any YouTube title/artist fallback.
  if ((!meta || !meta.name) && id) {
    try {
      meta = mapSpotifyTrack(await spotifyApi(`/tracks/${encodeURIComponent(id)}?market=${encodeURIComponent(providerConfig().spotifyMarket)}`));
    } catch (error) {
      console.warn('[SpotifyLyricsMetadata]', id, error.message);
      meta = meta || {};
    }
  }
  return {
    ...meta,
    name: String(meta.name || query.track || '').trim(),
    artist: String(meta.artist || query.artist || '').trim(),
    album: String(meta.album || query.album || '').trim(),
    duration: Number(meta.duration || query.duration || 0),
    isrc: String(meta.isrc || meta.externalIds && meta.externalIds.isrc || ''),
  };
}

async function lyricsFor(id, provider, query = {}) {
  const cachedProviderMeta = provider === 'spotify' ? {} : songMetadata(id, provider);
  let meta = provider === 'spotify'
    ? await spotifyMetadataForLyrics(id, query)
    : {
      ...cachedProviderMeta,
      name: query.track || cachedProviderMeta.name || cachedProviderMeta.title || '',
      artist: query.artist || cachedProviderMeta.artist || '',
      album: query.album || cachedProviderMeta.album || '',
      duration: query.duration || cachedProviderMeta.duration || 0,
    };
  // A restored YouTube queue can reach the lyric endpoint before its in-memory
  // search record is populated. Recover exact metadata through the existing
  // yt-dlp engine so LRCLIB and local forced alignment still receive a usable
  // title, artist, and duration.
  if (provider === 'youtube' && id && (!meta.name || !meta.artist || !meta.duration)) {
    try {
      const info = await youtubeInfoViaYtDlp(id);
      meta = {
        ...meta,
        name: meta.name || info.track || info.title || '',
        artist: meta.artist || info.artist || info.creator || info.uploader || info.channel || '',
        album: meta.album || info.album || '',
        duration: meta.duration || (Number(info.duration || 0) * 1000),
      };
    } catch (error) {
      console.warn('[YouTubeLyricsMetadata]', id, error.message || String(error));
    }
  }
  const trackName = String(meta.name || query.track || '').trim();
  const artistName = String(meta.artist || query.artist || '').trim();
  const albumName = String(meta.album || query.album || '').trim();
  const rawDuration = Number(meta.duration || query.duration || 0);
  const duration = Math.round(rawDuration / (rawDuration > 10000 ? 1000 : 1));
  const metadata = {
    track: trackName,
    artist: artistName,
    album: albumName,
    duration,
    isrc: String(meta.isrc || meta.externalIds && meta.externalIds.isrc || ''),
    spotifyId: provider === 'spotify' ? String(meta.spotifyId || meta.id || id || '') : '',
  };
  // YouTube Music lyrics and regular YouTube captions are separate data
  // sources. Read the Lyrics tab through youtubei.js first so tracks that show
  // lyrics in YouTube Music still have text even when the video has no caption
  // track and LRCLIB has no matching entry. The native text is later passed to
  // the existing local forced aligner to create word timing without changing UI.
  let youtubeMusicLyric = null;
  if (provider === 'youtube' && id) {
    youtubeMusicLyric = await youtubeMusicNativeLyrics(id);
  }

  // YouTube captions are discovered through the same local yt-dlp engine
  // already used for playback. JSON3/SRV3/WebVTT tracks are converted into the
  // existing YRC-compatible line/word model, so no renderer UI or visual effect
  // needs to be replaced. Uploaded captions are preferred, while original
  // automatic captions are used when they provide richer word offsets.
  if (provider === 'youtube' && id) {
    const captionTimed = await youtubeCaptionService.fetchForVideo(id, {
      getInfo: youtubeInfoViaYtDlp,
      userAgent: UA,
      languages: [query.language, providerConfig().language, 'vi', 'en'].filter(Boolean),
    });
    if (captionTimed) {
      return {
        ...captionTimed,
        metadataProvider: 'youtube',
        metadata,
        match: { score: 100, duration },
      };
    }
  }

  if (!trackName) return { lyric: '', tlyric: '', yrc: '', source: 'lrclib', plainLyric: '', metadataProvider: provider, metadata };

  // For Spotify playback, first request Spotify's own timed line data so the
  // lyric line changes use the same timestamps as the Spotify client. Any
  // rejection or unsupported track falls through to the existing LRCLIB path.
  if (provider === 'spotify') {
    const spotifyTimed = await spotifyNativeLyrics(metadata.spotifyId || id, metadata);
    if (spotifyTimed && spotifyTimed.lyric) return spotifyTimed;
  }

  const candidates = [];
  const addCandidate = (item) => {
    if (!item || typeof item !== 'object') return;
    const key = String(item.id || '') || [item.trackName, item.artistName, item.duration].join('|');
    if (candidates.some((existing) => (String(existing.id || '') || [existing.trackName, existing.artistName, existing.duration].join('|')) === key)) return;
    candidates.push(item);
  };

  // First try LRCLIB's exact endpoint with Spotify's full metadata.
  const exactParams = new URLSearchParams({ track_name: trackName });
  if (artistName) exactParams.set('artist_name', artistName);
  if (albumName) exactParams.set('album_name', albumName);
  if (duration > 0) exactParams.set('duration', String(duration));
  addCandidate(await fetchLrclibJson('/get', exactParams));

  // Then search several safe title/artist variants and score all returned
  // candidates instead of taking the first result blindly.
  const titleVariants = lyricTitleVariants(trackName);
  const artistVariants = lyricArtistVariants(artistName);
  const searches = [];
  titleVariants.slice(0, 3).forEach((title, titleIndex) => {
    const artists = artistVariants.length ? artistVariants.slice(0, titleIndex === 0 ? 2 : 1) : [''];
    artists.forEach((artist) => {
      const params = new URLSearchParams({ track_name: title });
      if (artist) params.set('artist_name', artist);
      searches.push(params);
    });
  });
  const searchResults = await Promise.all(searches.slice(0, 5).map((params) => fetchLrclibJson('/search', params).catch(() => [])));
  searchResults.forEach((list) => (Array.isArray(list) ? list : []).slice(0, 12).forEach(addCandidate));

  const targetMeta = { name: trackName, artist: artistName, album: albumName, durationSeconds: duration };
  const ranked = candidates
    .map((candidate) => {
      const durationMatch = lyricSync.durationCompatibility(candidate && candidate.duration, duration);
      return { candidate, score: scoreLyricCandidate(candidate, targetMeta), durationMatch };
    })
    .sort((a, b) => b.score - a.score);
  // Reject a same-title remix/live/edit whose duration is too far from the
  // exact Spotify/YouTube track. A wrong version is the main cause of lyrics
  // running progressively ahead or behind the audible song.
  const best = ranked.find((item) => item.score >= 48 && item.durationMatch.compatible) || null;
  const data = best ? best.candidate : {};
  const match = best ? {
    id: data.id || null,
    score: Math.round(best.score),
    track: data.trackName || data.name || '',
    artist: data.artistName || '',
    album: data.albumName || '',
    duration: Number(data.duration || 0),
    synced: !!data.syncedLyrics,
  } : null;
  const nativeYouTubePlainLyric = provider === 'youtube' && youtubeMusicLyric
    ? String(youtubeMusicLyric.plainLyric || '').trim()
    : '';
  const baseResult = {
    lyric: data.syncedLyrics || '',
    tlyric: '',
    yrc: '',
    // Prefer the text attached to the exact YouTube Music video. LRCLIB synced
    // timing is still kept when available, while native YouTube Music text is
    // used for display/fallback and for local word alignment.
    plainLyric: nativeYouTubePlainLyric || data.plainLyrics || '',
    instrumental: !!data.instrumental,
    source: nativeYouTubePlainLyric ? 'youtube-music' : 'lrclib',
    metadataProvider: provider === 'spotify' ? 'spotify' : 'youtube',
    metadata,
    match,
    youtubeMusicLyrics: nativeYouTubePlainLyric ? {
      available: true,
      provider: youtubeMusicLyric.provider || 'YouTube Music',
      syncType: youtubeMusicLyric.syncType || 'UNSYNCED',
    } : undefined,
  };

  // When YouTube has no usable caption track, keep YouTube Music/LRCLIB text
  // visible immediately and start a local forced-alignment job in the background. whisper.cpp
  // generates word timestamps from the exact YouTube audio, while the trusted
  // LRCLIB text supplies the words shown by the current renderer. The client
  // polls this same endpoint until the cached word-aligned result is ready.
  if (provider === 'youtube' && id && (baseResult.lyric || baseResult.plainLyric)) {
    const alignment = await youtubeForcedAlignmentService.request(id, {
      syncedLyric: baseResult.lyric,
      plainLyric: baseResult.plainLyric,
      duration,
      language: query.language || providerConfig().language || 'auto',
      track: trackName,
      artist: artistName,
    }, {
      getYtDlpEngine: prepareYouTubeEngine,
      findNodeRuntime,
    });
    if (alignment && alignment.status === 'ready' && alignment.result) {
      return {
        ...alignment.result,
        metadataProvider: 'youtube',
        metadata,
        match,
        alignment: { status: 'ready', stage: 'ready' },
      };
    }
    baseResult.alignment = alignment || { status: 'failed', stage: 'unknown', message: 'Alignment service is unavailable' };
  }
  return baseResult;
}

async function youtubeComments(videoId, limit = 20) {
  try {
    const yt = await getYouTubeClient();
    const page = await yt.getComments(String(videoId));
    const list = Array.from(page.contents || page.comments || []).slice(0, limit);
    return list.map((comment, index) => ({
      id: comment.comment_id || `${videoId}-${index}`,
      content: comment.content && comment.content.toString ? comment.content.toString() : String(comment.content || ''),
      likedCount: Number(comment.vote_count || 0),
      time: 0,
      user: comment.author ? {
        id: comment.author.id || '',
        nickname: comment.author.name || '',
        avatar: comment.author.thumbnails && comment.author.thumbnails[0] && comment.author.thumbnails[0].url || '',
      } : null,
    })).filter((comment) => comment.content);
  } catch (_) {
    return [];
  }
}



function mapYoutubePodcastRadio(song) {
  if (!song) return null;
  const videoId = String(song.id || song.mid || '');
  if (!videoId) return null;
  const radio = {
    id: `video:${videoId}`,
    rid: `video:${videoId}`,
    name: song.name || 'YouTube Podcast',
    cover: song.cover || '',
    desc: song.album || '',
    djName: song.artist || 'YouTube',
    category: 'YouTube Podcast',
    programCount: 1,
    subCount: 0,
    provider: 'youtube',
    videoId,
  };
  youtubePodcastCache.set(radio.id, { radio, song });
  return radio;
}

function mapYoutubePodcastProgram(song, radio) {
  if (!song) return null;
  const videoId = String(song.id || song.mid || radio && radio.videoId || '');
  if (!videoId) return null;
  return {
    type: 'podcast',
    source: 'podcast',
    provider: 'qq',
    realProvider: 'youtube',
    id: videoId,
    mid: videoId,
    songmid: videoId,
    programId: `youtube:${videoId}`,
    radioId: radio && radio.id || `video:${videoId}`,
    name: song.name || radio && radio.name || 'YouTube Podcast',
    artist: song.artist || radio && radio.djName || 'YouTube',
    artists: song.artists || [],
    artistId: song.artistId || '',
    album: radio && radio.name || song.album || 'YouTube Podcast',
    cover: song.cover || radio && radio.cover || '',
    duration: Math.max(0, Number(song.duration || 0)) * (Number(song.duration || 0) > 100000 ? 1 : 1000),
    fee: 0,
    playable: true,
    djName: song.artist || radio && radio.djName || 'YouTube',
    radioName: radio && radio.name || 'YouTube Podcast',
    desc: song.album || radio && radio.desc || '',
    createTime: 0,
    serialNum: 1,
  };
}

async function youtubePodcastSearch(query, limit = 18) {
  const term = String(query || '').trim() || (providerConfig().language === 'en' ? 'popular podcast' : 'podcast Việt Nam');
  const songs = await youtubeSearch(`${term} podcast`, Math.max(6, Math.min(30, Number(limit) || 18)));
  return songs.map(mapYoutubePodcastRadio).filter(Boolean);
}

async function youtubePodcastPrograms(id) {
  const key = String(id || '');
  let cached = youtubePodcastCache.get(key);
  if (!cached && key.startsWith('video:')) {
    const videoId = key.slice(6);
    try {
      const yt = await getYouTubeClient();
      const info = await yt.getBasicInfo(videoId);
      const basic = info && info.basic_info || {};
      const song = {
        id: videoId,
        mid: videoId,
        name: basic.title || 'YouTube Podcast',
        artist: basic.author || basic.channel && basic.channel.name || 'YouTube',
        artistId: basic.channel_id || '',
        album: 'YouTube Podcast',
        duration: Number(basic.duration || 0),
        cover: basic.thumbnail && basic.thumbnail[0] && basic.thumbnail[0].url || '',
        provider: 'qq',
        realProvider: 'youtube',
      };
      const radio = mapYoutubePodcastRadio(song);
      cached = youtubePodcastCache.get(radio.id);
    } catch (_) {}
  }
  if (!cached) return { radio: { id: key, rid: key, name: 'YouTube Podcast', djName: 'YouTube', programCount: 0 }, programs: [] };
  return { radio: cached.radio, programs: [mapYoutubePodcastProgram(cached.song, cached.radio)].filter(Boolean) };
}

async function discoverHome() {
  const status = await spotifyLoginStatus();
  if (!status.loggedIn) {
    return {
      loggedIn: false,
      user: null,
      dailySongs: [],
      playlists: [],
      podcasts: [],
      mode: 'starter',
      updatedAt: Date.now(),
    };
  }
  const [top, playlists] = await Promise.all([
    spotifyApi('/me/top/tracks?limit=12&time_range=medium_term').catch(() => ({ items: [] })),
    spotifyUserPlaylists(10).catch(() => []),
  ]);
  return {
    loggedIn: true,
    user: { userId: status.userId, nickname: status.nickname, avatar: status.avatar },
    dailySongs: ((top && top.items) || []).map(mapSpotifyTrack),
    playlists: playlists.slice(0, 10),
    podcasts: [],
    updatedAt: Date.now(),
  };
}

function htmlEscape(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function spotifyCallbackHtml(success, message) {
  const config = providerConfig();
  const pending = success && message === 'profile_pending';
  const title = success ? (pending ? 'Spotify authorization accepted' : 'Spotify connected') : 'Spotify connection failed';
  const vi = success
    ? (pending ? 'Spotify đã xác thực. ShinaYuu Music đang tải hồ sơ tài khoản theo giới hạn của Spotify. Hãy quay lại ứng dụng.' : 'Đã kết nối Spotify. Bạn có thể đóng cửa sổ này.')
    : `Không thể kết nối Spotify: ${message || ''}`;
  const en = success
    ? (pending ? 'Spotify authorization was accepted. ShinaYuu Music is loading your account profile while respecting Spotify rate limits. Return to the app.' : 'Spotify is connected. You can close this window.')
    : `Spotify could not be connected: ${message || ''}`;
  return `<!doctype html><html lang="${config.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:0;background:#070809;color:#fff;font-family:Inter,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh}.card{width:min(560px,88vw);padding:34px;border:1px solid rgba(255,255,255,.12);border-radius:22px;background:rgba(255,255,255,.055);box-shadow:0 24px 80px rgba(0,0,0,.45)}h1{font-size:25px;margin:0 0 12px}p{line-height:1.7;color:rgba(255,255,255,.72)}.dot{width:12px;height:12px;border-radius:50%;background:${success ? '#1ed760' : '#ff6b6b'};box-shadow:0 0 26px currentColor;display:inline-block;margin-right:9px}</style></head><body><div class="card"><h1><span class="dot"></span>${htmlEscape(title)}</h1><p>${htmlEscape(config.language === 'en' ? en : vi)}</p></div><script>setTimeout(()=>window.close(),1800)</script></body></html>`;
}

module.exports = {
  providerConfig,
  updateProviderConfig,
  publicProviderConfig,
  spotifyLoginStatus,
  beginSpotifyLogin,
  completeSpotifyLogin,
  spotifyLoginResult,
  clearSpotifyToken,
  spotifySearch,
  spotifyUserPlaylists,
  spotifyPlaylistTracks,
  spotifyLikedCheck,
  spotifySetLiked,
  spotifyCreatePlaylist,
  spotifyAddSongToPlaylist,
  spotifyArtistDetail,
  youtubeSearch,
  youtubePlaylistTracks,
  youtubeArtistDetail,
  resolveSpotifyPlayback,
  resolveYouTubePlayback,
  spotifyPlayerToken,
  spotifyAudioAnalysis,
  spotifyDevices,
  spotifyPlaybackState,
  spotifyTransferPlayback,
  spotifyStartPlayback,
  spotifyPausePlayback,
  spotifyResumePlayback,
  spotifySeekPlayback,
  spotifySetPlaybackVolume,
  spotifyNativeLyrics,
  normalizeSpotifyLyricsPayload,
  youtubeMusicNativeLyrics,
  normalizeYouTubeMusicLyricsShelf,
  normalizeYouTubeMusicLyricsText,
  lyricsFor,
  youtubeComments,
  youtubePodcastSearch,
  youtubePodcastPrograms,
  discoverHome,
  spotifyCallbackHtml,
  songMetadata,
  spotifyRedirectUri,
  prepareYouTubeEngine,
  youtubeEngineStatus,
  getYouTubeStreamDescriptor,
};
