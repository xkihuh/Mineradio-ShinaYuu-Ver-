'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const UA = 'ShinaYuu Music/1.1.7.3';
const CONFIG_FILE = process.env.MUSIC_SOURCE_CONFIG_FILE || path.join(__dirname, '.music-sources.json');
const TOKEN_FILE = process.env.SPOTIFY_TOKEN_FILE || path.join(__dirname, '.spotify-token.json');
const YOUTUBE_TOKEN_FILE = process.env.YOUTUBE_TOKEN_FILE || path.join(path.dirname(TOKEN_FILE), 'youtube-token.json');
const YOUTUBE_DEVICE_TOKEN_FILE = process.env.YOUTUBE_DEVICE_TOKEN_FILE || path.join(path.dirname(YOUTUBE_TOKEN_FILE), 'youtube-device-token.json');
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
const youtubeRecommendCache = new Map();
const youtubeMusicReferenceCache = new Map();
const spotifyAuthRequests = new Map();
const spotifyAuthResults = new Map();
const youtubeAuthRequests = new Map();
const youtubeAuthResults = new Map();
const youtubeDeviceAuthClients = new Map();
const spotifyAudioAnalysisCache = new Map();
const spotifyLyricsCache = new Map();
const spotifyLyricsFailureCache = new Map();
const spotifyYoutubeLyricsCache = new Map();
let spotifySessionLyricsProvider = null;
const youtubeMusicLyricsCache = new Map();
const youtubeStreamTokens = new Map();
const youtubeAudioDescriptorCache = new Map();
const youtubeVideoDescriptorCache = new Map();
const spotifyVisualBackgroundCache = new Map();
const youtubeYtDlpInfoCache = new Map();
const youtubeCaptionService = youtubeCaptions.createProvider({ userAgent: UA });
const youtubeForcedAlignmentService = youtubeForcedAligner.createProvider({
  appDataDir,
  runChild,
  userAgent: UA,
});
let youtubeClientPromise = null;
let youtubeSearchClientPromise = null;
let youtubeAccountClientPromise = null;
let youtubeAccountClientKey = '';
let youtubeCookieProvider = null;
let youtubePlaylistSyncState = { updatedAt: 0, authMode: '', count: 0, sources: {}, failures: [] };
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
const YOUTUBE_AUDIO_DESCRIPTOR_TTL = 8 * 60 * 1000;
const YOUTUBE_VIDEO_DESCRIPTOR_TTL = 8 * 60 * 1000;
const SPOTIFY_VISUAL_BACKGROUND_TTL = 30 * 60 * 1000;
const YOUTUBE_VIDEO_DESCRIPTOR_CACHE_LIMIT = 12;
const SPOTIFY_VISUAL_BACKGROUND_CACHE_LIMIT = 80;


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

function bundledProviderConfig() {
  try {
    const pkg = require('./package.json');
    return pkg && pkg.shinayuu || {};
  } catch (_) {
    return {};
  }
}

function providerConfig() {
  const stored = readJson(CONFIG_FILE, {});
  const bundled = bundledProviderConfig();
  const bundledYoutube = bundled.youtube || {};
  return {
    spotifyClientId: String(process.env.SPOTIFY_CLIENT_ID || stored.spotifyClientId || '').trim(),
    spotifyMarket: String(process.env.SPOTIFY_MARKET || stored.spotifyMarket || 'VN').trim().toUpperCase(),
    youtubeClientId: String(process.env.YOUTUBE_CLIENT_ID || stored.youtubeClientId || bundledYoutube.oauthClientId || '').trim(),
    youtubeClientSecret: String(process.env.YOUTUBE_CLIENT_SECRET || stored.youtubeClientSecret || bundledYoutube.oauthClientSecret || '').trim(),
    language: String(stored.language || 'vi').trim().toLowerCase() === 'en' ? 'en' : 'vi',
  };
}

function updateProviderConfig(input) {
  const previous = providerConfig();
  const next = {
    spotifyClientId: String(input && input.spotifyClientId != null ? input.spotifyClientId : previous.spotifyClientId).trim(),
    spotifyMarket: String(input && input.spotifyMarket != null ? input.spotifyMarket : previous.spotifyMarket).trim().toUpperCase() || 'VN',
    youtubeClientId: String(input && input.youtubeClientId != null ? input.youtubeClientId : previous.youtubeClientId).trim(),
    youtubeClientSecret: String(input && input.youtubeClientSecret != null ? input.youtubeClientSecret : previous.youtubeClientSecret).trim(),
    language: String(input && input.language != null ? input.language : previous.language).trim().toLowerCase() === 'en' ? 'en' : 'vi',
  };
  writeJson(CONFIG_FILE, next);
  if (previous.spotifyClientId !== next.spotifyClientId) clearSpotifyToken();
  if (previous.youtubeClientId !== next.youtubeClientId || previous.youtubeClientSecret !== next.youtubeClientSecret) clearYouTubeToken();
  return publicProviderConfig(next);
}



function youtubeRedirectUri(baseUrl = '') {
  const configured = String(process.env.YOUTUBE_REDIRECT_URI || '').trim();
  if (configured) return configured;
  let port = Number(process.env.PORT || 43821) || 43821;
  try {
    const parsed = new URL(baseUrl || `http://127.0.0.1:${port}`);
    port = Number(parsed.port || port) || port;
  } catch (_) {}
  return `http://127.0.0.1:${port}/api/youtube/callback`;
}

function youtubeToken() {
  return readJson(YOUTUBE_TOKEN_FILE, {});
}

function writeYouTubeToken(value) {
  const target = path.resolve(YOUTUBE_TOKEN_FILE);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(value || {}, null, 2), 'utf8');
    try { fs.renameSync(temporary, target); }
    catch (_) { fs.copyFileSync(temporary, target); fs.unlinkSync(temporary); }
    return true;
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
    console.warn('[YouTubeAuth] token save failed:', error.message);
    return false;
  }
}

function youtubeDeviceToken() {
  return readJson(YOUTUBE_DEVICE_TOKEN_FILE, {});
}

function writeYouTubeDeviceToken(value) {
  return writeJson(YOUTUBE_DEVICE_TOKEN_FILE, value || {});
}

function clearYouTubeToken() {
  try { if (fs.existsSync(YOUTUBE_TOKEN_FILE)) fs.unlinkSync(YOUTUBE_TOKEN_FILE); } catch (_) {}
  try { if (fs.existsSync(YOUTUBE_DEVICE_TOKEN_FILE)) fs.unlinkSync(YOUTUBE_DEVICE_TOKEN_FILE); } catch (_) {}
  youtubeAuthRequests.clear();
  youtubeAuthResults.clear();
  youtubeDeviceAuthClients.clear();
  youtubeAccountClientPromise = null;
  youtubeAccountClientKey = '';
}

function invalidateYouTubeAccountSession() {
  youtubeAccountClientPromise = null;
  youtubeAccountClientKey = '';
}

function setYouTubeCookieProvider(provider) {
  youtubeCookieProvider = typeof provider === 'function' ? provider : null;
  invalidateYouTubeAccountSession();
}

async function youtubeBrowserCookie() {
  if (!youtubeCookieProvider) return '';
  try {
    return String(await youtubeCookieProvider() || '').trim();
  } catch (error) {
    console.warn('[YouTubeCookieAuth] cookie provider failed:', error.message || error);
    return '';
  }
}

function youtubeCookieLooksSignedIn(cookie) {
  const text = String(cookie || '');
  const hasApiSecret = /(?:^|;\s*)(?:SAPISID|__Secure-1PAPISID|__Secure-3PAPISID)=/i.test(text);
  const hasSession = /(?:^|;\s*)(?:SID|__Secure-1PSID|__Secure-3PSID)=/i.test(text);
  return hasApiSecret && hasSession;
}

function cleanYouTubeAuthTransactions() {
  const now = Date.now();
  for (const [key, value] of youtubeAuthRequests) {
    if (!value || now - Number(value.createdAt || 0) > SPOTIFY_AUTH_TTL) youtubeAuthRequests.delete(key);
  }
  for (const [key, value] of youtubeAuthResults) {
    if (!value || now - Number(value.createdAt || 0) > SPOTIFY_AUTH_TTL) youtubeAuthResults.delete(key);
  }
}

async function youtubeTokenRequest(params) {
  const response = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error_description || data.error || `YouTube OAuth HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function validYouTubeToken(required = true) {
  const config = providerConfig();
  const current = youtubeToken();
  if (!current.access_token && !current.refresh_token) {
    if (!required) return null;
    throw Object.assign(new Error('YOUTUBE_LOGIN_REQUIRED'), { status: 401 });
  }
  if (current.access_token && Number(current.expiresAt || 0) > Date.now() + 60000) return current;
  if (!current.refresh_token) {
    clearYouTubeToken();
    if (!required) return null;
    throw Object.assign(new Error('YOUTUBE_LOGIN_REQUIRED'), { status: 401 });
  }
  const refreshed = await youtubeTokenRequest({
    client_id: config.youtubeClientId,
    ...(config.youtubeClientSecret ? { client_secret: config.youtubeClientSecret } : {}),
    refresh_token: current.refresh_token,
    grant_type: 'refresh_token',
  });
  const merged = {
    ...current,
    ...refreshed,
    refresh_token: refreshed.refresh_token || current.refresh_token,
    obtainedAt: Date.now(),
    expiresAt: Date.now() + Math.max(30, Number(refreshed.expires_in || 3600) - 30) * 1000,
  };
  if (!writeYouTubeToken(merged)) throw Object.assign(new Error('YOUTUBE_TOKEN_SAVE_FAILED'), { status: 500 });
  return merged;
}

function beginYouTubeOfficialLogin(baseUrl) {
  const config = providerConfig();
  if (!config.youtubeClientId) throw Object.assign(new Error('YOUTUBE_CLIENT_ID_REQUIRED'), { status: 400 });
  cleanYouTubeAuthTransactions();
  const redirectUri = youtubeRedirectUri(baseUrl);
  const state = randomUrlSafe(18);
  const verifier = randomUrlSafe(64);
  const challenge = base64Url(sha256(verifier));
  youtubeAuthRequests.set(state, { verifier, redirectUri, createdAt: Date.now() });
  youtubeAuthResults.set(state, { state, complete: false, ok: true, stage: 'authorization', createdAt: Date.now() });
  const params = new URLSearchParams({
    client_id: config.youtubeClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: 'https://www.googleapis.com/auth/youtube.readonly openid profile email',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  return {
    ok: true,
    provider: 'youtube',
    authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    redirectUri,
    state,
  };
}


function youtubeNodeText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value.text === 'string') return value.text.trim();
  if (value.name != null && value.name !== value) return youtubeNodeText(value.name);
  try {
    const text = value.toString();
    return text && text !== '[object Object]' && text !== 'N/A' ? String(text).trim() : '';
  } catch (_) { return ''; }
}

function youtubeNodeThumbnail(value, depth = 0) {
  if (!value || depth > 5) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    const items = value.filter(Boolean).slice().sort((a, b) => Number(a && a.width || 0) - Number(b && b.width || 0));
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const resolved = youtubeNodeThumbnail(items[index], depth + 1);
      if (resolved) return resolved;
    }
    return '';
  }
  const direct = String(value.url || value.src || '').trim();
  if (direct) return direct;
  const nested = [
    value.thumbnails, value.thumbnail, value.account_photo, value.image,
    value.primary_thumbnail, value.content_image, value.thumbnail_renderer,
  ];
  for (const candidate of nested) {
    const resolved = youtubeNodeThumbnail(candidate, depth + 1);
    if (resolved) return resolved;
  }
  return '';
}

function youtubeNodeCount(value) {
  const text = youtubeNodeText(value).replace(/,/g, '');
  const compact = text.match(/([0-9]+(?:\.[0-9]+)?)\s*([KMB])/i);
  if (compact) {
    const factor = { K: 1e3, M: 1e6, B: 1e9 }[compact[2].toUpperCase()] || 1;
    return Math.round(Number(compact[1]) * factor);
  }
  const digits = text.match(/[0-9]+/g);
  return digits ? Number(digits.join('')) : 0;
}

async function createYouTubeAccountClient(credentials, options = {}) {
  const yt = await import('youtubei.js');
  if (yt.Platform && yt.Platform.shim) yt.Platform.shim.eval = async (data) => new Function(data.output)();
  const cookie = String(options.cookie || '').trim();
  const useCookie = !!cookie;
  const client = await yt.Innertube.create({
    lang: providerConfig().language === 'en' ? 'en' : 'vi',
    location: providerConfig().spotifyMarket || 'VN',
    retrieve_player: false,
    enable_session_cache: false,
    generate_session_locally: useCookie,
    client_type: useCookie ? 'WEB' : 'TV',
    ...(useCookie ? { cookie } : {}),
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  client.__shinayuuAuthMode = useCookie ? 'cookie' : 'device';
  if (useCookie) return client;
  client.session.on('update-credentials', ({ credentials: next }) => {
    if (next) writeYouTubeDeviceToken(next);
  });
  if (credentials && credentials.access_token) await client.session.signIn({ ...credentials });
  return client;
}

async function getYouTubeAccountClient(required = false) {
  const cookie = await youtubeBrowserCookie();
  const credentials = youtubeDeviceToken();
  const hasCookie = youtubeCookieLooksSignedIn(cookie);
  // When the desktop cookie bridge is installed, never silently fall back to
  // the old TV OAuth token. That token can report a signed-in account while
  // WEB/YouTube Music libraries remain empty. Non-desktop hosts without a
  // cookie provider can still use device OAuth as a compatibility fallback.
  const hasDevice = !youtubeCookieProvider && !!(credentials && credentials.access_token);
  if (!hasCookie && !hasDevice) {
    if (required) throw Object.assign(new Error('YOUTUBE_LOGIN_REQUIRED'), { status: 401 });
    return null;
  }
  const key = hasCookie
    ? `cookie:${crypto.createHash('sha256').update(cookie).digest('hex').slice(0, 24)}`
    : `device:${String(credentials.access_token).slice(-24)}`;
  if (!youtubeAccountClientPromise || youtubeAccountClientKey !== key) {
    youtubeAccountClientKey = key;
    youtubeAccountClientPromise = createYouTubeAccountClient(hasCookie ? null : credentials, { cookie: hasCookie ? cookie : '' }).catch((error) => {
      youtubeAccountClientPromise = null;
      youtubeAccountClientKey = '';
      throw error;
    });
  }
  try { return await youtubeAccountClientPromise; }
  catch (error) {
    if (required) throw error;
    return null;
  }
}

async function youtubeDeviceLoginStatus() {
  const client = await getYouTubeAccountClient(false);
  if (!client || !client.session || !client.session.logged_in) return null;
  let nickname = 'YouTube';
  let userId = '';
  let avatar = '';
  try {
    const info = await client.account.getInfo();
    const entries = info && info.contents && Array.from(info.contents.contents || []) || [];
    const account = entries.find((item) => item && item.is_selected) || entries.find((item) => item && item.account_name) || {};
    nickname = youtubeNodeText(account.account_name) || nickname;
    userId = youtubeNodeText(account.channel_handle) || youtubeNodeText(account.account_byline) || '';
    avatar = youtubeNodeThumbnail(account.account_photo);
  } catch (error) {
    console.warn('[YouTubeDeviceAuth] account profile unavailable:', error.message);
  }
  return {
    provider: 'youtube', loggedIn: true, configured: true, quickLoginAvailable: true,
    authMode: client.__shinayuuAuthMode === 'cookie' ? 'cookie' : 'device', userId, nickname, avatar, redirectUri: '',
  };
}

async function beginYouTubeLogin(baseUrl = '', options = {}) {
  const requestedMode = String(options && options.mode || 'official').toLowerCase();
  if (requestedMode !== 'official') {
    console.warn('[YouTubeAuth] legacy embedded/device login requested; using supported desktop OAuth instead.');
  }
  return beginYouTubeOfficialLogin(baseUrl);
}

function youtubeNodeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try { return Array.from(value).filter(Boolean); } catch (_) { return []; }
}

function youtubeMetadataText(value) {
  if (!value) return '';
  const direct = youtubeNodeText(value);
  if (direct) return direct;
  const rows = youtubeNodeArray(value.metadata_rows || value.metadataRows);
  const chunks = [];
  for (const row of rows) {
    const parts = youtubeNodeArray(row && (row.metadata_parts || row.metadataParts));
    for (const part of parts) {
      const text = youtubeNodeText(part && part.text);
      if (text) chunks.push(text);
    }
  }
  return chunks.join(' · ');
}

function normalizeYouTubePlaylistId(value) {
  let id = youtubeNodeText(value);
  if (!id) return '';
  try { id = decodeURIComponent(id); } catch (_) {}
  const listMatch = id.match(/[?&]list=([^&#]+)/i);
  if (listMatch) id = listMatch[1];
  id = id.replace(/^https?:\/\/[^/]+\//i, '').replace(/^playlist\?list=/i, '').trim();
  if (id.startsWith('VL')) id = id.slice(2);
  if (/^FEmusic_liked_videos$/i.test(id)) return 'LM';
  if (/^FEliked$/i.test(id)) return 'LL';
  if (/^FEwatch_later$/i.test(id)) return 'WL';
  if (!id || /\s/.test(id) || /^UC[\w-]{20,}$/i.test(id)) return '';
  return id;
}

function youtubePlaylistIdFromNode(item) {
  if (!item) return '';
  const tap = item.renderer_context && item.renderer_context.command_context && item.renderer_context.command_context.on_tap;
  const candidates = [
    item.id, item.playlist_id, item.playlistId, item.content_id, item.contentId,
    item.endpoint && item.endpoint.payload && (item.endpoint.payload.playlistId || item.endpoint.payload.browseId),
    item.endpoint && item.endpoint.metadata && item.endpoint.metadata.url,
    tap && tap.payload && (tap.payload.playlistId || tap.payload.browseId),
    tap && tap.metadata && tap.metadata.url,
    item.navigation_endpoint && item.navigation_endpoint.payload && (item.navigation_endpoint.payload.playlistId || item.navigation_endpoint.payload.browseId),
  ];
  for (const candidate of candidates) {
    const id = normalizeYouTubePlaylistId(candidate);
    if (id) return id;
  }
  return '';
}

function youtubePlaylistCreator(item) {
  const direct = youtubeNodeText(item && item.author);
  if (direct) return direct;
  const byline = youtubeNodeText(item && (item.owner || item.channel || item.creator));
  if (byline) return byline;
  const metadata = youtubeMetadataText(item && item.metadata && item.metadata.metadata);
  if (metadata) {
    const parts = metadata.split(' · ').map((part) => part.trim()).filter(Boolean);
    const creator = parts.find((part) => !/\b(?:videos?|songs?|tracks?|bài hát|video)\b/i.test(part) && !/^\d/.test(part));
    if (creator) return creator;
  }
  const subtitle = youtubeNodeText(item && item.subtitle);
  if (subtitle) {
    const parts = subtitle.split(/\s*[·•]\s*/).map((part) => part.trim()).filter(Boolean);
    const creator = parts.find((part) => !/\b(?:playlist|videos?|songs?|tracks?|bài hát|video)\b/i.test(part) && !/^\d/.test(part));
    if (creator) return creator;
  }
  return 'YouTube';
}

function youtubePlaylistFromNode(item) {
  const id = youtubePlaylistIdFromNode(item);
  if (!id) return null;
  const name = youtubeNodeText(item.title || item.name || item.metadata && item.metadata.title) || 'YouTube playlist';
  const metadataText = youtubeMetadataText(item.metadata && item.metadata.metadata) || youtubeNodeText(item.subtitle);
  const count = youtubeNodeCount(item.video_count || item.video_count_short || item.item_count || item.song_count || metadataText);
  return {
    id, provider: 'qq', realProvider: 'youtube',
    name,
    cover: youtubeNodeThumbnail(item.thumbnails || item.thumbnail || item.sidebar_thumbnails || item.content_image || item.image),
    trackCount: count,
    creator: youtubePlaylistCreator(item),
    description: youtubeNodeText(item.description), authMode: 'device',
  };
}

function youtubePlaylistNodesFromPage(page) {
  if (!page) return [];
  const nodes = [];
  const add = (value) => nodes.push(...youtubeNodeArray(value));
  add(page.playlists);
  const contents = page.page_contents || page.contents;
  add(contents && (contents.items || contents.contents));
  for (const shelf of youtubeNodeArray(page.shelves)) {
    add(shelf && (shelf.items || shelf.contents));
    add(shelf && shelf.content && (shelf.content.items || shelf.content.contents));
  }
  if (page.playlists_section) add(page.playlists_section.contents);
  for (const section of youtubeNodeArray(page.sections)) {
    const title = youtubeNodeText(section && section.title);
    if (section && (section.type === 'PLAYLISTS' || /playlist|danh sách phát/i.test(title))) add(section.contents);
  }
  return nodes;
}

function youtubeMusicLibraryNodes(library) {
  const nodes = [];
  for (const section of youtubeNodeArray(library && library.contents)) {
    const items = youtubeNodeArray(section && (section.items || section.contents));
    nodes.push(...items.filter((item) => item && (item.item_type === 'playlist' || youtubePlaylistIdFromNode(item))));
  }
  return nodes;
}

function mergeYouTubePlaylists(nodes, limit) {
  const merged = [];
  const seen = new Set();
  for (const node of nodes) {
    let playlist = null;
    if (node && node.realProvider === 'youtube' && node.id && node.name) {
      const normalizedId = normalizeYouTubePlaylistId(node.id);
      if (normalizedId) playlist = { ...node, id: normalizedId, provider: 'qq', realProvider: 'youtube' };
    } else {
      playlist = youtubePlaylistFromNode(node);
    }
    if (!playlist || seen.has(playlist.id)) continue;
    seen.add(playlist.id);
    merged.push(playlist);
    if (merged.length >= limit) break;
  }
  return merged;
}

function youtubeRawText(value, depth = 0) {
  if (value == null || depth > 8) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map((item) => youtubeRawText(item, depth + 1)).filter(Boolean).join(' ').trim();
  if (typeof value !== 'object') return '';
  for (const key of ['simpleText', 'text', 'content', 'label']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  if (Array.isArray(value.runs)) {
    const text = value.runs.map((run) => youtubeRawText(run, depth + 1)).filter(Boolean).join('').trim();
    if (text) return text;
  }
  for (const key of ['title', 'headline', 'primaryText', 'subtitle', 'secondaryText', 'lockupMetadataViewModel', 'contentMetadataViewModel']) {
    const text = youtubeRawText(value[key], depth + 1);
    if (text) return text;
  }
  return '';
}

function youtubeRawThumbnail(value, depth = 0) {
  if (!value || depth > 10) return '';
  if (typeof value === 'string') return /^https?:/i.test(value) ? value : '';
  if (Array.isArray(value)) {
    const candidates = value.map((item) => ({ item, width: Number(item && item.width || 0) })).sort((a, b) => b.width - a.width);
    for (const candidate of candidates) {
      const found = youtubeRawThumbnail(candidate.item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  if (typeof value.url === 'string' && value.url.trim()) return value.url.trim();
  const priority = ['thumbnails', 'thumbnail', 'image', 'contentImage', 'primaryThumbnail', 'thumbnailRenderer', 'musicThumbnailRenderer', 'collectionThumbnailViewModel', 'thumbnailViewModel'];
  for (const key of priority) {
    const found = youtubeRawThumbnail(value[key], depth + 1);
    if (found) return found;
  }
  for (const child of Object.values(value)) {
    const found = youtubeRawThumbnail(child, depth + 1);
    if (found) return found;
  }
  return '';
}

function youtubeRawBrowseId(value, depth = 0) {
  if (!value || depth > 9) return '';
  if (typeof value === 'string') return normalizeYouTubePlaylistId(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = youtubeRawBrowseId(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const key of ['playlistId', 'playlist_id', 'contentId', 'content_id', 'browseId']) {
    const found = normalizeYouTubePlaylistId(value[key]);
    if (found) return found;
  }
  for (const key of ['navigationEndpoint', 'endpoint', 'onTap', 'innertubeCommand', 'command', 'commandContext', 'rendererContext', 'browseEndpoint', 'watchEndpoint', 'urlEndpoint']) {
    const found = youtubeRawBrowseId(value[key], depth + 1);
    if (found) return found;
  }
  return '';
}

function youtubeRawMetadataText(value) {
  const pieces = [];
  const seen = new Set();
  function walk(node, depth) {
    if (!node || depth > 8 || seen.has(node)) return;
    if (typeof node === 'object') seen.add(node);
    const text = youtubeRawText(node);
    if (text && text.length < 240) pieces.push(text);
    if (Array.isArray(node)) node.forEach((item) => walk(item, depth + 1));
    else if (typeof node === 'object') {
      for (const value of Object.values(node)) walk(value, depth + 1);
    }
  }
  walk(value, 0);
  return pieces.filter(Boolean).join(' · ');
}

function youtubeRawPlaylistFromObject(item) {
  if (!item || typeof item !== 'object') return null;
  const endpoint = item.navigationEndpoint || item.endpoint || item.rendererContext || item.renderer_context || {};
  const pageType = youtubeRawText(
    item.contentType || item.content_type || item.item_type ||
    endpoint && endpoint.browseEndpoint && endpoint.browseEndpoint.browseEndpointContextSupportedConfigs && endpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig && endpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType
  ).toUpperCase();
  const id = youtubeRawBrowseId(item);
  const hasPlaylistMarker = !!(
    item.playlistId || item.playlist_id ||
    /PLAYLIST/.test(pageType) ||
    /^VL?(?:PL|LL|LM|WL|RD|UU|OLAK5uy_)/i.test(String(item.contentId || item.content_id || item.browseId || ''))
  );
  if (!id || !hasPlaylistMarker || /ALBUM/.test(pageType)) return null;
  const title = youtubeRawText(item.title || item.headline || item.metadata && (item.metadata.title || item.metadata) || item.primaryText);
  if (!title) return null;
  const metadata = youtubeRawMetadataText(item.metadata || item.subtitle || item.shortBylineText || item.longBylineText || item);
  const count = youtubeNodeCount(item.videoCountText || item.videoCountShortText || item.thumbnailText || item.itemCount || item.songCount || metadata);
  let creator = youtubeRawText(item.shortBylineText || item.longBylineText || item.ownerText || item.subtitle);
  if (creator) creator = creator.split(/\s*[·•]\s*/).find((part) => part && !/^\d/.test(part) && !/videos?|songs?|tracks?|playlist|bài hát/i.test(part)) || creator;
  return {
    id, provider: 'qq', realProvider: 'youtube', authMode: 'session',
    name: title,
    cover: youtubeRawThumbnail(item.thumbnail || item.thumbnails || item.thumbnailRenderer || item.contentImage || item.image),
    trackCount: count,
    creator: creator || 'YouTube',
    description: youtubeRawText(item.description || item.descriptionText),
  };
}

function collectYouTubeRawPlaylists(root, output = [], seen = new Set(), depth = 0) {
  if (!root || depth > 18) return output;
  if (typeof root !== 'object') return output;
  if (seen.has(root)) return output;
  seen.add(root);
  const playlist = youtubeRawPlaylistFromObject(root);
  if (playlist) output.push(playlist);
  if (Array.isArray(root)) {
    for (const item of root) collectYouTubeRawPlaylists(item, output, seen, depth + 1);
  } else {
    for (const value of Object.values(root)) collectYouTubeRawPlaylists(value, output, seen, depth + 1);
  }
  return output;
}

function collectYouTubeContinuationTokens(root, output = new Set(), seen = new Set(), depth = 0) {
  if (!root || depth > 18 || typeof root !== 'object') return output;
  if (seen.has(root)) return output;
  seen.add(root);
  const continuationCandidates = [
    root.continuation,
    root.continuationCommand && root.continuationCommand.token,
    root.continuationEndpoint && root.continuationEndpoint.continuationCommand && root.continuationEndpoint.continuationCommand.token,
    root.nextContinuationData && root.nextContinuationData.continuation,
    root.reloadContinuationData && root.reloadContinuationData.continuation,
  ];
  for (const token of continuationCandidates) {
    if (typeof token === 'string' && token.length > 24 && !/^https?:/i.test(token)) output.add(token);
  }
  if (Array.isArray(root)) {
    for (const item of root) collectYouTubeContinuationTokens(item, output, seen, depth + 1);
  } else {
    for (const value of Object.values(root)) collectYouTubeContinuationTokens(value, output, seen, depth + 1);
  }
  return output;
}

async function youtubeRawBrowsePlaylists(client, browseId, limit = 200, clientName = '') {
  const results = [];
  const queued = [];
  const used = new Set();
  let first = await client.actions.execute('/browse', { browseId, ...(clientName ? { client: clientName } : {}) });
  let data = first && first.data || first || {};
  for (let guard = 0; data && guard < 12 && results.length < limit * 2; guard += 1) {
    results.push(...collectYouTubeRawPlaylists(data));
    for (const token of collectYouTubeContinuationTokens(data)) if (!used.has(token)) queued.push(token);
    const token = queued.shift();
    if (!token) break;
    used.add(token);
    try {
      const next = await client.actions.execute('/browse', { continuation: token, ...(clientName ? { client: clientName } : {}) });
      data = next && next.data || next || {};
    } catch (error) {
      console.warn('[YouTubePlaylistSync] continuation failed:', browseId, error.message || error);
      break;
    }
  }
  return mergeYouTubePlaylists(results, limit);
}

async function youtubeDataApiWithAccessToken(endpoint, accessToken, options = {}) {
  const response = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': UA,
      ...(options.headers || {}),
    },
  }, 20000);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && data.error && data.error.message || `YouTube Data API HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}

