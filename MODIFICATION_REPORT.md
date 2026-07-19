# Modification Report — ShinaYuu Music 1.1.5.8

ShinaYuu Music 1.1.5.8 is built directly from the complete 1.1.5.7 source. The Electron/Castlabs architecture, UI/UX, Three.js, GSAP, Liquid Glass, expanded visualizer, Smart Lyrics, Spotify, YouTube, local library, Discord, URL safety, provider fallback, startup recovery, and playback recovery remain intact.

## Adaptive hardware compatibility

- Normal startup uses the `auto` GPU profile and leaves Chromium/Windows GPU selection untouched.
- A failed hardware startup retries D3D11 and then OpenGL while retaining hardware acceleration.
- A confirmed working hardware profile is saved in the user-data directory and reused on later launches.
- Windows uses an opaque native BrowserWindow surface to prevent invisible transparent-window failures without disabling GPU acceleration.
- GPU blocklist bypass, forced dedicated-GPU selection, zero-copy, and forced D3D11 remain confined to the explicit `--force-performance-gpu` profile.
- Safe Graphics remains the final fallback only after the hardware profile sequence is exhausted.

## Version metadata

- npm package version: `1.1.5-patch.8`
- Display and Windows build version: `1.1.5.8`
- Installer artifact: `ShinaYuu-Music-1.1.5.8-Setup.exe`

See `RELEASE_1.1.5.8.md` and `FINAL_TEST_REPORT_1.1.5.8.txt`.
