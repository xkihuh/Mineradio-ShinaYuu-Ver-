# ShinaYuu Music 1.4.24

Bản này tiếp tục trực tiếp từ MineRadio 1.1.0

## Tua nhạc ổn định

- Thanh tiến trình chỉ xem trước vị trí khi kéo.
- Chỉ gửi một lệnh seek khi thả chuột.
- Spotify bỏ qua state cũ trong lúc chờ SDK xác nhận vị trí mới.
- YouTube chờ sự kiện `seeked`; nếu URL stream đã hết hạn, ứng dụng lấy stream mới và tiếp tục đúng vị trí đã chọn thay vì phát lại từ đầu.

## Hiệu ứng real-time

- YouTube dùng PCM trực tiếp từ HTML Audio + Web Audio Analyser; không trộn beat-grid hoặc tempo assist cho nguồn YouTube.
- Spotify dùng Windows system-audio loopback do Electron cấp cho Web Audio Analyser.
- Khi không có PCM thật, hiệu ứng giảm dần về trạng thái nghỉ thay vì tự nhấp nháy.
