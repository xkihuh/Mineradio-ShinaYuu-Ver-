# ShinaYuu Music 1.1.6.7 - Modification Report

## Base

- Built directly from the cleaned and rounded-window ShinaYuu Music 1.1.6.6 source.

## Playback responsiveness changes

- Moved beat-map cache reads and optional visual preparation after audible HTMLAudio playback starts.
- Added token-guarded background visual preparation so a late disk read cannot overwrite a newer track.
- Starts queue-item prefetch on pointer hover/down, increases the safe YouTube playback-descriptor cache window, and begins next-track prefetch sooner.
- Added an eight-minute in-memory YouTube stream-descriptor cache to avoid repeating yt-dlp work during quick queue changes or seek recovery.
- Dispatches HTMLAudio seek Range requests before resetting beat and camera cursors.
- Uses Spotify playlist/search Track ID and URI as an immediate local descriptor.
- Returns on the first exact Spotify SDK playing state while retaining wrong-track detection.
- Treats an accepted Spotify seek as immediate, then confirms and corrects the clock asynchronously.

## Preserved

- Audio quality, provider separation, and Spotify exact-track verification.
- Window startup, opaque native window, and rounded corners.
- UI/UX, Three.js, GSAP, Liquid Glass, animation, lyrics, wallpaper, Discord, and CPU optimization behavior.

## Version

- Package: 1.1.6-patch.7
- Display/build: 1.1.6.7
- Installer: ShinaYuu-Music-1.1.6.7-Setup.exe

## Source package policy

- No generated TXT test reports.
- No historical standalone release files.
