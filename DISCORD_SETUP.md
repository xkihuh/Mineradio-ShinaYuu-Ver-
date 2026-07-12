# Thiết lập Discord cho ShinaYuu Music 1.1.2

## Mục tiêu

- Hiển thị hồ sơ Discord ở trang chủ ShinaYuu Music.
- Hiển thị trạng thái **Đang sử dụng ShinaYuu Music** trên Discord.
- Khi phát bài, cập nhật tên bài, nghệ sĩ và thời gian còn lại.
- Không dùng Bot Token và không đọc tin nhắn Discord.

## Chuẩn bị Discord Application

1. Mở Discord Developer Portal.
2. Tạo application mới với tên `ShinaYuu Music`.
3. Ở trang General Information, đặt icon cho application.
4. Sao chép `Application ID`.
5. Tùy chọn: trong Rich Presence Assets, tải ảnh và đặt key, ví dụ `shinayuu`.

## Kết nối trong ứng dụng

1. Mở Discord Desktop và đăng nhập.
2. Mở ShinaYuu Music.
3. Tại thẻ Discord ở trang chủ, bấm **Thiết lập Discord**. Cửa sổ thiết lập riêng sẽ mở và không bị cắt theo chiều cao card.
4. Nhập Application ID.
4. Nhập Rich Presence Asset Key hoặc để trống để dùng icon application.
6. Bấm `Lưu & kết nối`.

Tích hợp kết nối trực tiếp tới Discord Desktop bằng bộ IPC tích hợp của ShinaYuu Music. Phiên bản 1.1.2 không còn phụ thuộc vào bộ giải mã `discord-rpc` cũ. Không cần Client Secret, Bot Token hay OAuth trình duyệt.

## Khi Discord vẫn hiện Spotify

Discord có thể hiển thị hoạt động Spotify riêng nếu tài khoản Spotify đã được liên kết. ShinaYuu Music vẫn xuất hiện dưới tên application riêng. Để chỉ giữ trạng thái ShinaYuu Music, vào Discord → User Settings → Connections → Spotify và tắt `Display Spotify as your status`.

## Xử lý lỗi

- `Discord chưa chạy`: mở ứng dụng Discord Desktop, không phải Discord trên trình duyệt, rồi bấm `Kết nối lại`.
- `Discord đang mở nhưng IPC bị chặn`: thoát Discord hoàn toàn cả biểu tượng dưới khay hệ thống, mở lại Discord và ShinaYuu Music với cùng mức quyền. Không chạy một ứng dụng bằng Administrator trong khi ứng dụng còn lại chạy bình thường.
- `Đã thấy Discord IPC nhưng chưa nhận gói READY`: chờ Discord tải xong rồi bấm `Kết nối lại`. Phiên bản 1.1.2 xử lý được gói IPC bị chia nhỏ và tự thử lại.
- `Sai Discord Application ID`: phải dùng Application ID trong **General Information**; không dùng Discord User ID, Bot Token hoặc Public Key.
- `Application ID không hợp lệ`: sao chép lại ID dạng số từ General Information.
- Không hiện ảnh lớn: để trống Asset Key hoặc kiểm tra đúng key đã tải trong Rich Presence Assets.
- Không hiện trạng thái: kiểm tra Activity Privacy của Discord và bảo đảm chia sẻ hoạt động đang bật.
