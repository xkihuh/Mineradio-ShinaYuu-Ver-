'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const spotify = fs.readFileSync(path.join(root, 'public', 'spotify-direct-player.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');

// YouTube seeks are previewed while dragging and committed exactly once.
assert.match(html, /function commitHtmlAudioSeek\(targetSec\)/);
assert.match(html, /seekFromProgressPointer\(e, true, false\)/);
assert.match(html, /if \(commit\) commitHtmlAudioSeek\(targetSec\)/);
assert.match(html, /seekRecovery: true/);

// YouTube beat sync stays on live PCM and does not use tempo-grid assistance.
assert.match(html, /var strictRealtime = useRealtimeOnlyBeatSync\(\)/);
assert.match(html, /var tempoAssist = !strictRealtime/);
assert.match(html, /var realtimeOnlyTrack/);

// Spotify uses the actual Windows output stream, never a fixed BPM fallback.
assert.match(main, /setDisplayMediaRequestHandler/);
assert.match(main, /audio: 'loopback'/);
assert.match(spotify, /navigator\.mediaDevices\.getDisplayMedia/);
assert.match(spotify, /function processSpotifyRealtimeFrame/);
assert.match(spotify, /Pointer move only previews/);
assert.match(spotify, /confirmSpotifySeek/);
assert.match(spotify, /SPOTIFY_SEEK_NOT_CONFIRMED/);
assert.doesNotMatch(spotify, /fallbackTempo/);
assert.doesNotMatch(spotify, /position-locked fallback/);
assert.doesNotMatch(spotify, /loadSpotifyBeatAnalysis/);

console.log('Realtime playback regression tests passed.');
