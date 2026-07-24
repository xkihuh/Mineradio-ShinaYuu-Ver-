## 1.1.7.3 — Idle resume, fast playback and MV recovery

- Fixed YouTube playback failing after a track was paused or the application stayed in the background for several minutes.
- Added non-destructive engine health checks and automatic refresh of expired audio/video stream descriptors.
- Added a fast Innertube/yt-dlp descriptor race and staggered first-result prefetch to reduce cold track-start latency.
- Added audio and media proxy retries for expired or rejected signed URLs.
- Added MV artwork fallback, decoder recovery, compatibility retry and foreground-resume repair to prevent persistent black backgrounds while audio continues.
- Kept audio as the authoritative clock and retained the existing YouTube Video A/V watchdog.
- Enabled lyric delay and timeline-rate calibration for Spotify, YouTube Music, YouTube Video and local tracks.
- Updated package, display/build version, installer name, release notes, modification report and regression coverage to 1.1.7.3.

## Release summary

Version `1.1.7.1` keeps the raw video-only **Playing MV** background while restoring YouTube Music as an independent music source. Spotify, YouTube Music and normal YouTube Video now remain separate in search, recommendations, history and lyrics.

## Playing MV

- Image Control now provides explicit **Full HD**, **2K** and **4K** MV quality choices. Full HD is the default for smooth playback; 2K and 4K request 1440p and 2160p when the upload exposes those streams.
- The MV status reports the selected stream's actual resolution and frame rate, making a lower-source fallback visible rather than presenting it as Full HD.
- Stream selection first locks to the highest real pixel dimensions available for the chosen tier, then uses bitrate and codec preference to select between equal-resolution formats.
- A decoded-frame watchdog recovers a video decoder that remains frozen after a control action. Recovery first resumes without seeking, then performs one clock correction, and refreshes the stream only after a prolonged stall.
- Playing MV now stays in the existing background slot. The Three.js playlist shelf, scrolling carousel, title/lyrics, search, controls, panels and all established UI/UX remain in their original positions and stacking order above the per-track video wallpaper.

- The feature is available in Image Control → Interface → Media background.
- YouTube items use the exact selected video ID and render the direct muted video stream in the app's own HTML5 video layer.
- No YouTube iframe is used in this feature, so YouTube logo, channel name, title, controls, annotations and end-screen overlays are not part of the rendered layer.
- The video layer is shown only after actual decoded frames begin playing. While loading or after an unrecoverable stream error, the stage remains black instead of displaying a thumbnail.
- The existing audible player remains the only audio source and the authoritative timeline for play, pause, seek, playback rate, track changes, lyrics and visualizer synchronization.
- The visual stream pauses while the app is hidden and is released when the mode is disabled or the provider changes.
- Spotify tracks continue to use Spotify artist, album and artwork metadata instead of an unrelated YouTube match.
- YouTube video frames now use full-window `cover` rendering instead of letterboxing, with no CSS blur, opacity blend or dark overlay applied to the MV layer.
- Stream selection prioritizes resolution and bitrate before codec preference. Eco requests up to 720p, Balanced requests 1080p, High requests 1440p, and Ultra requests 2160p when the source provides it.
- If the highest-quality codec cannot be decoded, the app retries at the same resolution ceiling with H.264/MP4 rather than dropping to a 480p stream.
- While Playing MV is active, the decoded video remains at the normal wallpaper z-index. It does not hide the Three.js scene or rewrite the z-index of controls, playlist surfaces, search or panels.
- Balanced/High now accept 1080p50/60 formats instead of restricting selection to 30 FPS, which previously caused some videos to fall back to a low-resolution rendition.
- The background decoder remains muted and the established master audio player is reasserted after MV startup, preserving audible output and master-volume behavior.
- Play and Pause no longer force a background-video seek, so the decoded frame queue remains intact when playback is resumed.
- A progress-bar seek is applied to the MV exactly once after the primary audio seek completes. The previous frame remains visible until the target frame is decoded, and playback resumes after `seeked`/`canplay`.
- Small timeline differences are corrected by at most ±0.4% and are rate-limited; hard seeks require more than 1.45 seconds of drift and have a nine-second cooldown.
- Audio `waiting` and `stalled` states pause the visual stream so network buffering cannot accumulate drift.
- The local media proxy now honors writable backpressure and permits short Range caching for steadier high-bitrate delivery.

## Single audible transport

