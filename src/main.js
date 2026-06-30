'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const https = require('https');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);

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
  readingLines: ['《歌羅西書》3:12-25', '《竭誠獻上》《靈命日糧》'],
  dateAuto: true,
  dateManual: '',
  backgroundFile: '',
  fillMode: 'blur',
  musicUrl: '',
  worshipUrl: '',
  musicVolume: 0.8,
  autoPlayMusic: true,
  videoQuality: 1080,
  fontFamily: 'sans-bold'
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
  return { ...process.env, PATH: bundledBinDir() + sep + (process.env.PATH || '') };
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
function cachedFilePath(url, kind) {
  const ext = kind === 'video' ? 'mp4' : 'mp3';
  return path.join(CACHE_DIR(), `${cacheKey(url, kind)}.${ext}`);
}
function fileUrl(p) { return 'file://' + p.replace(/\\/g, '/'); }

const inflight = new Map(); // cacheKey -> Promise<path>

function sendProgress(kind, percent, phase) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('media:progress', { kind, percent, phase });
}

function downloadMedia(url, kind, quality) {
  return new Promise((resolve, reject) => {
    const out = cachedFilePath(url, kind);
    const tmpl = path.join(CACHE_DIR(), `${cacheKey(url, kind)}.%(ext)s`);
    const args = kind === 'video'
      ? ['-f', `bestvideo[height<=${quality || 1080}]+bestaudio/best`,
         '--merge-output-format', 'mp4', '--no-playlist', '--newline',
         '--ffmpeg-location', bundledBinDir(), '-o', tmpl, url]
      : ['-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--no-playlist', '--newline',
         '--ffmpeg-location', bundledBinDir(), '-o', tmpl, url];

    const child = spawn(resolveYtDlpPath(), args, { windowsHide: true, env: spawnEnv() });
    let stderr = '';
    const onLine = (buf) => {
      const m = String(buf).match(/\[download\]\s+([\d.]+)%/);
      if (m) sendProgress(kind, parseFloat(m[1]));
    };
    child.stdout.on('data', onLine);
    child.stderr.on('data', (d) => { stderr += d; onLine(d); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(out)) { sendProgress(kind, 100); resolve(out); }
      else reject(new Error(stderr.split('\n').filter(Boolean).pop() || ('yt-dlp 結束碼 ' + code)));
    });
  });
}

async function ensureMedia(url, kind, quality) {
  if (!url || !/^https?:\/\//i.test(url)) throw new Error('請貼上有效的 YouTube 連結');
  await fsp.mkdir(CACHE_DIR(), { recursive: true });
  const out = cachedFilePath(url, kind);
  if (fs.existsSync(out)) return out; // 已快取，直接用
  const key = cacheKey(url, kind);
  if (inflight.has(key)) return inflight.get(key);
  const p = downloadMedia(url, kind, quality).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
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
    try { return { cached: !!url && fs.existsSync(cachedFilePath(url, kind)) }; }
    catch { return { cached: false }; }
  });

  ipcMain.handle('ytdlp:update', async () => autoUpdateYtDlp());
  ipcMain.handle('ytdlp:version', async () => localYtDlpVersion());
  ipcMain.handle('open:external', async (_e, url) => { shell.openExternal(url); });

  ipcMain.handle('win:minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.handle('win:close', () => { if (mainWindow) mainWindow.close(); });
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
}

app.whenReady().then(async () => {
  registerIpc();
  await ensureWritableYtDlp();
  createWindow();
  autoUpdateYtDlp().then((r) => { if (r && r.updated) console.log('yt-dlp 已更新至', r.to); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
