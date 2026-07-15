# ShinaYuu Music 1.1.4

ShinaYuu Music 1.1.4 is the stable release promoted from the `1.1.3.10` patch build.

## Castlabs Electron runtime

- Uses Castlabs Electron for Content Security `42.5.2+wvcus` as the desktop runtime.
- Runs the Spotify Web Playback SDK in the existing ShinaYuu Music renderer.
- Removes the separate hidden WebView2 Spotify host while preserving the existing UI, UX, Three.js scenes, GSAP transitions, visualizer, and effects.
- Waits for Castlabs components and Widevine provisioning before creating the main application window.

## Spotify playback and progress recovery

- Uses the live Spotify SDK state as the authoritative source for title, artist, artwork, duration, play state, and position.
- Supports Spotify market-relinked track identities.
- Fixes progress freezing after seek by clearing stale drag previews and restarting the SDK/UI clocks.
- Preserves the pre-seek playing state when Spotify temporarily reports an incorrect paused snapshot.
- Adds controlled recovery reads when seek confirmation is delayed.

## Lyrics

- Keeps Spotify synchronized and plain lyrics when accessible.
- Falls back to matching YouTube captions, YouTube Music lyrics, LRCLIB synchronized or plain lyrics, and local forced alignment.
- Retries lyric lookup after the live Spotify SDK confirms the actual track metadata.
- Keeps per-track delay and timeline calibration, 3D lyrics, Desktop Lyrics, and existing visual transitions.

## Interface and localization

- Removes the duplicate account-area DIY button while keeping the intended DIY controls.
- Improves localization of dynamic text, tooltips, placeholders, and accessibility labels.
- Preserves the established application layout and interaction model.

## Production Windows build

The official installer build uses a two-stage pipeline:

1. Package `dist\win-unpacked`.
2. Apply and verify Castlabs EVS production VMP signing.
3. Build NSIS from the signed prepackaged directory.
4. Generate a SHA-256 checksum.

Detailed instructions are provided in `docs/WINDOWS_SIGNING_AND_BUILD.md`.

Installer output:

```text
dist\ShinaYuu-Music-1.1.4-Setup.exe
```

## Known service limitations

Spotify's private lyrics endpoint may reject third-party access. ShinaYuu Music treats that response as a source failure and continues through its independent lyric fallback chain. Spotify DRM playback must be validated with an EVS/VMP-signed production package before public distribution.

## License

This release remains licensed under GNU GPL version 3 only (`GPL-3.0-only`). Original Mineradio attribution and applicable third-party notices are preserved in `NOTICE.md`.
