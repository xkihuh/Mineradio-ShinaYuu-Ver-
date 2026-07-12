# ShinaYuu Music 1.1.2

Trình phát nhạc desktop cho Windows, hỗ trợ Spotify, YouTube, lyrics đồng bộ, Visual Effects, Desktop Lyrics và Discord Rich Presence.

## Lyrics Spotify

Khi phát từ Spotify, ứng dụng ưu tiên timestamp lyrics theo dòng của Spotify và dùng cùng đồng hồ phát của Spotify SDK. Nếu nguồn này không khả dụng, ứng dụng tự chuyển sang LRCLIB.

Hiệu ứng lyrics không còn làm câu xuất hiện chậm: dòng mới được dựng trước 180 ms, chạy fade/blur/trượt/scale và hoàn tất đúng timestamp Spotify. Phần tô sáng karaoke vẫn bắt đầu đúng thời điểm lời cất lên.

Với lyrics LRCLIB, người dùng vẫn có thể chỉnh độ trễ và tốc độ timeline riêng cho từng bài.

## Support the Original Author

If Mineradio has accompanied you through an extra song or two, feel free to buy the original author a cup of coffee to support their incredible initial design.

[View the Original Support Page](./docs/SUPPORT.md)

The core goal of version 1.1.1 is to clean up and reorganize Mineradio into a clean, publicly downloadable installation version. The default visual parameters are pulled from the built-in "Default Test" user profile, allowing users to experience a unified visual feel from the very first boot. The 3D playlist rack, lyric layers, user profiles, and background performance strategies have all been wrapped up and finalized in this single release cycle.

## Core Features

* **Dynamic Home Page:** Daily recommendations, personal radio, "continue listening", listening profile insights, and quick access to your custom playlists.
* **Immersive Playback Visuals:** Switches to the *Emily* / *Default* playback state once music starts, where the lyric stage and particle stage work in perfect sync.
* **Beat-Based Cinematic Camera System:** A visual engine that adapts dynamically to the rhythm of the music.
* **Lyric Stage Control:** Supports custom lyrics, lyric positioning, and advanced visual tweaking.
* **Custom Album Art:** Supports image uploading and built-in cropping.
* **3D Playlist Rack:** Triggered via right-click to let you intuitively browse through your playlist queues.
* **GitHub Releases Update Detection:** Automated update checks with an in-app download entrance linking to this fork.
* **YouTube integration:** Search and play songs from YouTube.
* **Instant Out-of-the-Box Experience:** Ships with a built-in "Default Test" visual user profile so the software's default look matches this preset perfectly on its first launch.


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

1. Tạo Discord Application tên theo ý của bạn
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

