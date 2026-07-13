# Modification Report — ShinaYuu Music 1.1.3.2 Patch Build

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

## 1.1.3.2 patch changes

- Preserved Spotify lyrics when the service returns `UNSYNCED` text instead of discarding the response.
- Added exact live-track ID handoff from the Spotify Web Playback SDK to the lyrics provider.
- Added original and market-relinked Spotify track ID candidates.
- Added a bounded WebView2-session retry path that uses the active browser context before LRCLIB fallback.
- Added explicit HTTP and transport diagnostics for failed Spotify lyrics requests.
- Added a stale-track guard based on playback duration so the previous song ID cannot be reused during a fast track switch.
- Retained the corrected NSIS build resources from patch 1.1.3.1.
- Preserved `RELEASE_1.1.3.md` as the latest stable release document; no patch-specific release document was added.
