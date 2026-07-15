# Modification Report — ShinaYuu Music 1.1.4

## Promotion baseline

ShinaYuu Music 1.1.4 is the stable promotion of the complete `1.1.3.10` patch source. The preserved 1.1.3.3 UI/UX structure remains the application baseline; later clean-source rewrites are not used.

## Runtime architecture

- Castlabs Electron for Content Security `42.5.2+wvcus` remains the application runtime.
- Spotify Web Playback SDK runs in the existing visible ShinaYuu Music renderer.
- The separate hidden WebView2 Spotify host remains removed.
- Castlabs `components.whenReady()` completes before the main window is created.
- The loopback server remains limited to local API and OAuth callback handling.

## Stabilized behavior

- Spotify market-relinked tracks are accepted through SDK identity and strict metadata matching.
- Live SDK state controls player title, artist, artwork, duration, position, and lyrics identity.
- Progress and seek recovery clear stale drag previews and restart the independent SDK/UI clocks.
- Spotify lyric failures continue through YouTube captions, YouTube Music, LRCLIB, local forced alignment, and plain-text fallbacks.
- Existing lyrics calibration, Desktop Lyrics, Three.js scenes, GSAP transitions, visualizer, effects, Discord integration, and installer artwork are preserved.

## Stable release updates

- Version metadata is standardized as `1.1.4`.
- The installer artifact is `ShinaYuu-Music-1.1.4-Setup.exe`.
- `RELEASE_1.1.4.md` documents the stable release.
- The Windows production build now signs and verifies the packaged application with Castlabs EVS before creating NSIS.
- Detailed signing and build instructions are available in `docs/WINDOWS_SIGNING_AND_BUILD.md`.

## License

The project remains `GPL-3.0-only`, with original-project attribution and third-party notices preserved.
