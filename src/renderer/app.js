'use strict';

const $ = (id) => document.getElementById(id);

let cfg = null;
let musicPlaying = false;
let musicDesired = false;
let musicRequestToken = 0;
let musicFadeTimer = null;
let musicResumeOnCover = false;
let flowReachedUtmost = false;
let worshipActive = false;
let worshipPlayRetryTimer = null;
let flowStep = 'cover';
let flowPages = [];
let flowPageScales = [];
let flowPageIndex = 0;
let flowLoading = false;
let cachedUtmost = null;
let cachedBible = null;
let cachedBibleKey = '';
let scriptureRequest = null;
let scriptureRequestToken = 0;
let flowNavigationToken = 0;
let flowPageRenderToken = 0;
let flowTransitioning = false;
let flowFooterHideTimer = null;
let flowFooterHovered = false;
let settingsPointerStartedOutside = false;
let utmostFinishConfirmUntil = 0;
let utmostFinishConfirmTimer = null;
let flowWheelDelta = 0;
let flowWheelGestureLocked = false;
let flowWheelResetTimer = null;
let worshipRequestToken = 0;
const FLOW_ORDER = ['cover', 'worship', 'scripture', 'utmost'];
const FLOW_LAYOUT_WIDTH = 405;
const FLOW_LAYOUT_HEIGHT = 720;
const FLOW_MIN_CONTROL_SIZE = 44;
const FLOW_MIN_ICON_SIZE = 19;
const UTMOST_FINISH_CONFIRM_MS = 3500;
const FLOW_WHEEL_THRESHOLD = 36;
const FLOW_WHEEL_IDLE_MS = 300;

// ---------- 工具 ----------
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

function systemDateMD() {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function systemDateChinese() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// 把 Zoom 會議網頁連結轉成 zoommtg://，直接交給 Zoom App。
function zoomLaunchUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host !== 'zoom.us' && !host.endsWith('.zoom.us')) return '';
    if (u.username || u.password) return '';
    if (u.protocol === 'zoommtg:') return u.href;
    if (u.protocol !== 'https:') return '';
    const m = u.pathname.match(/\/j\/(\d+)/);
    if (m) {
      let z = `zoommtg://${u.hostname}/join?action=join&confno=${m[1]}`;
      const pwd = u.searchParams.get('pwd');
      if (pwd) z += `&pwd=${encodeURIComponent(pwd)}`;
      return z;
    }
    return u.href;
  } catch (e) { return ''; }
}

// ---------- 封面 ----------
function applyCover(backgroundUrl) {
  $('dateText').textContent = cfg.dateAuto ? systemDateMD() : (cfg.dateManual || systemDateMD());
  $('title1').textContent = cfg.title1 || '';
  $('title2').textContent = cfg.title2 || '';
  $('title3').textContent = cfg.title3 || '';
  $('scriptureLabel').textContent = cfg.scriptureLabel || '';

  const rl = $('readingLines');
  rl.innerHTML = '';
  const lines = [formatRef()].concat(
    (cfg.readingExtra || '').split('\n').map((s) => s.trim()).filter(Boolean)
  );
  lines.forEach((line) => {
    if (!line) return;
    const div = document.createElement('div');
    div.textContent = line;
    rl.appendChild(div);
  });

  if (backgroundUrl !== null && backgroundUrl !== undefined) setBackground(backgroundUrl);
  applyFillMode();
}

function setBackground(url) {
  const hasBackground = !!url;
  const image = hasBackground ? `url("${url}")` : 'none';
  $('canvas').classList.toggle('no-background', !hasBackground);
  $('bgImage').style.backgroundImage = image;
  $('bgBlur').style.backgroundImage = image;
}

function applyFillMode() {
  const blur = $('bgBlur');
  blur.classList.remove('black');
}

// ---------- 本日經文下拉選單 ----------
function bookByName(name) {
  return window.BIBLE.find((b) => b.n === name) || window.BIBLE[0];
}
function clampNum(v, lo, hi) { v = parseInt(v, 10) || lo; return Math.min(hi, Math.max(lo, v)); }
function fillNumberSelect(sel, n, val, min = 1) {
  sel.innerHTML = '';
  for (let i = min; i <= n; i++) {
    const o = document.createElement('option');
    o.value = i; o.textContent = i;
    if (i === val) o.selected = true;
    sel.appendChild(o);
  }
}

// 依開始位置重建結束選項，確保結束章節不早於開始章節。
function syncEndOptions(desiredEndCh, desiredEndV) {
  const bk = bookByName($('bkBook').value);
  const sc = +$('bkStartCh').value, sv = +$('bkStartV').value;
  const nCh = bk.v.length;
  let ec = clampNum(desiredEndCh, sc, nCh);
  fillNumberSelect($('bkEndCh'), nCh, ec, sc);
  ec = +$('bkEndCh').value;
  const vMin = (ec === sc) ? sv : 1;
  const ev = clampNum(desiredEndV, vMin, bk.v[ec - 1]);
  fillNumberSelect($('bkEndV'), bk.v[ec - 1], ev, vMin);
}
function fillBookSelect() {
  const sel = $('bkBook');
  sel.innerHTML = '';
  window.BIBLE.forEach((b) => {
    const o = document.createElement('option');
    o.value = b.n; o.textContent = b.n;
    sel.appendChild(o);
  });
}
function formatRef() {
  const book = cfg.scriptureBook || '';
  const sc = cfg.scriptureStartCh, sv = cfg.scriptureStartV, ec = cfg.scriptureEndCh, ev = cfg.scriptureEndV;
  if (sc === ec) return sv === ev ? `${book}${sc}:${sv}` : `${book}${sc}:${sv}-${ev}`;
  return `${book}${sc}:${sv}-${ec}:${ev}`;
}
function updateRefPreview() { const el = $('refPreview'); if (el) el.textContent = formatRef(); }

function currentRefPayload() {
  return {
    book: cfg.scriptureBook,
    startCh: cfg.scriptureStartCh,
    startV: cfg.scriptureStartV,
    endCh: cfg.scriptureEndCh,
    endV: cfg.scriptureEndV
  };
}

function normalizeScriptureConfig() {
  const before = JSON.stringify([
    cfg.scriptureBook,
    cfg.scriptureStartCh,
    cfg.scriptureStartV,
    cfg.scriptureEndCh,
    cfg.scriptureEndV
  ]);
  const bk = bookByName(cfg.scriptureBook);
  const startCh = clampNum(cfg.scriptureStartCh, 1, bk.v.length);
  const startV = clampNum(cfg.scriptureStartV, 1, bk.v[startCh - 1]);
  const endCh = clampNum(cfg.scriptureEndCh, startCh, bk.v.length);
  const endV = clampNum(cfg.scriptureEndV, endCh === startCh ? startV : 1, bk.v[endCh - 1]);
  cfg.scriptureBook = bk.n;
  cfg.scriptureStartCh = startCh;
  cfg.scriptureStartV = startV;
  cfg.scriptureEndCh = endCh;
  cfg.scriptureEndV = endV;
  return before !== JSON.stringify([bk.n, startCh, startV, endCh, endV]);
}

// 依 cfg 目前值填入四個下拉選單。
function fillScriptureControls() {
  normalizeScriptureConfig();
  const bk = bookByName(cfg.scriptureBook);
  $('bkBook').value = bk.n;
  const nCh = bk.v.length;
  const sc = cfg.scriptureStartCh;
  fillNumberSelect($('bkStartCh'), nCh, sc);
  fillNumberSelect($('bkStartV'), bk.v[sc - 1], cfg.scriptureStartV);
  syncEndOptions(cfg.scriptureEndCh, cfg.scriptureEndV);
  cfg.scriptureStartCh = +$('bkStartCh').value;
  cfg.scriptureStartV = +$('bkStartV').value;
  cfg.scriptureEndCh = +$('bkEndCh').value;
  cfg.scriptureEndV = +$('bkEndV').value;
  updateRefPreview();
}

// 級聯更新章節範圍並存檔。
function onScriptureChange(which) {
  const bk = bookByName($('bkBook').value);
  cfg.scriptureBook = bk.n;
  const nCh = bk.v.length;
  if (which === 'book') {
    fillNumberSelect($('bkStartCh'), nCh, 1);
    fillNumberSelect($('bkStartV'), bk.v[0], 1);
    syncEndOptions(1, 1);
  } else if (which === 'startCh') {
    fillNumberSelect($('bkStartV'), bk.v[$('bkStartCh').value - 1], 1);
    syncEndOptions(+$('bkEndCh').value, +$('bkEndV').value);
  } else if (which === 'startV') {
    syncEndOptions(+$('bkEndCh').value, +$('bkEndV').value);
  } else if (which === 'endCh') {
    syncEndOptions(+$('bkEndCh').value, +$('bkEndV').value);
  }
  cfg.scriptureStartCh = +$('bkStartCh').value;
  cfg.scriptureStartV = +$('bkStartV').value;
  cfg.scriptureEndCh = +$('bkEndCh').value;
  cfg.scriptureEndV = +$('bkEndV').value;
  invalidateScriptureData();
  updateRefPreview();
  applyCover(null);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.api.setConfig(cfg), 300);
}

// 套用 Google 試算表中今天的經文範圍。
function applyScheduleRow(row) {
  const bk = window.BIBLE.find((b) => b.n === String(row.book || '').trim());
  if (!bk) return false;
  const nCh = bk.v.length;
  const sc = clampNum(row.startCh, 1, nCh);
  const sv = clampNum(row.startV, 1, bk.v[sc - 1]);
  const ec = clampNum(row.endCh, sc, nCh);
  const ev = clampNum(row.endV, ec === sc ? sv : 1, bk.v[ec - 1]);
  cfg.scriptureBook = bk.n;
  cfg.scriptureStartCh = sc; cfg.scriptureStartV = sv;
  cfg.scriptureEndCh = ec; cfg.scriptureEndV = ev;
  fillScriptureControls();
  applyCover(null);
  invalidateScriptureData();
  window.api.setConfig(cfg);
  return true;
}
async function applySchedule(manual) {
  if (!cfg.scheduleUrl) { if (manual) toast('請先設定排程網址'); return false; }
  const st = $('scheduleStatus');
  if (st) st.textContent = '讀取今日排程中...';
  const r = await window.api.scheduleToday(cfg.scheduleUrl);
  if (!r.ok) { const m = '讀取失敗：' + (r.error || ''); if (st) st.textContent = m; if (manual) toast(m, 4000); return false; }
  if (!r.found) { const m = '找不到 ' + systemDateMD() + ' 的排程'; if (st) st.textContent = m; if (manual) toast(m, 3500); return false; }
  if (applyScheduleRow(r.row)) {
    const m = '已更新 ' + systemDateMD() + '：' + formatRef();
    if (st) st.textContent = m;
    if (manual) toast(m, 3000);
    return true;
  } else {
    const m = '排程資料格式不正確：' + r.row.book;
    if (st) st.textContent = m;
    if (manual) toast(m, 4000);
    return false;
  }
}

// ---------- 早靈修公告 ----------
const CN_WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const ZOOM_MEETING_PASSCODE = '52141425';
const ZOOM_PASSCODE_HINT = '我愛耶穌耶穌愛我';

function parseZoomUrl(url) {
  if (!url) return { id: '' };
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/j\/(\d+)/);
    return { id: m ? m[1] : '' };
  } catch { return { id: '' }; }
}

function todayCNDate(now = new Date()) {
  let d = now;
  if (cfg && cfg.dateAuto === false) {
    const manual = String(cfg.dateManual || '').match(/^(\d{1,2})\/(\d{1,2})$/);
    if (manual) {
      const candidate = new Date(now.getFullYear(), Number(manual[1]) - 1, Number(manual[2]));
      if (candidate.getMonth() === Number(manual[1]) - 1 && candidate.getDate() === Number(manual[2])) {
        d = candidate;
      }
    }
  }
  return (d.getMonth() + 1) + '月' + d.getDate() + '日' + CN_WEEKDAYS[d.getDay()];
}

function chineseChapterNumber(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 999) return String(value || '');
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return digits[n];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    return (tens === 1 ? '' : digits[tens]) + '十' + digits[n % 10];
  }
  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;
  if (!remainder) return digits[hundreds] + '百';
  if (remainder < 10) return digits[hundreds] + '百零' + digits[remainder];
  const tens = Math.floor(remainder / 10);
  return digits[hundreds] + '百' + digits[tens] + '十' + digits[remainder % 10];
}

function formatScriptureShort() {
  const bk = cfg.scriptureBook || '';
  const sc = cfg.scriptureStartCh, sv = cfg.scriptureStartV, ec = cfg.scriptureEndCh, ev = cfg.scriptureEndV;
  if (!bk) return '';
  if (sc === ec && sv === ev) return bk + ' ' + sc + ':' + sv;
  if (sc === ec) return bk + ' ' + sc + ':' + sv + '-' + ev;
  return bk + ' ' + sc + ':' + sv + '-' + ec + ':' + ev;
}

function formatScriptureBookTitle() {
  return formatScriptureShort();
}

function formatScriptureAnnouncementRef() {
  const book = String(cfg.scriptureBook || '').trim();
  const startChapterNumber = Number.parseInt(cfg.scriptureStartCh, 10);
  const endChapterNumber = Number.parseInt(cfg.scriptureEndCh, 10);
  const startChapter = chineseChapterNumber(startChapterNumber);
  const endChapter = chineseChapterNumber(endChapterNumber);
  const startVerse = Number.parseInt(cfg.scriptureStartV, 10);
  const endVerse = Number.parseInt(cfg.scriptureEndV, 10);
  if (!book || !startChapter || !startVerse || !endChapter || !endVerse) return '';
  if (startChapterNumber === endChapterNumber && startVerse === endVerse) {
    return `${book}${startChapter}：${startVerse}`;
  }
  if (startChapterNumber === endChapterNumber) {
    return `${book}${startChapter}：${startVerse}-${endVerse}`;
  }
  return `${book}${startChapter}：${startVerse}-${endChapter}：${endVerse}`;
}

