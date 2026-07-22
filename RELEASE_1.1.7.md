# ShinaYuu Music 1.1.7

## Release summary

Version `1.1.7` adds a raw video-only **Playing MV** background, expands YouTube search beyond music-only results, prevents Spotify and YouTube from remaining audible at the same time, and keeps title/lyrics controls visible above the MV.

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

## Universal YouTube search

- The primary YouTube search now requests universal video results rather than YouTube Music song-only results.
- Results may include normal uploads, music videos, gameplay, tutorials, podcasts, Shorts and public live videos.
- Exact video IDs, channel names, duration, thumbnails, content type and direct YouTube URLs are preserved.
- Nested YouTube thumbnail response shapes are normalized, and every result has a canonical thumbnail fallback generated from its exact video ID.
- YouTube Music song search remains a compatibility fallback only when universal search fails.

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
