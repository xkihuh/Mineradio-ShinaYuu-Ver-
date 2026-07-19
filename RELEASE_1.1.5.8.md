# ShinaYuu Music 1.1.5.8

ShinaYuu Music 1.1.5.7 is the seventh patch on the official 1.1.5 line and is built directly from the complete 1.1.5.6 source.

## Runtime and URL corrections

- Every external URL is validated and restricted to HTTP, HTTPS, or mail links before Electron opens the system browser.
- Renderer links use an explicit IPC bridge instead of an unhandled `window.open()` path.
- Malformed background-media URLs return safely instead of throwing.
- Renderer errors and unhandled promise rejections are written with stack traces to the startup log.
- The Electron console listener uses the current event-object API.

## GPU recovery

- Normal startup requests hardware rasterization, accelerated 2D/video decode, and the high-performance GPU while retaining Chromium's blocklist protection.
- If GPU compositing and WebGL are both disabled, the application performs one controlled recovery relaunch using the performance-GPU profile.
- If the renderer or GPU still fails, the existing Safe Graphics recovery remains available and relaunch loops are prevented.
- The window reveal timeout is cancelled after the first successful display.

## Provider diagnostics

- Provider-specific timeout codes distinguish Spotify, YouTube, LRCLIB, and other network failures.
- Spotify private-lyrics RBAC denial is cached for six hours and immediately falls through to the existing browser-session, YouTube, YouTube Music, LRCLIB, and local-alignment sources.

## Preserved features

- Expanded player visualizer and bilingual controls from 1.1.5.6.
- Smart Lyrics, playlist totals, and bounded playback recovery from 1.1.5.5.
- Liquid Glass transparency, folder media gallery, streamed video backgrounds, local library, Discord Rich Presence, Castlabs/Widevine, Spotify, and YouTube.


## Stable adaptive GPU startup

- The default `auto` profile does not force a dedicated GPU, ANGLE backend, or Chromium GPU-blocklist bypass.
- When GPU compositing and WebGL are unavailable, the application retries hardware acceleration with D3D11 and then OpenGL.
- The first confirmed working profile is stored in `%APPDATA%\ShinaYuu Music\gpu-profile.json` and reused automatically.
- `RESET_GPU_PROFILE.cmd` clears the remembered profile so the next launch can test hardware selection again.
- Safe Graphics is used only after the hardware profiles fail, so compatible machines retain normal Three.js, video decode, visualizer, Liquid Glass, and animation performance.

## Native-window compatibility

- The main BrowserWindow uses an opaque Windows surface while preserving the complete internal Liquid Glass UI.
- This avoids the common condition where Electron remains in Task Manager but a native transparent window is not composited or shown.
- Opaque native composition does not call `app.disableHardwareAcceleration()` and generally reduces composition overhead.

## Recovery order

```text
Auto hardware
  -> D3D11 hardware
  -> OpenGL hardware
  -> Safe Graphics software fallback
```

GPU process crashes, renderer startup failures, load failures, and early unresponsive states all use the same bounded recovery order without relaunch loops.

## Preserved fixes

- URL validation and detailed renderer diagnostics from 1.1.5.7.
- Expanded bilingual visualizer and Smart Lyrics.
- YouTube/Spotify playback recovery and YouTube system-playlist totals.
- Castlabs/Widevine, Discord Rich Presence, folder media, local library, and Liquid Glass settings.

## Version

- Package: `1.1.5-patch.8`
- Display/build: `1.1.5.8`
- Installer: `dist\ShinaYuu-Music-1.1.5.8-Setup.exe`