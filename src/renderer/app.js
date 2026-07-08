'use strict';

const $ = (id) => document.getElementById(id);

let cfg = null;
let musicPlaying = false;
let musicResumeAfterWorship = false;
let worshipActive = false;

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

// 把 zoom 會議網頁連結轉成 zoommtg:// 直接開 Zoom App 加入（免瀏覽器、免「開啟 Zoom？」提示）
function zoomLaunchUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase().endsWith('zoom.us')) {
      const m = u.pathname.match(/\/j\/(\d+)/);
      if (m) {
        let z = `zoommtg://${u.hostname}/join?action=join&confno=${m[1]}`;
        const pwd = u.searchParams.get('pwd');
        if (pwd) z += `&pwd=${pwd}`;
        return z;
      }
    }
  } catch (e) { /* 非標準連結，退回原網址 */ }
  return url;
}

// ---------- 套用封面 ----------
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

  if (backgroundUrl) setBackground(backgroundUrl);
  applyFillMode();
}

function setBackground(url) {
  $('bgImage').style.backgroundImage = `url("${url}")`;
  $('bgBlur').style.backgroundImage = `url("${url}")`;
}

function applyFillMode() {
  const blur = $('bgBlur');
  if (cfg.fillMode === 'black') blur.classList.add('black');
  else blur.classList.remove('black');
}

// ---------- 本日經文（聖經下拉） ----------
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

// 依「開始」重建「結束」下拉：只列出 ≥ 開始 的章/節（更早的直接隱藏）
function syncEndOptions(desiredEndCh, desiredEndV) {
  const bk = bookByName($('bkBook').value);
  const sc = +$('bkStartCh').value, sv = +$('bkStartV').value;
  const nCh = bk.v.length;
  let ec = clampNum(desiredEndCh, sc, nCh);          // 結束章 ≥ 開始章
  fillNumberSelect($('bkEndCh'), nCh, ec, sc);
  ec = +$('bkEndCh').value;
  const vMin = (ec === sc) ? sv : 1;                 // 同章時，結束節 ≥ 開始節
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
  const book = '《' + (cfg.scriptureBook || '') + '》';
  const sc = cfg.scriptureStartCh, sv = cfg.scriptureStartV, ec = cfg.scriptureEndCh, ev = cfg.scriptureEndV;
  if (sc === ec) return sv === ev ? `${book}${sc}:${sv}` : `${book}${sc}:${sv}-${ev}`;
  return `${book}${sc}:${sv}-${ec}:${ev}`;
}
function updateRefPreview() { const el = $('refPreview'); if (el) el.textContent = formatRef(); }

// 依 cfg 目前值填入四個下拉
function fillScriptureControls() {
  const bk = bookByName(cfg.scriptureBook);
  cfg.scriptureBook = bk.n;
  $('bkBook').value = bk.n;
  const nCh = bk.v.length;
  const sc = clampNum(cfg.scriptureStartCh, 1, nCh);
  fillNumberSelect($('bkStartCh'), nCh, sc);
  fillNumberSelect($('bkStartV'), bk.v[sc - 1], clampNum(cfg.scriptureStartV, 1, bk.v[sc - 1]));
  // 結束下拉：只列 ≥ 開始（必要時自動上移），並寫回 cfg
  syncEndOptions(cfg.scriptureEndCh, cfg.scriptureEndV);
  cfg.scriptureEndCh = +$('bkEndCh').value;
  cfg.scriptureEndV = +$('bkEndV').value;
  updateRefPreview();
}

// 使用者變更下拉時：級聯更新「節」的範圍，並存檔
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
    syncEndOptions(+$('bkEndCh').value, +$('bkEndV').value); // 開始章變→結束重算（必要時上移）
  } else if (which === 'startV') {
    syncEndOptions(+$('bkEndCh').value, +$('bkEndV').value); // 開始節變→同章結束節重算
  } else if (which === 'endCh') {
    syncEndOptions(+$('bkEndCh').value, +$('bkEndV').value); // 結束章變→結束節下限重算
  }
  cfg.scriptureStartCh = +$('bkStartCh').value;
  cfg.scriptureStartV = +$('bkStartV').value;
  cfg.scriptureEndCh = +$('bkEndCh').value;
  cfg.scriptureEndV = +$('bkEndV').value;
  updateRefPreview();
  applyCover(null);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.api.setConfig(cfg), 300);
}

