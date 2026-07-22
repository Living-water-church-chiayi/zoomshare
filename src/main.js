'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const https = require('https');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { fileURLToPath, pathToFileURL } = require('url');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);
const { autoUpdater } = require('electron-updater');
const { PresenceManager } = require('./presence');

const presenceManager = new PresenceManager();
const APP_ICON_PATH = path.join(__dirname, 'renderer', 'images', 'app-icon.png');

// macOS 上 Zoom「分享聲音」可能讓 Chromium 將虛擬音訊裝置當成輸入端。
// 本程式只播放媒體，因此在 AudioManager 建立前強制所有輸入串流使用假裝置，
// 保留正常音訊輸出，同時避免觸發系統麥克風權限。
function configurePlaybackOnlyAudio(electronApp, platform = process.platform) {
  if (platform === 'darwin') electronApp.commandLine.appendSwitch('disable-audio-input');
}
configurePlaybackOnlyAudio(app);

// 允許背景音樂與敬拜影片在沒有使用者手勢時自動播放。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.exit(0);
}

const USER_DATA = () => app.getPath('userData');
const CONFIG_PATH = () => path.join(USER_DATA(), 'config.json');
const BG_DIR = () => path.join(USER_DATA(), 'backgrounds');
const CACHE_DIR = () => path.join(USER_DATA(), 'media'); // 避免使用 cache，以免在 Windows 與 Electron 的 Cache 目錄衝突。

const HTTP_TIMEOUT_MS = 20_000;
const HTTP_MAX_REDIRECTS = 5;
const HTTP_MAX_JSON_BYTES = 2 * 1024 * 1024;
const HTTP_MAX_TEXT_BYTES = 8 * 1024 * 1024;
const HTTP_MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
const YOUTUBE_OEMBED_TIMEOUT_MS = 5_000;
const YOUTUBE_METADATA_TIMEOUT_MS = 15_000;

const DEFAULT_CONFIG = {
  title1: '靈修班即將開始',
  title2: '歡迎聖靈與我們同在',
  title3: '讓我們一起預備聖經',
  scriptureLabel: '本日經文：',
  scriptureBook: '提摩太前書',
  scriptureStartCh: 5, scriptureStartV: 1,
  scriptureEndCh: 5, scriptureEndV: 25,
  readingExtra: '竭誠獻上',
  dateAuto: true,
  dateManual: '',
  backgroundFile: '',
  fillMode: 'blur',
  musicUrl: '',
  worshipUrl: '',
  useWorshipPreset: false,
  worshipPreset: '',
  worshipTitle: '',
  worshipTitleUrl: '',
  customWorshipPresets: [],
  musicVolume: 0.8,
  autoPlayMusic: true,
  preventLeftArrowWorship: true,
  videoQuality: 1080,
  cacheKeepDays: 30,
  fontFamily: 'sans-bold',
  zoomUrl: 'https://us06web.zoom.us/j/77730692079?pwd=EbYm30dRERJb8FI3GRHadpkqdNLfE4.1',
  // 開機自動依日期抓取經文的 Google 試算表。
  scheduleEnabled: true,
  scheduleUrl: 'https://docs.google.com/spreadsheets/d/11O0As3DWpT45otcL5T7BadMpPVWcWKAoiZ5OUPocMpA/edit?usp=sharing',
  skippedVersion: '' // 使用者選擇略過的版本。
};

// ---------- 二進位工具位置（yt-dlp / deno / ffmpeg） ----------
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
function spawnEnv() {
  const sep = process.platform === 'win32' ? ';' : ':';
  // 關閉 ANSI 顏色，並讓 yt-dlp 找得到內附的 deno 與 ffmpeg。
  return { ...process.env, NO_COLOR: '1', PATH: bundledBinDir() + sep + (process.env.PATH || '') };
}

// Chromium 在 ZoomAudioDevice 成為預設裝置時，可能把純播放串流當成
// 雙向 CoreAudio 串流，因而讓 macOS 顯示麥克風權限。macOS 版改由一個
// 只使用 AVPlayer 輸出的原生小幫手播放聲音，renderer 只負責靜音畫面。
class NativeMacAudioController {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.spawnProcess = options.spawnProcess || spawn;
    this.exists = options.exists || fs.existsSync;
    this.child = null;
  }

  helperPath() {
    if (app.isPackaged) return path.join(process.resourcesPath, 'bin', 'lingxiu-audio-player');
    return path.join(__dirname, '..', 'resources', 'bin', 'mac', 'lingxiu-audio-player');
  }

  available() {
    return this.platform === 'darwin' && this.exists(this.helperPath());
  }

  ensureProcess() {
    if (this.child && this.child.exitCode === null && !this.child.killed) return this.child;
    if (!this.available()) throw new Error('找不到 macOS 原生音訊播放器');
    const child = this.spawnProcess(this.helperPath(), [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.child = child;
    child.stdin.on('error', () => {});
    child.stdout.on('data', () => {});
    child.stderr.on('data', (chunk) => {
      const message = String(chunk || '').trim();
      if (message) console.warn('原生音訊播放器：', message);
    });
    child.on('error', (error) => {
      console.warn('原生音訊播放器啟動失敗：', error.message);
      if (this.child === child) this.child = null;
    });
    child.on('exit', () => { if (this.child === child) this.child = null; });
    return child;
  }

  send(command) {
    const child = this.ensureProcess();
    child.stdin.write(`${JSON.stringify(command)}\n`);
    return { ok: true };
  }

  close() {
    const child = this.child;
    this.child = null;
    if (!child || child.killed) return;
    try { child.stdin.write('{"action":"shutdown"}\n'); } catch {}
    try { child.stdin.end(); } catch {}
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, 800);
    if (typeof timer.unref === 'function') timer.unref();
  }
}

const nativeMacAudio = new NativeMacAudioController();

// ---------- yt-dlp 自動更新 ----------
async function ensureWritableYtDlp() {
  const userCopy = userBinPath();
  await fsp.mkdir(USER_DATA(), { recursive: true });
  if (fs.existsSync(userCopy)) {
    if (process.platform !== 'win32') await fsp.chmod(userCopy, 0o755).catch(() => {});
    return;
  }
  const backup = userCopy + '.old';
  if (fs.existsSync(backup)) {
    try {
      await fsp.rename(backup, userCopy);
      if (process.platform !== 'win32') await fsp.chmod(userCopy, 0o755);
      return;
    } catch {}
  }
  const bundled = path.join(bundledBinDir(), ytDlpBinName());
  if (fs.existsSync(bundled)) {
    try {
      await fsp.copyFile(bundled, userCopy);
      if (process.platform !== 'win32') await fsp.chmod(userCopy, 0o755);
    } catch (e) { console.warn('複製 yt-dlp 失敗：', e.message); }
  }
}

function parseHttpsUrl(value, base) {
  let parsed;
  try { parsed = new URL(String(value), base); }
  catch { throw new Error('無效的網址'); }
  if (parsed.protocol !== 'https:') throw new Error('只允許 HTTPS 網址');
  if (parsed.username || parsed.password) throw new Error('網址不可包含帳號或密碼');
  return parsed;
}

function getHttpsResponse(url, headers, redirectCount = 0, timeoutMs = HTTP_TIMEOUT_MS) {
  const target = parseHttpsUrl(url);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = https.get(target, { headers }, (response) => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400) {
        const location = response.headers.location;
        response.resume();
        if (!location) return finishReject(new Error(`HTTP ${status} 未提供轉址位置`));
        if (redirectCount >= HTTP_MAX_REDIRECTS) return finishReject(new Error('HTTP 轉址次數過多'));
        let next;
        try { next = parseHttpsUrl(location, target); }
        catch (error) { return finishReject(error); }
        settled = true;
        getHttpsResponse(next, headers, redirectCount + 1, timeoutMs).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return finishReject(new Error(`HTTP ${status || '錯誤'}`));
      }
      settled = true;
      resolve(response);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`連線逾時（${timeoutMs / 1000} 秒）`)));
    request.on('error', finishReject);
  });
}

async function readHttpsBody(url, headers, maxBytes, timeoutMs = HTTP_TIMEOUT_MS) {
  const response = await getHttpsResponse(url, headers, 0, timeoutMs);
  const declaredLength = Number(response.headers['content-length'] || 0);
  if (declaredLength > maxBytes) {
    response.destroy();
    throw new Error('伺服器回應超過允許大小');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      response.destroy();
      reject(error);
    };
    response.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) return fail(new Error('伺服器回應超過允許大小'));
      chunks.push(chunk);
    });
    response.on('aborted', () => fail(new Error('伺服器中斷連線')));
    response.on('error', fail);
    response.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, total).toString('utf8'));
    });
  });
}

async function httpGetJson(url, timeoutMs = HTTP_TIMEOUT_MS) {
  const text = await readHttpsBody(url, {
    'User-Agent': 'lingxiu-cover',
    Accept: 'application/vnd.github+json, application/json'
  }, HTTP_MAX_JSON_BYTES, timeoutMs);
  try { return JSON.parse(text); }
  catch { throw new Error('伺服器回傳的 JSON 格式不正確'); }
}

function httpGetText(url) {
  return readHttpsBody(url, {
    'User-Agent': 'Mozilla/5.0 lingxiu-cover',
    'Accept-Encoding': 'identity',
    'Cache-Control': 'no-cache, no-store, max-age=0',
    Pragma: 'no-cache'
  }, HTTP_MAX_TEXT_BYTES);
}

