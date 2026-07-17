const { app, BrowserWindow, ipcMain, shell, screen, session, globalShortcut, dialog, desktopCapturer, components, protocol } = require('electron');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { execFile, spawn } = require('child_process');
const { DiscordPresenceManager } = require('./discord-presence');
const { getLocalLibrary } = require('../local-library');
let localLibrary = null;

let mainWindow = null;
let localServer = null;
let musicProvidersBridge = null;
let mainServerPort = 0;
let castlabsComponentState = { ready: false, status: null, error: '' };
let audioSessionBridgeProcess = null;
let discordPresence = null;
let desktopLyricsWindow = null;
let desktopLyricsState = {};
let desktopLyricsUserBounds = null;
let desktopLyricsProgrammaticMove = false;
let desktopLyricsPointerCapture = false;
let desktopLyricsMouseIgnored = null;
let desktopLyricsMousePoller = null;
let desktopLyricsMousePollerBuffer = '';
let desktopLyricsHotBounds = null;
let desktopLyricsLastMiddleAt = 0;
let wallpaperWindow = null;
let wallpaperState = {};
let htmlFullscreenActive = false;
let windowFullscreenActive = false;
let mainWindowStateTimer = null;
const registeredGlobalHotkeys = new Map();

const WINDOWED_ASPECT = 16 / 9;
const WINDOWED_SCALE = 3 / 4;
const WINDOWED_MARGIN = 32;
const MIN_WINDOWED_WIDTH = 960;
const MIN_WINDOWED_HEIGHT = 540;
const APP_NAME = 'ShinaYuu Music';
const APP_USER_MODEL_ID = 'com.shinayuu.music';
const APP_ICON_ICO = path.join(__dirname, '..', 'build', 'icon.ico');
const NETEASE_LOGIN_PARTITION = 'persist:mineradio-netease-login';
const NETEASE_LOGIN_URL = 'https://music.163.com/#/login';
const QQ_LOGIN_PARTITION = 'persist:mineradio-qqmusic-login';
const QQ_LOGIN_URL = 'https://y.qq.com/n/ryqq/profile';
const YOUTUBE_LOGIN_PARTITION = 'persist:shinayuu-youtube-login';
const YOUTUBE_LOGIN_URL = 'https://accounts.google.com/AccountChooser?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2Ffeed%2Fplaylists';
const YOUTUBE_LOGIN_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BACKGROUND_MEDIA_SCHEME = 'shinayuu-media';
const BACKGROUND_MEDIA_MAX_FILES = 600;
const BACKGROUND_MEDIA_MAX_DEPTH = 6;
const BACKGROUND_MEDIA_EXTENSIONS = new Map([
  ['.jpg', { type: 'image', mime: 'image/jpeg' }],
  ['.jpeg', { type: 'image', mime: 'image/jpeg' }],
  ['.png', { type: 'image', mime: 'image/png' }],
  ['.webp', { type: 'image', mime: 'image/webp' }],
  ['.gif', { type: 'image', mime: 'image/gif' }],
  ['.avif', { type: 'image', mime: 'image/avif' }],
  ['.bmp', { type: 'image', mime: 'image/bmp' }],
  ['.mp4', { type: 'video', mime: 'video/mp4' }],
  ['.webm', { type: 'video', mime: 'video/webm' }],
  ['.mov', { type: 'video', mime: 'video/quicktime' }],
  ['.m4v', { type: 'video', mime: 'video/x-m4v' }],
]);
let backgroundMediaRoots = new Set();
let backgroundMediaProtocolReady = false;

protocol.registerSchemesAsPrivileged([{
  scheme: BACKGROUND_MEDIA_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}]);

function normalizeBackgroundMediaRoot(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const resolved = path.resolve(raw);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function backgroundMediaRootsFile() {
  return path.join(app.getPath('userData'), 'background-media-folders.json');
}

function loadBackgroundMediaRoots() {
  try {
    const raw = JSON.parse(fs.readFileSync(backgroundMediaRootsFile(), 'utf8'));
    const roots = Array.isArray(raw && raw.roots) ? raw.roots : [];
    backgroundMediaRoots = new Set(roots.map(normalizeBackgroundMediaRoot).filter(Boolean));
  } catch (_) {
    backgroundMediaRoots = new Set();
  }
}

function saveBackgroundMediaRoots() {
  try {
    fs.mkdirSync(path.dirname(backgroundMediaRootsFile()), { recursive: true });
    fs.writeFileSync(backgroundMediaRootsFile(), JSON.stringify({ roots: Array.from(backgroundMediaRoots) }, null, 2), 'utf8');
  } catch (error) {
    console.warn('[BackgroundMedia] Could not save folder list:', error.message);
  }
}

function rememberBackgroundMediaRoot(folderPath) {
  const normalized = normalizeBackgroundMediaRoot(folderPath);
  if (!normalized) return;
  backgroundMediaRoots.add(normalized);
  saveBackgroundMediaRoots();
}

function backgroundMediaPathAllowed(filePath) {
  const normalized = normalizeBackgroundMediaRoot(filePath);
  for (const root of backgroundMediaRoots) {
    if (normalized === root || normalized.startsWith(root + path.sep)) return true;
  }
  return false;
}

function encodeBackgroundMediaUrl(filePath) {
  return `${BACKGROUND_MEDIA_SCHEME}://local/${Buffer.from(String(filePath), 'utf8').toString('base64url')}`;
}

function decodeBackgroundMediaUrl(urlValue) {
  const parsed = new URL(String(urlValue || ''));
  if (parsed.protocol !== `${BACKGROUND_MEDIA_SCHEME}:` || parsed.hostname !== 'local') return '';
  return Buffer.from(parsed.pathname.replace(/^\/+/, ''), 'base64url').toString('utf8');
}

function parseBackgroundMediaByteRange(rangeHeader, fileSize) {
  const value = String(rangeHeader || '').trim();
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match) return { invalid: true };

  let start;
  let end;
  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? fileSize - 1 : Number(match[2]);
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= fileSize || end < start) {
    return { invalid: true };
  }
  end = Math.min(end, fileSize - 1);
  return { start, end, length: end - start + 1 };
}

function backgroundMediaResponseHeaders(media, fileSize) {
  return {
    'Content-Type': media.mime,
    'Content-Length': String(fileSize),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  };
}

