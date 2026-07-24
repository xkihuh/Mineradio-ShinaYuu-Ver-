# Modification Report — ShinaYuu Music 1.1.7.3

## Requested fixes

- Recover YouTube audio and MV playback after long pause/background periods on Windows 10 gaming systems without requiring an application restart.
- Reduce the cold delay between selecting a result and hearing/seeing playback.
- Prevent the MV from disappearing or remaining black while audio continues.
- Allow lyric delay and timeline calibration on every playback source.

## Implemented changes

- Classifies expired stream URLs, HTTP failures, timeouts and network interruptions as transient stream failures instead of engine-installation failures.
- Performs a non-destructive engine health check and only rebuilds the bundled engine for genuine missing, blocked or invalid executable errors.
- Prefetches fresh YouTube audio/MV descriptors during extended pause and restores the media elements at the saved playback position on resume.
- Races Innertube with a delayed yt-dlp request for faster first usable descriptors, while retaining yt-dlp and H.264/MP4 compatibility fallbacks.
- Retries audio and video proxy requests once with a refreshed descriptor when signed URLs expire.
- Keeps artwork behind the MV until decoded frames are ready and repairs the decoder after background suspension or repeated stalls.
- Extends per-track lyric delay and timeline-rate controls to exact Spotify, YouTube Music, YouTube Video and local timing sources.
- Added regression coverage for idle resume, stream refresh, black-video fallback, compatibility recovery and universal lyric calibration.

## Preserved systems

- Separate Spotify, YouTube Music and YouTube Video sources
- Original lyrics/title UI and visual layout
- Castlabs Electron/Widevine runtime
- Three.js, GSAP, visualizer and playlist shelf
- MV display modes and A/V synchronization watchdog
- Discord Rich Presence, updater and Windows installer pipeline

## Restored architecture

- Spotify remains the Spotify music source.
- YouTube Music is restored as the dedicated YouTube music source used by music search, music recommendations, music metadata and the original YouTube Music lyric pipeline.
- YouTube Video is a separate source used only when the user selects normal YouTube video search/results.
- Playing MV is a visual-only muted stream tied to the selected item; it does not redefine the playback provider or lyric provider.

## Persistence and queue correctness

- Queue recommendations inherit the source of the seed track: Music stays Music, Video stays Video.
- Playback prefetch and descriptor keys include the YouTube source type.
- Listening-history snapshots preserve the source type so reopening a normal video does not silently convert it into a YouTube Music item, and vice versa.

# Modification Report — ShinaYuu Music 1.1.7

## Requested behavior

- Show the actual frames of the selected YouTube video as the now-playing background.
- Do not render YouTube interface components such as the logo, channel name, title, controls or overlays.
- Allow the YouTube section to return all public video categories instead of music-only results.
- Preserve the current UI/UX, effects, audio, lyrics, visualizer and provider behavior while reducing unnecessary resource use.
- Never leave Spotify audible when the user changes to YouTube or a local item.
- Keep the selected title/lyrics mode visible above the raw MV.
- Provide explicit Full HD, 2K and 4K MV quality choices and recover a decoder that freezes after transport controls.
- Make track selection, Play and Pause react immediately while media/provider preparation continues in parallel.

## Implementation

### Instant transport and bounded prefetch

- Moves the previous HTML-audio pause to the beginning of the track-selection transaction, before any network descriptor is awaited.
- Starts the provider-stop promise, the next audio descriptor and the per-track MV descriptor concurrently. The new audible source still waits for provider-stop confirmation, preserving the single-audio guarantee.
- Play updates its icon immediately, invokes `HTMLMediaElement.play()` before waiting on secondary analysis setup, and resumes Web Audio in parallel.
- Pause invokes the media pause operation immediately and keeps the master gain ready for the next resume rather than waiting for a long fade timer.
- Adds a six-minute in-renderer MV descriptor cache backed by the existing server-side YouTube descriptor cache.
- Warms audio and MV metadata for hovered/pointer-down results and the next queued item. Automatic speculative warming is limited to a small number of results and does not decode hidden videos.
- Spotify transport buttons update the requested state and MV immediately while the SDK command is confirmed, with rollback when the command fails.


### Single-audio provider arbitration

- Added a provider-switch transaction that invalidates the current Spotify start token before any non-Spotify track begins.
- Pauses Spotify with a forced SDK/remote-host command before changing the active transport flag; this corrects the previous ordering where clearing the active flag could make the pause hook return without stopping playback.
- Verifies the Spotify SDK state after pausing and performs delayed checks for an in-flight Spotify start request that may complete after the user has selected YouTube.
- YouTube and local playback therefore start only after the previous Spotify transport has been stopped, while the visual MV decoder remains muted.

### Per-track wallpaper layering

- Kept the exact selected YouTube video as a per-track wallpaper inside the app's existing background container.
- Preserved the existing title/lyrics behavior and timeline while leaving every established UI element in its original layout and stacking context.
- Removed MV-specific z-index overrides. The Three.js playlist shelf, playlist scrolling, search, bottom controls, panels, title/lyrics and visualizer now keep their original order, position, animation and pointer behavior above the video wallpaper.

### Explicit quality tiers and measured stream selection

