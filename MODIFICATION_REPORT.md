# Modification Report — ShinaYuu Music 1.1.3.1 Patch Build

## Project relationship

ShinaYuu Music is a modified work based on the original Mineradio project. The project preserves original attribution and remains licensed under GNU GPL version 3 only.

## Version promotion

- `1.1.1` represents the stable baseline.
- `1.1.2` contains the lyric transition, Spotify timing, Discord IPC, and installer-path work completed on 2026-07-12.
- Patch revisions `1.1.2.1` through `1.1.2.4` were development builds.
- Patch `1.1.2.4` was accepted and promoted to stable release `1.1.3`.

## 1.1.3 changes

- Added YouTube Music lyrics retrieval.
- Preserved caption and LRCLIB fallback behavior.
- Added local word alignment for unsynchronized YouTube lyrics.
- Added unified master volume for Spotify WebView2 and YouTube playback.
- Added WebView2 Evergreen Runtime provisioning to the installer.
- Standardized Markdown documentation in English.
- Added release and regression documentation for 1.1.3.

## 1.1.3.1 patch changes

- Fixed the NSIS warning 6000 failure caused by an unescaped PowerShell `$ProgressPreference` variable.
- Updated current patch-facing version metadata and installer output naming.
- Preserved `RELEASE_1.1.3.md` as the latest stable release document; no patch release document was added.
