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

## YouTube

YouTube audio is resolved through `yt-dlp` and played through the application's HTML audio pipeline. The application can also use YouTube captions, YouTube Music lyrics, LRCLIB, and local forced alignment for lyrics.

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
