# Support

When reporting an issue, include:

- A screenshot or short screen recording.
- The complete log from application startup until the issue appears.
- Reproduction steps.
- The affected track and provider.
- The application version.
- Output from `node -v` when running from source.

## Quick checks

- Spotify Dashboard must contain `http://127.0.0.1:43821/api/spotify/callback` exactly.
- Look for `[YouTubeEngine] Ready` in the terminal.
- Look for `[Castlabs] Components ready` when testing Spotify.
- Use `YTDLP_PATH` when automatic `yt-dlp` provisioning is blocked.
- Run `npm run setup:castlabs` and `npm run verify:castlabs` when Spotify playback does not initialize from source.
- Test the in-app master volume before adjusting Windows Volume Mixer.

Never share `spotify-token.json`, cookies, access tokens, or private account data.
