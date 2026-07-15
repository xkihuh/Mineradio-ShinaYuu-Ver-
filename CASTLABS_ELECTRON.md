# Castlabs Electron Integration

## Purpose

This patch replaces the separate Microsoft Edge WebView2 Spotify host with Castlabs Electron for Content Security. Castlabs Electron is used as the application runtime and provides Widevine support to the existing ShinaYuu Music renderer.

## Version

```text
Castlabs Electron: 42.5.2+wvcus
ShinaYuu Music display version: 1.1.4
```

## Startup sequence

1. Electron starts the ShinaYuu Music main process.
2. The main process calls `components.whenReady()`.
3. Castlabs installs or updates the Widevine CDM when required.
4. The existing application window loads with `runtime=castlabs-electron`.
5. The Spotify Web Playback SDK creates the ShinaYuu Music Spotify Connect device inside the visible renderer.

## Packaging

`electron-builder` uses the installed Castlabs distribution directly:

```json
{
  "electronDist": "node_modules/electron/dist"
}
```

This prevents the packager from replacing the Castlabs runtime with stock Electron.

## First build

The Castlabs package wrapper is vendored in `vendor/castlabs-electron`; the Windows runtime is downloaded from the official Castlabs release during setup. Run:

```powershell
npm install
npm run build:win
```

Do not use an old `node_modules/electron` directory from the stock Electron build. Remove `node_modules` before the first Castlabs build when migrating an existing checkout.

## Production DRM signing

The official release pipeline packages `dist\win-unpacked`, applies Castlabs EVS production VMP signing, verifies the package signature, and then builds NSIS from that exact prepackaged directory. See `docs/WINDOWS_SIGNING_AND_BUILD.md`. The unsigned build command is intended only for installer and UI testing.