// ---------- 設定面板 ----------
function fillSettings() {
  $('fillMode').value = cfg.fillMode;
  $('dateAuto').checked = !!cfg.dateAuto;
  $('dateManual').value = cfg.dateManual || '';
  $('inTitle1').value = cfg.title1 || '';
  $('inTitle2').value = cfg.title2 || '';
  $('inTitle3').value = cfg.title3 || '';
  $('inScriptureLabel').value = cfg.scriptureLabel || '';
  $('inReading').value = cfg.readingExtra || '';
  fillScriptureControls();
  $('inMusicUrl').value = cfg.musicUrl || '';
  $('inWorshipUrl').value = cfg.worshipUrl || '';
  $('worshipPreset').value = cfg.worshipPreset || '';
  $('useWorshipPreset').checked = !!cfg.useWorshipPreset;
  applyWorshipMode();
  $('inZoomUrl').value = cfg.zoomUrl || '';
  $('musicVolume').value = cfg.musicVolume;
  $('autoPlayMusic').checked = !!cfg.autoPlayMusic;
  $('cacheKeepDays').value = String(cfg.cacheKeepDays != null ? cfg.cacheKeepDays : 30);
}

function collectSettings() {
  cfg.fillMode = $('fillMode').value;
  cfg.dateAuto = $('dateAuto').checked;
  cfg.dateManual = $('dateManual').value.trim();
  cfg.title1 = $('inTitle1').value;
  cfg.title2 = $('inTitle2').value;
  cfg.title3 = $('inTitle3').value;
  cfg.scriptureLabel = $('inScriptureLabel').value;
  cfg.readingExtra = $('inReading').value;
  cfg.musicUrl = $('inMusicUrl').value.trim();
  cfg.useWorshipPreset = $('useWorshipPreset').checked;
  cfg.worshipPreset = $('worshipPreset').value;
  // 敬拜音樂來源：勾選歌單→用下拉選的；否則→用自己貼的連結
  cfg.worshipUrl = cfg.useWorshipPreset ? cfg.worshipPreset : $('inWorshipUrl').value.trim();
  cfg.zoomUrl = $('inZoomUrl').value.trim();
  cfg.musicVolume = parseFloat($('musicVolume').value);
  cfg.autoPlayMusic = $('autoPlayMusic').checked;
  cfg.cacheKeepDays = parseInt($('cacheKeepDays').value, 10);
}

// 依「使用常用敬拜音樂歌單」勾選，切換顯示下拉選單或貼連結欄
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
    toast('剪貼簿沒有文字');
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

// ---------- 下載進度徽章 ----------
function showBadge(text) { const b = $('dlBadge'); b.textContent = text; b.classList.remove('hidden'); }
function hideBadge() { $('dlBadge').classList.add('hidden'); }

// 預先下載快取（設定連結後在背景準備，點擊時即可秒播）
async function prefetch(kind) {
  const label = kind === 'video' ? '敬拜影片' : '背景音樂';
  const url = kind === 'video' ? cfg.worshipUrl : cfg.musicUrl;
  if (!url) return;
  const s = await window.api.mediaStatus(url, kind);
  if (s.cached) return;
  showBadge(label + ' 準備中…');
  const r = await window.api.ensureMedia(url, kind, cfg.videoQuality);
  hideBadge();
  if (!r.ok) { toast(label + '下載失敗：' + r.error, 4000); return; }
  toast('✓ ' + label + ' 已下載完成', 3000); // 下載完成通知，停留 3 秒
}

// ---------- 背景音樂 ----------
async function resolveAndPlayMusic() {
  if (!cfg.musicUrl) { toast('請先在設定貼上背景音樂 YouTube 連結'); openSettings(); return; }
  const a = $('bgAudio');
  const st = await window.api.mediaStatus(cfg.musicUrl, 'audio');
  const needDownload = !st.cached;
  showBadge('背景音樂 準備中…');
  const r = await window.api.ensureMedia(cfg.musicUrl, 'audio');
  hideBadge();
  if (!r.ok) { toast('背景音樂下載失敗：' + r.error, 4000); return; }
  // 只有在音源不同（換歌或首次）時才重設 src；同一首則保留播放進度續播
  if (a.src !== r.path) a.src = r.path;
  a.volume = cfg.musicVolume;
  try { await a.play(); } catch (e) { toast('播放失敗：' + e.message, 3000); return; }
  musicPlaying = true;
  $('btnMusic').classList.add('active');
  if (needDownload) toast('✓ 背景音樂已下載完成，開始播放', 3000); // 下載完成通知，停留 3 秒
}