function youtubeVideoId(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase();
    let id = '';
    if (host === 'youtu.be') {
      id = url.pathname.split('/').filter(Boolean)[0] || '';
    } else if (host === 'youtube.com' || host.endsWith('.youtube.com') ||
      host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) {
      id = url.searchParams.get('v') || '';
      if (!id) {
        const pathMatch = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);
        id = pathMatch ? pathMatch[1] : '';
      }
    }
    return /^[A-Za-z0-9_-]{6,32}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

function normalizeWorshipTitle(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 128);
}

function meaningfulWorshipTitle(value) {
  const title = normalizeWorshipTitle(value);
  return /^自訂敬拜影片(?:\s+\d+)?$/.test(title) ? '' : title;
}

function sameWorshipUrl(left, right) {
  const leftUrl = String(left || '').trim();
  const rightUrl = String(right || '').trim();
  if (!leftUrl || !rightUrl) return false;
  if (leftUrl === rightUrl) return true;
  const leftVideoId = youtubeVideoId(leftUrl);
  return !!leftVideoId && leftVideoId === youtubeVideoId(rightUrl);
}

function worshipOptionAnnouncementTitle(option) {
  if (!option) return '';
  const explicit = option.dataset && option.dataset.announcementTitle;
  return normalizeWorshipTitle(explicit || option.textContent || '');
}

function selectedCustomWorshipPresetIndex(url) {
  if (!cfg.useWorshipPreset || typeof document === 'undefined') return -1;
  const select = document.getElementById('worshipPreset');
  if (!select) return -1;
  const selected = select.selectedOptions && select.selectedOptions[0]
    ? select.selectedOptions[0]
    : Array.from(select.options || []).find((item) => item.selected);
  const index = Number(selected && selected.dataset && selected.dataset.index);
  const presets = Array.isArray(cfg.customWorshipPresets) ? cfg.customWorshipPresets : [];
  return Number.isInteger(index) && index >= 0 && presets[index] && sameWorshipUrl(presets[index].url, url)
    ? index : -1;
}

function currentWorshipAnnouncement() {
  // Playback, prefetch and the announcement all use worshipUrl as the active source.
  const url = String(cfg.worshipUrl || '').trim();
  if (!url) return { title: '', url: '' };

  const isCurrentUrl = (candidate) => sameWorshipUrl(candidate, url);
  let title = '';
  let select = null;
  if (typeof document !== 'undefined') select = document.getElementById('worshipPreset');

  // In manual mode the scoped, user-editable announcement title is authoritative.
  if (!cfg.useWorshipPreset && isCurrentUrl(cfg.worshipTitleUrl)) {
    title = meaningfulWorshipTitle(cfg.worshipTitle);
  }

  // Preset mode must use the title of the option the user actually selected.
  // This prevents a duplicate custom preset from lending today's video an old name.
  if (cfg.useWorshipPreset && select) {
    const selected = select.selectedOptions && select.selectedOptions[0]
      ? select.selectedOptions[0]
      : Array.from(select.options || []).find((item) => item.selected);
    if (selected && isCurrentUrl(selected.value)) title = worshipOptionAnnouncementTitle(selected);
    title = meaningfulWorshipTitle(title);
  }

  if (!title && select) {
    const official = Array.from(select.options || []).find((item) =>
      item.dataset && item.dataset.announcementTitle && isCurrentUrl(item.value));
    if (official) title = worshipOptionAnnouncementTitle(official);
  }

  const presets = Array.isArray(cfg.customWorshipPresets) ? cfg.customWorshipPresets : [];
  const selectedCustomIndex = selectedCustomWorshipPresetIndex(url);
  const custom = selectedCustomIndex >= 0
    ? presets[selectedCustomIndex]
    : presets.find((item) => item && isCurrentUrl(item.url));
  if (!title && custom) title = meaningfulWorshipTitle(custom.title);

  if (!title && select) {
    const matchingOption = Array.from(select.options || []).find((item) => isCurrentUrl(item.value));
    if (matchingOption) title = worshipOptionAnnouncementTitle(matchingOption);
  }
  title = meaningfulWorshipTitle(title);
  return { title, url };
}

const worshipTitleCache = new Map();
const worshipTitleInflight = new Map();
let customWorshipTitleRequestToken = 0;
let manualWorshipTitleRequestToken = 0;

function worshipTitleCacheKey(url) {
  return youtubeVideoId(url) || String(url || '').trim();
}

async function lookupWorshipTitle(url) {
  const normalizedUrl = normalizeCustomWorshipUrl(url);
  if (!normalizedUrl) return '';
  const key = worshipTitleCacheKey(normalizedUrl);
  if (worshipTitleCache.has(key)) return worshipTitleCache.get(key);
  if (worshipTitleInflight.has(key)) return worshipTitleInflight.get(key);
  const request = window.api.youtubeMetadata(normalizedUrl)
    .then((result) => result && result.ok ? meaningfulWorshipTitle(result.title) : '')
    .catch(() => '')
    .then((title) => {
      if (title) worshipTitleCache.set(key, title);
      return title;
    })
    .finally(() => worshipTitleInflight.delete(key));
  worshipTitleInflight.set(key, request);
  return request;
}

async function ensureCurrentWorshipAnnouncementTitle(showProgress = false) {
  let worship = currentWorshipAnnouncement();
  if (!worship.url || worship.title) return worship;
  const requestedUrl = worship.url;
  if (showProgress) toast('正在讀取敬拜歌名…', 4000);
  const title = await lookupWorshipTitle(requestedUrl);
  if (!sameWorshipUrl(cfg.worshipUrl, requestedUrl)) return currentWorshipAnnouncement();
  if (!title) return currentWorshipAnnouncement();

  const presets = customWorshipPresets();
  const selectedCustomIndex = selectedCustomWorshipPresetIndex(requestedUrl);
  const customIndex = selectedCustomIndex >= 0
    ? selectedCustomIndex
    : presets.findIndex((item) => item && sameWorshipUrl(item.url, requestedUrl));
  const custom = customIndex >= 0 ? presets[customIndex] : null;
  let resolvedTitle = title;
  if (custom && !meaningfulWorshipTitle(custom.title)) {
    resolvedTitle = updateCustomWorshipPresetTitle(customIndex, title, true);
    if (!resolvedTitle) return currentWorshipAnnouncement();
  }
  if (!cfg.useWorshipPreset) {
    cfg.worshipTitle = resolvedTitle;
    cfg.worshipTitleUrl = requestedUrl;
    const manualTitle = $('inWorshipTitle');
    if (manualTitle && sameWorshipUrl($('inWorshipUrl').value, requestedUrl)) {
      manualTitle.value = resolvedTitle;
      manualTitle.dataset.url = requestedUrl;
    }
  }
  await window.api.setConfig(cfg);
  if (!sameWorshipUrl(cfg.worshipUrl, requestedUrl)) return currentWorshipAnnouncement();
  worship = currentWorshipAnnouncement();
  return worship.title ? worship : { title: resolvedTitle, url: requestedUrl };
}

function focusWorshipTitleEditor(url) {
  openSettings();
  const customIndex = customWorshipPresets().findIndex((item) => item && sameWorshipUrl(item.url, url));
  if (customIndex >= 0) {
    const input = $('customWorshipList').querySelector(
      `.custom-worship-item[data-index="${customIndex}"] .custom-worship-title-input`
    );
    if (input) { input.focus(); input.select(); return; }
  }
  if (cfg.useWorshipPreset) {
    $('inCustomWorshipUrl').value = url;
    $('inCustomWorshipTitle').focus();
  } else {
    $('inWorshipTitle').focus();
  }
}

function buildAnnounceText(now = new Date()) {
  const z = parseZoomUrl(cfg.zoomUrl);
  const idFmt = z.id ? z.id.replace(/(\d{1,4})(?=(\d{4})+(?!\d))/g, '$1 ').trim() : '';
  const ref = formatScriptureAnnouncementRef();
  const worship = currentWorshipAnnouncement();
  return [
    '親愛的活水家人們，早安，',
    '今天是' + todayCNDate(now) + '。',
    '',
    '請預備大家的聖經',
    '【聖經】' + ref,
    '【竭誠獻上】',
    '',
    '主題: 早靈修班',
    '時間: 週二-周五 8:30 am',
    '',
    '加入 Zoom 會議',
    String(cfg.zoomUrl || '').trim(),
    '',
    '蘋果電腦平板手機，',
    '請手動輸入帳號密碼喔！',
    '帳號：' + idFmt,
    '密碼：' + ZOOM_MEETING_PASSCODE,
    '(' + ZOOM_PASSCODE_HINT + '）',
    '',
    '敬拜詩歌：' + worship.title,
    worship.url
  ].join('\n');
}

async function copyAnnounce() {
  // If the settings drawer is open, use its current controls even before the
  // debounced config write finishes. The announcement then mirrors playback.
  const settingsPanel = $('settingsPanel');
  if (settingsPanel && !settingsPanel.classList.contains('hidden')) collectSettings();
  const worship = await ensureCurrentWorshipAnnouncementTitle(true);
  if (worship.url && !worship.title) {
    focusWorshipTitleEditor(worship.url);
    toast('無法自動取得歌名，請先填寫「公告歌名」再複製', 5200);
    return;
  }
  const text = buildAnnounceText();
  await window.api.writeClipboard(text);
  toast('已複製公告，可以直接貼到群組上', 3200);
}

// ---------- 設定資料 ----------
function parseManualDate(value) {
  const m = String(value || '').match(/^(\d{1,2})\/(\d{1,2})$/);
  const now = new Date();
  return {
    month: clampNum(m ? m[1] : now.getMonth() + 1, 1, 12),
    day: clampNum(m ? m[2] : now.getDate(), 1, 31)
  };
}

function daysInMonth(month) {
  return new Date(new Date().getFullYear(), month, 0).getDate();
}

function fillDateSelects() {
  const { month, day } = parseManualDate(cfg.dateManual);
  fillNumberSelect($('dateMonth'), 12, month);
  syncDateDayOptions(day);
}

function syncDateDayOptions(day) {
  const month = +$('dateMonth').value || (new Date().getMonth() + 1);
  fillNumberSelect($('dateDay'), daysInMonth(month), clampNum(day, 1, daysInMonth(month)));
}

function customWorshipPresets() {
  if (!Array.isArray(cfg.customWorshipPresets)) cfg.customWorshipPresets = [];
  return cfg.customWorshipPresets;
}

function renderCustomWorshipPresets() {
  const group = $('customWorshipGroup');
  const list = $('customWorshipList');
  const presets = customWorshipPresets();
  const selectedUrl = cfg.worshipPreset || ($('worshipPreset') && $('worshipPreset').value) || '';

  if (group) group.innerHTML = '';
  if (list) list.innerHTML = '';

  presets.forEach((item, index) => {
    if (!item || !item.url) return;
    const title = item.title || `自訂敬拜影片 ${index + 1}`;
    if (group) {
      const option = document.createElement('option');
      option.value = item.url;
      option.textContent = title;
      option.dataset.index = String(index);
      group.appendChild(option);
    }
    if (list) {
      const row = document.createElement('div');
      row.className = 'custom-worship-item';
      row.draggable = true;
      row.dataset.index = String(index);
      row.innerHTML = `
        <span class="drag-handle" aria-hidden="true">⋮⋮</span>
        <input type="text" class="custom-worship-title-input" maxlength="128" aria-label="公告歌名" draggable="false" />
        <button type="button" class="custom-delete-btn" title="刪除" aria-label="刪除">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 7h12" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M8 7l1 13h6l1-13" />
            <path d="M10 7V4h4v3" />
          </svg>
        </button>
      `;
      row.querySelector('.custom-worship-title-input').value = title;
      list.appendChild(row);
    }
  });
  if ($('worshipPreset')) $('worshipPreset').value = selectedUrl;
  if (group) group.hidden = !group.children.length;
  if (list) list.hidden = !presets.length;
}

function customWorshipTitleEditor(index) {
  const list = $('customWorshipList');
  return list ? list.querySelector(
    `.custom-worship-item[data-index="${index}"] .custom-worship-title-input`
  ) : null;
}

function updateCustomWorshipPresetTitle(index, value, respectActiveEditor = false) {
  const presets = customWorshipPresets();
  const item = presets[index];
  if (!item) return '';
  const input = customWorshipTitleEditor(index);
  const isActive = !!(input && typeof document !== 'undefined' && document.activeElement === input);
  let title = meaningfulWorshipTitle(value);
  if (respectActiveEditor && isActive) {
    const draft = meaningfulWorshipTitle(input.value);
    if (!draft) return '';
    title = draft;
  }
  if (!title) return '';
  item.title = title;
  if (input && !(respectActiveEditor && isActive)) input.value = title;
  const group = $('customWorshipGroup');
  const option = group && group.querySelector(`option[data-index="${index}"]`);
  if (option) option.textContent = title;
  return title;
}

function normalizeCustomWorshipUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isYouTube = host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com') ||
      host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com');
    if (parsed.protocol !== 'https:' || !isYouTube || parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function prepareWorshipTitleDraft(titleInput, url) {
  const resolvedUrl = titleInput.dataset.url || '';
  if (resolvedUrl && !sameWorshipUrl(resolvedUrl, url)) {
    titleInput.value = '';
    delete titleInput.dataset.url;
  }
}

async function prefillCustomWorshipTitle() {
  const url = normalizeCustomWorshipUrl($('inCustomWorshipUrl').value);
  const titleInput = $('inCustomWorshipTitle');
  prepareWorshipTitleDraft(titleInput, url);
  if (!url || meaningfulWorshipTitle(titleInput.value)) return;
  const token = ++customWorshipTitleRequestToken;
  const title = await lookupWorshipTitle(url);
  if (token !== customWorshipTitleRequestToken) return;
  if (!sameWorshipUrl($('inCustomWorshipUrl').value, url) || meaningfulWorshipTitle(titleInput.value)) return;
  if (title) {
    titleInput.value = title;
    titleInput.dataset.url = url;
  }
}

async function prefillManualWorshipTitle() {
  const url = normalizeCustomWorshipUrl($('inWorshipUrl').value);
  const titleInput = $('inWorshipTitle');
  prepareWorshipTitleDraft(titleInput, url);
  if (!url || meaningfulWorshipTitle(titleInput.value)) return;
  const known = currentWorshipAnnouncement();
  const knownTitle = sameWorshipUrl(known.url, url) ? meaningfulWorshipTitle(known.title) : '';
  if (knownTitle) {
    titleInput.value = knownTitle;
    titleInput.dataset.url = url;
    collectSettings();
    await window.api.setConfig(cfg);
    return;
  }
  const token = ++manualWorshipTitleRequestToken;
  const title = await lookupWorshipTitle(url);
  if (token !== manualWorshipTitleRequestToken) return;
  if (!sameWorshipUrl($('inWorshipUrl').value, url) || meaningfulWorshipTitle(titleInput.value)) return;
  if (title) {
    titleInput.value = title;
    titleInput.dataset.url = url;
    collectSettings();
    await window.api.setConfig(cfg);
  }
}

async function addCustomWorshipPreset() {
  const input = $('inCustomWorshipUrl');
  const url = normalizeCustomWorshipUrl(input.value);
  if (!url) {
    toast('請貼上有效的 YouTube 網址', 3000);
    return;
  }
  let presets = customWorshipPresets();
  let existing = presets.find((item) => item && sameWorshipUrl(item.url, url));
  const hadExisting = !!existing;
  const titleInput = $('inCustomWorshipTitle');
  let title = meaningfulWorshipTitle(titleInput.value) || (existing && meaningfulWorshipTitle(existing.title));
  const addButton = $('btnAddWorshipPreset');
  if (!title) {
    const lookupToken = ++customWorshipTitleRequestToken;
    const originalText = addButton.textContent;
    addButton.disabled = true;
    addButton.textContent = '讀取中…';
    try { title = await lookupWorshipTitle(url); }
    finally {
      addButton.disabled = false;
      addButton.textContent = originalText;
    }
    if (lookupToken !== customWorshipTitleRequestToken || !sameWorshipUrl(input.value, url)) {
      toast('連結已變更，請確認新的歌名後再加入', 3200);
      return;
    }
    title = meaningfulWorshipTitle(titleInput.value) || title;
    presets = customWorshipPresets();
    const currentExisting = presets.find((item) => item && sameWorshipUrl(item.url, url));
    if (hadExisting && !currentExisting) {
      toast('常用清單已變更，這次沒有加入', 3200);
      return;
    }
    existing = currentExisting;
  }
  if (!title) {
    titleInput.focus();
    toast('無法自動取得歌名，請填寫公告歌名後再加入', 4800);
    return;
  }
  let selectedUrl = url;
  if (!existing) {
    presets.push({ title, url });
  } else {
    existing.title = title;
    selectedUrl = existing.url;
  }
  renderCustomWorshipPresets();
  $('useWorshipPreset').checked = true;
  $('worshipPreset').value = selectedUrl;
  input.value = '';
  titleInput.value = '';
  delete titleInput.dataset.url;
  customWorshipTitleRequestToken++;
  applyWorshipMode();
  collectSettings();
  await window.api.setConfig(cfg);
  toast(existing ? '已更新並選取這部常用敬拜影片' : `已加入：${title}`, 3600);
}

async function renameCustomWorshipPreset(index, value, input) {
  const presets = customWorshipPresets();
  const item = presets[index];
  if (!item) return;
  const title = meaningfulWorshipTitle(value);
  if (!title) {
    input.value = item.title || `自訂敬拜影片 ${index + 1}`;
    toast('公告歌名不能留白', 2600);
    return;
  }
  updateCustomWorshipPresetTitle(index, title);
  await window.api.setConfig(cfg);
  toast('已更新公告歌名', 2200);
}

async function saveCustomWorshipOrder(fromIndex, toIndex) {
  const presets = customWorshipPresets();
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= presets.length || toIndex >= presets.length) return;
  const [moved] = presets.splice(fromIndex, 1);
  presets.splice(toIndex, 0, moved);
  renderCustomWorshipPresets();
  await window.api.setConfig(cfg);
}

async function deleteCustomWorshipPreset(index) {
  const presets = customWorshipPresets();
  const removed = presets[index];
  if (!removed) return;
  presets.splice(index, 1);
  if (cfg.worshipPreset === removed.url) {
    cfg.worshipPreset = '';
    if ($('worshipPreset')) $('worshipPreset').value = '';
    collectSettings();
  }
  renderCustomWorshipPresets();
  await window.api.setConfig(cfg);
  toast('已刪除常用敬拜影片', 2200);
}

function fillSettings() {
  cfg.fillMode = 'blur';
  $('dateAuto').checked = !!cfg.dateAuto;
  fillDateSelects();
  $('inReading').value = cfg.readingExtra || '';
  $('scheduleEnabled').checked = !!cfg.scheduleEnabled;
  $('inScheduleUrl').value = cfg.scheduleUrl || '';
  fillScriptureControls();
  $('inMusicUrl').value = cfg.musicUrl || '';
  const manualUrl = cfg.useWorshipPreset && cfg.worshipTitleUrl
    ? cfg.worshipTitleUrl : cfg.worshipUrl;
  $('inWorshipUrl').value = manualUrl || '';
  const manualTitle = sameWorshipUrl(cfg.worshipTitleUrl, manualUrl)
    ? meaningfulWorshipTitle(cfg.worshipTitle) : '';
  $('inWorshipTitle').value = manualTitle;
  if (manualTitle) $('inWorshipTitle').dataset.url = cfg.worshipTitleUrl;
  else delete $('inWorshipTitle').dataset.url;
  renderCustomWorshipPresets();
  $('worshipPreset').value = cfg.worshipPreset || '';
  $('useWorshipPreset').checked = !!cfg.useWorshipPreset;
  applyWorshipMode();
  $('musicVolume').value = cfg.musicVolume;
  $('autoPlayMusic').checked = !!cfg.autoPlayMusic;
  $('preventLeftArrowWorship').checked = cfg.preventLeftArrowWorship !== false;
  $('cacheKeepDays').value = String(cfg.cacheKeepDays != null ? cfg.cacheKeepDays : 30);
}

function collectSettings() {
  cfg.fillMode = 'blur';
  cfg.dateAuto = $('dateAuto').checked;
  cfg.dateManual = `${+$('dateMonth').value}/${+$('dateDay').value}`;
  cfg.readingExtra = $('inReading').value;
  cfg.scheduleEnabled = $('scheduleEnabled').checked;
  cfg.scheduleUrl = $('inScheduleUrl').value.trim();
  cfg.musicUrl = $('inMusicUrl').value.trim();
  cfg.useWorshipPreset = $('useWorshipPreset').checked;
  cfg.worshipPreset = $('worshipPreset').value;
  // 勾選常用影片時採用下拉選單，否則採用手動輸入網址。
  cfg.worshipUrl = cfg.useWorshipPreset ? cfg.worshipPreset : $('inWorshipUrl').value.trim();
  if (!cfg.useWorshipPreset) {
    cfg.worshipTitle = meaningfulWorshipTitle($('inWorshipTitle').value);
    cfg.worshipTitleUrl = cfg.worshipUrl;
    if (cfg.worshipTitle) $('inWorshipTitle').dataset.url = cfg.worshipUrl;
    else delete $('inWorshipTitle').dataset.url;
  }
  cfg.musicVolume = parseFloat($('musicVolume').value);
  cfg.autoPlayMusic = $('autoPlayMusic').checked;
  cfg.preventLeftArrowWorship = $('preventLeftArrowWorship').checked;
  cfg.cacheKeepDays = parseInt($('cacheKeepDays').value, 10);
}

// 切換常用影片與手動網址欄位。
function applyWorshipMode() {
  const usePreset = $('useWorshipPreset').checked;
  $('worshipPresetRow').classList.toggle('hidden', !usePreset);
  $('worshipUrlRow').classList.toggle('hidden', usePreset);
}

async function pasteInto(inputId) {
  const txt = await window.api.readClipboard();
  if (txt && txt.trim()) {
    const el = $(inputId);
    el.value = txt.trim();
    el.dispatchEvent(new Event('change'));
    toast('已貼上');
  } else {
    toast('剪貼簿沒有內容');
  }
}

let saveTimer = null;
function onSettingsChanged() {
  collectSettings();
  applyCover(null);
  $('bgAudio').volume = cfg.musicVolume;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.api.setConfig(cfg), 300);
}

// ---------- 下載進度 ----------
function showBadge(text) { const b = $('dlBadge'); b.textContent = text; b.classList.remove('hidden'); }
function hideBadge() { $('dlBadge').classList.add('hidden'); }

// 在背景預先下載媒體，減少正式播放時的等待。
async function prefetch(kind) {
  const label = kind === 'video' ? '敬拜影片' : '背景音樂';
  const url = kind === 'video' ? cfg.worshipUrl : cfg.musicUrl;
  if (!url) return;
  const s = await window.api.mediaStatus(url, kind, cfg.videoQuality);
  if (s.cached) return;
  showBadge(label + '下載中...');
  const r = await window.api.ensureMedia(url, kind, cfg.videoQuality);
  hideBadge();
  if (!r.ok) {
    const hint = kind === 'video' ? '，可以換一個連結加入常用敬拜影片' : '';
    toast(label + '下載失敗' + hint + '：' + r.error, 5200);
    return;
  }
  toast(label + '已準備好', 3000);
}

// ---------- 背景音樂 ----------
async function resolveAndPlayMusic() {
  if (!isMainCover()) return;
  if (!cfg.musicUrl) { musicDesired = false; setMusicSwitchState(false); toast('請先設定背景音樂 YouTube 連結'); openSettings(); return; }
  const requestedUrl = cfg.musicUrl;
  const requestToken = ++musicRequestToken;
  musicDesired = true;
  setMusicSwitchState(true);
  const a = $('bgAudio');
  const st = await window.api.mediaStatus(requestedUrl, 'audio');
  if (requestToken !== musicRequestToken || cfg.musicUrl !== requestedUrl || !isMainCover()) return;
  const needDownload = !st.cached;
  showBadge('背景音樂下載中...');
  const r = await window.api.ensureMedia(requestedUrl, 'audio');
  hideBadge();
  if (requestToken !== musicRequestToken || cfg.musicUrl !== requestedUrl || !musicDesired || !isMainCover()) return;
  if (!r.ok) { musicDesired = false; setMusicSwitchState(false); toast('背景音樂下載失敗：' + r.error, 4000); return; }
  const resolvedSrc = normalizeMediaUrl(r.path);
  if (normalizeMediaUrl(a.src) !== resolvedSrc) a.src = resolvedSrc;
  a.volume = cfg.musicVolume;
  try { await a.play(); } catch (e) { musicDesired = false; setMusicSwitchState(false); toast('播放失敗：' + e.message, 3000); return; }
  if (requestToken !== musicRequestToken || !musicDesired || !isMainCover()) { a.pause(); return; }
  musicPlaying = true;
  setMusicSwitchState(true);
  if (needDownload) toast('背景音樂已準備好，開始播放', 3000);
}

function normalizeMediaUrl(value) {
  if (!value) return '';
  try { return new URL(value, window.location.href).href; }
  catch { return String(value); }
}

function fadeOutMusic(done) {
  musicDesired = false;
  musicRequestToken++;
  const a = $('bgAudio');
  const start = a.volume;
  let v = start;
  if (musicFadeTimer) clearInterval(musicFadeTimer);
  musicFadeTimer = setInterval(() => {
    v -= start / 12;
    if (v <= 0) {
      clearInterval(musicFadeTimer);
      musicFadeTimer = null;
      a.pause();
      a.volume = cfg.musicVolume;
      musicPlaying = false;
      setMusicSwitchState(false);
      if (done) done();
    } else {
      a.volume = Math.max(0, v);
    }
  }, 40);
}

function isMainCover() {
  return flowStep === 'cover' && !worshipActive && $('flowScreen').classList.contains('hidden');
}

function pauseMusicForFlow() {
  musicResumeOnCover = musicResumeOnCover || musicDesired || musicPlaying;
  musicRequestToken++;
  musicDesired = false;
  setMusicSwitchState(false);
  if (musicPlaying && !musicFadeTimer) fadeOutMusic();
}

function resumeMusicOnCover() {
  if (flowReachedUtmost) {
    flowReachedUtmost = false;
    musicResumeOnCover = false;
    musicDesired = false;
    musicRequestToken++;
    const a = $('bgAudio');
    if (musicFadeTimer) {
      clearInterval(musicFadeTimer);
      musicFadeTimer = null;
    }
    a.pause();
    a.volume = cfg.musicVolume;
    musicPlaying = false;
    setMusicSwitchState(false);
    return;
  }
  const shouldResume = musicResumeOnCover || cfg.autoPlayMusic;
  musicResumeOnCover = false;
  if (!shouldResume || !cfg.musicUrl) return;
  const a = $('bgAudio');
  if (musicFadeTimer) {
    clearInterval(musicFadeTimer);
    musicFadeTimer = null;
    a.volume = cfg.musicVolume;
    if (!a.paused) {
      musicDesired = true;
      musicPlaying = true;
      setMusicSwitchState(true);
      return;
    }
  }
  if (!musicPlaying) resolveAndPlayMusic();
}

function setMusicSwitchState(on) {
  const btn = $('btnMusic');
  btn.classList.toggle('active', !!on);
  const label = btn.querySelector('i');
  if (label) label.textContent = on ? 'ON' : 'OFF';
}

function toggleMusic() {
  if (flowTransitioning || !isMainCover()) return;
  if (musicDesired || musicPlaying) {
    musicResumeOnCover = false;
    musicDesired = false;
    musicRequestToken++;
    setMusicSwitchState(false);
    if (musicPlaying) fadeOutMusic();
  } else {
    if (!cfg.musicUrl) {
      resolveAndPlayMusic();
      return;
    }
    musicDesired = true;
    setMusicSwitchState(true);
    resolveAndPlayMusic();
  }
}

// 空白鍵切換背景音樂播放狀態。
function toggleMusicPlayPause() {
  if (flowTransitioning || !isMainCover()) return;
  const a = $('bgAudio');
  if (!a.src) { resolveAndPlayMusic(); return; }
  if (a.paused) {
    musicDesired = true;
    setMusicSwitchState(true);
    a.play().then(() => { musicPlaying = true; }).catch((e) => {
      musicDesired = false;
      musicPlaying = false;
      setMusicSwitchState(false);
      toast('播放失敗：' + e.message, 3000);
    });
  }
  else { musicDesired = false; setMusicSwitchState(false); a.pause(); musicPlaying = false; }
}

