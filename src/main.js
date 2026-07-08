'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const https = require('https');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);
const { autoUpdater } = require('electron-updater');

// 允許音/視訊在無使用者互動下自動播放（背景音樂 / 敬拜）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const USER_DATA = () => app.getPath('userData');
const CONFIG_PATH = () => path.join(USER_DATA(), 'config.json');
const BG_DIR = () => path.join(USER_DATA(), 'backgrounds');
const CACHE_DIR = () => path.join(USER_DATA(), 'media'); // 不可用 "cache"：Windows 大小寫不分，會和 Electron 的 Cache 目錄衝突

const DEFAULT_CONFIG = {
  title1: '靈修班即將開始',
  title2: '歡迎聖靈與我們同在',
  title3: '讓我們一起預備《聖經》',
  scriptureLabel: '本日經文：',
  scriptureBook: '歌羅西書',
  scriptureStartCh: 3, scriptureStartV: 12,
  scriptureEndCh: 3, scriptureEndV: 25,
  readingExtra: '《竭誠獻上》《靈命日糧》',
  dateAuto: true,
  dateManual: '',
  backgroundFile: '',
  fillMode: 'blur',
  musicUrl: '',
  worshipUrl: '',
  useWorshipPreset: false,
  worshipPreset: '',
  musicVolume: 0.8,
  autoPlayMusic: true,
  videoQuality: 1080,
  cacheKeepDays: 30,
  fontFamily: 'sans-bold',
  zoomUrl: 'https://us06web.zoom.us/j/77730692079?pwd=EbYm30dRERJb8FI3GRHadpkqdNLfE4.1'
};

// ---------- 二進位位置（yt-dlp / deno / ffmpeg） ----------
function ytDlpBinName() {
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp_macos';
}
function bundledBinDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin');
  const plat = process.platform === 'win32' ? 'win' : 'mac';
  return path.join(__dirname, '..', 'resources', 'bin', plat);
}
function userBinPath() {
  return path.join(USER_DATA(), ytDlpBinName());
}
function resolveYtDlpPath() {
  const userCopy = userBinPath();
  if (fs.existsSync(userCopy)) return userCopy;
  const bundled = path.join(bundledBinDir(), ytDlpBinName());
  if (fs.existsSync(bundled)) return bundled;
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}
// 讓 yt-dlp 找得到 deno（解 JS 挑戰）與 ffmpeg（合併/轉檔）
function spawnEnv() {
  const sep = process.platform === 'win32' ? ';' : ':';
  // NO_COLOR：關閉 yt-dlp 進度行的 ANSI 色碼（macOS 預設會上色，導致百分比解析失敗）
  return { ...process.env, NO_COLOR: '1', PATH: bundledBinDir() + sep + (process.env.PATH || '') };
}

// ---------- yt-dlp 自動更新 ----------
async function ensureWritableYtDlp() {
  const userCopy = userBinPath();
  if (fs.existsSync(userCopy)) return;
  const bundled = path.join(bundledBinDir(), ytDlpBinName());
  if (fs.existsSync(bundled)) {
    try {
      await fsp.copyFile(bundled, userCopy);
      if (process.platform !== 'win32') await fsp.chmod(userCopy, 0o755);
    } catch (e) { console.warn('複製 yt-dlp 失敗:', e.message); }
  }
}
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'lingxiu-cover' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return resolve(httpGetJson(res.headers.location));
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function downloadTo(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'lingxiu-cover' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return resolve(downloadTo(res.headers.location, dest));
      }
      if (res.statusCode !== 200) { file.close(); return reject(new Error('HTTP ' + res.statusCode)); }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', (e) => { file.close(); reject(e); });
  });
}
async function localYtDlpVersion() {
  try {
    const { stdout } = await execFileP(resolveYtDlpPath(), ['--version'], { windowsHide: true, env: spawnEnv() });
    return stdout.trim();
  } catch { return null; }
}
async function autoUpdateYtDlp() {
  try {
    const release = await httpGetJson('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest');
    const latest = ((release && release.tag_name) || '').trim();
    if (!latest) return { updated: false, reason: 'no-tag' };
    const current = await localYtDlpVersion();
    if (current && current === latest) return { updated: false, current };
    const asset = (release.assets || []).find((a) => a.name === ytDlpBinName());
    if (!asset) return { updated: false, reason: 'no-asset' };
    const tmp = userBinPath() + '.download';
    await downloadTo(asset.browser_download_url, tmp);
    if (process.platform !== 'win32') await fsp.chmod(tmp, 0o755);
    await fsp.rename(tmp, userBinPath());
    return { updated: true, from: current, to: latest };
  } catch (e) { return { updated: false, error: e.message }; }
}

