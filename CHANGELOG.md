## 1.1.7.3 — Idle resume, fast playback and MV recovery

- Fixed YouTube playback failing after a track was paused or the application stayed in the background for several minutes.
- Added non-destructive engine health checks and automatic refresh of expired audio/video stream descriptors.
- Added a fast Innertube/yt-dlp descriptor race and staggered first-result prefetch to reduce cold track-start latency.
- Added audio and media proxy retries for expired or rejected signed URLs.
- Added MV artwork fallback, decoder recovery, compatibility retry and foreground-resume repair to prevent persistent black backgrounds while audio continues.
- Kept audio as the authoritative clock and retained the existing YouTube Video A/V watchdog.
- Enabled lyric delay and timeline-rate calibration for Spotify, YouTube Music, YouTube Video and local tracks.
- Updated package, display/build version, installer name, release notes, modification report and regression coverage to 1.1.7.3.

## 1.1.7.1 — YouTube Music restored as a separate source

### Source separation

- Restored YouTube Music as an independent music provider instead of treating every YouTube result as a normal video.
- Added separate search modes for Spotify, YouTube Music and YouTube Video, while the All tab keeps each source in its own section.
- The legacy `/api/qq/search` compatibility route now maps back to YouTube Music; normal YouTube videos use the dedicated `/api/youtube-video/search` route.
- YouTube Music recommendations remain on the YouTube Music song surface, while YouTube Video recommendations remain on the normal video surface.
- Preserved the YouTube Music/YouTube Video source type in queue items, playback descriptor caches, recent-listening history and restored Home playback.

### Lyrics and Playing MV isolation

- Restored the original YouTube Music lyric path for YouTube Music search and playlist tracks: exact music ID, music metadata, YouTube Music lyrics, LRCLIB matching and the established alignment pipeline.
- Normal YouTube Video results use exact-video captions or per-video alignment and do not overwrite the YouTube Music lyric behavior.
- Kept Playing MV as a muted visual background only. Enabling MV does not change the selected provider, search source, playlist identity or lyric source.
- Kept the original title/lyrics UI layer and removed the previously added duplicate MV text layer.

## 1.1.7 — 2026-07-22

### Instant transport response and parallel track preparation

- Stops the previous HTML-audio track on the same interaction frame instead of leaving it audible while a signed playback URL is being resolved.
- Starts Spotify shutdown, YouTube/local descriptor resolution and the per-track MV request in parallel, while still awaiting Spotify stop confirmation before the new audible source is allowed to start.
- Updates Play/Pause controls immediately and removes the artificial 420 ms pause fade and 460 ms play fade from normal transport actions.
- Starts the HTML media element and resumes Web Audio analysis concurrently so visual analysis can no longer delay audible playback.
- Added a short-lived renderer cache for raw MV descriptors and warms the hovered result, the first search results and the next queued track to reduce first-frame delay.
- Bounds speculative MV preloading to a small window to avoid launching many high-cost YouTube metadata processes or increasing idle resource use.

### Per-track MV wallpaper, single-audio provider switching and selectable quality

- Added an explicit provider-switch transaction that pauses and verifies Spotify before YouTube or local HTML-audio playback is allowed to start. In-flight Spotify start requests are invalidated, and delayed SDK state checks stop a stale request that completes after the user has already selected YouTube.
- Kept the Playing MV inside the existing background layer. The Three.js shelf, playlist carousel, lyrics, search, controls, panels and every established UI element retain their original stacking order, position, animation and pointer behavior above the per-track video wallpaper.
- Added Full HD, 2K and 4K Playing MV quality controls in Image Control. Full HD is the smooth default; 2K and 4K request 1440p and 2160p respectively, with the selected stream's actual resolution and frame rate shown in the MV status.
- Changed source selection to lock onto the highest real pixel dimensions available within the selected tier before comparing bitrate, codec or container. Lower tiers are used only when the upload does not expose the requested resolution.
- Added decoded-frame tracking and a stall watchdog. A paused decoder is resumed without a seek, a genuinely frozen decoder receives one clock correction, and a prolonged stream failure receives one controlled source refresh instead of remaining stuck.
- Reduced normal drift correction to a maximum ±0.4% and rate-limited it to avoid 50/60 FPS cadence judder. Hard correction now requires more than 1.45 seconds of drift and has a nine-second cooldown.

