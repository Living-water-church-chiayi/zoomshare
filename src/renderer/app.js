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

// ---------- 套用封面 ----------
function applyCover(backgroundUrl) {
  $('dateText').textContent = cfg.dateAuto ? systemDateMD() : (cfg.dateManual || systemDateMD());
  $('title1').textContent = cfg.title1 || '';
  $('title2').textContent = cfg.title2 || '';
  $('title3').textContent = cfg.title3 || '';
  $('scriptureLabel').textContent = cfg.scriptureLabel || '';

  const rl = $('readingLines');
  rl.innerHTML = '';
  (cfg.readingLines || []).forEach((line) => {
    if (!line) return;
    const div = document.createElement('div');
    div.textContent = line;
    rl.appendChild(div);
  });

  if (backgroundUrl) setBackground(backgroundUrl);
  applyFillMode();
  applyFont();
}

const FONT_MAP = {
  'kai': 'var(--kai)',
  'sans-regular': "'SHSans-Regular', sans-serif",
  'sans-medium': "'SHSans-Medium', sans-serif",
  'sans-bold': "'SHSans-Bold', sans-serif",
  'sans-heavy': "'SHSans-Heavy', sans-serif",
  'serif-regular': "'SHSerif-Regular', serif",
  'serif-medium': "'SHSerif-Medium', serif",
  'serif-bold': "'SHSerif-Bold', serif",
  'serif-heavy': "'SHSerif-Heavy', serif"
};
function applyFont() {
  const f = FONT_MAP[cfg.fontFamily] || FONT_MAP.kai;
  document.documentElement.style.setProperty('--cover-font', f);
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

// ---------- 設定面板 ----------
function fillSettings() {
  $('fontFamily').value = cfg.fontFamily || 'kai';
  $('fillMode').value = cfg.fillMode;
  $('dateAuto').checked = !!cfg.dateAuto;
  $('dateManual').value = cfg.dateManual || '';
  $('inTitle1').value = cfg.title1 || '';
  $('inTitle2').value = cfg.title2 || '';
  $('inTitle3').value = cfg.title3 || '';
  $('inScriptureLabel').value = cfg.scriptureLabel || '';
  $('inReading').value = (cfg.readingLines || []).join('\n');
  $('inMusicUrl').value = cfg.musicUrl || '';
  $('inWorshipUrl').value = cfg.worshipUrl || '';
  $('musicVolume').value = cfg.musicVolume;
  $('autoPlayMusic').checked = !!cfg.autoPlayMusic;
}

function collectSettings() {
  cfg.fontFamily = $('fontFamily').value;
  cfg.fillMode = $('fillMode').value;
  cfg.dateAuto = $('dateAuto').checked;
  cfg.dateManual = $('dateManual').value.trim();
  cfg.title1 = $('inTitle1').value;
  cfg.title2 = $('inTitle2').value;
  cfg.title3 = $('inTitle3').value;
  cfg.scriptureLabel = $('inScriptureLabel').value;
  cfg.readingLines = $('inReading').value.split('\n').map((s) => s.trim()).filter(Boolean);
  cfg.musicUrl = $('inMusicUrl').value.trim();
  cfg.worshipUrl = $('inWorshipUrl').value.trim();
  cfg.musicVolume = parseFloat($('musicVolume').value);
  cfg.autoPlayMusic = $('autoPlayMusic').checked;
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
  const url = kind === 'video' ? cfg.worshipUrl : cfg.musicUrl;
  if (!url) return;
  const s = await window.api.mediaStatus(url, kind);
  if (s.cached) return;
  showBadge((kind === 'video' ? '敬拜影片' : '背景音樂') + ' 準備中…');
  const r = await window.api.ensureMedia(url, kind, cfg.videoQuality);
  hideBadge();
  if (!r.ok) toast((kind === 'video' ? '敬拜影片' : '背景音樂') + '下載失敗：' + r.error, 4000);
}

// ---------- 背景音樂 ----------
async function resolveAndPlayMusic() {
  if (!cfg.musicUrl) { toast('請先在設定貼上背景音樂 YouTube 連結'); openSettings(); return; }
  showBadge('背景音樂 準備中…');
  const r = await window.api.ensureMedia(cfg.musicUrl, 'audio');
  hideBadge();
  if (!r.ok) { toast('背景音樂下載失敗：' + r.error, 4000); return; }
  const a = $('bgAudio');
  a.src = r.path;
  a.volume = cfg.musicVolume;
  try { await a.play(); } catch (e) { toast('播放失敗：' + e.message, 3000); return; }
  musicPlaying = true;
  $('btnMusic').classList.add('active');
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
  if (!r.ok) { toast('敬拜影片載入失敗：' + r.error, 4000); backToCover(); return; }
  video.src = r.path;
  video.volume = 1;
  try { await video.play(); } catch (e) { /* 等待使用者互動 */ }
  $('worshipLoading').classList.add('hidden');
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
  if (musicResumeAfterWorship) resolveAndPlayMusic();
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
  seek.addEventListener('input', () => {
    if (v.duration) v.currentTime = (parseFloat(seek.value) / 1000) * v.duration;
  });
  $('wPlay').addEventListener('click', () => { if (v.paused) v.play(); else v.pause(); });
  $('wReturn').addEventListener('click', backToCover);
}

// ---------- 設定開關 ----------
function openSettings() {
  fillSettings();
  $('settingsPanel').classList.remove('hidden');
  $('toolbar').classList.add('show');
  refreshYtDlpVersion();
}
function closeSettings() {
  $('settingsPanel').classList.add('hidden');
}

async function refreshYtDlpVersion() {
  const v = await window.api.ytDlpVersion();
  $('ytdlpVer').textContent = v || '未安裝（請確認 yt-dlp）';
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
  ['fontFamily','fillMode','dateAuto','dateManual','inTitle1','inTitle2','inTitle3',
   'inScriptureLabel','inReading','inMusicUrl','inWorshipUrl','musicVolume','autoPlayMusic']
    .forEach((id) => {
      const el = $(id);
      el.addEventListener('input', onSettingsChanged);
      el.addEventListener('change', onSettingsChanged);
    });

  // URL 變更時在背景預先下載快取
  $('inMusicUrl').addEventListener('change', () => { collectSettings(); prefetch('audio'); });
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

  // 自動隱藏工具條
  window.addEventListener('mousemove', showToolbar);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('settingsPanel').classList.contains('hidden')) closeSettings(); });
  showToolbar();

  // 每分鐘更新日期（跨午夜自動換日）
  setInterval(() => { if (cfg.dateAuto) $('dateText').textContent = systemDateMD(); }, 60000);

  // 啟動時：背景預先下載敬拜影片；自動播放背景音樂
  prefetch('video');
  if (cfg.autoPlayMusic && cfg.musicUrl) resolveAndPlayMusic();
  else prefetch('audio');
}

window.addEventListener('DOMContentLoaded', init);
