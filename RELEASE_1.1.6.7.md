# ShinaYuu Music 1.1.6.7

## Faster track switching and seeking

- Starts HTMLAudio playback before optional beat-map disk reads and secondary visual preparation.
- Keeps beat, lyrics, Three.js, and visual analysis preparation in the background after audible playback begins.
- Starts queue-item prefetch on pointer hover/down, extends the safe prefetched YouTube descriptor lifetime, and reuses recently resolved yt-dlp stream descriptors.
- Uses Spotify Track ID and URI already present in playlist/search items instead of making a redundant metadata request before every switch.
- Accepts the first exact matching Spotify SDK playing state instead of waiting for an additional position sample.
- Applies Spotify seek position and playback state immediately after the SDK accepts the seek, then reconciles with the SDK clock in the background.
- Dispatches HTMLAudio Range seeks before resetting secondary visual cursors.

## Preserved

- Audio quality and selected provider.
- Spotify exact-track validation and wrong-track protection.
- YouTube yt-dlp automatic recovery.
- Window startup and native rounded corners.
- UI/UX, Three.js, GSAP, Liquid Glass, wallpaper, lyrics, Discord, and CPU optimizations.

## Source cleanup

- No generated TXT test reports are included.
- Only this current standalone release document is included; historical release notes remain in `CHANGELOG.md`.
