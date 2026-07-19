# ShinaYuu Music 1.1.5.7

ShinaYuu Music 1.1.5.5 is a playback and visual-experience patch built directly from the complete 1.1.5.4 source. It does not restructure the existing interface or replace the Electron/Castlabs architecture.

## YouTube account library

- Liked videos and Uploads retain their special playlist IDs from the authorized channel.
- The application requests one playlist item with `pageInfo.totalResults` to obtain the real total without downloading the full playlist.
- The card also uses the first available system-playlist thumbnail.
- A failed count request is isolated and does not prevent owned playlists or the remaining library from rendering.

## Playback recovery

- YouTube HTML-audio errors, expired signed URLs, and prolonged stalls invalidate the cached descriptor, obtain a new stream, and resume near the previous timestamp.
- Recovery is capped at two stream refreshes and keeps the existing compatible-quality fallback.
- `yt-dlp` HTTP and fragment retries were increased to four.
- Spotify exact-track startup now makes four bounded confirmation attempts, reactivates SDK audio, reapplies volume, and performs a non-playing device transfer on later attempts.
- One descriptor/device recovery is allowed for temporary Spotify SDK, device, network, timeout, rate-limit, or service errors.
- Spotify metadata refresh uses the authorized account market before the configured fallback market.

These changes improve temporary failures but cannot make media play when the upstream provider removes it, blocks it by region/account, restricts embedding, or returns no playable stream.

## Player visualizer

- Added a canvas visualizer above the progress bar.
- Styles: Bars, Wave, Mirror, Dots, Ribbon.
- Colors: custom solid, Rainbow, RGB flow, interface accent, cover tint.
- Controls: width, height, X/Y position, angle, opacity, sensitivity, smoothing, glow, and beat boost.
- Settings live in a dedicated Visualizer tab and persist in normal settings and user visual archives.
- The visualizer uses the existing FFT and beat pipeline, including Spotify realtime analysis when available.

## Smart stage text

- Added Smart lyrics/title as a fourth mode.
- Active timed lyrics render normally.
- Instrumental and sufficiently long lyric gaps show the current track title.
- Shortcut cycle: Lyrics → Smart → Title → Hidden.

## Startup compatibility correction

This correction remains version 1.1.5.5. It addresses cases where ShinaYuu Music remained visible in Task Manager but no main window appeared, especially on managed gaming-cafe PCs, legacy drivers, software compositing, or restricted GPU environments.

- The main window is revealed from multiple bounded paths rather than relying only on `ready-to-show`.
- Early renderer or GPU startup failures automatically relaunch once with `--safe-graphics`.
- Safe Graphics disables hardware acceleration before `app.whenReady()` and creates an opaque main window while preserving the internal Liquid Glass UI.
- Chromium's aggressive D3D11, blocklist-bypass, and forced-high-performance switches are no longer enabled by default.
- Windows that are outside all connected displays are recentered automatically.
- A delayed startup/recovery window provides a visible compatibility action instead of leaving only a background process.
- Startup diagnostics are stored in the user-data `logs/startup.log` file.

## Bilingual interface standardization

The recently added Visualizer and Smart Lyrics controls now use one consistent Vietnamese terminology set and one complete English terminology set. Language switching updates headings, buttons, slider labels, descriptions, color controls, mode descriptions, tooltips, and status messages.

## Expanded player visualizer

- The visualizer is positioned completely above the Liquid Glass player frame.
- Existing styles: Bars, Wave, Mirror, Dots, and Ribbon.
- New styles: Steps, Pulse, Needles, and Orbits.
- New persistent controls: element width, amplitude length, and element spacing.
- Existing frame width/height, position, angle, opacity, sensitivity, smoothing, glow, beat response, and color modes remain available.

## Preserved fixes

- Safe Graphics and invisible-window startup recovery.
- YouTube Liked videos/Uploads counts.
- Spotify and YouTube bounded playback recovery.
- Smart Lyrics and title mode.
- Liquid Glass transparency and folder-backed image/video backgrounds.

## Version

- Package: `1.1.5-patch.6`
- Display/build: `1.1.5.6`
- Installer: `dist\ShinaYuu-Music-1.1.5.6-Setup.exe`
