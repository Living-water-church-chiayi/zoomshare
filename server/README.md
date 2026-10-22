# 靈修班 Zoom 在線服務

這個 Cloudflare Worker 接收 Zoom 會議事件，透過 Durable Object 維護「目前在線」快照，並以私人 Google 試算表提供經文進度與服務名單。

## 一次性設定

1. 由 Zoom 帳號擁有者建立並啟用 **Server-to-Server OAuth** 內部 App。
2. 在 App 的 Event Subscription 加入 Worker 的 `/zoom/webhook`，訂閱：
   - `meeting.started`
   - `meeting.ended`
   - `meeting.participant_joined`
   - `meeting.participant_left`
3. Google 資料連線可選擇下列其中一種：
   - 一般帳號：建立 Google Cloud 服務帳號，啟用 Google Sheets API，將現有試算表以「檢視者」分享給服務帳號 email。
   - 若組織禁止建立服務帳戶金鑰：將 `google-apps-script/Code.gs` 貼到試算表的 Apps Script，設定 Script Property `BRIDGE_SECRET`，再部署成「以本人身分執行／任何人可存取」的 Web App。部署網址與相同密鑰分別存成 Cloudflare Secrets `GOOGLE_APPS_SCRIPT_URL`、`GOOGLE_APPS_SCRIPT_SECRET`；不需停用組織安全政策。
4. 在試算表新增 `服務名單` 分頁，第一列依序為：`編號`、`姓名`、`Zoom別名`、`可讀經文`、`可讀竭誠獻上`、`啟用`、`排序`、`全職同工`。第 H 欄「全職同工」為選填，可填「是／否」，缺欄或空白視為非全職；讀取範圍為 `服務名單!A:H`。
5. 複製 `.dev.vars.example` 的變數名稱，使用 `wrangler secret put` 設定所有秘密；`ZOOM_MEETING_NUMBER`、`APP_TIME_ZONE` 與工作表 ranges 可放在 `wrangler.jsonc` 的 `vars`。

## 部署

```bash
npm run deploy:presence
```

`INSTALL_KEY` 只交給負責安裝主持人電腦的人，不要寫進 App 安裝包或試算表。所有參與者資料會在 `meeting.ended` 後立即清除；若 Zoom 漏送結束事件，六小時後由 alarm 清除。

2026-10-20：依使用者要求取消麥克風功能，已移除並部署 `/v1/zoom/control` 主持授權接口（現在回傳 404），並清除本次新增的 SDK／S2S 憑證、主持使用者、會議密碼與控制開關 secrets。保留原有 Webhook、裝置配對及 Google 名單／閱讀同步的設定。Zoom Marketplace 的額外 General App 草稿未刪除，但程式不再使用它，也不再進行 Plugin SDK OAuth 登入。


## 竭誠獻上季度服事表

`UTMOST_ASSIGNMENT_SHEET_URL` 設成服事表整份試算表的網址（`/edit`），不用指定 `gid`。後端每次同步都會重新取得公開分頁清單，讀取今年、前一年與下一年的分頁，依日期合併分享人選。因此在**同一份試算表新增季度分頁**後，主持人按「同步」即可讀到新表，不需重新部署或更新桌面 App。舊的 `UTMOST_ASSIGNMENT_CSV_URL` 設定仍可使用，其 `gid` 不再限制讀取分頁。

- 分頁保持可供公開檢視；分頁名稱保留年份與起始月份，例如 `2026.10-12月`。跨年的一月日期會自動歸到下一年。若分頁不含年份，請在日期格填寫完整年份，例如 `2027/1/5`，避免歷史資料被當成本年的排班。
- 支援橫向多週表與直向日期表；欄位標題使用「第一週／第二週…」或「日期」，搭配「分享／分享者」，可在中間插入主持人欄。分享欄放在各週範圍內，輔助欄不會當成分享名單。
- 支援 `10月13日`、`10/13`、`2026/10/13`、`2026年10月13日` 和全形數字，保留每日 17:30 準備隔天的行為。
- 同一天若有不同分享者（包括空白與有人選衝突），會回報重複日期；登入頁、無法辨識分頁清單或表格格式也會回報讀取錯誤，不會默默使用舊季度。

換成另一份試算表時才需要更改 `UTMOST_ASSIGNMENT_SHEET_URL` 並部署後端。分頁探索使用 Google 公開 `htmlview` 的清單格式，若 Google 改變該格式，錯誤會明確回報；相關解析集中在 `parsePublicSheetTabs`，方便修復。


### 全職同工閱讀排序

桌面程式直接採用使用者提供的七人名單（月琴阿姨、信一、恩馳、恩慈、佳瑄、育農、道萱）決定閱讀順位，不需要在主持台設定。本機舊勾選不再生效。後端的選填全職欄位保留資料相容性，目前閱讀排序以桌面內建名單為準。本次沒有修改線上試算表；後端已部署。
