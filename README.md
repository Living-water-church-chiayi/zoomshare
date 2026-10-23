# 靈修封面 (Lingxiu Cover)

晨更 / 靈修班開始前用的 **16:9 封面 + 背景音樂 / 敬拜影片** 桌面工具，Windows / Mac 通用。
取代原本每天手開 PowerPoint 的流程：拖圖換背景、日期自動、貼 YouTube 連結即可無廣告播放背景音樂與敬拜影片。

## 功能

- **16:9 視窗**：可自由縮放但永遠維持 16:9（專為 Zoom 視窗分享，不用系統全屏）。
- **拖圖換背景**：把圖片拖進視窗（或按「選擇圖片」），整張圖**完整顯示、不裁切**；非 16:9 留白可選「同圖模糊」或「純黑」。
- **日期自動**：依台北時間顯示靈修日期，每日 17:30 切至隔天（格式 M/D，可手動覆蓋）。
- **文字可編輯**：標題、副標題、本日經文標籤、讀經進度，皆可在設定中修改並自動保存。
- **傍晚預備隔天**：以台北時間為準，每日 17:30 自動將封面日期、經文、竭誠獻上、公告及主持台排班切換至隔天；跨午夜仍維持同一份預備資料。隔天未排經文時顯示待更新，不沿用前一天的經文。
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
- Windows 自動更新完成後會保留並補回桌面捷徑；若捷徑被刪掉，下次更新或手動重裝會重新建立。

> 更新來源設定在 `electron-builder.yml` 的 `publish:` 區塊（`Living-water-church-chiayi/zoomshare`）。repo 必須維持 **public**，使用者端才能免 token 下載更新。
>
> **Mac 版無論是否簽章，目前都只支援手動到 Releases 下載新版。** Developer ID 簽章與 Apple 公證仍很重要，可避免 Gatekeeper 警告並讓安裝體驗更順暢，但本版不會在 app 內自動替換程式。
>
> 若 macOS 在載入 YouTube 音樂或敬拜影片時顯示 `HTTP 403`，那是 YouTube 拒絕媒體下載請求；若畫面同時顯示「更新下載工具中」，指的是更新內建 `yt-dlp` 下載工具，不是 macOS app 更新檔下載失敗。

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

## Zoom 在線服務人選控制台

App 可搭配 `server/` 內的 Cloudflare Worker，透過 Zoom 官方會議事件顯示目前在線者，並與 Google 試算表的「服務名單」配對：

- 按原本的 **Zoom** 按鈕時會一起開啟獨立的「主持人控制台」；Zoom 仍只分享靈修投影視窗。
- 控制台分別列出可讀經文、可讀竭誠獻上的在線人員，選人結果只留在當班主持人的電腦。
- Zoom 帳號擁有者只需建立並啟用一次內部 Server-to-Server OAuth App；各主持人不需登入該帳號。
- 每台 Windows／Mac 電腦由安裝人員輸入 Worker 網址與安裝金鑰配對一次，裝置權杖會用作業系統安全儲存加密。
- 只維護當次會議的在線狀態，不建立出席歷史；會議結束立即清除。

後端部署、Zoom 事件訂閱、私人 Google 試算表與「服務名單」欄位設定請見 [`server/README.md`](server/README.md)。部署前可先執行：

```bash
npm run check:presence
npm run deploy:presence
```

## 備註

- 本工具供教會內部 / 個人使用；`yt-dlp` 抽取 YouTube 內容請遵守當地法規與服務條款。
- YouTube 改版偶爾會使抽取失敗，通常等 yt-dlp 自動更新或手動「立即檢查更新」即可恢復。

## 1.0.54 正式版（2026-10-23）

- 主持台取得焦點時，左右方向鍵可直接翻動投影視窗的經文與竭誠頁面，焦點仍留在主持台。輸入文字、編輯內容、操作選單、組合鍵及長按重複事件保留原用途。
- 主持台方向鍵只控制閱讀流程：在經文第一頁不退回敬拜，竭誠最後一頁不觸發關閉 App。閱讀視窗原有 Esc 返回與右方向鍵三次關閉的操作保留。
- 移除選中視窗的發亮外框與內容取色，保留清楚的視窗標題。
- 叫出主畫面或主持台時，已開啟的另一個視窗一起浮到前面；最小化時會還原，鍵盤焦點留在原本選取的視窗。未開啟或已關閉的主持台不會被自動重建，視窗不使用永久置頂。

本版整合 `1.0.54-rc.1` 本機試用確認的調整。已通過完整測試、27 項閱讀版面檢查、主持台鍵盤檢查、打包後真實 IPC 翻頁與焦點保留測試，並於本機以主持台右方向鍵把實際經文從第 1 頁翻至第 2 頁。

## 1.0.53 正式版（2026-10-22）

本版整合 2026-10-20 至 10-21 本機候選版的實測調整：敬拜完整時間軸與 I／O 起訖、淡入淡出、下載進度修正、設定頁整理、閱讀名單順位、置頂時鐘與敬拜倒數，以及竭誠導覽操作。

HLS 分段下載改依完成片段數計算；已知實際總大小時則按容量計算，不把不穩定的容量估算當成百分比，並顯示已下載容量。敬拜播放列使用細進度線與輕量 I／O 標記，保留完整片長、拖曳範圍與快捷鍵。

