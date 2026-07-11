'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const player = fs.readFileSync(path.join(root, 'public', 'spotify-direct-player.js'), 'utf8');
const hostRuntime = fs.readFileSync(path.join(root, 'desktop', 'spotify-host-runtime.js'), 'utf8');
const hostHtml = fs.readFileSync(path.join(root, 'public', 'spotify-host.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.equal(pkg.main, 'desktop/main.js');
assert.equal(pkg.scripts.start, 'electron .');
assert.equal(pkg.dependencies['@webviewjs/webview'], '0.4.0');
assert.match(hostRuntime, /@webviewjs\/webview/);
assert.match(hostRuntime, /windowsSkipTaskbar: true/);
assert.match(hostRuntime, /spotify-host\.html/);
assert.match(hostHtml, /new window\.Spotify\.Player/);
assert.match(hostHtml, /player_state_changed/);
assert.match(server, /\/api\/spotify\/host\/status/);
assert.match(server, /\/api\/spotify\/host\/event/);
assert.match(player, /usesRemoteSpotifyHost/);
assert.match(player, /waitForRemoteHostReady/);
assert.match(player, /remoteHostStateToSdkState/);
assert.match(player, /playSpotifyUriExactly/);
assert.match(player, /SPOTIFY_WRONG_TRACK/);
assert.match(player, /ensureSpotifyRealtimeCapture/);
assert.doesNotMatch(player, /position-locked fallback/);
assert.doesNotMatch(player, /fallbackTempo/);
console.log('Spotify direct-player regression tests passed.');