function registerBackgroundMediaProtocol() {
  if (backgroundMediaProtocolReady) return;
  backgroundMediaProtocolReady = true;
  protocol.handle(BACKGROUND_MEDIA_SCHEME, async (request) => {
    try {
      const filePath = decodeBackgroundMediaUrl(request.url);
      const media = BACKGROUND_MEDIA_EXTENSIONS.get(path.extname(filePath).toLowerCase());
      if (!filePath || !media || !backgroundMediaPathAllowed(filePath)) {
        return new Response('Not found', { status: 404 });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }

      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size <= 0) return new Response('Not found', { status: 404 });

      const range = parseBackgroundMediaByteRange(request.headers.get('range'), stat.size);
      if (range && range.invalid) {
        return new Response(null, {
          status: 416,
          headers: {
            'Content-Range': `bytes */${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Type': media.mime,
          },
        });
      }

      const headers = backgroundMediaResponseHeaders(media, range ? range.length : stat.size);
      if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
      if (request.method === 'HEAD') {
        return new Response(null, { status: range ? 206 : 200, headers });
      }

      const nodeStream = fs.createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined);
      return new Response(Readable.toWeb(nodeStream), {
        status: range ? 206 : 200,
        headers,
      });
    } catch (error) {
      console.warn('[BackgroundMedia] Protocol request failed:', error.message);
      return new Response('Not found', { status: 404 });
    }
  });
}

async function scanBackgroundMediaFolder(folderPath) {
  const resolvedRoot = path.resolve(String(folderPath || '').trim());
  const rootStat = await fs.promises.stat(resolvedRoot);
  if (!rootStat.isDirectory()) throw new Error('BACKGROUND_MEDIA_FOLDER_INVALID');
  rememberBackgroundMediaRoot(resolvedRoot);

  const items = [];
  let truncated = false;
  async function walk(currentPath, depth) {
    if (items.length >= BACKGROUND_MEDIA_MAX_FILES) { truncated = true; return; }
    let entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    entries = entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    for (const entry of entries) {
      if (items.length >= BACKGROUND_MEDIA_MAX_FILES) { truncated = true; break; }
      if (!entry || entry.name.startsWith('.')) continue;
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (depth < BACKGROUND_MEDIA_MAX_DEPTH) await walk(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const media = BACKGROUND_MEDIA_EXTENSIONS.get(path.extname(entry.name).toLowerCase());
      if (!media) continue;
      let stat;
      try { stat = await fs.promises.stat(absolutePath); } catch (_) { continue; }
      items.push({
        id: Buffer.from(absolutePath, 'utf8').toString('base64url'),
        name: entry.name,
        relativePath: path.relative(resolvedRoot, absolutePath),
        path: absolutePath,
        type: media.type,
        mime: media.mime,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        url: encodeBackgroundMediaUrl(absolutePath),
      });
    }
  }
  await walk(resolvedRoot, 0);
  items.sort((a, b) => a.type.localeCompare(b.type) || a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' }));
  return {
    ok: true,
    folderPath: resolvedRoot,
    folderName: path.basename(resolvedRoot) || resolvedRoot,
    items,
    truncated,
    maxFiles: BACKGROUND_MEDIA_MAX_FILES,
  };
}

async function chooseBackgroundMediaFolder(owner) {
  const result = await dialog.showOpenDialog(owner, {
    title: 'Chọn thư mục ảnh và video nền',
    properties: ['openDirectory'],
    buttonLabel: 'Dùng thư mục này',
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
  return scanBackgroundMediaFolder(result.filePaths[0]);
}

const CHROMIUM_PERFORMANCE_SWITCHES = [
  ['autoplay-policy', 'no-user-gesture-required'],
  ['ignore-gpu-blocklist'],
  ['enable-gpu-rasterization'],
  ['enable-oop-rasterization'],
  ['enable-zero-copy'],
  ['enable-accelerated-2d-canvas'],
  ['disable-background-timer-throttling'],
  ['disable-renderer-backgrounding'],
  ['disable-backgrounding-occluded-windows'],
  ['force_high_performance_gpu'],
  ['use-angle', 'd3d11'],
];
for (const [name, value] of CHROMIUM_PERFORMANCE_SWITCHES) {
  if (value == null) app.commandLine.appendSwitch(name);
  else app.commandLine.appendSwitch(name, value);
}
const gotSingleInstanceLock = app.requestSingleInstanceLock();

const QQ_LOGIN_COOKIE_PRIORITY = [
  'uin',
  'qqmusic_uin',
  'wxuin',
  'login_type',
  'qm_keyst',
  'qqmusic_key',
  'p_skey',
  'skey',
  'psrf_qqopenid',
  'psrf_qqunionid',
  'psrf_qqaccess_token',
  'psrf_qqrefresh_token',
  'wxopenid',
  'wxunionid',
  'wxrefresh_token',
  'wxskey',
  'p_uin',
  'ptcz',
  'RK',
];
const NETEASE_LOGIN_COOKIE_PRIORITY = [
  'MUSIC_U',
  '__csrf',
  'NMTID',
  'MUSIC_A',
  '__remember_me',
  '_ntes_nuid',
  '_ntes_nnid',
  'WEVNSM',
  'WNMCID',
  'JSESSIONID-WYYY',
];
const YOUTUBE_LOGIN_COOKIE_PRIORITY = [
  'SAPISID', '__Secure-1PAPISID', '__Secure-3PAPISID',
  'SID', '__Secure-1PSID', '__Secure-3PSID',
  'HSID', 'SSID', 'APISID',
  'LOGIN_INFO', 'PREF', 'VISITOR_INFO1_LIVE', 'YSC',
  'CONSENT', 'SOCS', 'SIDCC', '__Secure-1PSIDCC', '__Secure-3PSIDCC',
];

function findOpenPort(startPort) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      const tester = net.createServer();

      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          tryPort(port + 1);
          return;
        }
        reject(err);
      });

      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });

      tester.listen(port, '127.0.0.1');
    }

    tryPort(startPort);
  });
}

function waitForServer(server) {
  if (!server || server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

let realtimeAudioCaptureConfigured = false;

function configureRealtimeAudioCaptureSession(ses, port) {
  if (!ses || realtimeAudioCaptureConfigured || typeof ses.setDisplayMediaRequestHandler !== 'function') return;
  realtimeAudioCaptureConfigured = true;
  const allowedOrigin = `http://127.0.0.1:${port}`;

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      let requestOrigin = '';
      try { requestOrigin = new URL(String(request && request.securityOrigin || '')).origin; } catch (_) {}
      if (!request || requestOrigin !== allowedOrigin || !request.audioRequested) {
        callback({});
        return;
      }
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false,
      });
      if (!sources || !sources.length) {
        callback({});
        return;
      }
      const primaryId = String(screen.getPrimaryDisplay().id);
      const videoSource = sources.find((item) => String(item.display_id || '') === primaryId) || sources[0];
      // Electron's loopback stream captures the Windows output mix. The
      // renderer immediately stops the tiny video track and only analyses the
      // audio track; nothing is recorded or sent over the network.
      callback({ video: videoSource, audio: 'loopback' });
    } catch (error) {
      console.warn('[RealtimeAudio] display-media grant failed:', error && error.message ? error.message : error);
      callback({});
    }
  }, { useSystemPicker: false });
}

function sendWindowState(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('desktop-window-state', getWindowState(win));
}

function sendGlobalHotkeyAction(action) {
  if (!mainWindow || mainWindow.isDestroyed() || !action) return;
  mainWindow.webContents.send('mineradio-global-hotkey', { action });
}

function unregisterMineradioGlobalHotkeys() {
  for (const accelerator of registeredGlobalHotkeys.keys()) {
    try { globalShortcut.unregister(accelerator); } catch (e) {}
  }
  registeredGlobalHotkeys.clear();
}

function configureMineradioGlobalHotkeys(bindings = []) {
  unregisterMineradioGlobalHotkeys();
  const results = [];
  const seen = new Set();
  for (const item of Array.isArray(bindings) ? bindings : []) {
    const action = item && String(item.action || '').trim();
    const accelerator = item && String(item.accelerator || '').trim();
    if (!action || !accelerator || seen.has(accelerator)) continue;
    seen.add(accelerator);
    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, () => sendGlobalHotkeyAction(action));
    } catch (error) {
      registered = false;
    }
    if (registered) {
      registeredGlobalHotkeys.set(accelerator, action);
      results.push({ action, accelerator, ok: true });
    } else {
      results.push({
        action,
        accelerator,
        ok: false,
        conflict: {
          sourceName: 'Hệ thống / Ứng dụng khác',
          sourceIcon: 'warning',
          reason: 'Tổ hợp phím đã được sử dụng hoặc được Windows dành riêng',
        },
      });
    }
  }
  return { ok: true, results };
}

function scheduleWindowStateSend(win, delay = 80) {
  if (!win || win.isDestroyed()) return;
  if (mainWindowStateTimer) clearTimeout(mainWindowStateTimer);
  mainWindowStateTimer = setTimeout(() => {
    mainWindowStateTimer = null;
    sendWindowState(win);
  }, delay);
}

function rectsOverlapOnY(a, b) {
  if (!a || !b) return false;
  const aTop = Number(a.y) || 0;
  const bTop = Number(b.y) || 0;
  const aBottom = aTop + (Number(a.height) || 0);
  const bBottom = bTop + (Number(b.height) || 0);
  return aBottom > bTop && bBottom > aTop;
}

