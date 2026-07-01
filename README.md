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
npm run build        # 當前平台（不發布）
npm run build:win    # Windows .exe (NSIS)
npm run build:mac    # macOS .dmg + zip
```

產物在 `dist/`。

---

## 軟體自動更新（app 內一鍵更新）

本 app 內建 `electron-updater`，更新檔發布在本專案的 **GitHub Releases**。使用者端行為：

- 開啟 app 時**自動在背景檢查**是否有新版；有新版會跳提示。
- 或到 **設定 → 軟體更新 → 檢查軟體更新** 手動檢查。
- 按下後**自動下載** → 顯示進度 → 完成後按「**重新啟動以安裝更新**」即完成升級。

> 更新來源設定在 `electron-builder.yml` 的 `publish:` 區塊（`Living-water-church-chiayi/zoomshare`）。repo 必須維持 **public**，使用者端才能免 token 下載更新。

### 發布新版本 SOP

每次要發新版，只需 3 步：

```bash
# 1) 改版號：編輯 package.json 的 "version"（例如 1.0.1 → 1.0.2）※ 必須改，否則不算新版

# 2) 設定環境（每個新的 git-bash 視窗都要設一次）
export PATH="$PATH:/c/Program Files/GitHub CLI"
export GH_TOKEN=*** auth token)"
cd /d/zoomshare

# 3) 一鍵打包並發布為「正式版」Release（Windows）
npm run publish:win
```

因為 `electron-builder.yml` 設了 `releaseType: release`，發布出來會**直接是正式版**（不是草稿），使用者立即可更新。

### 首次設定（只做一次）

```bash
# 安裝 GitHub CLI
winget install --id GitHub.cli --accept-source-agreements --accept-package-agreements
export PATH="$PATH:/c/Program Files/GitHub CLI"

# 用瀏覽器登入（會顯示一組 8 碼 code，貼到開啟的 github.com/login/device 頁面授權）
gh auth login --hostname github.com --git-protocol https --web

# 確認 repo 為 public（使用者端免 token 更新的前提）
gh repo edit Living-water-church-chiayi/zoomshare --visibility public --accept-visibility-change-consequences
```

### 發布後驗證

```bash
export PATH="$PATH:/c/Program Files/GitHub CLI"
gh release list -R Living-water-church-chiayi/zoomshare        # 新版應顯示 Latest（不是 Draft）
# assets 必須含 latest.yml（缺它自動更新會壞）：
gh release view v<版號> -R Living-water-church-chiayi/zoomshare --json isDraft,assets \
  -q '"draft=\(.isDraft)\nassets: \([.assets[].name]|join(", "))"'
curl -sL https://github.com/Living-water-church-chiayi/zoomshare/releases/latest/download/latest.yml
```

> **注意**：Windows app 未做程式碼簽章（`signAndEditExecutable: false`），使用者安裝/更新時 SmartScreen 可能跳「不明發行者」警告，按「仍要執行」即可。要消除需購買程式碼簽章憑證。

---

## 內附二進位（依平台分目錄）

播放引擎依賴三個外部程式，執行時會把對應平台的 `bin` 目錄加入 PATH：

| 用途 | `resources/bin/win/`（已附） | `resources/bin/mac/` |
|------|------|------|
| 串流抽取 | `yt-dlp.exe` | `yt-dlp_macos`（已附） |
| 解 JS 挑戰 | `deno.exe` | `deno`（由 setup 腳本下載） |
| 合併 / 轉檔 | `ffmpeg.exe`, `ffprobe.exe` | `ffmpeg`, `ffprobe`（由 setup 腳本下載） |

打包時 `electron-builder.yml` 只會把**當前平台**的 `bin` 放進安裝包，互不夾帶。

## 在 Mac 上打包並發布

`.dmg` / zip 只能在 macOS 上產生（electron-builder 限制），**無法在 Windows 上代打包**。把本專案複製到 Mac（或 git clone）後：

```bash
npm install
bash scripts/setup-mac.sh   # 依 CPU 自動下載 deno / ffmpeg / ffprobe 到 resources/bin/mac

# 只打包（不發布）——先本機測試用
npm run build:mac           # 產出 dist/靈修封面-<版號>-<arch>.dmg 與 .zip

# 打包並發布到 GitHub Releases（自動更新用）
brew install gh                                    # 若尚未安裝 GitHub CLI
gh auth login --hostname github.com --git-protocol https --web
export GH_TOKEN=*** auth token)"
npm run publish:mac         # 上傳 .dmg + .zip + latest-mac.yml 到 Release
```

> - **Mac 自動更新的關鍵**：`electron-builder.yml` 已把 mac target 設為 `[dmg, zip]`。zip 與 `latest-mac.yml` 是 Mac 自動更新必需的（只有 .dmg 無法更新）。
> - Windows 版與 Mac 版**發布到同一個 GitHub Release**（同版號 tag）。使用者各自的 app 會依平台抓 `latest.yml`（Win）或 `latest-mac.yml`（Mac）。建議先在其中一台發布（會建立該版 Release），另一台再對同版號 `publish` 補上另一平台的產物。
> - setup 腳本會自動判斷 Apple Silicon / Intel 下載對應 `deno`。
> - ffmpeg/ffprobe 用 evermeet.cx 的 Intel 靜態檔；Apple Silicon 透過 Rosetta 執行，必要時先 `softwareupdate --install-rosetta --agree-to-license`。
> - 未簽名 App 首次開啟需在「應用程式」圖示上按右鍵 →「打開」。未簽章的 Mac app 自動更新可運作，但 macOS 的 Gatekeeper 對未公證（notarize）app 較嚴格，正式對外散布建議申請 Apple Developer 簽章 + 公證。

## 在 Windows 上打包 .exe

```bash
npm install
bash scripts/setup-win.sh  # 下載 yt-dlp / deno / ffmpeg 到 resources/bin/win（git clone 後需先執行）
npm run build:win          # 只打包，產出 dist/靈修封面-<版號>-setup.exe
# 或：npm run publish:win   # 打包並發布到 GitHub Releases（見上方「軟體自動更新」章節）
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
