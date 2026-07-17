# ShinaYuu Music 1.1.5

ShinaYuu Music is a Windows desktop visual music player with Spotify and YouTube playback, synchronized lyrics, Desktop Lyrics, real-time visual effects, Discord Rich Presence, and a unified in-app master volume control.

This project is a modified work based on the original **Mineradio** repository by XxHuberrr. It is distributed under the GNU General Public License version 3 only (`GPL-3.0-only`). See `LICENSE` and `NOTICE.md`.

## Release focus

ShinaYuu Music `1.1.5` is the official stable promotion of the completed `1.1.4.6` update line. It preserves the existing renderer, UI, UX, Three.js scenes, GSAP transitions, visualizer, Desktop Lyrics, and effects while shipping the transparent Liquid Glass Home surface, system-browser YouTube account authorization and supported playlist synchronization, the persistent local music library, and preloaded track transitions.

The stable release is documented in `RELEASE_1.1.5.md`.

## Runtime architecture

```text
ShinaYuuMusic.exe
├─ Castlabs Electron main process
├─ Existing ShinaYuu Music renderer
├─ Spotify Web Playback SDK in the same renderer
├─ YouTube/local audio pipeline
├─ Lyrics and visual effects engines
└─ Native helpers for Discord, updater, tray, and Windows audio sessions
```

Castlabs Electron installs and updates the Widevine CDM through its component updater. The application waits for the component service before creating the main window. Spotify playback then runs inside the same renderer as the visible ShinaYuu Music interface; there is no separate WebView2 host window or WebView2 installer step.

## Highlights

- Spotify Premium playback through the Spotify Web Playback SDK inside Castlabs Electron.
- YouTube playback through `yt-dlp` with `youtubei.js` fallback support.
- Secure YouTube account connection through the system browser using OAuth 2.0 PKCE and a desktop loopback callback; owned playlists, Liked videos, and Uploads are synchronized through YouTube Data API v3.
- Spotify-native synchronized lyrics when available.
- Spotify market-relinked tracks keep their live SDK metadata, progress, cover, and lyrics synchronized.
- Spotify lyrics fall back to a high-confidence matching YouTube reference, captions, YouTube Music text, LRCLIB, and local alignment when Spotify's private lyrics service is unavailable.
- Runtime-generated text, tooltips, placeholders, and accessibility labels are localized to Vietnamese or English.
- YouTube subtitles/captions, YouTube Music lyrics, LRCLIB fallback, and optional local word alignment.
- Existing 3D lyrics, Desktop Lyrics, glow, blur, slide, scale, particles, and beat-reactive visuals.
- Discord profile card and local Discord Rich Presence IPC.
- One in-app master volume path for Spotify, YouTube, and local audio.
- NSIS installer with the existing ShinaYuu Music branding.
- Liquid-glass home cards with pointer-responsive refraction and preserved wallpaper visibility.
- Persistent local libraries from watched folders or ZIP/RAR/7Z archives, including embedded metadata, artwork, sidecar lyrics, online lyric fallback, and automatic rescanning.
- Playback descriptor prefetch and delayed source handoff to avoid a silent multi-second gap when selecting, skipping, or automatically advancing tracks.

## Requirements

- Windows 10 or Windows 11 x64.
- Spotify Premium for direct Spotify playback.
- Internet access during the first Castlabs launch so the Widevine component can be provisioned.
- Node.js 24 or later for source development.

## Development

The Castlabs Electron package is installed from the tagged Castlabs release archive. The first source setup uses `npm install`, then prepares the platform-specific Castlabs runtime. After `package-lock.json` is present and synchronized, later installs may use `npm ci`.

```powershell
.\INSTALL_CASTLABS.ps1
npm start
```

The equivalent manual sequence is:

