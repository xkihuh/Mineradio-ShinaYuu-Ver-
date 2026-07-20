# ShinaYuu Music 1.1.6.3

## Scope

This patch intentionally returns to the conservative 1.1.6.1 runtime behavior. It does not change the application window lifecycle, Chromium background behavior, playback polling, Spotify realtime analysis, Three.js render loop, GPU configuration, or provider behavior.

## Lightweight changes

- Wallpaper-folder metadata scan concurrency is adjusted from 16 to 12.
- The wallpaper gallery initially creates 30 cards instead of 36.
- Later idle batches create 20 cards instead of 28.
- Lazy preview distance is adjusted from 260 px to 220 px.
- File name, relative path, media type, size, original image quality, and hover video preview remain available.

## Preserved

- Window startup and compatibility behavior from 1.1.6.1.
- Playback, progress, Spotify, YouTube, realtime analysis, and lyrics behavior.
- UI/UX, Three.js, GSAP, Liquid Glass, animation, image/video quality, and GPU acceleration.
- YouTube Liked videos and Uploads counts.

## Version

- Package version: `1.1.6-patch.3`
- Display/build version: `1.1.6.3`
- Installer: `ShinaYuu-Music-1.1.6.3-Setup.exe`
