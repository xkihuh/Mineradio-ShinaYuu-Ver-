'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shinayuu-provider-test-'));
const configFile = path.join(tmp, 'sources.json');
const tokenFile = path.join(tmp, 'spotify-token.json');
fs.writeFileSync(configFile, JSON.stringify({ spotifyClientId: 'test-client', spotifyMarket: 'VN', language: 'vi' }));
fs.writeFileSync(tokenFile, JSON.stringify({
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expiresAt: Date.now() + 3600_000,
  scope: 'streaming user-read-playback-state user-modify-playback-state user-read-private'
}));
process.env.MUSIC_SOURCE_CONFIG_FILE = configFile;
process.env.SPOTIFY_TOKEN_FILE = tokenFile;

const calls = [];
const makeTrack = (id) => ({
  id: String(id),
  uri: `spotify:track:${id}`,
  name: id === 1 ? 'MONTAGEM SOLITARIA' : `Spotify Track ${id}`,
  artists: [{ id: 'artist-1', name: id === 1 ? 'TRXVELER / stxptxllking / RONVXER' : 'Spotify Artist' }],
  album: { id: 'album-1', name: id === 1 ? 'MONTAGEM SOLITARIA' : 'Spotify Album', images: [{ url: 'https://img.test/cover.jpg' }] },
  duration_ms: id === 1 ? 118000 : 180000,
  external_ids: { isrc: id === 1 ? 'TESTISRC001' : `TESTISRC${String(id).padStart(3, '0')}` },
  is_playable: true,
  external_urls: { spotify: `https://open.spotify.com/track/${id}` }
});

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return body; },
  async text() { return JSON.stringify(body); }
});

global.fetch = async (url) => {
  const value = String(url);
  calls.push(value);
  if (value.startsWith('https://api.spotify.com/v1/search?')) {
    const parsed = new URL(value);
    const limit = Number(parsed.searchParams.get('limit'));
    const offset = Number(parsed.searchParams.get('offset'));
    assert.ok(limit <= 10, `Spotify /search limit must be <= 10, got ${limit}`);
    const items = Array.from({ length: limit }, (_, index) => makeTrack(offset + index + 1));
    return jsonResponse(200, {
      tracks: {
        items,
        next: offset + limit < 18 ? `https://api.spotify.com/v1/search?offset=${offset + limit}` : null
      }
    });
  }
  if (value.startsWith('https://api.spotify.com/v1/tracks/')) {
    return jsonResponse(200, makeTrack(1));
  }
  if (value.startsWith('https://lrclib.net/api/get?')) {
    return jsonResponse(404, {});
  }
  if (value.startsWith('https://lrclib.net/api/search?')) {
    return jsonResponse(200, [{
      id: 901,
      trackName: 'MONTAGEM SOLITARIA',
      artistName: 'TRXVELER, stxptxllking, RONVXER',
      albumName: 'MONTAGEM SOLITARIA',
      duration: 118,
      syncedLyrics: '',
      plainLyrics: 'Linha um\nLinha dois\nLinha três',
      instrumental: false
    }]);
  }
  throw new Error(`Unexpected network call: ${value}`);
};

(async () => {
  const providers = require('../music-providers');

  const results = await providers.spotifySearch('montagem solitaria', 18);
  assert.equal(results.length, 18, 'Spotify search should combine paginated results');
  assert.ok(results.every((song) => song.realProvider === 'spotify'));
  assert.ok(results.every((song) => song.playbackTransport === 'spotify'));
  const searchCalls = calls.filter((url) => url.startsWith('https://api.spotify.com/v1/search?'));
  assert.equal(searchCalls.length, 2, '18 results should use two Spotify search pages');
  assert.deepEqual(searchCalls.map((url) => {
    const parsed = new URL(url);
    return { limit: Number(parsed.searchParams.get('limit')), offset: Number(parsed.searchParams.get('offset')) };
  }), [{ limit: 10, offset: 0 }, { limit: 8, offset: 10 }]);

  const lyrics = await providers.lyricsFor('1', 'spotify', {
    track: 'wrong fallback title',
    artist: 'wrong fallback artist',
    duration: 999
  });
  assert.equal(lyrics.metadataProvider, 'spotify');
  assert.equal(lyrics.metadata.track, 'MONTAGEM SOLITARIA');
  assert.equal(lyrics.metadata.isrc, 'TESTISRC001');
  assert.match(lyrics.plainLyric, /Linha um/);
  assert.equal(lyrics.lyric, '');
  assert.ok(!calls.some((url) => /youtube|googlevideo|yt-dlp/i.test(url)), 'Spotify search/lyrics must not call YouTube');

  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /var searchMode = 'song', searchModeUserSelected = false/);
  assert.match(html, /label = key === 'qq' \? 'YouTube' : 'Spotify'/);
  assert.match(html, /class="splash-aurora-name"/);

  const spotifyPlayer = fs.readFileSync(path.join(__dirname, '..', 'public', 'spotify-direct-player.js'), 'utf8');
  assert.match(spotifyPlayer, /Strict in-app playback/);
  assert.doesNotMatch(spotifyPlayer, /openSpotifyExternally|listSpotifyDevices|window\.open\(target/);
  assert.match(spotifyPlayer, /SPOTIFY_IN_APP_RUNTIME_REQUIRED/);

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'electron .');
  assert.equal(pkg.main, 'desktop/main.js');
  assert.match(pkg.scripts['build:win'], /electron-builder --win nsis/);
  assert.equal(pkg.dependencies['@webviewjs/webview'], '0.4.0');

  console.log('Provider regression tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
});
