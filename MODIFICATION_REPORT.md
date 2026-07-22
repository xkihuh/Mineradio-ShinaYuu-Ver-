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