function getDisplayState(win) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : primary;
  const bounds = display && display.bounds ? display.bounds : primary.bounds;
  const displayId = display && display.id;
  const primaryId = primary && primary.id;
  const edgeTolerance = 2;
  const hasDisplayOnLeft = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((candidate.bounds.x + candidate.bounds.width) - bounds.x) <= edgeTolerance;
  });
  const hasDisplayOnRight = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((bounds.x + bounds.width) - candidate.bounds.x) <= edgeTolerance;
  });
  return {
    displayId,
    primaryDisplayId: primaryId,
    isPrimaryDisplay: !!(display && primary && display.id === primary.id),
    hasDisplayOnLeft,
    hasDisplayOnRight,
    displayBounds: bounds ? {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    } : null,
  };
}

function getWindowState(win) {
  if (!win || win.isDestroyed()) return {
    isMaximized: false,
    isNativeFullScreen: false,
    isHtmlFullScreen: false,
    isWindowFullScreen: false,
    isFullScreen: false,
    isMinimized: false,
    isVisible: false,
    isFocused: false,
    isPrimaryDisplay: true,
    hasDisplayOnLeft: false,
    hasDisplayOnRight: false,
    displayBounds: null,
  };
  return {
    isMaximized: win.isMaximized(),
    isNativeFullScreen: win.isFullScreen(),
    isHtmlFullScreen: htmlFullscreenActive,
    isWindowFullScreen: windowFullscreenActive,
    isFullScreen: win.isFullScreen() || htmlFullscreenActive || windowFullscreenActive,
    isMinimized: win.isMinimized(),
    isVisible: win.isVisible(),
    isFocused: win.isFocused(),
    ...getDisplayState(win),
  };
}

function getSenderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  sendWindowState(mainWindow);
  return true;
}

function getUpdateDownloadDir() {
  return path.join(app.getPath('userData'), 'updates');
}

function shouldEnsureDesktopShortcut() {
  if (process.platform !== 'win32') return false;
  if (process.env.MINERADIO_NO_DESKTOP_SHORTCUT === '1') return false;
  return app.isPackaged || process.env.MINERADIO_CREATE_DESKTOP_SHORTCUT === '1';
}

function ensureDesktopShortcut() {
  if (!shouldEnsureDesktopShortcut()) return { ok: false, skipped: true };
  try {
    const shortcutPath = path.join(app.getPath('desktop'), `${APP_NAME}.lnk`);
    const target = process.execPath;
    const shortcut = {
      target,
      cwd: path.dirname(target),
      args: '',
      description: 'ShinaYuu Music desktop player',
      icon: fs.existsSync(APP_ICON_ICO) ? APP_ICON_ICO : target,
      iconIndex: 0,
      appUserModelId: APP_USER_MODEL_ID,
    };

    if (fs.existsSync(shortcutPath) && shell.readShortcutLink) {
      try {
        const existing = shell.readShortcutLink(shortcutPath);
        if (existing && path.resolve(existing.target || '') === path.resolve(target) && String(existing.args || '') === '') {
          return { ok: true, path: shortcutPath, existing: true };
        }
      } catch (_) {}
      shell.writeShortcutLink(shortcutPath, 'replace', shortcut);
    } else {
      shell.writeShortcutLink(shortcutPath, 'create', shortcut);
    }
    return { ok: true, path: shortcutPath, created: true };
  } catch (e) {
    console.warn('Desktop shortcut creation skipped:', e.message);
    return { ok: false, error: e.message || 'DESKTOP_SHORTCUT_FAILED' };
  }
}

function parseCookieHeader(cookieText) {
  const out = {};
  String(cookieText || '').split(';').forEach((part) => {
    const raw = String(part || '').trim();
    if (!raw) return;
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    out[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  });
  return out;
}

function qqCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const rawUin = Number(obj.login_type) === 2
    ? (obj.wxuin || obj.uin || obj.p_uin || '')
    : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || '');
  const uin = String(rawUin).replace(/\D/g, '');
  const musicKey = obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.p_skey || obj.skey ||
    obj.psrf_qqaccess_token || obj.psrf_qqrefresh_token || obj.wxrefresh_token || obj.wxskey || '';
  return !!(uin && musicKey);
}

function qqCookieHasPlaybackLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const rawUin = Number(obj.login_type) === 2
    ? (obj.wxuin || obj.uin || obj.p_uin || '')
    : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || '');
  const uin = String(rawUin).replace(/\D/g, '');
  const playbackKey = obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || '';
  return !!(uin && playbackKey);
}

function neteaseCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  return !!obj.MUSIC_U;
}

function isQQCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'qq.com' || normalized.endsWith('.qq.com') || normalized.endsWith('qqmusic.qq.com');
}

function isNeteaseCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === '163.com' || normalized.endsWith('.163.com') ||
    normalized === 'music.163.com' || normalized.endsWith('.music.163.com') ||
    normalized === 'netease.com' || normalized.endsWith('.netease.com');
}

function isYouTubeCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'youtube.com' || normalized.endsWith('.youtube.com');
}

function youtubeCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const apiSecret = obj.SAPISID || obj.__Secure_1PAPISID || obj.__Secure_3PAPISID || obj['__Secure-1PAPISID'] || obj['__Secure-3PAPISID'];
  const sessionId = obj.SID || obj['__Secure-1PSID'] || obj['__Secure-3PSID'];
  return !!(apiSecret && sessionId);
}

function buildCookieHeaderFor(cookies, isAllowedDomain, priority) {
  const picked = new Map();
  (cookies || []).forEach((cookie) => {
    if (!cookie || !cookie.name || !isAllowedDomain(cookie.domain)) return;
    picked.set(cookie.name, cookie.value || '');
  });

  const ordered = [];
  (priority || []).forEach((name) => {
    if (picked.has(name)) {
      ordered.push([name, picked.get(name)]);
      picked.delete(name);
    }
  });
  picked.forEach((value, name) => ordered.push([name, value]));

  return ordered
    .filter(([name, value]) => name && value != null && String(value) !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function buildCookieHeader(cookies) {
  return buildCookieHeaderFor(cookies, isQQCookieDomain, QQ_LOGIN_COOKIE_PRIORITY);
}

async function readQQLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeader(cookies);
}

async function readNeteaseLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeaderFor(cookies, isNeteaseCookieDomain, NETEASE_LOGIN_COOKIE_PRIORITY);
}

async function readYouTubeLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeaderFor(cookies, isYouTubeCookieDomain, YOUTUBE_LOGIN_COOKIE_PRIORITY);
}


function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function localMusicApi(pathname, options) {
  const port = mainServerPort || process.env.PORT || 3000;
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || data.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function ensureLocalLibrary() {
  if (!localLibrary) {
    localLibrary = getLocalLibrary();
    localLibrary.on('changed', (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('shinayuu-local-music-changed', state || {});
      }
    });
  }
  return localLibrary;
}

async function openSpotifyLogin(owner) {
  try {
    // Start OAuth immediately. Do not call /me or refresh an old token before
    // opening Spotify, because that made the cursor wait and could inherit an
    // existing HTTP 429 cooldown.
    const start = await localMusicApi('/api/spotify/login/start');
    if (!start || !start.authUrl || !start.state) {
      return { ok: false, error: 'SPOTIFY_LOGIN_URL_MISSING' };
    }
    await shell.openExternal(start.authUrl);

    // Return immediately after opening Spotify. The renderer polls only the
    // local transaction endpoint, so the UI remains responsive and no /me
    // request is generated by the waiting loop.
    return {
      ok: true,
      provider: 'spotify',
      pending: true,
      state: start.state,
      redirectUri: start.redirectUri,
    };
  } catch (error) {
    return { ok: false, error: error.message || 'SPOTIFY_LOGIN_FAILED' };
  }
}