- Added Full HD, 2K and 4K controls to Image Control and persisted the selected setting. Full HD is the smooth default.
- Full HD requests 1080p, 2K requests 1440p and 4K requests 2160p. A lower tier is accepted only when the upload does not provide the requested dimensions.
- Filters out dimensionless candidates when dimensioned streams are available, locks selection to the highest real resolution inside the tier, then compares bitrate and codec.
- Displays the selected stream's actual resolution and frame rate in the MV status so source limitations are visible.

### Raw video-only background

- Removed the YouTube iframe and all iframe-player state handling from the Playing MV path.
- Kept one app-owned muted HTML5 `<video>` element as the only visual decoder.
- The element receives a direct video stream resolved from the exact selected YouTube video ID through the existing media resolver/proxy.
- The element is revealed only after its `playing` event confirms that decoded video frames are advancing.
- Saved backgrounds, artwork and YouTube thumbnails are disabled while Playing MV is active. Loading and unrecoverable error states therefore remain black rather than appearing to succeed with a static image.
- Added one compatibility refresh for expired URLs or unsupported formats.
- Switched the MV element from `object-fit: contain` to `object-fit: cover` so it fills the full application viewport.
- Forced full-opacity decoded frames and disabled the blurred artwork layer and dark overlay while a YouTube MV is active.
- Reworked stream ranking so resolution is the primary factor; codec and container preference are used only after the best usable resolution is selected.
- Compatibility recovery now keeps the requested resolution ceiling and changes only to H.264/MP4 instead of forcing the old low-resolution Eco stream.
- Kept the MV at the native background z-index and stopped hiding the Three.js/idle canvases, so enabling the feature changes only the wallpaper content instead of changing the established UI/UX scene.
- Removed the fractional scale transform from the MV element and use exact viewport dimensions to avoid an unnecessary texture resample.
- Permitted 50/60 FPS formats in Balanced, High and Ultra modes so a 1080p60-only rendition is not incorrectly replaced by a 360p/480p 30 FPS stream.

### Smooth playback and seek transaction

- Removed the old forced seek on every Play, Playing and Pause event.
- Added separate `beginNowPlayingBackgroundSeek` and `completeNowPlayingBackgroundSeek` phases.
- Keeps the last decoded MV frame on screen while the primary audio Range seek is committed.
- Applies one exact `currentTime` change to the MV, ignores the duplicate completion callback, and waits for a decoded target frame before resuming.
- Runs normal clock checks at a reduced cadence and corrects small drift within a maximum ±0.4% playback-rate window, rate-limited to avoid visible frame-cadence changes.
- Allows a hard correction only for drift above 1.45 seconds with a nine-second cooldown.
- Mirrors primary-audio `waiting` and `stalled` states by pausing the MV rather than letting it run ahead.
- Tracks decoded frame progression through `requestVideoFrameCallback` and detects a decoder that remains frozen after Play, Pause, seek or other controls.
- Recovery first resumes the decoder without flushing buffered frames, then applies one timeline correction if necessary, and performs one controlled source refresh only after a prolonged stall.
- Extends the post-seek decode window so high-resolution 2K/4K streams are not prematurely restarted while Chromium is still decoding the target keyframe.
- Added proxy backpressure handling and short Range caching for stable high-bitrate delivery.
- High and Ultra source ceilings are now 1440p and 2160p respectively, with bitrate used to choose the sharper rendition at equal dimensions.

### Synchronization

- The existing audible player remains the single master clock.
- The visual stream mirrors play, pause, seek, playback rate, track changes and window visibility.
- Small drift is corrected gradually; larger drift is corrected by seeking to the authoritative audio timeline.
- Lyrics and visualizer timing continue to follow the existing audio path.
- The muted visual decoder explicitly remains at zero volume. After it starts, the renderer reasserts the existing HTML audio element and master Web Audio gain so the second decoder cannot leave audible output at the fade-in silence floor.

### Universal YouTube search

- Changed the primary provider request from YouTube Music `song` search to universal YouTube `video` search.
- Added normalized mapping for normal videos, Shorts and public live results.
- Preserved exact video IDs, channel/author data, duration, thumbnail resolution, content type and direct YouTube URLs.
- Retained YouTube Music search as a fallback for compatibility.
- Added recursive thumbnail extraction for current YouTube response models and an `i.ytimg.com/vi/<videoId>/hqdefault.jpg` fallback when metadata omits artwork.
- Kept YouTube thumbnail URLs unchanged instead of appending provider-specific `param=WxH` query strings.

### Optimization

- Removed the iframe decoder and the hidden stream-probe decoder.
- Uses only one muted visual decoder in addition to the existing audible player.
- Pauses synchronization and video decoding while the application is hidden.
- Releases the video source when Playing MV is disabled, the provider changes or the track is replaced.

## Preserved systems

- Electron/Castlabs desktop architecture
- Existing UI/UX and Image Control layout
- Liquid Glass, Three.js and GSAP effects
- Spotify and YouTube audio playback
- Synchronized lyrics and visualizer
- Spotify artwork backgrounds
- Local library and wallpaper gallery
- Discord Rich Presence, updater and rounded-window behavior

## Validation scope

- JavaScript syntax validation for renderer, main process, server and provider code
- Regression tests for raw-video-only background behavior
- Regression tests for player state and timeline synchronization
- Regression tests for Spotify-to-YouTube single-audio provider switching
- Regression tests for the DOM title/lyrics overlay, selectable Full HD/2K/4K tiers and stalled-frame recovery
- Regression tests for universal YouTube result mapping
- Existing project tests excluding the local archive test when its optional `node-7z` dependency is absent from the supplied source package


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
