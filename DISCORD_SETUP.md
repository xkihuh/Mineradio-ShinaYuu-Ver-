# Discord Integration Setup

## Purpose

ShinaYuu Music can display the local Discord profile on the home page and publish a Rich Presence activity such as **Using ShinaYuu Music** or the currently playing track.

The integration does not use a bot token and does not read Discord messages.

## Create a Discord application

1. Open the Discord Developer Portal.
2. Create an application named `ShinaYuu Music`.
3. Set the application icon under **General Information**.
4. Copy the numeric **Application ID**.
5. Optionally upload a Rich Presence asset and note its asset key.

## Connect from ShinaYuu Music

1. Open and sign in to Discord Desktop.
2. Open ShinaYuu Music.
3. Select **Configure Discord** from the Discord card on the home page.
4. Enter the Application ID.
5. Enter the optional Rich Presence asset key.
6. Select **Save and connect**.

ShinaYuu Music uses its own Discord IPC client. A client secret, bot token, and browser OAuth flow are not required.

## Troubleshooting

- **Discord is not running:** use Discord Desktop rather than the browser version.
- **IPC is blocked:** close both applications completely and reopen them at the same privilege level.
- **READY was not received:** wait until Discord finishes loading, then reconnect.
- **Invalid Application ID:** use the numeric Application ID from General Information, not a user ID, public key, or token.
- **Large image is missing:** leave the asset key empty or verify the exact key in Rich Presence Assets.
- **Activity is hidden:** check Discord Activity Privacy settings.

Discord may also show the account's native Spotify activity. Disable **Display Spotify as your status** in Discord Connections when only the ShinaYuu Music activity should be visible.