async function openYouTubeLogin(owner) {
  try {
    const start = await localMusicApi('/api/youtube/login/start?mode=official&t=' + Date.now());
    if (!start || !start.authUrl || !start.state) {
      return { ok: false, error: 'YOUTUBE_OAUTH_URL_MISSING' };
    }
    await shell.openExternal(start.authUrl);
    return {
      ok: true,
      provider: 'youtube',
      pending: true,
      loginMode: 'official',
      state: start.state,
      redirectUri: start.redirectUri,
      authUrl: start.authUrl,
    };
  } catch (error) {
    const message = error && error.message || 'YOUTUBE_LOGIN_FAILED';
    if (message === 'YOUTUBE_CLIENT_ID_REQUIRED' && owner && !owner.isDestroyed()) {
      dialog.showMessageBox(owner, {
        type: 'info',
        title: 'Thiếu Google OAuth Client ID',
        message: 'Google không cho phép đăng nhập tài khoản trong cửa sổ nhúng của Electron.',
        detail: 'Hãy cấu hình OAuth Client ID loại Desktop app trong phần YouTube nâng cao. Sau đó ShinaYuu Music sẽ mở trình duyệt mặc định và tự nhận kết quả qua localhost.',
        buttons: ['Đã hiểu'],
        defaultId: 0,
        noLink: true,
      }).catch(() => {});
    }
    return {
      ok: false,
      error: message,
      needsClientId: message === 'YOUTUBE_CLIENT_ID_REQUIRED',
      loginMode: 'official',
    };
  }
}

async function chooseLocalMusicSources(owner) {
  const choice = await dialog.showMessageBox(owner, {
    type: 'question',
    title: 'Add local music',
    message: 'Choose a local music source',
    detail: 'You can add a folder that is watched automatically, or a ZIP/RAR/7Z archive.',
    buttons: ['Music folder', 'ZIP / RAR / 7Z archive', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (choice.response === 2) return { ok: false, canceled: true };
  const folderMode = choice.response === 0;
  const result = await dialog.showOpenDialog(owner, {
    title: folderMode ? 'Choose a music folder' : 'Choose music archives',
    properties: folderMode ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
    filters: folderMode ? [] : [{ name: 'Music archives', extensions: ['zip', 'rar', '7z'] }],
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) return { ok: false, canceled: true };
  return ensureLocalLibrary().addPaths(result.filePaths);
}

async function openNeteaseMusicLoginWindow(owner) {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION);
  const initialCookie = await readNeteaseLoginCookieHeader(cookieSession);
  if (neteaseCookieHasLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true };

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;

    const loginWindow = new BrowserWindow({
      width: 940,
      height: 760,
      minWidth: 780,
      minHeight: 580,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: 'Đăng nhập dịch vụ âm nhạc',
      backgroundColor: '#111111',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: NETEASE_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      resolve(result);
    };

    const checkCookies = async () => {
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession);
        if (neteaseCookieHasLogin(cookie)) {
          finish({ ok: true, cookie });
        }
      } catch (e) {
        console.warn('Netease login cookie check failed:', e.message);
      }
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\/([^/]+\.)?(163|music\.163|netease)\.com/i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('Netease login popup navigation failed:', e.message));
      } else if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies();
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const docs = [document];
          document.querySelectorAll('iframe').forEach((frame) => {
            try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch (_) {}
          });
          for (const doc of docs) {
            const nodes = Array.from(doc.querySelectorAll('a, button, span, div'));
            const loginNode = nodes.find((node) => {
              const text = (node.textContent || '').trim();
              if (!/登录|立即登录/.test(text)) return false;
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
            if (loginNode) { loginNode.click(); return true; }
          }
          return false;
        }, 900);
      `, true).catch(() => {});
    });

    loginWindow.on('ready-to-show', () => loginWindow.show());
    loginWindow.on('closed', async () => {
      if (settled) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession);
        resolve(neteaseCookieHasLogin(cookie)
          ? { ok: true, cookie, partial: !qqCookieHasPlaybackLogin(cookie) }
          : { ok: false, cancelled: true, message: 'Cửa sổ đăng nhập đã đóng' });
      } catch (e) {
        resolve({ ok: false, error: e.message || 'Cửa sổ đăng nhập đã đóng' });
      }
    });

    pollTimer = setInterval(checkCookies, 1200);
    loginWindow.loadURL(NETEASE_LOGIN_URL).catch((e) => finish({ ok: false, error: e.message }));
  });
}

async function openQQMusicLoginWindow(owner) {
  const cookieSession = session.fromPartition(QQ_LOGIN_PARTITION);
  const initialCookie = await readQQLoginCookieHeader(cookieSession);
  if (qqCookieHasPlaybackLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true };

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;
    let warmupStarted = false;

    const loginWindow = new BrowserWindow({
      width: 900,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: 'Kết nối nguồn YouTube',
      backgroundColor: '#111111',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: QQ_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      resolve(result);
    };

    const checkCookies = async () => {
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession);
        if (qqCookieHasPlaybackLogin(cookie)) {
          finish({ ok: true, cookie });
        } else if (qqCookieHasLogin(cookie) && !warmupStarted) {
          warmupStarted = true;
          setTimeout(() => {
            if (!settled && loginWindow && !loginWindow.isDestroyed()) {
              loginWindow.loadURL('https://y.qq.com/n/ryqq/player').catch((e) => console.warn('QQ login warmup navigation failed:', e.message));
            }
          }, 900);
        }
      } catch (e) {
        console.warn('QQ login cookie check failed:', e.message);
      }
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('QQ login popup navigation failed:', e.message));
      } else {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies();
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const nodes = Array.from(document.querySelectorAll('a, button, span, div'));
          const loginNode = nodes.find((node) => {
            const text = (node.textContent || '').trim();
            if (!/登录|登陆/.test(text)) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (loginNode) loginNode.click();
        }, 700);
      `, true).catch(() => {});
    });

    loginWindow.on('ready-to-show', () => loginWindow.show());
    loginWindow.on('closed', async () => {
      if (settled) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession);
        resolve(qqCookieHasLogin(cookie)
          ? { ok: true, cookie }
          : { ok: false, cancelled: true, message: 'Cửa sổ kết nối đã đóng' });
      } catch (e) {
        resolve({ ok: false, error: e.message || 'Cửa sổ kết nối đã đóng' });
      }
    });

    pollTimer = setInterval(checkCookies, 1200);
    loginWindow.loadURL(QQ_LOGIN_URL).catch((e) => finish({ ok: false, error: e.message }));
  });
}

async function clearQQMusicLoginSession() {
  const cookieSession = session.fromPartition(QQ_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}

async function clearYouTubeLoginSession() {
  const cookieSession = session.fromPartition(YOUTUBE_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
  });
  if (musicProvidersBridge && typeof musicProvidersBridge.invalidateYouTubeAccountSession === 'function') {
    musicProvidersBridge.invalidateYouTubeAccountSession();
  }
  return { ok: true };
}

async function clearNeteaseMusicLoginSession() {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}

