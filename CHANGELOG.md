# Changelog

## 1.1.4 — 2026-07-15

### Stable promotion

- Promoted the complete `1.1.3.10` patch state to stable release `1.1.4`.
- Updated package metadata, display version, Windows build version, installer naming, User-Agent, tests, build helpers, and release documentation.
- Added `RELEASE_1.1.4.md` and updated the supported stable release line.

### Castlabs and Spotify

- Preserved Castlabs Electron for Content Security `42.5.2+wvcus` and the existing same-renderer Spotify Web Playback SDK architecture.
- Preserved market-relinked track handling, authoritative SDK metadata, seek recovery, independent progress updates, and transient paused-state recovery.
- Preserved the full Spotify lyric fallback chain and retry behavior from patch `1.1.3.10`.

### Production build pipeline

- Added an official two-stage Windows release build that packages `win-unpacked`, applies and verifies EVS production VMP signing, and builds NSIS from the signed prepackaged directory.
- Added explicit development-only unsigned installer support.
- Added SHA-256 generation for the final setup file.
- Added detailed English documentation for EVS setup, runtime testing, production signing, optional Authenticode signing, NSIS packaging, and release smoke testing.

## 1.1.3.10 - Spotify Seek Clock and Lyrics Recovery Patch

- Fixed Spotify progress freezing after seeking by clearing stale drag previews and restarting the SDK/UI clocks.
- Preserves the pre-seek play state when Spotify temporarily reports `paused=true` after a successful seek.
- Accepts market-relinked Spotify track IDs during seek confirmation instead of requiring strict URI equality.
- Added a dedicated 100 ms Spotify progress UI clock so the player bar remains responsive even when other UI work is delayed.
- Added recovery reads after seek timeout and prevents stale SDK snapshots from pulling the progress bar back or stopping its clock.
- Expanded Spotify-to-YouTube lyrics matching with normalized title/artist variants, album/ISRC queries, captions, YouTube Music text, and local alignment.
- Made LRCLIB failures non-fatal and added controlled lyrics retries after the live Spotify SDK confirms the actual/relinked track metadata.
- Preserved the existing UI, UX, effects, Castlabs runtime, lyrics renderer, and installer assets.
- Kept 1.1.3 as the latest stable release; no patch-specific release document was added.
## 1.1.3.8 - Castlabs Rebuild

- Rebuilt directly from the preserved 1.1.3.3 source baseline.
- Replaced stock Electron and the separate hidden WebView2 Spotify host with Castlabs Electron for Content Security.
- Kept the original 1.1.3.3 UI, UX, effects, lyrics layout, visualizer, provider logic, and file structure.
- Added a local Castlabs package wrapper and deterministic runtime setup/verification scripts for Windows.
- Removed the WebView2 runtime dependency and installer bootstrapper.
- Kept 1.1.3 as the latest stable release; no patch-specific release document was added.
## 1.1.3.8 - Castlabs Electron Patch

- Replaced stock Electron plus the separate hidden WebView2 Spotify host with Castlabs Electron for Content Security.
- Added Castlabs `components.whenReady()` startup provisioning and runtime diagnostics.
- Moved Spotify Web Playback SDK playback into the same renderer as the existing ShinaYuu Music UI.
- Removed the WebView2 dependency, hidden host runtime, WebView2 reset helper, and NSIS WebView2 bootstrapper.
- Configured `electron-builder` to package the installed Castlabs distribution through `electronDist`.
- Preserved the existing UI, UX, visual effects, lyrics providers, Desktop Lyrics, YouTube playback, Discord integration, and master volume behavior.
- Kept 1.1.3 as the latest stable release; no patch-specific release document was added.

## 1.1.3.3 - Patch

- Added YouTube subtitle lyrics support for JSON3, TTML, SRV3, and WebVTT tracks exposed by the existing `yt-dlp` engine.
- Preserved Spotify lyrics, YouTube Music lyrics, LRCLIB, plain lyrics, and local forced alignment as independent fallback sources.
- Removed non-lyric caption cues such as `[Music]`, `[Applause]`, and symbol-only rows.
- Rejects low-content caption tracks so poor subtitles do not override better lyric sources.
- Preserved the consolidated lyric calibration panel, expanded timing ranges, localization pass, Windows audio-session bridge, UI, UX, Desktop Lyrics, and visual effects from the source baseline.
- Kept 1.1.3 as the latest stable release; no separate patch release document was added.


All notable changes to ShinaYuu Music are documented in this file.

## 1.1.3.2 — 2026-07-13 (Patch Build)

- Fixed Spotify lyrics being discarded when Spotify returns `UNSYNCED` text.
- Uses the exact Spotify track ID reported by the live Web Playback SDK.
- Tries market-relinked and original Spotify track IDs before falling back.
- Added a WebView2-session lyrics retry path when the Node request receives an authentication, authorization, or catalog response.
- Added explicit diagnostics for Spotify lyrics HTTP failures.
- Preserved LRCLIB fallback when Spotify's private lyrics service is unavailable.
- Kept the stable release document at `RELEASE_1.1.3.md`; no patch-specific release file was added.

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