// ---------- 閱讀流程 ----------
function setFlowVisible(visible) {
  if (!visible) hideFlowFooterImmediately();
  $('flowScreen').classList.toggle('hidden', !visible);
  $('bgBlur').classList.toggle('hidden', visible);
  $('bgImage').classList.toggle('hidden', visible);
  document.querySelector('.overlay-top').classList.toggle('hidden', visible);
  document.querySelector('.overlay-bottom').classList.toggle('hidden', visible);
}

function updateFlowDisplayScale() {
  const screen = $('flowScreen');
  if (!screen) return 1;
  const viewportWidth = Math.max(1, Number(window.innerWidth) || FLOW_LAYOUT_WIDTH);
  const viewportHeight = Math.max(1, Number(window.innerHeight) || FLOW_LAYOUT_HEIGHT);
  const scale = Math.max(0.01, Math.min(
    viewportWidth / FLOW_LAYOUT_WIDTH,
    viewportHeight / FLOW_LAYOUT_HEIGHT
  ));
  screen.style.setProperty('--flow-display-scale', scale.toFixed(6));
  screen.style.setProperty('--flow-control-min-size', `${(FLOW_MIN_CONTROL_SIZE / scale).toFixed(3)}px`);
  screen.style.setProperty('--flow-icon-min-size', `${(FLOW_MIN_ICON_SIZE / scale).toFixed(3)}px`);
  return scale;
}

function isReadingFlowStep(step = flowStep) {
  return step === 'scripture' || step === 'utmost';
}

function hideFlowFooterImmediately() {
  const screen = $('flowScreen');
  const footer = document.querySelector('.flow-footer');
  if (
    footer &&
    footer.contains(document.activeElement) &&
    document.activeElement &&
    typeof document.activeElement.blur === 'function'
  ) document.activeElement.blur();
  if (flowFooterHideTimer) clearTimeout(flowFooterHideTimer);
  flowFooterHideTimer = null;
  flowFooterHovered = false;
  if (screen) screen.classList.remove('footer-visible');
  if (footer) footer.classList.remove('footer-visible');
}

function revealFlowFooter() {
  if (flowFooterHideTimer) clearTimeout(flowFooterHideTimer);
  flowFooterHideTimer = null;
  const screen = $('flowScreen');
  if (
    !isReadingFlowStep() ||
    !screen ||
    screen.classList.contains('hidden') ||
    screen.dataset.step !== flowStep
  ) return;
  screen.classList.add('footer-visible');
}

function scheduleFlowFooterHide() {
  if (flowFooterHideTimer) clearTimeout(flowFooterHideTimer);
  flowFooterHideTimer = null;
  const scheduledStep = flowStep;
  const screen = $('flowScreen');
  const footer = document.querySelector('.flow-footer');
  if (
    !isReadingFlowStep(scheduledStep) ||
    !screen ||
    screen.classList.contains('hidden') ||
    screen.dataset.step !== scheduledStep
  ) {
    hideFlowFooterImmediately();
    return;
  }
  if (flowFooterHovered || (footer && footer.contains(document.activeElement))) {
    revealFlowFooter();
    return;
  }
  flowFooterHideTimer = setTimeout(() => {
    flowFooterHideTimer = null;
    if (
      flowStep === scheduledStep &&
      screen.dataset.step === scheduledStep &&
      !screen.classList.contains('hidden') &&
      !flowFooterHovered &&
      !(footer && footer.contains(document.activeElement))
    ) hideFlowFooterImmediately();
  }, 1000);
}

function setupFlowFooterReveal() {
  const screen = $('flowScreen');
  const footer = document.querySelector('.flow-footer');
  hideFlowFooterImmediately();

  if (screen) {
    screen.addEventListener('pointermove', () => {
      revealFlowFooter();
      scheduleFlowFooterHide();
    });
    screen.addEventListener('pointerleave', scheduleFlowFooterHide);
  }
  if (!footer) return;
  footer.addEventListener('pointerenter', () => {
    flowFooterHovered = true;
    revealFlowFooter();
  });
  footer.addEventListener('pointerleave', () => {
    flowFooterHovered = false;
    scheduleFlowFooterHide();
  });
  footer.addEventListener('focusin', revealFlowFooter);
  footer.addEventListener('pointerup', () => {
    if (!flowFooterHovered) scheduleFlowFooterHide();
  });
  footer.addEventListener('focusout', (event) => {
    if (event.relatedTarget && footer.contains(event.relatedTarget)) return;
    scheduleFlowFooterHide();
  });

  const hoverQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(hover: none)')
    : null;
  if (hoverQuery && typeof hoverQuery.addEventListener === 'function') {
    hoverQuery.addEventListener('change', () => {
      hideFlowFooterImmediately();
    });
  }
}

function nextPaint() {
  return new Promise((resolve) => {
    let settled = false;
    let fallbackTimer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      resolve();
    };
    requestAnimationFrame(finish);
    fallbackTimer = setTimeout(finish, 50);
  });
}

const UTMOST_MIN_REGULAR_SCALE = 0.48;

function textPage(text) {
  return { type: 'text', text: String(text || '') };
}

function parseScriptureVerses(text, ref = currentRefPayload()) {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const startChapter = Math.max(1, Number(ref.startCh) || 1);
  const endChapter = Math.max(startChapter, Number(ref.endCh) || startChapter);
  const book = Array.isArray(window.BIBLE) ? window.BIBLE.find((item) => item.n === ref.book) : null;
  const expected = [];
  if (book && Array.isArray(book.v)) {
    for (let expectedChapter = startChapter; expectedChapter <= endChapter; expectedChapter++) {
      const firstVerse = expectedChapter === startChapter ? Math.max(1, Number(ref.startV) || 1) : 1;
      const chapterLast = Number(book.v[expectedChapter - 1]) || 0;
      const lastVerse = expectedChapter === endChapter
        ? Math.min(chapterLast, Math.max(1, Number(ref.endV) || chapterLast))
        : chapterLast;
      for (let expectedVerse = firstVerse; expectedVerse <= lastVerse; expectedVerse++) {
        expected.push({ chapter: expectedChapter, number: expectedVerse });
      }
    }
  }
  const verses = [];
  let chapter = startChapter;
  let previousNumber = null;
  let expectedIndex = 0;
  let current = null;

  const pushCurrent = () => {
    if (!current || !current.text) return;
    current.text = current.text.trim();
    current.key = `${current.chapter}:${current.number}:${verses.length}`;
    verses.push(current);
  };

  lines.forEach((originalLine) => {
    let line = originalLine;
    const combinedStart = !current && !verses.length && line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    const startVerse = Math.max(1, Number(ref.startV) || 1);
    if (combinedStart && Number(combinedStart[1]) === startChapter && Number(combinedStart[2]) === startVerse && startChapter !== startVerse) {
      line = `${combinedStart[2]} ${combinedStart[3]}`;
    }
    const match = line.match(/^(\d+)\s*[.)、]?\s*(.+)$/);
    if (!match) {
      if (current) current.text += ` ${line}`;
      return;
    }

    pushCurrent();
    let number = Number(match[1]);
    const parsingFirstVerse = verses.length === 0;
    if (parsingFirstVerse && startVerse === 1 && startChapter !== 1 && number === startChapter) number = 1;
    let expectedLocation = null;
    for (let index = expectedIndex; index < expected.length; index++) {
      if (expected[index].number !== number) continue;
      expectedLocation = expected[index];
      expectedIndex = index + 1;
      break;
    }
    const fallbackReset = !expectedLocation && previousNumber !== null && number === 1 && previousNumber > 1 && chapter < endChapter;
    const nextChapter = expectedLocation ? expectedLocation.chapter : (fallbackReset ? chapter + 1 : chapter);
    const chapterReset = nextChapter !== chapter;
    chapter = nextChapter;
    if (chapterReset && verses.length) {
      const previousVerse = verses[verses.length - 1];
      previousVerse.text = previousVerse.text.replace(new RegExp(`\\s+${chapter}\\s*$`), '').trimEnd();
    }
    current = {
      chapter,
      number,
      text: match[2].trim(),
      continuation: false,
      startsChapter: chapterReset
    };
    previousNumber = number;
  });
  pushCurrent();

  if (!verses.length && lines.length) {
    verses.push({
      chapter: startChapter,
      number: '',
      text: lines.join(' '),
      continuation: false,
      startsChapter: false,
      key: `${startChapter}:fallback:0`
    });
  }
  return verses;
}

function createScripturePageElement(page) {
  const root = document.createElement('section');
  root.className = 'scripture-page';
  let renderedChapter = null;
  let renderedReader = null;

  (page.verses || []).forEach((verse, verseIndex) => {
    if (verse.readerIndex && (verseIndex === 0 || verse.readerIndex !== renderedReader)) {
      const continuesReader = verseIndex === 0 && (!verse.startsReaderSegment || verse.continuation);
      const reader = document.createElement('div');
      reader.className = `scripture-reader${continuesReader ? ' is-continuation' : ''}`;
      reader.textContent = `${verse.readerLabel}${continuesReader ? '（續）' : ''}`;
      root.appendChild(reader);
    }
    renderedReader = verse.readerIndex || renderedReader;

    if (verse.startsChapter && verse.chapter !== renderedChapter) {
      const chapter = document.createElement('div');
      chapter.className = 'scripture-chapter';
      chapter.textContent = `第 ${verse.chapter} 章`;
      root.appendChild(chapter);
      renderedChapter = verse.chapter;
    }

    const row = document.createElement('article');
    row.className = 'scripture-verse';

    const number = document.createElement('div');
    number.className = 'scripture-verse-number';
    number.textContent = String(verse.number || '—');

    const verseText = document.createElement('div');
    verseText.className = 'scripture-verse-text';
    if (verse.continuation) {
      const continuation = document.createElement('span');
      continuation.className = 'scripture-continuation';
      continuation.textContent = '續';
      verseText.appendChild(continuation);
      verseText.appendChild(document.createTextNode(verse.text || ''));
    } else {
      verseText.textContent = verse.text || '';
    }
    row.append(number, verseText);
    root.appendChild(row);
  });
  return root;
}

function splitUtmostVerseCitation(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  let separatorIndex = -1;
  for (const separator of ['—', '–', '―', '－']) {
    separatorIndex = Math.max(separatorIndex, text.lastIndexOf(separator));
  }
  const spacedHyphenIndex = text.lastIndexOf(' - ');
  if (spacedHyphenIndex >= 0) separatorIndex = Math.max(separatorIndex, spacedHyphenIndex + 1);
  if (separatorIndex < 0) return { text, quote: text, citation: '' };
  return {
    text,
    quote: text.slice(0, separatorIndex).trim(),
    citation: text.slice(separatorIndex).trim()
  };
}