function getWindowedBounds(win) {
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  const basis = display.bounds || area;
  const maxWidth = Math.max(640, area.width - WINDOWED_MARGIN);
  const maxHeight = Math.max(360, area.height - WINDOWED_MARGIN);

  let width = Math.round(basis.width * WINDOWED_SCALE);
  let height = Math.round(width / WINDOWED_ASPECT);
  const scaledHeight = Math.round(basis.height * WINDOWED_SCALE);

  if (height > scaledHeight) {
    height = scaledHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  if (width < MIN_WINDOWED_WIDTH && maxWidth >= MIN_WINDOWED_WIDTH && maxHeight >= MIN_WINDOWED_HEIGHT) {
    width = MIN_WINDOWED_WIDTH;
    height = MIN_WINDOWED_HEIGHT;
  }

  if (width > maxWidth) {
    width = maxWidth;
    height = Math.round(width / WINDOWED_ASPECT);
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  width = Math.round(width);
  height = Math.round(height);

  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function applyWindowedBounds(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize();
  win.setMinimumSize(MIN_WINDOWED_WIDTH, MIN_WINDOWED_HEIGHT);
  win.setBounds(getWindowedBounds(win), false);
  sendWindowState(win);
}

function exitFullscreenToWindow(win) {
  if (!win || win.isDestroyed()) return;
  windowFullscreenActive = false;

  if (!win.isFullScreen()) {
    applyWindowedBounds(win);
    return;
  }

  let applied = false;
  const applyOnce = () => {
    if (applied || !win || win.isDestroyed() || win.isFullScreen()) return;
    applied = true;
    applyWindowedBounds(win);
  };

  win.once('leave-full-screen', () => setTimeout(applyOnce, 50));
  win.setFullScreen(false);
  setTimeout(applyOnce, 500);
}

function toggleFullscreen(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen() || windowFullscreenActive) {
    exitFullscreenToWindow(win);
    return;
  }
  windowFullscreenActive = true;
  win.setFullScreen(true);
  sendWindowState(win);
}

function overlayUrl(page) {
  const port = mainServerPort || process.env.PORT || 3000;
  return `http://127.0.0.1:${port}/${page}`;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function desktopLyricsDefaultBounds(payload = desktopLyricsState) {
  const display = desktopLyricsUserBounds
    ? screen.getDisplayMatching(desktopLyricsUserBounds)
    : screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const yRatio = clampNumber(payload.y, 0.08, 0.92, 0.76);
  const width = Math.round(Math.min(Math.max(880, bounds.width * 0.72), bounds.width - 96));
  const height = Math.round(Math.min(Math.max(340, bounds.height * 0.38), 560, bounds.height - 96));
  return {
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.round(bounds.y + bounds.height * yRatio - height / 2),
    width,
    height,
  };
}

function constrainDesktopLyricsBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const area = display.bounds;
  const next = {
    ...bounds,
    width: Math.round(Math.min(Math.max(320, bounds.width), area.width)),
    height: Math.round(Math.min(Math.max(180, bounds.height), area.height)),
  };
  const maxX = area.x + Math.max(0, area.width - next.width);
  const maxY = area.y + Math.max(0, area.height - next.height);
  next.x = Math.round(clampNumber(next.x, area.x, maxX, area.x));
  next.y = Math.round(clampNumber(next.y, area.y, maxY, area.y));
  return next;
}

function setDesktopLyricsBounds(bounds) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const nextBounds = constrainDesktopLyricsBounds(bounds);
  const currentBounds = desktopLyricsWindow.getBounds();
  if (
    currentBounds.x === nextBounds.x
    && currentBounds.y === nextBounds.y
    && currentBounds.width === nextBounds.width
    && currentBounds.height === nextBounds.height
  ) {
    return;
  }
  desktopLyricsProgrammaticMove = true;
  desktopLyricsWindow.setBounds(nextBounds, false);
  setTimeout(() => {
    desktopLyricsProgrammaticMove = false;
  }, 120);
}

function rememberDesktopLyricsBounds() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed() || desktopLyricsProgrammaticMove) return;
  desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
}

function applyDesktopLyricsMouseBehavior() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const locked = desktopLyricsState.clickThrough !== false;
  const shouldIgnore = locked || !desktopLyricsPointerCapture;
  if (desktopLyricsMouseIgnored === shouldIgnore) return;
  desktopLyricsMouseIgnored = shouldIgnore;
  desktopLyricsWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
}

function desktopLyricsHotBoundsOnScreen() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return null;
  const winBounds = desktopLyricsWindow.getBounds();
  const rel = desktopLyricsHotBounds;
  if (!rel) return winBounds;
  return {
    x: winBounds.x + rel.left,
    y: winBounds.y + rel.top,
    width: Math.max(1, rel.right - rel.left),
    height: Math.max(1, rel.bottom - rel.top),
  };
}

function pointInBounds(point, bounds) {
  if (!point || !bounds) return false;
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

function handleDesktopLyricsGlobalMiddleClick() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  if (!desktopLyricsState.enabled) return;
  const now = Date.now();
  if (now - desktopLyricsLastMiddleAt < 260) return;
  const point = screen.getCursorScreenPoint();
  if (!pointInBounds(point, desktopLyricsHotBoundsOnScreen())) return;
  desktopLyricsLastMiddleAt = now;
  const nextLocked = desktopLyricsState.clickThrough === false;
  desktopLyricsState = { ...desktopLyricsState, clickThrough: nextLocked };
  desktopLyricsPointerCapture = !nextLocked;
  applyDesktopLyricsMouseBehavior();
  broadcastDesktopLyricsLockState();
}

function startDesktopLyricsMousePoller() {
  if (process.platform !== 'win32' || desktopLyricsMousePoller) return;
  const script = `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MineradioMousePoll {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
$prev = $false
while ($true) {
  $down = (([MineradioMousePoll]::GetAsyncKeyState(4) -band 0x8000) -ne 0)
  if ($down -and -not $prev) {
    [Console]::Out.WriteLine("MMB")
    [Console]::Out.Flush()
  }
  $prev = $down
  Start-Sleep -Milliseconds 24
}
`;
  try {
    desktopLyricsMousePoller = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    desktopLyricsMousePoller.stdout.on('data', (chunk) => {
      desktopLyricsMousePollerBuffer += chunk.toString('utf8');
      const lines = desktopLyricsMousePollerBuffer.split(/\r?\n/);
      desktopLyricsMousePollerBuffer = lines.pop() || '';
      lines.forEach((line) => {
        if (line.trim() === 'MMB') handleDesktopLyricsGlobalMiddleClick();
      });
    });
    desktopLyricsMousePoller.on('exit', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
    desktopLyricsMousePoller.on('error', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
  } catch (e) {
    desktopLyricsMousePoller = null;
    desktopLyricsMousePollerBuffer = '';
  }
}

function stopDesktopLyricsMousePoller() {
  if (!desktopLyricsMousePoller) return;
  try {
    desktopLyricsMousePoller.kill();
  } catch (e) {}
  desktopLyricsMousePoller = null;
  desktopLyricsMousePollerBuffer = '';
}

function broadcastDesktopLyricsLockState() {
  const locked = desktopLyricsState.clickThrough !== false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mineradio-desktop-lyrics-lock-state', { locked });
  }
  sendDesktopLyricsState();
}

function broadcastDesktopLyricsEnabledState(enabled) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mineradio-desktop-lyrics-enabled-state', { enabled: !!enabled });
  }
}

function positionDesktopLyricsWindow(payload = desktopLyricsState, options = {}) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const shouldUseManualBounds = desktopLyricsUserBounds && !options.force;
  setDesktopLyricsBounds(shouldUseManualBounds ? desktopLyricsUserBounds : desktopLyricsDefaultBounds(payload));
  if (typeof desktopLyricsWindow.setOpacity === 'function') {
    desktopLyricsWindow.setOpacity(clampNumber(payload.opacity, 0.28, 1, 0.92));
  }
}

function sendDesktopLyricsState() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  desktopLyricsWindow.webContents.send('mineradio-desktop-lyrics-state', desktopLyricsState);
}

