# Modification Report — ShinaYuu Music 1.1.5.7

ShinaYuu Music 1.1.5.7 is built directly from the complete 1.1.5.6 source. The Electron/Castlabs architecture, UI/UX, Three.js, GSAP, Liquid Glass, expanded visualizer, Smart Lyrics, Spotify, YouTube, local library, Discord, startup recovery, and playback recovery remain intact.

## Changes

- Validated all external URLs before opening the system browser and added a native renderer-to-main IPC bridge.
- Added full renderer `error` and `unhandledrejection` diagnostics, including stack traces, to `startup.log`.
- Updated Electron `console-message` handling to the event-object API and filtered expected Spotify SDK PlayReady advisory output.
- Enabled the normal hardware-GPU preference without bypassing Chromium's safety blocklist.
- Added one bounded recovery relaunch when both GPU compositing and WebGL are unavailable.
- Cleared the startup reveal timer after the first successful window display.
- Split generic request timeouts into Spotify, YouTube, LRCLIB, and generic timeout codes.
- Added a Spotify private-lyrics RBAC circuit breaker so 403 responses immediately continue through supported fallback sources without repeated denied requests.

## Version metadata

- npm package version: `1.1.5-patch.7`
- Display and Windows build version: `1.1.5.7`
- Installer artifact: `ShinaYuu-Music-1.1.5.7-Setup.exe`

See `RELEASE_1.1.5.7.md` and `FINAL_TEST_REPORT_1.1.5.7.txt`.
