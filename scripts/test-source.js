'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const sourceFiles = [
  'package.json',
  'package-lock.json',
  'electron-builder.yml',
  'README.md',
  '.github/workflows/ci.yml',
  '.github/workflows/build-mac.yml',
  'scripts/setup-win.sh',
  'scripts/setup-mac.sh',
  'scripts/test-announce.js',
  'scripts/test-packaged-smoke.js',
  'scripts/test-reading-layout.js',
  'scripts/test-host-layout.js',
  'scripts/test-presence.js',
  'scripts/test-runtime.js',
  'src/main.js',
  'src/preload.js',
  'src/presence.js',
  'src/presence-shared.js',
  'src/assignment-shared.js',
  'src/host/host-preload.js',
  'src/host/host.js',
  'src/host/index.html',
  'src/host/host.css',
  'src/renderer/app.js',
  'src/renderer/bible.js',
  'src/renderer/index.html',
  'src/renderer/style.css',
  'server/src/index.mjs',
  'server/src/shared.mjs',
  'server/src/google-sheets.mjs',
  'server/google-apps-script/Code.gs',
  'server/wrangler.jsonc',
  'server/README.md'
];

// Replacement/private-use characters are reliable signs of a broken text decode.
// Include a few common UTF-8-as-Latin-1 sequences without rejecting valid CJK text.
const mojibake = /[\u0080-\u009F\uFFFD\uE000-\uF8FF]|(?:\u00C3[\u0080-\u00BF])|(?:\u00E2\u0080[\u0090-\u00BF])/u;
for (const file of sourceFiles) {
  const contents = read(file);
  const badLine = contents.split(/\r?\n/).findIndex((line) => mojibake.test(line));
  assert.strictEqual(badLine, -1, `${file}:${badLine + 1} contains probable mojibake`);
}
console.log('OK source encoding');