function youtubePlaylistFromDataApiItem(item, fallbackCreator = 'YouTube') {
  const snippet = item && item.snippet || {};
  const thumbs = snippet.thumbnails || {};
  const id = normalizeYouTubePlaylistId(item && item.id);
  if (!id) return null;
  return {
    id, provider: 'qq', realProvider: 'youtube', authMode: 'device',
    name: snippet.title || 'YouTube playlist',
    cover: (thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default || {}).url || '',
    trackCount: Number(item && item.contentDetails && item.contentDetails.itemCount || 0),
    creator: snippet.channelTitle || fallbackCreator,
    description: snippet.description || '',
  };
}


function youtubeBestThumbnail(thumbnails) {
  const thumbs = thumbnails || {};
  return (thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default || {}).url || '';
}

async function youtubeSpecialPlaylistSummary(playlistId, request) {
  const id = normalizeYouTubePlaylistId(playlistId);
  if (!id || typeof request !== 'function') return { trackCount: 0, cover: '', description: '' };

  let trackCount = null;
  let cover = '';
  let description = '';

  try {
    const params = new URLSearchParams({ part: 'snippet,contentDetails', id, maxResults: '1' });
    const metadata = await request(`/playlists?${params.toString()}`);
    const item = Array.isArray(metadata && metadata.items) ? metadata.items[0] : null;
    if (item) {
      const details = item.contentDetails || {};
      const rawCount = Number(details.itemCount);
      if (Number.isFinite(rawCount) && rawCount >= 0) trackCount = Math.floor(rawCount);
      const snippet = item.snippet || {};
      cover = youtubeBestThumbnail(snippet.thumbnails);
      description = snippet.description || '';
    }
  } catch (error) {
    console.warn('[YouTubePlaylistSync] special playlist metadata unavailable:', id, error.message || error);
  }

  // YouTube may omit system playlists such as Liked videos from playlists.list.
  // playlistItems.pageInfo.totalResults is the authoritative count exposed for
  // the authorized account and does not require downloading every item.
  if (trackCount == null || trackCount === 0 || !cover) {
    try {
      const params = new URLSearchParams({ part: 'snippet', playlistId: id, maxResults: '1' });
      const page = await request(`/playlistItems?${params.toString()}`);
      const total = Number(page && page.pageInfo && page.pageInfo.totalResults);
      if (Number.isFinite(total) && total >= 0) trackCount = Math.floor(total);
      const first = Array.isArray(page && page.items) ? page.items[0] : null;
      if (!cover && first && first.snippet) cover = youtubeBestThumbnail(first.snippet.thumbnails);
    } catch (error) {
      console.warn('[YouTubePlaylistSync] special playlist count unavailable:', id, error.message || error);
    }
  }

  return {
    trackCount: Number.isFinite(trackCount) && trackCount >= 0 ? trackCount : 0,
    cover,
    description,
  };
}

async function youtubeDeviceOwnedPlaylists(limit = 200) {
  await getYouTubeAccountClient(true);
  const token = youtubeDeviceToken();
  if (!token || !token.access_token) return [];
  const results = [];
  let pageToken = '';
  while (results.length < limit) {
    const params = new URLSearchParams({ part: 'snippet,contentDetails', mine: 'true', maxResults: String(Math.min(50, limit - results.length)) });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await youtubeDataApiWithAccessToken(`/playlists?${params.toString()}`, token.access_token);
    for (const item of data.items || []) {
      const playlist = youtubePlaylistFromDataApiItem(item);
      if (playlist) results.push(playlist);
    }
    pageToken = String(data.nextPageToken || '');
    if (!pageToken) break;
  }

  try {
    const channels = await youtubeDataApiWithAccessToken('/channels?part=snippet,contentDetails&mine=true&maxResults=1', token.access_token);
    const channel = Array.isArray(channels.items) && channels.items[0] || {};
    const related = channel.contentDetails && channel.contentDetails.relatedPlaylists || {};
    const creator = channel.snippet && channel.snippet.title || 'YouTube';
    const relatedEntries = [
      ['likes', 'Video đã thích'],
      ['watchLater', 'Xem sau'],
      ['favorites', 'Video yêu thích'],
      ['uploads', 'Video đã tải lên'],
    ];
    for (const [key, name] of relatedEntries) {
      const id = normalizeYouTubePlaylistId(related[key]);
      if (!id) continue;
      const summary = (key === 'likes' || key === 'uploads')
        ? await youtubeSpecialPlaylistSummary(id, (endpoint) => youtubeDataApiWithAccessToken(endpoint, token.access_token))
        : { trackCount: 0, cover: '', description: '' };
      const special = { id, provider: 'qq', realProvider: 'youtube', authMode: 'device', name, creator, systemPlaylist: true, ...summary };
      const existing = results.findIndex((playlist) => normalizeYouTubePlaylistId(playlist && playlist.id) === id);
      if (existing >= 0) results[existing] = { ...results[existing], ...special };
      else results.push(special);
    }
  } catch (error) {
    console.warn('[YouTubePlaylistSync] related playlists unavailable:', error.message || error);
  }
  return mergeYouTubePlaylists(results, limit);
}

function youtubePlaylistSyncDiagnostics() {
  return JSON.parse(JSON.stringify(youtubePlaylistSyncState || {}));
}

async function youtubeDevicePlaylists(limit = 50) {
  const client = await getYouTubeAccountClient(true);
  const authMode = client.__shinayuuAuthMode === 'cookie' ? 'cookie' : 'device';
  const maxItems = Math.max(1, Math.min(500, Number(limit) || 50));
  const rawItems = [];
  const failures = [];
  const sourceCounts = {};
  async function collect(label, task) {
    try {
      const items = await task();
      const list = Array.isArray(items) ? items : [];
      sourceCounts[label] = list.length;
      rawItems.push(...list);
    } catch (error) {
      sourceCounts[label] = 0;
      failures.push(`${label}:${error.message || error}`);
    }
  }

  const tasks = [];
  if (authMode === 'cookie') {
    tasks.push(
      collect('web-playlists', async () => {
        const items = [];
        let page = await client.getPlaylists();
        for (let guard = 0; page && guard < 30 && items.length < maxItems * 3; guard += 1) {
          items.push(...youtubePlaylistNodesFromPage(page));
          if (!page.has_continuation || items.length >= maxItems * 3) break;
          page = await page.getContinuation();
        }
        return items;
      }),
      collect('web-playlists-raw', () => youtubeRawBrowsePlaylists(client, 'FEplaylist_aggregation', maxItems, 'WEB')),
      collect('web-library', async () => {
        const library = await client.getLibrary();
        const items = youtubePlaylistNodesFromPage(library);
        if (library && library.playlists_section && library.playlists_section.contents) items.push(...youtubeNodeArray(library.playlists_section.contents));
        return items;
      }),
      collect('web-library-raw', () => youtubeRawBrowsePlaylists(client, 'FElibrary', maxItems, 'WEB')),
      collect('music-library', async () => {
        const items = [];
        let library = await client.music.getLibrary();
        const playlistFilter = youtubeNodeArray(library && library.filters).find((filter) => /playlist|danh sách phát/i.test(youtubeNodeText(filter) || String(filter || '')));
        if (playlistFilter && library.applyFilter) library = await library.applyFilter(playlistFilter);
        for (let guard = 0; library && guard < 30 && items.length < maxItems * 4; guard += 1) {
          items.push(...youtubeMusicLibraryNodes(library));
          if (!library.has_continuation || items.length >= maxItems * 4) break;
          library = await library.getContinuation();
        }
        return items;
      }),
      collect('music-library-raw', () => youtubeRawBrowsePlaylists(client, 'FEmusic_library_landing', maxItems, 'YTMUSIC'))
    );
  } else {
    // YouTube.js OAuth is limited to the TV Innertube client. Keep every
    // device-token request on TV; WEB/YTMUSIC requests can appear logged in
    // while returning an empty personal library.
    tasks.push(
      collect('data-api-owned', () => youtubeDeviceOwnedPlaylists(maxItems)),
      collect('tv-playlists', async () => {
        const items = [];
        let page = await client.getPlaylists();
        for (let guard = 0; page && guard < 30 && items.length < maxItems * 3; guard += 1) {
          items.push(...youtubePlaylistNodesFromPage(page));
          if (!page.has_continuation || items.length >= maxItems * 3) break;
          page = await page.getContinuation();
        }
        return items;
      }),
      collect('tv-playlists-raw', () => youtubeRawBrowsePlaylists(client, 'FEplaylist_aggregation', maxItems, 'TV')),
      collect('tv-library-raw', () => youtubeRawBrowsePlaylists(client, 'FElibrary', maxItems, 'TV'))
    );
  }

  await Promise.all(tasks);
  const playlists = mergeYouTubePlaylists(rawItems, maxItems);
  youtubePlaylistSyncState = {
    updatedAt: Date.now(), authMode, count: playlists.length,
    sources: sourceCounts, failures: failures.slice(0, 16),
  };
  if (!playlists.length && failures.length) {
    const error = new Error(`YOUTUBE_PLAYLIST_SYNC_FAILED: ${failures.join(' | ')}`);
    error.status = 502;
    error.diagnostics = youtubePlaylistSyncDiagnostics();
    throw error;
  }
  return playlists;
}

function youtubeVideoIdFromNode(item) {
  if (!item) return '';
  const tap = item.renderer_context && item.renderer_context.command_context && item.renderer_context.command_context.on_tap;
  const candidates = [
    item.id, item.video_id, item.videoId, item.content_id, item.contentId,
    item.endpoint && item.endpoint.payload && item.endpoint.payload.videoId,
    tap && tap.payload && tap.payload.videoId,
    item.flex_columns && item.flex_columns[0] && item.flex_columns[0].title && item.flex_columns[0].title.runs && item.flex_columns[0].title.runs[0] && item.flex_columns[0].title.runs[0].endpoint && item.flex_columns[0].title.runs[0].endpoint.payload && item.flex_columns[0].title.runs[0].endpoint.payload.videoId,
  ];
  for (const candidate of candidates) {
    const id = youtubeNodeText(candidate);
    if (id && !/\s/.test(id) && !id.startsWith('VL')) return id;
  }
  return '';
}

function youtubeDurationMsFromNode(item) {
  const seconds = Number(item && item.duration && item.duration.seconds || item && item.duration_seconds || 0);
  if (seconds > 0) return Math.round(seconds * 1000);
  const text = youtubeNodeText(item && (item.duration || item.length_text || item.lengthText));
  if (!/^\d{1,2}(?::\d{1,2}){1,2}$/.test(text)) return 0;
  const parts = text.split(':').map(Number);
  let total = 0;
  for (const part of parts) total = total * 60 + part;
  return total * 1000;
}

function youtubeTrackFromDeviceNode(item) {
  const videoId = youtubeVideoIdFromNode(item);
  const title = youtubeNodeText(item && (item.title || item.name || item.metadata && item.metadata.title));
  if (!videoId || !title) return null;
  const artist = youtubeNodeText(item.author) || youtubeNodeText(item.artists && item.artists[0]) || youtubePlaylistCreator(item) || 'YouTube';
  const durationMs = youtubeDurationMsFromNode(item);
  return {
    provider: 'qq', source: 'qq', realProvider: 'youtube', playbackTransport: 'youtube',
    id: videoId, mid: videoId, songmid: videoId, youtubeId: videoId, videoId,
    name: title, title, artist, artists: [{ id: '', name: artist }], artistId: '', album: 'YouTube',
    cover: youtubeNodeThumbnail(item.thumbnails || item.thumbnail || item.content_image || item.image), duration: durationMs, durationMs,
    playable: item.is_playable !== false, fee: 0, youtubeSourceType: 'music', youtubeSurface: 'music', isYouTubeMusicResult: true, lyricsMetadataProvider: 'youtube-music',
  };
}

