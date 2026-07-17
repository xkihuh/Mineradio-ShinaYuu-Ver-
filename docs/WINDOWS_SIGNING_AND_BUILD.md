# Windows Production Signing and Installer Build

This document describes the official Windows release pipeline for the ShinaYuu Music 1.1.5 stable release build.

## Build outputs

The production command creates:

```text
dist\ShinaYuu-Music-1.1.5-Setup.exe
dist\ShinaYuu-Music-1.1.5-Setup.exe.sha256.txt
```

The installer contains the already packaged and EVS/VMP-signed Castlabs Electron application. End users do not need Python, Node.js, npm, EVS, or a separate Castlabs installation.

## Requirements on the build computer

- Windows 10 or Windows 11 x64.
- Node.js 24 or later.
- Python 3.7 or later.
- The `castlabs-evs` Python package.
- A confirmed Castlabs EVS account.
- Internet access for npm, Castlabs runtime provisioning, Widevine component provisioning, and EVS signing.

## 1. Install project dependencies

Open PowerShell in the repository root:

```powershell
npm ci
npm run setup:castlabs
npm run verify:castlabs
npm test
```

Use `npm install` instead of `npm ci` only when intentionally updating `package-lock.json`.

## 2. Install the EVS client

```powershell
py -m pip install --upgrade castlabs-evs
py -m castlabs_evs.vmp --version
```

If the `py` launcher is unavailable, replace `py` with `python`.

## 3. Create or authenticate an EVS account

Create an account once:

```powershell
py -m castlabs_evs.account signup
```

Follow the interactive prompts and confirm the account using the code sent by Castlabs. Do not store an EVS password in this repository.

If an existing session has expired, refresh or authenticate it using the EVS account CLI:

```powershell
py -m castlabs_evs.account refresh
```

Use the built-in help when needed:

```powershell
py -m castlabs_evs.account --help
py -m castlabs_evs.vmp --help
```

## 4. Sign the development runtime for `npm start`

This step is only for testing Spotify production DRM while running from source:

```powershell
npm run sign:evs:runtime
npm run verify:evs:runtime
npm start
```

The signed directory is:

```text
node_modules\electron\dist
```

Do not run `npm ci`, `npm install`, or `npm run setup:castlabs` after signing and before the test. Those commands may replace the runtime and require it to be signed again.

## 5. Build the official signed installer

```powershell
npm run build:win
```

The command performs this sequence:

1. Verifies the Castlabs runtime.
2. Runs the full regression test suite.
3. Creates `dist\win-unpacked`.
4. Applies the production EVS/VMP signature to `dist\win-unpacked`.
5. Verifies the EVS/VMP signature.
6. Builds NSIS from that exact prepackaged directory.
7. Writes a SHA-256 checksum file.

If EVS authentication, signing, or verification fails, the official build stops and no release installer should be published.

## 6. Development-only installer without EVS

For installer UI testing only:

```powershell
npm run build:win:unsigned
```

This output is not suitable for a public Spotify DRM release. The Widevine license server may reject it.

## 7. Optional Windows Authenticode signing

EVS/VMP signing and Windows Authenticode signing solve different problems:

- EVS/VMP signs the Castlabs package for production Widevine DRM.
- Authenticode identifies the Windows publisher and can reduce SmartScreen warnings.

When Authenticode is used, apply it to the packaged application before EVS/VMP signing. The advanced manual order is:

```text
Create dist\win-unpacked
→ Authenticode-sign the Windows binaries
→ EVS sign-pkg dist\win-unpacked
→ EVS verify-pkg dist\win-unpacked
→ Build NSIS from dist\win-unpacked
```

Create the unpacked app:

```powershell
npm run build:win:dir
```

Example `signtool.exe` command for the main executable:

```powershell
signtool sign `
  /fd SHA256 `
  /td SHA256 `
  /tr http://timestamp.digicert.com `
  /f C:\Certificates\ShinaYuu.pfx `
  /p "YOUR_PFX_PASSWORD" `
  .\dist\win-unpacked\ShinaYuuMusic.exe
```

Keep the certificate and password outside the repository. Depending on certificate policy and included native binaries, additional executables or DLLs may also require Authenticode signing.

After Authenticode signing:

```powershell
npm run sign:evs:package
npm run verify:evs:package
npm run build:win:installer
```

Do not Authenticode-sign or otherwise modify the application executable after EVS/VMP signing. Any binary modification can invalidate the VMP signature.

## 8. Verify the release installer

```powershell
Get-Item .\dist\ShinaYuu-Music-1.1.5-Setup.exe |
  Select-Object Name, Length

Get-FileHash `
  .\dist\ShinaYuu-Music-1.1.5-Setup.exe `
  -Algorithm SHA256
```

Compare the result with:

```text
dist\ShinaYuu-Music-1.1.5-Setup.exe.sha256.txt
```

## 9. Release smoke test

Install the generated setup on a clean Windows user profile or Windows Sandbox and verify:

- The installer opens and finishes normally.
- The app starts without PowerShell, npm, or a console window.
- Spotify login and playback work.
- Widevine license requests no longer fail because of a development VMP signature.
- Play, pause, seek, progress, title, artwork, and lyrics remain synchronized.
- YouTube playback and lyric fallbacks work.
- Discord Rich Presence and Desktop Lyrics work.
- Installing over an older version preserves user data.
- Uninstall works correctly.

## Security notes

- Never commit EVS credentials, `.pfx` files, certificate passwords, Spotify tokens, or cookies.
- Build only from an official Castlabs Electron for Content Security runtime supported by EVS.
- Publish the installer together with its SHA-256 checksum and GPLv3 corresponding source.