function fadeOutMusic(done) {
  const a = $('bgAudio');
  const start = a.volume;
  let v = start;
  const step = setInterval(() => {
    v -= start / 12;
    if (v <= 0) {
      clearInterval(step);
      a.pause();
      a.volume = cfg.musicVolume;
      musicPlaying = false;
      $('btnMusic').classList.remove('active');
      if (done) done();
    } else {
      a.volume = Math.max(0, v);
    }
  }, 40);
}

function toggleMusic() {
  if (musicPlaying) fadeOutMusic();
  else resolveAndPlayMusic();
}

// 空白鍵用：單純暫停/繼續（不淡出、不重新下載）
function toggleMusicPlayPause() {
  const a = $('bgAudio');
  if (!a.src) { resolveAndPlayMusic(); return; } // 尚未載入 → 載入並播放
  if (a.paused) { a.play(); musicPlaying = true; $('btnMusic').classList.add('active'); }
  else { a.pause(); musicPlaying = false; $('btnMusic').classList.remove('active'); }
}

// ---------- 敬拜影片 ----------
async function startWorship() {
  if (!cfg.worshipUrl) { toast('請先在設定貼上敬拜 YouTube 連結'); openSettings(); return; }
  const layer = $('worshipLayer');
  const video = $('worshipVideo');
  worshipActive = true;
  $('toolbar').classList.remove('show'); // 敬拜時改用影片控制條
  $('wSeek').value = '0';
  $('wCur').textContent = '0:00';
  layer.classList.remove('hidden');
  $('worshipLoading').classList.remove('hidden');
  $('btnWorship').classList.add('hidden');
  $('btnBack').classList.remove('hidden');
  showToolbar();

  musicResumeAfterWorship = musicPlaying;
  if (musicPlaying) fadeOutMusic();

  const r = await window.api.ensureMedia(cfg.worshipUrl, 'video', cfg.videoQuality);
  if (!worshipActive) return;                 // 下載期間若已返回封面則不繼續
  if (!r.ok) { toast('敬拜影片載入失敗：' + r.error, 4000); backToCover(); return; }
  playWorshipVideo(r.path, false);
}

// 播放敬拜影片：設來源後「明確 load()」再 play；若被拒自動重試一次（修正閒置久後首次黑屏）
function playWorshipVideo(src, retried) {
  const video = $('worshipVideo');
  video.pause();
  video.src = src;
  video.load();
  video.volume = 1;
  video.play().then(() => {
    $('worshipLoading').classList.add('hidden');
  }).catch(() => {
    if (!retried && worshipActive) setTimeout(() => playWorshipVideo(src, true), 300);
  });
}

function backToCover() {
  const video = $('worshipVideo');
  video.pause();
  video.removeAttribute('src');
  video.load();
  worshipActive = false;
  $('worshipControls').classList.remove('show');
  $('worshipLayer').classList.add('hidden');
  $('worshipLoading').classList.add('hidden');
  $('btnBack').classList.add('hidden');
  $('btnWorship').classList.remove('hidden');
  showToolbar(); // 返回封面後立即顯示工具列
  // 返回封面（含敬拜播畢自動返回、中途手動返回）一律自動開啟背景音樂
  if (cfg.musicUrl && !musicPlaying) resolveAndPlayMusic();
}

// ---------- 背景圖：拖放與選取 ----------
async function useImagePath(srcPath) {
  if (!srcPath) return;
  const r = await window.api.saveBackground(srcPath);
  if (r && r.url) { setBackground(r.url); cfg.backgroundFile = r.fileName; toast('背景已更新'); }
}