async function readYouTubeDevicePlaylistPage(client, id, useMusic) {
  const first = useMusic ? await client.music.getPlaylist(id) : await client.getPlaylist(id);
  let page = first;
  const info = { ...(page && page.info || {}), ...(page && page.header || {}) };
  const items = [];
  for (let guard = 0; page && guard < 30 && items.length < 500; guard += 1) {
    items.push(...youtubeNodeArray(page.items || page.contents));
    if (!page.has_continuation || items.length >= 500) break;
    page = await page.getContinuation();
  }
  return { info, items };
}

async function youtubeDeviceDataApiPlaylistTracks(playlistId, limit = 200) {
  const id = normalizeYouTubePlaylistId(playlistId);
  const client = await getYouTubeAccountClient(true);
  const token = youtubeDeviceToken();
  if (!id || !token || !token.access_token) throw Object.assign(new Error('YOUTUBE_DEVICE_TOKEN_MISSING'), { status: 401 });
  const rawItems = [];
  let pageToken = '';
  while (rawItems.length < limit) {
    const params = new URLSearchParams({ part: 'snippet,contentDetails,status', playlistId: id, maxResults: String(Math.min(50, limit - rawItems.length)) });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await youtubeDataApiWithAccessToken(`/playlistItems?${params.toString()}`, token.access_token);
    rawItems.push(...(data.items || []));
    pageToken = String(data.nextPageToken || '');
    if (!pageToken) break;
  }
  const ids = rawItems.map((item) => item.contentDetails && item.contentDetails.videoId || item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId || '').filter(Boolean);
  const detailMap = new Map();
  for (let start = 0; start < ids.length; start += 50) {
    const params = new URLSearchParams({ part: 'snippet,contentDetails,status', id: ids.slice(start, start + 50).join(',') });
    const data = await youtubeDataApiWithAccessToken(`/videos?${params.toString()}`, token.access_token);
    for (const item of data.items || []) detailMap.set(item.id, item);
  }
  const tracks = rawItems.map((item) => {
    const videoId = item.contentDetails && item.contentDetails.videoId || item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId || '';
    const detail = detailMap.get(videoId) || {};
    const snippet = detail.snippet || item.snippet || {};
    const title = snippet.title && snippet.title !== 'Deleted video' && snippet.title !== 'Private video' ? snippet.title : '';
    if (!videoId || !title) return null;
    const thumbs = snippet.thumbnails || {};
    const artist = snippet.videoOwnerChannelTitle || snippet.channelTitle || 'YouTube';
    const durationMs = parseIsoDurationMs(detail.contentDetails && detail.contentDetails.duration || '');
    return {
      provider: 'qq', source: 'qq', realProvider: 'youtube', playbackTransport: 'youtube',
      id: videoId, mid: videoId, songmid: videoId, youtubeId: videoId, videoId,
      name: title, title, artist, artists: [{ id: snippet.videoOwnerChannelId || snippet.channelId || '', name: artist }],
      artistId: snippet.videoOwnerChannelId || snippet.channelId || '', album: 'YouTube',
      cover: (thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default || {}).url || '',
      duration: durationMs, durationMs, playable: detail.status ? detail.status.embeddable !== false : true,
      fee: 0, youtubeSourceType: 'music', youtubeSurface: 'music', isYouTubeMusicResult: true, lyricsMetadataProvider: 'youtube-music',
    };
  }).filter(Boolean);
  return {
    playlist: { id, provider: 'qq', realProvider: 'youtube', authMode: 'device', name: 'YouTube playlist', cover: '', trackCount: tracks.length, creator: 'YouTube' },
    tracks,
  };
}

async function youtubeDevicePlaylistTracks(playlistId, limit = 200) {
  const id = normalizeYouTubePlaylistId(playlistId);
  if (!id) throw Object.assign(new Error('YOUTUBE_PLAYLIST_ID_REQUIRED'), { status: 400 });
  const accountClient = await getYouTubeAccountClient(true);
  const authMode = accountClient.__shinayuuAuthMode === 'cookie' ? 'cookie' : 'device';
  let apiError = null;
  try {
    const viaApi = authMode === 'device' ? await youtubeDeviceDataApiPlaylistTracks(id, limit) : null;
    if (viaApi && viaApi.tracks && viaApi.tracks.length) {
      const playlists = await youtubeDevicePlaylists(200).catch(() => []);
      const matched = playlists.find((item) => item.id === id);
      if (matched) viaApi.playlist = { ...matched, trackCount: viaApi.tracks.length };
      return viaApi;
    }
  } catch (error) {
    apiError = error;
  }

  const client = accountClient;
  const maxItems = Math.max(1, Math.min(500, Number(limit) || 200));
  let loaded = null;
  let firstError = null;
  try { loaded = await readYouTubeDevicePlaylistPage(client, id, false); }
  catch (error) { firstError = error; }
  if (!loaded || !loaded.items.length) {
    try { loaded = await readYouTubeDevicePlaylistPage(client, id, true); }
    catch (error) { if (!firstError) firstError = error; }
  }
  if (!loaded) throw firstError || apiError || Object.assign(new Error('YOUTUBE_PLAYLIST_LOAD_FAILED'), { status: 502 });
  const tracks = loaded.items.slice(0, maxItems).map(youtubeTrackFromDeviceNode).filter(Boolean);
  const info = loaded.info || {};
  const playlist = {
    id, provider: 'qq', realProvider: 'youtube', authMode,
    name: youtubeNodeText(info.title) || 'YouTube playlist',
    cover: youtubeNodeThumbnail(info.thumbnails || info.thumbnail),
    trackCount: tracks.length,
    creator: youtubeNodeText(info.author) || 'YouTube',
    description: youtubeNodeText(info.description),
  };
  if (!tracks.length && apiError) {
    const error = new Error(`YOUTUBE_PLAYLIST_LOAD_FAILED: ${apiError.message || apiError}`);
    error.status = Number(apiError.status) || 502;
    throw error;
  }
  return { playlist, tracks };
}

async function youtubeDataApi(endpoint, options = {}) {
  const token = await validYouTubeToken(true);
  const response = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      'User-Agent': UA,
      ...(options.headers || {}),
    },
  }, 20000);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && data.error && data.error.message || `YouTube Data API HTTP ${response.status}`;
    if (response.status === 401) clearYouTubeToken();
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}

async function completeYouTubeLogin(query) {
  cleanYouTubeAuthTransactions();
  const state = String(query && query.state || '');
  const pending = youtubeAuthRequests.get(state);
  if (query && query.error) {
    youtubeAuthRequests.delete(state);
    youtubeAuthResults.set(state, { state, complete: true, ok: false, error: String(query.error), createdAt: Date.now() });
    throw Object.assign(new Error(String(query.error)), { status: 400 });
  }
  if (!pending || !query || !query.code) throw Object.assign(new Error('YOUTUBE_OAUTH_STATE_INVALID'), { status: 400 });
  youtubeAuthRequests.delete(state);
  const config = providerConfig();
  const token = await youtubeTokenRequest({
    client_id: config.youtubeClientId,
    ...(config.youtubeClientSecret ? { client_secret: config.youtubeClientSecret } : {}),
    code: String(query.code),
    code_verifier: pending.verifier,
    redirect_uri: pending.redirectUri,
    grant_type: 'authorization_code',
  });
  const stored = {
    ...token,
    obtainedAt: Date.now(),
    expiresAt: Date.now() + Math.max(30, Number(token.expires_in || 3600) - 30) * 1000,
  };
  if (!writeYouTubeToken(stored)) throw Object.assign(new Error('YOUTUBE_TOKEN_SAVE_FAILED'), { status: 500 });
  const status = await youtubeLoginStatus(pending.redirectUri.replace(/\/api\/youtube\/callback$/, ''));
  const result = { state, complete: true, ok: true, status, createdAt: Date.now() };
  youtubeAuthResults.set(state, result);
  return result;
}

async function youtubeLoginResult(state, baseUrl = '') {
  cleanYouTubeAuthTransactions();
  const key = String(state || '');
  const result = youtubeAuthResults.get(key);
  if (result && result.complete) return result;
  const status = await youtubeLoginStatus(baseUrl).catch(() => null);
  if (status && status.loggedIn) {
    const complete = { state: key, complete: true, ok: true, status, createdAt: Date.now() };
    youtubeAuthResults.set(key, complete);
    return complete;
  }
  return result || { state: key, complete: false, ok: true, pending: true };
}

async function youtubeLoginStatus(baseUrl = '') {
  const config = providerConfig();
  if (config.youtubeClientId) {
    const token = await validYouTubeToken(false).catch(() => null);
    if (token) {
      try {
        const channels = await youtubeDataApi('/channels?part=snippet,contentDetails&mine=true&maxResults=50');
        const channel = Array.isArray(channels.items) && channels.items[0] || {};
        const snippet = channel.snippet || {};
        const thumbnails = snippet.thumbnails || {};
        return {
          provider: 'youtube', loggedIn: true, configured: true, quickLoginAvailable: true,
          advancedConfigured: true, authMode: 'official', userId: channel.id || '', nickname: snippet.title || 'YouTube',
          avatar: thumbnails.default && thumbnails.default.url || thumbnails.medium && thumbnails.medium.url || '',
          redirectUri: youtubeRedirectUri(baseUrl),
        };
      } catch (error) {
        if (error.status !== 401) throw error;
      }
    }
  }

  return {
    provider: 'youtube', loggedIn: false, configured: !!config.youtubeClientId,
    quickLoginAvailable: !!config.youtubeClientId, advancedConfigured: !!config.youtubeClientId,
    authMode: 'official',
    message: config.youtubeClientId ? 'YOUTUBE_OAUTH_READY' : 'YOUTUBE_CLIENT_ID_REQUIRED',
    redirectUri: youtubeRedirectUri(baseUrl),
  };
}

function parseIsoDurationMs(value) {
  const match = String(value || '').match(/^P(?:([0-9.]+)D)?(?:T(?:([0-9.]+)H)?(?:([0-9.]+)M)?(?:([0-9.]+)S)?)?$/i);
  if (!match) return 0;
  return Math.round(((Number(match[1] || 0) * 86400) + (Number(match[2] || 0) * 3600) + (Number(match[3] || 0) * 60) + Number(match[4] || 0)) * 1000);
}

async function youtubeAccountPlaylists(limit = 50) {
  const status = await youtubeLoginStatus();
  if (!status.loggedIn || status.authMode !== 'official') return [];
  const maxItems = Math.max(1, Math.min(500, Number(limit) || 50));
  const results = [];
  let pageToken = '';
  while (results.length < maxItems) {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails,status',
      mine: 'true',
      maxResults: String(Math.min(50, maxItems - results.length)),
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await youtubeDataApi(`/playlists?${params.toString()}`);
    for (const item of data.items || []) {
      const snippet = item.snippet || {};
      const thumbs = snippet.thumbnails || {};
      results.push({
        id: item.id || '', provider: 'qq', realProvider: 'youtube', authMode: 'official',
        name: snippet.title || 'YouTube playlist',
        cover: (thumbs.high || thumbs.medium || thumbs.default || {}).url || '',
        trackCount: Number(item.contentDetails && item.contentDetails.itemCount || 0),
        creator: snippet.channelTitle || status.nickname || 'YouTube',
        description: snippet.description || '',
      });
    }
    pageToken = String(data.nextPageToken || '');
    if (!pageToken) break;
  }

  try {
    const channels = await youtubeDataApi('/channels?part=snippet,contentDetails&mine=true&maxResults=50');
    for (const channel of channels.items || []) {
      const related = channel && channel.contentDetails && channel.contentDetails.relatedPlaylists || {};
      const creator = channel && channel.snippet && channel.snippet.title || status.nickname || 'YouTube';
      const specials = [
        ['likes', providerConfig().language === 'en' ? 'Liked videos' : 'Video đã thích'],
        ['uploads', providerConfig().language === 'en' ? 'Uploads' : 'Video đã tải lên'],
      ];
      for (const [key, name] of specials) {
        const id = normalizeYouTubePlaylistId(related[key]);
        if (!id) continue;
        const summary = await youtubeSpecialPlaylistSummary(id, (endpoint) => youtubeDataApi(endpoint));
        const special = {
          id, provider: 'qq', realProvider: 'youtube', authMode: 'official',
          name, creator, systemPlaylist: true, ...summary,
        };
        const existing = results.findIndex((playlist) => normalizeYouTubePlaylistId(playlist && playlist.id) === id);
        if (existing >= 0) results[existing] = { ...results[existing], ...special };
        else results.push(special);
      }
    }
  } catch (error) {
    console.warn('[YouTubeOAuth] related playlists unavailable:', error.message || error);
  }

  return mergeYouTubePlaylists(results, maxItems);
}

async function youtubeAccountPlaylistTracks(playlistId, limit = 200) {
  const id = String(playlistId || '').trim();
  if (!id) throw Object.assign(new Error('YOUTUBE_PLAYLIST_ID_REQUIRED'), { status: 400 });
  const status = await youtubeLoginStatus();
  if (!status.loggedIn || status.authMode !== 'official') throw Object.assign(new Error('YOUTUBE_LOGIN_REQUIRED'), { status: 401 });
  const rawItems = [];
  let pageToken = '';
  while (rawItems.length < limit) {
    const params = new URLSearchParams({ part: 'snippet,contentDetails,status', playlistId: id, maxResults: String(Math.min(50, limit - rawItems.length)) });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await youtubeDataApi(`/playlistItems?${params.toString()}`);
    rawItems.push(...(data.items || []));
    pageToken = String(data.nextPageToken || '');
    if (!pageToken) break;
  }
  const ids = rawItems.map((item) => item.contentDetails && item.contentDetails.videoId || item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId || '').filter(Boolean);
  const detailMap = new Map();
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50);
    const params = new URLSearchParams({ part: 'snippet,contentDetails,status', id: batch.join(',') });
    const data = await youtubeDataApi(`/videos?${params.toString()}`);
    for (const item of data.items || []) detailMap.set(item.id, item);
  }
  const tracks = rawItems.map((item) => {
    const videoId = item.contentDetails && item.contentDetails.videoId || item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId || '';
    const detail = detailMap.get(videoId) || {};
    const snippet = detail.snippet || item.snippet || {};
    const thumbs = snippet.thumbnails || {};
    const durationMs = parseIsoDurationMs(detail.contentDetails && detail.contentDetails.duration || '');
    const title = snippet.title && snippet.title !== 'Deleted video' && snippet.title !== 'Private video' ? snippet.title : '';
    if (!videoId || !title) return null;
    const artist = snippet.videoOwnerChannelTitle || snippet.channelTitle || 'YouTube';
    return {
      provider: 'qq', source: 'qq', realProvider: 'youtube', playbackTransport: 'youtube',
      id: videoId, mid: videoId, songmid: videoId, youtubeId: videoId, videoId,
      name: title, title, artist, artists: [{ id: snippet.videoOwnerChannelId || snippet.channelId || '', name: artist }],
      artistId: snippet.videoOwnerChannelId || snippet.channelId || '', album: 'YouTube',
      cover: (thumbs.high || thumbs.medium || thumbs.default || {}).url || '',
      duration: durationMs, durationMs, playable: detail.status ? detail.status.embeddable !== false : true,
      fee: 0, youtubeSourceType: 'music', youtubeSurface: 'music', isYouTubeMusicResult: true, lyricsMetadataProvider: 'youtube-music',
    };
  }).filter(Boolean);
  const playlists = await youtubeAccountPlaylists(50).catch(() => []);
  const playlist = playlists.find((item) => item.id === id) || { id, name: 'YouTube playlist', cover: '', trackCount: tracks.length, creator: 'YouTube' };
  return { playlist: { ...playlist, trackCount: tracks.length }, tracks };
}