function createDesktopLyricsWindow(payload = {}) {
  const previousY = desktopLyricsState.y;
  const previousOpacity = desktopLyricsState.opacity;
  desktopLyricsState = { ...desktopLyricsState, ...payload, enabled: true };
  const hasY = Object.prototype.hasOwnProperty.call(payload || {}, 'y');
  const nextY = clampNumber(desktopLyricsState.y, 0.08, 0.92, 0.76);
  const yChanged = hasY && Number.isFinite(Number(previousY)) && Math.abs(nextY - clampNumber(previousY, 0.08, 0.92, 0.76)) > 0.001;
  const opacityChanged = Object.prototype.hasOwnProperty.call(payload || {}, 'opacity')
    && Math.abs(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92) - clampNumber(previousOpacity, 0.28, 1, 0.92)) > 0.001;
  if (yChanged) desktopLyricsUserBounds = null;
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    if (yChanged) {
      positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged });
    } else if (opacityChanged && typeof desktopLyricsWindow.setOpacity === 'function') {
      desktopLyricsWindow.setOpacity(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92));
    }
    applyDesktopLyricsMouseBehavior();
    sendDesktopLyricsState();
    return desktopLyricsWindow;
  }

  desktopLyricsWindow = new BrowserWindow({
    width: 920,
    height: 190,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'ShinaYuu Music Desktop Lyrics',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  try {
    desktopLyricsWindow.setAlwaysOnTop(true, 'screen-saver');
    desktopLyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) {
    console.warn('Desktop lyrics topmost setup skipped:', e.message);
  }
  startDesktopLyricsMousePoller();
  applyDesktopLyricsMouseBehavior();
  positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged || !desktopLyricsUserBounds });
  desktopLyricsWindow.once('ready-to-show', () => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
    desktopLyricsWindow.showInactive();
    sendDesktopLyricsState();
  });
  desktopLyricsWindow.webContents.once('did-finish-load', sendDesktopLyricsState);
  desktopLyricsWindow.on('closed', () => {
    desktopLyricsWindow = null;
    desktopLyricsMouseIgnored = null;
  });
  desktopLyricsWindow.on('moved', rememberDesktopLyricsBounds);
  desktopLyricsWindow.loadURL(overlayUrl('desktop-lyrics.html')).catch((e) => console.warn('Desktop lyrics load failed:', e.message));
  return desktopLyricsWindow;
}

function closeDesktopLyricsWindow() {
  desktopLyricsState = { ...desktopLyricsState, enabled: false };
  desktopLyricsPointerCapture = false;
  desktopLyricsMouseIgnored = null;
  desktopLyricsHotBounds = null;
  stopDesktopLyricsMousePoller();
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    sendDesktopLyricsState();
    desktopLyricsWindow.close();
  }
  desktopLyricsWindow = null;
  broadcastDesktopLyricsEnabledState(false);
}

function nativeWindowHandleDecimal(win) {
  const handle = win.getNativeWindowHandle();
  if (process.arch === 'x64') return handle.readBigUInt64LE(0).toString();
  return String(handle.readUInt32LE(0));
}

function attachWallpaperToWorkerW(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const hwnd = nativeWindowHandleDecimal(win);
  const script = `
$ErrorActionPreference = "Stop"
if (-not ("MineradioNativeWin" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MineradioNativeWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
}
"@
}
$progman = [MineradioNativeWin]::FindWindow("Progman", $null)
$result = [IntPtr]::Zero
[MineradioNativeWin]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$result) | Out-Null
$script:workerw = [IntPtr]::Zero
$enum = [MineradioNativeWin+EnumWindowsProc]{
  param([IntPtr]$top, [IntPtr]$param)
  $shell = [MineradioNativeWin]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
  if ($shell -ne [IntPtr]::Zero) {
    $script:workerw = [MineradioNativeWin]::FindWindowEx([IntPtr]::Zero, $top, "WorkerW", $null)
  }
  return $true
}
[MineradioNativeWin]::EnumWindows($enum, [IntPtr]::Zero) | Out-Null
if ($script:workerw -eq [IntPtr]::Zero) { $script:workerw = $progman }
$target = [IntPtr]::new([Int64]${hwnd})
[MineradioNativeWin]::SetParent($target, $script:workerw) | Out-Null
[MineradioNativeWin]::SetWindowPos($target, [IntPtr]::Zero, 0, 0, 0, 0, 0x0013) | Out-Null
`;
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    timeout: 5000,
  }, (error) => {
    if (error) console.warn('Wallpaper WorkerW attach failed:', error.message);
  });
}

function positionWallpaperWindow() {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
  const bounds = screen.getPrimaryDisplay().bounds;
  wallpaperWindow.setBounds(bounds, false);
}

function sendWallpaperState() {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
  wallpaperWindow.webContents.send('mineradio-wallpaper-state', wallpaperState);
}

function createWallpaperWindow(payload = {}) {
  wallpaperState = { ...wallpaperState, ...payload, enabled: true };
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    positionWallpaperWindow();
    sendWallpaperState();
    return wallpaperWindow;
  }
  const bounds = screen.getPrimaryDisplay().bounds;
  wallpaperWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: false,
    backgroundColor: '#050608',
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'ShinaYuu Music Wallpaper',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  wallpaperWindow.setIgnoreMouseEvents(true, { forward: true });
  wallpaperWindow.once('ready-to-show', () => {
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
    positionWallpaperWindow();
    wallpaperWindow.showInactive();
    attachWallpaperToWorkerW(wallpaperWindow);
    sendWallpaperState();
  });
  wallpaperWindow.webContents.once('did-finish-load', sendWallpaperState);
  wallpaperWindow.on('closed', () => {
    wallpaperWindow = null;
  });
  wallpaperWindow.loadURL(overlayUrl('wallpaper.html')).catch((e) => console.warn('Wallpaper load failed:', e.message));
  return wallpaperWindow;
}

function closeWallpaperWindow() {
  wallpaperState = { ...wallpaperState, enabled: false };
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    sendWallpaperState();
    wallpaperWindow.close();
  }
  wallpaperWindow = null;
}

function closeOverlayWindows() {
  closeDesktopLyricsWindow();
  closeWallpaperWindow();
}

ipcMain.handle('desktop-window-minimize', (event) => {
  getSenderWindow(event)?.minimize();
});