```powershell
npm install
npm run setup:castlabs
npm run verify:castlabs
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

Build the official EVS/VMP-signed NSIS installer:

```powershell
npm run build:win
```

Build an unsigned development installer for installer testing only:

```powershell
npm run build:win:unsigned
```

Installer output:

```text
dist\ShinaYuu-Music-1.1.5-Setup.exe
```


## Release validation

The source includes regression tests and a production release pipeline. Public distribution still requires the maintainer to complete EVS authentication, build the signed Windows package, and smoke-test Spotify DRM playback on Windows. Do not publish an unsigned development installer as the official release.

## Spotify configuration

Create a Spotify application and register this exact redirect URI:

```text
http://127.0.0.1:43821/api/spotify/callback
```

The desktop client uses OAuth PKCE and does not embed a Spotify client secret.

## YouTube account and playlist synchronization

Google account authorization is opened in the operating system default browser, not inside Electron. ShinaYuu Music uses OAuth 2.0 Authorization Code with PKCE and receives the result through a local loopback callback.

The application maintainer should create one Google OAuth Client ID with application type **Desktop app**, enable YouTube Data API v3, and place the Desktop OAuth Client ID and Client Secret in `shinayuu.youtube.oauthClientId` and `shinayuu.youtube.oauthClientSecret` inside `package.json` before building. End users then only press **Connect YouTube** and approve access in their normal browser. The same values can also be entered from the in-app **Advanced** panel for development builds.

The supported YouTube Data API returns playlists owned by the authorized account. ShinaYuu Music also adds Liked videos and Uploads when YouTube exposes them. Playlists merely saved from another channel's library are not exposed by the official API and therefore cannot be guaranteed as an automatic sync source.

## Local music library

Use **Playlist của tôi → Thêm nhạc local** to add either:

- one or more watched music folders; or
- one or more ZIP, RAR, or 7Z archives.

Folder and archive sources are stored in the application user-data directory and restored after restart. Watched folders are rescanned automatically when supported files change. Local tracks use embedded title, artist, album, duration, and artwork metadata. A same-name `.yrc`, `.lrc`, or `.txt` file is preferred for lyrics; otherwise the normal metadata-based lyric fallback remains available.

## Master volume

Spotify now runs in the same Castlabs Electron renderer as the application UI. The existing master volume calls `Spotify.Player#setVolume()` directly for Spotify and controls the application audio graph for YouTube/local playback. The Windows audio-session bridge continues to group Electron child-process audio sessions under ShinaYuu Music where supported by the Windows mixer.

## Documentation

- `CASTLABS_ELECTRON.md` — Castlabs runtime, Widevine provisioning, and packaging notes.
- `docs/WINDOWS_SIGNING_AND_BUILD.md` — detailed EVS/VMP signing and Windows installer build procedure.
- `SETUP_SPOTIFY_YOUTUBE.md` — provider setup and playback architecture.
- `DISCORD_SETUP.md` — Discord Rich Presence setup.
- `PRIVACY.md` — local data and third-party services.
- `SECURITY.md` — security reporting and credential handling.
- `NOTICE.md` — attribution and third-party notices.
- `CHANGELOG.md` — release history.

## Acknowledgments

Mineradio was originally designed and developed by XxHuberrr, and is now being maintained and localized for global users by x.kihuh. Special thanks to **emily**, who co-created early concepts for the visual foundation and inspired the optimization direction for the `emily` visual preset.

We also want to thank akimiya7742 and MIKUHOLIC for their support during the development of the application.

## Copyright and License

Copyright (C) 2026 XxHuberrr.
Copyright (C) 2026 X.kihuh (For modifications and maintenance).
ShinaYuu Music is licensed under `GPL-3.0-only`. Redistribution of source or binaries must preserve the license, copyright notices, attribution, and the corresponding source obligations described by GPLv3.
This project is licensed under the GPL-3.0 License. See the [LICENSE](./LICENSE) file for details.

The ShinaYuu Logo, the name "ShinaYuu," the UI visual design, and original visual assets belong entirely to the original author. Third-party dependencies and services follow their respective open-source licenses and terms of service.