### MV frame pacing, seek smoothness and higher-detail source selection

- Removed forced background-video `currentTime` assignments from ordinary Play, Playing and Pause events. Resuming playback now continues from the already-buffered frame queue instead of flushing the decoder.
- Added a dedicated user-seek transaction: the MV pauses on the last decoded frame, receives exactly one seek after the primary audio seek completes, waits for `seeked`/`canplay`, and then resumes.
- Ignored duplicate seek confirmations emitted by the HTML audio event and the seek completion promise, preventing two Range requests for one pointer action.
- Reduced synchronization frequency and limited small corrections to an imperceptible ±0.4% playback-rate adjustment. Hard synchronization now requires more than 1.45 seconds of drift and has a nine-second cooldown.
- Paused the MV when the primary audio enters `waiting` or `stalled`, preventing video drift and the later correction hitch caused by audio buffering.
- Added backpressure handling and short local Range caching to the media proxy so high-bitrate frames are delivered steadily instead of in memory-pressure bursts.
- Raised High MV selection to 1440p and Ultra to 2160p where the source offers those formats; Balanced remains 1080p and Eco remains 720p.
- Increased bitrate weighting between equal-resolution formats and disabled the parent desktop-shell transform while Playing MV is active to avoid an additional full-window texture resample.

### MV sharpness and audio-output correction

- Corrected Playing MV layering so the video remains at the native wallpaper z-index instead of being raised above the Three.js shelf. The feature now changes only the background content and never hides, lowers or reorders existing UI/UX layers.
- Removed the fractional GPU scale transform from the Playing MV element and render it at exact viewport dimensions with `object-fit: cover`.
- Allowed 50/60 FPS 1080p formats in Balanced/High mode; the previous 30 FPS ceiling could force yt-dlp to choose a much lower-resolution rendition when a video only exposed 1080p at 60 FPS.
- Reasserted the existing audible HTML audio element after the muted MV decoder starts, preventing the master output or Web Audio gain from remaining at the fade-in silence floor.
- Kept the MV element permanently muted and at zero volume so only the established master player produces sound.

### Full-screen sharp MV and YouTube thumbnails

- Changed Playing MV from letterboxed `contain` rendering to edge-to-edge `cover` rendering so the video fills the complete app window.
- Removed the MV background opacity blend and dark overlay; decoded video frames are now displayed at full opacity with no CSS blur/filter layer.
- Changed video selection to prioritize the highest available resolution inside the selected ceiling before codec/container preference.
- Raised the optional MV quality floors to 720p for Eco and 1080p for Balanced/High, with 1440p for Ultra or large displays.
- Replaced the previous 480p compatibility retry with a same-resolution H.264/MP4 retry, preventing a successful retry from becoming visibly blurry.
- Repaired universal YouTube thumbnails by supporting nested thumbnail response shapes and adding a canonical `i.ytimg.com` fallback from the exact video ID.
- Prevented NetEase-specific image sizing parameters from being appended to YouTube thumbnail URLs.

### Raw video-only Playing MV

- Removed the YouTube iframe from the Playing MV rendering path.
- Playing MV now renders only the direct muted video stream inside the app-owned HTML5 video layer, so YouTube interface elements such as the logo, channel name, title, controls, annotations and end screens are not rendered.
- The video layer becomes visible only after Chromium emits a real `playing` event. Loading and error states remain a clean black stage and never fall back to a thumbnail or saved image.
- Kept the existing audible player as the single master clock for play, pause, seek, playback rate, track changes, lyrics and visualizer synchronization.
- Removed the hidden decode-probe player and iframe fallback to avoid duplicate video decoders and reduce CPU, GPU and memory overhead.
- Retained one compatibility refresh for expired or unsupported direct video streams without interrupting audible playback.

### Universal YouTube video search

