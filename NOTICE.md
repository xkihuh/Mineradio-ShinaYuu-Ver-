# Notices and Attribution

## Project origin

ShinaYuu Music is a modified work based on the original **Mineradio** project by XxHuberrr. Original copyright, authorship, attribution, and license notices must be retained when this project or a modified version is redistributed.

ShinaYuu Music is distributed under the GNU General Public License version 3 only (`GPL-3.0-only`). The complete license text is included in `LICENSE`.

## ShinaYuu Music modifications

ShinaYuu Music adds or modifies functionality including:

- Spotify playback through a hidden Microsoft Edge WebView2 host.
- YouTube playback through `yt-dlp` and `youtubei.js`.
- Spotify-native, YouTube, YouTube Music, LRCLIB, and locally aligned lyrics.
- Desktop Lyrics, 3D lyrics, visual effects, and beat-reactive rendering.
- Discord profile display and Rich Presence IPC.
- Unified master volume across the application audio pipeline and Spotify WebView2 playback.
- Windows packaging, installer customization, and WebView2 Runtime provisioning.

The YouTube lyric and forced-alignment implementations in ShinaYuu Music were written for this project. They do not include BetterLyrics integration and do not copy lyric implementation code from MineradioVN.

## Major third-party components and services

ShinaYuu Music uses or interoperates with independently licensed components and services, including:

- Electron and Electron Builder.
- Microsoft Edge WebView2 Runtime and Evergreen Bootstrapper.
- Spotify Web API, Spotify Accounts OAuth, and Spotify Web Playback SDK.
- YouTube, YouTube Music, `yt-dlp`, and `youtubei.js`.
- LRCLIB.
- `whisper.cpp` and Whisper model data for optional local alignment.
- FFmpeg and `ffmpeg-static`.
- Three.js, GSAP, music-tempo, mpg123-decoder, and extract-zip.
- Open-Meteo.

Each component remains subject to its own license and terms. Dependency license files distributed with packaged modules must not be removed.

ShinaYuu Music is not an official client of Spotify, YouTube, LRCLIB, Microsoft, OpenAI, or Open-Meteo and is not affiliated with those organizations. Product names, logos, and trademarks belong to their respective owners.

## Compatibility aliases

Selected internal identifiers inherited from Mineradio, including `netease`, `qq`, and `mineradio`, remain in compatibility paths to avoid destabilizing the existing UI and stored user data. They currently map to ShinaYuu Music behavior and do not restore the original providers.
