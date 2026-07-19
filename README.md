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
- **字體**：只封裝畫面實際使用的 **Source Han Sans TC Bold/Heavy** 與 **Source Han Serif TC Bold**，並保留跨平台系統字體 fallback；避免把未使用字重塞進安裝檔。
- **📋 早靈修班公告一鍵複製**：工具列按「📋 複製公告」→ 自動用「今天日期 + 試算表經文 + Zoom 連結」組成群組訊息 → 寫到剪貼簿 → 跳通知 → 直接到群組 Ctrl+V 貼上（不必每天改日期、改帳號、改密碼）。

## 開發 / 執行

需使用 Node.js 22.12.0 以上版本。

```bash
npm install
npm test
npm start
```

## 打包安裝檔

```bash
npm run build        # 當前平台（不發布）
npm run build:win    # Windows .exe (NSIS)
npm run build:mac    # macOS universal .dmg + zip（需在 macOS 12+ 執行）
```

產物在 `dist/`。

---

## 軟體自動更新（app 內一鍵更新）

本 app 內建 `electron-updater`，更新檔發布在本專案的 **GitHub Releases**。Windows 安裝版可使用下列自動更新流程；macOS 目前一律採手動更新，app 會檢查新版並開啟 Releases 下載頁：

- 開啟 app 時**自動在背景檢查**是否有新版；有新版會跳提示。
- 或到 **設定 → 軟體更新 → 檢查軟體更新** 手動檢查。
- 按下後**自動下載** → 顯示進度 → 完成後按「**重新啟動以安裝更新**」即完成升級。

> 更新來源設定在 `electron-builder.yml` 的 `publish:` 區塊（`Living-water-church-chiayi/zoomshare`）。repo 必須維持 **public**，使用者端才能免 token 下載更新。
>
> **Mac 版無論是否簽章，目前都只支援手動到 Releases 下載新版。** Developer ID 簽章與 Apple 公證仍很重要，可避免 Gatekeeper 警告並讓安裝體驗更順暢，但本版不會在 app 內自動替換程式。

### 發布新版本 SOP

每次要發新版，只需 3 步：

```bash
# 1) 改版號：編輯 package.json 的 "version"（例如 1.0.1 → 1.0.2）※ 必須改，否則不算新版

# 2) 設定環境（每個新的 git-bash 視窗都要設一次）
export PATH="$PATH:/c/Program Files/GitHub CLI"
gh auth login --hostname github.com --git-protocol https --web
export GH_TOKEN="$(gh auth token)"
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

> **注意**：Windows app 尚未做 Authenticode 程式碼簽章（`signExecutable: false`），使用者安裝/更新時 SmartScreen 可能跳「不明發行者」警告，按「仍要執行」即可。執行檔名稱、版本與圖示資源仍會正常寫入；要消除 SmartScreen 警告需設定 Windows 程式碼簽章憑證。

---

## 內附二進位（依平台分目錄）

播放引擎依賴三個外部程式，執行時會把對應平台的 `bin` 目錄加入 PATH：

| 用途 | `resources/bin/win/`（已附） | `resources/bin/mac/` |
|------|------|------|
| 串流抽取 | `yt-dlp.exe` | `yt-dlp_macos`（universal） |
| 解 JS 挑戰 | `deno.exe` | `deno`（universal，由 setup 腳本產生） |
| 合併 / 轉檔 | `ffmpeg.exe`, `ffprobe.exe` | `ffmpeg`, `ffprobe`（universal，由 setup 腳本產生） |

打包時 `electron-builder.yml` 只會把**當前平台**的 `bin` 放進安裝包，互不夾帶。

## 在 Mac 上打包並發布

`.dmg` / zip 只能在 macOS 上產生（electron-builder 限制），**無法在 Windows 上代打包**。目前以 Electron 43 建置，最低支援 **macOS 12**。同一份 universal 產物原生支援 Intel (`x86_64`) 與 Apple Silicon (`arm64`)。把本專案複製到 Mac（或 git clone）後：

```bash
npm install
# 固定並驗證 yt-dlp 2026.07.04、Deno 2.9.0、ffmpeg-static b6.1.1，
# 合併 arm64 + x86_64 後放到 resources/bin/mac
bash scripts/setup-mac.sh

# 只打包（不發布）——先本機測試用
npm run build:mac           # 產出 dist/Lingxiu-Cover-<版號>-universal.dmg 與 .zip

# 打包並發布到 GitHub Releases（供 Mac 手動下載新版）
brew install gh                                    # 若尚未安裝 GitHub CLI
gh auth login --hostname github.com --git-protocol https --web
export GH_TOKEN="$(gh auth token)"
npm run publish:mac         # 上傳 .dmg + .zip + latest-mac.yml 到 Release
```

> - `electron-builder.yml` 會產生 universal `dmg`、`zip` 與 `latest-mac.yml`，保留未來啟用原生更新所需的檔案；本版 Mac app 仍只會開啟 Releases 讓使用者手動安裝。
> - Windows 版與 Mac 版**發布到同一個 GitHub Release**（同版號 tag）。Windows 版使用 `latest.yml` 自動更新；Mac 版透過 GitHub 最新版本資訊提示使用者下載。建議先在其中一台發布（會建立該版 Release），另一台再對同版號 `publish` 補上另一平台的產物。
> - setup 腳本下載固定版本及固定 SHA-256，將 Deno、ffmpeg、ffprobe 的兩種架構以 `lipo` 合成 universal，並驗證架構、版本及 ad-hoc 簽章；不再依賴 Rosetta。
> - CI 有完整 `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD` 時會做 Developer ID 簽章；再加上 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 才會公證。請在發版前先設好 secrets；已發布的同版號產物不應原地替換。
> - 未提供完整憑證 secrets 時 CI 仍可產生未簽章檔。首次開啟可能需到「系統設定 → 隱私權與安全性」允許執行，之後更新也必須手動從 GitHub Releases 下載。

## 在 Windows 上打包 .exe

```bash
npm install
bash scripts/setup-win.sh  # 下載 yt-dlp / deno / ffmpeg 到 resources/bin/win（git clone 後需先執行）
npm run build:win          # 只打包，產出 dist/靈修封面-<版號>-setup.exe
# 或：npm run publish:win   # 打包並發布到 GitHub Releases（見上方「軟體自動更新」章節）
```

> `resources/bin/` 不納入 git（檔案過大、且可自動下載）。從 git clone 後，請先依平台執行 `scripts/setup-win.sh` 或 `scripts/setup-mac.sh`。

> 設定 `win.signExecutable: false` 只略過 Authenticode 簽章，仍保留 Windows 執行檔的產品名稱、版本與圖示資源編輯。

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