- Changed the primary YouTube search from YouTube Music song-only results to universal video results.
- Added normalized support for ordinary uploads, music videos, gameplay, tutorials, podcasts, Shorts and public live videos.
- Preserved channel/author metadata, duration, thumbnails, exact video IDs and direct YouTube URLs in search results.
- Kept YouTube Music song search only as a fallback when universal video search is unavailable.

### Preserved behavior

- Spotify Playing MV backgrounds continue to use Spotify artist, album and artwork metadata rather than matching unrelated YouTube videos.
- Preserved the existing UI/UX, Liquid Glass, Three.js, GSAP, lyrics, visualizer, Discord Rich Presence, updater, rounded window, wallpaper library and current playback paths.

## 1.1.6.10

- Fixed the missing rounded-window renderer argument that left the visible shell square.
- Added manual update checking in Visual Console > Advanced.
- Added the app name and display version footer in Advanced settings.

# Changelog

## 1.1.6.10

- Fixed Spotify playlists showing a non-zero track count while opening with no rows.
- Added fallback to the playlist item page embedded in playlist metadata.
- Added clear reconnect guidance when playlist-read scopes are missing.
- Added Spotify context playback for saved playlists whose item list is restricted by Spotify.
- Preserved the updater, rounded window, playback, YouTube, wallpaper, lyrics and visual behavior from 1.1.6.8.

## 1.1.6.8 — 2026-07-21

- Reduced track-change latency by starting audio before optional beat-map disk reads and visual preparation.
- Starts queue-item prefetch on pointer hover/down, reuses recently resolved YouTube stream descriptors, and starts next-track prefetch earlier.
- Removed the redundant Spotify metadata request when the queue item already contains the exact Track ID and URI.
- Accepts the first exact Spotify SDK playing state while preserving wrong-track protection.
- Made Spotify seek optimistic after the SDK accepts the command and moved confirmation to background clock reconciliation.
- Dispatches HTMLAudio Range seeks before resetting secondary visual cursors.
- Preserved audio quality, provider behavior, window handling, UI/UX, effects, lyrics, wallpaper, and CPU optimizations.

## 1.1.6.6 — 2026-07-21

- Fixed four black square corners in windowed mode by using native frameless-window rounding instead of clipping a second 34 px renderer shell.
- Kept the opaque startup-compatible main window and all playback/UI behavior unchanged.
- Removed generated root-level TXT reports and historical standalone release files from the source package.
- Fixed Spotify playlists rendering blank titles and `Unknown artist`.
- Repaired missing Spotify Track IDs before playlist playback.
- Added compatibility with sparse 2026 playlist item responses.


## 1.1.6.5 — 2026-07-20

- Added a verified yt-dlp preparation step to Windows release builds so the installer can include the YouTube engine.
- Added automatic cached-engine validation, atomic restoration from the packaged copy, checksum verification, and three-attempt download recovery.
- Added an internal repair endpoint and one automatic playback retry while keeping the selected track in place.
- Uses packaged Castlabs Electron as yt-dlp's Node-compatible JavaScript runtime, avoiding a separate Node.js installation for end users.
- Replaced Terminal-oriented error instructions with automatic repair progress and a simple Windows Security fallback message.
- Preserved the 1.1.6.4 window, Spotify, CPU optimization, UI/UX, renderer, effects, lyrics, and wallpaper behavior.

## 1.1.6.4 — 2026-07-20

- Added a small CPU-only optimization pass without changing window, playback, audio analysis, rendering quality, GPU behavior, timers, or background lifecycle.
- Coalesced bottom-control pointer hit testing to one layout read per display frame on high-polling-rate mice.
- Reused a single cursor auto-hide timer instead of clearing and recreating it for every pointer event.
- Removed the duplicate mousemove cursor-activity hook because Electron Chromium already emits pointermove for mouse input.
- Added a fast event-target path for UI pointer detection while retaining the original hit-test fallback.
- Reduced runtime cache-pressure checks from every rendered frame to once every four seconds; cache thresholds and cleanup behavior are unchanged.
- Preserved all 1.1.6.3 wallpaper-library tuning and all established window/playback behavior.

## 1.1.6.3 — 2026-07-20

### Conservative optimization

