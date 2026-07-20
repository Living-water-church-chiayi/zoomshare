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
