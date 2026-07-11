# Provider migration / Chuyển đổi nguồn nhạc

## Tiếng Việt

Giao diện gốc dùng rất nhiều nhánh `netease` và `qq`. Để giữ UI/UX ổn định, bản chuyển đổi không đổi hàng nghìn ID, class và điều kiện cũ cùng lúc.

Ánh xạ hiện tại:

- `netease` trong dữ liệu giao diện = **Spotify**.
- `qq` trong dữ liệu giao diện = **YouTube**.

Các route cũ như `/api/search`, `/api/qq/search`, `/api/song/url` và `/api/qq/song/url` vẫn tồn tại để tương thích, nhưng được `handleModernMusicRoute()` xử lý bằng `music-providers.js` trước khi code legacy có thể chạy.

Không thêm lại package NetEase hoặc cookie QQ/NE. Mọi tính năng mới nên gọi API provider trong `music-providers.js` và chỉ chuyển đổi sang schema UI cũ ở ranh giới adapter.

## English

The original interface has many `netease` and `qq` branches. Renaming every ID, class, and condition at once would risk destabilizing the UI, so these values are retained only as compatibility aliases:

- UI `netease` = **Spotify**.
- UI `qq` = **YouTube**.

Legacy-shaped routes are intercepted by `handleModernMusicRoute()` and handled through `music-providers.js`. Do not reintroduce the NetEase package or QQ/NE cookies. New provider work should be implemented in the adapter and mapped to the legacy UI schema only at the boundary.
