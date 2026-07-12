# Changelog

## 1.1.2 — 2026-07-12

### Lyrics và tiến độ phát

- Ưu tiên timestamp lyrics theo dòng của Spotify và dùng cùng đồng hồ phát của Spotify SDK.
- Giữ nguyên `startTimeMs`, `endTimeMs`, dòng trống và dữ liệu syllable khi nguồn Spotify cung cấp.
- Đồng bộ lại vị trí bằng `Spotify.Player#getCurrentState()` và xử lý đúng khi tua, đổi bài hoặc đồng hồ phát nhảy vị trí.
- Không áp dụng offset hoặc co giãn timeline LRCLIB lên lyrics Spotify nguyên bản.
- Với LRCLIB, hỗ trợ `[offset:...]`, độ trễ riêng từng bài và điều chỉnh tốc độ timeline để sửa lệch tăng dần.
- Giữ hiệu ứng fade, blur, trượt, scale, glow và particle nhưng chạy trước timestamp Spotify 180 ms; hiệu ứng hoàn tất đúng lúc lời bắt đầu.
- Tiến độ karaoke vẫn bắt đầu đúng timestamp, không chạy sớm theo cửa sổ hiệu ứng.
- Desktop Lyrics dùng hai lớp khi chuyển câu: câu cũ thoát ra trong lúc câu mới chuẩn bị, tránh độ trễ nhìn thấy.

### Discord

- Thay decoder RPC cũ bằng Discord IPC client tích hợp.
- Xử lý gói READY bị phân mảnh, PING/PONG, timeout và tự kết nối lại an toàn.
- Phân biệt Discord chưa mở, IPC bị chặn và Application ID không hợp lệ.
- Chuyển thiết lập Discord sang modal riêng và tự khôi phục Application ID đã lưu.

### Cài đặt và đóng gói

- Sửa kiểm tra hậu tố thư mục cài đặt `\ShinaYuu Music` trong NSIS.
- Giữ quy trình build Electron + NSIS và tên bộ cài `ShinaYuu-Music-1.1.2-Setup.exe`.

## 1.1.1 — nền tảng trước ngày 2026-07-12

- Đổi thương hiệu Mineradio thành ShinaYuu Music.
- Khôi phục Electron làm cửa sổ chính và Spotify WebView2 host chạy ẩn.
- Spotify Web Playback SDK, YouTube yt-dlp, tìm kiếm hai nguồn và hàng chờ phát nhạc.
- Sửa tua Spotify/YouTube, phân tích nhịp thời gian thực, fullscreen, Visual Effects và Desktop Lyrics.
- Làm lại Spotify OAuth, cache hồ sơ và xử lý HTTP 429.
- Thêm Discord Profile Card và Rich Presence cục bộ.
