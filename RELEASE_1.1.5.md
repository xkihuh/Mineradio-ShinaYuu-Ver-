# ShinaYuu Music 1.1.5

ShinaYuu Music 1.1.5 is the stable release promoted from the completed `1.1.4.6` update source. It keeps the established ShinaYuu Music interface and hybrid Castlabs Electron architecture while consolidating the Home Liquid Glass, YouTube account, playlist, local-library, playback-transition, and production-build work into one official release.

## Interface and Liquid Glass

- Preserves the existing Home layout, wallpaper, Three.js scenes, GSAP transitions, visualizer, lyrics, and interaction model.
- Uses transparent Liquid Glass surfaces with blur, refraction, fine borders, pointer response, and persistent protection against the legacy late-loading gray panel layer.
- Keeps cover artwork and content readability instead of replacing the established visual hierarchy.

## YouTube account connection

- Opens Google authorization in the operating system default browser rather than an embedded Electron window.
- Uses OAuth 2.0 Authorization Code with PKCE and a local loopback callback.
- Requires the application maintainer to configure a Google Desktop OAuth Client ID and its matching Client Secret before building the public application.
- Stores each user's authorization tokens locally in that user's application data. End users sign in with their own Google accounts and do not configure developer credentials.
- Synchronizes playlists owned by the authorized YouTube channel through YouTube Data API v3, plus Liked videos and Uploads when exposed by the channel.
- Keeps anonymous YouTube search and playback available when account synchronization is not configured.

## Libraries and playback

- Preserves persistent local folder and archive libraries, metadata, artwork, sidecar lyrics, and automatic rescanning.
- Preserves Spotify and YouTube playback descriptor prefetch and delayed source handoff to reduce silent transitions.
- Preserves Spotify SDK state recovery, seek recovery, synchronized lyrics, provider fallbacks, Desktop Lyrics, master volume, and Discord Rich Presence.

## Runtime and Windows release

- Uses Castlabs Electron for Content Security `42.5.2+wvcus`.
- Keeps Spotify Web Playback SDK in the visible application renderer without a separate WebView2 host.
- Produces the official NSIS installer as:

```text
dist\ShinaYuu-Music-1.1.5-Setup.exe
```

- The production pipeline packages the application, applies and verifies Castlabs EVS/VMP signing, builds NSIS, and generates a SHA-256 checksum.

## Known YouTube API limitation

YouTube Data API v3 exposes playlists owned by the authorized account. Playlists merely saved from another channel are not guaranteed to be available through the supported API.

## License

This release remains licensed under GNU GPL version 3 only (`GPL-3.0-only`). Original Mineradio attribution and applicable third-party notices are preserved in `NOTICE.md`.
