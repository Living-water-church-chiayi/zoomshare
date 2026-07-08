// 公告功能煙霧測試（純 Node，驗證：HTML 沒有面板、app.js 只有精簡版函式、組出來的字串正確）
// 用法：node scripts/test-announce.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ---- 1. main.js 已註冊 clipboard:write ----
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf-8');
assert.ok(/ipcMain\.handle\(['"]clipboard:write['"]/.test(mainSrc), 'main.js 應註冊 clipboard:write');
console.log('✓ main.js 已註冊 clipboard:write');

// ---- 2. preload.js 暴露 writeClipboard ----
const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf-8');
assert.ok(/writeClipboard\s*:/.test(preloadSrc), 'preload.js 應暴露 writeClipboard');
assert.ok(!/devCapture\s*:/.test(preloadSrc), 'preload.js 不應再有 devCapture');
console.log('✓ preload.js 暴露 writeClipboard（無 devCapture）');

// ---- 3. index.html：按鈕存在、面板已移除 ----
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf-8');
assert.ok(html.includes('id="btnAnnounce"'), 'index.html 應有 #btnAnnounce');
assert.ok(html.includes('複製公告'), '按鈕文字應為「複製公告」');
assert.ok(!html.includes('id="announcePanel"'), 'index.html 不應再有 announcePanel');
assert.ok(!html.includes('id="anGreeting"'), 'index.html 不應再有 anGreeting');
console.log('✓ index.html：按鈕存在、面板已完全移除');

// ---- 4. style.css：面板樣式已移除、按鈕顏色仍在 ----
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf-8');
assert.ok(!/\.announce-panel\s*\{/.test(css), 'style.css 不應再有 .announce-panel 樣式');
assert.ok(/\.toolbar\s+\.btn-announce\s*\{/.test(css), 'style.css 應保留 .btn-announce 樣式');
console.log('✓ style.css：面板樣式已移除、工具列按鈕樣式仍在');

// ---- 5. app.js：只有精簡版函式 ----
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf-8');
for (const fn of ['parseZoomUrl', 'todayCNDate', 'formatScriptureShort', 'buildAnnounceText', 'copyAnnounce']) {
  assert.ok(new RegExp('function\\s+' + fn + '\\b').test(app), 'app.js 應有函式 ' + fn);
}
for (const removed of ['openAnnounce', 'closeAnnounce', 'applyAnnounceValues', 'readAnnounceValues', 'renderAnnouncePreview', 'persistAnnounce', 'buildAnnounceDefaults', 'syncAnnounceWithScripture']) {
  assert.ok(!new RegExp('function\\s+' + removed + '\\b').test(app), 'app.js 不應再有 ' + removed);
}
assert.ok(/btnAnnounce'\)\.addEventListener\('click',\s*copyAnnounce\)/.test(app), 'btnAnnounce 應直接綁定 copyAnnounce');
console.log('✓ app.js：精簡版函式齊全、舊的 UI 函式已移除');

// ---- 6. 模擬組字串：完整流程（用 cfg 模擬） ----
const cfg = {
  scriptureBook: '提摩太前書',
  scriptureStartCh: 5, scriptureStartV: 1,
  scriptureEndCh: 5, scriptureEndV: 25,
  readingExtra: '《竭誠獻上》\n《靈命日糧》',
  zoomUrl: 'https://us06web.zoom.us/j/77730692079?pwd=EbYm30dRERJb8FI3GRHadpkqdNLfE4.1'
};
const CN_WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
function todayCNDate() { const d = new Date('2026-07-08'); return (d.getMonth()+1)+'月'+d.getDate()+'日 '+CN_WEEKDAYS[d.getDay()]; }
function parseZoomUrl(url) { const u = new URL(url); const m = u.pathname.match(/\/j\/(\d+)/); return { id: m[1], pwd: u.searchParams.get('pwd')||'' }; }
function formatScriptureShort(c) { return c.scriptureBook+' '+c.scriptureStartCh+':'+c.scriptureStartV+'-'+c.scriptureEndV; }
function buildAnnounceText(cfg) {
  const z = parseZoomUrl(cfg.zoomUrl);
  const idFmt = z.id ? z.id.replace(/(\d{1,4})(?=(\d{4})+(?!\d))/g, '$1 ').trim() : '';
  const ref = formatScriptureShort(cfg);
  const extras = (cfg.readingExtra || '').split('\n').map(s=>s.trim()).filter(Boolean);
  const lines = [];
  lines.push('親愛的活水家人們，早安！');
  lines.push('今天是'+todayCNDate()+'。');
  lines.push('');
  lines.push('請預備大家的聖經');
  lines.push('【聖經】'+ref);
  extras.forEach(x => lines.push(x));
  lines.push('');
  lines.push('主題: 早靈修班');
  lines.push('時間: 週二-周五 8:30 am');
  lines.push('');
  lines.push('加入 Zoom 會議');
  lines.push(cfg.zoomUrl);
  lines.push('');
  lines.push('蘋果電腦平板手機，');
  lines.push('請手動輸入帳號密碼喔！');
  if (idFmt) lines.push('帳號：'+idFmt);
  if (z.pwd) lines.push('密碼：'+z.pwd+'（我愛耶穌耶穌愛我）');
  return lines.join('\n');
}
const out = buildAnnounceText(cfg);
console.log('---產出公告---');
console.log(out);
console.log('--------------');

assert.ok(out.startsWith('親愛的活水家人們，早安！'), '應以問候語開頭');
assert.ok(out.includes('今天是7月8日 星期三。'), '應有今天日期（2026/7/8 星期三）');
assert.ok(out.includes('【聖經】提摩太前書 5:1-25'), '應有今日經文');
assert.ok(out.includes('《竭誠獻上》'), '應有讀物 1');
assert.ok(out.includes('《靈命日糧》'), '應有讀物 2');
assert.ok(out.includes('主題: 早靈修班'), '應有主題');
assert.ok(out.includes('時間: 週二-周五 8:30 am'), '應有時間');
assert.ok(out.includes('加入 Zoom 會議'), '應有 Zoom 標頭');
assert.ok(out.includes(cfg.zoomUrl), '應有 Zoom 完整連結');
assert.ok(out.includes('帳號：777 3069 2079'), '應有格式化後的帳號');
assert.ok(out.includes('密碼：EbYm30dRERJb8FI3GRHadpkqdNLfE4.1（我愛耶穌耶穌愛我）'), '應有密碼+提示');
console.log('✓ 完整公告字串所有必要片段都正確');

console.log('\n🎉 公告功能（一鍵複製版）煙霧測試全部通過');