- Switching from Spotify to YouTube or local playback now completes a Spotify pause transaction before the HTML-audio transport is activated.
- The switch invalidates any in-flight Spotify start command and verifies the Spotify SDK state, including delayed checks for a stale command that completes after the user changes provider.
- The Playing MV element remains permanently muted; only the selected provider's established master player can produce audible output.

## Separate YouTube Music and YouTube Video sources

- **YouTube Music** again uses `yt.music.search(..., { type: 'song' })` and keeps the original music-oriented metadata, playlist behavior, recommendations and lyrics pipeline.
- **YouTube Video** uses normal YouTube video search and is displayed as a separate source for MVs, uploads, live videos and other public video results.
- The **All** tab shows Spotify, YouTube Music and YouTube Video as separate sections instead of merging both YouTube surfaces into one ambiguous provider.
- Source identity is preserved when adding tracks to the queue, restoring recent playback, prefetching playback and extending recommendation sessions.
- Playing MV uses the exact selected video only as a muted background layer and never converts a YouTube Music track into a YouTube Video track.

## Performance and compatibility

- Removed the YouTube iframe player and hidden decode-probe player from Playing MV, avoiding duplicate video decoders.
- Reuses the existing YouTube resolver and media proxy with Range support.
- Prefers compatible H.264/MP4 video streams and performs one compatibility refresh when necessary.
- Video preparation never blocks audible playback or track switching.

## Preserved behavior

The release keeps the established Electron/Castlabs architecture, UI/UX, Liquid Glass, Three.js, GSAP, synchronized lyrics, visualizer, Spotify playback, YouTube account playlists, local library, wallpaper gallery, Discord Rich Presence, updater and rounded-window behavior.

## Release files

- `ShinaYuu-Music-1.1.7-Setup.exe`
- `ShinaYuu-Music-1.1.7-Setup.exe.blockmap`
- `latest.yml`


## 1.1.7.1
- Reworked YouTube search playback to build a stable genre-matched queue from the selected track.
- Detects styles such as Phonk, Funk, EDM, House, Dubstep, US/UK, K-Pop, J-Pop, V-Pop, Rock, Metal, Lo-fi and related genres from track metadata.
- The detected genre is locked for the current recommendation session so later queue expansion stays in the same style.
- When the final track is reached, the app appends another same-genre batch instead of replacing the current playlist.
- Removed the redundant gray stage floor under the 3D Stage playlist shelf.
- Updated build metadata to 1.1.7.1 and added an optional --skip-tests build mode.

- Removed the duplicate MV-only title/lyrics HTML overlay; the original ShinaYuu 3D/UI lyrics layer is now the only visible text layer.
- Regular YouTube videos now resolve a separately scored YouTube Music song reference for lyrics while retaining the original YouTube video for playback and MV wallpaper.
- Automatic video captions are now a last-resort fallback after YouTube Music and LRCLIB.
- Tightened genre recommendation queries to YouTube Music song search and stronger same-style filtering.


### Separate-source correction and exact-video lyrics

- Replaced the temporary mixed YouTube result model with separate YouTube Music and YouTube Video sources.
- YouTube Music returns only music-surface song results and keeps its original metadata, recommendation and lyric behavior.
- Normal YouTube Video keeps exact-caption and per-video alignment behavior without overwriting YouTube Music tracks.
- When exact video captions are unavailable, external lyric text is used only as transcription input and timestamps are regenerated from that exact video's audio.
- While exact-video alignment is processing, the original title fallback remains visible instead of showing falsely synchronized estimated lyrics.


## 1.1.7.3 — YouTube Video A/V synchronization maintenance

- Kept the public version at 1.1.7.3 as requested.
- Added a strict synchronization path only for the separate YouTube Video source.
- Added an independent 180 ms A/V watchdog so synchronization continues even when Chromium stops emitting video-frame callbacks during a brief decoder stall.
- Audio remains the authoritative playback clock; the muted MV is automatically realigned after audio buffering, video buffering, dropped frames, or a decoder hitch.
- Added bounded soft playback-rate correction for small drift and fast hard resynchronization for persistent or large drift.
- Added decoder recovery for cases where the video frame freezes while its media clock appears to continue.
- Preserved the gentler synchronization behavior for YouTube Music and all existing Spotify, lyrics, playlist, visual, and UI/UX behavior.
- Added YouTube Video A/V resynchronization regression coverage.
