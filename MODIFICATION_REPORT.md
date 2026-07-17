# Modification Report — ShinaYuu Music 1.1.5.2

ShinaYuu Music 1.1.5.2 is built directly from the 1.1.5.1 source. The established renderer structure, UI/UX, Three.js scenes, GSAP transitions, synchronized lyrics, visualizer, Spotify, YouTube, Discord, folder-backed media library, and Castlabs Electron architecture remain intact.

## Stage text selector

- Converted the single Lyrics button into a Liquid Glass menu with Track title, Lyrics, and Show nothing modes.
- Track title mode reuses the existing 3D lyric stage but renders only the active song name.
- Lyrics mode preserves the complete current synchronized lyric path.
- Show nothing mode clears all stage text and immediately disables the related star-river glow.
- The chosen mode persists in local storage and is restored after restart.
- The local `L` shortcut cycles through all three choices.
- Immersive mode restores the exact mode that was active before entering it.

## Packaging

- npm package version: `1.1.5-patch.2`
- Display and Windows build version: `1.1.5.2`
- Installer artifact: `ShinaYuu-Music-1.1.5.2-Setup.exe`

## Validation

The source includes a dedicated stage-text regression test plus the existing UI, packaging, playback, lyrics, Spotify, YouTube, background-media, local-library, Discord, and Castlabs checks.
