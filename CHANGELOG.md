# Changelog

All notable changes to ShinaYuu Music are documented in this file.

## 1.1.3.1 — 2026-07-13 (Patch Build)

### Fixed

- Escaped the PowerShell `$ProgressPreference` variable in the NSIS include script so `makensis` no longer reports warning 6000 and aborts the installer build.
- Updated the patch display version, Windows build version, installer artifact name, build helper scripts, and regression tests.
- Added a regression check that rejects an unescaped PowerShell dollar sign in `build/installer.nsh`.

> This is a patch build based on stable version 1.1.3. It intentionally does not include a `RELEASE_1.1.3.1.md` file.

## 1.1.3 — 2026-07-13

### YouTube lyrics

- Added lyrics retrieval from the YouTube Music lyrics tab.
- Kept YouTube caption timing as the first exact-video timing source.
- Added LRCLIB fallback when native YouTube sources are unavailable.
- Added local forced alignment for plain lyrics when word timing is missing.
- Preserved the existing lyrics UI, Desktop Lyrics, 3D layout, and visual effects.

### Master volume

- Added a unified master volume path for YouTube and Spotify playback.
- Added a local control endpoint between the Electron renderer and the hidden Spotify WebView2 host.
- Applied Spotify volume through `Spotify.Player#setVolume()` instead of relying only on the Spotify Connect volume endpoint.
- Restored the saved volume before Spotify playback starts and synchronized mute state.

### WebView2 deployment

- Added NSIS detection for Microsoft Edge WebView2 Runtime.
- Added automatic Evergreen Bootstrapper installation when the Runtime is missing.
- Kept application installation available when WebView2 installation fails, with a clear installer warning.

### Release and documentation

- Promoted patch line `1.1.2.4` to stable release `1.1.3`.
- Updated package metadata, Windows build metadata, installer naming, User-Agent strings, tests, and build scripts.
- Standardized project Markdown documentation in English.
- Added the stable release document `RELEASE_1.1.3.md`.

## 1.1.2 — 2026-07-12

- Added Spotify-native lyric timing and LRCLIB timing correction.
- Added per-track lyric offset and timeline adjustment for non-native sources.
- Added lyric visual pre-roll so transitions finish at the vocal timestamp.
- Reworked Discord IPC connection, error reporting, and configuration UI.
- Fixed NSIS installation-directory validation.

## 1.1.1 — Baseline

- Rebranded Mineradio as ShinaYuu Music.
- Restored Electron as the main window and added a hidden Spotify WebView2 host.
- Added Spotify Web Playback SDK, YouTube playback through `yt-dlp`, mixed-provider search, and queue handling.
- Added fullscreen, Visual Effects, Desktop Lyrics, real-time beat analysis, and Discord Rich Presence.
