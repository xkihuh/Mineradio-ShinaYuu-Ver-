# ShinaYuu Music 1.1.2

## Lyrics có hiệu ứng nhưng không trễ

- Hiệu ứng chuyển câu được chạy trước timestamp Spotify trong 180 ms.
- Fade, blur, trượt, scale, glow và particle hoàn tất đúng lúc lời bắt đầu.
- Karaoke highlight vẫn dùng timestamp thật, không cộng lookahead vào tiến độ.
- Dòng cũ và dòng mới cùng tồn tại trong lúc chuyển tiếp để tránh mất câu hoặc nhảy chữ.
- Desktop Lyrics nội suy hiệu ứng tại chỗ, giảm phụ thuộc vào độ trễ IPC và FPS.

## Các sửa đổi khác trong ngày 2026-07-12

- Đồng bộ lyrics Spotify nguyên bản và fallback LRCLIB.
- Căn lyrics riêng từng bài cho nguồn ngoài Spotify.
- Sửa Discord IPC, modal cấu hình và trạng thái lỗi.
- Sửa đường dẫn bộ cài NSIS.

Bộ cài tạo ra:

```text
dist\ShinaYuu-Music-1.1.2-Setup.exe
```