- Returned to the 1.1.6.1 window, playback, realtime-analysis, background-timer, and renderer behavior.
- Applied only modest wallpaper-folder tuning: concurrency 12, 30 initial cards, 20-card idle batches, and a 220 px lazy-preview margin.
- Preserved wallpaper file details and full image/video preview quality.
- No changes to playback, Spotify/YouTube provider behavior, GPU configuration, Three.js, GSAP, Liquid Glass, animation, or UI/UX.

## 1.1.6.1 — 2026-07-20

### Performance and memory

- Removed redundant Desktop Lyrics and wallpaper IPC checks from the per-frame Three.js render loop; overlay synchronization continues on its existing 320 ms timer.
- Coalesced Home Liquid Glass pointer tracking and wallpaper-library pointer highlights to one update per display frame, avoiding repeated layout reads on high-polling-rate mice.
- Added heap-pressure cache trimming for cover, depth, and beat-map caches without changing rendered quality or removing active assets.
- Cached frequently accessed renderer elements and added layout/paint containment to media cards so card updates do not invalidate unrelated UI.

### Wallpaper folder library

- Stopped recursively scanning the saved wallpaper folder during application startup.
- Added a persisted metadata cache for up to six recent wallpaper folders.
- Parallelized file metadata reads with bounded concurrency while retaining the existing 600-file and depth safety limits.
- Renders cards progressively in idle batches instead of creating the entire gallery in one blocking operation.
- Loads image previews only near the visible viewport and opens video metadata only while the user hovers a video card.
- Releases decoded previews and card DOM after the library closes while preserving the selected folder and media metadata.
- Manual **Refresh** performs a full rescan, while normal library opening uses cached metadata immediately when available.

### Preserved

- No reduction to image quality, video quality, Three.js resolution profile, animation behavior, Liquid Glass effects, lyrics, provider playback, or startup compatibility.

## 1.1.6 — 2026-07-20

### Fixed

- Liked videos and Uploads now display their official total item counts in the YouTube playlist list.
- System-playlist counts are read from official playlist metadata, with `playlistItems.pageInfo.totalResults` as the fallback for playlists that YouTube omits from `playlists.list`.
- The application now creates and shows an opaque native Windows window immediately instead of waiting behind a hidden `ready-to-show` window.
- Castlabs/Widevine preparation runs in parallel and no longer delays the first visible window for up to 60 seconds.
- Removed forced D3D11, forced high-performance GPU selection, and GPU-blocklist bypass flags; Chromium now chooses the hardware backend supported by each machine while hardware acceleration remains enabled.
- Added recovery for off-screen bounds, main-frame load failures, and renderer-process exits without globally disabling the GPU.

### Preserved

- Existing 1.1.5.4 UI/UX, Three.js, GSAP, lyrics, Liquid Glass, playback providers, local libraries, Discord integration, and visual settings.

## 1.1.5.4 — 2026-07-17

### Adjustable Liquid Glass transparency

- Added a **Liquid Glass transparency** slider to **Visual Console → Interface**.
- The control updates Home surfaces, the Visual Console, search/playlist panels, popovers, modal surfaces, player glass, media-library cards, and common glass buttons without fading their text or icons.
- Moving the slider right makes glass surfaces clearer; moving it left strengthens their dark glass fill while preserving blur, borders, reflections, and accent highlights.
- The chosen level is saved with the existing visual settings and restored after application restart.
- User visual archives now preserve the Liquid Glass transparency value.
- Added dedicated regression coverage for the control, persistence, archive support, CSS variables, Home lock integration, and release metadata.

## 1.1.5.3 — 2026-07-17

### Fixed

- Registered the local background-media protocol with Electron streaming support.
- Added HTTP byte-range handling (`206 Partial Content`) for MP4, WebM, MOV, and M4V background playback.
- Added correct `Content-Type`, `Content-Length`, `Content-Range`, and `Accept-Ranges` response headers.
- Prevented the black background layer from appearing before the selected video has decoded its first frame.
- Added visible codec/playback feedback when a selected local video cannot be decoded.
- Preserved folder selection, image backgrounds, Liquid Glass UI, stage-text modes, providers, lyrics, and visual effects.

## 1.1.5.2 — 2026-07-17

### Three-mode stage text selector

