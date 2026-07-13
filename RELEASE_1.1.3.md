# ShinaYuu Music 1.1.3

ShinaYuu Music 1.1.3 is the stable release promoted from the `1.1.2.4` patch line.

## YouTube lyric coverage

- Reads lyrics from the YouTube Music lyrics tab when video captions are unavailable.
- Preserves exact YouTube caption timing when suitable caption tracks exist.
- Falls back to LRCLIB synchronized or plain lyrics.
- Uses local forced alignment to generate word timing from the exact YouTube audio when only plain lyrics are available.
- Keeps the existing application layout, 3D lyrics, Desktop Lyrics, and visual effects.

## Unified master volume

- The in-app volume control now acts as a master volume for both Spotify and YouTube.
- Spotify volume is applied directly inside the hidden WebView2 player through the Spotify Web Playback SDK.
- The saved volume is restored before playback and remains synchronized when switching providers.
- Mute and keyboard volume adjustments use the same master state.

## WebView2 Runtime deployment

- The NSIS installer checks the official WebView2 Runtime registry locations.
- When the Runtime is missing, the installer downloads and silently installs the Microsoft Evergreen Bootstrapper.
- Installation continues with a warning if Runtime provisioning cannot complete.

## Packaging

```text
dist\ShinaYuu-Music-1.1.3-Setup.exe
```

## License

This release remains licensed under GNU GPL version 3 only. Original Mineradio attribution and third-party notices are preserved in `NOTICE.md`.