function youtubeCallbackHtml(success, message) {
  const title = success ? 'YouTube connected' : 'YouTube connection failed';
  const detail = success ? 'Your YouTube playlists are now available in ShinaYuu Music. You can close this window.' : `YouTube could not be connected: ${message || ''}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:0;background:#070809;color:#fff;font-family:Inter,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh}.card{width:min(560px,88vw);padding:34px;border:1px solid rgba(255,255,255,.12);border-radius:22px;background:rgba(255,255,255,.055);box-shadow:0 24px 80px rgba(0,0,0,.45)}h1{font-size:25px;margin:0 0 12px}p{line-height:1.7;color:rgba(255,255,255,.72)}</style></head><body><div class="card"><h1>${htmlEscape(title)}</h1><p>${htmlEscape(detail)}</p></div><script>setTimeout(()=>window.close(),1800)</script></body></html>`;
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

function youtubeAudioDescriptorKey(videoId, quality) {
  return `${String(videoId || '').trim()}|${String(quality || '').trim().toLowerCase()}`;
}

function cacheYouTubeAudioDescriptor(videoId, quality, descriptor) {
  const key = youtubeAudioDescriptorKey(videoId, quality);
  if (!key || key.startsWith('|') || !descriptor || !descriptor.url) return;
  youtubeAudioDescriptorCache.set(key, { at: Date.now(), descriptor: { ...descriptor } });
}

function cachedYouTubeAudioDescriptor(videoId, quality) {
  const key = youtubeAudioDescriptorKey(videoId, quality);
  const cached = youtubeAudioDescriptorCache.get(key);
  if (!cached || Date.now() - Number(cached.at || 0) > YOUTUBE_AUDIO_DESCRIPTOR_TTL) {
    if (cached) youtubeAudioDescriptorCache.delete(key);
    return null;
  }
  return { ...cached.descriptor };
}

function youtubeVideoDescriptorKey(videoId, quality, options = {}) {
  const compatibility = !!(options && options.compatibility);
  return `${String(videoId || '').trim()}|${String(quality || 'auto').trim().toLowerCase()}|${compatibility ? 'compat' : 'quality'}`;
}

function cacheYouTubeVideoDescriptor(videoId, quality, descriptor, options = {}) {
  const key = youtubeVideoDescriptorKey(videoId, quality, options);
  if (!key || key.startsWith('|') || !descriptor || !descriptor.url) return;
  youtubeVideoDescriptorCache.delete(key);
  youtubeVideoDescriptorCache.set(key, { at: Date.now(), descriptor: { ...descriptor } });
  while (youtubeVideoDescriptorCache.size > YOUTUBE_VIDEO_DESCRIPTOR_CACHE_LIMIT) {
    youtubeVideoDescriptorCache.delete(youtubeVideoDescriptorCache.keys().next().value);
  }
}

function cachedYouTubeVideoDescriptor(videoId, quality, options = {}) {
  const key = youtubeVideoDescriptorKey(videoId, quality, options);
  const cached = youtubeVideoDescriptorCache.get(key);
  if (!cached || Date.now() - Number(cached.at || 0) > YOUTUBE_VIDEO_DESCRIPTOR_TTL) {
    if (cached) youtubeVideoDescriptorCache.delete(key);
    return null;
  }
  return { ...cached.descriptor };
}

function playbackResultFromYouTubeDescriptor(descriptor, engine) {
  const streamToken = saveYoutubeStreamDescriptor(descriptor);
  return {
    ...descriptor,
    streamToken,
    proxyUrl: `/api/audio?stream=${encodeURIComponent(streamToken)}`,
    engine,
  };
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
  const electronRuntime = process.versions && process.versions.electron ? process.execPath : '';
  const candidates = [
    process.env.SHINAYUU_NODE_PATH,
    electronRuntime,
    process.env.npm_node_execpath,
    process.env.NODE,
    commandExists(process.platform === 'win32' ? 'node.exe' : 'node'),
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return candidates.find((value) => fs.existsSync(value)) || '';
}

function ytDlpRuntimeEnv(nodeRuntime = findNodeRuntime()) {
  if (nodeRuntime && process.versions && process.versions.electron && path.resolve(nodeRuntime) === path.resolve(process.execPath)) {
    return { ELECTRON_RUN_AS_NODE: '1' };
  }
  return {};
}

function userYtDlpPath() {
  return path.join(youtubeToolsDir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

function bundledYtDlpPath() {
  return path.join(__dirname, 'vendor', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

function uniqueExistingStrings(values) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function ytDlpCandidatePaths() {
  const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  return uniqueExistingStrings([
    String(process.env.YTDLP_PATH || '').trim(),
    userYtDlpPath(),
    bundledYtDlpPath(),
    commandExists(name),
    commandExists('yt-dlp'),
  ]);
}

function safeUnlink(file) {
  try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
}

function copyFileAtomic(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.restore`;
  safeUnlink(partial);
  fs.copyFileSync(source, partial);
  if (process.platform === 'win32' && path.basename(source).toLowerCase() === 'yt-dlp.exe') {
    const digest = sha256File(partial);
    if (digest.toLowerCase() !== YTDLP_WINDOWS_SHA256.toLowerCase()) {
      safeUnlink(partial);
      const error = new Error('Bundled yt-dlp checksum verification failed');
      error.code = 'YTDLP_BUNDLE_CHECKSUM_FAILED';
      throw error;
    }
  }
  safeUnlink(target);
  fs.renameSync(partial, target);
  return target;
}

async function fetchBinary(url, timeoutMs = 45000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'application/octet-stream' },
      signal: controller ? controller.signal : undefined,
    });
    if (!response.ok) {
      const error = new Error(`yt-dlp download HTTP ${response.status}`);
      error.code = 'YTDLP_DOWNLOAD_HTTP';
      throw error;
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function downloadYtDlpWindows(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.download`;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    safeUnlink(partial);
    try {
      youtubeEngineLastStatus = {
        ready: false,
        repairing: true,
        engine: 'yt-dlp',
        message: 'downloading',
        attempt,
      };
      const bytes = await fetchBinary(YTDLP_WINDOWS_URL, 45000);
      fs.writeFileSync(partial, bytes);
      const digest = sha256File(partial);
      if (digest.toLowerCase() !== YTDLP_WINDOWS_SHA256.toLowerCase()) {
        const error = new Error('yt-dlp checksum verification failed');
        error.code = 'YTDLP_CHECKSUM_FAILED';
        throw error;
      }
      safeUnlink(target);
      fs.renameSync(partial, target);
      return target;
    } catch (error) {
      lastError = error;
      safeUnlink(partial);
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
  }
  const error = new Error(lastError && lastError.message || 'yt-dlp download failed');
  error.code = lastError && lastError.code || 'YTDLP_DOWNLOAD_FAILED';
  throw error;
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
    let settled = false;
    let timer = null;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    };
    timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      const error = new Error(`Process timed out after ${timeoutMs} ms`);
      error.code = 'PROCESS_TIMEOUT';
      finishReject(error);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > max) {
        try { child.kill(); } catch (_) {}
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', (error) => finishReject(error));
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr, code });
      const error = new Error((stderr || stdout || `Process exited with ${code}`).trim());
      error.code = `PROCESS_EXIT_${code}`;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function ytDlpFailureCode(error) {
  const code = String(error && error.code || '').toUpperCase();
  const message = String(error && error.message || '').toLowerCase();
  if (code === 'EACCES' || code === 'EPERM' || /access is denied|permission denied|operation not permitted/.test(message)) return 'YTDLP_BLOCKED_OR_PERMISSION';
  if (code === 'ENOENT' || /not found|cannot find/.test(message)) return 'YTDLP_NOT_FOUND';
  if (code === 'PROCESS_TIMEOUT' || /timed out/.test(message)) return 'YTDLP_START_TIMEOUT';
  return code || 'YTDLP_START_FAILED';
}

async function inspectYtDlpExecutable(executable) {
  const versionResult = await runChild(executable, ['--version'], { timeoutMs: 15000, maxOutput: 1024 * 64 });
  const version = String(versionResult.stdout || '').trim();
  if (!version) {
    const error = new Error('yt-dlp did not report a version');
    error.code = 'YTDLP_INVALID_EXECUTABLE';
    throw error;
  }
  return version;
}

function ytDlpSourceForPath(executable) {
  const normalized = path.resolve(executable);
  if (normalized === path.resolve(userYtDlpPath())) return 'user-cache';
  if (normalized === path.resolve(bundledYtDlpPath())) return 'bundled';
  if (String(process.env.YTDLP_PATH || '').trim() && normalized === path.resolve(String(process.env.YTDLP_PATH).trim())) return 'custom';
  return 'system';
}

async function prepareYouTubeEngine(options = {}) {
  const force = !!options.force;
  if (youtubeEnginePreparePromise && youtubeEngineLastStatus.ready) {
    const current = String(youtubeEngineLastStatus.executable || '');
    if (!current || !fs.existsSync(current)) youtubeEnginePreparePromise = null;
  }
  if (force) youtubeEnginePreparePromise = null;
  if (youtubeEnginePreparePromise) return youtubeEnginePreparePromise;

  youtubeEngineLastStatus = {
    ready: false,
    repairing: true,
    engine: 'yt-dlp',
    message: options.reason === 'manual_repair' ? 'repairing' : 'preparing',
  };

  youtubeEnginePreparePromise = (async () => {
    const failures = [];
    const userTarget = userYtDlpPath();
    let executable = '';
    let version = '';
    let source = '';

    for (const candidate of ytDlpCandidatePaths()) {
      try {
        if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
        version = await inspectYtDlpExecutable(candidate);
        executable = candidate;
        source = ytDlpSourceForPath(candidate);
        if (source === 'bundled' && process.platform === 'win32') {
          try {
            const restored = copyFileAtomic(candidate, userTarget);
            version = await inspectYtDlpExecutable(restored);
            executable = restored;
            source = 'bundled-restored';
          } catch (restoreError) {
            failures.push({ path: userTarget, code: ytDlpFailureCode(restoreError), message: restoreError.message });
          }
        }
        break;
      } catch (error) {
        failures.push({ path: candidate, code: ytDlpFailureCode(error), message: error.message });
        if (path.resolve(candidate) === path.resolve(userTarget)) {
          safeUnlink(userTarget);
          safeUnlink(`${userTarget}.download`);
          safeUnlink(`${userTarget}.restore`);
        }
      }
    }

    if (!executable && process.platform === 'win32') {
      executable = await downloadYtDlpWindows(userTarget);
      version = await inspectYtDlpExecutable(executable);
      source = 'downloaded';
    }

    if (!executable) {
      const error = new Error('yt-dlp is not installed and could not be prepared automatically.');
      error.code = 'YTDLP_NOT_FOUND';
      error.failures = failures;
      throw error;
    }

    const nodeRuntime = findNodeRuntime();
    youtubeEngineLastStatus = {
      ready: true,
      repairing: false,
      engine: 'yt-dlp',
      executable,
      version,
      source,
      nodeRuntime,
      failures,
      message: nodeRuntime ? 'ready' : 'ready_without_node_runtime',
    };
    return youtubeEngineLastStatus;
  })().catch((error) => {
    youtubeEngineLastStatus = {
      ready: false,
      repairing: false,
      repairable: true,
      engine: 'yt-dlp',
      message: error.message,
      code: ytDlpFailureCode(error),
      failures: Array.isArray(error.failures) ? error.failures : [],
    };
    youtubeEnginePreparePromise = null;
    throw error;
  });
  return youtubeEnginePreparePromise;
}

async function repairYouTubeEngine() {
  // First perform a non-destructive health check. Network timeouts, expired
  // signed media URLs and a sleeping renderer must never cause the working
  // bundled engine to be deleted on managed Windows gaming PCs.
  youtubeEnginePreparePromise = null;
  try {
    return await prepareYouTubeEngine({ force: true, reason: 'health_check' });
  } catch (firstError) {
    const failureCode = ytDlpFailureCode(firstError);
    const executableFailure = /^(YTDLP_NOT_FOUND|YTDLP_BLOCKED_OR_PERMISSION|YTDLP_INVALID_EXECUTABLE|ENOENT|EACCES|EPERM)$/i.test(failureCode);
    if (!executableFailure) throw firstError;
    const target = userYtDlpPath();
    safeUnlink(target);
    safeUnlink(`${target}.download`);
    safeUnlink(`${target}.restore`);
    return prepareYouTubeEngine({ force: true, reason: 'manual_repair' });
  }
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
  const nodeRuntime = findNodeRuntime();
  const result = await runChild(engine.executable, ytDlpMetadataArgs(videoId), {
    timeoutMs: 60000,
    maxOutput: 24 * 1024 * 1024,
    env: ytDlpRuntimeEnv(nodeRuntime),
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

async function youtubeAudioViaYtDlp(videoId, quality = '', options = {}) {
  const refresh = !!(options && options.refresh);
  const cachedDescriptor = refresh ? null : cachedYouTubeAudioDescriptor(videoId, quality);
  if (cachedDescriptor) return playbackResultFromYouTubeDescriptor(cachedDescriptor, 'yt-dlp-cache');
  const engine = await prepareYouTubeEngine();
  const nodeRuntime = findNodeRuntime();
  const result = await runChild(engine.executable, ytDlpArgs(videoId, quality), {
    timeoutMs: 70000,
    maxOutput: 18 * 1024 * 1024,
    env: ytDlpRuntimeEnv(nodeRuntime),
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
    mimeType: String(selected.mime_type || info.mime_type || (/^(m4a|mp4)$/.test(String(selected.ext || info.ext || '').toLowerCase()) ? 'audio/mp4' : (String(selected.ext || info.ext || '').toLowerCase() === 'webm' ? 'audio/webm' : ''))),
    bitrate: Number(selected.abr || selected.tbr || info.abr || info.tbr || 0) * 1000,
    audioQuality: String(selected.format_note || selected.format || info.format_note || ''),
    videoId: String(videoId || ''),
    mediaKind: 'audio',
    requestedQuality: String(quality || ''),
  };
  cacheYouTubeAudioDescriptor(videoId, quality, descriptor);
  return playbackResultFromYouTubeDescriptor(descriptor, 'yt-dlp');
}

function normalizeBackgroundVideoQuality(quality) {
  const value = String(quality || 'auto').trim().toLowerCase();
  return /^(eco|balanced|high|ultra)$/.test(value) ? value : 'auto';
}

function youtubeBackgroundVideoLimits(quality) {
  const mode = normalizeBackgroundVideoQuality(quality);
  return {
    mode,
    // High requests 1440p so object-fit:cover has enough source pixels after
    // cropping on a Full-HD desktop. Ultra may use 2160p on capable systems;
    // Balanced remains 1080p and Eco remains 720p.
    height: mode === 'eco' ? 720 : (mode === 'balanced' ? 1080 : (mode === 'ultra' ? 2160 : 1440)),
    // A large portion of YouTube's high-resolution catalog is available only
    // as 50/60 fps video-only formats.
    fps: mode === 'eco' ? 30 : 60,
  };
}

function youtubeBackgroundVideoFormat(quality, options = {}) {
  const { mode, height, fps } = youtubeBackgroundVideoLimits(quality);
  const compatibility = !!(options && options.compatibility);
  const minimumHeight = mode === 'eco' ? 720 : (mode === 'balanced' ? 1080 : (mode === 'ultra' ? 2160 : 1440));
  // Ask for the requested tier first, then fall back one tier at a time only
  // when the upload genuinely does not contain that resolution. This prevents
  // yt-dlp from silently selecting a soft 360p/480p rendition while Full HD or
  // higher formats are available in the same metadata response.
  if (!compatibility) {
    return [
      `bestvideo[height>=${minimumHeight}][height<=${height}][fps<=${fps}]`,
      `bestvideo[height>=1080][height<=${height}][fps<=${fps}]`,
      `bestvideo[height<=${height}][fps<=${fps}]`,
      `bestvideo[height<=${height}]`,
      `best[height>=1080][height<=${height}][fps<=${fps}]`,
      `best[height<=${height}][fps<=${fps}]`,
      `best[height<=${height}]`
    ].join('/');
  }
  return [
    `bestvideo[vcodec^=avc1][ext=mp4][height>=1080][height<=${height}][fps<=${fps}]`,
    `bestvideo[ext=mp4][height>=1080][height<=${height}][fps<=${fps}]`,
    `bestvideo[vcodec^=avc1][ext=mp4][height<=${height}][fps<=${fps}]`,
    `bestvideo[ext=mp4][height<=${height}][fps<=${fps}]`,
    `best[vcodec^=avc1][ext=mp4][height>=1080][height<=${height}][fps<=${fps}]`,
    `best[ext=mp4][height>=1080][height<=${height}][fps<=${fps}]`,
    `bestvideo[height<=${height}][fps<=${fps}]`,
    `best[height<=${height}][fps<=${fps}]`,
    `bestvideo[height<=${height}]`,
    `best[height<=${height}]`
  ].join('/');
}

function youtubeCachedVideoDescriptor(info, videoId, quality, options = {}) {
  const formats = Array.isArray(info && info.formats) ? info.formats : [];
  if (!formats.length) return null;
  const { height: maxHeight, fps: maxFps } = youtubeBackgroundVideoLimits(quality);
  const compatibility = !!(options && options.compatibility);
  let rows = formats.filter((format) => {
    if (!format || !String(format.url || '').trim()) return false;
    const vcodec = String(format.vcodec || '').toLowerCase();
    if (!vcodec || vcodec === 'none') return false;
    const protocol = String(format.protocol || '').toLowerCase();
    if (/m3u8|dash/.test(protocol) && !/^https?/.test(protocol)) return false;
    return true;
  });
  if (compatibility) {
    const compatibleRows = rows.filter((format) => {
      const ext = String(format.ext || '').toLowerCase();
      const vcodec = String(format.vcodec || '').toLowerCase();
      return ext === 'mp4' && /^(avc1|h264)/.test(vcodec);
    });
    if (compatibleRows.length) rows = compatibleRows;
  }
  if (!rows.length) return null;

  // Lock selection to the highest real resolution available inside the chosen
  // quality ceiling before comparing codec or bitrate. Formats without width
  // and height are ignored when dimensioned video streams exist.
  const dimensionedRows = rows.filter((format) => Number(format.height || 0) > 0 && Number(format.width || 0) > 0);
  if (dimensionedRows.length) rows = dimensionedRows;
  const rowsInsideCeiling = rows.filter((format) => {
    const height = Number(format.height || 0);
    const fps = Number(format.fps || 0);
    return height > 0 && height <= maxHeight && (!fps || fps <= maxFps);
  });
  const resolutionPool = rowsInsideCeiling.length ? rowsInsideCeiling : rows;
  const selectedHeight = resolutionPool.reduce((best, format) => Math.max(best, Number(format.height || 0)), 0);
  if (selectedHeight > 0) {
    rows = resolutionPool.filter((format) => Number(format.height || 0) === selectedHeight);
  } else {
    rows = resolutionPool;
  }

  const score = (format) => {
    const ext = String(format.ext || '').toLowerCase();
    const vcodec = String(format.vcodec || '').toLowerCase();
    const acodec = String(format.acodec || '').toLowerCase();
    const height = Number(format.height || 0);
    const fps = Number(format.fps || 0);
    const bitrate = Number(format.tbr || format.vbr || 0);
    const withinHeight = !height || height <= maxHeight;
    const withinFps = !fps || fps <= maxFps;
    let value = 0;
    if (withinHeight) value += 1000000000; else value -= Math.max(0, height - maxHeight) * 1000000;
    if (withinFps) value += 100000000; else value -= Math.max(0, fps - maxFps) * 100000;
    // Resolution dominates codec preference so a 1080p stream is never beaten
    // by a 360p/480p H.264 stream merely because of its container.
    value += Math.min(maxHeight, height || 0) * 1000000;
    value += Math.min(3840, Number(format.width || 0)) * 1000;
    value += Math.min(maxFps, fps || 0) * 10000;
    // At the same dimensions/fps, bitrate is the best available proxy for
    // visible detail. Weight it enough to avoid a soft low-bitrate rendition.
    value += Math.min(100000, bitrate || 0) * 20;
    if (ext === 'mp4') value += 4000;
    if (/^(avc1|h264)/.test(vcodec)) value += 3500;
    else if (/^(vp9|vp0?9)/.test(vcodec)) value += 2500;
    else if (/^(av01|av1)/.test(vcodec)) value += 1500;
    if (!acodec || acodec === 'none') value += 1000;
    return value;
  };

  const selected = rows.slice().sort((a, b) => score(b) - score(a))[0];
  if (!selected) return null;
  const availableMaxHeight = formats.reduce((best, format) => {
    const vcodec = String(format && format.vcodec || '').toLowerCase();
    return (!vcodec || vcodec === 'none') ? best : Math.max(best, Number(format.height || 0));
  }, 0);
  const headers = { ...(info.http_headers || {}), ...(selected.http_headers || {}) };
  return {
    url: String(selected.url || '').trim(),
    headers,
    mimeType: String(selected.mime_type || (String(selected.ext || '').toLowerCase() === 'mp4' ? 'video/mp4' : (String(selected.ext || '').toLowerCase() === 'webm' ? 'video/webm' : ''))),
    bitrate: Number(selected.tbr || selected.vbr || 0) * 1000,
    width: Number(selected.width || 0),
    height: Number(selected.height || 0),
    availableMaxHeight,
    fps: Number(selected.fps || 0),
    videoQuality: String(selected.format_note || selected.format || ''),
    videoId: String(videoId || ''),
    mediaKind: 'video',
    hasAudio: !!(selected.acodec && String(selected.acodec).toLowerCase() !== 'none'),
    formatId: String(selected.format_id || ''),
    reusedPlaybackMetadata: true,
    compatibility,
  };
}

function ytDlpVideoArgs(videoId, quality = 'auto', options = {}) {
  const nodeRuntime = findNodeRuntime();
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '--dump-single-json',
    '--socket-timeout', '20',
    '--retries', '2',
    '--fragment-retries', '2',
    '--format', youtubeBackgroundVideoFormat(quality, options),
  ];
  if (nodeRuntime) args.push('--js-runtimes', `node:${nodeRuntime}`);
  args.push(`https://www.youtube.com/watch?v=${encodeURIComponent(String(videoId || ''))}`);
  return args;
}

async function youtubeVideoViaYtDlp(videoId, quality = 'auto', options = {}) {
  const refresh = !!(options && options.refresh);
  const cachedDescriptor = refresh ? null : cachedYouTubeVideoDescriptor(videoId, quality, options);
  if (cachedDescriptor) return playbackResultFromYouTubeDescriptor(cachedDescriptor, 'yt-dlp-video-cache');
  if (!refresh) {
    const reused = youtubeCachedVideoDescriptor(cachedYouTubeYtDlpInfo(videoId), videoId, quality, options);
    if (reused) {
      cacheYouTubeVideoDescriptor(videoId, quality, reused, options);
      return playbackResultFromYouTubeDescriptor(reused, 'yt-dlp-playback-metadata');
    }
  }
  const engine = await prepareYouTubeEngine();
  const nodeRuntime = findNodeRuntime();
  const result = await runChild(engine.executable, ytDlpVideoArgs(videoId, quality, options), {
    timeoutMs: 70000,
    maxOutput: 18 * 1024 * 1024,
    env: ytDlpRuntimeEnv(nodeRuntime),
  });
  let info;
  try { info = JSON.parse(result.stdout); }
  catch (_) { throw new Error('yt-dlp returned invalid video metadata'); }
  cacheYouTubeYtDlpInfo(videoId, info);
  const selected = Array.isArray(info.requested_downloads) && info.requested_downloads[0] || info;
  const directUrl = String(selected.url || info.url || '').trim();
  if (!directUrl) throw new Error('yt-dlp did not return a video URL');
  const headers = { ...(info.http_headers || {}), ...(selected.http_headers || {}) };
  const descriptor = {
    url: directUrl,
    headers,
    mimeType: String(selected.mime_type || info.mime_type || (String(selected.ext || info.ext || '').toLowerCase() === 'mp4' ? 'video/mp4' : (String(selected.ext || info.ext || '').toLowerCase() === 'webm' ? 'video/webm' : ''))),
    bitrate: Number(selected.tbr || info.tbr || 0) * 1000,
    width: Number(selected.width || info.width || 0),
    height: Number(selected.height || info.height || 0),
    availableMaxHeight: Array.isArray(info.formats) ? info.formats.reduce((best, format) => {
      const vcodec = String(format && format.vcodec || '').toLowerCase();
      return (!vcodec || vcodec === 'none') ? best : Math.max(best, Number(format.height || 0));
    }, 0) : Number(selected.height || info.height || 0),
    fps: Number(selected.fps || info.fps || 0),
    videoQuality: String(selected.format_note || selected.format || info.format_note || ''),
    videoId: String(videoId || ''),
    mediaKind: 'video',
    hasAudio: !!(selected.acodec && String(selected.acodec).toLowerCase() !== 'none'),
    formatId: String(selected.format_id || info.format_id || ''),
    compatibility: !!(options && options.compatibility),
    requestedQuality: normalizeBackgroundVideoQuality(quality),
  };
  cacheYouTubeVideoDescriptor(videoId, quality, descriptor, options);
  return playbackResultFromYouTubeDescriptor(descriptor, 'yt-dlp-video');
}

function publicProviderConfig(config = providerConfig(), baseUrl = '') {
  return {
    spotifyClientId: config.spotifyClientId,
    spotifyConfigured: !!config.spotifyClientId,
    spotifyMarket: config.spotifyMarket,
    youtubeClientId: config.youtubeClientId,
    youtubeConfigured: !!config.youtubeClientId,
    youtubeQuickLoginAvailable: !!config.youtubeClientId,
    youtubeAdvancedConfigured: !!config.youtubeClientId,
    youtubeRedirectUri: youtubeRedirectUri(baseUrl),
    language: config.language,
    spotifyRedirectUri: spotifyRedirectUri(baseUrl),
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

function setSpotifySessionLyricsProvider(provider) {
  spotifySessionLyricsProvider = typeof provider === 'function' ? provider : null;
}

function spotifyLyricsCandidateIds(id, metadata = {}) {
  const raw = [
    metadata.currentTrackId,
    id,
    metadata.spotifyId,
    metadata.id,
    metadata.linkedFromId,
    metadata.relinkedFromId,
    ...(Array.isArray(metadata.candidateSpotifyIds) ? metadata.candidateSpotifyIds : []),
  ];
  const seen = new Set();
  const result = [];
  raw.forEach((value) => {
    const candidate = spotifyLyricsTrackId(value);
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    result.push(candidate);
  });
  return result;
}

function spotifyLyricsEndpoint(trackId, market) {
  const params = new URLSearchParams({
    format: 'json',
    vocalRemoval: 'false',
    market: market || 'from_token',
  });
  return `${SPOTIFY_LYRICS_BASE}/${encodeURIComponent(trackId)}?${params.toString()}`;
}

function rememberSpotifyLyricsFailure(trackId, detail = {}) {
  spotifyLyricsFailureCache.set(trackId, { at: Date.now(), ...detail });
  if (spotifyLyricsFailureCache.size > 120) {
    const oldest = [...spotifyLyricsFailureCache.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .slice(0, spotifyLyricsFailureCache.size - 96);
    oldest.forEach(([key]) => spotifyLyricsFailureCache.delete(key));
  }
}

async function spotifyNativeLyrics(id, metadata = {}) {
  if (/^(0|false|off|disabled)$/i.test(String(process.env.SPOTIFY_NATIVE_LYRICS || '').trim())) return null;
  const candidateIds = spotifyLyricsCandidateIds(id, metadata);
  if (!candidateIds.length) return null;

  for (const trackId of candidateIds) {
    const cached = spotifyLyricsCache.get(trackId);
    if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.value;
  }

  let token = await validSpotifyToken(false);
  const configuredMarket = String(metadata.market || providerConfig().spotifyMarket || '').trim().toUpperCase();
  const markets = ['from_token'];
  if (configuredMarket && configuredMarket !== 'FROM_TOKEN') markets.push(configuredMarket);
  const failures = [];

  if (token && token.access_token) {
    for (const trackId of candidateIds) {
      const rememberedFailure = spotifyLyricsFailureCache.get(trackId);
      const deterministicFailure = rememberedFailure
        && Date.now() - Number(rememberedFailure.at || 0) < 5 * 60 * 1000
        && [401, 403, 404].includes(Number(rememberedFailure.status || 0));
      if (deterministicFailure) {
        failures.push({ trackId, ...rememberedFailure, cached: true });
        continue;
      }
      for (const market of markets) {
        const endpoint = spotifyLyricsEndpoint(trackId, market);
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
            const body = await response.text().catch(() => '');
            const detail = { status: response.status, market, body: body.slice(0, 300), transport: 'node' };
            failures.push({ trackId, ...detail });
            rememberSpotifyLyricsFailure(trackId, detail);
            console.warn('[SpotifyLyrics] request failed', `status=${response.status}`, `track=${trackId}`, `market=${market}`, body.slice(0, 160));
            continue;
          }
          const payload = await response.json().catch(() => null);
          const value = normalizeSpotifyLyricsPayload(payload, {
            ...metadata,
            spotifyId: trackId,
            id: trackId,
          });
          // Spotify also serves UNSYNCED lyrics. They are still valuable and
          // must be displayed as plain text instead of being discarded merely
          // because no line timestamps are available.
          if (!value || !value.plainLyric) continue;
          value.spotifyLyricsDiagnostics = { transport: 'node', requestedTrackId: trackId, market, failures };
          candidateIds.forEach((candidateId) => spotifyLyricsCache.set(candidateId, { at: Date.now(), value }));
          return value;
        } catch (error) {
          const detail = { status: 0, market, error: String(error && (error.message || error) || ''), transport: 'node' };
          failures.push({ trackId, ...detail });
          rememberSpotifyLyricsFailure(trackId, detail);
          console.warn('[SpotifyLyrics]', trackId, detail.error);
        }
      }
    }
  } else {
    failures.push({ status: 401, error: 'SPOTIFY_ACCESS_TOKEN_MISSING', transport: 'node' });
  }

  // The hidden WebView2 player owns the live Spotify playback session. When
  // the Node request is rejected, ask that session to repeat the request with
  // its browser context/cookies before falling back to LRCLIB.
  if (spotifySessionLyricsProvider) {
    try {
      const sessionResult = await spotifySessionLyricsProvider(candidateIds, {
        ...metadata,
        market: configuredMarket,
        failures,
      });
      const payload = sessionResult && (sessionResult.payload || sessionResult.data || sessionResult);
      const resolvedTrackId = spotifyLyricsTrackId(sessionResult && sessionResult.trackId) || candidateIds[0];
      const value = normalizeSpotifyLyricsPayload(payload, {
        ...metadata,
        spotifyId: resolvedTrackId,
        id: resolvedTrackId,
      });
      if (value && value.plainLyric) {
        value.spotifyLyricsDiagnostics = {
          transport: 'webview2-session',
          requestedTrackId: resolvedTrackId,
          status: Number(sessionResult && sessionResult.status || 200),
          failures,
        };
        candidateIds.forEach((candidateId) => spotifyLyricsCache.set(candidateId, { at: Date.now(), value }));
        return value;
      }
    } catch (error) {
      failures.push({ status: 0, error: String(error && (error.message || error) || ''), transport: 'webview2-session' });
      console.warn('[SpotifyLyricsSession]', error && (error.message || error));
    }
  }
  return null;
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

function spotifyTrackIdFromValue(value) {
  if (!value) return '';
  if (typeof value === 'object') {
    const direct = String(value.id || value.spotifyId || '').trim();
    if (/^[A-Za-z0-9]{16,32}$/.test(direct)) return direct;
    for (const candidate of [value.uri, value.spotifyUri, value.href, value.externalUrl, value.external_url, value.external_urls && value.external_urls.spotify]) {
      const found = spotifyTrackIdFromValue(candidate);
      if (found) return found;
    }
    return '';
  }
  const raw = String(value || '').trim();
  const uri = raw.match(/^spotify:track:([A-Za-z0-9]{16,32})$/i);
  if (uri) return uri[1];
  const url = raw.match(/(?:open\.spotify\.com\/track\/|\/v1\/tracks\/)([A-Za-z0-9]{16,32})/i);
  if (url) return url[1];
  return /^[A-Za-z0-9]{16,32}$/.test(raw) ? raw : '';
}

function unwrapSpotifyPlaylistItem(entry) {
  let current = entry;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const next = current.item || current.track;
    if (!next || next === current) break;
    current = next;
  }
  return current && typeof current === 'object' ? current : {};
}

function spotifyPlaylistPageItems(page) {
  if (!page || typeof page !== 'object') return [];
  if (Array.isArray(page.items)) return page.items;
  if (page.items && Array.isArray(page.items.items)) return page.items.items;
  if (page.tracks && Array.isArray(page.tracks.items)) return page.tracks.items;
  return [];
}

function spotifyPlaylistPageNext(page) {
  if (!page || typeof page !== 'object') return '';
  return String(page.next || page.items && page.items.next || page.tracks && page.tracks.next || '');
}

function spotifyPlaylistPageTotal(page) {
  if (!page || typeof page !== 'object') return 0;
  return Number(page.total || page.items && page.items.total || page.tracks && page.tracks.total || 0);
}

function spotifyPlaylistEmbeddedPage(playlist) {
  if (!playlist || typeof playlist !== 'object') return null;
  if (playlist.items && typeof playlist.items === 'object') return playlist.items;
  if (playlist.tracks && typeof playlist.tracks === 'object') return playlist.tracks;
  return null;
}

function spotifyPlaylistContextUri(value) {
  if (!value) return '';
  if (typeof value === 'object') {
    const uri = String(value.uri || value.spotifyUri || value.contextUri || '').trim();
    if (/^spotify:playlist:[A-Za-z0-9]+$/i.test(uri)) return uri;
    return spotifyPlaylistContextUri(value.id || value.href || value.external_urls && value.external_urls.spotify || '');
  }
  const raw = String(value || '').trim();
  const uri = raw.match(/^spotify:playlist:([A-Za-z0-9]+)$/i);
  if (uri) return `spotify:playlist:${uri[1]}`;
  const url = raw.match(/(?:open\.spotify\.com\/playlist\/|\/v1\/playlists\/)([A-Za-z0-9]+)/i);
  if (url) return `spotify:playlist:${url[1]}`;
  return /^[A-Za-z0-9]+$/.test(raw) ? `spotify:playlist:${raw}` : '';
}

function spotifyPlaylistReadScopesReady(token) {
  const granted = new Set(String(token && token.scope || '').split(/\s+/).filter(Boolean));
  return granted.has('playlist-read-private') && granted.has('playlist-read-collaborative');
}

function spotifyTrackHasPlaylistMetadata(track) {
  if (!track || typeof track !== 'object') return false;
  const id = spotifyTrackIdFromValue(track);
  const name = String(track.name || '').trim();
  const artists = Array.isArray(track.artists) ? track.artists.filter((artist) => artist && String(artist.name || '').trim()) : [];
  return !!(id && name && artists.length);
}

function mergeSpotifyTrackPayload(base, full) {
  base = base && typeof base === 'object' ? base : {};
  full = full && typeof full === 'object' ? full : {};
  return {
    ...base,
    ...full,
    id: spotifyTrackIdFromValue(full) || spotifyTrackIdFromValue(base),
    uri: full.uri || base.uri || '',
    artists: Array.isArray(full.artists) && full.artists.length ? full.artists : (Array.isArray(base.artists) ? base.artists : []),
    album: {
      ...(base.album && typeof base.album === 'object' ? base.album : {}),
      ...(full.album && typeof full.album === 'object' ? full.album : {}),
    },
    external_urls: {
      ...(base.external_urls && typeof base.external_urls === 'object' ? base.external_urls : {}),
      ...(full.external_urls && typeof full.external_urls === 'object' ? full.external_urls : {}),
    },
    external_ids: {
      ...(base.external_ids && typeof base.external_ids === 'object' ? base.external_ids : {}),
      ...(full.external_ids && typeof full.external_ids === 'object' ? full.external_ids : {}),
    },
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const list = Array.isArray(items) ? items : [];
  const output = new Array(list.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, list.length || 1));
  async function worker() {
    while (cursor < list.length) {
      const index = cursor++;
      output[index] = await mapper(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return output;
}

async function normalizeSpotifyPlaylistTrack(entry, market) {
  const raw = unwrapSpotifyPlaylistItem(entry);
  const id = spotifyTrackIdFromValue(raw) || spotifyTrackIdFromValue(entry);
  if (!id || String(raw.type || '').toLowerCase() === 'episode') return null;

  const cached = spotifyTrackCache.get(id);
  if (cached && cached.name && cached.artist) return { ...cached };

  let track = mergeSpotifyTrackPayload(raw, {
    id,
    uri: raw.uri || `spotify:track:${id}`,
  });
  if (!spotifyTrackHasPlaylistMetadata(track)) {
    try {
      const full = await spotifyApi(`/tracks/${encodeURIComponent(id)}?market=${encodeURIComponent(market)}`, { required: true });
      track = mergeSpotifyTrackPayload(track, full);
    } catch (error) {
      console.warn('[SpotifyPlaylist] track hydration failed:', id, error && (error.message || error));
    }
  }

  const song = mapSpotifyTrack(track);
  if (!song.id || !song.name || !song.artist) return null;
  song.spotifyId = song.spotifyId || song.id;
  song.spotifyUri = song.spotifyUri || `spotify:track:${song.spotifyId}`;
  return song;
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
    id: spotifyTrackIdFromValue(track) || '',
    spotifyId: spotifyTrackIdFromValue(track) || '',
    spotifyUri: track.uri || (spotifyTrackIdFromValue(track) ? `spotify:track:${spotifyTrackIdFromValue(track)}` : ''),
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
    // Spotify can transparently relink a track for the user's market. Keep both
    // identifiers so the lyrics bridge can try the exact playing item and the
    // original catalog item instead of silently falling back to the wrong song.
    linkedFromId: String(track.linked_from && track.linked_from.id || ''),
    linkedFromUri: String(track.linked_from && track.linked_from.uri || ''),
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
  const profile = cachedSpotifyProfile(spotifyToken());
  return ((data && data.items) || []).map((playlist) => {
    const id = String(playlist.id || '');
    const ownerId = String(playlist.owner && playlist.owner.id || '');
    return {
      provider: 'netease',
      realProvider: 'spotify',
      source: 'netease',
      id,
      name: playlist.name || '',
      cover: playlist.images && playlist.images[0] && playlist.images[0].url || '',
      trackCount: playlist.items && playlist.items.total || playlist.tracks && playlist.tracks.total || 0,
      playCount: 0,
      creator: playlist.owner && (playlist.owner.display_name || playlist.owner.id) || '',
      ownerId,
      ownedByCurrentUser: !!(profile && profile.id && ownerId && profile.id === ownerId),
      subscribed: true,
      specialType: 0,
      collaborative: !!playlist.collaborative,
      public: playlist.public,
      spotifyUri: spotifyPlaylistContextUri(playlist) || spotifyPlaylistContextUri(id),
      contextUri: spotifyPlaylistContextUri(playlist) || spotifyPlaylistContextUri(id),
      itemsHref: String(playlist.items && playlist.items.href || playlist.tracks && playlist.tracks.href || ''),
      externalUrl: String(playlist.external_urls && playlist.external_urls.spotify || ''),
    };
  }).filter((playlist) => playlist.id);
}

async function spotifyPlaylistTracks(id, limit = 100) {
  const encodedId = encodeURIComponent(id);
  const market = providerConfig().spotifyMarket;
  const encodedMarket = encodeURIComponent(market);
  const token = await validSpotifyToken(true);
  const profile = cachedSpotifyProfile(token);
  const playlist = await spotifyApi(`/playlists/${encodedId}?market=${encodedMarket}`);
  const embeddedPage = spotifyPlaylistEmbeddedPage(playlist);
  const declaredTotal = spotifyPlaylistPageTotal(embeddedPage)
    || Number(playlist && playlist.items && playlist.items.total || playlist && playlist.tracks && playlist.tracks.total || 0);

  let firstPage = null;
  let itemEndpointError = null;
  let itemSource = 'none';
  const itemHref = String(embeddedPage && embeddedPage.href || '').trim();
  const itemEndpoint = itemHref
    ? itemHref.replace(/^https:\/\/api\.spotify\.com\/v1/i, '')
    : `/playlists/${encodedId}/items?market=${encodedMarket}&additional_types=track&limit=50`;

  try {
    firstPage = await spotifyApi(itemEndpoint);
    itemSource = spotifyPlaylistPageItems(firstPage).length ? 'items-endpoint' : 'items-endpoint-empty';
  } catch (error) {
    itemEndpointError = error;
    console.warn('[SpotifyPlaylist] item endpoint failed:', id, error && (error.message || error));
  }

  // GET /playlists/{id} now embeds an items page for playlists owned by the
  // current user or collaborative playlists. Prefer it whenever the dedicated
  // /items endpoint returns an unexpectedly empty page or is temporarily
  // unavailable. This prevents a playlist showing a correct count but 0 rows.
  if (spotifyPlaylistPageItems(embeddedPage).length
      && (!firstPage || !spotifyPlaylistPageItems(firstPage).length)) {
    firstPage = embeddedPage;
    itemSource = 'playlist-embedded-items';
  }

  // One lightweight retry without market/additional_types covers older tokens
  // and Spotify edge responses where metadata reports items but the first
  // request returns an empty page.
  if ((!firstPage || !spotifyPlaylistPageItems(firstPage).length) && declaredTotal > 0 && !itemEndpointError) {
    try {
      const retryPage = await spotifyApi(`/playlists/${encodedId}/items?limit=50`);
      if (spotifyPlaylistPageItems(retryPage).length) {
        firstPage = retryPage;
        itemSource = 'items-endpoint-retry';
      }
    } catch (error) {
      itemEndpointError = error;
      console.warn('[SpotifyPlaylist] item endpoint retry failed:', id, error && (error.message || error));
    }
  }

  const entries = [];
  const seenPages = new Set();
  let page = firstPage;
  while (page && entries.length < limit) {
    for (const entry of spotifyPlaylistPageItems(page)) {
      if (entries.length >= limit) break;
      const item = unwrapSpotifyPlaylistItem(entry);
      if (String(item && item.type || '').toLowerCase() === 'episode') continue;
      entries.push(entry);
    }
    const nextUrl = spotifyPlaylistPageNext(page);
    if (!nextUrl || entries.length >= limit || seenPages.has(nextUrl)) break;
    seenPages.add(nextUrl);
    try {
      const next = new URL(nextUrl);
      page = await spotifyApi(next.pathname.replace(/^\/v1/, '') + next.search);
    } catch (error) {
      itemEndpointError = itemEndpointError || error;
      console.warn('[SpotifyPlaylist] pagination failed:', id, error && (error.message || error));
      break;
    }
  }

  // Spotify Development Mode can return sparse playlist item objects after
  // the playlist-field migration. Hydrate only incomplete entries through the
  // official single-track endpoint, with low concurrency to avoid 429s.
  const normalized = await mapWithConcurrency(entries, 4, (entry) => normalizeSpotifyPlaylistTrack(entry, market));
  const tracks = normalized.filter(Boolean);
  const ownerId = String(playlist && playlist.owner && playlist.owner.id || '');
  const ownedByCurrentUser = !!(profile && profile.id && ownerId && profile.id === ownerId);
  const contextUri = spotifyPlaylistContextUri(playlist) || spotifyPlaylistContextUri(id);
  const missingReadScopes = !spotifyPlaylistReadScopesReady(token);
  let itemAccess = 'available';
  if (!tracks.length && declaredTotal > 0) {
    itemAccess = itemEndpointError && Number(itemEndpointError.status) === 403 ? 'restricted' : 'unavailable';
  }

  return {
    playlist: {
      id: playlist && playlist.id || id,
      name: playlist && playlist.name || '',
      cover: playlist && playlist.images && playlist.images[0] && playlist.images[0].url || '',
      trackCount: declaredTotal || tracks.length,
      creator: playlist && playlist.owner && (playlist.owner.display_name || playlist.owner.id) || '',
      ownerId,
      ownedByCurrentUser,
      collaborative: !!(playlist && playlist.collaborative),
      public: playlist && playlist.public,
      spotifyUri: contextUri,
      contextUri,
      canContextPlay: !!contextUri,
      itemAccess,
      requiresReauthorization: missingReadScopes,
      externalUrl: String(playlist && playlist.external_urls && playlist.external_urls.spotify || ''),
    },
    tracks,
    diagnostics: {
      declaredTotal,
      receivedItems: entries.length,
      playableTracks: tracks.length,
      skippedItems: Math.max(0, entries.length - tracks.length),
      hydratedSparseItems: entries.filter((entry) => !spotifyTrackHasPlaylistMetadata(unwrapSpotifyPlaylistItem(entry))).length,
      itemSource,
      itemEndpointStatus: itemEndpointError ? Number(itemEndpointError.status || 0) : 200,
      itemEndpointError: itemEndpointError ? String(itemEndpointError.message || itemEndpointError) : '',
      ownedByCurrentUser,
      collaborative: !!(playlist && playlist.collaborative),
      missingReadScopes,
    },
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

async function createYouTubeClient(retrievePlayer) {
  const yt = await import('youtubei.js');
  if (yt.Platform && yt.Platform.shim) {
    yt.Platform.shim.eval = async (data) => new Function(data.output)();
  }
  return yt.Innertube.create({
    lang: providerConfig().language === 'en' ? 'en' : 'vi',
    location: providerConfig().spotifyMarket || 'VN',
    retrieve_player: retrievePlayer !== false,
    enable_session_cache: true,
    generate_session_locally: false,
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
  });
}

async function getYouTubeClient() {
  if (!youtubeClientPromise) {
    youtubeClientPromise = createYouTubeClient(true).catch((error) => {
      youtubeClientPromise = null;
      throw error;
    });
  }
  return youtubeClientPromise;
}

async function getYouTubeSearchClient() {
  if (!youtubeSearchClientPromise) {
    youtubeSearchClientPromise = createYouTubeClient(false).catch((error) => {
      youtubeSearchClientPromise = null;
      throw error;
    });
  }
  return youtubeSearchClientPromise;
}

async function runYouTubeSearch(operation) {
  try {
    return await operation(await getYouTubeSearchClient());
  } catch (lightError) {
    // Search does not require player deciphering. If a YouTube revision rejects
    // the lightweight client, fall back once to the full playback client while
    // preserving the original YouTube Music behaviour.
    youtubeSearchClientPromise = null;
    try {
      return await operation(await getYouTubeClient());
    } catch (fullError) {
      fullError.cause = fullError.cause || lightError;
      throw fullError;
    }
  }
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

function youtubeText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') {
    const text = value.toString();
    if (text && text !== '[object Object]' && text !== 'N/A') return text;
  }
  return String(value.text || value.name || value.title || '');
}

function youtubeDurationSeconds(value) {
  if (!value) return 0;
  const direct = Number(value.seconds || value.duration_seconds || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const parts = youtubeText(value.text || value).trim().split(':').map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function youtubeThumbnail(item) {
  const seen = new Set();
  const rows = [];
  const collect = (value, depth = 0) => {
    if (value == null || depth > 7) return;
    if (typeof value === 'string') {
      if (value.trim() && !seen.has(value)) {
        seen.add(value);
        rows.push({ url: value, width: 0, height: 0 });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => collect(entry, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    const url = String(value.url || value.src || '').trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      rows.push({ url, width: Number(value.width || 0), height: Number(value.height || 0) });
    }
    [
      'thumbnail', 'thumbnails', 'contents', 'sources', 'image', 'images',
      'primaryThumbnail', 'thumbnailViewModel', 'thumbnailRenderer',
      'musicThumbnailRenderer', 'contentImage', 'collectionThumbnailViewModel'
    ].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(value, key)) collect(value[key], depth + 1);
    });
  };
  collect(item && item.thumbnail);
  collect(item && item.thumbnails);
  collect(item && item.image);
  collect(item && item.images);
  collect(item && item.content_image);
  collect(item && item.contentImage);
  const best = rows.slice().sort((a, b) => {
    const areaA = Number(a.width || 0) * Number(a.height || 0);
    const areaB = Number(b.width || 0) * Number(b.height || 0);
    return areaB - areaA;
  })[0];
  if (best && best.url) return best.url;
  const endpoint = item && item.endpoint && item.endpoint.payload || {};
  const id = String(item && (item.id || item.video_id || item.videoId) || endpoint.videoId || endpoint.video_id || '').trim();
  return id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg` : '';
}

function mapYouTubeMusicItem(item) {
  if (!item) return null;
  const endpoint = item.endpoint && item.endpoint.payload || {};
  const id = item.id || item.video_id || endpoint.videoId || endpoint.video_id || '';
  if (!id) return null;
  const artists = (Array.isArray(item.artists) ? item.artists : []).map((artist) => ({
    id: artist.channel_id || artist.id || '',
    name: youtubeText(artist.name || artist),
  })).filter((artist) => artist.name);
  const authorName = youtubeText(item.author && (item.author.name || item.author));
  if (!artists.length && authorName) artists.push({ id: item.author && (item.author.channel_id || item.author.id) || '', name: authorName });
  const title = youtubeText(item.title || item.name);
  if (!title) return null;
  const durationSeconds = youtubeDurationSeconds(item.duration);
  const song = {
    provider: 'qq',
    realProvider: 'youtube',
    source: 'qq',
    type: 'qq',
    playbackTransport: 'youtube',
    contentType: 'song',
    youtubeSurface: 'music',
    youtubeSourceType: 'music',
    isYouTubeMusicResult: true,
    isYouTubeVideoResult: false,
    isYouTubeVideo: false,
    id,
    mid: id,
    songmid: id,
    youtubeId: id,
    videoId: id,
    name: title,
    title,
    artist: artists.map((artist) => artist.name).join(' / ') || youtubeText(item.subtitle),
    artists,
    artistId: artists[0] && artists[0].id || '',
    artistMid: artists[0] && artists[0].id || '',
    album: youtubeText(item.album && (item.album.name || item.album)) || '',
    albumId: String(item.album && (item.album.id || item.album.browse_id || item.album.browseId) || ''),
    cover: youtubeThumbnail(item),
    duration: durationSeconds * 1000,
    durationMs: durationSeconds * 1000,
    playable: true,
    lyricsMetadataProvider: 'youtube-music',
    externalUrl: `https://music.youtube.com/watch?v=${id}`,
  };
  youtubeTrackCache.set(id, song);
  return song;
}

function mapYouTubeVideoItem(item) {
  if (!item) return null;
  const endpoint = item.endpoint && item.endpoint.payload || {};
  const id = item.id || item.video_id || endpoint.videoId || endpoint.video_id || '';
  if (!id) return null;
  const artists = (Array.isArray(item.artists) ? item.artists : []).map((artist) => ({
    id: artist.channel_id || artist.id || '',
    name: youtubeText(artist.name || artist),
  })).filter((artist) => artist.name);
  const authorName = youtubeText(item.author && (item.author.name || item.author));
  if (!artists.length && authorName) artists.push({ id: item.author && (item.author.channel_id || item.author.id) || '', name: authorName });
  const title = youtubeText(item.title || item.name);
  if (!title) return null;
  const durationSeconds = youtubeDurationSeconds(item.duration);
  const isLive = !!(item.is_live || item.is_live_content || item.live_now);
  const isShort = !!(item.is_short || item.is_shorts);
  const song = {
    provider: 'qq',
    realProvider: 'youtube',
    source: 'qq',
    type: 'qq',
    playbackTransport: 'youtube',
    contentType: isShort ? 'short' : (isLive ? 'live' : 'video'),
    isYouTubeVideo: true,
    youtubeSurface: 'video',
    youtubeSourceType: 'video',
    isYouTubeMusicResult: false,
    isYouTubeVideoResult: true,
    isLive,
    isShort,
    id,
    mid: id,
    songmid: id,
    youtubeId: id,
    videoId: id,
    name: title,
    title,
    artist: artists.map((artist) => artist.name).join(' / ') || youtubeText(item.subtitle),
    artists,
    artistId: artists[0] && artists[0].id || '',
    artistMid: artists[0] && artists[0].id || '',
    album: youtubeText(item.album && (item.album.name || item.album)) || '',
    albumId: String(item.album && (item.album.id || item.album.browse_id || item.album.browseId) || ''),
    cover: youtubeThumbnail(item),
    duration: durationSeconds * 1000,
    durationMs: durationSeconds * 1000,
    playable: true,
    lyricsMetadataProvider: 'youtube-video',
    externalUrl: `https://www.youtube.com/watch?v=${id}`,
  };
  youtubeTrackCache.set(id, song);
  return song;
}

function youtubeMusicSearchItems(result) {
  const output = [];
  const seen = new Set();
  const shelves = result && result.contents ? Array.from(result.contents) : [];
  shelves.forEach((shelf) => {
    const items = shelf && shelf.contents ? Array.from(shelf.contents) : [];
    items.forEach((item) => {
      const mapped = mapYouTubeMusicItem(item);
      if (!mapped || seen.has(mapped.videoId)) return;
      seen.add(mapped.videoId);
      output.push(mapped);
    });
  });
  if (!output.length && result && result.results) {
    Array.from(result.results).forEach((item) => {
      const mapped = mapYouTubeMusicItem(item);
      if (!mapped || seen.has(mapped.videoId)) return;
      seen.add(mapped.videoId);
      output.push(mapped);
    });
  }
  return output;
}

function youtubeVideoSearchItems(result) {
  const candidates = [];
  if (result && result.results) candidates.push(...Array.from(result.results));
  const shelves = result && result.contents ? Array.from(result.contents) : [];
  shelves.forEach((shelf) => {
    if (shelf && shelf.contents) candidates.push(...Array.from(shelf.contents));
    else candidates.push(shelf);
  });
  const output = [];
  const seen = new Set();
  candidates.forEach((item) => {
    const mapped = mapYouTubeVideoItem(item);
    if (!mapped || seen.has(mapped.videoId)) return;
    seen.add(mapped.videoId);
    output.push(mapped);
  });
  return output;
}

// Compatibility alias retained for older internal callers that expect the
// original YouTube Music song parser.
function youtubeSearchItems(result) {
  return youtubeMusicSearchItems(result);
}

const YOUTUBE_GENRE_PROFILES = [
  { key: 'phonk', label: 'Phonk', query: 'phonk music', patterns: [/(?:^|\W)phonk(?:\W|$)/i, /drift\s+phonk/i, /brazilian\s+phonk/i, /cowbell\s+phonk/i] },
  { key: 'funk', label: 'Funk', query: 'funk music', patterns: [/(?:^|\W)funk(?:y|\W|$)/i, /future\s+funk/i, /disco\s+funk/i, /nu[-\s]?disco/i, /brazilian\s+funk/i] },
  { key: 'deep-house', label: 'Deep House', query: 'deep house music', patterns: [/deep\s+house/i] },
  { key: 'slap-house', label: 'Slap House', query: 'slap house music', patterns: [/slap\s+house/i] },
  { key: 'future-bass', label: 'Future Bass', query: 'future bass music', patterns: [/future\s+bass/i, /melodic\s+bass/i] },
  { key: 'drum-bass', label: 'Drum & Bass', query: 'drum and bass music', patterns: [/drum\s*(?:and|&)\s*bass/i, /(?:^|\W)dnb(?:\W|$)/i, /liquid\s+dnb/i] },
  { key: 'dubstep', label: 'Dubstep', query: 'dubstep music', patterns: [/(?:^|\W)dubstep(?:\W|$)/i, /melodic\s+dubstep/i] },
  { key: 'hardstyle', label: 'Hardstyle', query: 'hardstyle music', patterns: [/(?:^|\W)hardstyle(?:\W|$)/i, /hardcore\s+edm/i] },
  { key: 'techno', label: 'Techno', query: 'techno music', patterns: [/(?:^|\W)techno(?:\W|$)/i, /melodic\s+techno/i] },
  { key: 'trance', label: 'Trance', query: 'trance music', patterns: [/(?:^|\W)trance(?:\W|$)/i, /psytrance/i] },
  { key: 'house', label: 'House', query: 'house music', patterns: [/(?:^|\W)house\s+music(?:\W|$)/i, /progressive\s+house/i, /electro\s+house/i, /bass\s+house/i, /tropical\s+house/i] },
  { key: 'edm', label: 'EDM', query: 'EDM electronic dance music', patterns: [/(?:^|\W)edm(?:\W|$)/i, /electronic\s+dance/i, /festival\s+(?:mix|anthem)/i, /big\s+room/i] },
  { key: 'synthwave', label: 'Synthwave', query: 'synthwave music', patterns: [/(?:^|\W)synthwave(?:\W|$)/i, /retrowave/i, /vaporwave/i] },
  { key: 'lofi', label: 'Lo-fi', query: 'lofi music', patterns: [/(?:^|\W)lo[-\s]?fi(?:\W|$)/i, /chillhop/i] },
  { key: 'hip-hop', label: 'Hip-hop', query: 'hip hop music', patterns: [/hip[-\s]?hop/i, /(?:^|\W)rap(?:\W|$)/i, /boom\s+bap/i] },
  { key: 'trap', label: 'Trap', query: 'trap music', patterns: [/(?:^|\W)trap(?:\W|$)/i, /melodic\s+trap/i] },
  { key: 'rnb', label: 'R&B', query: 'R&B music', patterns: [/(?:^|\W)r\s*(?:&|and)\s*b(?:\W|$)/i, /rhythm\s+and\s+blues/i, /neo\s+soul/i] },
  { key: 'rock', label: 'Rock', query: 'rock music', patterns: [/(?:^|\W)rock(?:\W|$)/i, /alternative\s+rock/i, /indie\s+rock/i, /punk\s+rock/i] },
  { key: 'metal', label: 'Metal', query: 'metal music', patterns: [/(?:^|\W)metal(?:\W|$)/i, /metalcore/i, /deathcore/i] },
  { key: 'jpop', label: 'J-Pop', query: 'J-pop music', patterns: [/(?:^|\W)j[-\s]?pop(?:\W|$)/i, /japanese\s+pop/i, /anime\s+(?:song|music|opening|ending)/i] },
  { key: 'kpop', label: 'K-Pop', query: 'K-pop music', patterns: [/(?:^|\W)k[-\s]?pop(?:\W|$)/i, /korean\s+pop/i] },
  { key: 'vpop', label: 'V-Pop', query: 'V-pop nhạc Việt', patterns: [/(?:^|\W)v[-\s]?pop(?:\W|$)/i, /nhạc\s+việt/i, /vietnamese\s+pop/i] },
  { key: 'vinahouse', label: 'Vinahouse', query: 'Vinahouse remix', patterns: [/(?:^|\W)vinahouse(?:\W|$)/i, /vina\s+house/i] },
  { key: 'bolero', label: 'Bolero', query: 'nhạc Bolero', patterns: [/(?:^|\W)bolero(?:\W|$)/i, /nhạc\s+trữ\s+tình/i] },
  { key: 'ballad', label: 'Ballad', query: 'ballad music', patterns: [/(?:^|\W)ballad(?:\W|$)/i, /acoustic\s+ballad/i] },
  { key: 'jazz', label: 'Jazz', query: 'jazz music', patterns: [/(?:^|\W)jazz(?:\W|$)/i, /smooth\s+jazz/i] },
  { key: 'classical', label: 'Classical', query: 'classical music', patterns: [/(?:^|\W)classical(?:\W|$)/i, /orchestra/i, /symphony/i, /piano\s+concerto/i] },
  { key: 'pop', label: 'Pop', query: 'pop music', patterns: [/(?:^|\W)pop\s+(?:music|song|hits?)(?:\W|$)/i, /dance\s+pop/i, /indie\s+pop/i, /electropop/i] },
];

function youtubeGenreProfileByKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return null;
  const found = YOUTUBE_GENRE_PROFILES.find((profile) => profile.key === key);
  if (found) return found;
  if (key === 'usuk') return { key: 'usuk', label: 'US/UK', query: 'US UK music hits', patterns: [] };
  if (key === 'similar') return { key: 'similar', label: 'Cùng phong cách', query: '', patterns: [] };
  return null;
}

function normalizeYouTubeGenreText(value) {
  if (Array.isArray(value)) return value.map(normalizeYouTubeGenreText).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    return Object.values(value).map(normalizeYouTubeGenreText).filter(Boolean).join(' ');
  }
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, ' ')
    .replace(/[_|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function youtubeGenreMetadataText(track, info) {
  track = track || {};
  info = info || {};
  return normalizeYouTubeGenreText([
    track.name, track.title, track.artist, track.album,
    info.title, info.track, info.artist, info.album, info.uploader, info.channel,
    info.genre, info.genres, info.categories, info.tags,
    String(info.description || '').slice(0, 1600),
  ]).toLowerCase();
}

function youtubeTextLooksVietnamese(text) {
  return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(String(text || ''));
}

function youtubeTextLooksCjkOrKorean(text) {
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(String(text || ''));
}

function classifyYouTubeMusicGenre(track, info) {
  const text = youtubeGenreMetadataText(track, info);
  for (const profile of YOUTUBE_GENRE_PROFILES) {
    if (profile.patterns.some((pattern) => pattern.test(text))) return profile;
  }

  const language = String(info && (info.language || info.audio_language || info.original_language) || '').toLowerCase();
  const categoryText = normalizeYouTubeGenreText(info && info.categories).toLowerCase();
  const musicLike = /music|âm nhạc|nhạc/i.test(categoryText) || /official\s+(?:music\s+)?video|official\s+audio|lyrics?|mv\b|audio\b/i.test(text);
  if ((language === 'en' || language.startsWith('en-')) && musicLike) {
    return { key: 'usuk', label: 'US/UK', query: 'US UK music hits', patterns: [] };
  }
  if (!youtubeTextLooksVietnamese(text) && !youtubeTextLooksCjkOrKorean(text) && /[a-z]{3,}/i.test(text) && musicLike) {
    return { key: 'usuk', label: 'US/UK', query: 'US UK music hits', patterns: [] };
  }

  return { key: 'similar', label: 'Cùng phong cách', query: '', patterns: [] };
}

function canonicalMusicRecommendationTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*(official|lyrics?|audio|video|mv|remix|sped|slowed|nightcore|visualizer)[^)]*\)/gi, ' ')
    .replace(/\[[^\]]*(official|lyrics?|audio|video|mv|remix|sped|slowed|nightcore|visualizer)[^\]]*\]/gi, ' ')
    .replace(/\b(official|music|video|audio|lyrics?|lyric|mv|visualizer|hd|4k|remastered|topic)\b/gi, ' ')
    .replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function genreRecommendationCandidateScore(song, profile, index) {
  const text = normalizeYouTubeGenreText([song && (song.name || song.title), song && song.artist]).toLowerCase();
  let score = Math.max(0, 110 - index - Number(song && song.genreQueryRank || 0) * 14);
  if (profile && profile.patterns && profile.patterns.some((pattern) => pattern.test(text))) score += 150;
  else if (profile && profile.key !== 'similar' && profile.key !== 'usuk') score -= 18;
  if (/official\s+(?:music\s+)?video|official\s+audio|lyrics?|visualizer|mv\b/i.test(text)) score += 18;
  if (/mix|playlist|compilation|one\s+hour|1\s*hour|live\s+stream/i.test(text)) score -= 55;
  if (/reaction|review|tutorial|how\s+to|gameplay|walkthrough|podcast|interview|documentary|trailer|movie\s+scene/i.test(text)) score -= 320;
  if (profile && profile.key === 'usuk') {
    if (youtubeTextLooksVietnamese(text) || youtubeTextLooksCjkOrKorean(text)) score -= 140;
    else if (/[a-z]{4,}/i.test(text)) score += 24;
  }
  const durationMs = Number(song && (song.durationMs || song.duration) || 0);
  if (durationMs > 0 && durationMs < 45 * 1000) score -= 35;
  if (durationMs > 30 * 60 * 1000) score -= 22;
  return score;
}

async function youtubeGenreSearch(profile, seedTrack, limit, sourceType = 'music') {
  const yt = await getYouTubeSearchClient().catch(() => getYouTubeClient());
  const seedTitle = String(seedTrack && (seedTrack.name || seedTrack.title) || '').trim();
  const seedArtist = String(seedTrack && seedTrack.artist || '').trim();
  const genreQuery = String(profile && profile.query || '').trim();
  const queries = [];
  const seenQueries = new Set();
  const addQuery = (value) => {
    const query = String(value || '').replace(/\s+/g, ' ').trim();
    const key = normalizeLyricMatchText(query);
    if (!query || !key || seenQueries.has(key)) return;
    seenQueries.add(key);
    queries.push(query);
  };
  if (genreQuery) {
    addQuery(`${genreQuery} ${seedArtist}`);
    addQuery(`${genreQuery} official audio`);
    addQuery(`${genreQuery} songs`);
  }
  addQuery(`${seedArtist} ${seedTitle} similar songs`);
  addQuery(`${seedArtist} radio`);

  const candidates = [];
  const seen = new Set();
  function addResult(result, queryRank) {
    const surface = sourceType === 'video' ? 'video' : 'music';
    const parsedItems = surface === 'video' ? youtubeVideoSearchItems(result) : youtubeMusicSearchItems(result);
    for (const item of markYouTubeSearchSurface(parsedItems, surface)) {
      const id = String(item.videoId || item.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      candidates.push({ ...item, genreQueryRank: queryRank });
    }
  }
  for (let i = 0; i < queries.length && candidates.length < Math.max(limit * 4, 48); i += 1) {
    try {
      const result = sourceType === 'video'
        ? await yt.search(queries[i], { type: 'video' })
        : await yt.music.search(queries[i], { type: 'song' });
      addResult(result, i);
    } catch (error) {
      console.warn('[YouTubeGenreRecommend] source search failed:', error && error.message || error);
    }
  }
  return candidates;
}

async function youtubeRecommendations(videoId, limit = 20, genreOverride = '', sourceType = 'music') {
  const id = String(videoId || '').trim();
  if (!id) throw Object.assign(new Error('YOUTUBE_VIDEO_ID_REQUIRED'), { status: 400 });
  const cappedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  sourceType = String(sourceType || '').toLowerCase() === 'video' ? 'video' : 'music';

  const cachedTrack = youtubeTrackCache.get(id) || {};
  let info = null;
  let profile = youtubeGenreProfileByKey(genreOverride);
  if (!profile) {
    const quickProfile = classifyYouTubeMusicGenre(cachedTrack, null);
    if (quickProfile.key !== 'similar') profile = quickProfile;
  }
  if (!profile || profile.key === 'similar') {
    try {
      info = await youtubeInfoViaYtDlp(id);
    } catch (error) {
      console.warn('[YouTubeGenreRecommend] metadata lookup failed:', error && error.message || error);
    }
  }
  const seedTrack = {
    ...cachedTrack,
    id,
    videoId: id,
    youtubeId: id,
    name: cachedTrack.name || cachedTrack.title || info && (info.track || info.title) || '',
    artist: cachedTrack.artist || info && (info.artist || info.uploader || info.channel) || 'YouTube',
  };
  if (!profile || profile.key === 'similar') profile = classifyYouTubeMusicGenre(seedTrack, info);
  const cacheKey = `genre|${sourceType}|${id}|${profile.key}|${cappedLimit}`;
  const cached = youtubeRecommendCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.items.map((item) => ({ ...item }));

  let candidates = [];
  try {
    candidates = await youtubeGenreSearch(profile, seedTrack, Math.max(cappedLimit * 3, 30), sourceType);
  } catch (error) {
    console.warn('[YouTubeGenreRecommend] genre search failed:', error && error.message || error);
  }

  const seedCanonical = canonicalMusicRecommendationTitle(seedTrack.name || seedTrack.title);
  const seedArtistCanonical = canonicalMusicRecommendationTitle(seedTrack.artist);
  const seenIds = new Set([id]);
  const seenTitles = new Set();
  const ranked = [];

  candidates.forEach((item, index) => {
    if (!item) return;
    const candidateId = String(item.videoId || item.id || '').trim();
    if (!candidateId || seenIds.has(candidateId)) return;
    const titleCanonical = canonicalMusicRecommendationTitle(item.name || item.title);
    const artistCanonical = canonicalMusicRecommendationTitle(item.artist);
    if (titleCanonical && seedCanonical && titleCanonical === seedCanonical && (!seedArtistCanonical || !artistCanonical || artistCanonical === seedArtistCanonical)) return;
    const titleKey = `${titleCanonical}|${artistCanonical}`;
    if (titleKey !== '|' && seenTitles.has(titleKey)) return;
    let score = genreRecommendationCandidateScore(item, profile, index);
    if (seedArtistCanonical && artistCanonical) {
      const artistOverlap = tokenOverlapScore(item.artist || '', seedTrack.artist || '');
      if (artistOverlap >= 0.65) score += 32;
      else if (artistOverlap > 0.15) score += 10;
    }
    if (score < 35) return;
    seenIds.add(candidateId);
    if (titleKey !== '|') seenTitles.add(titleKey);
    ranked.push({ item, score, index });
  });

  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  let items = ranked.slice(0, cappedLimit).map((entry) => ({
    ...entry.item,
    recommendationGenre: profile.key,
    recommendationGenreLabel: profile.label,
  }));

  if (!items.length) {
    const fallbackQuery = [seedTrack.artist, seedTrack.name || seedTrack.title, 'music'].filter(Boolean).join(' ');
    items = (await (sourceType === 'video' ? youtubeVideoSearch(fallbackQuery, cappedLimit + 4) : youtubeMusicSearch(fallbackQuery, cappedLimit + 4)))
      .filter((item) => String(item.videoId || item.id || '') !== id)
      .slice(0, cappedLimit)
      .map((item) => ({ ...item, recommendationGenre: profile.key, recommendationGenreLabel: profile.label }));
  }

  items = markYouTubeSearchSurface(items, sourceType);
  youtubeRecommendCache.set(cacheKey, { at: Date.now(), items });
  return items.map((item) => ({ ...item }));
}

function markYouTubeSearchSurface(items, surface) {
  const sourceType = surface === 'video' ? 'video' : 'music';
  return (Array.isArray(items) ? items : []).map((item) => {
    const id = String(item && (item.videoId || item.youtubeId || item.id) || '').trim();
    const marked = {
      ...item,
      provider: 'qq',
      source: 'qq',
      realProvider: 'youtube',
      playbackTransport: 'youtube',
      youtubeSurface: sourceType,
      youtubeSourceType: sourceType,
      isYouTubeMusicResult: sourceType === 'music',
      isYouTubeVideoResult: sourceType === 'video',
      contentType: sourceType === 'music' ? 'song' : (item && item.contentType || 'video'),
      lyricsMetadataProvider: sourceType === 'music' ? 'youtube-music' : 'youtube-video',
      externalUrl: id
        ? (sourceType === 'music'
          ? `https://music.youtube.com/watch?v=${id}`
          : `https://www.youtube.com/watch?v=${id}`)
        : String(item && item.externalUrl || ''),
    };
    if (id) youtubeTrackCache.set(id, marked);
    return marked;
  });
}

async function youtubeMusicSearch(query, limit = 18) {
  const normalizedQuery = String(query || '').trim();
  const maxItems = Math.max(1, Math.min(50, Number(limit) || 18));
  const key = `youtube-music|${normalizedQuery.toLowerCase()}|${maxItems}`;
  const cached = youtubeSearchCache.get(key);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.items.map((item) => ({ ...item }));
  if (!normalizedQuery) return [];

  const result = await runYouTubeSearch((yt) => yt.music.search(normalizedQuery, { type: 'song' }));
  const items = youtubeMusicSearchItems(result).slice(0, maxItems);
  youtubeSearchCache.set(key, { at: Date.now(), items });
  return items.map((item) => ({ ...item }));
}

async function youtubeVideoSearch(query, limit = 18) {
  const normalizedQuery = String(query || '').trim();
  const maxItems = Math.max(1, Math.min(50, Number(limit) || 18));
  const key = `youtube-video|${normalizedQuery.toLowerCase()}|${maxItems}`;
  const cached = youtubeSearchCache.get(key);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.items.map((item) => ({ ...item }));
  if (!normalizedQuery) return [];

  const result = await runYouTubeSearch((yt) => yt.search(normalizedQuery, { type: 'video' }));
  const items = youtubeVideoSearchItems(result).slice(0, maxItems);
  youtubeSearchCache.set(key, { at: Date.now(), items });
  return items.map((item) => ({ ...item }));
}

// Backward-compatible YouTube search now means YouTube Music again. Normal
// YouTube videos are exposed through youtubeVideoSearch and a separate UI
// source, so MV/background work cannot silently replace the music provider.
async function youtubeSearch(query, limit = 18) {
  return youtubeMusicSearch(query, limit);
}

async function youtubeAudioViaInnertube(videoId, quality = '', options = {}) {
  const refresh = !!(options && options.refresh);
  const cachedDescriptor = refresh ? null : cachedYouTubeAudioDescriptor(videoId, quality);
  if (cachedDescriptor) return playbackResultFromYouTubeDescriptor(cachedDescriptor, 'youtube-cache');
  const yt = await getYouTubeClient();
  const requested = String(quality || '').toLowerCase();
  const format = await yt.getStreamingData(String(videoId), {
    type: 'audio',
    quality: requested === 'standard' ? 'bestefficiency' : 'best',
    format: 'any',
  });
  const directUrl = String(format && format.url || '').trim();
  if (!directUrl) throw new Error('youtubei.js returned no audio URL');
  const descriptor = {
    url: directUrl,
    headers: {},
    mimeType: String(format && format.mime_type || ''),
    bitrate: Number(format && format.bitrate || 0),
    audioQuality: String(format && format.audio_quality || ''),
    videoId: String(videoId || ''),
    mediaKind: 'audio',
    requestedQuality: String(quality || ''),
  };
  cacheYouTubeAudioDescriptor(videoId, quality, descriptor);
  return {
    ...playbackResultFromYouTubeDescriptor(descriptor, 'youtubei.js-fast'),
    level: requested || 'exhigh',
    quality: requested === 'standard' ? 'Standard' : 'YouTube Music',
  };
}

async function youtubeAudioUrl(videoId, quality = '', options = {}) {
  const refresh = !!(options && options.refresh);
  const cachedDescriptor = refresh ? null : cachedYouTubeAudioDescriptor(videoId, quality);
  if (cachedDescriptor) return playbackResultFromYouTubeDescriptor(cachedDescriptor, 'youtube-cache');

  // Start the lightweight Innertube route immediately. Give it a very small
  // head start, then run yt-dlp in parallel. Whichever returns a valid stream
  // first starts playback; the slower result still warms the descriptor cache.
  const fastPromise = youtubeAudioViaInnertube(videoId, quality, { refresh });
  const ytDlpPromise = new Promise((resolve) => setTimeout(resolve, 180))
    .then(() => youtubeAudioViaYtDlp(videoId, quality, { refresh }));
  try {
    return await Promise.any([fastPromise, ytDlpPromise]);
  } catch (aggregate) {
    const errors = aggregate && Array.isArray(aggregate.errors) ? aggregate.errors : [];
    const fastError = errors[0] || null;
    const ytDlpError = errors[1] || errors[0] || aggregate;
    const engineCode = ytDlpFailureCode(ytDlpError);
    const actualEngineFailure = /^(YTDLP_NOT_FOUND|YTDLP_BLOCKED_OR_PERMISSION|YTDLP_INVALID_EXECUTABLE|ENOENT|EACCES|EPERM)$/i.test(engineCode);
    const error = new Error(`YouTube stream unavailable: ${ytDlpError && ytDlpError.message || 'yt-dlp failed'}; ${fastError && fastError.message || 'youtubei.js failed'}`);
    error.code = actualEngineFailure ? 'YOUTUBE_ENGINE_UNAVAILABLE' : 'YOUTUBE_STREAM_UNAVAILABLE';
    error.engineCode = engineCode;
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

async function spotifyStartPlayback({ deviceId, uri, contextUri, offsetUri, positionMs = 0 } = {}) {
  const normalizedUri = String(uri || '').trim();
  const normalizedContextUri = spotifyPlaylistContextUri(contextUri);
  if (!/^spotify:track:[A-Za-z0-9]+$/.test(normalizedUri) && !normalizedContextUri) {
    throw Object.assign(new Error(normalizedContextUri ? 'SPOTIFY_CONTEXT_URI_REQUIRED' : 'SPOTIFY_TRACK_URI_REQUIRED'), { status: 400 });
  }
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  const normalizedPositionMs = Math.max(0, Math.round(Number(positionMs) || 0));
  const body = normalizedContextUri
    ? {
        context_uri: normalizedContextUri,
        ...(String(offsetUri || '').trim() ? { offset: { uri: String(offsetUri).trim() } } : {}),
        position_ms: normalizedPositionMs,
      }
    : { uris: [normalizedUri], position_ms: normalizedPositionMs };
  await spotifyApi(`/me/player/play${query}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    uri: normalizedUri,
    contextUri: normalizedContextUri,
    deviceId: String(deviceId || ''),
    positionMs: normalizedPositionMs,
  };
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

async function resolveYouTubePlayback(videoId, quality, options = {}) {
  const stream = await youtubeAudioUrl(videoId, quality, options);
  return {
    ...stream,
    provider: 'youtube',
    playbackProvider: 'youtube',
    trial: false,
    playable: !!(stream.url || stream.proxyUrl),
    requestedQuality: quality || '',
  };
}

async function youtubeVideoViaInnertube(videoId, quality = 'auto', options = {}) {
  const id = String(videoId || '').trim();
  const mode = normalizeBackgroundVideoQuality(quality);
  const requestedQuality = mode === 'eco' ? '720p' : (mode === 'balanced' ? '1080p' : (mode === 'ultra' ? '2160p' : '1440p'));
  const yt = await getYouTubeClient();
  const format = await yt.getStreamingData(id, { type: 'video', quality: requestedQuality, format: 'any' });
  const directUrl = String(format && format.url || '').trim();
  if (!directUrl) throw new Error('youtubei.js returned no video URL');
  const descriptor = {
    url: directUrl,
    headers: {},
    mimeType: String(format && format.mime_type || ''),
    bitrate: Number(format && format.bitrate || 0),
    width: Number(format && format.width || 0),
    height: Number(format && format.height || 0),
    availableMaxHeight: Number(format && format.height || 0),
    fps: Number(format && format.fps || 0),
    videoQuality: String(format && (format.quality_label || format.quality) || ''),
    videoId: id,
    mediaKind: 'video',
    requestedQuality: mode,
    compatibility: !!(options && options.compatibility),
  };
  cacheYouTubeVideoDescriptor(id, quality, descriptor, options);
  return playbackResultFromYouTubeDescriptor(descriptor, 'youtubei.js-video-fast');
}

async function resolveYouTubeVideoBackground(videoId, quality = 'auto', options = {}) {
  const id = String(videoId || '').trim();
  if (!id) {
    const error = new Error('YOUTUBE_VIDEO_ID_REQUIRED');
    error.status = 400;
    throw error;
  }
  const mode = normalizeBackgroundVideoQuality(quality);
  // Compatibility recovery must let yt-dlp enforce its H.264/MP4 format
  // selection. Racing an arbitrary Innertube codec here could repeatedly pick
  // the same undecodable stream on older or policy-managed Windows 10 PCs.
  const fastPromise = options && options.compatibility
    ? youtubeVideoViaYtDlp(id, quality, options)
    : youtubeVideoViaInnertube(id, quality, options);
  const ytDlpPromise = options && options.compatibility
    ? Promise.reject(new Error('compatibility route uses yt-dlp only'))
    : new Promise((resolve) => setTimeout(resolve, 220)).then(() => youtubeVideoViaYtDlp(id, quality, options));
  try {
    const stream = options && options.compatibility
      ? await fastPromise
      : await Promise.any([fastPromise, ytDlpPromise]);
    return {
      ...stream,
      proxyUrl: stream.streamToken ? `/api/media?stream=${encodeURIComponent(stream.streamToken)}` : stream.proxyUrl,
      provider: 'youtube',
      playbackProvider: 'youtube',
      mediaKind: 'video',
      muted: true,
      playable: !!(stream.url || stream.proxyUrl),
      requestedQuality: mode,
      compatibility: !!(options && options.compatibility),
    };
  } catch (aggregate) {
    const errors = aggregate && Array.isArray(aggregate.errors) ? aggregate.errors : [];
    const fastError = errors[0] || null;
    const ytDlpError = errors[1] || errors[0] || aggregate;
    const error = new Error(`YouTube background video unavailable: ${ytDlpError && ytDlpError.message || 'yt-dlp failed'}; ${fastError && fastError.message || 'youtubei.js failed'}`);
    error.code = 'YOUTUBE_BACKGROUND_VIDEO_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
}

async function spotifyTrackVisualBackground(trackId) {
  const id = String(trackId || '').trim();
  if (!id) {
    const error = new Error('SPOTIFY_TRACK_ID_REQUIRED');
    error.status = 400;
    throw error;
  }
  const cached = spotifyVisualBackgroundCache.get(id);
  if (cached && Date.now() - Number(cached.at || 0) < SPOTIFY_VISUAL_BACKGROUND_TTL) return { ...cached.value };
  const market = providerConfig().spotifyMarket;
  let track = spotifyTrackCache.get(id);
  if (!track || !track.cover || !track.artistId) {
    track = mapSpotifyTrack(await spotifyApi(`/tracks/${encodeURIComponent(id)}?market=${encodeURIComponent(market)}`, { required: true }));
  }
  let artist = null;
  if (track && track.artistId) {
    artist = await spotifyApi(`/artists/${encodeURIComponent(track.artistId)}`, { required: true }).catch(() => null);
  }
  const artistImages = Array.isArray(artist && artist.images) ? artist.images.map((item) => item && item.url).filter(Boolean) : [];
  const albumImage = String(track && track.cover || '');
  const value = {
    provider: 'spotify',
    spotifyId: id,
    albumImage,
    artistImage: artistImages[0] || '',
    images: [...artistImages, albumImage].filter((item, index, list) => item && list.indexOf(item) === index),
    artist: String(track && track.artist || artist && artist.name || ''),
    title: String(track && track.name || ''),
  };
  spotifyVisualBackgroundCache.delete(id);
  spotifyVisualBackgroundCache.set(id, { at: Date.now(), value });
  while (spotifyVisualBackgroundCache.size > SPOTIFY_VISUAL_BACKGROUND_CACHE_LIMIT) {
    spotifyVisualBackgroundCache.delete(spotifyVisualBackgroundCache.keys().next().value);
  }
  return { ...value };
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


function spotifyYoutubeVersionPenalty(candidateTitle, targetTitle) {
  const candidate = normalizeLyricMatchText(candidateTitle);
  const target = normalizeLyricMatchText(targetTitle);
  const markers = [
    'live', 'remix', 'cover', 'karaoke', 'instrumental', 'nightcore',
    'sped up', 'speed up', 'slowed', 'slowed down', 'reverb', 'acoustic',
    'demo', 'edit', 'version', 'performance', 'concert'
  ];
  let penalty = 0;
  markers.forEach((marker) => {
    if (candidate.includes(marker) && !target.includes(marker)) penalty += marker === 'version' || marker === 'edit' ? 18 : 58;
  });
  return penalty;
}

function scoreSpotifyYoutubeReference(candidate, metadata = {}) {
  if (!candidate || !candidate.id) return -Infinity;
  const title = String(candidate.name || candidate.title || '');
  const artist = String(candidate.artist || '');
  const targetTitle = String(metadata.track || metadata.name || '');
  const targetArtist = String(metadata.artist || '');
  const titleA = normalizeLyricMatchText(title);
  const titleB = normalizeLyricMatchText(targetTitle);
  const titleOverlap = tokenOverlapScore(title, targetTitle);
  const artistOverlap = tokenOverlapScore(artist, targetArtist);
  let score = 0;
  if (titleA && titleB && titleA === titleB) score += 100;
  else if (titleA && titleB && (titleA.includes(titleB) || titleB.includes(titleA))) score += 72;
  else score += titleOverlap * 62;
  score += artistOverlap * 66;

  const candidateDurationMs = Number(candidate.duration || 0);
  let targetDurationMs = Number(metadata.duration || metadata.durationMs || 0);
  if (targetDurationMs > 0 && targetDurationMs < 10000) targetDurationMs *= 1000;
  if (candidateDurationMs > 0 && targetDurationMs > 0) {
    const delta = Math.abs(candidateDurationMs - targetDurationMs) / 1000;
    if (delta <= 1.5) score += 42;
    else if (delta <= 3.5) score += 30;
    else if (delta <= 6) score += 16;
    else if (delta <= 10) score -= 12;
    else score -= 78;
  }
  score -= spotifyYoutubeVersionPenalty(title, targetTitle);
  if (/official audio|topic/i.test(`${title} ${artist}`)) score += 10;
  return score;
}

function spotifyYoutubeLyricsSearchTerms(metadata = {}, query = {}) {
  const track = String(metadata.track || metadata.name || query.track || '').trim();
  const artist = String(metadata.artist || query.artist || '').trim();
  const album = String(metadata.album || query.album || '').trim();
  const terms = [];
  const seen = new Set();
  const add = (value) => {
    const term = String(value || '').replace(/\s+/g, ' ').trim();
    const key = normalizeLyricMatchText(term);
    if (!term || !key || seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  };
  if (metadata.isrc) add(String(metadata.isrc));
  const titles = lyricTitleVariants(track).slice(0, 3);
  const artists = lyricArtistVariants(artist).slice(0, 3);
  titles.forEach((title, titleIndex) => {
    (artists.length ? artists : ['']).forEach((artistName, artistIndex) => {
      if (terms.length >= 10) return;
      add(`${title} ${artistName}`);
      if (titleIndex === 0 && artistIndex === 0) {
        add(`${title} ${artistName} official audio`);
        add(`${title} ${artistName} lyrics`);
        if (album) add(`${title} ${artistName} ${album}`);
      }
    });
  });
  return terms.slice(0, 10);
}

async function spotifyYoutubeLyricsFallback(metadata = {}, query = {}) {
  const track = String(metadata.track || metadata.name || query.track || '').trim();
  const artist = String(metadata.artist || query.artist || '').trim();
  if (!track || !artist) return null;
  const durationSeconds = lyricSync.normalizeDurationSeconds(metadata.duration || metadata.durationMs || query.duration || 0);
  const cacheKey = String(metadata.spotifyId || metadata.currentTrackId || metadata.isrc || `${track}|${artist}|${durationSeconds}`).toLowerCase();
  const cached = spotifyYoutubeLyricsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.value ? 30 * 60 * 1000 : 4 * 60 * 1000)) {
    return cached.value ? { ...cached.value } : null;
  }

  const terms = spotifyYoutubeLyricsSearchTerms(metadata, query);
  const candidates = [];
  const seen = new Set();
  for (const term of terms) {
    let list = [];
    try { list = await youtubeSearch(term, 12); } catch (_) { list = []; }
    list.forEach((item) => {
      if (!item || !item.id || seen.has(item.id)) return;
      seen.add(item.id);
      candidates.push(item);
    });
  }

  const target = { ...metadata, track, artist, duration: durationSeconds };
  const ranked = candidates
    .map((candidate) => ({ candidate, score: scoreSpotifyYoutubeReference(candidate, target) }))
    // Keep the duration/version rejection in scoreSpotifyYoutubeReference,
    // but do not require an unrealistically perfect artist string. Spotify
    // often returns multi-artist credits while YouTube Music uses one channel.
    .filter((item) => item.score >= 90)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  let bestPlain = null;
  for (const item of ranked) {
    const reference = item.candidate;
    const match = {
      score: Math.round(item.score),
      track: reference.name || '',
      artist: reference.artist || '',
      duration: lyricSync.normalizeDurationSeconds(reference.duration || 0),
      videoId: reference.id,
      provider: 'youtube-reference',
    };
    try {
      const timed = await youtubeCaptionService.fetchForVideo(reference.id, {
        getInfo: youtubeInfoViaYtDlp,
        userAgent: UA,
        languages: [query.language, providerConfig().language, 'vi', 'en'].filter(Boolean),
        log: false,
      });
      if (timed && (timed.yrc || timed.lyric)) {
        const value = {
          ...timed,
          source: `spotify-${timed.source}`,
          metadataProvider: 'spotify',
          metadata,
          match,
          youtubeReference: { id: reference.id, title: reference.name || '', artist: reference.artist || '', score: Math.round(item.score) },
        };
        spotifyYoutubeLyricsCache.set(cacheKey, { at: Date.now(), value });
        return { ...value };
      }
      if (timed && timed.plainLyric && !bestPlain) {
        bestPlain = {
          ...timed,
          lyric: '',
          yrc: '',
          source: `spotify-${timed.source || 'youtube-caption-plain'}`,
          metadataProvider: 'spotify',
          metadata,
          match,
          youtubeReference: { id: reference.id, title: reference.name || '', artist: reference.artist || '', score: Math.round(item.score) },
        };
      }
    } catch (_) {}

    try {
      const native = await youtubeMusicNativeLyrics(reference.id);
      if (native && native.plainLyric) {
        const base = {
          lyric: '',
          tlyric: '',
          yrc: '',
          plainLyric: native.plainLyric,
          source: 'spotify-youtube-music',
          metadataProvider: 'spotify',
          metadata,
          match,
          youtubeReference: { id: reference.id, title: reference.name || '', artist: reference.artist || '', score: Math.round(item.score) },
        };
        const alignment = await youtubeForcedAlignmentService.request(reference.id, {
          plainLyric: native.plainLyric,
          duration: match.duration || durationSeconds,
          language: query.language || providerConfig().language || 'auto',
          track,
          artist,
        }, {
          getYtDlpEngine: prepareYouTubeEngine,
          findNodeRuntime,
        });
        if (alignment && alignment.status === 'ready' && alignment.result) {
          const value = {
            ...alignment.result,
            source: 'spotify-youtube-forced-alignment',
            metadataProvider: 'spotify',
            metadata,
            match,
            youtubeReference: base.youtubeReference,
            alignment: { status: 'ready', stage: 'ready' },
          };
          spotifyYoutubeLyricsCache.set(cacheKey, { at: Date.now(), value });
          return { ...value };
        }
        base.alignment = alignment || { status: 'failed', stage: 'unavailable' };
        if (!bestPlain) bestPlain = base;
      }
    } catch (_) {}
  }

  spotifyYoutubeLyricsCache.set(cacheKey, { at: Date.now(), value: bestPlain });
  return bestPlain ? { ...bestPlain } : null;
}

async function fetchLrclibJson(pathname, params) {
  const response = await fetchWithTimeout(`${LRCLIB_BASE}${pathname}?${params.toString()}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  }, 8500);
  const data = await response.json().catch(() => (pathname === '/search' ? [] : {}));
  if (!response.ok) return pathname === '/search' ? [] : null;
  return data;
}

async function safeFetchLrclibJson(pathname, params) {
  try {
    return await fetchLrclibJson(pathname, params);
  } catch (error) {
    console.warn('[LRCLIB]', pathname, error && (error.message || error));
    return pathname === '/search' ? [] : null;
  }
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
  const currentTrackId = spotifyLyricsTrackId(query.currentTrackId);
  const requestedTrackId = spotifyLyricsTrackId(id);
  const linkedFromId = spotifyLyricsTrackId(meta.linkedFromId || meta.relinkedFromId);
  return {
    ...meta,
    name: String(meta.name || query.track || '').trim(),
    artist: String(meta.artist || query.artist || '').trim(),
    album: String(meta.album || query.album || '').trim(),
    duration: Number(meta.duration || query.duration || 0),
    isrc: String(meta.isrc || meta.externalIds && meta.externalIds.isrc || ''),
    currentTrackId,
    linkedFromId,
    candidateSpotifyIds: [currentTrackId, requestedTrackId, meta.spotifyId, meta.id, linkedFromId].filter(Boolean),
  };
}


function youtubeReferenceMetadataDurationMs(value) {
  let duration = Number(value || 0);
  if (duration > 0 && duration < 10000) duration *= 1000;
  return duration;
}

async function youtubeMusicLyricsReference(metadata = {}, query = {}) {
  const track = String(metadata.track || metadata.name || query.track || '').trim();
  const artist = String(metadata.artist || query.artist || '').trim();
  const durationMs = youtubeReferenceMetadataDurationMs(metadata.duration || metadata.durationMs || query.duration || 0);
  if (!track) return null;
  const cacheKey = normalizeLyricMatchText([track, artist, Math.round(durationMs / 1000)].join('|'));
  const cached = youtubeMusicReferenceCache.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.value ? 30 * 60 * 1000 : 4 * 60 * 1000)) {
    return cached.value ? { ...cached.value } : null;
  }

  const yt = await getYouTubeSearchClient().catch(() => getYouTubeClient());
  const queries = [];
  const seenQueries = new Set();
  const addQuery = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const key = normalizeLyricMatchText(text);
    if (!text || !key || seenQueries.has(key)) return;
    seenQueries.add(key);
    queries.push(text);
  };
  addQuery(`${track} ${artist}`);
  addQuery(`${track} ${artist} official audio`);
  addQuery(`${track} ${artist} topic`);
  addQuery(track);

  const candidates = [];
  const seenIds = new Set();
  for (const term of queries.slice(0, 4)) {
    try {
      const result = await yt.music.search(term, { type: 'song' });
      youtubeMusicSearchItems(result).forEach((candidate) => {
        const id = String(candidate && (candidate.videoId || candidate.id) || '').trim();
        if (!id || seenIds.has(id)) return;
        seenIds.add(id);
        candidates.push(candidate);
      });
    } catch (error) {
      console.warn('[YouTubeMusicLyricsReference] search failed:', error && error.message || error);
    }
  }

  const target = { track, artist, duration: durationMs };
  const ranked = candidates
    .map((candidate) => ({ candidate, score: scoreSpotifyYoutubeReference(candidate, target) }))
    .filter((item) => item.score >= 96)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0] || null;
  const value = best ? {
    id: String(best.candidate.videoId || best.candidate.id || ''),
    title: best.candidate.name || best.candidate.title || '',
    artist: best.candidate.artist || '',
    duration: lyricSync.normalizeDurationSeconds(best.candidate.duration || 0),
    score: Math.round(best.score),
  } : null;
  youtubeMusicReferenceCache.set(cacheKey, { at: Date.now(), value });
  return value ? { ...value } : null;
}

async function youtubeMusicReferenceLyrics(metadata = {}, query = {}) {
  const reference = await youtubeMusicLyricsReference(metadata, query);
  if (!reference || !reference.id) return null;
  let native = null;
  try { native = await youtubeMusicNativeLyrics(reference.id); } catch (_) { native = null; }
  if (!native || !native.plainLyric) return null;
  return { ...native, youtubeMusicReference: reference, source: 'youtube-music-reference' };
}

function plainLyricForExactVideoAlignment(result = {}) {
  const direct = String(result.plainLyric || '').trim();
  if (direct) return direct;
  return String(result.lyric || '')
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\[[0-9:.]+\]/, '')
      .replace(/^\[[0-9]+,[0-9]+\]/, '')
      .replace(/\([0-9]+,[0-9]+(?:,[0-9]+)?\)/g, '')
      .trim())
    .filter(Boolean)
    .join('\n');
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
    currentTrackId: provider === 'spotify' ? String(meta.currentTrackId || query.currentTrackId || '') : '',
    linkedFromId: provider === 'spotify' ? String(meta.linkedFromId || '') : '',
    candidateSpotifyIds: provider === 'spotify' ? (Array.isArray(meta.candidateSpotifyIds) ? meta.candidateSpotifyIds : []) : [],
    market: provider === 'spotify' ? providerConfig().spotifyMarket : '',
  };
  const youtubeSourceType = provider === 'youtube' && String(query.sourceType || query.youtubeSourceType || '').toLowerCase() === 'video'
    ? 'video'
    : 'music';
  if (provider === 'youtube') metadata.youtubeSourceType = youtubeSourceType;

  // Exact captions belong to the selected YouTube video itself, so their
  // timestamps already include that video's intro, outro, pauses, and edits.
  // Always prefer them before borrowing text/timing from YouTube Music or
  // LRCLIB. This is the only zero-remap lyric source for a normal YouTube MV.
  if (provider === 'youtube' && id) {
    try {
      const exactCaption = await youtubeCaptionService.fetchForVideo(id, {
        getInfo: youtubeInfoViaYtDlp,
        userAgent: UA,
        languages: [query.language, providerConfig().language, 'vi', 'en'].filter(Boolean),
      });
      if (exactCaption && exactCaption.exactVideoTiming && (exactCaption.yrc || exactCaption.lyric)) {
        return {
          ...exactCaption,
          metadataProvider: youtubeSourceType === 'music' ? 'youtube-music' : 'youtube-video',
          metadata,
          match: { score: 100, duration, source: youtubeSourceType === 'music' ? 'exact-youtube-music-caption' : 'exact-selected-video-caption' },
          exactVideoTiming: true,
        };
      }
    } catch (error) {
      console.warn('[YouTubeExactCaptionLyrics]', error && error.message || error);
    }
  }
  // YouTube Music lyrics and regular YouTube captions are separate data
  // sources. Read the Lyrics tab through youtubei.js first so tracks that show
  // lyrics in YouTube Music still have text even when the video has no caption
  // track and LRCLIB has no matching entry. The native text is later passed to
  // the existing local forced aligner to create word timing without changing UI.
  let youtubeMusicLyric = null;
  let youtubeMusicReference = null;
  if (provider === 'youtube' && id) {
    // YouTube Music is a first-class music source again: use the exact song ID
    // returned by yt.music.search for lyrics, metadata, playback and timing.
    // Only normal YouTube videos may borrow lyric text from a separately
    // matched YouTube Music song.
    try { youtubeMusicLyric = await youtubeMusicNativeLyrics(id); } catch (_) { youtubeMusicLyric = null; }
    if (youtubeSourceType === 'video' && (!youtubeMusicLyric || !youtubeMusicLyric.plainLyric)) {
      try {
        youtubeMusicLyric = await youtubeMusicReferenceLyrics(metadata, query);
        youtubeMusicReference = youtubeMusicLyric && youtubeMusicLyric.youtubeMusicReference || null;
      } catch (error) {
        console.warn('[YouTubeMusicLyricsReference]', error && error.message || error);
      }
    }
  }

  // Keep the normal YouTube video for playback, while lyrics can come from a
  // separately matched YouTube Music song. Automatic video captions are used
  // only as a last resort because spoken captions often are not song lyrics.

  if (!trackName) return { lyric: '', tlyric: '', yrc: '', source: 'lrclib', plainLyric: '', metadataProvider: provider, metadata };

  // For Spotify playback, first request Spotify's own timed line data so the
  // lyric line changes use the same timestamps as the Spotify client. Any
  // rejection or unsupported track falls through to the existing LRCLIB path.
  let spotifyYoutubeFallback = null;
  let spotifyPlainFallback = null;
  if (provider === 'spotify') {
    const spotifyTimed = await spotifyNativeLyrics(metadata.currentTrackId || metadata.spotifyId || id, metadata);
    if (spotifyTimed && spotifyTimed.lyric) return spotifyTimed;
    if (spotifyTimed && spotifyTimed.plainLyric) spotifyPlainFallback = spotifyTimed;
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
  addCandidate(await safeFetchLrclibJson('/get', exactParams));

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
  const searchResults = await Promise.all(searches.slice(0, 7).map((params) => safeFetchLrclibJson('/search', params)));
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
    source: nativeYouTubePlainLyric ? (youtubeMusicReference ? 'youtube-music-reference' : 'youtube-music') : 'lrclib',
    metadataProvider: provider === 'spotify' ? 'spotify' : (provider === 'youtube' ? (youtubeSourceType === 'music' ? 'youtube-music' : 'youtube-video') : provider),
    metadata,
    match,
    youtubeMusicLyrics: nativeYouTubePlainLyric ? {
      available: true,
      provider: youtubeMusicLyric.provider || 'YouTube Music',
      syncType: youtubeMusicLyric.syncType || 'UNSYNCED',
      reference: youtubeMusicReference || undefined,
    } : undefined,
  };

  // Prefer an exact LRCLIB result before starting the much more expensive
  // YouTube reference search. Besides reducing provider traffic, this keeps a
  // normal track switch from waiting on YouTube discovery before lyrics or the
  // next audio item can become ready. YouTube remains the final timed fallback
  // when Spotify and LRCLIB have no usable text for the exact track.
  if (provider === 'spotify' && baseResult.plainLyric && !baseResult.lyric) {
    return {
      ...baseResult,
      metadataProvider: 'spotify',
      metadata,
      match,
    };
  }
  if (provider === 'spotify' && spotifyPlainFallback && !baseResult.lyric) {
    return {
      ...spotifyPlainFallback,
      metadataProvider: 'spotify',
      metadata,
      match: match || spotifyPlainFallback.match || null,
    };
  }
  if (provider === 'spotify' && !baseResult.lyric && !baseResult.plainLyric) {
    spotifyYoutubeFallback = await spotifyYoutubeLyricsFallback(metadata, query);
    if (spotifyYoutubeFallback && (spotifyYoutubeFallback.yrc || spotifyYoutubeFallback.lyric || spotifyYoutubeFallback.plainLyric)) {
      return {
        ...spotifyYoutubeFallback,
        metadataProvider: 'spotify',
        metadata,
        match: spotifyYoutubeFallback.match || match,
      };
    }
  }

  // Keep the two YouTube sources independent. YouTube Music restores the
  // original music-provider path: exact music video ID, exact metadata and
  // native/LRCLIB timing remain visible while optional alignment improves it.
  // Normal YouTube video keeps the stricter exact-video alignment path.
  if (provider === 'youtube' && id && (baseResult.lyric || baseResult.plainLyric)) {
    const exactTranscript = plainLyricForExactVideoAlignment(baseResult);
    const alignmentPayload = youtubeSourceType === 'music'
      ? {
        syncedLyric: baseResult.lyric,
        plainLyric: baseResult.plainLyric,
        duration,
        language: query.language || providerConfig().language || 'auto',
        track: trackName,
        artist: artistName,
        exactVideoAlignment: false,
      }
      : {
        syncedLyric: '',
        plainLyric: exactTranscript,
        duration,
        language: query.language || providerConfig().language || 'auto',
        track: trackName,
        artist: artistName,
        exactVideoAlignment: true,
      };
    const alignment = exactTranscript ? await youtubeForcedAlignmentService.request(id, alignmentPayload, {
      getYtDlpEngine: prepareYouTubeEngine,
      findNodeRuntime,
    }) : null;
    if (alignment && alignment.status === 'ready' && alignment.result) {
      return {
        ...alignment.result,
        metadataProvider: youtubeSourceType === 'music' ? 'youtube-music' : 'youtube-video',
        metadata,
        match,
        youtubeMusicLyrics: baseResult.youtubeMusicLyrics,
        exactVideoTiming: youtubeSourceType === 'video' ? alignment.result.exactVideoTiming === true : undefined,
        alignment: { status: 'ready', stage: 'ready' },
      };
    }
    if (youtubeSourceType === 'video' && alignment && alignment.status === 'processing') {
      // A normal video must not display timing borrowed from another version.
      return {
        lyric: '',
        tlyric: '',
        yrc: '',
        plainLyric: '',
        source: 'youtube-video-alignment-pending',
        metadataProvider: 'youtube-video',
        metadata,
        match,
        exactVideoTiming: false,
        youtubeMusicLyrics: baseResult.youtubeMusicLyrics,
        alignment,
      };
    }
    // YouTube Music keeps its original timed/plain result visible while the
    // background alignment task runs, matching the behaviour before universal
    // YouTube video search was introduced.
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
    youtubeSourceType: 'video',
    youtubeSurface: 'video',
    isYouTubeMusicResult: false,
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
  const songs = await youtubeVideoSearch(`${term} podcast`, Math.max(6, Math.min(30, Number(limit) || 18)));
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
  youtubeRedirectUri,
  youtubeLoginStatus,
  beginYouTubeLogin,
  beginYouTubeOfficialLogin,
  completeYouTubeLogin,
  youtubeLoginResult,
  clearYouTubeToken,
  setYouTubeCookieProvider,
  invalidateYouTubeAccountSession,
  youtubeAccountPlaylists,
  youtubeAccountPlaylistTracks,
  youtubePlaylistSyncDiagnostics,
  youtubeCallbackHtml,
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
  youtubeMusicSearch,
  youtubeVideoSearch,
  youtubeRecommendations,
  youtubePlaylistTracks,
  youtubeArtistDetail,
  resolveSpotifyPlayback,
  resolveYouTubePlayback,
  resolveYouTubeVideoBackground,
  spotifyTrackVisualBackground,
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
  setSpotifySessionLyricsProvider,
  spotifyLyricsCandidateIds,
  normalizeSpotifyLyricsPayload,
  scoreSpotifyYoutubeReference,
  spotifyYoutubeLyricsFallback,
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
  repairYouTubeEngine,
  youtubeEngineStatus,
  getYouTubeStreamDescriptor,
  __testing: {
    normalizeYouTubePlaylistId,
    youtubePlaylistFromNode,
    mergeYouTubePlaylists,
    youtubeTrackFromDeviceNode,
    youtubeRawPlaylistFromObject,
    collectYouTubeRawPlaylists,
    collectYouTubeContinuationTokens,
    youtubePlaylistFromDataApiItem,
    youtubeSpecialPlaylistSummary,
    youtubeCookieLooksSignedIn,
    youtubeDurationSeconds,
    youtubeThumbnail,
    youtubeBackgroundVideoLimits,
    youtubeBackgroundVideoFormat,
    youtubeCachedVideoDescriptor,
    mapYouTubeMusicItem,
    youtubeSearchItems,
    markYouTubeSearchSurface,
    classifyYouTubeMusicGenre,
    youtubeGenreProfileByKey,
    canonicalMusicRecommendationTitle,
    genreRecommendationCandidateScore,
  },
};