- Replaced the single Lyrics on/off action under the progress bar with a Liquid Glass three-option menu.
- Added **Track title** mode, which renders only the current song name on the existing 3D lyric stage and never displays lyric lines.
- Preserved the existing synchronized **Lyrics** mode without changing its timing, karaoke fill, glow, camera binding, or particles.
- Added **Show nothing** mode, which clears the title, lyrics, outgoing text meshes, and lyric star-river glow.
- The selected mode is stored locally and restored after application restart.
- The `L` keyboard shortcut now cycles through Lyrics → Track title → Show nothing.
- Immersive mode temporarily uses synchronized lyrics and restores the exact previous stage-text mode on exit.

### Validation

- Added `stage-text-mode-regression.test.js` covering the three menu options, persisted state, title rendering path, complete hidden state, keyboard cycle, Liquid Glass menu, and immersive-mode restoration.
- Re-ran the complete regression suite for UI, packaging, playback, providers, lyrics, YouTube, Spotify, Discord, Castlabs, local libraries, and background media.

## 1.1.5.1 — 2026-07-17

### Folder-backed background media library

- Replaced the single background file picker with a native folder picker in the desktop application.
- Added recursive scanning for supported images and videos, with a 600-item safety limit and automatic reload after restart.
- Added a transparent Liquid Glass media gallery with live pointer highlights, image thumbnails, video hover previews, search, and Image/Video filters.
- Clicking a media card immediately applies it as the image or looping video background.
- Added a private `shinayuu-media://` protocol so large local videos stream directly from their original folder instead of being copied into IndexedDB or embedded as base64.
- Added a browser fallback using a directory file input when the desktop IPC bridge is unavailable.
- Preserved the existing Home Liquid Glass, visualizer, Three.js/GSAP effects, Spotify, YouTube, lyrics, Discord, and local music library behavior.

### Validation

- Added `background-media-library-regression.test.js`.
- Re-ran the complete regression suite for UI, packaging, playback, providers, lyrics, YouTube, Spotify, Discord, Castlabs, and local libraries.

## 1.1.5 — 2026-07-17

### Stable promotion

- Promoted the complete `1.1.4.6` update source to official stable release `1.1.5`.
- Preserved the transparent Liquid Glass Home, including protection from the legacy late-loading gray overlay.
- Preserved system-browser YouTube OAuth using Authorization Code, PKCE, and a loopback callback.
- Preserved supported YouTube Data API playlist synchronization, Liked videos, Uploads, local libraries, playback prefetch, Spotify recovery, lyrics, Discord Rich Presence, and Castlabs Electron behavior.
- Updated package metadata, package-lock metadata, display version, Windows build version, installer artifact naming, User-Agent, tests, build helpers, and release documentation.
- Added `RELEASE_1.1.5.md` and moved the supported stable release pointer to 1.1.5.

### YouTube maintainer configuration

- The public build uses one Google Desktop OAuth Client ID and its matching Client Secret supplied by the application maintainer.
- End users continue to sign in with their own Google accounts and do not configure application credentials.

## 1.1.4.6 — Secure YouTube Desktop OAuth

- Removed Google account sign-in from the embedded Electron window after Google rejected the embedded user-agent.
- The primary **Connect YouTube** action now opens the operating system default browser.
- Uses OAuth 2.0 Authorization Code with PKCE and the supported desktop loopback callback.
- Ignores legacy TV/device tokens and embedded-cookie sessions for account playlist synchronization.
- Synchronizes playlists owned by the authorized account through YouTube Data API v3.
- Adds Liked videos and Uploads when those related playlists are exposed by the authenticated channel.
- Allows the app maintainer to bundle one Desktop OAuth Client ID in `package.json`, while keeping the in-app Advanced field for development builds.
- Preserves the existing persistent transparent Home Liquid Glass behavior.

### Validation

- Added regression checks ensuring YouTube authorization is opened through `shell.openExternal` rather than a BrowserWindow.
- Re-ran the complete playback, lyrics, Spotify, YouTube, local-library, UI, Discord, Castlabs, and packaging regression suite.

> The official YouTube Data API lists playlists owned by the authorized account. It does not provide a supported endpoint for every playlist merely saved from another channel.

