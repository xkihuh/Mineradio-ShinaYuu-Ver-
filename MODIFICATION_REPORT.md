# Modification Report — ShinaYuu Music 1.1.5

## Promotion baseline

ShinaYuu Music 1.1.5 is the stable promotion of the complete `1.1.4.6` source. The preserved 1.1.3.3 UI/UX structure remains the application baseline; the abandoned clean-source rewrites are not used.

## Preserved architecture

- Castlabs Electron for Content Security `42.5.2+wvcus` remains the desktop runtime.
- Spotify Web Playback SDK remains in the existing visible renderer.
- The separate hidden WebView2 Spotify host remains removed.
- The loopback server remains limited to local APIs and OAuth callbacks.
- Existing Three.js, GSAP, lyrics, visualizer, Desktop Lyrics, Discord integration, and installer artwork remain intact.

## Promoted 1.1.4.x work

- Persistent transparent Liquid Glass Home materials and protection from the legacy late-loading gray overlay.
- System-browser Google authorization with OAuth 2.0 Authorization Code, PKCE, and a desktop loopback callback.
- Supported YouTube Data API playlist synchronization, including owned playlists, Liked videos, and Uploads when available.
- Persistent local folder/archive libraries with metadata, artwork, lyrics, and rescanning.
- Playback descriptor prefetch and delayed source handoff.
- Existing Spotify seek, progress, metadata, lyrics, and fallback recovery behavior.

## Stable release updates

- Package, lockfile, display, Windows build, User-Agent, tests, and installer metadata are standardized as `1.1.5`.
- The installer artifact is `ShinaYuu-Music-1.1.5-Setup.exe`.
- `RELEASE_1.1.5.md` documents the official stable release.
- Historical `1.1.4.x` reports and changelog entries remain preserved.

## License

The project remains `GPL-3.0-only`, with original-project attribution and third-party notices preserved.