function createUtmostPage(data) {
  const paragraphs = String(data.body || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return {
    type: 'utmost',
    date: String(data.date || systemDateChinese()).trim(),
    title: String(data.title || '竭誠獻上').trim(),
    verse: splitUtmostVerseCitation(data.verse),
    paragraphs: paragraphs.length ? paragraphs : ['今天暫時沒有正文內容。']
  };
}

function createUtmostPageElement(page) {
  const sheet = document.createElement('article');
  sheet.className = 'utmost-sheet';
  const regularScale = Number.isFinite(page.regularScale) ? Math.max(UTMOST_MIN_REGULAR_SCALE, Math.min(1, page.regularScale)) : 1;
  const extremeScale = Number.isFinite(page.extremeScale) ? Math.max(0.0001, Math.min(1, page.extremeScale)) : 1;
  sheet.style.setProperty('--utmost-scale', String(regularScale));
  if (extremeScale < 1) {
    sheet.classList.add('is-extreme');
    sheet.style.transform = `scale(${extremeScale})`;
  }

  const heading = document.createElement('header');
  heading.className = 'utmost-heading';
  const kicker = document.createElement('div');
  kicker.className = 'utmost-kicker';
  kicker.textContent = ['《竭誠獻上》', page.date].filter(Boolean).join(' · ');
  const title = document.createElement('h2');
  title.className = 'utmost-title';
  title.textContent = page.title || '竭誠獻上';
  heading.append(kicker, title);
  sheet.appendChild(heading);

  const verseCard = document.createElement('section');
  verseCard.className = 'utmost-verse-card';
  const verseLabel = document.createElement('div');
  verseLabel.className = 'utmost-section-label';
  verseLabel.textContent = '今日經文';
  const verseText = document.createElement('div');
  verseText.className = 'utmost-verse-text';
  const verse = page.verse && typeof page.verse === 'object'
    ? page.verse : splitUtmostVerseCitation(page.verse);
  const quote = document.createElement('span');
  quote.className = 'utmost-verse-quote';
  const citationIndex = verse.citation ? String(verse.text || '').lastIndexOf(verse.citation) : -1;
  const citationGap = citationIndex >= 0
    ? String(verse.text || '').slice(String(verse.quote || '').length, citationIndex)
    : '';
  quote.textContent = (verse.quote || (verse.citation ? '' : '—')) + citationGap;
  verseText.appendChild(quote);
  if (verse.citation) {
    const citation = document.createElement('cite');
    citation.className = 'utmost-verse-citation';
    citation.textContent = verse.citation;
    verseText.appendChild(citation);
  }
  verseCard.append(verseLabel, verseText);
  sheet.appendChild(verseCard);

  const body = document.createElement('section');
  body.className = 'utmost-body';
  (page.paragraphs || []).forEach((paragraph) => {
    const p = document.createElement('p');
    p.className = 'utmost-paragraph';
    p.textContent = paragraph;
    body.appendChild(p);
  });
  sheet.appendChild(body);
  return sheet;
}

function renderFlowPageContent(page) {
  const content = $('flowContent');
  content.replaceChildren();
  content.removeAttribute('data-fit-mode');
  const normalizedPage = page && typeof page === 'object' ? page : textPage(page);
  if (normalizedPage.type === 'scripture') content.appendChild(createScripturePageElement(normalizedPage));
  else if (normalizedPage.type === 'utmost') content.appendChild(createUtmostPageElement(normalizedPage));
  else content.textContent = normalizedPage.text || '';
}

function flowContentOverflows() {
  const content = $('flowContent');
  return content.scrollHeight > content.clientHeight + 2 || content.scrollWidth > content.clientWidth + 2;
}

function scripturePageFits(verses, pageContext = null) {
  $('flowScreen').style.setProperty('--flow-font-scale', '1');
  renderFlowPageContent({ type: 'scripture', ...(pageContext || {}), verses });
  return !flowContentOverflows();
}

function scriptureSentenceTokens(text) {
  return String(text || '').match(/[^。！？!?；;，,：:\n]+(?:[。！？!?；;，,：:]+|$)|\n+/g) || [String(text || '')];
}

function largestFittingVersePrefix(verse, text, continuation, fits = scripturePageFits, pageContext = null) {
  const chars = Array.from(text);
  let low = 1;
  let high = chars.length;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = chars.slice(0, mid).join('').trim();
    const candidateFits = candidate && fits(
      [{ ...verse, text: candidate, continuation, startsChapter: verse.startsChapter && !continuation }],
      pageContext
    );
    if (candidateFits) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return chars.slice(0, Math.max(best, 1)).join('');
}

function splitOversizedScriptureVerse(verse, fits = scripturePageFits, pageContext = null) {
  if (fits([verse], pageContext)) return [verse];
  const parts = [];
  let remaining = String(verse.text || '').trim();
  let continuation = Boolean(verse.continuation);

  while (remaining) {
    if (fits(
      [{ ...verse, text: remaining, continuation, startsChapter: verse.startsChapter && parts.length === 0 }],
      pageContext
    )) {
      parts.push({ ...verse, text: remaining, continuation, startsChapter: verse.startsChapter && parts.length === 0 });
      break;
    }

    let rawPrefix = '';
    for (const token of scriptureSentenceTokens(remaining)) {
      const candidateRaw = rawPrefix + token;
      const candidate = candidateRaw.trim();
      if (!candidate || fits(
        [{ ...verse, text: candidate, continuation, startsChapter: verse.startsChapter && parts.length === 0 }],
        pageContext
      )) {
        rawPrefix = candidateRaw;
      } else {
        break;
      }
    }
    if (!rawPrefix.trim()) rawPrefix = largestFittingVersePrefix(verse, remaining, continuation, fits, pageContext);

    const chunk = rawPrefix;
    parts.push({
      ...verse,
      text: chunk,
      continuation,
      startsChapter: verse.startsChapter && parts.length === 0
    });
    remaining = remaining.slice(rawPrefix.length);
    continuation = true;
  }
  return parts;
}

function logicalVerseCount(verses) {
  return new Set(verses.map((verse) => verse.key)).size;
}

function buildScripturePagesByFit(verses, fits = scripturePageFits, segments = []) {
  const sourceVerses = Array.isArray(verses) ? verses : [];
  const sourceSegments = Array.isArray(segments) ? segments.filter((segment) => (
    segment && segment.start && segment.end && segment.label
  )) : [];
  const compareLocation = (verse, location) => {
    const chapterDifference = Number(verse.chapter) - Number(location.chapter);
    return chapterDifference || (Number(verse.number) - Number(location.verse));
  };
  const segmentGroups = sourceSegments.map((segment) => sourceVerses.filter((verse) => (
    compareLocation(verse, segment.start) >= 0 && compareLocation(verse, segment.end) <= 0
  )));
  const assignedKeys = segmentGroups.flat().map((verse) => verse.key);
  const segmentationIsComplete = sourceSegments.length > 0 &&
    segmentGroups.every((group) => group.length > 0) &&
    assignedKeys.length === sourceVerses.length &&
    new Set(assignedKeys).size === new Set(sourceVerses.map((verse) => verse.key)).size;
  const readerCount = segmentationIsComplete ? sourceSegments.length : 0;
  const annotatedVerses = segmentationIsComplete
    ? sourceVerses.map((verse) => {
        const segmentIndex = sourceSegments.findIndex((segment) => (
          compareLocation(verse, segment.start) >= 0 && compareLocation(verse, segment.end) <= 0
        ));
        const segment = sourceSegments[segmentIndex];
        return {
          ...verse,
          readerIndex: segmentIndex + 1,
          readerCount,
          segmentLabel: segment.label,
          readerLabel: `第 ${segmentIndex + 1} 位・${segment.label}`,
          startsReaderSegment: compareLocation(verse, segment.start) === 0
        };
      })
    : sourceVerses;
  const expanded = annotatedVerses.flatMap((verse) => splitOversizedScriptureVerse(verse, fits));
  const pages = [];
  let current = [];

  expanded.forEach((verse) => {
    const candidate = [...current, verse];
    if (!current.length || fits(candidate)) {
      current = candidate;
      return;
    }
    pages.push({ type: 'scripture', verses: current });
    current = [verse];
  });
  if (current.length) pages.push({ type: 'scripture', verses: current });

  pages.forEach((page) => {
    const markers = [];
    let previousReader = null;
    (page.verses || []).forEach((verse, verseIndex) => {
      if (!verse.readerIndex || (verseIndex > 0 && verse.readerIndex === previousReader)) {
        previousReader = verse.readerIndex || previousReader;
        return;
      }
      const continuation = verseIndex === 0 && (!verse.startsReaderSegment || verse.continuation);
      markers.push({
        readerIndex: verse.readerIndex,
        verseKey: verse.key,
        continuation,
        label: `${verse.readerLabel}${continuation ? '（續）' : ''}`
      });
      previousReader = verse.readerIndex;
    });
    page.readerCount = readerCount;
    page.readerMarkers = markers;
    page.readerLabel = markers[0] ? markers[0].label : '';
  });
  return pages.length ? pages : [{ type: 'scripture', verses: [] }];
}

function currentScriptureSegments(ref = currentRefPayload()) {
  try {
    const shared = window.AssignmentShared;
    return shared && typeof shared.scriptureSegments === 'function'
      ? shared.scriptureSegments(ref, window.BIBLE)
      : [];
  } catch {
    return [];
  }
}

function handleReadingPointerActivity() {
  const surface = $('flowScreen');
  if (
    !isReadingFlowStep() ||
    !surface ||
    surface.classList.contains('hidden') ||
    surface.dataset.step !== flowStep
  ) return false;
  revealFlowFooter();
  scheduleFlowFooterHide();
  return true;
}

function setFlowButtonLabel(buttonId, label) {
  const button = $(buttonId);
  if (!button) return;
  const text = String(label || '');
  const labelElement = typeof button.querySelector === 'function'
    ? button.querySelector('.flow-btn-label')
    : null;
  if (labelElement) labelElement.textContent = text;
  else button.textContent = text;
  if (typeof button.setAttribute === 'function') {
    button.setAttribute('aria-label', text);
    button.setAttribute('title', text);
  }
}

function updateFlowPageProgress() {
  const info = $('flowPageInfo');
  if (!info) return;
  const total = Math.max(flowPages.length, 1);
  const current = Math.min(Math.max(flowPageIndex + 1, 1), total);
  const percentage = (current / total) * 100;
  info.textContent = `${current} / ${total}`;
  if (info.style && typeof info.style.setProperty === 'function') {
    info.style.setProperty('--flow-page-progress', `${percentage}%`);
  }
  if (typeof info.setAttribute === 'function') {
    const section = flowStep === 'utmost' ? '竭誠獻上' : '經文';
    const page = flowPages[flowPageIndex];
    const reader = flowStep === 'scripture' && page && page.readerLabel ? `，${page.readerLabel}` : '';
    info.setAttribute('aria-label', `${section}${reader}，第 ${current} 頁，共 ${total} 頁`);
  }
}

function renderFlowPage() {
  resetUtmostFinishConfirmation();
  const page = flowPages[flowPageIndex] || textPage('');
  flowPageRenderToken++;
  $('flowScreen').style.setProperty('--flow-font-scale', String(flowPageScales[flowPageIndex] || 1));
  renderFlowPageContent(page);
  updateFlowPageProgress();
  $('flowPrevPage').disabled = flowPageIndex <= 0 && flowStep !== 'scripture' && flowStep !== 'utmost';
  const isLastPage = flowPageIndex >= flowPages.length - 1;
  const isLastStep = flowStep === FLOW_ORDER[FLOW_ORDER.length - 1];
  const nextLabel = isLastPage && isLastStep ? '完成' : (isLastPage ? '竭誠獻上' : '下一頁');
  const prevLabel = flowPageIndex > 0 ? '上一頁' : (flowStep === 'utmost' ? '回到經文' : '返回敬拜');
  setFlowButtonLabel('flowPrevPage', prevLabel);
  setFlowButtonLabel('flowNextPage', nextLabel);
  $('flowNextPage').disabled = false;
}

function setFlowContent({ eyebrow, title, meta, pages, scales }) {
  $('flowEyebrow').textContent = eyebrow;
  $('flowTitle').textContent = title;
  $('flowMeta').textContent = meta || '';
  flowPages = Array.isArray(pages) && pages.length ? pages : [textPage('')];
  flowPageScales = scales || flowPages.map(() => 1);
  flowPageIndex = 0;
  setFlowVisible(true);
  renderFlowPage();
}

async function fitCurrentFlowPageToScreen(
  minScale = UTMOST_MIN_REGULAR_SCALE,
  navigationToken = flowNavigationToken,
  pageRenderToken = flowPageRenderToken
) {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch { /* 使用後備字型繼續排版。 */ }
  if (navigationToken !== flowNavigationToken || pageRenderToken !== flowPageRenderToken) return false;
  await nextPaint();
  if (navigationToken !== flowNavigationToken || pageRenderToken !== flowPageRenderToken) return false;
  await nextPaint();
  if (navigationToken !== flowNavigationToken || pageRenderToken !== flowPageRenderToken) return false;

  const content = $('flowContent');
  const page = flowPages[flowPageIndex];
  if (!page || page.type !== 'utmost') return true;
  const sheet = content.querySelector('.utmost-sheet');
  if (!sheet) return true;

  page.regularScale = 1;
  page.extremeScale = 1;
  sheet.style.removeProperty('transform');
  sheet.style.removeProperty('transform-origin');
  sheet.style.removeProperty('--utmost-scale');
  sheet.classList.remove('is-extreme');
  content.removeAttribute('data-fit-mode');

  let scale = 1;
  sheet.style.setProperty('--utmost-scale', String(scale));
  while (scale > minScale && flowContentOverflows()) {
    scale = Math.max(minScale, scale - 0.02);
    sheet.style.setProperty('--utmost-scale', scale.toFixed(2));
  }
  page.regularScale = scale;

  if (flowContentOverflows()) {
    sheet.classList.add('is-extreme');
    const contentStyle = getComputedStyle(content);
    const paddingLeft = Number.parseFloat(contentStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(contentStyle.paddingRight) || 0;
    const paddingTop = Number.parseFloat(contentStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(contentStyle.paddingBottom) || 0;
    const innerWidth = Math.max(1, content.clientWidth - paddingLeft - paddingRight);
    const innerHeight = Math.max(1, content.clientHeight - paddingTop - paddingBottom);
    const sheetWidth = Math.max(1, sheet.scrollWidth);
    const sheetHeight = Math.max(1, sheet.scrollHeight);
    if (flowContentOverflows()) {
      let transformScale = Math.max(0.0001, Math.min(1, innerWidth / sheetWidth, innerHeight / sheetHeight) * 0.995);
      sheet.style.transformOrigin = 'top center';
      for (let attempt = 0; attempt < 4; attempt++) {
        sheet.style.transform = `scale(${transformScale})`;
        const contentRect = content.getBoundingClientRect();
        const sheetRect = sheet.getBoundingClientRect();
        const availableBottom = contentRect.bottom - paddingBottom;
        const availableRight = contentRect.right - paddingRight;
        const availableLeft = contentRect.left + paddingLeft;
        const heightCorrection = sheetRect.bottom > availableBottom + 0.5
          ? Math.max(0.0001, (availableBottom - sheetRect.top) / Math.max(1, sheetRect.height))
          : 1;
        const widthCorrection = sheetRect.right > availableRight + 0.5 || sheetRect.left < availableLeft - 0.5
          ? Math.max(0.0001, innerWidth / Math.max(1, sheetRect.width))
          : 1;
        const correction = Math.min(heightCorrection, widthCorrection);
        if (correction >= 1) break;
        transformScale = Math.max(0.0001, transformScale * correction * 0.995);
      }
      page.extremeScale = transformScale;
      content.dataset.fitMode = 'extreme';
    }
  }
  return navigationToken === flowNavigationToken && pageRenderToken === flowPageRenderToken;
}

async function waitForFlowLayout(navigationToken) {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch { /* 使用後備字型繼續排版。 */ }
  if (navigationToken !== flowNavigationToken) return false;
  const screen = $('flowScreen');
  let lastWidth = -1;
  let lastHeight = -1;
  let stableFrames = 0;
  for (let frame = 0; frame < 30; frame++) {
    await nextPaint();
    if (navigationToken !== flowNavigationToken) return false;
    if (!screen || screen.classList.contains('hidden')) {
      if (frame >= 1) break;
      continue;
    }
    const width = screen.clientWidth;
    const height = screen.clientHeight;
    if (Math.abs(width - lastWidth) < 0.5 && Math.abs(height - lastHeight) < 0.5) stableFrames++;
    else stableFrames = 0;
    lastWidth = width;
    lastHeight = height;
    if (frame >= 4 && stableFrames >= 3) break;
  }
  return navigationToken === flowNavigationToken;
}

function scriptureRefKey(ref = currentRefPayload()) {
  return [ref.book, ref.startCh, ref.startV, ref.endCh, ref.endV].join(':');
}

function invalidateScriptureData() {
  cachedBible = null;
  cachedBibleKey = '';
  scriptureRequest = null;
  scriptureRequestToken++;
}

async function ensureScriptureData() {
  const ref = currentRefPayload();
  const key = scriptureRefKey(ref);
  if (cachedBible && cachedBibleKey === key) return cachedBible;
  if (scriptureRequest && scriptureRequest.key === key) return scriptureRequest.promise;

  const requestToken = scriptureRequestToken;
  const promise = (async () => {
    let result;
    try { result = await window.api.biblePassage(ref); }
    catch (e) { result = { ok: false, error: e.message }; }
    if (requestToken !== scriptureRequestToken || key !== scriptureRefKey()) {
      return ensureScriptureData();
    }
    cachedBible = result && result.ok ? result : {
      ok: false,
      title: formatScriptureShort(),
      body: '目前無法抓取經文，請稍後再試。\n\n' + ((result && result.error) || '')
    };
    cachedBibleKey = key;
    return cachedBible;
  })();
  scriptureRequest = { key, promise };
  try { return await promise; }
  finally {
    if (scriptureRequest && scriptureRequest.promise === promise) scriptureRequest = null;
  }
}

async function ensureUtmostData() {
  if (cachedUtmost) return cachedUtmost;
  let result;
  try { result = await window.api.utmostToday(); }
  catch (e) { result = { ok: false, error: e.message }; }
  cachedUtmost = result && result.ok ? result : {
    ok: false,
    date: systemDateMD(),
    title: '竭誠獻上',
    verse: '',
    body: '目前無法抓取竭誠獻上，請稍後再試。\n\n' + ((result && result.error) || '')
  };
  return cachedUtmost;
}

async function refreshDailyReadingData() {
  invalidateScriptureData();
  cachedUtmost = null;
  let scheduleOk = true;
  if (cfg.scheduleEnabled && cfg.scheduleUrl) scheduleOk = await applySchedule(false);
  const results = await Promise.allSettled([ensureScriptureData(), ensureUtmostData()]);
  return scheduleOk && results.every((result) => result.status === 'fulfilled' && result.value && result.value.ok);
}

function scheduleDailyReadingRefresh() {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(8, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(async () => {
      try {
        await refreshDailyReadingData();
      } finally {
        scheduleNext();
      }
    }, next.getTime() - now.getTime());
  };
  scheduleNext();
}

async function showScriptureFlow(navigationToken) {
  if (flowLoading) return;
  flowLoading = true;
  setFlowContent({ eyebrow: '', title: '載入中...', meta: '', pages: [textPage('正在抓取今天的經文內容...')] });
  try {
    const data = await ensureScriptureData();
    if (navigationToken !== flowNavigationToken) return false;
    setFlowContent({
      eyebrow: '',
      title: formatScriptureBookTitle(),
      meta: '',
      pages: [textPage('')]
    });
    if (!await waitForFlowLayout(navigationToken)) return false;
    const verses = parseScriptureVerses(data.body || '', currentRefPayload());
    const pages = buildScripturePagesByFit(verses, scripturePageFits, currentScriptureSegments());
    if (navigationToken !== flowNavigationToken) return false;
    flowLoading = false;
    setFlowContent({
      eyebrow: '',
      title: formatScriptureBookTitle(),
      meta: '',
      pages
    });
    return true;
  } finally {
    if (navigationToken === flowNavigationToken) flowLoading = false;
  }
}

async function showUtmostFlow(navigationToken) {
  if (flowLoading) return;
  hideFlowFooterImmediately();
  flowLoading = true;
  $('flowScreen').dataset.step = 'utmost';
  setFlowContent({
    eyebrow: '',
    title: '',
    meta: '',
    pages: [createUtmostPage({ title: '載入中…', verse: '', body: '正在抓取今天竭誠獻上的內容…' })]
  });
  try {
    const data = await ensureUtmostData();
    if (navigationToken !== flowNavigationToken) return false;
    flowLoading = false;
    setFlowContent({ eyebrow: '', title: '', meta: '', pages: [createUtmostPage(data)], scales: [1] });
    const pageRenderToken = flowPageRenderToken;
    if (!await waitForFlowLayout(navigationToken) || pageRenderToken !== flowPageRenderToken) return false;
    return await fitCurrentFlowPageToScreen(UTMOST_MIN_REGULAR_SCALE, navigationToken, pageRenderToken);
  } finally {
    if (navigationToken === flowNavigationToken) flowLoading = false;
  }
}

function showEndScreen() {
  hideFlowFooterImmediately();
  flowStep = 'end';
  $('flowScreen').dataset.step = 'end';
  setFlowContent({
    eyebrow: '',
    title: '',
    meta: '',
    pages: ['今天的流程完成了']
  });
}

async function goFlowStep(step) {
  if (flowTransitioning) return false;
  resetUtmostFinishConfirmation();
  if (flowStep === 'cover' && step !== 'cover') flowReachedUtmost = false;
  if (isReadingFlowStep(flowStep) || isReadingFlowStep(step)) hideFlowFooterImmediately();
  const navigationToken = ++flowNavigationToken;
  flowTransitioning = true;
  try {
    if (step !== 'worship' && worshipActive) stopWorshipPlayback();
    if (step === 'cover') {
      flowStep = 'cover';
      setFlowVisible(false);
      await window.api.setWindowMode('wide');
      if (navigationToken !== flowNavigationToken) return false;
      showToolbar();
      resumeMusicOnCover();
      return true;
    }
    if (step === 'worship') {
      pauseMusicForFlow();
      flowStep = 'worship';
      setFlowVisible(false);
      await window.api.setWindowMode('wide');
      if (navigationToken !== flowNavigationToken) return false;
      return await startWorship();
    }
    flowStep = step;
    pauseMusicForFlow();
    if (step === 'utmost') flowReachedUtmost = true;
    $('toolbar').classList.remove('show');
    $('worshipControls').classList.remove('show');
    $('flowScreen').dataset.step = step;
    await window.api.setWindowMode(step === 'scripture' || step === 'utmost' ? 'mobile' : 'wide');
    if (navigationToken !== flowNavigationToken) return false;
    updateFlowDisplayScale();
    if (!await waitForFlowLayout(navigationToken)) return false;
    if (step === 'scripture') return await showScriptureFlow(navigationToken);
    if (step === 'utmost') return await showUtmostFlow(navigationToken);
    return true;
  } finally {
    if (navigationToken === flowNavigationToken) flowTransitioning = false;
  }
}

async function returnToMainCover() {
  resetUtmostFinishConfirmation();
  hideFlowFooterImmediately();
  const navigationToken = ++flowNavigationToken;
  flowTransitioning = true;
  flowLoading = false;
  if (worshipActive) stopWorshipPlayback();
  flowStep = 'cover';
  setFlowVisible(false);
  try { await window.api.setWindowMode('wide'); }
  finally {
    if (navigationToken === flowNavigationToken) {
      flowTransitioning = false;
      showToolbar();
      resumeMusicOnCover();
    }
  }
}

function nextFlowStep() {
  if (flowTransitioning) return;
  const idx = FLOW_ORDER.indexOf(flowStep);
  if (idx >= FLOW_ORDER.length - 1) return;
  goFlowStep(FLOW_ORDER[Math.min(idx + 1, FLOW_ORDER.length - 1)] || 'cover');
}

function prevFlowStep() {
  if (flowTransitioning) return;
  const idx = FLOW_ORDER.indexOf(flowStep);
  goFlowStep(FLOW_ORDER[Math.max(idx - 1, 0)] || 'cover');
}

function isUtmostFinalPage() {
  return flowStep === 'utmost' &&
    !$('flowScreen').classList.contains('hidden') &&
    flowPageIndex >= flowPages.length - 1;
}

function resetUtmostFinishConfirmation() {
  const wasArmed = utmostFinishConfirmUntil > Date.now();
  if (utmostFinishConfirmTimer) clearTimeout(utmostFinishConfirmTimer);
  utmostFinishConfirmTimer = null;
  utmostFinishConfirmUntil = 0;
  if (isUtmostFinalPage()) setFlowButtonLabel('flowNextPage', '完成');
  return wasArmed;
}

function requestUtmostFinishConfirmation() {
  const now = Date.now();
  if (utmostFinishConfirmUntil > now) {
    resetUtmostFinishConfirmation();
    return true;
  }

  resetUtmostFinishConfirmation();
  utmostFinishConfirmUntil = now + UTMOST_FINISH_CONFIRM_MS;
  setFlowButtonLabel('flowNextPage', '再按一次完成');
  revealFlowFooter();
  scheduleFlowFooterHide();
  toast('請再按一次，以確認回到主畫面', 3000);
  utmostFinishConfirmTimer = setTimeout(() => {
    utmostFinishConfirmTimer = null;
    utmostFinishConfirmUntil = 0;
    if (isUtmostFinalPage()) setFlowButtonLabel('flowNextPage', '完成');
  }, UTMOST_FINISH_CONFIRM_MS);
  return false;
}

function requestFlowReturnToCover(source = 'button') {
  if (isUtmostFinalPage()) {
    if (source === 'wheel') {
      revealFlowFooter();
      scheduleFlowFooterHide();
      toast('請按「完成」或右方向鍵回到主畫面', 2600);
      return false;
    }
    if (!requestUtmostFinishConfirmation()) return false;
  }
  returnToMainCover();
  return true;
}

function nextFlowPageOrStep(source = 'button') {
  if (flowTransitioning) return;
  if (flowStep === 'end') {
    return;
  }
  if ($('flowScreen').classList.contains('hidden')) { nextFlowStep(); return; }
  if (flowPageIndex < flowPages.length - 1) {
    flowPageIndex++;
    renderFlowPage();
  } else {
    if (flowStep === FLOW_ORDER[FLOW_ORDER.length - 1]) {
      requestFlowReturnToCover(source);
      return;
    }
    nextFlowStep();
  }
}

function prevFlowPageOrStep() {
  if (flowTransitioning) return;
  if (resetUtmostFinishConfirmation()) {
    revealFlowFooter();
    scheduleFlowFooterHide();
    return;
  }
  if ($('flowScreen').classList.contains('hidden')) { prevFlowStep(); return; }
  if (flowPageIndex > 0) {
    flowPageIndex--;
    renderFlowPage();
  } else if (flowStep === 'utmost') {
    goFlowStep('scripture').then((ok) => {
      if (!ok || flowStep !== 'scripture') return;
      flowPageIndex = Math.max(flowPages.length - 1, 0);
      renderFlowPage();
    });
  } else if (flowStep === 'scripture') {
    goFlowStep('worship');
  }
}

// ---------- 敬拜影片 ----------
async function startWorship() {
  if (!cfg.worshipUrl) {
    flowStep = 'cover';
    toast('請先設定敬拜影片 YouTube 連結');
    openSettings();
    resumeMusicOnCover();
    return false;
  }
  const requestedUrl = cfg.worshipUrl;
  const requestedQuality = cfg.videoQuality;
  const requestToken = ++worshipRequestToken;
  const layer = $('worshipLayer');
  worshipActive = true;
  $('toolbar').classList.remove('show');
  $('wSeek').value = '0';
  $('wCur').textContent = '0:00';
  $('wDur').textContent = '0:00';
  layer.classList.remove('hidden');
  $('worshipLoading').textContent = '敬拜影片載入中...';
  $('worshipLoading').classList.remove('hidden');
  $('btnWorship').classList.add('hidden');
  $('btnBack').classList.remove('hidden');
  setWorshipReturnButton(flowStep === 'worship');
  setWorshipPlayState(false);
  showToolbar();

  pauseMusicForFlow();

  const r = await window.api.ensureMedia(requestedUrl, 'video', requestedQuality);
  if (requestToken !== worshipRequestToken || !worshipActive) return false;
  if (cfg.worshipUrl !== requestedUrl || cfg.videoQuality !== requestedQuality) {
    stopWorshipPlayback();
    return false;
  }
  if (!r.ok) {
    toast('敬拜影片載入失敗：' + r.error, 4000);
    await backToCover();
    return false;
  }
  playWorshipVideo(r.path, false, requestToken);
  return true;
}

// 明確 load 後播放；首次失敗會重試一次，再提示使用者手動播放。
function playWorshipVideo(src, retried, requestToken = worshipRequestToken) {
  const video = $('worshipVideo');
  if (worshipPlayRetryTimer) clearTimeout(worshipPlayRetryTimer);
  worshipPlayRetryTimer = null;
  video.pause();
  video.src = src;
  video.load();
  video.volume = 1;
  video.play().then(() => {
    if (requestToken !== worshipRequestToken || !worshipActive) return;
    $('worshipLoading').classList.add('hidden');
  }).catch(() => {
    if (requestToken !== worshipRequestToken || !worshipActive) return;
    if (!retried && worshipActive && requestToken === worshipRequestToken) {
      worshipPlayRetryTimer = setTimeout(() => playWorshipVideo(src, true, requestToken), 300);
      return;
    }
    if (worshipActive) {
      $('worshipLoading').textContent = '無法自動播放，請按下播放鍵';
      $('worshipLoading').classList.remove('hidden');
      setWorshipPlayState(false);
      showToolbar();
    }
  });
}

function stopWorshipPlayback() {
  worshipRequestToken++;
  if (worshipPlayRetryTimer) clearTimeout(worshipPlayRetryTimer);
  worshipPlayRetryTimer = null;
  const video = $('worshipVideo');
  video.pause();
  video.removeAttribute('src');
  video.load();
  worshipControlsHovered = false;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  worshipActive = false;
  $('worshipControls').classList.remove('show');
  $('wBackTop').classList.remove('show');
  $('worshipLayer').classList.add('hidden');
  $('worshipLoading').classList.add('hidden');
  $('btnBack').classList.add('hidden');
  $('btnWorship').classList.add('hidden');
  setWorshipPlayState(false);
}

function showScriptureTransitionSurface() {
  hideFlowFooterImmediately();
  $('toolbar').classList.remove('show');
  $('worshipControls').classList.remove('show');
  $('flowScreen').dataset.step = 'scripture';
  updateFlowDisplayScale();
  setFlowContent({
    eyebrow: '',
    title: formatScriptureBookTitle(),
    meta: '',
    pages: [textPage('正在準備今日經文…')]
  });
}

async function backToCover(options) {
  options = options || {};
  const shouldContinueToScripture = flowStep === 'worship' && options.nextAfterWorship;
  if (shouldContinueToScripture) {
    // Prepare the reading surface underneath the worship layer first. Hiding
    // the video then reveals Scripture instead of briefly exposing the cover toolbar.
    showScriptureTransitionSurface();
    stopWorshipPlayback();
    flowNavigationToken++;
    flowTransitioning = false;
    flowLoading = false;
    await goFlowStep('scripture');
  } else {
    stopWorshipPlayback();
    await returnToMainCover();
  }
}

function isEditableFlowNavigationTarget(target) {
  const tag = target && target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'VIDEO') return true;
  if (target && target.isContentEditable) return true;
  return !!(
    target &&
    typeof target.closest === 'function' &&
    target.closest('[contenteditable="true"], [role="textbox"], [role="slider"]')
  );
}

function resetFlowWheelGesture() {
  if (flowWheelResetTimer) clearTimeout(flowWheelResetTimer);
  flowWheelResetTimer = null;
  flowWheelDelta = 0;
  flowWheelGestureLocked = false;
}

function normalizedFlowWheelDelta(value, deltaMode) {
  const delta = Number(value) || 0;
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * Math.max(Number(window.innerHeight) || 0, 1);
  return delta;
}

function handleFlowWheelNavigation(event) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  if (flowStep !== 'scripture' && flowStep !== 'utmost') return false;
  if (
    $('flowScreen').classList.contains('hidden') ||
    !$('settingsPanel').classList.contains('hidden') ||
    worshipActive ||
    isEditableFlowNavigationTarget(event.target)
  ) return false;

  const deltaMode = Number(event.deltaMode) || 0;
  const deltaY = normalizedFlowWheelDelta(event.deltaY, deltaMode);
  const deltaX = normalizedFlowWheelDelta(event.deltaX, deltaMode);
  if (!deltaY || Math.abs(deltaY) <= Math.abs(deltaX)) return false;

  event.preventDefault();
  if (flowWheelResetTimer) clearTimeout(flowWheelResetTimer);
  flowWheelResetTimer = setTimeout(resetFlowWheelGesture, FLOW_WHEEL_IDLE_MS);
  if (flowTransitioning || flowLoading) {
    flowWheelGestureLocked = true;
    flowWheelDelta = 0;
    return true;
  }
  if (flowWheelGestureLocked) return true;
  if (flowWheelDelta && Math.sign(flowWheelDelta) !== Math.sign(deltaY)) flowWheelDelta = 0;
  flowWheelDelta += deltaY;
  if (Math.abs(flowWheelDelta) < FLOW_WHEEL_THRESHOLD) return true;

  const forwards = flowWheelDelta > 0;
  flowWheelDelta = 0;
  flowWheelGestureLocked = true;
  if (forwards) nextFlowPageOrStep('wheel');
  else prevFlowPageOrStep();
  return true;
}

function handleFlowArrowNavigation(event) {
  if (!event || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return false;
  if (
    event.repeat ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) return false;
  if (flowStep !== 'scripture' && flowStep !== 'utmost') return false;
  if (
    $('flowScreen').classList.contains('hidden') ||
    !$('settingsPanel').classList.contains('hidden') ||
    worshipActive ||
    flowTransitioning ||
    flowLoading ||
    isEditableFlowNavigationTarget(event.target)
  ) return false;

  event.preventDefault();
  if (event.key === 'ArrowRight') {
    nextFlowPageOrStep('keyboard');
  } else if (cfg.preventLeftArrowWorship !== false && flowStep === 'scripture' && flowPageIndex <= 0) {
    return true;
  } else {
    prevFlowPageOrStep();
  }
  return true;
}

function handleEscapeNavigation(event) {
  if (!event || event.key !== 'Escape' || event.repeat || event.isComposing) return false;
  if (!$('settingsPanel').classList.contains('hidden')) {
    closeSettings();
    return true;
  }
  if (worshipActive || flowStep !== 'cover' || !$('flowScreen').classList.contains('hidden')) {
    event.preventDefault();
    requestFlowReturnToCover('escape');
    return true;
  }
  return false;
}

// ---------- 背景圖片 ----------
async function useImagePath(srcPath) {
  if (!srcPath) return;
  const r = await window.api.saveBackground(srcPath);
  if (r && r.url) { setBackground(r.url); cfg.backgroundFile = r.fileName; toast('背景已更新'); }
}

function setupDragDrop() {
  const canvas = $('canvas');
  window.addEventListener('dragover', (e) => {
    if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    canvas.classList.add('dragging');
  });
  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) canvas.classList.remove('dragging');
  });
  window.addEventListener('drop', async (e) => {
    if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    canvas.classList.remove('dragging');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('請拖入圖片檔'); return; }
    const p = window.api.pathForFile(file);
    if (p) useImagePath(p);
    else toast('無法讀取圖片');
  });
}

