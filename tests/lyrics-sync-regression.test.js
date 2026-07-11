'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const sync = require('../public/lyrics-sync');

assert.equal(sync.parseLrcOffsetSeconds('[offset:500]\n[00:10.00]Line'), 0.5);
assert.equal(sync.parseLrcOffsetSeconds('[offset:-250]'), -0.25);
assert.equal(sync.parseLrcOffsetSeconds('[ar:Artist]'), 0);
assert.equal(sync.compensatedPlaybackSeconds(10, 0.35), 9.65);
assert.equal(sync.compensatedPlaybackSeconds(0.2, 0.35), 0);
assert.equal(sync.compensatedPlaybackSeconds(10, -5), 15);
assert.equal(sync.resolveDelaySeconds(0.35, 0.8), 0.8);
assert.equal(sync.resolveDelaySeconds(0.35, null), 0.35);
assert.equal(sync.normalizeDelaySeconds(12), 5);
assert.equal(sync.durationCompatibility(180, 183).compatible, true);
assert.equal(sync.durationCompatibility(150, 183).compatible, false);
assert.ok(Math.abs(sync.timelineScaleFactor(180, 183) - (183 / 180)) < 1e-9);
assert.equal(sync.timelineScaleFactor(150, 183), 1);
const scaled = sync.scaleLyricTimeline([{ t: 10, duration: 2, words: [{ t: 10, d: 0.5 }] }], 1.02);
assert.equal(scaled[0].t, 10.2);
assert.equal(scaled[0].words[0].d, 0.51);

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
assert.match(html, /id="fx-lyricdelay"/);
assert.match(html, /id="fx-tracklyricdelay"/);
assert.match(html, /SONG_LYRIC_DELAY_STORE_KEY = 'shinayuu-song-lyric-delay-v1'/);
assert.match(html, /function getEffectiveLyricDelay\(/);
assert.match(html, /function adjustCurrentTrackLyricDelay\(/);
assert.match(html, /function resetCurrentTrackLyricDelay\(/);
assert.match(html, /timelineScaleFactor\(r\.match\.duration/);
assert.match(html, /function getLyricPlaybackSeconds\(\)/);
assert.match(html, /parseLrcOffsetSeconds/);
assert.match(html, /var t = getLyricPlaybackSeconds\(\);/);
assert.doesNotMatch(html, /lyricsLines\[i\]\.t <= t \+ 0\.05/);
console.log('Lyrics sync regression tests passed.');
