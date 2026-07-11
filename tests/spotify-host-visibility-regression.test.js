'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const runtimePath = path.join(__dirname, '..', 'desktop', 'spotify-host-runtime.js');
const source = fs.readFileSync(runtimePath, 'utf8');

assert.match(source, /visible:\s*false/, 'Spotify host must be created hidden');
assert.doesNotMatch(source, /visible:\s*true/, 'Spotify host must never be created visible');
assert.match(source, /hostWindow\.hide\(\)/, 'Spotify host must explicitly call hide()');
assert.match(source, /hostWindow\.setVisible\(false\)/, 'Spotify host must explicitly force visibility off');
assert.match(source, /hostWindow\.setSkipTaskbar\(true\)/, 'Spotify host must be hidden from taskbar');
assert.match(source, /hostWindow\.removeTaskbarIcon\(\)/, 'Spotify host must remove any taskbar icon');
assert.match(source, /setInterval\(forceHidden,\s*250\)/, 'Spotify host must guard against runtime re-showing the window');
assert.doesNotMatch(source, /x:\s*-32000/, 'Off-screen positioning must not be used as the hiding mechanism');

console.log('spotify host visibility regression: PASS');
