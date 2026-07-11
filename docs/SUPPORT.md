# Hỗ trợ / Support

## Tiếng Việt

Khi báo lỗi, hãy gửi:

- Ảnh chụp màn hình.
- Toàn bộ log từ lúc chạy `npm start` đến lúc lỗi xuất hiện.
- Các bước tái hiện.
- Tên bài hát, nguồn Spotify/YouTube và thao tác đã thực hiện.
- Phiên bản Node.js từ `node -v`.

### Các kiểm tra nhanh

- Spotify OAuth: Redirect URI trong Dashboard phải đúng tuyệt đối là `http://127.0.0.1:43821/api/spotify/callback`.
- YouTube: tìm dòng `[YouTubeEngine] Ready` trong Terminal.
- Nếu yt-dlp không tự tải được, tải bản chính thức riêng và đặt biến môi trường `YTDLP_PATH`.
- Không gửi `spotify-token.json`, cookie hoặc dữ liệu đăng nhập.

## English

When reporting an issue, include a screenshot, the complete `npm start` log, reproduction steps, the affected track/source, and `node -v`.

Quick checks:

- Spotify Dashboard must contain the exact URI `http://127.0.0.1:43821/api/spotify/callback`.
- Look for `[YouTubeEngine] Ready` in the terminal.
- Set `YTDLP_PATH` when automatic yt-dlp preparation is blocked.
- Never share `spotify-token.json`, cookies, or login data.