function setupDragDrop() {
  const canvas = $('canvas');
  window.addEventListener('dragover', (e) => { e.preventDefault(); canvas.classList.add('dragging'); });
  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) canvas.classList.remove('dragging');
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    canvas.classList.remove('dragging');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('請拖入圖片檔'); return; }
    const p = window.api.pathForFile(file);
    if (p) useImagePath(p);
    else toast('無法讀取檔案路徑');
  });
}

// ---------- 工具條自動隱藏（敬拜時顯示影片控制條） ----------
let hideTimer = null;
function showToolbar() {
  const bar = worshipActive ? $('worshipControls') : $('toolbar');
  bar.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!$('settingsPanel').classList.contains('hidden')) return;
    $('toolbar').classList.remove('show');
    $('worshipControls').classList.remove('show');
  }, 2200);
}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  s = Math.floor(s);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function setupWorshipControls() {
  const v = $('worshipVideo');
  const seek = $('wSeek');
  v.addEventListener('loadedmetadata', () => { $('wDur').textContent = fmtTime(v.duration); });
  v.addEventListener('timeupdate', () => {
    if (v.duration) seek.value = String((v.currentTime / v.duration) * 1000);
    $('wCur').textContent = fmtTime(v.currentTime);
  });
  v.addEventListener('play', () => { $('wPlay').textContent = '⏸'; });
  v.addEventListener('pause', () => { $('wPlay').textContent = '▶'; });
  v.addEventListener('ended', backToCover); // 影片播畢自動返回封面
  seek.addEventListener('input', () => {
    if (v.duration) v.currentTime = (parseFloat(seek.value) / 1000) * v.duration;
  });
  $('wPlay').addEventListener('click', () => { if (v.paused) v.play(); else v.pause(); });
  $('wReturn').addEventListener('click', backToCover);
  $('wMin').addEventListener('click', () => window.api.minimizeWindow());
  $('wClose').addEventListener('click', () => window.api.closeWindow());
}

// ---------- 設定開關 ----------
function openSettings() {
  fillSettings();
  $('settingsPanel').classList.remove('hidden');
  $('settingsBackdrop').classList.remove('hidden');
  $('toolbar').classList.add('show');
  refreshYtDlpVersion();
}
function closeSettings() {
  $('settingsPanel').classList.add('hidden');
  $('settingsBackdrop').classList.add('hidden');
}

async function refreshYtDlpVersion() {
  const v = await window.api.ytDlpVersion();
  $('ytdlpVer').textContent = v || '未安裝（請確認 yt-dlp）';
}

