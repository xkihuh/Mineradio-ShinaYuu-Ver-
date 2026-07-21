# ShinaYuu Music 1.1.6.10

## Changes

- Fixed the desktop window style argument so the transparent renderer receives the rounded-window class.
- Restored the visible 30 px rounded shell in windowed mode and removed the rectangular native shadow for transparent windows.
- Preserved the opaque compatibility fallback through `--safe-opaque-window`.
- Added a **Check for updates** button to the Advanced section of the visual control panel.
- Added clear manual-update states: checking, latest, update available, source not configured, and connection error.
- Added the application name and display version at the bottom of the Advanced section.
- Kept the automatic check after startup and the six-hour recurring check.
- Preserved Spotify playlist fixes, playback latency fixes, YouTube recovery, wallpaper optimization, and all existing UI effects.

## Update configuration

Fill `mineradio.update.owner` and `mineradio.update.repo` in `package.json`, then publish the installer, blockmap, and `latest.yml` from the same build.
