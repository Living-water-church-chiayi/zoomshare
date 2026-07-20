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
4. 在試算表新增 `服務名單` 分頁，第一列依序為：`編號`、`姓名`、`Zoom別名`、`可讀經文`、`可讀竭誠獻上`、`啟用`、`排序`。
5. 複製 `.dev.vars.example` 的變數名稱，使用 `wrangler secret put` 設定所有秘密；`ZOOM_MEETING_NUMBER`、`APP_TIME_ZONE` 與工作表 ranges 可放在 `wrangler.jsonc` 的 `vars`。

## 部署

```bash
npm run deploy:presence
```

`INSTALL_KEY` 只交給負責安裝主持人電腦的人，不要寫進 App 安裝包或試算表。所有參與者資料會在 `meeting.ended` 後立即清除；若 Zoom 漏送結束事件，六小時後由 alarm 清除。