// ---------- 依日期自動抓取經文（Google 試算表 CSV） ----------
// 中文數字轉阿拉伯數字，支援章節常見的一、十、百位寫法。
function cnToNum(str) {
  str = String(str || '').trim();
  if (str === '') return NaN;
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const d = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const u = { 十: 10, 百: 100 };
  let total = 0, cur = 0;
  for (const ch of str) {
    if (ch in d) cur = d[ch];
    else if (ch in u) { total += (cur === 0 ? 1 : cur) * u[ch]; cur = 0; }
  }
  total += cur;
  return total || NaN;
}
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)));
}
function htmlToText(html) {
  return decodeHtml(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<sup\b[^>]*class\s*=\s*["'][^"']*\bversenum\b[^"']*["'][^>]*>\s*(\d+)\s*<\/sup>/gi, '\n$1')
    .replace(/<span\b[^>]*class\s*=\s*["'][^"']*\bchapternum\b[^"']*["'][^>]*>\s*(\d+)\s*<\/span>/gi, '\n$1')
    .replace(/<h[1-6][^>]*>/gi, '\n')
    .replace(/<\/p>|<br\s*\/?>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim());
}

function trimBetween(text, startRe, endRe) {
  const start = text.search(startRe);
  if (start < 0) return '';
  const rest = text.slice(start);
  const end = rest.search(endRe);
  return end > 0 ? rest.slice(0, end).trim() : rest.trim();
}

function cleanBibleText(text, ref) {
  return cleanBibleTextV2(text, ref);
}

function normalizeBibleLeadingReferenceLine(line, ref, beforeFirstVerse) {
  if (!beforeFirstVerse) return line;
  const startChapter = Math.max(1, Number(ref && ref.startCh) || 1);
  const startVerse = Math.max(1, Number(ref && ref.startV) || 1);
  const combinedStart = String(line || '').match(/^(\d+)\s+(\d+)\s+(.+)$/);
  if (combinedStart && startChapter !== startVerse
    && Number(combinedStart[1]) === startChapter && Number(combinedStart[2]) === startVerse) {
    return `${combinedStart[2]} ${combinedStart[3]}`;
  }
  const chapterOnlyStart = String(line || '').match(/^(\d+)\s+(.+)$/);
  if (chapterOnlyStart && startVerse === 1 && startChapter !== 1 && Number(chapterOnlyStart[1]) === startChapter) {
    return `1 ${chapterOnlyStart[2]}`;
  }
  return line;
}

function cleanBibleTextV2(text, ref) {
  const navRe = /^(menu|account|read|study|plus|Bible Gateway|Available Versions|Audio Bibles|Reading Plans|Advanced Search|Read full chapter|Next|Previous|Prev)$/i;
  const stopRe = /^(?:Footnotes?|Cross references?|Crossrefs?|腳註|註腳|串珠|交叉參照|交叉引用)(?:\b|$|[:：])/i;
  const headingRe = /^[^\d，。；：！？、,.!?"'「」『』（）()]{2,24}$/;
  const lines = String(text || '')
    .split(/\n+/)
    .map((line) => line.replace(/\[[a-z]\]/gi, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const verses = [];
  let cur = '';
  for (const originalLine of lines) {
    const line = normalizeBibleLeadingReferenceLine(originalLine, ref, !cur);
    if (stopRe.test(line)) break;
    if (navRe.test(line)) continue;
    if (/^\d+\s*\S/.test(line)) {
      if (cur) verses.push(cur);
      cur = line;
    } else if (cur && !headingRe.test(line)) {
      cur += ' ' + line;
    }
  }
  if (cur) verses.push(cur);
  return verses.join('\n').trim();
}

const BIBLE_GATEWAY_BOOKS = {
  創世記: 'Genesis', 出埃及記: 'Exodus', 利未記: 'Leviticus', 民數記: 'Numbers', 申命記: 'Deuteronomy',
  約書亞記: 'Joshua', 士師記: 'Judges', 路得記: 'Ruth', 撒母耳記上: '1 Samuel', 撒母耳記下: '2 Samuel',
  列王紀上: '1 Kings', 列王紀下: '2 Kings', 歷代志上: '1 Chronicles', 歷代志下: '2 Chronicles',
  以斯拉記: 'Ezra', 尼希米記: 'Nehemiah', 以斯帖記: 'Esther', 約伯記: 'Job', 詩篇: 'Psalm',
  箴言: 'Proverbs', 傳道書: 'Ecclesiastes', 雅歌: 'Song of Songs', 以賽亞書: 'Isaiah', 耶利米書: 'Jeremiah',
  耶利米哀歌: 'Lamentations', 以西結書: 'Ezekiel', 但以理書: 'Daniel', 何西阿書: 'Hosea', 約珥書: 'Joel',
  阿摩司書: 'Amos', 俄巴底亞書: 'Obadiah', 約拿書: 'Jonah', 彌迦書: 'Micah', 那鴻書: 'Nahum',
  哈巴谷書: 'Habakkuk', 西番雅書: 'Zephaniah', 哈該書: 'Haggai', 撒迦利亞書: 'Zechariah', 瑪拉基書: 'Malachi',
  馬太福音: 'Matthew', 馬可福音: 'Mark', 路加福音: 'Luke', 約翰福音: 'John', 使徒行傳: 'Acts',
  羅馬書: 'Romans', 哥林多前書: '1 Corinthians', 哥林多後書: '2 Corinthians', 加拉太書: 'Galatians',
  以弗所書: 'Ephesians', 腓立比書: 'Philippians', 歌羅西書: 'Colossians',
  帖撒羅尼迦前書: '1 Thessalonians', 帖撒羅尼迦後書: '2 Thessalonians',
  提摩太前書: '1 Timothy', 提摩太後書: '2 Timothy', 提多書: 'Titus', 腓利門書: 'Philemon',
  希伯來書: 'Hebrews', 雅各書: 'James', 彼得前書: '1 Peter', 彼得後書: '2 Peter',
  約翰一書: '1 John', 約翰二書: '2 John', 約翰三書: '3 John', 猶大書: 'Jude', 啟示錄: 'Revelation'
};
function todayChineseDate() {
  const now = new Date();
  return `${now.getMonth() + 1}月${now.getDate()}日`;
}

function parseUtmostHtml(html, source) {
  const dateMatch = html.match(/class=['"]calendar-toggle['"][^>]*>([\s\S]*?)<span/i);
  const titleMatch = html.match(/<h2[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>\s*<\/h2>/i);
  const readingMatch = html.match(/id=["']bible-in-a-year-box["'][^>]*>([\s\S]*?)<\/p>/i);
  const verseMatch = html.match(/id=["']key-verse-box["'][^>]*>[\s\S]*?<h4>([\s\S]*?)<\/h4>/i);
  const contentMatch = html.match(/<section[^>]*class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/section>/i);
  if (dateMatch || titleMatch || verseMatch || contentMatch) {
    const date = htmlToText(dateMatch ? dateMatch[1] : '').trim();
    const title = htmlToText(titleMatch ? titleMatch[1] : '').trim();
    const reading = htmlToText(readingMatch ? readingMatch[1] : '').replace(/^全年讀經：\s*/, '').trim();
    const verse = htmlToText(verseMatch ? verseMatch[1] : '').trim();
    const contentHtml = (contentMatch ? contentMatch[1] : '').split(/<div[^>]*class=["'][^"']*wisdom-wrapper/i)[0];
    const body = htmlToText(contentHtml)
      .replace(/^反思與禱告[\s\S]*$/m, '')
      .replace(/Twitter|Facebook|Telegram|LINE|Email/gi, '')
      .replace(/-->\s*$/g, '')
      .trim();
    return { ok: !!body, date, title, reading, verse, body, source, error: body ? '' : '今天的竭誠獻上內容還沒有抓到' };
  }

  const text = htmlToText(html);
  const lines = text.split(/\n+/).map((line) => line.replace(/^#+\s*/, '').trim()).filter(Boolean);
  const dateIndex = lines.findIndex((line) => /^\d{1,2}月\d{1,2}日$/.test(line));
  const date = dateIndex >= 0 ? lines[dateIndex] : '';
  const title = lines.slice(Math.max(dateIndex + 1, 0)).find((line) =>
    line.length <= 24 &&
    !/^(日|一|二|三|四|五|六|全年讀經|國語|廣東話|下載MP3|Facebook|Twitter|電子郵件|列印)$/.test(line) &&
    !/^約|^\d{1,2}月|^Today|竭誠獻上/.test(line)
  ) || '';
  const reading = ((text.match(/全年讀經：\s*([^\n]+)/) || [,''])[1] || '').trim();
  const verseIndex = lines.findIndex((line) => /[—-].+\d+章\d+節/.test(line));
  if (verseIndex < 0) {
    return { ok: false, date, title, reading, verse: '', body: '', source, error: '今天的竭誠獻上內容還沒有抓到' };
  }
  const verse = verseIndex >= 0 ? lines[verseIndex] : '';
  const bodyLines = [];
  for (const line of lines.slice(verseIndex + 1)) {
    if (/^(反思與禱告|與朋友分享今日的靈修|每日接收智慧的話語|My Utmost for His Highest|©|Loading|You must be|登入|使用者帳號|密碼|訂閱|地區|Δ)$/.test(line)) break;
    if (/^(Facebook|Twitter|電子郵件|列印|\*)$/.test(line)) continue;
    bodyLines.push(line);
  }
  const cleanBody = bodyLines
    .join('\n\n')
    .replace(/Twitter|Facebook|Telegram|LINE|Email/gi, '')
    .replace(/-->\s*$/g, '')
    .trim();
  return { ok: !!cleanBody, date, title, reading, verse, body: cleanBody, source, error: cleanBody ? '' : '今天的竭誠獻上內容還沒有抓到' };
}

async function fetchUtmostToday() {
  const base = 'https://traditional-utmost.org/';
  const stamp = Date.now();
  const urls = [
    `${base}?today=${encodeURIComponent(todayChineseDate())}&t=${stamp}`,
    `${base}?t=${stamp}`,
    base
  ];
  let best = null;
  let lastError = null;
  for (const url of urls) {
    try {
      const parsed = parseUtmostHtml(await httpGetText(url), base);
      if (parsed.ok && parsed.date === todayChineseDate()) return parsed;
      if (!best || (parsed.body || '').length > (best.body || '').length) best = parsed;
    } catch (error) {
      lastError = error;
    }
  }
  return best || {
    ok: false, date: '', title: '', reading: '', verse: '', body: '', source: base,
    error: lastError ? `讀取竭誠獻上失敗：${lastError.message}` : '今天的竭誠獻上內容還沒有抓到'
  };
}
async function fetchBiblePassage(ref) {
  ref = normalizeBibleRef(ref);
  const book = BIBLE_GATEWAY_BOOKS[ref.book] || ref.book;
  const endRef = ref.startCh === ref.endCh ? String(ref.endV) : `${ref.endCh}:${ref.endV}`;
  const query = `${book} ${ref.startCh}:${ref.startV}-${endRef}`;
  const displayRef = `${ref.book} ${ref.startCh}:${ref.startV}-${endRef}`;
  const url = 'https://www.biblegateway.com/passage/?search=' + encodeURIComponent(query) + '&version=CUVMPT';
  const html = await httpGetText(url);
  const passageMatch = html.match(/<div[^>]*class="[^"]*passage-text[^"]*"[^>]*>([\s\S]*?)<div[^>]*class="[^"]*publisher-info-bottom/);
  const passageHtml = String(passageMatch ? passageMatch[1] : html)
    .replace(/<sup[^>]*(?:footnote|crossreference)[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<a[^>]*(?:footnote|crossreference)[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/<(?:div|section)[^>]*(?:footnotes?|crossrefs?|cross-references?)[^>]*>[\s\S]*$/gi, '');
  let body = htmlToText(passageHtml);
  body = body
    .replace(/^.*Bible Gateway\s*/is, '')
    .replace(/^[\s\S]*?Update\s*/i, '')
    .replace(/(?:Footnotes?|Cross references?|Crossrefs?|腳註|註腳|串珠|交叉參照|交叉引用)[\s\S]*$/i, '')
    .replace(/Chinese Union Version.*$/gis, '')
    .replace(/Read full chapter.*$/gis, '')
    .replace(/\bdropdown\b.*$/gis, '')
    .replace(/^\s*[\u3400-\u9fff，。：「」『』；！？、（）\s]{2,40}\n(?=\s*\d+\s*\S)/, '')
    .trim();
  body = cleanBibleTextV2(body, ref);
  if (!body) return { ok: false, title: displayRef, query, body: '', source: url, error: '無法取得指定的經文內容' };
  return { ok: true, title: displayRef, query, body, source: url };
}
function sheetCsvUrl(url) {
  const m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9\-_]+)/);
  if (!m) return null;
  const g = String(url).match(/[#&?]gid=(\d+)/);
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${g ? g[1] : '0'}`;
}
// 讀取試算表並找出今天的列，回傳書卷與起訖章節。
async function fetchScheduleToday(url) {
  const csvUrl = sheetCsvUrl(url);
  if (!csvUrl) return { ok: false, error: '無法解析試算表連結' };
  let text;
  try { text = await httpGetText(csvUrl); } catch (e) { return { ok: false, error: e.message }; }
  const now = new Date();
  const ty = now.getFullYear();
  const tm = now.getMonth() + 1;
  const td = now.getDate();
  const mkRow = (c) => ({ book: c[1], startCh: cnToNum(c[2]), startV: cnToNum(c[3]), endCh: cnToNum(c[4]), endV: cnToNum(c[5]) });
  let exact = null;
  let loose = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line).map((s) => s.trim());
    if (cols.length < 6) continue;
    const parts = cols[0].split(/[\/\-.]/).map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
    if (parts.length < 2) continue;
    let yr = null;
    const md = [];
    for (const p of parts) { if (p >= 1000 && yr === null) yr = p; else md.push(p); }
    if (md.length < 2) continue;
    const mo = md[0];
    const da = md[1];
    if (yr !== null) {
      if (yr === ty && mo === tm && da === td && !exact) exact = mkRow(cols);
    } else if (mo === tm && da === td && !loose) {
      loose = mkRow(cols);
    }
  }
  const row = exact || loose;
  return row ? { ok: true, found: true, row } : { ok: true, found: false };
}
function sizeLimitTransform(maxBytes) {
  let total = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) callback(new Error('下載檔案超過允許大小'));
      else callback(null, chunk);
    }
  });
}

async function downloadTo(url, dest, maxBytes = HTTP_MAX_DOWNLOAD_BYTES) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const response = await getHttpsResponse(url, { 'User-Agent': 'lingxiu-cover' });
  const declaredLength = Number(response.headers['content-length'] || 0);
  if (declaredLength > maxBytes) {
    response.destroy();
    throw new Error('下載檔案超過允許大小');
  }
  try {
    await pipeline(response, sizeLimitTransform(maxBytes), fs.createWriteStream(dest, { flags: 'w' }));
    const stat = await fsp.stat(dest);
    if (!stat.isFile() || stat.size === 0) throw new Error('下載到的檔案是空的');
  } catch (error) {
    await fsp.unlink(dest).catch(() => {});
    throw error;
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function replaceFileSafely(tempPath, destinationPath, backupSuffix = '.old') {
  try {
    await fsp.rename(tempPath, destinationPath);
    return;
  } catch (error) {
    if (process.platform !== 'win32' || !['EACCES', 'EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
  }

  // Windows 有時無法直接覆蓋既有檔案；保留備份，失敗時立即還原。
  const backupPath = destinationPath + backupSuffix;
  await fsp.unlink(backupPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  let movedExisting = false;
  try {
    await fsp.rename(destinationPath, backupPath);
    movedExisting = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await fsp.rename(tempPath, destinationPath);
  } catch (error) {
    if (movedExisting) await fsp.rename(backupPath, destinationPath).catch(() => {});
    throw error;
  }
  if (movedExisting) await fsp.unlink(backupPath).catch(() => {});
}

async function localYtDlpVersion() {
  try {
    const { stdout } = await execFileP(resolveYtDlpPath(), ['--version'], { windowsHide: true, env: spawnEnv() });
    return stdout.trim();
  } catch { return null; }
}

let ytDlpUpdatePromise = null;

async function performAutoUpdateYtDlp() {
  const tmp = process.platform === 'win32'
    ? `${userBinPath()}.download-${process.pid}.exe`
    : `${userBinPath()}.download-${process.pid}`;
  try {
    const release = await httpGetJson('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest');
    const latest = ((release && release.tag_name) || '').trim();
    if (!latest) return { updated: false, reason: 'no-tag' };
    const current = await localYtDlpVersion();
    if (current && current === latest) return { updated: false, current };
    const asset = (release.assets || []).find((a) => a.name === ytDlpBinName());
    if (!asset) return { updated: false, reason: 'no-asset' };
    const digestMatch = String(asset.digest || '').match(/^sha256:([a-f0-9]{64})$/i);
    if (!digestMatch) throw new Error('yt-dlp 發行檔缺少 SHA-256 驗證碼');
    await downloadTo(asset.browser_download_url, tmp);
    const actualDigest = await sha256File(tmp);
    if (actualDigest.toLowerCase() !== digestMatch[1].toLowerCase()) {
      throw new Error('yt-dlp 下載檔案的 SHA-256 驗證失敗');
    }
    if (process.platform !== 'win32') await fsp.chmod(tmp, 0o755);
    const stat = await fsp.stat(tmp);
    if (!stat.isFile() || stat.size < 100_000) throw new Error('下載的 yt-dlp 檔案不完整');
    const { stdout } = await execFileP(tmp, ['--version'], { windowsHide: true, env: spawnEnv() });
    if (!String(stdout || '').trim()) throw new Error('下載的 yt-dlp 無法執行');
    await replaceFileSafely(tmp, userBinPath(), '.old');
    return { updated: true, from: current, to: latest };
  } catch (e) {
    return { updated: false, error: e.message };
  } finally {
    await fsp.unlink(tmp).catch(() => {});
  }
}

function autoUpdateYtDlp() {
  if (!ytDlpUpdatePromise) {
    ytDlpUpdatePromise = performAutoUpdateYtDlp().finally(() => { ytDlpUpdatePromise = null; });
  }
  return ytDlpUpdatePromise;
}

// ---------- 媒體下載與快取 ----------
function cacheKey(url, kind, quality) {
  const h = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  const qualitySuffix = kind === 'video' ? `_q${quality || 1080}` : '';
  return `${kind}_${h}${qualitySuffix}`;
}

const FINAL_MEDIA_EXTENSIONS = new Set([
  '.aac', '.flac', '.m4a', '.mkv', '.mov', '.mp3', '.mp4', '.ogg', '.opus', '.wav', '.webm'
]);

function normalizeMediaRequest(url, kind, quality) {
  if (kind !== 'audio' && kind !== 'video') throw new Error('媒體類型必須是 audio 或 video');
  if (typeof url !== 'string' || url.length === 0 || url.length > 4096) throw new Error('請輸入有效的 YouTube 網址');
  let parsed;
  try { parsed = new URL(url.trim()); }
  catch { throw new Error('請輸入有效的 YouTube 網址'); }
  const host = parsed.hostname.toLowerCase();
  const isYouTube = host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com');
  if (parsed.protocol !== 'https:' || !isYouTube || parsed.username || parsed.password) {
    throw new Error('請輸入有效的 HTTPS YouTube 網址');
  }
  let normalizedQuality = 1080;
  if (kind === 'video' && quality != null) {
    normalizedQuality = Number(quality);
    if (!Number.isFinite(normalizedQuality) || !Number.isInteger(normalizedQuality) || normalizedQuality < 144 || normalizedQuality > 2160) {
      throw new Error('影片畫質必須是 144 到 2160 的整數');
    }
  }
  return { url: parsed.href, kind, quality: normalizedQuality };
}

function sanitizeMediaTitle(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 128);
}

function stripWorshipTitleNoise(value) {
  const noise = '(?:(?:\\bofficial(?:\\s+(?:music\\s+)?video|\\s+mv|\\s+audio)?\\b|\\blyrics?\\b|\\blyric\\s+video\\b|\\bmusic\\s+video\\b|\\bmv\\b|\\bm\\/v\\b|\\blive(?:\\s+(?:session|version|worship))?\\b|\\b4k\\b|\\bhd\\b)|中英字幕|中文字幕|動態歌詞|歌詞版(?:mv)?|官方(?:動態)?歌詞(?:版)?(?:mv)?|官方(?:音樂)?(?:錄影帶|影片|mv|版)?|現場版)';
  let title = sanitizeMediaTitle(value);
  if (!title) return '';
  title = title
    .replace(new RegExp(`[\\[(（【《][^\\]\\)）】》]{0,80}${noise}[^\\]\\)）】》]{0,80}[\\]\\)）】》]`, 'gi'), ' ')
    .replace(/^[【\[][^】\]]{0,40}(?:敬拜|讚美|詩歌)[^】\]]{0,40}[】\]]\s*/i, '')
    .replace(new RegExp(`\\s*(?:[-–—―－|｜／/]\\s*)?${noise}(?:\\s+${noise})*\\s*$`, 'i'), '')
    .replace(/\s+(?:album|專輯)\s*$/i, '')
    .replace(/^\s*[-–—―－|｜／/]+|[-–—―－|｜／/]+\s*$/g, ' ')
    .replace(/^[【《\[(（]\s*([^】》\])）]+)\s*[】》\])）]$/u, '$1');
  return sanitizeMediaTitle(title);
}

function worshipTitleIdentity(value) {
  return stripWorshipTitleNoise(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function worshipMetadataPart(value, knownValues) {
  let residual = worshipTitleIdentity(value);
  if (!residual) return true;
  for (const knownValue of knownValues) {
    const known = worshipTitleIdentity(knownValue);
    if (known.length >= 2 && residual.includes(known)) residual = residual.split(known).join('');
    for (const token of known.match(/\p{Script=Han}{3,}/gu) || []) {
      if (residual.includes(token)) residual = residual.split(token).join('');
    }
  }
  residual = residual
    .replace(/(?:album|專輯|music|official|channel|頻道|records?|worship|敬拜|讚美)/gu, '')
    .replace(/\d+$/u, '');
  return residual.length === 0;
}

function inferWorshipSongTitle(metadata) {
  const source = metadata && typeof metadata === 'object' ? metadata : {};
  const track = stripWorshipTitleNoise(source.track);
  if (track) return { title: track, confident: true };

  let title = stripWorshipTitleNoise(source.title);
  if (!title) return { title: '', confident: false };
  const knownValues = [source.artist, source.album, source.uploader, source.channel, source.authorName]
    .map((item) => sanitizeMediaTitle(item))
    .filter(Boolean);
  for (const knownValue of knownValues) {
    for (const token of knownValue.match(/\p{Script=Han}{3,}/gu) || []) {
      const index = title.indexOf(token);
      if (index <= 0) continue;
      const suffix = title.slice(index);
      if (/(?:專輯|album|官方頻道|official\s+channel)/iu.test(suffix)) {
        title = stripWorshipTitleNoise(title.slice(0, index));
      }
    }
  }

  const hanRuns = [...title.matchAll(/\p{Script=Han}{2,16}/gu)];
  if (hanRuns.length >= 2 && hanRuns[0].index === 0) {
    const firstEnd = hanRuns[0][0].length;
    const between = title.slice(firstEnd, hanRuns[1].index);
    const afterSecond = title.slice(hanRuns[1].index + hanRuns[1][0].length);
    if (/[A-Za-z]/.test(between) && /[A-Za-z]/.test(afterSecond)) {
      return { title: hanRuns[0][0], confident: true };
    }
  }

  const parts = title
    .split(/\s+[-–—―－]\s+|\s*[|｜]\s*|\s+[／/]\s+/u)
    .map((part) => stripWorshipTitleNoise(part))
    .filter(Boolean);
  if (parts.length <= 1) return { title, confident: true };

  const remaining = parts.filter((part) => !worshipMetadataPart(part, knownValues));
  if (remaining.length === 1 && remaining.length < parts.length) {
    return { title: remaining[0], confident: true };
  }
  if (remaining.length && remaining.length < parts.length) {
    return { title: sanitizeMediaTitle(remaining.join(' – ')), confident: false };
  }
  return { title, confident: false };
}

function parseYtDlpWorshipMetadata(output) {
  const text = String(output || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') return { title: sanitizeMediaTitle(parsed) };
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      title: sanitizeMediaTitle(parsed.title),
      track: sanitizeMediaTitle(parsed.track),
      artist: sanitizeMediaTitle(parsed.artist),
      album: sanitizeMediaTitle(parsed.album),
      uploader: sanitizeMediaTitle(parsed.uploader),
      channel: sanitizeMediaTitle(parsed.channel)
    };
  } catch {
    return { title: sanitizeMediaTitle(text) };
  }
}

async function fetchYtDlpWorshipMetadata(url) {
  const { stdout } = await execFileP(resolveYtDlpPath(), [
    '--no-cache-dir',
    '--no-playlist',
    '--skip-download',
    '--no-warnings',
    '--socket-timeout', '10',
    '--extractor-retries', '1',
    '--print', '%(.{title,track,artist,album,uploader,channel})j',
    '--', url
  ], {
    windowsHide: true,
    env: spawnEnv(),
    timeout: YOUTUBE_METADATA_TIMEOUT_MS,
    maxBuffer: 512 * 1024
  });
  return parseYtDlpWorshipMetadata(stdout);
}

async function fetchYouTubeMetadata(value) {
  const url = normalizeMediaRequest(value, 'video').url;
  const oEmbedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  let oEmbedMetadata = {};
  try {
    const metadata = await httpGetJson(oEmbedUrl, YOUTUBE_OEMBED_TIMEOUT_MS);
    oEmbedMetadata = {
      title: sanitizeMediaTitle(metadata && metadata.title),
      authorName: sanitizeMediaTitle(metadata && metadata.author_name)
    };
  } catch {}

  const quickCandidate = inferWorshipSongTitle(oEmbedMetadata);
  if (quickCandidate.title && quickCandidate.confident) return { title: quickCandidate.title, url };

  let detailedMetadata = {};
  try {
    detailedMetadata = await fetchYtDlpWorshipMetadata(url);
  } catch {}

  const detailedCandidate = inferWorshipSongTitle({
    ...oEmbedMetadata,
    ...detailedMetadata,
    title: detailedMetadata.title || oEmbedMetadata.title,
    authorName: oEmbedMetadata.authorName
  });
  const title = detailedCandidate.title || quickCandidate.title;
  if (title) return { title, url };
  throw new Error('無法取得 YouTube 影片名稱，請手動輸入公告歌名');
}

function isIncompleteCacheName(name) {
  return /\.(?:part|ytdl|tmp|temp|download)(?:\.|$)/i.test(name) || /\.f\d+\.[^.]+(?:\.part)?$/i.test(name);
}

// 只回傳非空的最終媒體檔；順便移除中斷下載留下的片段。
function findCachedFile(url, kind, quality) {
  const base = cacheKey(url, kind, quality) + '.';
  try {
    const completed = [];
    for (const name of fs.readdirSync(CACHE_DIR())) {
      if (!name.startsWith(base)) continue;
      if (name.includes('.visual-only.')) continue;
      const filePath = path.join(CACHE_DIR(), name);
      let stat;
      try { stat = fs.statSync(filePath); } catch { continue; }
      const valid = stat.isFile() && stat.size > 0 && !isIncompleteCacheName(name) && FINAL_MEDIA_EXTENSIONS.has(path.extname(name).toLowerCase());
      if (!valid) continue;
      completed.push({ filePath, mtimeMs: stat.mtimeMs });
    }
    completed.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return completed.length ? completed[0].filePath : null;
  } catch { return null; }
}
function fileUrl(p) { return pathToFileURL(p).href; }

const inflight = new Map(); // cacheKey -> Promise<path>
const visualOnlyInflight = new Map(); // 原始影片路徑 -> Promise<無音軌影片路徑>

function cleanIncompleteFilesForKey(key) {
  const prefix = key + '.';
  try {
    for (const name of fs.readdirSync(CACHE_DIR())) {
      if (!name.startsWith(prefix)) continue;
      const filePath = path.join(CACHE_DIR(), name);
      let stat;
      try { stat = fs.statSync(filePath); } catch { continue; }
      if (stat.isFile() && (stat.size === 0 || isIncompleteCacheName(name) || !FINAL_MEDIA_EXTENSIONS.has(path.extname(name).toLowerCase()))) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
  } catch {}
}

function sendProgress(kind, percent, phase) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('media:progress', { kind, percent, phase });
}

function downloadMedia(url, kind, quality) {
  return new Promise((resolve, reject) => {
    const key = cacheKey(url, kind, quality);
    const tmpl = path.join(CACHE_DIR(), `${key}.%(ext)s`);
    // 多次重試可降低 YouTube 暫時性 403 對長影片下載的影響。
    const retry = ['--retries', '20', '--fragment-retries', '20', '--extractor-retries', '3'];
    const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const ffmpegArgs = fs.existsSync(path.join(bundledBinDir(), ffmpegName)) ? ['--ffmpeg-location', bundledBinDir()] : [];
    const args = kind === 'video'
      ? ['-f', `bestvideo[height<=${quality || 1080}]+bestaudio/best`,
         '--merge-output-format', 'mp4', '--no-playlist', '--newline', ...retry,
         ...ffmpegArgs, '-o', tmpl, url]
      : ['-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--newline', ...retry, '-o', tmpl, url];

    const child = spawn(resolveYtDlpPath(), args, { windowsHide: true, env: spawnEnv() });
    let stderr = '';
    let destCount = 0;
    let settled = false;
    const onLine = (buf) => {
      const text = String(buf).replace(/\x1B\[[0-9;]*[A-Za-z]/g, ''); // 移除 ANSI 色碼。
      const dests = text.match(/\[download\]\s+Destination:/g);
      if (dests) destCount += dests.length;
      const pcts = text.match(/\[download\]\s+([\d.]+)%/g);
      if (pcts && pcts.length) {
        const pm = pcts[pcts.length - 1].match(/([\d.]+)%/);
        if (pm) {
          let pct = parseFloat(pm[1]);
          if (kind === 'video') { // 影片與音訊分別使用 0-50、50-100 的進度區間。
            const phase = Math.min(Math.max(destCount, 1), 2);
            pct = (phase - 1) * 50 + pct / 2;
          }
          if (!isNaN(pct)) sendProgress(kind, pct);
        }
      }
      if (/\[Merger\]|\[ExtractAudio\]/.test(text)) sendProgress(kind, 99);
    };
    child.stdout.on('data', onLine);
    child.stderr.on('data', (d) => { stderr = (stderr + String(d)).slice(-64 * 1024); onLine(d); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanIncompleteFilesForKey(key);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanIncompleteFilesForKey(key);
      const out = findCachedFile(url, kind, quality);
      if (code === 0 && out) { sendProgress(kind, 100); resolve(out); }
      else reject(new Error(stderr.split(/\r?\n/).filter(Boolean).pop() || (`yt-dlp 下載失敗（代碼 ${code}）`)));
    });
  });
}

async function ensureMedia(url, kind, quality) {
  ({ url, kind, quality } = normalizeMediaRequest(url, kind, quality));
  await fsp.mkdir(CACHE_DIR(), { recursive: true });
  const key = cacheKey(url, kind, quality);
  if (inflight.has(key)) return inflight.get(key);
  const out = findCachedFile(url, kind, quality);
  if (out) {
    fsp.utimes(out, new Date(), new Date()).catch(() => {}); // 以 mtime 記錄最後使用時間。
    return out;
  }
  cleanIncompleteFilesForKey(key);
  const p = downloadMedia(url, kind, quality).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function ensureVisualOnlyVideo(sourcePath) {
  if (process.platform !== 'darwin') return sourcePath;
  const ext = path.extname(sourcePath).toLowerCase();
  if (!FINAL_MEDIA_EXTENSIONS.has(ext)) throw new Error('敬拜影片格式無法建立純畫面版本');
  const destination = sourcePath.slice(0, -ext.length) + `.visual-only${ext}`;
  try {
    const stat = await fsp.stat(destination);
    if (stat.isFile() && stat.size > 0) return destination;
  } catch {}
  if (visualOnlyInflight.has(sourcePath)) return visualOnlyInflight.get(sourcePath);

  const operation = (async () => {
    const ffmpegPath = path.join(bundledBinDir(), 'ffmpeg');
    if (!fs.existsSync(ffmpegPath)) throw new Error('找不到 macOS 影片處理工具');
    const temporary = sourcePath.slice(0, -ext.length) + `.visual-only.tmp${ext}`;
    await fsp.unlink(temporary).catch(() => {});
    try {
      const args = [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', sourcePath,
        '-map', '0:v:0', '-c:v', 'copy', '-an'
      ];
      if (['.mp4', '.mov', '.m4v'].includes(ext)) args.push('-movflags', '+faststart');
      args.push(temporary);
      await execFileP(ffmpegPath, args, {
        windowsHide: true,
        env: spawnEnv(),
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024
      });
      const stat = await fsp.stat(temporary);
      if (!stat.isFile() || stat.size === 0) throw new Error('純畫面影片輸出為空');
      await fsp.rename(temporary, destination);
      return destination;
    } finally {
      await fsp.unlink(temporary).catch(() => {});
    }
  })().finally(() => visualOnlyInflight.delete(sourcePath));
  visualOnlyInflight.set(sourcePath, operation);
  return operation;
}

// ---------- 快取管理 ----------
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
async function cleanCache(keepDays) {
  const result = { removed: 0, freed: 0 };
  let files;
  try { files = await fsp.readdir(CACHE_DIR()); } catch { return result; }
  const cfg = await readConfig();
  const keepPrefixes = [];
  if (cfg.musicUrl) {
    try { keepPrefixes.push(cacheKey(normalizeMediaRequest(cfg.musicUrl, 'audio').url, 'audio') + '.'); } catch {}
  }
  if (cfg.worshipUrl) {
    try {
      const request = normalizeMediaRequest(cfg.worshipUrl, 'video', cfg.videoQuality);
      keepPrefixes.push(cacheKey(request.url, request.kind, request.quality) + '.');
    } catch {}
  }
  const now = Date.now();
  const cutoff = keepDays > 0 ? now - keepDays * 86400000 : now + 1; // keepDays <= 0 代表全部過期。
  for (const f of files) {
    const fp = path.join(CACHE_DIR(), f);
    try {
      const st = await fsp.stat(fp);
      if (!st.isFile()) continue;
      if ([...inflight.keys()].some((key) => f.startsWith(key + '.'))) continue;
      if (isIncompleteCacheName(f) || st.size === 0 || !FINAL_MEDIA_EXTENSIONS.has(path.extname(f).toLowerCase())) {
        await fsp.unlink(fp);
        result.removed++;
        result.freed += st.size;
        continue;
      }
      if (keepPrefixes.some((p) => f.startsWith(p))) continue;
      const lastUsed = st.mtimeMs;
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
function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.prototype.toString.call(value) === '[object Object]';
}

function boundedString(value, fallback, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

const BACKGROUND_EXTENSIONS = new Set(['.bmp', '.gif', '.jpeg', '.jpg', '.png', '.webp']);

function isSafeBackgroundFileName(fileName) {
  return typeof fileName === 'string' && fileName.length <= 128 && path.basename(fileName) === fileName &&
    /^bg_\d+(?:_[a-f0-9]{8})?\.[a-z0-9]+$/i.test(fileName) && BACKGROUND_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function safeBackgroundPath(fileName) {
  if (!isSafeBackgroundFileName(fileName)) return null;
  const directory = path.resolve(BG_DIR());
  const candidate = path.resolve(directory, fileName);
  const sameDirectory = process.platform === 'win32'
    ? path.dirname(candidate).toLowerCase() === directory.toLowerCase()
    : path.dirname(candidate) === directory;
  return sameDirectory ? candidate : null;
}

function sanitizeConfig(input) {
  if (!isPlainObject(input)) throw new Error('設定格式不正確');
  const value = { ...DEFAULT_CONFIG, ...input };
  const startCh = boundedInteger(value.scriptureStartCh, DEFAULT_CONFIG.scriptureStartCh, 1, 200);
  const startV = boundedInteger(value.scriptureStartV, DEFAULT_CONFIG.scriptureStartV, 1, 200);
  let endCh = boundedInteger(value.scriptureEndCh, DEFAULT_CONFIG.scriptureEndCh, 1, 200);
  let endV = boundedInteger(value.scriptureEndV, DEFAULT_CONFIG.scriptureEndV, 1, 200);
  if (endCh < startCh || (endCh === startCh && endV < startV)) {
    endCh = startCh;
    endV = startV;
  }
  const presets = Array.isArray(value.customWorshipPresets) ? value.customWorshipPresets.slice(0, 50).flatMap((item) => {
    if (!isPlainObject(item)) return [];
    try {
      const normalized = normalizeMediaRequest(boundedString(item.url, '', 4096), 'video').url;
      return [{ title: sanitizeMediaTitle(item.title) || '自訂敬拜影片', url: normalized }];
    } catch { return []; }
  }) : [];
  const worshipTitle = sanitizeMediaTitle(value.worshipTitle);
  let worshipTitleUrl = '';
  if (value.worshipTitleUrl) {
    try { worshipTitleUrl = normalizeMediaRequest(boundedString(value.worshipTitleUrl, '', 4096), 'video').url; }
    catch {}
  }
  const backgroundFile = isSafeBackgroundFileName(value.backgroundFile) ? value.backgroundFile : '';
  const book = Object.prototype.hasOwnProperty.call(BIBLE_GATEWAY_BOOKS, value.scriptureBook)
    ? value.scriptureBook : DEFAULT_CONFIG.scriptureBook;
  const volume = Number(value.musicVolume);
  const videoQuality = boundedInteger(value.videoQuality, DEFAULT_CONFIG.videoQuality, 144, 2160);
  const fillMode = ['blur', 'contain', 'cover'].includes(value.fillMode) ? value.fillMode : DEFAULT_CONFIG.fillMode;
  return {
    title1: boundedString(value.title1, DEFAULT_CONFIG.title1, 200),
    title2: boundedString(value.title2, DEFAULT_CONFIG.title2, 200),
    title3: boundedString(value.title3, DEFAULT_CONFIG.title3, 200),
    scriptureLabel: boundedString(value.scriptureLabel, DEFAULT_CONFIG.scriptureLabel, 100),
    scriptureBook: book,
    scriptureStartCh: startCh,
    scriptureStartV: startV,
    scriptureEndCh: endCh,
    scriptureEndV: endV,
    readingExtra: boundedString(value.readingExtra, DEFAULT_CONFIG.readingExtra, 8000),
    dateAuto: value.dateAuto !== false,
    dateManual: boundedString(value.dateManual, '', 32),
    backgroundFile,
    fillMode,
    musicUrl: boundedString(value.musicUrl, '', 4096),
    worshipUrl: boundedString(value.worshipUrl, '', 4096),
    useWorshipPreset: value.useWorshipPreset === true,
    worshipPreset: boundedString(value.worshipPreset, '', 4096),
    worshipTitle,
    worshipTitleUrl,
    customWorshipPresets: presets,
    musicVolume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_CONFIG.musicVolume,
    autoPlayMusic: value.autoPlayMusic !== false,
    preventLeftArrowWorship: value.preventLeftArrowWorship !== false,
    videoQuality,
    cacheKeepDays: boundedInteger(value.cacheKeepDays, DEFAULT_CONFIG.cacheKeepDays, 0, 3650),
    fontFamily: boundedString(value.fontFamily, DEFAULT_CONFIG.fontFamily, 100),
    zoomUrl: boundedString(value.zoomUrl, DEFAULT_CONFIG.zoomUrl, 4096),
    scheduleEnabled: value.scheduleEnabled !== false,
    scheduleUrl: boundedString(value.scheduleUrl, DEFAULT_CONFIG.scheduleUrl, 4096),
    skippedVersion: boundedString(value.skippedVersion, '', 64)
  };
}

function normalizeBibleRef(value) {
  if (!isPlainObject(value)) throw new Error('經文範圍格式不正確');
  const book = boundedString(value.book, '', 32);
  if (!Object.prototype.hasOwnProperty.call(BIBLE_GATEWAY_BOOKS, book)) throw new Error('不支援的聖經書卷');
  const startCh = boundedInteger(value.startCh, NaN, 1, 200);
  const startV = boundedInteger(value.startV, NaN, 1, 200);
  const endCh = boundedInteger(value.endCh, NaN, 1, 200);
  const endV = boundedInteger(value.endV, NaN, 1, 200);
  if (![startCh, startV, endCh, endV].every(Number.isFinite)) throw new Error('經文章節必須是 1 到 200 的整數');
  if (endCh < startCh || (endCh === startCh && endV < startV)) throw new Error('經文結束位置不可早於開始位置');
  return { book, startCh, startV, endCh, endV };
}

function normalizeScheduleUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('試算表網址格式不正確');
  const parsed = parseHttpsUrl(value);
  if (parsed.hostname.toLowerCase() !== 'docs.google.com' || !sheetCsvUrl(parsed.href)) throw new Error('請使用 Google 試算表網址');
  return parsed.href;
}

async function readConfig() {
  for (const filePath of [CONFIG_PATH(), CONFIG_PATH() + '.bak']) {
    try { return sanitizeConfig(JSON.parse(await fsp.readFile(filePath, 'utf-8'))); }
    catch {}
  }
  return sanitizeConfig({ ...DEFAULT_CONFIG });
}

let configWriteQueue = Promise.resolve();

async function writeConfig(cfg) {
  const sanitized = sanitizeConfig(cfg);
  const serialized = JSON.stringify(sanitized, null, 2);
  if (Buffer.byteLength(serialized, 'utf8') > 512 * 1024) throw new Error('設定內容過大');
  const operation = configWriteQueue.catch(() => {}).then(async () => {
    await fsp.mkdir(USER_DATA(), { recursive: true });
    const tempPath = CONFIG_PATH() + `.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    let handle;
    try {
      handle = await fsp.open(tempPath, 'w', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await replaceFileSafely(tempPath, CONFIG_PATH(), '.bak');
      await fsp.unlink(CONFIG_PATH() + '.bak').catch(() => {});
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fsp.unlink(tempPath).catch(() => {});
    }
  });
  configWriteQueue = operation.catch(() => {});
  return operation;
}
function bgFileUrl(fileName) {
  const filePath = safeBackgroundPath(fileName);
  if (!filePath || !fs.existsSync(filePath)) return '';
  const url = pathToFileURL(filePath);
  url.searchParams.set('t', String(Date.now()));
  return url.href;
}

// ---------- IPC ----------
const RENDERER_ENTRY_PATH = path.resolve(__dirname, 'renderer', 'index.html');
const HOST_ENTRY_PATH = path.resolve(__dirname, 'host', 'index.html');

function sameFilePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function pathInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function normalizeNativeAudioCommand(request) {
  if (!isPlainObject(request)) throw new Error('原生音訊指令格式不正確');
  const action = String(request.action || '');
  const channel = String(request.channel || '');
  if (!['load', 'play', 'pause', 'seek', 'volume', 'stop'].includes(action)) {
    throw new Error('原生音訊動作不正確');
  }
  if (!['music', 'worship'].includes(channel)) throw new Error('原生音訊頻道不正確');

  const command = { action, channel };
  if (action === 'load') {
    let parsed;
    try { parsed = new URL(String(request.source || '')); }
    catch { throw new Error('原生音訊來源不正確'); }
    if (parsed.protocol !== 'file:') throw new Error('原生音訊只允許本機快取檔案');
    const sourcePath = await fsp.realpath(fileURLToPath(parsed));
    const cachePath = await fsp.realpath(CACHE_DIR());
    const stat = await fsp.stat(sourcePath);
    if (!stat.isFile() || (!sameFilePath(sourcePath, cachePath) && !pathInside(cachePath, sourcePath))) {
      throw new Error('原生音訊來源不在媒體快取內');
    }
    command.path = sourcePath;
    command.loop = request.loop === true;
    command.autoplay = request.autoplay !== false;
  }
  if (action === 'load' || action === 'volume') {
    const volume = Number(request.volume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('原生音訊音量不正確');
    command.volume = volume;
  }
  if (action === 'load' || action === 'seek') {
    const position = Number(request.position || 0);
    if (!Number.isFinite(position) || position < 0 || position > 24 * 60 * 60) {
      throw new Error('原生音訊位置不正確');
    }
    command.position = position;
  }
  return command;
}

function isTrustedRendererUrl(value, expectedPath = RENDERER_ENTRY_PATH) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'file:' && sameFilePath(fileURLToPath(parsed), expectedPath);
  } catch { return false; }
}

function isTrustedIpcSender(event) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  if (mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents) {
    return isTrustedRendererUrl(event.senderFrame.url, RENDERER_ENTRY_PATH);
  }
  if (hostWindow && !hostWindow.isDestroyed() && event.sender === hostWindow.webContents) {
    return isTrustedRendererUrl(event.senderFrame.url, HOST_ENTRY_PATH);
  }
  return false;
}

function trustedHandle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedIpcSender(event)) throw new Error('拒絕不受信任的 IPC 呼叫');
    return handler(...args);
  });
}

function normalizeExternalUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new Error('外部網址格式不正確');
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error('外部網址格式不正確'); }
  if (!['https:', 'zoommtg:'].includes(parsed.protocol)) throw new Error('只允許開啟 HTTPS 或 Zoom 連結');
  if (parsed.username || parsed.password) throw new Error('外部網址不可包含帳號或密碼');
  if (parsed.protocol === 'zoommtg:') {
    const host = parsed.hostname.toLowerCase();
    if (host !== 'zoom.us' && !host.endsWith('.zoom.us')) throw new Error('Zoom 連結網域不正確');
  }
  return parsed.href;
}

async function openApprovedExternal(value) {
  const href = normalizeExternalUrl(value);
  await shell.openExternal(href);
  return href;
}

function fitAspectSize(maxWidth, maxHeight, aspect, preferredWidth) {
  const safeMaxWidth = Math.max(1, Math.floor(maxWidth));
  const safeMaxHeight = Math.max(1, Math.floor(maxHeight));
  let width = Math.min(safeMaxWidth, Math.max(1, Math.floor(preferredWidth || safeMaxWidth)));
  let height = Math.max(1, Math.round(width / aspect));
  if (height > safeMaxHeight) {
    height = safeMaxHeight;
    width = Math.max(1, Math.min(safeMaxWidth, Math.round(height * aspect)));
  }
  return { width, height };
}

function centeredBounds(area, currentBounds, width, height) {
  const centerX = currentBounds.x + currentBounds.width / 2;
  const centerY = currentBounds.y + currentBounds.height / 2;
  const maxX = area.x + area.width - width;
  const maxY = area.y + area.height - height;
  return {
    x: Math.min(Math.max(Math.round(centerX - width / 2), area.x), Math.max(area.x, maxX)),
    y: Math.min(Math.max(Math.round(centerY - height / 2), area.y), Math.max(area.y, maxY)),
    width,
    height
  };
}

function setWindowMode(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mode !== 'mobile' && mode !== 'wide') throw new Error('視窗模式必須是 mobile 或 wide');
  const bounds = mainWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  if (mode === 'mobile') {
    if (bounds.width > bounds.height) lastWideBounds = bounds;
    const size = fitAspectSize(area.width, area.height, 9 / 16, Math.round(area.height * 9 / 16));
    mainWindow.setMinimumSize(1, 1);
    mainWindow.setAspectRatio(9 / 16);
    mainWindow.setBounds(centeredBounds(area, bounds, size.width, size.height), process.platform === 'darwin');
    mainWindow.setMinimumSize(Math.min(320, size.width), Math.min(560, size.height));
    return;
  }

  const margin = Math.max(0, Math.min(40, Math.floor(area.width * 0.05), Math.floor(area.height * 0.05)));
  const maxWidth = Math.max(1, area.width - margin * 2);
  const maxHeight = Math.max(1, area.height - margin * 2);
  const preferredWidth = lastWideBounds ? lastWideBounds.width : Math.max(bounds.width, 640);
  const size = fitAspectSize(maxWidth, maxHeight, 16 / 9, preferredWidth);
  mainWindow.setMinimumSize(1, 1);
  mainWindow.setAspectRatio(16 / 9);
  mainWindow.setBounds(centeredBounds(area, bounds, size.width, size.height), process.platform === 'darwin');
  mainWindow.setMinimumSize(Math.min(640, size.width), Math.min(360, size.height));
}

function registerIpc() {
  trustedHandle('config:get', async () => {
    const cfg = await readConfig();
    return { cfg, backgroundUrl: bgFileUrl(cfg.backgroundFile) };
  });
  trustedHandle('config:set', async (cfg) => {
    if (!isPlainObject(cfg)) throw new Error('設定格式不正確');
    let serialized;
    try { serialized = JSON.stringify(cfg); } catch { throw new Error('設定格式不正確'); }
    if (Buffer.byteLength(serialized, 'utf8') > 512 * 1024) throw new Error('設定內容過大');
    await writeConfig(cfg);
    sendHostScriptureConfig(await readConfig());
    return { ok: true };
  });

  trustedHandle('bg:save', async (srcPath) => {
    if (typeof srcPath !== 'string' || srcPath.length === 0 || srcPath.length > 32_768 || !path.isAbsolute(srcPath)) {
      throw new Error('背景圖片路徑不正確');
    }
    const source = await fsp.realpath(srcPath);
    const stat = await fsp.stat(source);
    const ext = path.extname(source).toLowerCase();
    if (!stat.isFile() || stat.size === 0 || stat.size > 50 * 1024 * 1024 || !BACKGROUND_EXTENSIONS.has(ext)) {
      throw new Error('背景圖片格式或大小不符合限制');
    }
    await fsp.mkdir(BG_DIR(), { recursive: true });
    const name = `bg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const destination = safeBackgroundPath(name);
    if (!destination) throw new Error('無法建立安全的背景圖片路徑');
    await fsp.copyFile(source, destination);
    const cfg = await readConfig();
    const previousBackground = cfg.backgroundFile;
    cfg.backgroundFile = name;
    await writeConfig(cfg);
    if (previousBackground && previousBackground !== name) {
      const previousPath = safeBackgroundPath(previousBackground);
      if (previousPath) await fsp.unlink(previousPath).catch(() => {});
    }
    return { fileName: name, url: bgFileUrl(name) };
  });

  trustedHandle('dialog:pickImage', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '選擇背景圖片', properties: ['openFile'],
      filters: [{ name: '圖片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
    });
    return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
  });

  // 取得或下載媒體快取，回傳安全編碼的本機檔案 URL。
  trustedHandle('media:ensure', async (request) => {
    try {
      if (!isPlainObject(request)) throw new Error('媒體要求格式不正確');
      const mediaPath = await ensureMedia(request.url, request.kind, request.quality);
      const response = { ok: true, path: fileUrl(mediaPath) };
      if (process.platform === 'darwin' && request.kind === 'video') {
        response.visualPath = fileUrl(await ensureVisualOnlyVideo(mediaPath));
      }
      return response;
    }
    catch (e) { return { ok: false, error: e.message }; }
  });
  trustedHandle('media:status', async (request) => {
    try {
      if (!isPlainObject(request)) throw new Error('媒體要求格式不正確');
      const normalized = normalizeMediaRequest(request.url, request.kind, request.quality);
      const key = cacheKey(normalized.url, normalized.kind, normalized.quality);
      return {
        cached: !inflight.has(key) && !!findCachedFile(normalized.url, normalized.kind, normalized.quality),
        downloading: inflight.has(key)
      };
    }
    catch { return { cached: false }; }
  });
  trustedHandle('native-audio:available', () => nativeMacAudio.available());
  trustedHandle('native-audio:command', async (request) => {
    if (process.platform !== 'darwin') return { ok: false, unsupported: true };
    try { return nativeMacAudio.send(await normalizeNativeAudioCommand(request)); }
    catch (error) { return { ok: false, error: error.message }; }
  });
  trustedHandle('youtube:metadata', async (url) => {
    try { return { ok: true, ...(await fetchYouTubeMetadata(url)) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  trustedHandle('cache:size', async () => cacheSize());
  trustedHandle('cache:clean', async (keepDays) => cleanCache(boundedInteger(keepDays, 0, 0, 3650)));

  trustedHandle('ytdlp:update', async () => autoUpdateYtDlp());
  trustedHandle('ytdlp:version', async () => localYtDlpVersion());

  // ---------- 應用程式更新 ----------
  trustedHandle('app:version', () => app.getVersion());
  trustedHandle('app:checkUpdate', async () => {
    if (!app.isPackaged) return { ok: false, error: '開發模式不檢查更新，請使用安裝版。' };
    try {
      if (process.platform === 'darwin') {
        const latest = await fetchLatestReleaseInfo();
        return { ok: true, available: latest.available, version: latest.version, manual: true, url: RELEASES_PAGE };
      }
      const r = await autoUpdater.checkForUpdates();
      const info = r && r.updateInfo;
      const available = !!(r && r.isUpdateAvailable);
      return { ok: true, available, version: info ? info.version : app.getVersion() };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  trustedHandle('app:downloadUpdate', async () => {
    try {
      if (!app.isPackaged) return { ok: false, error: '開發模式不下載更新。' };
      if (process.platform === 'darwin') {
        return { ok: true, manual: true, url: RELEASES_PAGE };
      }
      await autoUpdater.downloadUpdate();
      return { ok: true };
    }
    catch (e) { return { ok: false, error: e.message }; }
  });
  trustedHandle('app:quitAndInstall', () => {
    if (process.platform === 'darwin') return { ok: false, manual: true, error: 'macOS 請從 GitHub Releases 手動安裝更新。' };
    autoUpdater.quitAndInstall();
    return { ok: true };
  });

  trustedHandle('open:external', async (url) => {
    try { return { ok: true, url: await openApprovedExternal(url) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  trustedHandle('schedule:today', async (url) => {
    const managed = await presenceManager.scheduleToday().catch(() => null);
    if (managed && managed.ok) return managed;
    try { return await fetchScheduleToday(normalizeScheduleUrl(url)); }
    catch (e) { return { ok: false, error: e.message }; }
  });
  trustedHandle('utmost:today', async () => {
    try { return await fetchUtmostToday(); }
    catch (e) { return { ok: false, error: e.message }; }
  });
  trustedHandle('bible:passage', async (ref) => {
    try { return await fetchBiblePassage(ref); }
    catch (e) { return { ok: false, error: e.message }; }
  });

  trustedHandle('win:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });
  trustedHandle('win:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
  trustedHandle('win:mode', (mode) => setWindowMode(mode));
  trustedHandle('clipboard:read', () => clipboard.readText());
  trustedHandle('clipboard:write', (text) => {
    if (typeof text !== 'string' || text.length > 200_000) throw new Error('剪貼簿文字格式或大小不符合限制');
    clipboard.writeText(text);
    return { ok: true };
  });

  trustedHandle('host:open', () => {
    openHostWindow();
    return { ok: true };
  });
  trustedHandle('host:close', () => {
    if (hostWindow && !hostWindow.isDestroyed()) hostWindow.close();
    return { ok: true };
  });
  trustedHandle('presence:state', () => presenceManager.publicState());
  trustedHandle('presence:pair', async (settings) => {
    if (!isPlainObject(settings)) throw new Error('配對資料格式不正確');
    return presenceManager.pair(settings);
  });
  trustedHandle('presence:unpair', () => presenceManager.unpair());
  trustedHandle('presence:refresh', () => presenceManager.refreshBootstrap());
  trustedHandle('presence:assignments', async (assignments) => {
    if (!isPlainObject(assignments)) throw new Error('閱讀安排格式不正確');
    return presenceManager.saveAssignments(assignments);
  });
  trustedHandle('host:utmost-today', async () => {
    try { return await fetchUtmostToday(); }
    catch (error) { return { ok: false, body: '', error: error.message }; }
  });
  trustedHandle('host:scripture-current', async () => scriptureConfigFrom(await readConfig()));
}

// ---------- 視窗 ----------
let mainWindow = null;
let hostWindow = null;
let lastWideBounds = null;
let pointerMonitorTimer = null;
let lastPointerPoint = null;

function pointInsideBounds(point, bounds) {
  return point.x >= bounds.x && point.x < bounds.x + bounds.width &&
    point.y >= bounds.y && point.y < bounds.y + bounds.height;
}

function pollMainWindowPointer() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  const point = screen.getCursorScreenPoint();
  const moved = !lastPointerPoint || point.x !== lastPointerPoint.x || point.y !== lastPointerPoint.y;
  lastPointerPoint = point;
  if (moved && pointInsideBounds(point, mainWindow.getBounds())) {
    mainWindow.webContents.send('win:pointer-activity');
  }
}

function startMainWindowPointerMonitor() {
  if (pointerMonitorTimer) clearInterval(pointerMonitorTimer);
  lastPointerPoint = null;
  pointerMonitorTimer = setInterval(pollMainWindowPointer, 50);
}

function stopMainWindowPointerMonitor() {
  if (pointerMonitorTimer) clearInterval(pointerMonitorTimer);
  pointerMonitorTimer = null;
  lastPointerPoint = null;
}

// 本程式只會播放本機媒體，不需要麥克風、攝影機或螢幕擷取。
// 明確拒絕 renderer 的裝置權限，避免媒體切換時 Chromium／系統顯示錄音詢問。
function configureRendererPermissions(ses) {
  ses.setPermissionCheckHandler(() => false);
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (app.isReady()) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const margin = Math.max(0, Math.min(40, Math.floor(area.width * 0.05), Math.floor(area.height * 0.05)));
  const size = fitAspectSize(area.width - margin * 2, area.height - margin * 2, 16 / 9, 1280);
  const initialBounds = {
    x: area.x + Math.max(0, Math.floor((area.width - size.width) / 2)),
    y: area.y + Math.max(0, Math.floor((area.height - size.height) / 2)),
    ...size
  };
  const window = new BrowserWindow({
    ...initialBounds,
    minWidth: Math.min(640, size.width), minHeight: Math.min(360, size.height),
    backgroundColor: '#000000', title: '靈修封面', autoHideMenuBar: true,
    icon: APP_ICON_PATH,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  mainWindow = window;
  startMainWindowPointerMonitor();
  window.setAspectRatio(16 / 9);
  window.removeMenu();

  const guardNavigation = (event, targetUrl) => {
    if (isTrustedRendererUrl(targetUrl)) return;
    event.preventDefault();
    try { openApprovedExternal(targetUrl).catch((error) => console.warn('開啟外部連結失敗：', error.message)); }
    catch {}
  };
  window.webContents.on('will-navigate', guardNavigation);
  window.webContents.on('will-redirect', guardNavigation);
  window.webContents.setWindowOpenHandler(({ url }) => {
    try { openApprovedExternal(url).catch((error) => console.warn('開啟外部連結失敗：', error.message)); }
    catch {}
    return { action: 'deny' };
  });
  window.loadFile(RENDERER_ENTRY_PATH).catch((error) => console.error('載入主畫面失敗：', error));

  window.webContents.on('context-menu', (_e, params) => {
    const tmpl = [];
    if (params.isEditable) {
      tmpl.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' },
                { type: 'separator' }, { role: 'selectAll' });
    } else if (params.selectionText) {
      tmpl.push({ role: 'copy' }, { type: 'separator' }, { role: 'selectAll' });
    }
    if (tmpl.length && !window.isDestroyed()) Menu.buildFromTemplate(tmpl).popup({ window });
  });

  window.webContents.once('did-finish-load', () => { checkLatestVersion(); });
  window.on('closed', () => {
    stopMainWindowPointerMonitor();
    if (mainWindow === window) mainWindow = null;
    if (hostWindow && !hostWindow.isDestroyed()) hostWindow.close();
  });
}

function sendPresenceState(state = presenceManager.publicState()) {
  if (hostWindow && !hostWindow.isDestroyed()) hostWindow.webContents.send('presence:state', state);
}

function scriptureConfigFrom(cfg) {
  return {
    book: String(cfg && cfg.scriptureBook || '').trim().slice(0, 40),
    startCh: Number(cfg && cfg.scriptureStartCh),
    startV: Number(cfg && cfg.scriptureStartV),
    endCh: Number(cfg && cfg.scriptureEndCh),
    endV: Number(cfg && cfg.scriptureEndV)
  };
}

function sendHostScriptureConfig(cfg) {
  if (hostWindow && !hostWindow.isDestroyed()) {
    hostWindow.webContents.send('host:scripture-current', scriptureConfigFrom(cfg));
  }
}

function openHostWindow() {
  if (hostWindow && !hostWindow.isDestroyed()) {
    if (hostWindow.isMinimized()) hostWindow.restore();
    hostWindow.show();
    hostWindow.focus();
    sendPresenceState();
    return hostWindow;
  }
  const display = mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const width = Math.min(460, workArea.width);
  const height = Math.min(760, workArea.height);
  const window = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(360, width),
    minHeight: Math.min(560, height),
    x: Math.max(workArea.x, workArea.x + workArea.width - width - 18),
    y: Math.max(workArea.y, workArea.y + 18),
    title: '靈修班主持台',
    backgroundColor: '#f7f1f5',
    icon: APP_ICON_PATH,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'host', 'host-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  hostWindow = window;
  window.removeMenu();
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl, HOST_ENTRY_PATH)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.loadFile(HOST_ENTRY_PATH).catch((error) => console.error('載入主持台失敗：', error));
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show();
      sendPresenceState();
      readConfig().then(sendHostScriptureConfig).catch(() => {});
    }
  });
  window.on('closed', () => { if (hostWindow === window) hostWindow = null; });
  return window;
}

// ---------- 應用程式更新設定 ----------
function sendUpdate(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(channel, payload);
}
function setupAutoUpdater() {
  // 未簽章的 macOS 應用程式不使用原生更新器，改由 GitHub Releases 手動安裝。
  if (process.platform === 'darwin') return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => sendUpdate('update:available', { version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdate('update:none', {}));
  autoUpdater.on('error', (err) => sendUpdate('update:error', { error: String(err && err.message || err) }));
  autoUpdater.on('download-progress', (p) => sendUpdate('update:progress', { percent: p.percent }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate('update:downloaded', { version: info.version }));
}

// ---------- 啟動時比對 GitHub Releases 版本 ----------
const RELEASES_API = 'https://api.github.com/repos/Living-water-church-chiayi/zoomshare/releases/latest';
const RELEASES_PAGE = 'https://github.com/Living-water-church-chiayi/zoomshare/releases/latest';
function versionParts(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?$/);
  return match ? match.slice(1, 4).map((part) => parseInt(part || '0', 10)) : null;
}
function isNewerVersion(candidate, current) {
  const candidateParts = versionParts(candidate);
  const currentParts = versionParts(current);
  if (!candidateParts || !currentParts) return false;
  for (let i = 0; i < 3; i++) {
    if (candidateParts[i] > currentParts[i]) return true;
    if (candidateParts[i] < currentParts[i]) return false;
  }
  return false;
}
async function fetchLatestReleaseInfo() {
  const release = await httpGetJson(RELEASES_API);
  const version = String((release && release.tag_name) || '').replace(/^v/i, '').trim();
  if (!versionParts(version)) throw new Error('GitHub Release 版本格式不正確');
  return { version, available: isNewerVersion(version, app.getVersion()), url: RELEASES_PAGE };
}
async function checkLatestVersion() {
  try {
    const latest = await fetchLatestReleaseInfo();
    if (latest.available) sendUpdate('app:new-version', latest);
  } catch (e) { console.warn('檢查應用程式版本失敗：', e.message); }
}

app.whenReady().then(async () => {
  configureRendererPermissions(session.defaultSession);
  registerIpc();
  presenceManager.on('state', sendPresenceState);
  await ensureWritableYtDlp();
  createWindow();
  presenceManager.start().catch((error) => console.warn('啟動主持台即時連線失敗：', error.message));
  setupAutoUpdater();
  autoUpdateYtDlp().then((r) => { if (r && r.updated) console.log('yt-dlp 已更新至', r.to); });
  readConfig().then((cfg) => {
    const days = typeof cfg.cacheKeepDays === 'number' ? cfg.cacheKeepDays : 30;
    if (days > 0) cleanCache(days).then((r) => {
      if (r.removed) console.log(`已清理 ${r.removed} 個快取，釋放 ${(r.freed / 1048576).toFixed(0)} MB`);
    });
  });
  if (app.isPackaged && process.platform !== 'darwin') autoUpdater.checkForUpdates().catch(() => {});
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => {
  nativeMacAudio.close();
  presenceManager.stop();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