## 1.1.4.4 — Reliable YouTube Sync and Persistent Clear Glass

### YouTube account playlist synchronization

- Reworked quick-login playlist discovery to merge signed-in YouTube playlist aggregation, YouTube Library, YouTube Music Library, raw Innertube browse responses, and the authenticated Data API path when its token scope permits it.
- Added current LockupView, renderer-context, continuation, saved-playlist, liked-video, watch-later, uploads, and multi-page handling with playlist ID de-duplication.
- Added a direct authenticated playlist-track fallback before the existing parsed YouTube and YouTube Music loaders.
- Stopped treating HTTP/provider errors as successful empty lists. The renderer now preserves the actual synchronization failure and backend source diagnostics.
- Isolated YouTube failures from Spotify and local-library results so one provider cannot clear the other playlist sections.

### Persistent transparent Home glass

- Removed the delayed gray panel fill from the Home-only surfaces instead of relying on a single early CSS override.
- Added a final transparent material lock for Home hero, recommendation cards, playlist tiles, mosaic cells, and Discord Home surfaces, including runtime glass capability classes and pseudo-elements.
- Added a Home-scoped mutation guard that reapplies transparent inline priorities after late rendering, class changes, style changes, or account-card refreshes.
- Preserved pointer refraction, borders, highlights, depth, saturation, and readable text without restoring an opaque gray layer.

### Validation

- Added regression fixtures for raw playlist parsing, sync diagnostics, non-OK response handling, delayed runtime glass overrides, and persistent transparent material enforcement.
- Re-ran the complete playback, lyrics, Spotify, YouTube, local-library, UI, Discord, Castlabs, and packaging regression suite.

> This is a patch build based on stable version `1.1.4`. It intentionally does not include a `RELEASE_1.1.4.4.md` file.

## 1.1.4.3 — Liquid Glass and YouTube Quick Login

### Near-transparent Home liquid glass

- Refined the existing Home layout into a much more transparent liquid-glass surface while preserving the current wallpaper, Three.js scene, GSAP transitions, card positions, and interaction flow.
- Added pointer-responsive refraction highlights, localized light movement, subtle panel tilt, saturation, blur, and reduced-motion fallbacks.
- Kept text and controls readable without returning to opaque card backgrounds.

### Easier YouTube account connection

- Added a primary one-button YouTube sign-in flow that displays a verification link and device code directly in the app, so normal users do not have to enter a Google OAuth Client ID.
- Added persistent authenticated YouTube account sessions and synchronized account playlists/tracks under **My Playlists**.
- Kept the existing Google OAuth PKCE Client ID flow as an optional advanced fallback for custom deployments.
- Preserved anonymous YouTube search and playback when no account is connected.

### Validation

- Added and updated regression coverage for the new liquid-glass material, quick YouTube login, advanced OAuth fallback, playlist synchronization, and packaging metadata.
- Re-ran the complete project regression suite across playback, lyrics, Spotify, YouTube, local libraries, UI, Discord, Castlabs, and Windows packaging.

> This is a patch build based on stable version `1.1.4`. It intentionally does not include a `RELEASE_1.1.4.3.md` file.

## 1.1.4.1 — Patch Build

### Home interface

- Added a pointer-responsive liquid-glass material to the existing home hero, recommendation cards, and playlist tiles without replacing the established layout or visual effects.
- Preserved wallpaper visibility, card readability, hover depth, and reduced-motion compatibility.

### YouTube account playlists

- Added Google OAuth PKCE login for a YouTube account using the read-only YouTube scope.
- Added synchronized YouTube account playlists and playlist tracks to **My Playlists** while retaining the existing anonymous YouTube search and playback engine.
- Added local token persistence, refresh-token handling, logout, and provider configuration UI.

### Local music library

- Added persistent watched-folder libraries and ZIP/RAR/7Z archive libraries.
- Added automatic folder/archive rescanning, embedded metadata and artwork reading, local Range playback, and source removal.
- Added `.yrc`, `.lrc`, and `.txt` sidecar lyric support plus the existing metadata-based online lyric fallback for local tracks.
- Restores local sources and playlists after application restart.

