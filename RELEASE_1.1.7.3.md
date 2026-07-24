# ShinaYuu Music 1.1.7.3

## YouTube idle-resume recovery

- Added automatic recovery when a YouTube track is paused or the application remains in the background for several minutes.
- Refreshes expired audio and MV stream descriptors without deleting or reinstalling a healthy bundled `yt-dlp` engine.
- Retries transient HTTP, timeout and signed-URL failures before reporting a real engine installation problem.
- Warms replacement descriptors while a paused YouTube track remains idle so playback can resume without restarting the application.

## Faster playback startup

- Added a low-latency race between Innertube and `yt-dlp` for YouTube audio and MV descriptors.
- Starts warming the first search results immediately after rendering, while preserving hover and next-track prefetch.
- Keeps provider shutdown, audio preparation and MV preparation parallel so selecting a track responds immediately.

## MV black-screen and synchronization recovery

- Keeps the current track artwork visible until the first real MV frame is decoded, preventing a black background during startup or recovery.
- Refreshes expired media proxy URLs once on HTTP 403, 410, 416 or 429 responses.
- Adds an H.264/MP4 compatibility retry after repeated decoder stalls.
- Restores the MV after backgrounding, decoder suspension or lost render frames and realigns it to the audio master clock.

## Universal lyrics calibration

- Enables per-track lyric delay and timeline-rate adjustment for Spotify, YouTube Music, YouTube Video and local tracks.
- Exact native timestamps still default to zero delay and 100% timeline rate, but user calibration is no longer disabled.
- Preserves each track's independent calibration settings.

## Compatibility

- Keeps the separate Spotify, YouTube Music and YouTube Video source architecture.
- Preserves the existing Electron/Castlabs runtime, original lyrics UI, Three.js/GSAP effects, playlist shelf, MV display modes, Discord integration and Windows build pipeline.
