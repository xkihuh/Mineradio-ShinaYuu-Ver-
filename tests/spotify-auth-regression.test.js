'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shinayuu-auth-test-'));
const configFile = path.join(tmp, 'sources.json');
const tokenFile = path.join(tmp, 'spotify-token.json');
fs.writeFileSync(configFile, JSON.stringify({
  spotifyClientId: '1234567890abcdefghijklmnopqrstuv',
  spotifyMarket: 'VN',
  language: 'vi'
}));
process.env.MUSIC_SOURCE_CONFIG_FILE = configFile;
process.env.SPOTIFY_TOKEN_FILE = tokenFile;
process.env.SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:43821/api/spotify/callback';

let tokenCalls = 0;
let profileCalls = 0;

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const key = String(name || '').toLowerCase();
        return Object.prototype.hasOwnProperty.call(headers, key) ? String(headers[key]) : null;
      }
    },
    async json() { return body; },
    async text() { return JSON.stringify(body); }
  };
}

global.fetch = async (url) => {
  const value = String(url);
  if (value === 'https://accounts.spotify.com/api/token') {
    tokenCalls += 1;
    return response(200, {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'user-read-private user-read-email streaming user-read-playback-state user-modify-playback-state'
    });
  }
  if (value === 'https://api.spotify.com/v1/me') {
    profileCalls += 1;
    if (profileCalls === 1) {
      return response(429, { error: { status: 429, message: 'Too many requests' } }, { 'retry-after': '1' });
    }
    return response(200, {
      id: 'shinayuu-user',
      display_name: 'ShinaYuu',
      country: 'VN',
      product: 'premium',
      email: 'hidden@example.test',
      images: [{ url: 'https://img.test/avatar.png' }]
    });
  }
  throw new Error(`Unexpected request: ${value}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const providers = require('../music-providers');
  const started = providers.beginSpotifyLogin('http://127.0.0.1:43821');
  assert.ok(started.state);
  assert.match(started.authUrl, /code_challenge_method=S256/);

  const callback = await providers.completeSpotifyLogin({ state: started.state, code: 'authorization-code' });
  assert.equal(callback.ok, true);
  assert.equal(callback.complete, false, 'A 429 profile response must leave the transaction pending');
  assert.equal(tokenCalls, 1, 'OAuth code exchange must happen once');
  assert.equal(profileCalls, 1, 'The callback must call /me only once before Retry-After');

  for (let i = 0; i < 25; i += 1) {
    const status = await providers.spotifyLoginStatus('http://127.0.0.1:43821');
    assert.equal(status.authorized, true);
    assert.equal(status.profilePending, true);
  }
  assert.equal(profileCalls, 1, 'Status polling must not hammer /me during the cooldown');

  let result = null;
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    await sleep(120);
    result = await providers.spotifyLoginResult(started.state, 'http://127.0.0.1:43821');
    if (result.complete) break;
  }

  assert.ok(result && result.complete && result.ok, 'The scheduled profile retry must finish the login');
  assert.equal(result.status.loggedIn, true);
  assert.equal(result.status.nickname, 'ShinaYuu');
  assert.equal(result.status.avatar, 'https://img.test/avatar.png');
  assert.equal(result.status.vipLabel, 'Premium');
  assert.equal(profileCalls, 2, 'Exactly one /me retry is allowed after Retry-After');

  for (let i = 0; i < 25; i += 1) {
    const status = await providers.spotifyLoginStatus('http://127.0.0.1:43821');
    assert.equal(status.loggedIn, true);
    assert.equal(status.nickname, 'ShinaYuu');
  }
  assert.equal(profileCalls, 2, 'Cached profile status must not call /me again');

  const stored = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
  assert.equal(stored.profile.id, 'shinayuu-user');
  assert.equal(stored.profile.product, 'premium');
  assert.ok(stored.expiresAt > Date.now());

  console.log('Spotify auth regression tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
});