// ---------- 自動顯示與隱藏工具列 ----------
let hideTimer = null;
let worshipControlsHovered = false;
const MAIN_TOOLBAR_HIDE_MS = 2200;
const WORSHIP_CONTROLS_HIDE_MS = 1000;

function showToolbar() {
  if (!worshipActive && !$('flowScreen').classList.contains('hidden')) {
    $('toolbar').classList.remove('show');
    $('worshipControls').classList.remove('show');
    $('wBackTop').classList.remove('show');
    clearTimeout(hideTimer);
    return;
  }
  const bar = worshipActive ? $('worshipControls') : $('toolbar');
  bar.classList.add('show');
  if (worshipActive) $('wBackTop').classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = null;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (!$('settingsPanel').classList.contains('hidden')) return;
    if (worshipActive && worshipControlsHovered) return;
    $('toolbar').classList.remove('show');
    $('worshipControls').classList.remove('show');
    $('wBackTop').classList.remove('show');
  }, worshipActive ? WORSHIP_CONTROLS_HIDE_MS : MAIN_TOOLBAR_HIDE_MS);
}

function handleToolbarPointerMove(event) {
  if (!worshipActive) {
    showToolbar();
    return;
  }
  const controls = $('worshipControls');
  const hotzone = $('worshipHotzone');
  const back = $('wBackTop');
  const backHotzone = $('worshipBackHotzone');
  const target = event && event.target;
  if (
    target &&
    ((controls && controls.contains(target)) ||
      (hotzone && hotzone.contains(target)) ||
      (back && back.contains(target)) ||
      (backHotzone && backHotzone.contains(target)))
  ) showToolbar();
}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  s = Math.floor(s);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function setWorshipPlayState(isPlaying) {
  const btn = $('wPlay');
  btn.classList.toggle('playing', !!isPlaying);
  btn.title = isPlaying ? '暫停' : '播放';
  btn.setAttribute('aria-label', isPlaying ? '暫停' : '播放');
}

