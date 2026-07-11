'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.SHINAYUU_SPOTIFY_HOST_PORT || process.env.PORT || 43821);
const APP_DATA_DIR_NAME = 'ShinaYuuMusic';

function verifyWritableDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.write-${process.pid}-${Date.now()}`);
  fs.writeFileSync(probe, 'ok');
  fs.unlinkSync(probe);
  return directory;
}

function resolveDataDirectory() {
  const candidates = [
    process.env.SHINAYUU_WEBVIEW2_DATA_DIR,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, APP_DATA_DIR_NAME, 'SpotifyHost'),
    process.env.APPDATA && path.join(process.env.APPDATA, APP_DATA_DIR_NAME, 'SpotifyHost'),
    path.join(os.tmpdir(), APP_DATA_DIR_NAME, 'SpotifyHost'),
  ].filter(Boolean);
  let lastError = null;
  for (const item of candidates) {
    try { return verifyWritableDirectory(path.resolve(item)); }
    catch (error) { lastError = error; }
  }
  throw lastError || new Error('NO_WRITABLE_WEBVIEW2_DATA_DIRECTORY');
}

const dataDirectory = resolveDataDirectory();
process.env.WEBVIEW2_USER_DATA_FOLDER = dataDirectory;
process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = [
  process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS || '',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
].filter(Boolean).join(' ').trim();

const { Application } = require('@webviewjs/webview');
const app = new Application();
let hostWindow = null;
let hostWebview = null;
let hostContext = null;
let stopping = false;
let hiddenGuard = null;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (hiddenGuard) { try { clearInterval(hiddenGuard); } catch (_) {} hiddenGuard = null; }
  try { if (hostWebview && !hostWebview.isDisposed()) hostWebview.dispose(); } catch (_) {}
  try { if (hostWindow && !hostWindow.isDisposed()) hostWindow.close(); } catch (_) {}
  try { if (hostContext && !hostContext.isDisposed()) hostContext.dispose(); } catch (_) {}
  try { app.exit(); } catch (_) {}
  setTimeout(() => process.exit(code), 60).unref?.();
}

async function launch() {
  await app.whenReady({ interval: 16, ref: true });
  hostContext = app.createWebContext({ dataDirectory, allowsAutomation: false });

  // Keep the protected-media player in a genuinely hidden WebView2 window.
  // IMPORTANT: the window must be born hidden. Creating it visible and moving it
  // off-screen still produces a black native window flash on some Windows builds.
  hostWindow = app.createBrowserWindow({
    title: 'ShinaYuu Music Spotify Host',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    logical: true,
    visible: false,
    focused: false,
    decorations: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    showMenu: false,
    windowsSkipTaskbar: true,
    windowsNoRedirectionBitmap: true,
    windowsClassName: 'ShinaYuuMusicSpotifyHost',
  });

  const forceHidden = () => {
    if (!hostWindow || hostWindow.isDisposed()) return;
    try { hostWindow.setVisible(false); } catch (_) {}
    try { hostWindow.hide(); } catch (_) {}
    try { hostWindow.setSkipTaskbar(true); } catch (_) {}
    try { hostWindow.removeTaskbarIcon(); } catch (_) {}
  };
  forceHidden();

  hostWebview = hostWindow.createWebview({
    url: `http://127.0.0.1:${PORT}/spotify-host.html?runtime=spotify-web-shell`,
    enableDevtools: process.env.SHINAYUU_SPOTIFY_HOST_DEVTOOLS === '1',
    incognito: false,
    webContext: hostContext,
  });

  // Some WebView2/runtime combinations may attempt to reveal the native host
  // after the controller is attached. Re-hide it immediately and keep a small
  // watchdog so the helper can never surface on the desktop or taskbar.
  forceHidden();
  hiddenGuard = setInterval(forceHidden, 250);

  hostWindow.on('close', () => stop(0));
  app.on('application-close-requested', () => stop(0));
  console.log(`[SpotifyHost] Headless WebView2 player started on port ${PORT}`);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
process.on('uncaughtException', (error) => {
  console.error('[SpotifyHost]', error && (error.stack || error));
  stop(1);
});
process.on('unhandledRejection', (error) => {
  console.error('[SpotifyHost]', error && (error.stack || error));
});

launch().catch((error) => {
  console.error('[SpotifyHost]', error && (error.stack || error));
  stop(1);
});
