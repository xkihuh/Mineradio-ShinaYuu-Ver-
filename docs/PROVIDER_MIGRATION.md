# Provider Migration

The inherited interface contains many `netease` and `qq` branches. Renaming every ID, class, route, storage key, and condition at once would create unnecessary UI and data-migration risk.

Current compatibility mapping:

- UI value `netease` maps to **Spotify**.
- UI value `qq` maps to **YouTube**.

Legacy-shaped routes are intercepted by `handleModernMusicRoute()` and implemented through `music-providers.js` before legacy stubs can run.

Do not reintroduce the original NetEase or QQ provider packages. New provider features should be implemented in the modern provider layer and converted to the inherited UI schema only at adapter boundaries.
