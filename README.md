# ShinaYuu Music 1.1.2

Trình phát nhạc desktop cho Windows, hỗ trợ Spotify, YouTube, lyrics đồng bộ, Visual Effects, Desktop Lyrics và Discord Rich Presence.

## Lyrics Spotify

Khi phát từ Spotify, ứng dụng ưu tiên timestamp lyrics theo dòng của Spotify và dùng cùng đồng hồ phát của Spotify SDK. Nếu nguồn này không khả dụng, ứng dụng tự chuyển sang LRCLIB.

Hiệu ứng lyrics không còn làm câu xuất hiện chậm: dòng mới được dựng trước 180 ms, chạy fade/blur/trượt/scale và hoàn tất đúng timestamp Spotify. Phần tô sáng karaoke vẫn bắt đầu đúng thời điểm lời cất lên.

Với lyrics LRCLIB, người dùng vẫn có thể chỉnh độ trễ và tốc độ timeline riêng cho từng bài.

## Chạy source

```powershell
npm install
npm start
```

## Build bản chạy thử

```powershell
npm run build:win:dir
```

Mở:

```text
dist\win-unpacked\ShinaYuuMusic.exe
```

## Build bộ cài Windows

```powershell
npm run build:win
```

Kết quả:

```text
dist\ShinaYuu-Music-1.1.2-Setup.exe
```

## Spotify

- Spotify Premium để phát trực tiếp.
- Redirect URI mặc định:

```text
http://127.0.0.1:43821/api/spotify/callback
```

## Discord Rich Presence

1. Tạo Discord Application tên **ShinaYuu Music**.
2. Sao chép **Application ID**.
3. Mở Discord Desktop.
4. Trong ứng dụng, mở **Thiết lập Discord**, nhập Application ID rồi bấm **Lưu & kết nối**.

Không cần Bot Token, Client Secret hoặc OAuth trình duyệt.

## Yêu cầu phát triển

- Windows 10/11 x64.
- Node.js 24 trở lên.
- Microsoft Edge WebView2 Runtime.

## Copyright and License

Copyright (C) 2026 XxHuberrr.
Copyright (C) 2026 x.kihuh (For modifications and maintenance).

This project is licensed under the GPL-3.0 License. See the [LICENSE](./LICENSE) file for details.

The MR Logo, the name "Mineradio," the UI visual design, and original visual assets belong entirely to the original author. Third-party dependencies and services follow their respective open-source licenses and terms of service.