### Playback transitions

- Added playback descriptor caching and next-track prefetch for Spotify and YouTube.
- Keeps the current audio source playing until the next source descriptor is ready, reducing the previous multi-second silent handoff.
- Added automatic prefetch after manual selection, skip, queue playback, and track start.
- Deferred expensive Spotify-to-YouTube lyric discovery until Spotify and LRCLIB have no usable lyric text, preventing lyric lookup from delaying normal transitions.

> This is a patch build based on stable version `1.1.4`. It intentionally does not include a `RELEASE_1.1.4.1.md` file.

## 1.1.4 — 2026-07-15

### Stable promotion

- Promoted the complete `1.1.3.10` patch state to stable release `1.1.4`.
- Updated package metadata, display version, Windows build version, installer naming, User-Agent, tests, build helpers, and release documentation.
- Added `RELEASE_1.1.4.md` and updated the supported stable release line.

### Castlabs and Spotify

- Preserved Castlabs Electron for Content Security `42.5.2+wvcus` and the existing same-renderer Spotify Web Playback SDK architecture.
- Preserved market-relinked track handling, authoritative SDK metadata, seek recovery, independent progress updates, and transient paused-state recovery.
- Preserved the full Spotify lyric fallback chain and retry behavior from patch `1.1.3.10`.

### Production build pipeline

- Added an official two-stage Windows release build that packages `win-unpacked`, applies and verifies EVS production VMP signing, and builds NSIS from the signed prepackaged directory.
- Added explicit development-only unsigned installer support.
- Added SHA-256 generation for the final setup file.
- Added detailed English documentation for EVS setup, runtime testing, production signing, optional Authenticode signing, NSIS packaging, and release smoke testing.

## 1.1.3.10 - Spotify Seek Clock and Lyrics Recovery Patch

- Fixed Spotify progress freezing after seeking by clearing stale drag previews and restarting the SDK/UI clocks.
- Preserves the pre-seek play state when Spotify temporarily reports `paused=true` after a successful seek.
- Accepts market-relinked Spotify track IDs during seek confirmation instead of requiring strict URI equality.
- Added a dedicated 100 ms Spotify progress UI clock so the player bar remains responsive even when other UI work is delayed.
- Added recovery reads after seek timeout and prevents stale SDK snapshots from pulling the progress bar back or stopping its clock.
- Expanded Spotify-to-YouTube lyrics matching with normalized title/artist variants, album/ISRC queries, captions, YouTube Music text, and local alignment.
- Made LRCLIB failures non-fatal and added controlled lyrics retries after the live Spotify SDK confirms the actual/relinked track metadata.
- Preserved the existing UI, UX, effects, Castlabs runtime, lyrics renderer, and installer assets.
- Kept 1.1.3 as the latest stable release; no patch-specific release document was added.
## 1.1.3.8 - Castlabs Rebuild

- Rebuilt directly from the preserved 1.1.3.3 source baseline.
- Replaced stock Electron and the separate hidden WebView2 Spotify host with Castlabs Electron for Content Security.
- Kept the original 1.1.3.3 UI, UX, effects, lyrics layout, visualizer, provider logic, and file structure.
- Added a local Castlabs package wrapper and deterministic runtime setup/verification scripts for Windows.
- Removed the WebView2 runtime dependency and installer bootstrapper.
- Kept 1.1.3 as the latest stable release; no patch-specific release document was added.
## 1.1.3.8 - Castlabs Electron Patch

- Replaced stock Electron plus the separate hidden WebView2 Spotify host with Castlabs Electron for Content Security.
- Added Castlabs `components.whenReady()` startup provisioning and runtime diagnostics.
- Moved Spotify Web Playback SDK playback into the same renderer as the existing ShinaYuu Music UI.
- Removed the WebView2 dependency, hidden host runtime, WebView2 reset helper, and NSIS WebView2 bootstrapper.
- Configured `electron-builder` to package the installed Castlabs distribution through `electronDist`.
- Preserved the existing UI, UX, visual effects, lyrics providers, Desktop Lyrics, YouTube playback, Discord integration, and master volume behavior.
- Kept 1.1.3 as the latest stable release; no patch-specific release document was added.