function setWorshipReturnButton(nextToScripture) {
  const btn = $('wReturn');
  btn.classList.toggle('next-to-scripture', !!nextToScripture);
  btn.title = nextToScripture ? '前往經文' : '回到封面';
  btn.innerHTML = nextToScripture
    ? '<span>前往今日經文</span>'
    : '<span>回封面</span>';
}

function setupWorshipControls() {
  const v = $('worshipVideo');
  const seek = $('wSeek');
  const controls = $('worshipControls');
  const back = $('wBackTop');
  v.addEventListener('loadedmetadata', () => { $('wDur').textContent = fmtTime(v.duration); });
  v.addEventListener('timeupdate', () => {
    if (v.duration) seek.value = String((v.currentTime / v.duration) * 1000);
    $('wCur').textContent = fmtTime(v.currentTime);
  });
  v.addEventListener('play', () => setWorshipPlayState(true));
  v.addEventListener('playing', () => $('worshipLoading').classList.add('hidden'));
  v.addEventListener('pause', () => setWorshipPlayState(false));
  v.addEventListener('error', () => {
    if (!worshipActive) return;
    $('worshipLoading').textContent = '影片播放失敗，請返回後再試一次';
    $('worshipLoading').classList.remove('hidden');
    showToolbar();
  });
  v.addEventListener('ended', () => backToCover({ nextAfterWorship: true }));
  seek.addEventListener('input', () => {
    if (v.duration) v.currentTime = (parseFloat(seek.value) / 1000) * v.duration;
  });
  $('wPlay').addEventListener('click', async () => {
    if (!v.paused) { v.pause(); return; }
    try {
      await v.play();
      $('worshipLoading').classList.add('hidden');
    } catch (e) {
      $('worshipLoading').textContent = '播放失敗，請稍後再試';
      $('worshipLoading').classList.remove('hidden');
      toast('影片播放失敗：' + e.message, 3200);
    }
  });
  back.addEventListener('click', () => backToCover());
  $('wReturn').addEventListener('click', () => backToCover({ nextAfterWorship: true }));
  const holdWorshipChrome = () => {
    worshipControlsHovered = true;
    clearTimeout(hideTimer);
    hideTimer = null;
    if (worshipActive) {
      controls.classList.add('show');
      back.classList.add('show');
    }
  };
  const releaseWorshipChrome = () => {
    worshipControlsHovered = false;
    if (worshipActive) showToolbar();
  };
  controls.addEventListener('pointerenter', holdWorshipChrome);
  controls.addEventListener('pointerleave', releaseWorshipChrome);
  back.addEventListener('pointerenter', holdWorshipChrome);
  back.addEventListener('pointerleave', releaseWorshipChrome);
}

// ---------- 設定面板 ----------
function isSettingsOutsideTarget(target) {
  const panel = $('settingsPanel');
  if (!panel || panel.classList.contains('hidden') || !target) return false;
  if (panel.contains(target)) return false;
  return !(typeof target.closest === 'function' && target.closest('#btnSettings'));
}

function shouldDismissSettingsFromPointer(pointerStartedOutside, releaseTarget) {
  return Boolean(pointerStartedOutside && isSettingsOutsideTarget(releaseTarget));
}

function settingsTextSelectionAnchor(field) {
  const start = Math.max(0, Number(field && field.selectionStart) || 0);
  const end = Math.max(start, Number(field && field.selectionEnd) || start);
  return field && field.selectionDirection === 'backward' ? end : start;
}

function extendSettingsTextSelectionToBoundary(field, anchor, clientX) {
  if (!field || typeof field.setSelectionRange !== 'function') return false;
  const rect = field.getBoundingClientRect();
  let focus = null;
  if (clientX <= rect.left) focus = 0;
  else if (clientX >= rect.right) focus = String(field.value || '').length;
  if (focus === null) return false;
  const safeAnchor = Math.max(0, Math.min(String(field.value || '').length, Number(anchor) || 0));
  field.setSelectionRange(
    Math.min(safeAnchor, focus),
    Math.max(safeAnchor, focus),
    focus < safeAnchor ? 'backward' : 'forward'
  );
  return true;
}

function setupSettingsTextSelection() {
  const panel = $('settingsPanel');
  if (!panel) return;
  let drag = null;

  const finishDrag = (event) => {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const current = drag;
    drag = null;
    try {
      if (
        typeof current.field.hasPointerCapture === 'function' &&
        current.field.hasPointerCapture(current.pointerId)
      ) current.field.releasePointerCapture(current.pointerId);
    } catch { /* Pointer capture may already have ended outside the window. */ }
  };

  panel.addEventListener('pointerdown', (event) => {
    const target = event.target;
    const field = target && typeof target.closest === 'function'
      ? target.closest('input[type="text"], textarea')
      : null;
    if (!field || event.button !== 0) return;
    drag = { field, pointerId: event.pointerId, anchor: null };
    try { field.setPointerCapture(event.pointerId); }
    catch { /* Native selection remains available if capture is unsupported. */ }
    setTimeout(() => {
      if (drag && drag.field === field && drag.pointerId === event.pointerId) {
        drag.anchor = settingsTextSelectionAnchor(field);
      }
    }, 0);
  });

  panel.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId || !(event.buttons & 1)) return;
    if (drag.anchor === null) drag.anchor = settingsTextSelectionAnchor(drag.field);
    extendSettingsTextSelectionToBoundary(drag.field, drag.anchor, event.clientX);
  });
  panel.addEventListener('pointerup', finishDrag);
  panel.addEventListener('pointercancel', finishDrag);
  panel.addEventListener('lostpointercapture', finishDrag);
}

function openSettings() {
  settingsPointerStartedOutside = false;
  fillSettings();
  $('settingsPanel').classList.remove('hidden');
  $('settingsBackdrop').classList.remove('hidden');
  $('toolbar').classList.add('show');
}
function closeSettings() {
  settingsPointerStartedOutside = false;
  $('settingsPanel').classList.add('hidden');
  $('settingsBackdrop').classList.add('hidden');
}

