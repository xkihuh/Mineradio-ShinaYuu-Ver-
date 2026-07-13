# ShinaYuu Music 1.1.3

ShinaYuu Music is a Windows desktop visual music player with Spotify and YouTube playback, synchronized lyrics, Desktop Lyrics, real-time visual effects, Discord Rich Presence, and a unified in-app master volume control.

This project is a modified work based on the original **Mineradio** repository by XxHuberrr. It is distributed under the GNU General Public License version 3 only (`GPL-3.0-only`). See `LICENSE` and `NOTICE.md`.

## Highlights

- Spotify Premium playback through a hidden Microsoft Edge WebView2 host.
- YouTube playback through `yt-dlp` with `youtubei.js` fallback support.
- Spotify-native synchronized lyrics when available.
- YouTube Music lyrics, YouTube captions, LRCLIB fallback, and optional local word alignment.
- Existing 3D lyrics, Desktop Lyrics, glow, blur, slide, scale, particles, and beat-reactive visuals.
- Discord profile card and local Discord Rich Presence IPC.
- Unified master volume for YouTube audio and the Spotify WebView2 player.
- NSIS installer that checks for Microsoft Edge WebView2 Runtime and installs the Evergreen Runtime when it is missing.

## Requirements

- Windows 10 or Windows 11 x64.
- Spotify Premium for direct Spotify playback.
- Internet access for Spotify, YouTube, lyrics providers, and first-time WebView2/forced-alignment provisioning.
- Node.js 24 or later for source development.

## Development

```powershell
npm install
npm start
```

Run the test suite:

```powershell
npm test
```

Build an unpacked Windows application:

```powershell
npm run build:win:dir
```

Build the NSIS installer:

```powershell
npm run build:win
```

Installer output:

```text
dist\ShinaYuu-Music-1.1.3-Setup.exe
```

## Spotify configuration

Create a Spotify application and register this exact redirect URI:

```text
http://127.0.0.1:43821/api/spotify/callback
```

The application uses OAuth PKCE and does not require a client secret in the desktop client.

## Unified master volume

The volume button in the application is the master control for both playback engines:

- YouTube and local audio are controlled through the application audio graph.
- Spotify is controlled directly through `Spotify.Player#setVolume()` inside the hidden WebView2 host.
- The selected volume is stored locally and applied before the next Spotify track starts.

Windows may still display a separate WebView2 audio process in Volume Mixer because WebView2 uses its own process tree. Normal users no longer need to adjust that entry manually; the in-app master volume controls the actual Spotify output.

## YouTube lyrics pipeline

ShinaYuu Music checks the following sources in order:

1. YouTube captions with usable timing.
2. Lyrics from the YouTube Music lyrics tab.
3. LRCLIB synchronized or plain lyrics.
4. Local forced alignment when plain lyrics are available and word timing is missing.

The existing UI, UX, Desktop Lyrics, and visual effects remain unchanged. Only the lyric data adapters and timing sources are extended.

## Documentation

- `SETUP_SPOTIFY_YOUTUBE.md` — provider setup and playback architecture.
- `DISCORD_SETUP.md` — Discord Rich Presence setup.
- `PRIVACY.md` — local data and third-party services.
- `SECURITY.md` — security reporting and credential handling.
- `NOTICE.md` — attribution and third-party notices.
- `CHANGELOG.md` — release history.

## License

ShinaYuu Music is licensed under `GPL-3.0-only`. Redistribution of source or binaries must preserve the license, copyright notices, attribution, and the corresponding source obligations described by GPLv3.