// ---------- 媒體下載與快取（無廣告 + 流暢） ----------
function cacheKey(url, kind) {
  const h = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  return `${kind}_${h}`;
}
// 依 cacheKey 前綴找出已快取的檔（音訊副檔名不固定：m4a/webm…）
function findCachedFile(url, kind) {
  const base = cacheKey(url, kind) + '.';
  try {
    const f = fs.readdirSync(CACHE_DIR()).find((n) => n.startsWith(base));
    return f ? path.join(CACHE_DIR(), f) : null;
  } catch { return null; }
}
function fileUrl(p) { return 'file://' + p.replace(/\\/g, '/'); }

const inflight = new Map(); // cacheKey -> Promise<path>

function sendProgress(kind, percent, phase) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('media:progress', { kind, percent, phase });
}

function downloadMedia(url, kind, quality) {
  return new Promise((resolve, reject) => {
    const tmpl = path.join(CACHE_DIR(), `${cacheKey(url, kind)}.%(ext)s`);
    // 音訊：直接下載原生格式（m4a，Chromium 可直接播），不轉檔 → 大幅加快（長音樂尤其明顯）
    // 多重試：YouTube 直鏈偶發 403，重試可自動恢復（macOS 較常見）
    const retry = ['--retries', '20', '--fragment-retries', '20', '--extractor-retries', '3'];
    const args = kind === 'video'
      ? ['-f', `bestvideo[height<=${quality || 1080}]+bestaudio/best`,
         '--merge-output-format', 'mp4', '--no-playlist', '--newline', ...retry,
         '--ffmpeg-location', bundledBinDir(), '-o', tmpl, url]
      : ['-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--newline', ...retry, '-o', tmpl, url];

    const child = spawn(resolveYtDlpPath(), args, { windowsHide: true, env: spawnEnv() });
    let stderr = '';
    let destCount = 0; // 已開始下載的檔數（影片=影像+聲音兩檔）
    const onLine = (buf) => {
      const text = String(buf).replace(/\x1B\[[0-9;]*[A-Za-z]/g, ''); // 去除 ANSI 色碼
      const dests = text.match(/\[download\]\s+Destination:/g);
      if (dests) destCount += dests.length;
      const pcts = text.match(/\[download\]\s+([\d.]+)%/g); // 這批的所有百分比
      if (pcts && pcts.length) {
        const pm = pcts[pcts.length - 1].match(/([\d.]+)%/); // 取最新的一個
        if (pm) {
          let pct = parseFloat(pm[1]);
          if (kind === 'video') { // 兩段：影像→0-50、聲音→50-100
            const phase = Math.min(Math.max(destCount, 1), 2);
            pct = (phase - 1) * 50 + pct / 2;
          }
          if (!isNaN(pct)) sendProgress(kind, pct);
        }
      }
      if (/\[Merger\]|\[ExtractAudio\]/.test(text)) sendProgress(kind, 99); // 合併/轉檔中
    };
    child.stdout.on('data', onLine);
    child.stderr.on('data', (d) => { stderr += d; onLine(d); });
    child.on('error', reject);
    child.on('close', (code) => {
      const out = findCachedFile(url, kind);
      if (code === 0 && out) { sendProgress(kind, 100); resolve(out); }
      else reject(new Error(stderr.split('\n').filter(Boolean).pop() || ('yt-dlp 結束碼 ' + code)));
    });
  });
}

async function ensureMedia(url, kind, quality) {
  if (!url || !/^https?:\/\//i.test(url)) throw new Error('請貼上有效的 YouTube 連結');
  await fsp.mkdir(CACHE_DIR(), { recursive: true });
  const out = findCachedFile(url, kind);
  if (out) {
    fsp.utimes(out, new Date(), new Date()).catch(() => {}); // 觸碰：更新最後使用時間，避免被當成舊快取清掉
    return out;
  }
  const key = cacheKey(url, kind);
  if (inflight.has(key)) return inflight.get(key);
  const p = downloadMedia(url, kind, quality).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ---------- 快取清理 ----------
// 計算 media/ 目前佔用大小（bytes）
async function cacheSize() {
  try {
    const files = await fsp.readdir(CACHE_DIR());
    let total = 0;
    for (const f of files) {
      try { total += (await fsp.stat(path.join(CACHE_DIR(), f))).size; } catch {}
    }
    return total;
  } catch { return 0; }
}
// 清理快取。keepDays<=0 表示清全部（仍保留目前設定在用的背景音樂/敬拜音樂）
async function cleanCache(keepDays) {
  const result = { removed: 0, freed: 0 };
  let files;
  try { files = await fsp.readdir(CACHE_DIR()); } catch { return result; }
  // 目前設定正在用的檔，永不刪
  const cfg = await readConfig();
  const keepPrefixes = [];
  if (cfg.musicUrl) keepPrefixes.push(cacheKey(cfg.musicUrl, 'audio') + '.');
  if (cfg.worshipUrl) keepPrefixes.push(cacheKey(cfg.worshipUrl, 'video') + '.');
  const now = Date.now();
  const cutoff = keepDays > 0 ? now - keepDays * 86400000 : now + 1; // keepDays<=0 → 全數過期
  for (const f of files) {
    if (keepPrefixes.some((p) => f.startsWith(p))) continue;
    const fp = path.join(CACHE_DIR(), f);
    try {
      const st = await fsp.stat(fp);
      if (!st.isFile()) continue;
      const lastUsed = st.mtimeMs; // 觸碰機制讓 mtime = 最後使用時間
      if (lastUsed < cutoff) {
        await fsp.unlink(fp);
        result.removed++;
        result.freed += st.size;
      }
    } catch {}
  }
  return result;
}

// ---------- 設定 ----------
async function readConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(await fsp.readFile(CONFIG_PATH(), 'utf-8')) };
  } catch { return { ...DEFAULT_CONFIG }; }
}
async function writeConfig(cfg) {
  await fsp.mkdir(USER_DATA(), { recursive: true });
  await fsp.writeFile(CONFIG_PATH(), JSON.stringify(cfg, null, 2), 'utf-8');
}
function bgFileUrl(fileName) {
  if (!fileName) return '';
  const p = path.join(BG_DIR(), fileName);
  if (!fs.existsSync(p)) return '';
  return fileUrl(p) + '?t=' + Date.now();
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('config:get', async () => {
    const cfg = await readConfig();
    return { cfg, backgroundUrl: bgFileUrl(cfg.backgroundFile) };
  });
  ipcMain.handle('config:set', async (_e, cfg) => { await writeConfig(cfg); return { ok: true }; });

  ipcMain.handle('bg:save', async (_e, srcPath) => {
    await fsp.mkdir(BG_DIR(), { recursive: true });
    const ext = (path.extname(srcPath) || '.png').toLowerCase();
    const name = 'bg_' + Date.now() + ext;
    await fsp.copyFile(srcPath, path.join(BG_DIR(), name));
    const cfg = await readConfig();
    cfg.backgroundFile = name;
    await writeConfig(cfg);
    return { fileName: name, url: bgFileUrl(name) };
  });

  ipcMain.handle('dialog:pickImage', async () => {
    const r = await dialog.showOpenDialog({
      title: '選擇背景圖片', properties: ['openFile'],
      filters: [{ name: '圖片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
    });
    return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
  });

  // 取得（必要時下載）媒體快取，回傳本地檔 URL
  ipcMain.handle('media:ensure', async (_e, { url, kind, quality }) => {
    try { return { ok: true, path: fileUrl(await ensureMedia(url, kind, quality)) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('media:status', async (_e, { url, kind }) => {
    try { return { cached: !!url && !!findCachedFile(url, kind) }; }
    catch { return { cached: false }; }
  });
  ipcMain.handle('cache:size', async () => cacheSize());
  ipcMain.handle('cache:clean', async (_e, keepDays) => cleanCache(typeof keepDays === 'number' ? keepDays : 0));

  ipcMain.handle('ytdlp:update', async () => autoUpdateYtDlp());
  ipcMain.handle('ytdlp:version', async () => localYtDlpVersion());

  // ---------- App 自動更新（electron-updater / GitHub Releases） ----------
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:checkUpdate', async () => {
    if (!app.isPackaged) return { ok: false, error: '開發模式不檢查更新（請用打包後的版本）' };
    try {
      const r = await autoUpdater.checkForUpdates();
      const info = r && r.updateInfo;
      const available = !!info && info.version !== app.getVersion();
      return { ok: true, available, version: info ? info.version : app.getVersion() };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('app:downloadUpdate', async () => {
    try { await autoUpdater.downloadUpdate(); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('app:quitAndInstall', () => { autoUpdater.quitAndInstall(); });

  ipcMain.handle('open:external', async (_e, url) => { shell.openExternal(url); });

  ipcMain.handle('win:minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.handle('win:close', () => { if (mainWindow) mainWindow.close(); });
  ipcMain.handle('clipboard:read', () => clipboard.readText());
}

// ---------- 視窗 ----------
let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 720, minWidth: 640, minHeight: 360,
    backgroundColor: '#000000', title: '靈修封面', autoHideMenuBar: true,
    frame: false,            // 隱藏系統標題列（分享畫面更乾淨）
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  mainWindow.setAspectRatio(16 / 9); // 鎖 16:9，可自由縮放
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 右鍵複製/貼上選單（無邊框視窗預設沒有）
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const tmpl = [];
    if (params.isEditable) {
      tmpl.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' },
                { type: 'separator' }, { role: 'selectAll' });
    } else if (params.selectionText) {
      tmpl.push({ role: 'copy' }, { type: 'separator' }, { role: 'selectAll' });
    }
    if (tmpl.length) Menu.buildFromTemplate(tmpl).popup({ window: mainWindow });
  });

  // 視窗載入完成後，檢查是否有新版本（不經簽章，macOS 也適用）
  mainWindow.webContents.once('did-finish-load', () => { checkLatestVersion(); });
}

// ---------- App 自動更新設定 ----------
function sendUpdate(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(channel, payload);
}
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;            // 由使用者按下載才下載
  autoUpdater.autoInstallOnAppQuit = true;     // 下載後關閉 app 時自動安裝
  autoUpdater.on('update-available', (info) => sendUpdate('update:available', { version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdate('update:none', {}));
  autoUpdater.on('error', (err) => sendUpdate('update:error', { error: String(err && err.message || err) }));
  autoUpdater.on('download-progress', (p) => sendUpdate('update:progress', { percent: p.percent }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate('update:downloaded', { version: info.version }));
}

// ---------- 開機版本檢查（純比對版本號 + 給下載連結，不需簽章，macOS 也適用）----------
const RELEASES_API = 'https://api.github.com/repos/Living-water-church-chiayi/zoomshare/releases/latest';
const RELEASES_PAGE = 'https://github.com/Living-water-church-chiayi/zoomshare/releases/latest';
function isNewerVersion(a, b) { // a 是否比 b 新
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}
async function checkLatestVersion() {
  try {
    const rel = await httpGetJson(RELEASES_API);
    const tag = ((rel && rel.tag_name) || '').replace(/^v/i, '').trim();
    if (tag && isNewerVersion(tag, app.getVersion())) {
      sendUpdate('app:new-version', { version: tag, url: RELEASES_PAGE });
    }
  } catch (e) { /* 靜默失敗，不打擾 */ }
}

app.whenReady().then(async () => {
  registerIpc();
  await ensureWritableYtDlp();
  createWindow();
  setupAutoUpdater();
  autoUpdateYtDlp().then((r) => { if (r && r.updated) console.log('yt-dlp 已更新至', r.to); });
  // 開機自動清理過久沒用到的媒體快取（依設定的保留天數；保留目前在用的背景音樂/敬拜音樂）
  readConfig().then((cfg) => {
    const days = typeof cfg.cacheKeepDays === 'number' ? cfg.cacheKeepDays : 30;
    if (days > 0) cleanCache(days).then((r) => {
      if (r.removed) console.log(`已清理 ${r.removed} 個舊快取，釋放 ${(r.freed / 1048576).toFixed(0)} MB`);
    });
  });
  // 開機靜默檢查 App 更新（有新版時前端會收到 update:available 提示）
  if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {});
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