// ---------- App 自動更新 ----------
function setupAppUpdater() {
  const appVerEl = $('appVer');
  const updateButton = $('btnAppUpdate');
  const updateMessage = $('appUpdateMsg');
  const updateProgress = $('appUpdateProgress');
  const updatePercent = $('appUpdatePct');
  const installButton = $('btnAppInstall');
  const banner = $('updateBanner');
  const bannerText = $('updateBannerText');
  const bannerDownload = $('btnUpdateDownload');
  const bannerDismiss = $('btnUpdateDismiss');

  const openManualUpdate = async (result) => {
    updateProgress.classList.add('hidden');
    if (!result || !result.url) {
      updateMessage.textContent = (result && result.error) || '請到下載頁手動更新';
      return false;
    }
    updateMessage.textContent = '已開啟下載頁，請下載後手動安裝';
    await window.api.openExternal(result.url);
    return true;
  };

  window.api.appVersion().then((v) => { appVerEl.textContent = v || '--'; })
    .catch(() => { appVerEl.textContent = '--'; });

  updateButton.addEventListener('click', async () => {
    updateMessage.textContent = '檢查中...';
    updateButton.disabled = true;
    try {
      const r = await window.api.checkAppUpdate();
      if (r && r.manual) {
        if (r.available === false) updateMessage.textContent = '目前已是最新版本';
        else await openManualUpdate(r);
        return;
      }
      if (!r || !r.ok) { updateMessage.textContent = (r && r.error) || '檢查失敗'; return; }
      if (!r.available) { updateMessage.textContent = '目前已是最新版本'; return; }
      updateMessage.textContent = '發現新版本 ' + r.version + '，下載中...';
      updateProgress.classList.remove('hidden');
      const d = await window.api.downloadAppUpdate();
      if (d && d.manual) { await openManualUpdate(d); return; }
      if (!d || !d.ok) {
        updateProgress.classList.add('hidden');
        updateMessage.textContent = '下載失敗：' + ((d && d.error) || '未知錯誤');
      }
    } catch (e) {
      updateProgress.classList.add('hidden');
      updateMessage.textContent = '更新失敗：' + e.message;
    } finally {
      updateButton.disabled = false;
    }
  });

  installButton.addEventListener('click', () => window.api.quitAndInstall());

  window.api.onUpdateAvailable((d) => {
    toast('發現新版本 ' + d.version, 4000);
    updateMessage.textContent = '發現新版本 ' + d.version;
  });
  window.api.onUpdateProgress((d) => {
    updateProgress.classList.remove('hidden');
    updatePercent.textContent = Math.round(d.percent || 0);
  });
  window.api.onUpdateDownloaded((d) => {
    updateProgress.classList.add('hidden');
    updateMessage.textContent = '版本 ' + d.version + ' 已下載完成';
    installButton.classList.remove('hidden');
    toast('更新已下載完成，可以重新啟動安裝', 5000);
  });
  window.api.onUpdateError((d) => { updateMessage.textContent = '更新錯誤：' + d.error; });
  window.api.onUpdateNone(() => { updateMessage.textContent = '目前已是最新版本'; });

  const isWin = window.api.platform === 'win32';
  let newVersionUrl = '';
  let newVersion = '';
  let winUpdating = false;
  window.api.onNewVersion(({ version, url }) => {
    if (version && version === cfg.skippedVersion) return;
    newVersion = version || '';
    newVersionUrl = url;
    bannerText.textContent = '新版本 v' + version + ' 可下載';
    bannerDownload.textContent = isWin ? '下載更新' : '前往下載';
    banner.classList.remove('hidden');
  });
  bannerDownload.addEventListener('click', async () => {
    if (isWin) {
      winUpdating = true;
      bannerDownload.disabled = true;
      bannerText.textContent = '下載更新中 0%';
      const r = await window.api.downloadAppUpdate();
      if (r && r.manual) {
        winUpdating = false;
        bannerDownload.disabled = false;
        await openManualUpdate(r);
      } else if (!r || !r.ok) {
        winUpdating = false;
        bannerDownload.disabled = false;
        bannerText.textContent = '下載失敗，請稍後再試';
      }
    } else if (newVersionUrl) {
      window.api.openExternal(newVersionUrl);
    }
  });
  bannerDismiss.addEventListener('click', () => {
    if (newVersion) {
      cfg.skippedVersion = newVersion;
      window.api.setConfig(cfg);
    }
    banner.classList.add('hidden');
  });
  window.api.onUpdateProgress((d) => {
    if (winUpdating) bannerText.textContent = '下載更新中 ' + Math.round(d.percent || 0) + '%';
  });
  window.api.onUpdateDownloaded(() => {
    if (winUpdating) {
      bannerText.textContent = '下載完成，準備重新啟動...';
      setTimeout(() => window.api.quitAndInstall(), 900);
    }
  });
}

// ---------- 媒體快取 ----------
function fmtBytes(b) {
  if (!b) return '0 MB';
  const mb = b / 1048576;
  return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(0) + ' MB';
}
async function refreshCacheSize() {
  const b = await window.api.cacheSize();
  $('cacheSize').textContent = fmtBytes(b);
}
function setupCache() {
  refreshCacheSize();
  $('btnCleanCache').addEventListener('click', async () => {
    $('cacheMsg').textContent = '清理中...';
    const r = await window.api.cleanCache(0); // 0 表示清除所有未使用的快取。
    $('cacheMsg').textContent = `已移除 ${r.removed} 個檔案，釋放 ${fmtBytes(r.freed)}`;
    refreshCacheSize();
  });
}

function setupCustomWorshipList() {
  const list = $('customWorshipList');
  if (!list) return;
  let dragIndex = -1;

  list.addEventListener('dragstart', (e) => {
    if (e.target.closest('input, button')) {
      e.preventDefault();
      dragIndex = -1;
      return;
    }
    const row = e.target.closest('.custom-worship-item');
    if (!row) return;
    dragIndex = Number(row.dataset.index);
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.index);
  });

  list.addEventListener('dragend', (e) => {
    const row = e.target.closest('.custom-worship-item');
    if (row) row.classList.remove('dragging');
    dragIndex = -1;
  });

  list.addEventListener('dragover', (e) => {
    if (dragIndex < 0) return;
    e.preventDefault();
    const row = e.target.closest('.custom-worship-item');
    list.querySelectorAll('.custom-worship-item.over').forEach((item) => item.classList.remove('over'));
    if (row) row.classList.add('over');
  });

  list.addEventListener('dragleave', (e) => {
    const row = e.target.closest('.custom-worship-item');
    if (row) row.classList.remove('over');
  });

  list.addEventListener('drop', async (e) => {
    if (dragIndex < 0) return;
    e.preventDefault();
    const row = e.target.closest('.custom-worship-item');
    list.querySelectorAll('.custom-worship-item.over').forEach((item) => item.classList.remove('over'));
    if (!row) return;
    await saveCustomWorshipOrder(dragIndex, Number(row.dataset.index));
  });

  list.addEventListener('click', async (e) => {
    const deleteButton = e.target.closest('.custom-delete-btn');
    if (!deleteButton) return;
    const row = deleteButton.closest('.custom-worship-item');
    if (!row) return;
    await deleteCustomWorshipPreset(Number(row.dataset.index));
  });

  list.addEventListener('change', async (e) => {
    const input = e.target.closest('.custom-worship-title-input');
    if (!input) return;
    const row = input.closest('.custom-worship-item');
    if (!row) return;
    await renameCustomWorshipPreset(Number(row.dataset.index), input.value, input);
  });
}

// ---------- 初始化 ----------
async function init() {
  // 依平台套用原生風格字型與外觀。
  document.body.classList.add(window.api.platform === 'darwin' ? 'plat-mac' : 'plat-win');
  updateFlowDisplayScale();
  const { cfg: loaded, backgroundUrl } = await window.api.getConfig();
  cfg = loaded;
  cfg.fillMode = 'blur';
  const scriptureConfigChanged = normalizeScriptureConfig();
  applyCover(backgroundUrl);
  if (scriptureConfigChanged) {
    try { await window.api.setConfig(cfg); }
    catch (e) { console.warn('無法儲存校正後的經文範圍：', e); }
  }

  // 主工具列。
  $('btnSettings').addEventListener('click', () => {
    const hidden = $('settingsPanel').classList.contains('hidden');
    if (hidden) openSettings(); else closeSettings();
  });
  $('btnCloseSettings').addEventListener('click', closeSettings);
  $('btnMusic').addEventListener('click', toggleMusic);
  $('btnWorship').addEventListener('click', startWorship);
  $('btnBack').addEventListener('click', backToCover);
  $('btnFlowNext').addEventListener('click', nextFlowStep);
  $('flowPrevPage').addEventListener('click', (e) => { e.stopPropagation(); prevFlowPageOrStep(); });
  $('flowNextPage').addEventListener('click', (e) => { e.stopPropagation(); nextFlowPageOrStep('button'); });
  $('flowHomeButton').addEventListener('click', (e) => { e.stopPropagation(); requestFlowReturnToCover('home'); });
  $('flowScreen').addEventListener('click', () => {
    if (flowStep === 'end') returnToMainCover();
  });
  setupFlowFooterReveal();
  setupSettingsTextSelection();
  window.api.onWindowPointerActivity(handleReadingPointerActivity);
  $('btnMin').addEventListener('click', () => window.api.minimizeWindow());
  $('btnClose').addEventListener('click', () => window.api.closeWindow());
  $('btnPasteMusic').addEventListener('click', () => pasteInto('inMusicUrl'));
  $('btnPasteWorship').addEventListener('click', () => pasteInto('inWorshipUrl'));
  $('btnPasteCustomWorship').addEventListener('click', () => pasteInto('inCustomWorshipUrl'));
  $('btnAddWorshipPreset').addEventListener('click', addCustomWorshipPreset);
  $('inCustomWorshipUrl').addEventListener('input', () => {
    customWorshipTitleRequestToken++;
    prepareWorshipTitleDraft($('inCustomWorshipTitle'), $('inCustomWorshipUrl').value);
  });
  $('inCustomWorshipTitle').addEventListener('input', () => {
    const url = normalizeCustomWorshipUrl($('inCustomWorshipUrl').value);
    if (url) $('inCustomWorshipTitle').dataset.url = url;
  });
  $('inCustomWorshipUrl').addEventListener('change', () => { prefillCustomWorshipTitle(); });
  $('inWorshipUrl').addEventListener('input', () => {
    manualWorshipTitleRequestToken++;
    prepareWorshipTitleDraft($('inWorshipTitle'), $('inWorshipUrl').value);
  });
  $('inWorshipUrl').addEventListener('change', () => {
    prepareWorshipTitleDraft($('inWorshipTitle'), $('inWorshipUrl').value);
  });
  $('btnScheduleNow').addEventListener('click', async () => {
    const ok = await refreshDailyReadingData();
    toast(ok ? '經文與竭誠獻上已更新' : '更新失敗，請稍後再試', ok ? 2600 : 3600);
  });
  $('btnZoom').addEventListener('click', () => {
    const launchUrl = zoomLaunchUrl(cfg.zoomUrl);
    if (launchUrl) {
      window.api.openHostConsole();
      window.api.openExternal(launchUrl);
    }
    else { toast('請設定有效的 Zoom 連結'); openSettings(); }
  });
  $('btnHost').addEventListener('click', () => window.api.openHostConsole());
  $('btnPickImage').addEventListener('click', async () => {
    const p = await window.api.pickImage();
    if (p) useImagePath(p);
  });

  ['dateAuto','dateDay','inReading','inMusicUrl','inWorshipUrl','inWorshipTitle','inCustomWorshipUrl','musicVolume','autoPlayMusic','preventLeftArrowWorship',
   'useWorshipPreset','worshipPreset','cacheKeepDays','scheduleEnabled','inScheduleUrl']
    .forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', onSettingsChanged);
      el.addEventListener('change', onSettingsChanged);
    });
  $('dateMonth').addEventListener('change', () => {
    syncDateDayOptions(+$('dateDay').value);
    onSettingsChanged();
  });

  // 切換常用敬拜影片與手動網址時，同步設定並預先下載。
  $('useWorshipPreset').addEventListener('change', async () => {
    applyWorshipMode();
    collectSettings();
    if (cfg.worshipUrl) prefetch('video');
    await ensureCurrentWorshipAnnouncementTitle(false);
  });
  // 更換常用影片後，預先準備新選項。
  $('worshipPreset').addEventListener('change', async () => {
    collectSettings();
    if (cfg.useWorshipPreset && cfg.worshipUrl) prefetch('video');
    await ensureCurrentWorshipAnnouncementTitle(false);
  });

  // 網址輸入完成後更新媒體來源。
  $('inMusicUrl').addEventListener('change', () => { collectSettings(); if (cfg.musicUrl) resolveAndPlayMusic(); });
  $('inWorshipUrl').addEventListener('change', async () => {
    collectSettings();
    prefetch('video');
    await prefillManualWorshipTitle();
  });

  // 媒體下載進度。
  window.api.onMediaProgress(({ kind, percent }) => {
    const label = kind === 'video' ? '敬拜影片' : '背景音樂';
    const txt = `${label}下載中 ${percent.toFixed(0)}%`;
    showBadge(txt);
    if (kind === 'video' && !$('worshipLayer').classList.contains('hidden'))
      $('worshipLoading').textContent = `敬拜影片載入中 ${percent.toFixed(0)}%`;
    if (percent >= 100) setTimeout(hideBadge, 800);
  });

  setupDragDrop();
  setupWorshipControls();
  setupAppUpdater();
  setupCache();
  setupCustomWorshipList();

  // 經文範圍選單。
  fillBookSelect();
  $('bkBook').addEventListener('change', () => onScriptureChange('book'));
  $('bkStartCh').addEventListener('change', () => onScriptureChange('startCh'));
  $('bkStartV').addEventListener('change', () => onScriptureChange('startV'));
  $('bkEndCh').addEventListener('change', () => onScriptureChange('endCh'));
  $('bkEndV').addEventListener('change', () => onScriptureChange('endV'));

  // 只有從設定面板外開始、也在外面結束的完整點擊才關閉面板。
  // 從輸入框拖曳選取文字後在面板外放開，不應被誤判成外部點擊。
  document.addEventListener('pointerdown', (e) => {
    settingsPointerStartedOutside = isSettingsOutsideTarget(e.target);
  }, true);
  document.addEventListener('click', (e) => {
    const shouldClose = shouldDismissSettingsFromPointer(settingsPointerStartedOutside, e.target);
    settingsPointerStartedOutside = false;
    if (shouldClose) closeSettings();
  });

  // 滑鼠、滾輪與 Escape 鍵導覽。
  window.addEventListener('mousemove', handleToolbarPointerMove);
  window.addEventListener('resize', updateFlowDisplayScale);
  window.addEventListener('wheel', handleFlowWheelNavigation, { passive: false });
  window.addEventListener('keydown', handleFlowArrowNavigation);
  window.addEventListener('keydown', handleEscapeNavigation);

  // 空白鍵切換目前可見媒體的播放狀態。
  window.addEventListener('keydown', (e) => {
    if (flowStep === 'end') return;
    if (e.code !== 'Space') return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!$('settingsPanel').classList.contains('hidden')) return;
    e.preventDefault();
    if (worshipActive) {
      const v = $('worshipVideo');
      if (v.paused) {
        v.play().catch((error) => {
          $('worshipLoading').textContent = '播放失敗，請稍後再試';
          $('worshipLoading').classList.remove('hidden');
          toast('影片播放失敗：' + error.message, 3200);
        });
      } else v.pause();
    } else {
      toggleMusicPlayPause();
    }
  });
  showToolbar();

  // 自動日期每分鐘校正一次。
  setInterval(() => { if (cfg.dateAuto) $('dateText').textContent = systemDateMD(); }, 60000);

  // 啟動後準備背景音樂，並延後預抓敬拜影片以減少啟動負載。
  if (cfg.autoPlayMusic && cfg.musicUrl) resolveAndPlayMusic();
  else prefetch('audio');
  setTimeout(() => prefetch('video'), 8000);

  // 啟動後更新一次每日內容，之後每天上午八點再更新。
  setTimeout(() => refreshDailyReadingData().catch(() => {}), 1500);
  scheduleDailyReadingRefresh();

  // 公告複製。
  $('btnAnnounce').addEventListener('click', copyAnnounce);
}

window.addEventListener('DOMContentLoaded', init);
