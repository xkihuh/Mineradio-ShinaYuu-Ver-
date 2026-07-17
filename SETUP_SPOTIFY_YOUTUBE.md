# Spotify and YouTube Setup

## Run the application

```powershell
npm install
npm start
```

The Castlabs Electron application starts its local loopback server and the existing ShinaYuu Music renderer. The Spotify Web Playback SDK runs inside that renderer. No separate WebView2 host is launched.

## Spotify

1. Create an application in the Spotify Developer Dashboard.
2. Add this exact redirect URI:

```text
http://127.0.0.1:43821/api/spotify/callback
```

3. Enter the Spotify Client ID in ShinaYuu Music.
4. Complete the browser authorization flow.
5. Use a Spotify Premium account for direct Web Playback SDK playback.

Required playback scopes include `streaming`, `user-read-playback-state`, and `user-modify-playback-state`.

## Castlabs Electron and Widevine

ShinaYuu Music uses Castlabs Electron for Content Security. On first launch, Castlabs Electron provisions the Widevine CDM through its component updater. The main process waits for `components.whenReady()` before creating the application window.

A network connection is required for first-time Widevine provisioning. If provisioning fails, YouTube and local playback can still start, but Spotify protected playback remains unavailable until the component service succeeds.

## YouTube playback

YouTube audio is resolved through `yt-dlp` and played through the application's HTML audio pipeline. The application can also use YouTube captions, YouTube Music lyrics, LRCLIB, and local forced alignment for lyrics.

## YouTube account and playlist synchronization

YouTube account synchronization is optional. Anonymous YouTube search and playback continue to work without it.

### Maintainer setup

1. Create or select a Google Cloud project.
2. Enable **YouTube Data API v3**.
3. Configure the OAuth consent screen for the intended users.
4. Create an OAuth 2.0 Client ID with application type **Desktop app**.
5. Put the Client ID in `shinayuu.youtube.oauthClientId` inside `package.json`.
6. Put the matching Desktop OAuth Client Secret in `shinayuu.youtube.oauthClientSecret`. The current Google token exchange rejects this client when the secret is omitted.
7. The same values can be entered in the in-app **Advanced** panel while developing.

The loopback callback is created by the running application and normally looks like:

```text
http://127.0.0.1:<runtime-port>/api/youtube/callback
```

Desktop OAuth clients support loopback redirects. The application opens the Google authorization page in the operating system default browser and polls its local callback result.

### End-user sign-in

1. Select **Connect YouTube** in ShinaYuu Music.
2. The default browser opens the Google authorization page.
3. Select the Google/YouTube channel that owns the playlists and approve read-only YouTube access.
4. Return to the app; the connection completes automatically and supported playlists appear under **My Playlists**.

If the consent screen remains in **Testing**, add each intended account as a test user. For broad distribution, publish the OAuth app and complete any Google verification required for the requested scope.

### Playlist coverage

The official YouTube Data API synchronizes playlists **owned by the authorized account**. ShinaYuu Music also adds Liked videos and Uploads when available. YouTube does not expose an official API that lists every playlist merely saved from other channels, so those library-only entries cannot be guaranteed by this login method.


## Local music sources

The desktop app can persistently add watched folders or ZIP/RAR/7Z archives from **My Playlists**. The selected paths are stored under the Windows user-data directory. Archive contents are extracted into the application cache, not into the original archive location.

Supported audio extensions include MP3, FLAC, WAV, OGG, Opus, M4A, AAC, WMA, and WebM. Embedded metadata and artwork are read locally. Place a `.yrc`, `.lrc`, or `.txt` file beside an audio file with the same base name to provide exact local lyrics.

## Playback architecture

```text
Spotify -> Castlabs Electron renderer -> Spotify Web Playback SDK
YouTube -> yt-dlp/youtubei.js -> application audio element
```

Both paths are controlled by the same in-app master volume setting.

## Optional developer overrides

```text
YTDLP_PATH
WHISPER_CPP_PATH
WHISPER_MODEL_PATH
FFMPEG_PATH
WHISPER_THREADS
```

These variables are optional and are not required for normal installed users.
