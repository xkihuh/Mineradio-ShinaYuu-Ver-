# Privacy

ShinaYuu Music is a local desktop application. The project does not operate a telemetry service and is not designed to upload listening history, searches, custom artwork, lyrics, or account tokens to a ShinaYuu Music server.

## Locally stored data

The application may store the following data on the user's computer:

- Spotify Client ID, market, and language settings.
- Spotify OAuth access and refresh tokens.
- Optional Google/YouTube OAuth access and refresh tokens.
- Search history, synchronized playlist metadata, and application-managed playlists.
- Paths to local music folders or archives selected by the user.
- Cached track metadata and artwork.
- Lyric data, per-track lyric calibration, and layout settings.
- Visualizer, Desktop Lyrics, wallpaper, Discord, and volume preferences.
- Beat-analysis cache, YouTube lyric cache, and local forced-alignment cache.
- Downloaded helper runtimes and models used for local alignment.
- Cached archive extraction, embedded artwork, and local-library scan metadata.

## Third-party services

The application communicates directly with third-party services required for requested features, including Spotify, Google OAuth, YouTube Data API, YouTube, YouTube Music, LRCLIB, Open-Meteo, and Castlabs Electron release and component-update endpoints. Each service is governed by its own privacy policy and terms.

## Files that must not be committed

- `music-sources.json`
- `spotify-token.json`
- `youtube-token.json`
- `local-library.json`
- `.cookie`
- `.qq-cookie`
- `node_modules/`
- `dist/`
- User audio, tokens, cookies, or account data

## Security of credentials

Do not include tokens, cookies, or private account data in public issue reports. Sanitize logs before sharing them.