### 開發試用模式

```bash
npm run start:trial
```

此模式可與已安裝的正式版並存。首次啟動將設定、配對與媒體複製至獨立的 `lingxiu-cover-local-trial` 資料夾；之後沿用試用資料，不覆蓋正式版。閱讀安排只存試用資料夾，不寫回正式雲端紀錄。關閉試用視窗即可結束。

主持台的日期與時間（含秒數）固定在頂端，向下捲閱讀名單時仍可見；設定頁的日期區塊維持原位。

全職同工順位直接採用內建名單：月琴阿姨、信一、恩馳、恩慈、佳瑄、育農、道萱。2026-10-21 調整為本週未讀的一般弟兄姊妹、本週未讀的全職同工、本週已讀過的人；昨天已讀者維持置後及原有停用狀態。同組再依全職身分、本週次數與原排序排列。主持台不顯示全職同工設定或身分標籤，也不採用舊的本機勾選覆蓋。尚未列入服務名單的人會在加入並同步後自動套用。當天竭誠分享者仍不出現在兩份閱讀名單；當班主持人選擇與排除功能已撤除。

下載工具 yt-dlp 的版本與自動更新狀態整合到設定最底下的「軟體更新」區，同時保留手動檢查與重試。

### 原待辦完成狀態

以下四項原於 2026-10-19 記錄、預計等 T0 bug 再處理；使用者於 2026-10-20 改為授權此次實作，已納入 1.0.53 正式版。

- [x] **影片下載進度倒退／跳動**：下載時曾顯示 `3% → 2% → 5% → 3%`。改用 yt-dlp 結構化進度、影片／音訊檔案大小加權及同次要求的最高完成進度；重試不倒退，合併後成功才顯示 100%。背景音樂與敬拜影片分開顯示，忽略已更換連結的舊下載。
- [x] **經文按鈕滑鼠停留時保持展開**：滑鼠停在閱讀導覽按鈕區時不自動縮回，離開後約 1 秒收合。
- [x] **敬拜影片功能調整**：移除「使用常用敬拜影片」及常用清單介面；保留目前使用的影片連結與可辨識的歌名。新增開始／結束分秒（分鐘、秒數分開輸入）、聲音淡入／淡出秒數；開始留空從頭播放，結束留空播到片尾。更換歌曲連結時清空起訖時間，保留淡入淡出；同一首歌換成另一種 YouTube 連結格式仍保留起訖設定。起點超出影片長度會提示修正，設定終點到達後前往經文；Windows 音軌與 macOS 原生音訊共用同一段落及淡入淡出設定。
- [x] **顯示下載工具版本與更新狀態**：預設每次啟動自動檢查並更新；設定頁顯示目前 `yt-dlp` 版本、最近確認的最新版本及檢查時間。更新中會自動刷新狀態，手動檢查／重試操作預設收合；檢查失敗不會顯示為已是最新版。
- [x] **設定頁整理**：分成「敬拜與音樂／每日內容／一般設定」，保留各分頁捲動位置。敬拜歌名與起訖直接可見，歌名支援自動辨識與修改；淡入淡出、背景音樂、手動經文和快取管理按需展開；封面日期預設自動，停用後才顯示手動日期。沿用整體風格並統一紫灰配色、輸入框與按鈕細節，增加留白、減少卡片與大面積按鈕，軟體與 yt-dlp 更新集中在一般設定最底下。
- [x] **敬拜完整時間軸與 I／O**：時間軸保留原始片長，以 I／O 標記與色帶顯示播放範圍。可拖曳標記、使用 I／O 設定目前位置，或聚焦標記後用方向鍵逐秒微調（Shift 為 5 秒）。編輯時先暫停並自動儲存、同步設定欄位；起訖不會交叉。整條影片可拖曳預覽，範圍外有聲預覽不會立即跳到經文；正常播放仍保留淡入淡出與指定終點。作用中視窗外框由封面／影片取柔和色，閱讀頁則使用暖灰色，無右下角文字。
- [x] **竭誠結束與視窗辨識**：2026-10-21 起 Esc 和返回主畫面按鈕可直接回主畫面；只有竭誠最後一頁連按三下右方向鍵才關閉整個軟體。下方向鍵、滑鼠和滾輪不會關閉；3.5 秒逾時、下方向鍵、按鈕、滾輪、往回或視窗失焦會重置確認，長按不累計。作用中視窗以隨內容調整的柔和外框辨識，視窗標題隨內容更新；依使用者要求移除右下角文字標示。
- [x] **主持台時鐘與敬拜倒數**：日期與台北時間固定在頂端，包含秒數，捲動名單時保持可見。敬拜時顯示到實際播放出點的秒數倒數，暫停、拖曳播放位置、修改 I／O 出點均同步；60 秒內黃、30 秒內橘、15 秒內紅，離開敬拜後隱藏。

### 已取消的功能

2026-10-20：依使用者決定，移除 Zoom 音量表、開麥提醒、一鍵關麥、SDK／OAuth 登入與主持授權入口。保留原本的 Zoom 進出名單、Google 名單同步與閱讀安排；不再需要額外 Zoom 授權。1.0.53 不包含麥克風控制功能。
