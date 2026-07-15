# Security Policy

## Supported release

Security fixes are applied to the current stable release line. At the time of this document, the supported release is **1.1.4**.

## Reporting a vulnerability

Report security issues privately to the repository maintainer. Include:

- The affected version.
- Clear reproduction steps.
- The expected and observed behavior.
- Sanitized logs or screenshots.

Never include access tokens, refresh tokens, cookies, private Client IDs, or personal account data.

## Credential handling

- Spotify authentication uses OAuth PKCE and does not require a client secret in the desktop application.
- Spotify tokens are stored locally in the application user-data directory.
- YouTube playback works without an API key by default.
- Discord Rich Presence uses a public Application ID and local IPC; it does not require a bot token.
- Runtime and model downloads must use their official or configured trusted sources.
- EVS credentials, Authenticode certificates, and certificate passwords must never be committed to the repository.

## Build trust

Install only binaries built from this source or published by a trusted release channel. Verify release hashes when provided. Official Castlabs/Spotify builds must complete EVS/VMP verification before the NSIS installer is published.
