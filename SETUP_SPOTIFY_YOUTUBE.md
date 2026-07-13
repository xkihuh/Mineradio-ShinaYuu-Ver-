# Spotify and YouTube Setup

## Run the application

```powershell
npm install
npm start
```

The Electron application starts its local server, main renderer, and hidden WebView2 Spotify host.

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

## YouTube

YouTube audio is resolved through `yt-dlp` and played through the application's HTML audio pipeline. The application can also use YouTube captions, YouTube Music lyrics, LRCLIB, and local forced alignment for lyrics.

## Playback architecture

```text
Spotify -> hidden WebView2 host -> Spotify Web Playback SDK
YouTube -> yt-dlp/youtubei.js -> application audio element
```

Both paths are controlled by the same in-app master volume setting.

## WebView2 Runtime

The Windows installer checks for Microsoft Edge WebView2 Runtime. When it is missing, the installer downloads and silently installs the Evergreen Runtime before the application is launched.

For source development, install WebView2 Runtime manually when the hidden Spotify host cannot start.

## Optional developer overrides

```text
YTDLP_PATH
WHISPER_CPP_PATH
WHISPER_MODEL_PATH
FFMPEG_PATH
WHISPER_THREADS
```

These variables are optional and are not required for normal installed users.