ipcMain.handle('desktop-window-toggle-maximize', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

ipcMain.handle('desktop-window-toggle-fullscreen', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

ipcMain.handle('desktop-window-exit-fullscreen-windowed', (event) => {
  exitFullscreenToWindow(getSenderWindow(event));
});

ipcMain.handle('desktop-window-get-state', (event) => {
  return getWindowState(getSenderWindow(event));
});

ipcMain.handle('desktop-window-close', (event) => {
  getSenderWindow(event)?.close();
});

ipcMain.handle('mineradio-hotkeys-configure-global', (_event, bindings) => {
  return configureMineradioGlobalHotkeys(bindings);
});

ipcMain.handle('mineradio-export-json-file', async (event, payload = {}) => {
  try {
    const owner = getSenderWindow(event);
    const defaultName = String(payload.defaultName || 'shinayuu-music-export.json').replace(/[\\/:*?"<>|]+/g, '-');
    const result = await dialog.showSaveDialog(owner, {
      title: 'Xuất dữ liệu ShinaYuu Music / Export archive',
      defaultPath: defaultName.toLowerCase().endsWith('.json') ? defaultName : `${defaultName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const text = typeof payload.text === 'string' ? payload.text : JSON.stringify(payload.data || {}, null, 2);
    fs.writeFileSync(result.filePath, text, 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message || 'EXPORT_FAILED' };
  }
});

ipcMain.handle('mineradio-import-json-file', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: 'Nhập dữ liệu ShinaYuu Music / Import archive',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    const filePath = result.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf8');
    return { ok: true, filePath, text };
  } catch (e) {
    return { ok: false, error: e.message || 'IMPORT_FAILED' };
  }
});

ipcMain.handle('netease-music-open-login', async (event) => {
  return openSpotifyLogin(getSenderWindow(event));
});

ipcMain.handle('netease-music-clear-login', async () => {
  return clearNeteaseMusicLoginSession();
});

ipcMain.handle('qq-music-open-login', async (event) => {
  return openYouTubeLogin(getSenderWindow(event));
});

ipcMain.handle('qq-music-clear-login', async () => {
  try { await localMusicApi('/api/youtube/logout'); } catch (_) {}
  return clearYouTubeLoginSession();
});

ipcMain.handle('shinayuu-background-media-choose-folder', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  try { return await chooseBackgroundMediaFolder(owner); }
  catch (error) { return { ok: false, error: error && error.message || 'BACKGROUND_MEDIA_FOLDER_FAILED' }; }
});

ipcMain.handle('shinayuu-background-media-scan-folder', async (_event, folderPath) => {
  try { return await scanBackgroundMediaFolder(folderPath); }
  catch (error) { return { ok: false, error: error && error.message || 'BACKGROUND_MEDIA_FOLDER_FAILED' }; }
});

ipcMain.handle('shinayuu-local-music-add', async (event) => {
  try { return await chooseLocalMusicSources(getSenderWindow(event)); }
  catch (error) { return { ok: false, error: error.message || 'LOCAL_SOURCE_ADD_FAILED' }; }
});

ipcMain.handle('shinayuu-local-music-state', async () => {
  try { return await ensureLocalLibrary().init(); }
  catch (error) { return { ok: false, error: error.message || 'LOCAL_LIBRARY_FAILED', playlists: [], tracks: [] }; }
});

ipcMain.handle('shinayuu-local-music-refresh', async () => {
  try { await ensureLocalLibrary().init(); return await ensureLocalLibrary().refreshAll(); }
  catch (error) { return { ok: false, error: error.message || 'LOCAL_LIBRARY_REFRESH_FAILED' }; }
});

ipcMain.handle('shinayuu-local-music-remove', async (_event, sourceId) => {
  try { return await ensureLocalLibrary().removeSource(String(sourceId || '')); }
  catch (error) { return { ok: false, error: error.message || 'LOCAL_SOURCE_REMOVE_FAILED' }; }
});

ipcMain.handle('mineradio-open-update-installer', async (_event, filePath) => {
  try {
    const target = path.resolve(String(filePath || ''));
    const updateDir = path.resolve(getUpdateDownloadDir());
    if (!target || !target.startsWith(updateDir + path.sep)) {
      return { ok: false, error: 'INVALID_UPDATE_PATH' };
    }
    if (!fs.existsSync(target)) return { ok: false, error: 'UPDATE_FILE_MISSING' };
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'OPEN_UPDATE_FAILED' };
  }
});

ipcMain.handle('mineradio-restart-app', async () => {
  try {
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'RESTART_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-enabled', async (_event, enabled, payload) => {
  try {
    if (enabled) {
      createDesktopLyricsWindow(payload || {});
      broadcastDesktopLyricsEnabledState(true);
    } else {
      closeDesktopLyricsWindow();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-update', async (_event, payload) => {
  try {
    const nextState = { ...desktopLyricsState, ...(payload || {}) };
    if (nextState.enabled) {
      createDesktopLyricsWindow(payload || {});
    } else if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsState = nextState;
      sendDesktopLyricsState();
    } else {
      desktopLyricsState = nextState;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_UPDATE_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-dragging', async () => {
  return { ok: true };
});

ipcMain.handle('mineradio-desktop-lyrics-set-pointer-capture', async (_event, active) => {
  try {
    desktopLyricsPointerCapture = !!active;
    applyDesktopLyricsMouseBehavior();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_POINTER_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-hot-bounds', async (_event, bounds) => {
  try {
    const left = clampNumber(bounds && bounds.left, -2000, 4000, 0);
    const top = clampNumber(bounds && bounds.top, -2000, 4000, 0);
    const right = clampNumber(bounds && bounds.right, left + 1, 6000, left + 1);
    const bottom = clampNumber(bounds && bounds.bottom, top + 1, 6000, top + 1);
    desktopLyricsHotBounds = { left, top, right, bottom };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_HOT_BOUNDS_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-set-lock-state', async (_event, locked) => {
  try {
    desktopLyricsState = { ...desktopLyricsState, clickThrough: !!locked };
    if (desktopLyricsState.clickThrough !== false) desktopLyricsPointerCapture = false;
    applyDesktopLyricsMouseBehavior();
    broadcastDesktopLyricsLockState();
    return { ok: true, locked: desktopLyricsState.clickThrough !== false };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_LOCK_FAILED' };
  }
});

ipcMain.handle('mineradio-desktop-lyrics-move-by', async (_event, dx, dy) => {
  try {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return { ok: false, error: 'NO_DESKTOP_LYRICS_WINDOW' };
    if (desktopLyricsState.clickThrough !== false) return { ok: false, error: 'DESKTOP_LYRICS_LOCKED' };
    const bounds = desktopLyricsWindow.getBounds();
    const next = {
      ...bounds,
      x: Math.round(bounds.x + clampNumber(dx, -160, 160, 0)),
      y: Math.round(bounds.y + clampNumber(dy, -160, 160, 0)),
    };
    desktopLyricsWindow.setBounds(next, false);
    desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_MOVE_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-set-enabled', async (_event, enabled, payload) => {
  try {
    if (enabled) createWallpaperWindow(payload || {});
    else closeWallpaperWindow();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'WALLPAPER_FAILED' };
  }
});

ipcMain.handle('mineradio-wallpaper-update', async (_event, payload) => {
  try {
    wallpaperState = { ...wallpaperState, ...(payload || {}) };
    if (wallpaperState.enabled) {
      createWallpaperWindow(wallpaperState);
      if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
        positionWallpaperWindow();
        sendWallpaperState();
      }
    } else if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
      sendWallpaperState();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'WALLPAPER_UPDATE_FAILED' };
  }
});


function sendDiscordPresenceState(state) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('discord-presence-state', state || (discordPresence && discordPresence.publicState()) || {});
}

function readBundledDiscordConfig() {
  try {
    const metadata = require(path.join(__dirname, '..', 'package.json'));
    return metadata && metadata.shinayuu && metadata.shinayuu.discord || {};
  } catch (_) {
    return {};
  }
}

function resolveDiscordIntegrationConfigFile() {
  const target = path.join(app.getPath('userData'), 'discord-integration.json');
  if (fs.existsSync(target)) return target;
  const appData = app.getPath('appData');
  const candidates = [
    path.join(appData, 'shinayuu-music', 'discord-integration.json'),
    path.join(appData, 'ShinaYuuMusic', 'discord-integration.json'),
    path.join(appData, 'ShinaYuu Music', 'discord-config.json'),
    path.join(appData, 'Mineradio', 'discord-integration.json'),
    path.join(appData, 'mineradio', 'discord-integration.json'),
    path.join(app.getAppPath(), 'discord-integration.json'),
  ];
  for (const candidate of candidates) {
    if (!candidate || candidate === target || !fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (!/^\d{17,24}$/.test(String(parsed && parsed.applicationId || ''))) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(candidate, target);
      console.log('[DiscordPresence] Migrated configuration from:', candidate);
      break;
    } catch (_) {}
  }
  return target;
}

function ensureDiscordPresenceManager() {
  if (discordPresence) return discordPresence;
  discordPresence = new DiscordPresenceManager({
    configFile: resolveDiscordIntegrationConfigFile(),
    defaultConfig: readBundledDiscordConfig(),
    processId: process.pid,
  });
  discordPresence.on('state', sendDiscordPresenceState);
  discordPresence.connect().catch(() => {});
  return discordPresence;
}

ipcMain.handle('shinayuu-discord-get-state', async () => {
  return ensureDiscordPresenceManager().publicState();
});

ipcMain.handle('shinayuu-discord-configure', async (_event, payload) => {
  return ensureDiscordPresenceManager().configure(payload || {});
});

ipcMain.handle('shinayuu-discord-update-activity', async (_event, payload) => {
  return ensureDiscordPresenceManager().updateActivity(payload || {});
});

ipcMain.handle('shinayuu-discord-reconnect', async () => {
  const manager = ensureDiscordPresenceManager();
  await manager.disconnect({ clear: false, permanent: true });
  return manager.connect();
});

ipcMain.handle('shinayuu-discord-open-portal', async () => {
  await shell.openExternal('https://discord.com/developers/applications');
  return { ok: true };
});


function stopAudioSessionBridge() {
  const child = audioSessionBridgeProcess;
  audioSessionBridgeProcess = null;
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch (_) {}
  if (process.platform === 'win32' && child.pid) {
    try { execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch (_) {}
  }
}

function startAudioSessionBridge(spotifyHostPid = 0) {
  if (process.platform !== 'win32') return false;
  stopAudioSessionBridge();
  const bridgeScript = path.join(__dirname, 'audio-session-bridge.ps1');
  if (!fs.existsSync(bridgeScript)) {
    console.warn('[AudioSessionBridge] Script is missing:', bridgeScript);
    return false;
  }
  const args = [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
    '-ExecutionPolicy', 'Bypass', '-File', bridgeScript,
    '-RootPid', String(process.pid),
    '-SpotifyHostPid', String(Number(spotifyHostPid) || 0),
    '-GroupingGuid', '5b9ce689-71e0-4bda-89df-126e572712fa',
    '-DisplayName', APP_NAME,
    '-IconPath', process.execPath,
  ];
  try {
    audioSessionBridgeProcess = spawn('powershell.exe', args, {
      cwd: app.getAppPath(),
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    audioSessionBridgeProcess.once('error', (error) => {
      console.warn('[AudioSessionBridge] Failed to start:', error.message || error);
      audioSessionBridgeProcess = null;
    });
    audioSessionBridgeProcess.once('exit', () => { audioSessionBridgeProcess = null; });
    return true;
  } catch (error) {
    console.warn('[AudioSessionBridge] Failed to launch:', error.message || error);
    audioSessionBridgeProcess = null;
    return false;
  }
}


async function ensureCastlabsComponents() {
  if (!components || typeof components.whenReady !== 'function') {
    const error = new Error('CASTLABS_COMPONENTS_API_MISSING');
    castlabsComponentState = { ready: false, status: null, error: error.message };
    throw error;
  }

  try {
    console.log('[Castlabs] Preparing Widevine components...');
    const timeout = new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('CASTLABS_COMPONENTS_TIMEOUT')), 60000);
      timer.unref?.();
    });
    await Promise.race([components.whenReady(), timeout]);
    const status = typeof components.status === 'function' ? components.status() : null;
    castlabsComponentState = { ready: true, status, error: '' };
    console.log('[Castlabs] Components ready:', status || 'ready');
    return castlabsComponentState;
  } catch (error) {
    castlabsComponentState = {
      ready: false,
      status: typeof components.status === 'function' ? components.status() : null,
      error: String(error && (error.message || error) || 'CASTLABS_COMPONENTS_FAILED'),
    };
    console.warn('[Castlabs] Widevine component initialization failed:', castlabsComponentState.error);
    return castlabsComponentState;
  }
}

ipcMain.handle('shinayuu-runtime-get-status', async () => {
  if (!castlabsComponentState.ready) await ensureCastlabsComponents();
  return {
    engine: 'castlabs-electron',
    electronVersion: process.versions.electron || '',
    chromeVersion: process.versions.chrome || '',
    widevineReady: !!castlabsComponentState.ready,
    componentStatus: castlabsComponentState.status,
    error: castlabsComponentState.error || '',
  };
});

async function createWindow() {
  htmlFullscreenActive = false;
  windowFullscreenActive = false;
  const port = Number(process.env.SHINAYUU_PORT || 43821);
  await new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', (error) => reject(new Error('ShinaYuu Music cần cổng ' + port + ' cho Spotify OAuth: ' + error.message)));
    tester.once('listening', () => tester.close(resolve));
    tester.listen(port, '127.0.0.1');
  });
  mainServerPort = port;

  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.SHINAYUU_DATA_DIR = app.getPath('userData');
  process.env.SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${port}/api/spotify/callback`;
  process.env.COOKIE_FILE = path.join(app.getPath('userData'), '.cookie');
  process.env.QQ_COOKIE_FILE = path.join(app.getPath('userData'), '.qq-cookie');
  process.env.MUSIC_SOURCE_CONFIG_FILE = path.join(app.getPath('userData'), 'music-sources.json');
  process.env.SPOTIFY_TOKEN_FILE = path.join(app.getPath('userData'), 'spotify-token.json');
  process.env.YOUTUBE_TOKEN_FILE = path.join(app.getPath('userData'), 'youtube-token.json');
  process.env.MINERADIO_UPDATE_DIR = getUpdateDownloadDir();
  try {
    const legacyQQCookie = path.join(__dirname, '..', '.qq-cookie');
    if (fs.existsSync(legacyQQCookie)) {
      if (!fs.existsSync(process.env.QQ_COOKIE_FILE)) {
        fs.copyFileSync(legacyQQCookie, process.env.QQ_COOKIE_FILE);
      }
      fs.unlinkSync(legacyQQCookie);
    }
  } catch (e) {
    console.warn('QQ cookie migration skipped:', e.message);
  }

  localLibrary = ensureLocalLibrary();
  await localLibrary.init().catch((error) => console.warn('[LocalLibrary] startup:', error.message));
  musicProvidersBridge = require(path.join(__dirname, '..', 'music-providers.js'));
  // Google blocks account authorization inside embedded Electron user-agents.
  // Playlist account sync uses the supported system-browser OAuth + loopback flow.
  if (musicProvidersBridge && typeof musicProvidersBridge.setYouTubeCookieProvider === 'function') {
    musicProvidersBridge.setYouTubeCookieProvider(null);
  }
  localServer = require(path.join(__dirname, '..', 'server.js'));
  await waitForServer(localServer);
  configureRealtimeAudioCaptureSession(session.defaultSession, port);
  startAudioSessionBridge(0);
  ensureDiscordPresenceManager();

  const initialBounds = getWindowedBounds();

  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: 960,
    minHeight: 540,
    show: false,
    frame: false,
    fullscreen: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: APP_ICON_ICO,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.once('did-finish-load', () => {
    sendWindowState(mainWindow);
    sendDiscordPresenceState();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'Escape' || input.code === 'Escape') && mainWindow.isFullScreen()) {
      event.preventDefault();
      exitFullscreenToWindow(mainWindow);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    sendWindowState(mainWindow);
  });

  mainWindow.on('maximize', () => sendWindowState(mainWindow));
  mainWindow.on('unmaximize', () => sendWindowState(mainWindow));
  mainWindow.on('minimize', () => sendWindowState(mainWindow));
  mainWindow.on('restore', () => sendWindowState(mainWindow));
  mainWindow.on('show', () => sendWindowState(mainWindow));
  mainWindow.on('hide', () => sendWindowState(mainWindow));
  mainWindow.on('focus', () => sendWindowState(mainWindow));
  mainWindow.on('blur', () => sendWindowState(mainWindow));
  mainWindow.on('move', () => scheduleWindowStateSend(mainWindow));
  mainWindow.on('resize', () => scheduleWindowStateSend(mainWindow));
  mainWindow.on('closed', () => {
    if (mainWindowStateTimer) {
      clearTimeout(mainWindowStateTimer);
      mainWindowStateTimer = null;
    }
    closeOverlayWindows();
    mainWindow = null;
  });
  mainWindow.on('enter-full-screen', () => {
    windowFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-full-screen', () => {
    windowFullscreenActive = false;
    setTimeout(() => applyWindowedBounds(mainWindow), 50);
  });
  mainWindow.on('enter-html-full-screen', () => {
    htmlFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-html-full-screen', () => {
    htmlFullscreenActive = false;
    setTimeout(() => applyWindowedBounds(mainWindow), 50);
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/?runtime=castlabs-electron`);
}

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!focusMainWindow()) {
      app.whenReady().then(() => createWindow()).catch((e) => console.error('Second instance window restore failed:', e));
    }
  });

  app.whenReady().then(async () => {
    loadBackgroundMediaRoots();
    registerBackgroundMediaProtocol();
    screen.on('display-metrics-changed', () => {
      positionDesktopLyricsWindow();
      positionWallpaperWindow();
      scheduleWindowStateSend(mainWindow);
    });
    screen.on('display-added', () => scheduleWindowStateSend(mainWindow));
    screen.on('display-removed', () => scheduleWindowStateSend(mainWindow));
    await ensureCastlabsComponents();
    await createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else focusMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    unregisterMineradioGlobalHotkeys();
    closeOverlayWindows();
    stopAudioSessionBridge();
    if (discordPresence) discordPresence.shutdown().catch(() => {});
    if (localLibrary) localLibrary.close().catch(() => {});
    if (localServer && localServer.close) localServer.close();
  });
}