// ---------- App 自動更新 ----------
function setupAppUpdater() {
  // 顯示目前版本
  window.api.appVersion().then((v) => { $('appVer').textContent = v || '—'; });

  // 「檢查軟體更新」按鈕
  $('btnAppUpdate').addEventListener('click', async () => {
    $('appUpdateMsg').textContent = '檢查中…';
    $('btnAppUpdate').disabled = true;
    const r = await window.api.checkAppUpdate();
    $('btnAppUpdate').disabled = false;
    if (!r.ok) { $('appUpdateMsg').textContent = r.error || '檢查失敗'; return; }
    if (r.available) {
      $('appUpdateMsg').textContent = `發現新版本 ${r.version}，開始下載…`;
      $('appUpdateProgress').classList.remove('hidden');
      const d = await window.api.downloadAppUpdate();
      if (!d.ok) $('appUpdateMsg').textContent = '下載失敗：' + d.error;
    } else {
      $('appUpdateMsg').textContent = '已是最新版本';
    }
  });

  // 「重新啟動以安裝」按鈕
  $('btnAppInstall').addEventListener('click', () => window.api.quitAndInstall());

  // 主進程推來的更新事件
  window.api.onUpdateAvailable((d) => {
    toast(`發現新版本 ${d.version}，可到設定更新`, 4000);
    $('appUpdateMsg').textContent = `發現新版本 ${d.version}`;
  });
  window.api.onUpdateProgress((d) => {
    $('appUpdateProgress').classList.remove('hidden');
    $('appUpdatePct').textContent = Math.round(d.percent || 0);
  });
  window.api.onUpdateDownloaded((d) => {
    $('appUpdateProgress').classList.add('hidden');
    $('appUpdateMsg').textContent = `新版本 ${d.version} 已下載完成`;
    $('btnAppInstall').classList.remove('hidden');
    toast('更新已下載，按「重新啟動以安裝更新」即可完成', 5000);
  });
  window.api.onUpdateError((d) => { $('appUpdateMsg').textContent = '更新錯誤：' + d.error; });
  window.api.onUpdateNone(() => { $('appUpdateMsg').textContent = '已是最新版本'; });

  // 開機檢查到新版本 → 顯示頂端橫幅
  const isWin = window.api.platform === 'win32';
  let newVersionUrl = '';
  let winUpdating = false;
  window.api.onNewVersion(({ version, url }) => {
    newVersionUrl = url;
    $('updateBannerText').textContent = `🔔 有新版本 v${version} 可用`;
    $('btnUpdateDownload').textContent = isWin ? '立即更新' : '前往下載更新';
    $('updateBanner').classList.remove('hidden');
  });
  $('btnUpdateDownload').addEventListener('click', async () => {
    if (isWin) {
      // Windows：一鍵自動下載並安裝（不開瀏覽器）
      winUpdating = true;
      $('btnUpdateDownload').disabled = true;
      $('updateBannerText').textContent = '下載更新中… 0%';
      const r = await window.api.downloadAppUpdate();
      if (!r.ok) {
        winUpdating = false;
        $('btnUpdateDownload').disabled = false;
        $('updateBannerText').textContent = '更新失敗，請稍後再試';
      }
      // 下載完成由 onUpdateDownloaded 自動重啟安裝
    } else if (newVersionUrl) {
      // Mac：開啟下載頁，手動下載安裝包
      window.api.openExternal(newVersionUrl);
    }
  });
  $('btnUpdateDismiss').addEventListener('click', () => $('updateBanner').classList.add('hidden'));

  // Windows 橫幅自動更新的下載進度與完成後自動安裝
  window.api.onUpdateProgress((d) => {
    if (winUpdating) $('updateBannerText').textContent = `下載更新中… ${Math.round(d.percent || 0)}%`;
  });
  window.api.onUpdateDownloaded(() => {
    if (winUpdating) {
      $('updateBannerText').textContent = '更新完成，即將重新啟動…';
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
    $('cacheMsg').textContent = '清理中…';
    const r = await window.api.cleanCache(0); // 0 = 清全部（仍保留使用中的）
    $('cacheMsg').textContent = `已清理 ${r.removed} 個檔案，釋放 ${fmtBytes(r.freed)}`;
    refreshCacheSize();
  });
}

// ---------- 初始化 ----------
async function init() {
  const { cfg: loaded, backgroundUrl } = await window.api.getConfig();
  cfg = loaded;
  applyCover(backgroundUrl);

  // 工具條
  $('btnSettings').addEventListener('click', () => {
    const hidden = $('settingsPanel').classList.contains('hidden');
    if (hidden) openSettings(); else closeSettings();
  });
  $('btnCloseSettings').addEventListener('click', closeSettings);
  $('btnMusic').addEventListener('click', toggleMusic);
  $('btnWorship').addEventListener('click', startWorship);
  $('btnBack').addEventListener('click', backToCover);
  $('btnMin').addEventListener('click', () => window.api.minimizeWindow());
  $('btnClose').addEventListener('click', () => window.api.closeWindow());
  $('btnPasteMusic').addEventListener('click', () => pasteInto('inMusicUrl'));
  $('btnPasteWorship').addEventListener('click', () => pasteInto('inWorshipUrl'));
  $('btnPasteZoom').addEventListener('click', () => pasteInto('inZoomUrl'));
  $('btnZoom').addEventListener('click', () => {
    if (cfg.zoomUrl) window.api.openExternal(zoomLaunchUrl(cfg.zoomUrl));
    else { toast('請先在設定貼上 Zoom 會議連結'); openSettings(); }
  });
  $('btnPickImage').addEventListener('click', async () => {
    const p = await window.api.pickImage();
    if (p) useImagePath(p);
  });
  $('btnUpdate').addEventListener('click', async () => {
    $('updateMsg').textContent = '檢查中…';
    const r = await window.api.updateYtDlp();
    if (r.updated) $('updateMsg').textContent = `已更新至 ${r.to}`;
    else if (r.error) $('updateMsg').textContent = '更新失敗：' + r.error;
    else $('updateMsg').textContent = '已是最新版本 (' + (r.current || '?') + ')';
    refreshYtDlpVersion();
  });

  // 設定即時變更
  ['fillMode','dateAuto','dateManual','inTitle1','inTitle2','inTitle3',
   'inScriptureLabel','inReading','inMusicUrl','inWorshipUrl','inZoomUrl','musicVolume','autoPlayMusic',
   'useWorshipPreset','worshipPreset','cacheKeepDays']
    .forEach((id) => {
      const el = $(id);
      el.addEventListener('input', onSettingsChanged);
      el.addEventListener('change', onSettingsChanged);
    });

  // 勾選「使用常用敬拜音樂歌單」→ 切換顯示下拉/連結欄，並套用來源
  $('useWorshipPreset').addEventListener('change', () => {
    applyWorshipMode();
    collectSettings();
    if (cfg.worshipUrl) prefetch('video');
  });
  // 下拉選了常用敬拜音樂 → 立即套用並背景快取
  $('worshipPreset').addEventListener('change', () => {
    collectSettings();
    if (cfg.useWorshipPreset && cfg.worshipUrl) prefetch('video');
  });

  // URL 變更時在背景預先下載快取
  // 換背景音樂連結：下載新的並「自動播放新音樂」（取代舊的）
  $('inMusicUrl').addEventListener('change', () => { collectSettings(); if (cfg.musicUrl) resolveAndPlayMusic(); });
  $('inWorshipUrl').addEventListener('change', () => { collectSettings(); prefetch('video'); });

  // 下載進度
  window.api.onMediaProgress(({ kind, percent }) => {
    const label = kind === 'video' ? '敬拜影片' : '背景音樂';
    const txt = `${label} 下載中 ${percent.toFixed(0)}%`;
    showBadge(txt);
    if (kind === 'video' && !$('worshipLayer').classList.contains('hidden'))
      $('worshipLoading').textContent = `敬拜影片載入中… ${percent.toFixed(0)}%`;
    if (percent >= 100) setTimeout(hideBadge, 800);
  });

  setupDragDrop();
  setupWorshipControls();
  setupAppUpdater();
  setupCache();

  // 本日經文下拉
  fillBookSelect();
  $('bkBook').addEventListener('change', () => onScriptureChange('book'));
  $('bkStartCh').addEventListener('change', () => onScriptureChange('startCh'));
  $('bkStartV').addEventListener('change', () => onScriptureChange('startV'));
  $('bkEndCh').addEventListener('change', () => onScriptureChange('endCh'));
  $('bkEndV').addEventListener('change', () => onScriptureChange('endV'));

  // 點透明捕捉層（設定面板以外的空白處）→ 關閉設定
  $('settingsBackdrop').addEventListener('click', closeSettings);

  // 點其他按鈕（工具列等非拖動元件）→ 自動關閉設定
  document.addEventListener('click', (e) => {
    const panel = $('settingsPanel');
    if (panel.classList.contains('hidden')) return;
    if (panel.contains(e.target)) return;      // 點面板內部不關
    if (e.target.closest('#btnSettings')) return; // 齒輪自己負責切換
    closeSettings();
  });

  // 自動隱藏工具條
  window.addEventListener('mousemove', showToolbar);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('settingsPanel').classList.contains('hidden')) closeSettings(); });

  // 空白鍵：暫停/播放（敬拜播放中→控制敬拜影片；否則→控制背景音樂）
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;        // 編輯中不攔截
    if (!$('settingsPanel').classList.contains('hidden')) return;                 // 設定開啟時不攔截
    e.preventDefault();
    if (worshipActive) {
      const v = $('worshipVideo');
      if (v.paused) v.play(); else v.pause();
    } else {
      toggleMusicPlayPause();
    }
  });
  showToolbar();

  // 每分鐘更新日期（跨午夜自動換日）
  setInterval(() => { if (cfg.dateAuto) $('dateText').textContent = systemDateMD(); }, 60000);

  // 啟動時：背景預先下載敬拜影片；自動播放背景音樂
  prefetch('video');
  if (cfg.autoPlayMusic && cfg.musicUrl) resolveAndPlayMusic();
  else prefetch('audio');
}

window.addEventListener('DOMContentLoaded', init);
