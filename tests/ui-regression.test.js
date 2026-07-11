'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const main = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');

assert.strictEqual(pkg.version, '1.4.24');
assert.strictEqual(pkg.main, 'desktop/main.js');
assert.strictEqual(pkg.scripts.start, 'electron .');
assert.match(main, /frame: false/);
assert.match(main, /transparent: true/);
assert.match(main, /desktop-window-toggle-fullscreen/);
assert.match(html, /var searchMode = 'song'/);
assert.match(html, /mergeSongSearchResults\(neteaseSongs, qqSongs, 20, q, true\)/);
assert.match(html, /APP_PLAYLIST_STORE_KEY = 'shinayuu-app-playlists-v1'/);
assert.match(html, /userPlaylists\.filter\(isAppManagedPlaylist\)/);
assert.match(html, /orbit\.focus\.radius = 7\.65/);
assert.match(html, /useRealtimeOnlyBeatSync/);
assert.match(html, /verifyFxPanelRuntimeBindings/);
assert.match(html, /id=\"discord-home-card\"/);
assert.match(html, /saveDiscordIntegration/);
assert.match(html, /id="discord-setup-modal"/);
assert.match(html, /openDiscordSetupModal/);
assert.match(html, /shinayuu-discord-config-v1/);
assert.doesNotMatch(html, /discord-home-card\.unconfigured \.discord-setup/);
assert.match(main, /resolveDiscordIntegrationConfigFile/);
assert.match(html, /Đang nghe trên ShinaYuu Music/);
assert.match(html, /id="track-lyric-sync-card"/);
assert.match(html, /refreshCurrentTrackLyricDelayControls/);
console.log('UI regression tests passed.');
