# 靈修封面 (Lingxiu Cover)

晨更 / 靈修班開始前用的 **16:9 封面 + 背景音樂 / 敬拜影片** 桌面工具，Windows / Mac 通用。
取代原本每天手開 PowerPoint 的流程：拖圖換背景、日期自動、貼 YouTube 連結即可無廣告播放背景音樂與敬拜影片。

## 功能

- **16:9 視窗**：可自由縮放但永遠維持 16:9（專為 Zoom 視窗分享，不用系統全屏）。
- **拖圖換背景**：把圖片拖進視窗（或按「選擇圖片」），整張圖**完整顯示、不裁切**；非 16:9 留白可選「同圖模糊」或「純黑」。
- **日期自動**：直接抓系統當天日期（格式 M/D，可手動覆蓋）。
- **文字可編輯**：標題、副標題、本日經文標籤、讀經進度，皆可在設定中修改並自動保存。
- **背景音樂（YouTube，無廣告）**：貼上連結 → 背景自動下載快取為音檔 → 點 🎵 即播、可開機自動播放。
- **敬拜影片（YouTube，無廣告）**：貼上連結 → 背景預先下載快取 → 點「敬拜」在視窗內 16:9 播放，背景音樂自動淡出；按「返回封面」即可回到封面。
- **無廣告、流暢**：使用 `yt-dlp` 抽取串流並下載快取為本地檔（mp3 / mp4），播放時讀本地檔，無廣告、不卡頓、可重複使用。
- **yt-dlp 自動更新**：開機在背景靜默檢查 GitHub 最新版並更新到使用者目錄（可寫），設定中亦有「立即檢查更新」。
- **字體**：內建開源可商用的 **全字庫正楷體 TW-Kai**（政府開放資料授權），Windows / Mac 外觀一致。

## 開發 / 執行

```bash
npm install
npm start
```

## 打包安裝檔

```bash
npm run build        # 當前平台
npm run build:win    # Windows .exe (NSIS)
npm run build:mac    # macOS .dmg
```

產物在 `dist/`。

## 內附二進位（依平台分目錄）

播放引擎依賴三個外部程式，執行時會把對應平台的 `bin` 目錄加入 PATH：

| 用途 | `resources/bin/win/`（已附） | `resources/bin/mac/` |
|------|------|------|
| 串流抽取 | `yt-dlp.exe` | `yt-dlp_macos`（已附） |
| 解 JS 挑戰 | `deno.exe` | `deno`（由 setup 腳本下載） |
| 合併 / 轉檔 | `ffmpeg.exe`, `ffprobe.exe` | `ffmpeg`, `ffprobe`（由 setup 腳本下載） |

打包時 `electron-builder.yml` 只會把**當前平台**的 `bin` 放進安裝包，互不夾帶。

## 在 Mac 上打包 .dmg

`.dmg` 只能在 macOS 上產生（electron-builder 限制）。把本專案複製到 Mac 後：

```bash
npm install
bash scripts/setup-mac.sh   # 依 CPU 自動下載 deno / ffmpeg / ffprobe 到 resources/bin/mac
npm run build:mac           # 產出 dist/靈修封面-1.0.0.dmg
```

> - setup 腳本會自動判斷 Apple Silicon / Intel 下載對應 `deno`。
> - ffmpeg/ffprobe 用 evermeet.cx 的 Intel 靜態檔；Apple Silicon 透過 Rosetta 執行，必要時先 `softwareupdate --install-rosetta --agree-to-license`。
> - 未簽名 App 首次開啟需在「應用程式」圖示上按右鍵 →「打開」。

## 在 Windows 上打包 .exe

```bash
npm install
bash scripts/setup-win.sh  # 下載 yt-dlp / deno / ffmpeg 到 resources/bin/win（git clone 後需先執行）
npm run build:win          # 產出 dist/靈修封面-1.0.0-setup.exe
```

> `resources/bin/` 不納入 git（檔案過大、且可自動下載）。從 git clone 後，請先依平台執行 `scripts/setup-win.sh` 或 `scripts/setup-mac.sh`。

> 設定 `win.signAndEditExecutable: false`（不簽章），可避開 Windows 無系統管理員權限時抽取簽章工具失敗的問題。

## 設定與快取位置

- 設定：`%APPDATA%/lingxiu-cover/config.json`（mac：`~/Library/Application Support/lingxiu-cover/`）
- 背景圖：上述目錄的 `backgrounds/`
- 媒體快取：上述目錄的 `media/`（依連結雜湊命名，記住後不再重複下載；更換連結後舊檔可手動刪除）
  > 注意：資料夾名稱刻意避開 `cache`——Windows 大小寫不分，會與 Electron 自己的 `Cache` 目錄衝突導致每次重新下載。

## 使用流程（每天）

1. 把當天的背景圖（已印好經文金句）拖進視窗。
2. 需要時在設定改讀經進度文字。
3. 第一次設定好背景音樂 / 敬拜的 YouTube 連結後即會自動快取，之後點 🎵 / 「敬拜」即播。
4. 用 Zoom 分享此視窗即可（工具列閒置會自動隱藏，畫面乾淨）。

## 備註

- 本工具供教會內部 / 個人使用；`yt-dlp` 抽取 YouTube 內容請遵守當地法規與服務條款。
- YouTube 改版偶爾會使抽取失敗，通常等 yt-dlp 自動更新或手動「立即檢查更新」即可恢復。
