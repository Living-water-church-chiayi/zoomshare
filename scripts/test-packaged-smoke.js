'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const executable = process.argv[2] ? path.resolve(process.argv[2]) : '';
assert.ok(executable && fs.existsSync(executable), 'Usage: node scripts/test-packaged-smoke.js <packaged-app-executable>');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForPage(port, child, timeoutMilliseconds = 30000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged application exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === 'page' && /index\.html(?:$|[?#])/.test(target.url || ''));
        if (page && page.webSocketDebuggerUrl) return page;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for packaged renderer${lastError ? `: ${lastError.message}` : ''}`);
}

async function waitForTarget(port, child, pattern, timeoutMilliseconds = 15000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged application exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((item) => item.type === 'page' && pattern.test(item.url || ''));
        if (target && target.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(200);
  }
  throw new Error(`Timed out waiting for packaged target ${pattern}`);
}

function evaluate(page, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('DevTools evaluation timed out'));
    }, 10000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error) reject(new Error(message.error.message));
      else if (message.result && message.result.exceptionDetails) {
        const details = message.result.exceptionDetails;
        const description = details.exception && details.exception.description;
        reject(new Error(`Renderer evaluation failed: ${description || details.text || 'unknown exception'}`));
      }
      else resolve(message.result.result.value);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Unable to connect to packaged renderer DevTools'));
    });
  });
}

function stopProcessTree(child) {
  if (!child || child.pid <= 0 || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch { try { child.kill('SIGTERM'); } catch {} }
}

async function run() {
  const port = await availablePort();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxiu-packaged-smoke-'));
  let child = null;
  try {
    child = spawn(executable, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${temporaryRoot}`,
      '--disable-gpu',
      '--headless'
    ], {
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: 'ignore'
    });
    const page = await waitForPage(port, child);
    const stateExpression = `(() => ({
      readyState: document.readyState,
      title: document.title,
      hasFlowScreen: Boolean(document.getElementById('flowScreen')),
      hasFlowContent: Boolean(document.getElementById('flowContent')),
      hasPageControls: Boolean(document.getElementById('flowPrevPage') && document.getElementById('flowNextPage')),
      platformClass: Boolean(document.body && (
        document.body.classList.contains('plat-win') || document.body.classList.contains('plat-mac')
      ))
    }))()`;
    const stateDeadline = Date.now() + 15000;
    let state = null;
    while (Date.now() < stateDeadline) {
      state = await evaluate(page, stateExpression);
      if (
        state.readyState === 'complete' &&
        state.hasFlowScreen &&
        state.hasFlowContent &&
        state.hasPageControls &&
        state.platformClass
      ) break;
      await delay(200);
    }
    assert.equal(state.readyState, 'complete', 'Packaged renderer did not finish loading');
    assert.match(state.title, /\S/, 'Packaged renderer title is empty');
    assert.equal(state.hasFlowScreen, true, 'Packaged renderer is missing the reading screen');
    assert.equal(state.hasFlowContent, true, 'Packaged renderer is missing the reading content container');
    assert.equal(state.hasPageControls, true, 'Packaged renderer is missing reading navigation controls');
    assert.equal(state.platformClass, true, 'Packaged renderer initialization did not finish');
    const preparationDates = await evaluate(page, `(() => ({
      before: appDateKey(new Date('2026-09-22T09:29:59Z')),
      after: appDateKey(new Date('2026-09-22T09:30:00Z')),
      midnight: appDateKey(new Date('2026-09-22T16:00:00Z')),
      label: systemDateMD(new Date('2026-09-22T09:30:00Z'))
    }))()`);
    assert.deepEqual(preparationDates, {
      before: '2026-09-22', after: '2026-09-23', midnight: '2026-09-23', label: '9/23'
    }, 'Packaged renderer must switch all daily dates at 17:30');

    await evaluate(page, `window.api.publishWorshipPlayback({ active: true, position: 45, end: 100, duration: 300, paused: false })`);
    await evaluate(page, `document.getElementById('btnHost').click()`);
    const hostPage = await waitForTarget(port, child, /host[\\/]index\.html(?:$|[?#])/);
    const hostExpression = `(() => ({
      readyState: document.readyState,
      title: document.title,
      setupVisible: Boolean(document.getElementById('setupView')) && !document.getElementById('setupView').classList.contains('hidden'),
      hasPrivateLists: Boolean(document.getElementById('scriptureAssignments') && document.getElementById('utmostAssignments') && document.getElementById('scriptureEligibleList') && document.getElementById('utmostEligibleList'))
    }))()`;
    const hostDeadline = Date.now() + 10000;
    let hostState = null;
    while (Date.now() < hostDeadline) {
      hostState = await evaluate(hostPage, hostExpression);
      if (hostState.readyState === 'complete' && hostState.setupVisible && hostState.hasPrivateLists) break;
      await delay(200);
    }
    assert.equal(hostState.readyState, 'complete', 'Packaged host console did not finish loading');
    assert.match(hostState.title, /主持/, 'Packaged host console title is incorrect');
    assert.equal(hostState.setupVisible, true, 'Fresh packaged host console should show device pairing');
    assert.equal(hostState.hasPrivateLists, true, 'Packaged host console is missing candidate lists');
    const countdown = await evaluate(hostPage, `({
      hidden: document.getElementById('hostWorshipCountdown').classList.contains('hidden'),
      text: document.getElementById('hostWorshipRemaining').textContent,
      tone: document.getElementById('hostWorshipCountdown').dataset.tone
    })`);
    assert.deepEqual(countdown, { hidden: false, text: '0:55', tone: 'minute' }, 'Opening host during worship must hydrate the current countdown');
    await evaluate(page, `window.api.publishWorshipPlayback({ active: true, position: 85, end: 100, duration: 300, paused: true })`);
    const countdownDeadline = Date.now() + 3000;
    let syncedCountdown;
    do {
      syncedCountdown = await evaluate(hostPage, `({ text: document.getElementById('hostWorshipRemaining').textContent,
        tone: document.getElementById('hostWorshipCountdown').dataset.tone,
        paused: document.getElementById('hostWorshipLabel').textContent.includes('已暫停') })`);
      if (syncedCountdown.text === '0:15') break;
      await delay(50);
    } while (Date.now() < countdownDeadline);
    assert.deepEqual(syncedCountdown, { text: '0:15', tone: 'ending', paused: true }, 'Worship seek/pause must reach the host through real IPC');
    await evaluate(page, `window.api.publishWorshipPlayback({ active: false })`);
    await delay(100);
    assert.equal(await evaluate(hostPage, `document.getElementById('hostWorshipCountdown').classList.contains('hidden')`), true);
    assert.equal(await evaluate(hostPage, `taipeiDateKey(new Date('2026-09-22T09:30:00Z'))`), '2026-09-23',
      'Packaged host must use the same preparation date as the renderer');
    const nameMatches = await evaluate(hostPage, `(() => {
      const matcher = window.PresenceShared.buildRosterMatcher([
        { memberId: 'z', name: '秀珠阿姨', aliases: ['詹秀珠', '活水-詹秀珠'], enabled: true },
        { memberId: 's', name: '淑貞阿姨', aliases: ['李淑貞'], enabled: true }
      ]);
      return ['詹秀珠', '詹秀琴', '李淑貞', '陳淑貞'].map((name) =>
        window.PresenceShared.matchRosterMemberIds(matcher, name));
    })()`);
    assert.deepEqual(nameMatches, [['z'], [], ['s'], []], 'Packaged host must reject surname-prefix and conflicting-surname matches');
    const showFinalUtmost = `flowStep = 'utmost'; flowPages = [{ type: 'text', text: '測試最後一頁' }]; flowPageIndex = 0;
      flowTransitioning = false; flowLoading = false; document.getElementById('flowScreen').classList.remove('hidden');`;
    await evaluate(page, `${showFinalUtmost}
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));`);
    await delay(150);
    assert.equal(await evaluate(page, `flowStep`), 'cover', 'Escape must return to the cover even after two quit-confirmation presses');
    await evaluate(page, `${showFinalUtmost}
      for (let i = 0; i < 3; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));`);
    assert.equal(child.exitCode, null, 'Down arrows must never quit the app');
    assert.equal(await evaluate(page, `utmostFinishConfirmCount`), 0, 'Down arrows must not arm app exit');
    await evaluate(page, `for (let i = 0; i < 3; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));`);
    const quitDeadline = Date.now() + 5000;
    while (child.exitCode === null && Date.now() < quitDeadline) await delay(50);
    assert.equal(child.exitCode, 0, 'Three right-arrow presses on the last Utmost page must quit the app');
    console.log(`Packaged Electron smoke passed: ${path.basename(executable)}`);
  } finally {
    stopProcessTree(child);
    await delay(500);
    const resolvedTemp = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (resolvedTemp.startsWith(resolvedSystemTemp + path.sep) && path.basename(resolvedTemp).startsWith('lingxiu-packaged-smoke-')) {
      fs.rmSync(resolvedTemp, { recursive: true, force: true });
    }
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