## 1.1.3.3 - Patch

- Added YouTube subtitle lyrics support for JSON3, TTML, SRV3, and WebVTT tracks exposed by the existing `yt-dlp` engine.
- Preserved Spotify lyrics, YouTube Music lyrics, LRCLIB, plain lyrics, and local forced alignment as independent fallback sources.
- Removed non-lyric caption cues such as `[Music]`, `[Applause]`, and symbol-only rows.
- Rejects low-content caption tracks so poor subtitles do not override better lyric sources.
- Preserved the consolidated lyric calibration panel, expanded timing ranges, localization pass, Windows audio-session bridge, UI, UX, Desktop Lyrics, and visual effects from the source baseline.
- Kept 1.1.3 as the latest stable release; no separate patch release document was added.


All notable changes to ShinaYuu Music are documented in this file.

## 1.1.3.2 — 2026-07-13 (Patch Build)

- Fixed Spotify lyrics being discarded when Spotify returns `UNSYNCED` text.
- Uses the exact Spotify track ID reported by the live Web Playback SDK.
- Tries market-relinked and original Spotify track IDs before falling back.
- Added a WebView2-session lyrics retry path when the Node request receives an authentication, authorization, or catalog response.
- Added explicit diagnostics for Spotify lyrics HTTP failures.
- Preserved LRCLIB fallback when Spotify's private lyrics service is unavailable.
- Kept the stable release document at `RELEASE_1.1.3.md`; no patch-specific release file was added.

## 1.1.3.1 — 2026-07-13 (Patch Build)

### Fixed

- Escaped the PowerShell `$ProgressPreference` variable in the NSIS include script so `makensis` no longer reports warning 6000 and aborts the installer build.
- Updated the patch display version, Windows build version, installer artifact name, build helper scripts, and regression tests.
- Added a regression check that rejects an unescaped PowerShell dollar sign in `build/installer.nsh`.

> This is a patch build based on stable version 1.1.3. It intentionally does not include a `RELEASE_1.1.3.1.md` file.

## 1.1.3 — 2026-07-13

### YouTube lyrics

- Added lyrics retrieval from the YouTube Music lyrics tab.
- Kept YouTube caption timing as the first exact-video timing source.
- Added LRCLIB fallback when native YouTube sources are unavailable.
- Added local forced alignment for plain lyrics when word timing is missing.
- Preserved the existing lyrics UI, Desktop Lyrics, 3D layout, and visual effects.

### Master volume

- Added a unified master volume path for YouTube and Spotify playback.
- Added a local control endpoint between the Electron renderer and the hidden Spotify WebView2 host.
- Applied Spotify volume through `Spotify.Player#setVolume()` instead of relying only on the Spotify Connect volume endpoint.
- Restored the saved volume before Spotify playback starts and synchronized mute state.

### WebView2 deployment

- Added NSIS detection for Microsoft Edge WebView2 Runtime.
- Added automatic Evergreen Bootstrapper installation when the Runtime is missing.
- Kept application installation available when WebView2 installation fails, with a clear installer warning.

### Release and documentation

- Promoted patch line `1.1.2.4` to stable release `1.1.3`.
- Updated package metadata, Windows build metadata, installer naming, User-Agent strings, tests, and build scripts.
- Standardized project Markdown documentation in English.
- Added the stable release document `RELEASE_1.1.3.md`.

## 1.1.2 — 2026-07-12

- Added Spotify-native lyric timing and LRCLIB timing correction.
- Added per-track lyric offset and timeline adjustment for non-native sources.
- Added lyric visual pre-roll so transitions finish at the vocal timestamp.
- Reworked Discord IPC connection, error reporting, and configuration UI.
- Fixed NSIS installation-directory validation.

## 1.1.1 — Baseline

- Rebranded Mineradio as ShinaYuu Music.
- Restored Electron as the main window and added a hidden Spotify WebView2 host.
- Added Spotify Web Playback SDK, YouTube playback through `yt-dlp`, mixed-provider search, and queue handling.
- Added fullscreen, Visual Effects, Desktop Lyrics, real-time beat analysis, and Discord Rich Presence.


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