const main = read('src/main.js');
const renderer = read('src/renderer/app.js');
assert.match(
  main,
  /^\s*app\.commandLine\.appendSwitch\('autoplay-policy'/m,
  'autoplay policy must be executable code, not part of a comment'
);
assert.match(
  main,
  /configureRendererPermissions\(session\.defaultSession\);/,
  'renderer permissions must be denied before any application window is created'
);
assert.match(
  main,
  /^\s*const candidateParts\s*=/m,
  'version comparison must define parsed candidate parts as executable code'
);
assert.match(
  renderer,
  /^\s*setTimeout\(\(\) => refreshDailyReadingData\(\)/m,
  'initial data refresh must be executable code'
);
console.log('OK critical statements are executable');

const section = (contents, start, end) => {
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Cannot locate source section: ${start}`);
  return contents.slice(startIndex, endIndex);
};
const ensureMediaSource = section(main, 'async function ensureMedia', '// ---------- 快取管理');
assert.ok(
  ensureMediaSource.indexOf('inflight.has(key)') < ensureMediaSource.indexOf('findCachedFile('),
  'ensureMedia must reuse an active download before examining cache fragments'
);
const findCachedSource = section(main, 'function findCachedFile', 'function fileUrl');
assert.doesNotMatch(findCachedSource, /unlinkSync/, 'cache lookup must not delete active download fragments');
const cleanCacheSource = section(main, 'async function cleanCache', '// ---------- 設定');
assert.match(cleanCacheSource, /inflight\.keys\(\)/, 'cache cleanup must skip active downloads');
assert.match(main, /const available = !!\(r && r\.isUpdateAvailable\)/, 'updater must honor electron-updater eligibility');
assert.match(renderer, /let scriptureRequestToken = 0;/, 'scripture requests need stale-response protection');
assert.match(renderer, /let worshipRequestToken = 0;/, 'worship requests need stale-response protection');
console.log('OK async race guards');

assert.match(
  renderer,
  /window\.addEventListener\('keydown', handleFlowArrowNavigation\);/,
  'reading flow must register its named arrow-key handler'
);
assert.match(
  renderer,
  /window\.addEventListener\('wheel', handleFlowWheelNavigation, \{ passive: false \}\);/,
  'reading flow must register its gesture-aware wheel handler'
);
assert.match(
  renderer,
  /footer\.addEventListener\('pointerenter',[\s\S]*?flowFooterHovered = true;[\s\S]*?footer\.addEventListener\('pointerleave',[\s\S]*?flowFooterHovered = false;/,
  'reading navigation must remain visible while the pointer is over it'
);
assert.match(renderer, /onWindowPointerActivity\(handleReadingPointerActivity\);/, 'reading flow must receive pointer activity across native drag regions');
assert.match(main, /setInterval\(pollMainWindowPointer, 50\)/, 'native dragging needs a lightweight pointer activity monitor');
assert.match(
  renderer,
  /v\.addEventListener\('ended', \(\) => backToCover\(\{ nextAfterWorship: true \}\)\);/,
  'worship completion must advance directly to Scripture'
);
assert.match(renderer, /const WORSHIP_CONTROLS_HIDE_MS = 1000;/, 'worship controls must hide after one second');
assert.match(
  renderer,
  /wBackTop'\)\.classList\.add\('show'\)[\s\S]*?wBackTop'\)\.classList\.remove\('show'\)/,
  'worship back button must share the controls visibility lifecycle'
);
assert.match(
  renderer,
  /window\.addEventListener\('keydown', handleEscapeNavigation\);/,
  'Escape completion safety must use its repeat-aware handler'
);
assert.match(
  renderer,
  /flowNextPage'\)\.addEventListener\('click',[^\n]+nextFlowPageOrStep\('button'\)/,
  'the visible next/finish button must share the guarded advance path'
);
assert.match(renderer, /nextFlowPageOrStep\('wheel'\)/, 'wheel navigation must identify its input source');
assert.match(
  renderer,
  /if \(step === 'utmost'\) flowReachedUtmost = true;/,
  'entering Utmost must latch post-reading music suppression'
);
assert.match(
  renderer,
  /if \(flowReachedUtmost\) \{[\s\S]*?a\.pause\(\);[\s\S]*?setMusicSwitchState\(false\);/,
  'returning from Utmost must settle the audio in a silent state'
);
assert.match(main, /preventLeftArrowWorship:\s*true/, 'left-arrow worship safeguard must default to enabled');
assert.match(
  main,
  /preventLeftArrowWorship:\s*value\.preventLeftArrowWorship\s*!==\s*false/,
  'left-arrow worship safeguard must survive config sanitization'
);
assert.match(
  renderer,
  /cfg\.preventLeftArrowWorship\s*!==\s*false[\s\S]*?flowStep\s*===\s*'scripture'[\s\S]*?flowPageIndex\s*<=\s*0/,
  'left-arrow worship safeguard must only intercept the first Scripture page'
);
console.log('OK reading keyboard and completion wiring');

const html = read('src/renderer/index.html');
assert.match(html, /Content-Security-Policy/, 'renderer must declare a Content Security Policy');
assert.match(
  html,
  /7mrMh_2tXCI[^>]*data-announcement-title="讚美之泉（美好的創造）"[^>]*>美好的創造<\/option>/,
  'the announcement sample worship song must be available as a named preset'
);
assert.match(html, /id="preventLeftArrowWorship"/, 'settings must expose the left-arrow worship safeguard');
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
const idCounts = new Map();
for (const id of ids) idCounts.set(id, (idCounts.get(id) || 0) + 1);
assert.deepStrictEqual(
  [...idCounts].filter(([, count]) => count > 1),
  [],
  'HTML contains duplicate ids'
);

const referencedIds = [...renderer.matchAll(/\$\(["']([^"']+)["']\)/g)].map((match) => match[1]);
const missingIds = [...new Set(referencedIds.filter((id) => !idCounts.has(id)))].sort();
assert.deepStrictEqual(missingIds, [], `app.js references missing HTML ids: ${missingIds.join(', ')}`);
console.log('OK renderer DOM ids');

const preload = read('src/preload.js');
const apiCalls = [...renderer.matchAll(/window\.api\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
const exposedApi = new Set(
  [...preload.matchAll(/^\s{2}([A-Za-z0-9_]+)\s*:/gm)].map((match) => match[1])
);
const missingApi = [...new Set(apiCalls.filter((name) => !exposedApi.has(name)))].sort();
assert.deepStrictEqual(missingApi, [], `preload is missing renderer APIs: ${missingApi.join(', ')}`);
console.log('OK preload API coverage');

assert.match(main, /new BrowserWindow\(\{[\s\S]*?title: '靈修班主持台'/, 'host console must use a separate BrowserWindow');
assert.match(main, /trustedHandle\('presence:pair'/, 'presence pairing IPC is missing');
assert.match(main, /presenceManager\.scheduleToday/, 'private backend schedule must be preferred');
assert.match(preload, /openHostConsole/, 'main renderer cannot open the private host console');
console.log('OK private host console wiring');

const css = read('src/renderer/style.css');
for (const selector of [
  '.scripture-page',
  '.scripture-reader',
  '.scripture-verse-number',
  '.scripture-continuation',
  '.utmost-sheet',
  '.utmost-verse-card',
  '.utmost-verse-citation',
  '.utmost-paragraph'
]) {
  assert.ok(css.includes(selector), `Reading layout CSS is missing ${selector}`);
}
assert.match(renderer, /type:\s*'scripture'/, 'scripture pages must use structured page objects');
assert.match(renderer, /type:\s*'utmost'/, 'Utmost must use a structured page object');
assert.match(renderer, /const UTMOST_MIN_REGULAR_SCALE = 0\.48;/, 'Utmost regular scaling must stop at 48%');
assert.match(
  css,
  /\.flow-screen:is\(\[data-step="scripture"\], \[data-step="utmost"\]\)\s*\{[\s\S]*?width:\s*405px;[\s\S]*?height:\s*720px;[\s\S]*?container-type:\s*size;[\s\S]*?scale\(var\(--flow-display-scale, 1\)\)/,
  'reading views must keep a fixed logical canvas and scale it as one unit'
);
assert.match(renderer, /window\.addEventListener\('resize', updateFlowDisplayScale\)/, 'window resizing must only update the reading display scale');
assert.doesNotMatch(renderer, /scheduleFlowLayoutRefresh/, 'window resizing must not repaginate reading content');
assert.match(renderer, /setupSettingsTextSelection\(\)/, 'settings text fields must preserve fast drag selection beyond their edges');
assert.match(css, /\.settings input\[type="text"\][\s\S]*?-webkit-user-select:\s*text;/, 'settings text fields must explicitly allow text selection');
assert.doesNotMatch(
  section(renderer, 'function buildScripturePagesByFit', 'function renderFlowPage'),
  /SCRIPTURE_MAX_VERSES_PER_PAGE/,
  'scripture pagination must use measured height instead of a fixed verse limit'
);
assert.doesNotMatch(
  renderer,
  /function rebalanceScriptureTail/,
  'scripture pagination must not empty earlier pages merely to balance the tail'
);
const cssDir = path.join(root, 'src', 'renderer');
const missingAssets = [];
for (const match of css.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)) {
  const value = match[1];
  if (/^(?:data:|https?:|file:|#|var\()/i.test(value)) continue;
  const asset = path.resolve(cssDir, decodeURIComponent(value));
  if (!fs.existsSync(asset)) missingAssets.push(value);
}
assert.deepStrictEqual(
  [...new Set(missingAssets)].sort(),
  [],
  `CSS references missing local assets: ${missingAssets.join(', ')}`
);
console.log('OK CSS assets');

const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const ciWorkflow = read('.github/workflows/ci.yml');
const builderConfig = read('electron-builder.yml');
const setupMac = read('scripts/setup-mac.sh');
assert.equal(packageJson.version, packageLock.version, 'package and lockfile versions must match');
assert.equal(packageJson.version, packageLock.packages[''].version, 'lockfile root version must match package');
assert.equal(packageJson.scripts['test:layout'], 'electron scripts/test-reading-layout.js', 'layout smoke script is missing');
assert.equal(packageJson.scripts['test:host-layout'], 'electron scripts/test-host-layout.js', 'host layout smoke script is missing');
assert.match(ciWorkflow, /npm run test:layout/, 'cross-platform CI must run the Electron reading layout test');
assert.match(ciWorkflow, /npm run test:host-layout/, 'cross-platform CI must run the host console layout test');
assert.match(ciWorkflow, /test-packaged-smoke\.js/, 'Windows CI must launch the packaged Electron application');
assert.match(
  builderConfig,
  /^\s*artifactName:\s*lingxiu-cover-setup-\$\{version\}\.\$\{ext\}\s*$/m,
  'Windows installer filename must match the ASCII path written to latest.yml'
);
assert.match(
  setupMac,
  /\[\[ "\$ffmpeg_version_line" != ffmpeg\\ version\\ \* \]\]/,
  'macOS helper setup must verify that the merged ffmpeg binary executes'
);
assert.match(
  setupMac,
  /\[\[ "\$ffprobe_version_line" != ffprobe\\ version\\ \* \]\]/,
  'macOS helper setup must verify that the merged ffprobe binary executes'
);
console.log('OK package metadata');

console.log('\nAll source integrity checks passed.');
