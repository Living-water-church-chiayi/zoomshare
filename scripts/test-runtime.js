'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { scriptureSegments } = require('../src/assignment-shared');

const projectRoot = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'app.js'), 'utf8');
const rendererHtml = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');

/*
 * Extract the function declaration from the real application source. This keeps
 * the tests executable in plain Node without loading Electron or booting the UI,
 * while ensuring the implementation under test is not copied into this file.
 */
function extractFunction(source, name) {
  const startMatch = new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(startMatch, `Cannot find function ${name} in application source`);

  const start = startMatch.index;
  const openingBrace = source.indexOf('{', startMatch.index + startMatch[0].length);
  assert.notEqual(openingBrace, -1, `Cannot find opening brace for ${name}`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openingBrace; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  assert.fail(`Cannot find closing brace for ${name}`);
}

function loadFunctions(source, names, globals = {}) {
  const context = vm.createContext({
    URL,
    Date,
    Number,
    String,
    parseInt,
    encodeURIComponent,
    ...globals
  });
  const declarations = names.map((name) => extractFunction(source, name)).join('\n');
  const exportsExpression = names.map((name) => `${name}: ${name}`).join(', ');
  const script = new vm.Script(
    `'use strict';\n${declarations}\nglobalThis.__runtimeTests = { ${exportsExpression} };`,
    { filename: 'extracted-application-functions.js' }
  );
  script.runInContext(context, { timeout: 1000 });
  return context.__runtimeTests;
}

const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

// Values created inside vm contexts have different prototypes from values in
// this Node process. Convert them to plain JSON values before deep comparison.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function scriptureFixture(count) {
  return Array.from({ length: count }, (_, index) => ({
    chapter: 1,
    number: index + 1,
    text: `第 ${index + 1} 節`,
    continuation: false,
    startsChapter: index === 0,
    key: `1:${index + 1}:${index}`
  }));
}

function loadScripturePaginationFunctions(pageFits) {
  return loadFunctions(
    rendererSource,
    ['logicalVerseCount', 'buildScripturePagesByFit'],
    {
      scripturePageFits: pageFits,
      // Oversized-verse behavior has its own focused tests below. Keeping this
      // stub identity-like makes page distribution deterministic.
      splitOversizedScriptureVerse: (verse) => [verse]
    }
  );
}

test('compares real application versions without lexicographic mistakes', () => {
  const { versionParts, isNewerVersion } = loadFunctions(
    mainSource,
    ['versionParts', 'isNewerVersion']
  );

  assert.equal(isNewerVersion('v1.2.4', '1.2.3'), true);
  assert.equal(isNewerVersion('2.0.0', '1.99.99'), true);
  assert.equal(isNewerVersion('1.10.0', '1.9.99'), true);
  assert.equal(isNewerVersion('1.2.3', '1.2.3'), false);
  assert.equal(isNewerVersion('1.2.2', '1.2.3'), false);
  assert.equal(isNewerVersion('not-a-version', '1.2.3'), false);
  assert.equal(versionParts('1.2.3.4'), null);
});

test('creates a valid file URL for spaces, Unicode, #, ? and %', () => {
  const { fileUrl } = loadFunctions(mainSource, ['fileUrl'], { pathToFileURL });
  const specialPath = path.join(projectRoot, '測試 folder', '歌曲 #1?100%.mp4');
  const actual = fileUrl(specialPath);

  assert.equal(actual, pathToFileURL(specialPath).href);
  assert.match(actual, /^file:/);
  assert.match(actual, /%20/);
  assert.match(actual, /%23/);
  assert.match(actual, /%3F/i);
  assert.match(actual, /%25/);
});

test('accepts only descendants of the media cache for native audio playback', () => {
  const { pathInside } = loadFunctions(mainSource, ['pathInside'], { path });
  const cache = path.join(projectRoot, 'cache-root');

  assert.equal(pathInside(cache, path.join(cache, 'song.m4a')), true);
  assert.equal(pathInside(cache, path.join(cache, 'nested', 'worship.mp4')), true);
  assert.equal(pathInside(cache, cache), false);
  assert.equal(pathInside(cache, path.resolve(cache, '..', 'outside.m4a')), false);
});

test('denies renderer capture permissions because playback never needs recording access', () => {
  let checkHandler = null;
  let requestHandler = null;
  const fakeSession = {
    setPermissionCheckHandler(handler) { checkHandler = handler; },
    setPermissionRequestHandler(handler) { requestHandler = handler; }
  };
  const { configureRendererPermissions } = loadFunctions(
    mainSource,
    ['configureRendererPermissions']
  );

  configureRendererPermissions(fakeSession);
  assert.equal(checkHandler(null, 'media', 'file:///renderer/index.html', { mediaType: 'audio' }), false);

  let granted = null;
  requestHandler(null, 'media', (allowed) => { granted = allowed; }, { mediaTypes: ['audio'] });
  assert.equal(granted, false);
});

test('forces macOS audio input streams onto a fake device without disabling playback', () => {
  const switches = [];
  const fakeApp = {
    commandLine: {
      appendSwitch(name, value) { switches.push([name, value]); }
    }
  };
  const { configurePlaybackOnlyAudio } = loadFunctions(
    mainSource,
    ['configurePlaybackOnlyAudio']
  );

  configurePlaybackOnlyAudio(fakeApp, 'darwin');
  assert.deepEqual(switches, [['disable-audio-input', undefined]]);

  switches.length = 0;
  configurePlaybackOnlyAudio(fakeApp, 'win32');
  assert.deepEqual(switches, []);
});

test('starts the native macOS audio helper only for a load command', () => {
  const { nativeAudioActionStartsHelper } = loadFunctions(
    mainSource,
    ['nativeAudioActionStartsHelper']
  );

  assert.equal(nativeAudioActionStartsHelper('load'), true);
  for (const action of ['play', 'pause', 'seek', 'volume', 'stop']) {
    assert.equal(nativeAudioActionStartsHelper(action), false, `${action} must not start the helper`);
  }
});

test('serializes native audio commands while an earlier load is being validated', async () => {
  let releaseLoad;
  const loadGate = new Promise((resolve) => { releaseLoad = resolve; });
  const sent = [];
  const { enqueueNativeAudioCommand } = loadFunctions(
    mainSource,
    ['enqueueNativeAudioCommand'],
    {
      nativeAudioCommandQueue: Promise.resolve(),
      nativeAudioCommandGeneration: 0,
      normalizeNativeAudioCommand: async (request) => {
        if (request.action === 'load') await loadGate;
        return request;
      },
      updateNativeAudioPlaybackIntent: () => {},
      nativeMacAudio: { send(command) { sent.push(command.action); return { ok: true }; } }
    }
  );

  const load = enqueueNativeAudioCommand({ action: 'load' });
  const stop = enqueueNativeAudioCommand({ action: 'stop' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, [], 'stop must wait rather than overtake a validating load');
  releaseLoad();
  await Promise.all([load, stop]);
  assert.deepEqual(sent, ['load', 'stop']);
});

test('does not revive a validating native load after the window closes', async () => {
  let releaseLoad;
  const loadGate = new Promise((resolve) => { releaseLoad = resolve; });
  const sent = [];
  let closes = 0;
  const { enqueueNativeAudioCommand, closeNativeAudio } = loadFunctions(
    mainSource,
    ['closeNativeAudio', 'enqueueNativeAudioCommand'],
    {
      nativeAudioCommandQueue: Promise.resolve(),
      nativeAudioCommandGeneration: 0,
      normalizeNativeAudioCommand: async (request) => {
        await loadGate;
        return request;
      },
      updateNativeAudioPlaybackIntent: () => {},
      resetNativeAudioPlaybackIntent: () => {},
      nativeMacAudio: {
        send(command) { sent.push(command.action); return { ok: true }; },
        close() { closes++; }
      }
    }
  );

  const load = enqueueNativeAudioCommand({ action: 'load' });
  await new Promise((resolve) => setImmediate(resolve));
  closeNativeAudio();
  releaseLoad();
  assert.deepEqual(plain(await load), { ok: false, cancelled: true });
  assert.deepEqual(sent, []);
  assert.equal(closes, 1);
});

test('uses a macOS power-save blocker only while native audio is intended to play', () => {
  const calls = [];
  const blocker = {
    start(type) {
      calls.push(`start:${type}`);
      return 42;
    },
    stop(id) {
      calls.push(`stop:${id}`);
    }
  };
  const { updateNativeAudioPlaybackIntent, resetNativeAudioPlaybackIntent } = loadFunctions(
    mainSource,
    ['updateNativeAudioPowerSaveBlocker', 'updateNativeAudioPlaybackIntent', 'resetNativeAudioPlaybackIntent'],
    {
      process: { platform: 'darwin' },
      powerSaveBlocker: blocker,
      nativeAudioPlaybackIntent: { music: false, worship: false },
      nativeAudioPowerSaveBlockerId: null
    }
  );

  assert.equal(updateNativeAudioPlaybackIntent({ channel: 'worship', action: 'load', autoplay: true }, { ok: true }, 'darwin', blocker), true);
  assert.deepEqual(calls, ['start:prevent-app-suspension']);
  assert.equal(updateNativeAudioPlaybackIntent({ channel: 'music', action: 'load', autoplay: true }, { ok: true }, 'darwin', blocker), true);
  assert.deepEqual(calls, ['start:prevent-app-suspension']);
  assert.equal(updateNativeAudioPlaybackIntent({ channel: 'worship', action: 'stop' }, { ok: true }, 'darwin', blocker), true);
  assert.deepEqual(calls, ['start:prevent-app-suspension']);
  resetNativeAudioPlaybackIntent('darwin', blocker);
  assert.deepEqual(calls, ['start:prevent-app-suspension', 'stop:42']);
});

test('does not start the native audio power-save blocker on Windows', () => {
  const calls = [];
  const blocker = {
    start() { calls.push('start'); return 1; },
    stop() { calls.push('stop'); }
  };
  const { updateNativeAudioPlaybackIntent } = loadFunctions(
    mainSource,
    ['updateNativeAudioPowerSaveBlocker', 'updateNativeAudioPlaybackIntent'],
    {
      process: { platform: 'win32' },
      powerSaveBlocker: blocker,
      nativeAudioPlaybackIntent: { music: false, worship: false },
      nativeAudioPowerSaveBlockerId: null
    }
  );

  assert.equal(updateNativeAudioPlaybackIntent({ channel: 'worship', action: 'load', autoplay: true }, { ok: true }, 'win32', blocker), false);
  assert.deepEqual(calls, []);
});

test('reports pointer movement over the main window without resizing it', () => {
  const cursorPoints = [
    { x: 150, y: 250 },
    { x: 150, y: 250 },
    { x: 151, y: 250 },
    { x: 900, y: 900 }
  ];
  const messages = [];
  const fakeWindow = {
    isDestroyed: () => false,
    getBounds: () => ({ x: 100, y: 200, width: 405, height: 720 }),
    focus: () => assert.fail('pointer hover must not activate the window'),
    setBounds: () => assert.fail('pointer observation resized the reading window'),
    setPosition: () => assert.fail('pointer observation manually moved the reading window'),
    webContents: {
      isDestroyed: () => false,
      send: (channel, payload) => messages.push({ channel, payload })
    }
  };
  const functions = loadFunctions(
    mainSource,
    ['pointInsideBounds', 'mainWindowPointerPayload', 'pollMainWindowPointer'],
    {
      mainWindow: fakeWindow,
      lastPointerPoint: null,
      screen: { getCursorScreenPoint: () => cursorPoints.shift() }
    }
  );

  functions.pollMainWindowPointer();
  functions.pollMainWindowPointer();
  functions.pollMainWindowPointer();
  functions.pollMainWindowPointer();
  assert.deepEqual(plain(messages), [
    { channel: 'win:pointer-activity', payload: { x: 50, y: 50, width: 405, height: 720 } },
    { channel: 'win:pointer-activity', payload: { x: 51, y: 50, width: 405, height: 720 } }
  ]);
});

test('persists only wide main-window bounds and restores them on startup', () => {
  const displayProvider = {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } })
  };
  const {
    sanitizeWindowBounds,
    fitAspectSize,
    centeredBounds,
    restoredMainWindowBounds,
    shouldSaveMainWindowBounds
  } = loadFunctions(
    mainSource,
    ['isPlainObject', 'boundedInteger', 'sanitizeWindowBounds', 'fitAspectSize', 'centeredBounds', 'restoredMainWindowBounds', 'shouldSaveMainWindowBounds'],
    {
      screen: displayProvider,
      currentMainWindowMode: 'wide'
    }
  );
  const saved = { x: 50, y: 60, width: 1000, height: 563 };
  const fallback = { x: 80, y: 90, width: 1280, height: 720 };

  assert.deepEqual(plain(sanitizeWindowBounds(saved)), saved);
  assert.equal(sanitizeWindowBounds({ x: 50, y: 60, width: 360, height: 640 }), null);
  assert.deepEqual(plain(restoredMainWindowBounds(saved, fallback, displayProvider)), saved);
  assert.deepEqual(plain(restoredMainWindowBounds({ x: 50, y: 60, width: 360, height: 640 }, fallback, displayProvider)), fallback);
  assert.equal(shouldSaveMainWindowBounds(saved, 'wide'), true);
  assert.equal(shouldSaveMainWindowBounds(saved, 'mobile'), false);
  assert.equal(shouldSaveMainWindowBounds({ x: 50, y: 60, width: 360, height: 640 }, 'wide'), false);
});

test('keeps one user-selected display scale across cover, worship, and reading modes', () => {
  const calls = { bounds: [], aspectRatios: [], minimumSizes: [], saved: [] };
  let currentBounds = { x: 100, y: 100, width: 800, height: 450 };
  const mainWindow = {
    isDestroyed: () => false,
    getBounds: () => ({ ...currentBounds }),
    setBounds: (bounds) => {
      currentBounds = { ...bounds };
      calls.bounds.push({ ...bounds });
    },
    setAspectRatio: (ratio) => calls.aspectRatios.push(ratio),
    setMinimumSize: (width, height) => calls.minimumSizes.push([width, height])
  };
  const {
    setWindowMode
  } = loadFunctions(
    mainSource,
    ['fitAspectSize', 'centeredBounds', 'setMainWindowBoundsSafely', 'setWindowMode'],
    {
      mainWindow,
      screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
      process: { platform: 'linux' },
      currentMainWindowMode: 'wide',
      lastWideBounds: null,
      suppressMainWindowBoundsSave: false,
      saveMainWindowBounds: (bounds) => {
        calls.saved.push({ ...bounds });
        return Promise.resolve(true);
      },
      setTimeout: (callback) => {
        callback();
        return 1;
      },
      console
    }
  );

  setWindowMode('wide');
  assert.deepEqual(currentBounds, { x: 100, y: 100, width: 800, height: 450 }, 'cover-to-worship must not enlarge the window');
  assert.equal(calls.bounds.length, 0, 'same wide layout should not be resized programmatically');

  setWindowMode('mobile');
  assert.deepEqual(currentBounds, { x: 374, y: 100, width: 253, height: 450 }, 'reading mode must keep the cover height and display scale');

  setWindowMode('mobile');
  assert.equal(calls.bounds.length, 1, 'Scripture-to-Utmost must not resize an already-mobile window');

  setWindowMode('wide');
  assert.deepEqual(currentBounds, { x: 100, y: 100, width: 800, height: 450 }, 'returning to cover must restore the user-selected wide bounds');
});

test('reveals reading navigation from pointer activity across a native drag region', () => {
  let hidden = false;
  const calls = [];
  const surface = {
    dataset: { step: 'scripture' },
    classList: { contains: (name) => name === 'hidden' ? hidden : false }
  };
  const { handleReadingPointerActivity } = loadFunctions(
    rendererSource,
    ['handleReadingPointerActivity'],
    {
      $: () => surface,
      flowStep: 'scripture',
      isReadingFlowStep: () => true,
      revealFlowFooter: () => calls.push('reveal'),
      scheduleFlowFooterHide: () => calls.push('schedule')
    },
  );

  assert.equal(handleReadingPointerActivity(), true);
  assert.deepEqual(calls, ['reveal', 'schedule']);
  hidden = true;
  assert.equal(handleReadingPointerActivity(), false);
  assert.deepEqual(calls, ['reveal', 'schedule']);
});

test('reveals the cover toolbar from native pointer activity only in the bottom hotzone', () => {
  const calls = [];
  const { handleWindowPointerActivity } = loadFunctions(
    rendererSource,
    ['pointerCoordinate', 'coverToolbarHotzoneHeight', 'shouldRevealCoverToolbarFromPointer', 'handleWindowPointerActivity'],
    {
      $: () => ({ contains: () => false }),
      window: { innerHeight: 720 },
      MAIN_TOOLBAR_HOTZONE_RATIO: 0.16,
      MAIN_TOOLBAR_HOTZONE_MIN: 72,
      MAIN_TOOLBAR_HOTZONE_MAX: 150,
      handleReadingPointerActivity: () => false,
      isMainCover: () => true,
      showToolbar: () => calls.push('toolbar')
    }
  );

  assert.equal(handleWindowPointerActivity({ y: 360, height: 720 }), false);
  assert.deepEqual(calls, []);
  assert.equal(handleWindowPointerActivity({ y: 650, height: 720 }), true);
  assert.deepEqual(calls, ['toolbar']);
});

test('does not show the cover toolbar when native pointer activity is handled by reading flow', () => {
  const calls = [];
  const { handleWindowPointerActivity } = loadFunctions(
    rendererSource,
    ['handleWindowPointerActivity'],
    {
      handleReadingPointerActivity: () => true,
      isMainCover: () => true,
      showToolbar: () => calls.push('toolbar')
    }
  );

  assert.equal(handleWindowPointerActivity(), true);
  assert.deepEqual(calls, []);
});

test('native reading drag regions exclude navigation buttons', () => {
  const css = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'style.css'), 'utf8');
  assert.match(
    css,
    /flow-screen:is\(\[data-step="scripture"\], \[data-step="utmost"\]\)[\s\S]*?-webkit-app-region: drag;/,
    'reading surfaces must use native window dragging'
  );
  assert.match(
    css,
    /flow-screen:is\(\[data-step="scripture"\], \[data-step="utmost"\]\) \.flow-footer[\s\S]*?-webkit-app-region: no-drag;/,
    'reading navigation must remain clickable'
  );
});

test('does not close settings when text selection starts inside the panel', () => {
  const input = { closest: () => null };
  const backdrop = { closest: () => null };
  const settingsButton = { closest: (selector) => selector === '#btnSettings' ? settingsButton : null };
  const panel = {
    classList: { contains: () => false },
    contains: (target) => target === input
  };
  const { isSettingsOutsideTarget, shouldDismissSettingsFromPointer } = loadFunctions(
    rendererSource,
    ['isSettingsOutsideTarget', 'shouldDismissSettingsFromPointer'],
    { $: (id) => id === 'settingsPanel' ? panel : null }
  );

  assert.equal(isSettingsOutsideTarget(input), false);
  assert.equal(isSettingsOutsideTarget(backdrop), true);
  assert.equal(isSettingsOutsideTarget(settingsButton), false);
  assert.equal(shouldDismissSettingsFromPointer(false, backdrop), false, 'inside-to-outside selection closed settings');
  assert.equal(shouldDismissSettingsFromPointer(true, input), false, 'outside-to-inside drag closed settings');
  assert.equal(shouldDismissSettingsFromPointer(true, backdrop), true, 'a deliberate outside click no longer closes settings');
});

test('extends fast settings-field drags to either end of the text', () => {
  const selections = [];
  const field = {
    value: 'https://example.test/video',
    selectionStart: 8,
    selectionEnd: 8,
    selectionDirection: 'none',
    getBoundingClientRect: () => ({ left: 100, right: 300 }),
    setSelectionRange: (...selection) => selections.push(selection)
  };
  const { settingsTextSelectionAnchor, extendSettingsTextSelectionToBoundary } = loadFunctions(
    rendererSource,
    ['settingsTextSelectionAnchor', 'extendSettingsTextSelectionToBoundary']
  );

  assert.equal(settingsTextSelectionAnchor(field), 8);
  assert.equal(extendSettingsTextSelectionToBoundary(field, 8, 99), true);
  assert.deepEqual(selections.pop(), [0, 8, 'backward']);
  assert.equal(extendSettingsTextSelectionToBoundary(field, 8, 301), true);
  assert.deepEqual(selections.pop(), [8, field.value.length, 'forward']);
  assert.equal(extendSettingsTextSelectionToBoundary(field, 8, 200), false);
  assert.equal(selections.length, 0);
});

test('converts only exact Zoom hosts or their subdomains', () => {
  const { zoomLaunchUrl } = loadFunctions(rendererSource, ['zoomLaunchUrl']);
  const valid = 'https://us06web.zoom.us/j/77730692079?pwd=A%20B%2F%3D';

  assert.equal(
    zoomLaunchUrl(valid),
    'zoommtg://us06web.zoom.us/join?action=join&confno=77730692079&pwd=A%20B%2F%3D'
  );
  assert.equal(
    zoomLaunchUrl('https://zoom.us/j/123456'),
    'zoommtg://zoom.us/join?action=join&confno=123456'
  );

  for (const untrusted of [
    'https://evilzoom.us/j/123456',
    'https://zoom.us.evil.example/j/123456',
    'https://zoom.us@evil.example/j/123456',
    'not a URL'
  ]) {
    assert.equal(zoomLaunchUrl(untrusted), '');
  }
});

test('rejects unsafe external protocols and forged zoommtg hosts', () => {
  const { normalizeExternalUrl } = loadFunctions(mainSource, ['normalizeExternalUrl']);

  assert.equal(
    normalizeExternalUrl('zoommtg://us06web.zoom.us/join?action=join&confno=123'),
    'zoommtg://us06web.zoom.us/join?action=join&confno=123'
  );
  assert.equal(normalizeExternalUrl('https://example.com/path'), 'https://example.com/path');
  assert.throws(() => normalizeExternalUrl('zoommtg://evilzoom.us/join'), /Zoom/);
  assert.throws(() => normalizeExternalUrl('javascript:alert(1)'), /HTTPS|Zoom/);
  assert.throws(() => normalizeExternalUrl('file:///C:/secret.txt'), /HTTPS|Zoom/);
  assert.throws(() => normalizeExternalUrl('https://user:pass@example.com/'), /帳號|密碼/);
});

test('accepts real YouTube hosts and rejects lookalike media URLs', () => {
  const { normalizeMediaRequest } = loadFunctions(mainSource, ['normalizeMediaRequest']);
  const valid = normalizeMediaRequest('https://www.youtube.com/watch?v=abc', 'video', 1080);

  assert.equal(valid.url, 'https://www.youtube.com/watch?v=abc');
  assert.equal(valid.kind, 'video');
  assert.equal(valid.quality, 1080);
  assert.throws(
    () => normalizeMediaRequest('https://youtube.com.evil.example/watch?v=abc', 'video', 1080),
    /YouTube/
  );
  assert.throws(
    () => normalizeMediaRequest('http://youtube.com/watch?v=abc', 'video', 1080),
    /HTTPS YouTube/
  );
  assert.throws(() => normalizeMediaRequest('https://youtu.be/abc', 'video', 9999), /144.*2160/);
  assert.throws(() => normalizeMediaRequest('https://youtu.be/abc', 'document', 1080), /audio.*video/);
});

test('fetches a safe YouTube title with oEmbed and yt-dlp fallback', async () => {
  let oEmbedFails = false;
  let requestedOEmbedUrl = '';
  let execCall = null;
  const functions = loadFunctions(
    mainSource,
    [
      'normalizeMediaRequest',
      'sanitizeMediaTitle',
      'stripWorshipTitleNoise',
      'worshipTitleIdentity',
      'worshipMetadataPart',
      'inferWorshipSongTitle',
      'parseYtDlpWorshipMetadata',
      'fetchYtDlpWorshipMetadata',
      'fetchYouTubeMetadata'
    ],
    {
      httpGetJson: async (url) => {
        requestedOEmbedUrl = url;
        if (oEmbedFails) throw new Error('offline');
        return { title: '  測試\n敬拜   歌曲  ' };
      },
      execFileP: async (...args) => {
        execCall = args;
        return { stdout: '"備援 敬拜標題"\n' };
      },
      resolveYtDlpPath: () => 'yt-dlp-test',
      spawnEnv: () => ({ NO_COLOR: '1' }),
      YOUTUBE_OEMBED_TIMEOUT_MS: 5_000,
      YOUTUBE_METADATA_TIMEOUT_MS: 15_000
    }
  );

  assert.deepEqual(plain(await functions.fetchYouTubeMetadata('https://youtu.be/abc123?si=share')), {
    title: '測試 敬拜 歌曲',
    url: 'https://youtu.be/abc123?si=share'
  });
  assert.match(requestedOEmbedUrl, /^https:\/\/www\.youtube\.com\/oembed\?/);
  assert.equal(execCall, null, 'yt-dlp should not run when oEmbed succeeds');

  oEmbedFails = true;
  assert.deepEqual(plain(await functions.fetchYouTubeMetadata('https://www.youtube.com/watch?v=xyz789')), {
    title: '備援 敬拜標題',
    url: 'https://www.youtube.com/watch?v=xyz789'
  });
  assert.equal(execCall[0], 'yt-dlp-test');
  assert.deepEqual(plain(execCall[1].slice(-2)), ['--', 'https://www.youtube.com/watch?v=xyz789']);
  assert.equal(execCall[2].timeout, 15_000);
  assert.equal(functions.sanitizeMediaTitle('x'.repeat(200)).length, 128);
  await assert.rejects(
    () => functions.fetchYouTubeMetadata('https://youtube.com.evil.example/watch?v=abc123'),
    /YouTube/
  );
});

test('advances directly to Scripture when the worship video finishes', () => {
  const videoListeners = {};
  const elements = {};
  const listenerElement = (listeners = {}) => ({
    addEventListener(type, handler) { listeners[type] = handler; },
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}
  });
  elements.worshipVideo = listenerElement(videoListeners);
  elements.wSeek = listenerElement();
  elements.wDur = { textContent: '' };
  elements.wCur = { textContent: '' };
  elements.worshipLoading = { textContent: '', classList: { add() {}, remove() {} } };
  elements.wPlay = listenerElement();
  elements.wBackTop = listenerElement();
  elements.wReturn = listenerElement();
  elements.worshipControls = listenerElement();
  const returns = [];
  const { setupWorshipControls } = loadFunctions(rendererSource, ['setupWorshipControls'], {
    $: (id) => elements[id],
    fmtTime: () => '0:00',
    setWorshipPlayState: () => {},
    sendNativeAudio: () => {},
    setWorshipPlaybackDesired: () => {},
    stopNativeWorshipAudio: () => {},
    backToCover: (options) => returns.push(plain(options)),
    toast: () => {},
    clearTimeout: () => {},
    showToolbar: () => {},
    resetWorshipSeekState: () => {},
    worshipActive: true,
    worshipControlsHovered: false,
    hideTimer: null
  });

  setupWorshipControls();
  videoListeners.ended();
  assert.deepEqual(returns, [{ nextAfterWorship: true }]);
});

test('previews Mac worship audio near the dragged seek position without queueing every input', async () => {
  const calls = [];
  const timers = [];
  const elements = { wCur: { textContent: '' } };
  const video = { duration: 120, currentTime: 0, paused: false };
  const seek = { value: '250' };
  const { updateWorshipSeek } = loadFunctions(
    rendererSource,
    [
      'loadNativeWorshipAudio',
      'worshipSeekPosition',
      'beginWorshipSeek',
      'runWorshipSeekPreview',
      'scheduleWorshipSeekPreview',
      'updateWorshipSeek'
    ],
    {
      $: (id) => elements[id],
      fmtTime: (value) => `${value}`,
      nativeAudioCommand: async (channel, action, payload) => {
        calls.push(`${channel}:${action}:${payload ? payload.position ?? '' : ''}`);
        return { ok: true };
      },
      markWorshipNativeAudioLoaded: () => {},
      setTimeout: (handler, delay) => {
        timers.push({ handler, delay });
        return timers.length;
      },
      USE_NATIVE_MAC_AUDIO: true,
      WORSHIP_SEEK_PREVIEW_MS: 120,
      currentWorshipAudioSrc: 'file:///cache/worship.m4a',
      worshipActive: true,
      worshipSeeking: false,
      worshipNativeAudioLoadInFlightPosition: null,
      worshipSeekResumeAfterCommit: false,
      worshipSeekCommitToken: 0,
      worshipSeekPreviewTimer: null,
      worshipSeekPreviewInFlight: false,
      worshipSeekPreviewPosition: null
    }
  );

  assert.equal(updateWorshipSeek(video, seek), true);
  assert.equal(video.currentTime, 30);
  assert.equal(elements.wCur.textContent, '30');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 120);
  assert.deepEqual(calls, []);
  await timers[0].handler();
  assert.deepEqual(calls, ['worship:load:30']);
});

test('ignores transient video pause while a playing worship seek should resume', () => {
  const videoListeners = {};
  const seekListeners = {};
  const elements = {};
  const listenerElement = (listeners = {}) => ({
    addEventListener(type, handler) { listeners[type] = handler; },
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}
  });
  elements.worshipVideo = listenerElement(videoListeners);
  elements.wSeek = listenerElement(seekListeners);
  elements.wDur = { textContent: '' };
  elements.wCur = { textContent: '' };
  elements.worshipLoading = { textContent: '', classList: { add() {}, remove() {} } };
  elements.wPlay = listenerElement();
  elements.wBackTop = listenerElement();
  elements.wReturn = listenerElement();
  elements.worshipControls = listenerElement();
  const playStates = [];
  const commands = [];
  const { setupWorshipControls } = loadFunctions(rendererSource, ['setupWorshipControls'], {
    $: (id) => elements[id],
    fmtTime: () => '0:00',
    setWorshipPlayState: (playing) => playStates.push(playing),
    sendNativeAudio: (channel, action) => commands.push(`${channel}:${action}`),
    backToCover: () => {},
    toast: () => {},
    clearTimeout: () => {},
    showToolbar: () => {},
    resetWorshipSeekState: () => {},
    worshipActive: true,
    worshipSeeking: true,
    worshipSeekResumeAfterCommit: true,
    worshipControlsHovered: false,
    hideTimer: null
  });

  setupWorshipControls();
  videoListeners.pause();
  assert.deepEqual(playStates, [true]);
  assert.deepEqual(commands, []);
});

test('commits a Mac worship seek by reloading native audio at the target time', async () => {
  const calls = [];
  const elements = {
    wCur: { textContent: '' },
    worshipLoading: { classList: { add: (name) => calls.push(`loading:${name}`) } }
  };
  const video = {
    duration: 100,
    currentTime: 0,
    paused: true,
    async play() {
      calls.push('video:play');
      this.paused = false;
    }
  };
  const seek = { value: '400' };
  const playStates = [];
  const { commitWorshipSeek } = loadFunctions(
    rendererSource,
    ['loadNativeWorshipAudio', 'clearWorshipSeekPreview', 'resetWorshipSeekState', 'worshipSeekPosition', 'commitWorshipSeek'],
    {
      $: (id) => elements[id],
      fmtTime: (value) => `${value}`,
      nativeAudioCommand: async (channel, action, payload) => {
        calls.push(`${channel}:${action}:${payload ? payload.position ?? '' : ''}`);
        return { ok: true };
      },
      clearTimeout: () => {},
      markWorshipNativeAudioLoaded: () => {},
      setWorshipPlaybackDesired: () => {},
      setWorshipPlayState: (playing) => playStates.push(playing),
      USE_NATIVE_MAC_AUDIO: true,
      currentWorshipAudioSrc: 'file:///cache/worship.m4a',
      worshipNativeAudioLoadInFlightPosition: null,
      worshipSeeking: true,
      worshipSeekResumeAfterCommit: true,
      worshipSeekCommitToken: 0,
      worshipSeekPreviewTimer: 1,
      worshipSeekPreviewPosition: 20
    }
  );

  assert.equal(await commitWorshipSeek(video, seek), true);
  assert.equal(video.currentTime, 40);
  assert.deepEqual(calls, ['worship:load:40', 'video:play', 'loading:hidden']);
  assert.deepEqual(playStates, [true]);
});

test('resumes Mac worship playback by reloading native audio instead of restarting a paused queue', async () => {
  const calls = [];
  const video = {
    currentTime: 73,
    async play() { calls.push('video:play'); }
  };
  const { resumeWorshipPlayback } = loadFunctions(
    rendererSource,
    ['loadNativeWorshipAudio', 'resumeWorshipPlayback'],
    {
      nativeAudioCommand: async (channel, action, payload) => {
        calls.push(`${channel}:${action}:${payload ? payload.position ?? '' : ''}`);
        return { ok: true };
      },
      markWorshipNativeAudioLoaded: () => {},
      setWorshipPlaybackDesired: () => {},
      USE_NATIVE_MAC_AUDIO: true,
      currentWorshipAudioSrc: 'file:///cache/worship.m4a',
      worshipNativeAudioLoadInFlightPosition: null
    }
  );

  await resumeWorshipPlayback(video);
  assert.deepEqual(calls, ['video:play', 'worship:load:73']);
});

test('schedules Mac worship recovery instead of stopping audio after an unexpected lifecycle pause', () => {
  const videoListeners = {};
  const elements = {};
  const listenerElement = (listeners = {}) => ({
    addEventListener(type, handler) { listeners[type] = handler; },
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}
  });
  elements.worshipVideo = listenerElement(videoListeners);
  elements.wSeek = listenerElement();
  elements.wDur = { textContent: '' };
  elements.wCur = { textContent: '' };
  elements.worshipLoading = { textContent: '', classList: { add() {}, remove() {} } };
  elements.wPlay = listenerElement();
  elements.wBackTop = listenerElement();
  elements.wReturn = listenerElement();
  elements.worshipControls = listenerElement();
  const playStates = [];
  const commands = [];
  const recoveries = [];
  const { setupWorshipControls } = loadFunctions(rendererSource, ['setupWorshipControls'], {
    $: (id) => elements[id],
    fmtTime: () => '0:00',
    setWorshipPlayState: (playing) => playStates.push(playing),
    sendNativeAudio: (channel, action) => commands.push(`${channel}:${action}`),
    stopNativeWorshipAudio: () => commands.push('worship:stop'),
    scheduleWorshipPlaybackRecovery: (reason) => { recoveries.push(reason); return true; },
    backToCover: () => {},
    toast: () => {},
    clearTimeout: () => {},
    showToolbar: () => {},
    resetWorshipSeekState: () => {},
    USE_NATIVE_MAC_AUDIO: true,
    worshipActive: true,
    worshipPlaybackDesired: true,
    worshipSeeking: false,
    worshipSeekResumeAfterCommit: false,
    worshipControlsHovered: false,
    hideTimer: null
  });

  setupWorshipControls();
  videoListeners.pause();
  assert.deepEqual(playStates, [true]);
  assert.deepEqual(commands, []);
  assert.deepEqual(recoveries, ['video-pause']);
});

test('recovers Mac worship audio at the current video time after renderer lifecycle wake', async () => {
  const calls = [];
  const video = {
    currentTime: 91,
    paused: true,
    async play() {
      calls.push('video:play');
      this.paused = false;
    }
  };
  const elements = {
    worshipVideo: video,
    worshipLoading: { classList: { add: (name) => calls.push(`loading:${name}`) } }
  };
  const { recoverWorshipPlayback } = loadFunctions(
    rendererSource,
    [
      'markWorshipNativeAudioLoaded',
      'recentlyLoadedWorshipNativeAudio',
      'loadNativeWorshipAudio',
      'clearWorshipPlaybackRecovery',
      'recoverWorshipPlayback'
    ],
    {
      $: (id) => elements[id],
      nativeAudioCommand: async (channel, action, payload) => {
        calls.push(`${channel}:${action}:${payload ? payload.position ?? '' : ''}`);
        return { ok: true };
      },
      setWorshipPlayState: (playing) => calls.push(`state:${playing}`),
      clearTimeout: (timer) => calls.push(`clear:${timer}`),
      USE_NATIVE_MAC_AUDIO: true,
      worshipActive: true,
      worshipPlaybackDesired: true,
      worshipSeeking: false,
      worshipPlaybackRecoveryTimer: 7,
      worshipPlaybackRecoveryInFlight: false,
      worshipRequestToken: 3,
      currentWorshipAudioSrc: 'file:///cache/worship.m4a',
      lastWorshipNativeAudioLoadAt: 0,
      lastWorshipNativeAudioLoadPosition: null,
      worshipNativeAudioLoadInFlightPosition: null,
      WORSHIP_RECENT_NATIVE_AUDIO_LOAD_MS: 700,
      WORSHIP_RECENT_NATIVE_AUDIO_POSITION_TOLERANCE: 1.5,
      window: { console: { debug() {} } }
    }
  );

  assert.equal(await recoverWorshipPlayback('test'), true);
  assert.deepEqual(calls, ['clear:7', 'video:play', 'worship:load:91', 'loading:hidden', 'state:true']);
});

test('covers worship with the Scripture surface before stopping video playback', async () => {
  const calls = [];
  const { backToCover } = loadFunctions(rendererSource, ['backToCover'], {
    flowStep: 'worship',
    flowNavigationToken: 0,
    flowTransitioning: false,
    flowLoading: false,
    showScriptureTransitionSurface: () => calls.push('show-scripture'),
    stopWorshipPlayback: () => calls.push('stop-worship'),
    goFlowStep: async (step) => { calls.push(`go-${step}`); return true; },
    returnToMainCover: async () => calls.push('cover')
  });

  await backToCover({ nextAfterWorship: true });
  assert.deepEqual(calls, ['show-scripture', 'stop-worship', 'go-scripture']);
});

test('only reveals worship chrome near the bottom or the top-left return area', () => {
  const controlsTarget = {};
  const hotzoneTarget = {};
  const backTarget = {};
  const backHotzoneTarget = {};
  const upperVideoTarget = {};
  let revealCalls = 0;
  const { handleToolbarPointerMove } = loadFunctions(
    rendererSource,
    ['handleToolbarPointerMove'],
    {
      worshipActive: true,
      $: (id) => ({
        contains: (target) => ({
          worshipControls: controlsTarget,
          worshipHotzone: hotzoneTarget,
          wBackTop: backTarget,
          worshipBackHotzone: backHotzoneTarget
        })[id] === target
      }),
      showToolbar: () => { revealCalls++; }
    }
  );

  handleToolbarPointerMove({ target: upperVideoTarget });
  assert.equal(revealCalls, 0, 'ordinary movement over the video should stay unobtrusive');
  handleToolbarPointerMove({ target: hotzoneTarget });
  handleToolbarPointerMove({ target: controlsTarget });
  handleToolbarPointerMove({ target: backHotzoneTarget });
  handleToolbarPointerMove({ target: backTarget });
  assert.equal(revealCalls, 4, 'bottom and top-left worship controls should reveal together');
});

test('keeps worship controls visible while hovered and otherwise hides them after one second', () => {
  const runScenario = (hovered) => {
    const visible = new Set();
    let timer = null;
    let delay = null;
    const elements = {
      toolbar: {
        classList: {
          add: (name) => visible.add(`toolbar:${name}`),
          remove: (name) => visible.delete(`toolbar:${name}`)
        }
      },
      worshipControls: {
        classList: {
          add: (name) => visible.add(`worship:${name}`),
          remove: (name) => visible.delete(`worship:${name}`)
        }
      },
      wBackTop: {
        classList: {
          add: (name) => visible.add(`back:${name}`),
          remove: (name) => visible.delete(`back:${name}`)
        }
      },
      settingsPanel: { classList: { contains: (name) => name === 'hidden' } }
    };
    const { showToolbar } = loadFunctions(rendererSource, ['showToolbar'], {
      $: (id) => elements[id],
      worshipActive: true,
      worshipControlsHovered: hovered,
      hideTimer: null,
      MAIN_TOOLBAR_HIDE_MS: 2200,
      WORSHIP_CONTROLS_HIDE_MS: 1000,
      clearTimeout: () => {},
      setTimeout: (callback, milliseconds) => {
        timer = callback;
        delay = milliseconds;
        return 1;
      }
    });

    showToolbar();
    assert.equal(visible.has('worship:show'), true);
    assert.equal(visible.has('back:show'), true);
    timer();
    return {
      delay,
      controlsVisible: visible.has('worship:show'),
      backVisible: visible.has('back:show')
    };
  };

  assert.deepEqual(runScenario(true), { delay: 1000, controlsVisible: true, backVisible: true });
  assert.deepEqual(runScenario(false), { delay: 1000, controlsVisible: false, backVisible: false });
});

test('reveals the cover toolbar only near the bottom and keeps it while hovered', () => {
  const toolbarTarget = {};
  const middleTarget = {};
  let revealCalls = 0;
  const toolbar = { contains: (target) => target === toolbarTarget };
  const elements = { toolbar };
  const { handleToolbarPointerMove } = loadFunctions(
    rendererSource,
    ['pointerCoordinate', 'coverToolbarHotzoneHeight', 'shouldRevealCoverToolbarFromPointer', 'handleToolbarPointerMove'],
    {
      $: (id) => elements[id],
      window: { innerHeight: 720 },
      worshipActive: false,
      MAIN_TOOLBAR_HOTZONE_RATIO: 0.16,
      MAIN_TOOLBAR_HOTZONE_MIN: 72,
      MAIN_TOOLBAR_HOTZONE_MAX: 150,
      showToolbar: () => { revealCalls++; }
    }
  );

  handleToolbarPointerMove({ clientY: 320, target: middleTarget });
  assert.equal(revealCalls, 0, 'middle movement should not reveal the cover toolbar');
  handleToolbarPointerMove({ clientY: 650, target: middleTarget });
  assert.equal(revealCalls, 1, 'bottom hotzone should reveal the cover toolbar');
  handleToolbarPointerMove({ clientY: 320, target: toolbarTarget });
  assert.equal(revealCalls, 2, 'hovering the visible toolbar should keep it active');
});

test('keeps the cover toolbar visible while hovered and otherwise hides it after one second', () => {
  const runScenario = (hovered) => {
    const visible = new Set();
    let timer = null;
    let delay = null;
    const elements = {
      toolbar: {
        classList: {
          add: (name) => visible.add(`toolbar:${name}`),
          remove: (name) => visible.delete(`toolbar:${name}`)
        }
      },
      flowScreen: { classList: { contains: (name) => name === 'hidden' } },
      worshipControls: { classList: { add() {}, remove() {} } },
      wBackTop: { classList: { add() {}, remove() {} } },
      settingsPanel: { classList: { contains: (name) => name === 'hidden' } }
    };
    const { showToolbar } = loadFunctions(rendererSource, ['showToolbar'], {
      $: (id) => elements[id],
      worshipActive: false,
      mainToolbarHovered: hovered,
      worshipControlsHovered: false,
      hideTimer: null,
      MAIN_TOOLBAR_HIDE_MS: 1000,
      WORSHIP_CONTROLS_HIDE_MS: 1000,
      clearTimeout: () => {},
      setTimeout: (callback, milliseconds) => {
        timer = callback;
        delay = milliseconds;
        return 1;
      }
    });

    showToolbar();
    assert.equal(visible.has('toolbar:show'), true);
    timer();
    return { delay, toolbarVisible: visible.has('toolbar:show') };
  };

  assert.deepEqual(runScenario(true), { delay: 1000, toolbarVisible: true });
  assert.deepEqual(runScenario(false), { delay: 1000, toolbarVisible: false });
});

test('keeps only the song name when YouTube metadata identifies artist, album or format labels', async () => {
  const names = [
    'sanitizeMediaTitle',
    'stripWorshipTitleNoise',
    'worshipTitleIdentity',
    'worshipMetadataPart',
    'inferWorshipSongTitle'
  ];
  const functions = loadFunctions(mainSource, names);

  assert.deepEqual(plain(functions.inferWorshipSongTitle({
    title: '讚美之泉 Stream of Praise - 美好的創造 (Official MV)',
    authorName: '讚美之泉 Stream of Praise'
  })), { title: '美好的創造', confident: true });
  assert.deepEqual(plain(functions.inferWorshipSongTitle({
    title: '【美好的創造 Beautifully Made】官方歌詞版MV (Official Lyrics MV) - 讚美之泉敬拜讚美 (22)',
    uploader: '讚美之泉 Stream Of Praise Music Ministries'
  })), { title: '美好的創造 Beautifully Made', confident: true });
  assert.deepEqual(plain(functions.inferWorshipSongTitle({
    title: 'Goodness of God (Lyrics) - Bethel Music',
    uploader: 'Bethel Music'
  })), { title: 'Goodness of God', confident: true });
  assert.deepEqual(plain(functions.inferWorshipSongTitle({
    title: '依然愛我｜盛曉玫《幸福》專輯',
    artist: '盛曉玫',
    album: '幸福'
  })), { title: '依然愛我', confident: true });
  assert.deepEqual(plain(functions.inferWorshipSongTitle({
    title: '依然愛我 You still love me 盛曉玫 Amy Sand 泥土音樂專輯 8：不變的愛',
    uploader: '泥土音樂Clay Music'
  })), { title: '依然愛我', confident: true });
  assert.deepEqual(plain(functions.inferWorshipSongTitle({
    title: '幸福/ Blessed, 盛曉玫 / Amy Sand, 泥土音樂專輯 6：幸福',
    uploader: '泥土音樂Clay Music'
  })), { title: '幸福', confident: true });
  assert.deepEqual(plain(functions.inferWorshipSongTitle({
    title: '歌名 - 特別版本',
    track: '真正歌名（2026 重製版）',
    artist: '歌手'
  })), { title: '真正歌名（2026 重製版）', confident: true });
  assert.deepEqual(plain(functions.inferWorshipSongTitle({
    title: '祢愛永不止息 - Acoustic Version'
  })), { title: '祢愛永不止息 - Acoustic Version', confident: false }, 'ambiguous punctuation must be preserved');
  assert.equal(functions.stripWorshipTitleNoise('【敬拜讚美】新的事將要成就【官方動態歌詞】'), '新的事將要成就');
});

test('asks yt-dlp for structured song metadata only when oEmbed is ambiguous', async () => {
  let execArgs = null;
  const functions = loadFunctions(
    mainSource,
    [
      'normalizeMediaRequest',
      'sanitizeMediaTitle',
      'stripWorshipTitleNoise',
      'worshipTitleIdentity',
      'worshipMetadataPart',
      'inferWorshipSongTitle',
      'parseYtDlpWorshipMetadata',
      'fetchYtDlpWorshipMetadata',
      'fetchYouTubeMetadata'
    ],
    {
      httpGetJson: async () => ({ title: '歌手 - 原始影片標題 - 專輯', author_name: '不相同的頻道' }),
      execFileP: async (...args) => {
        execArgs = args;
        return { stdout: JSON.stringify({
          title: '歌手 - 原始影片標題 - 專輯',
          track: '原始影片標題',
          artist: '歌手',
          album: '專輯',
          uploader: '官方頻道'
        }) };
      },
      resolveYtDlpPath: () => 'yt-dlp-test',
      spawnEnv: () => ({ NO_COLOR: '1' }),
      YOUTUBE_OEMBED_TIMEOUT_MS: 5_000,
      YOUTUBE_METADATA_TIMEOUT_MS: 15_000
    }
  );

  assert.deepEqual(plain(await functions.fetchYouTubeMetadata('https://youtu.be/abc123')), {
    title: '原始影片標題',
    url: 'https://youtu.be/abc123'
  });
  assert.ok(execArgs, 'ambiguous oEmbed title should request structured metadata');
  assert.ok(execArgs[1].includes('%(.{title,track,artist,album,uploader,channel})j'));
});

test('validates custom worship presets with the same YouTube policy', () => {
  const { normalizeCustomWorshipUrl } = loadFunctions(rendererSource, ['normalizeCustomWorshipUrl']);

  assert.equal(
    normalizeCustomWorshipUrl('https://youtu.be/abc'),
    'https://youtu.be/abc'
  );
  assert.equal(normalizeCustomWorshipUrl('http://youtube.com/watch?v=abc'), '');
  assert.equal(normalizeCustomWorshipUrl('https://youtube.com.evil.example/watch?v=abc'), '');
  assert.equal(normalizeCustomWorshipUrl('https://example.com/video'), '');
});

test('does not let a slow title lookup overwrite a newer custom worship URL', async () => {
  const pending = new Map();
  const elements = {
    inCustomWorshipUrl: { value: '' },
    inCustomWorshipTitle: { value: '', dataset: {} }
  };
  const functions = loadFunctions(
    rendererSource,
    [
      'youtubeVideoId',
      'normalizeWorshipTitle',
      'meaningfulWorshipTitle',
      'sameWorshipUrl',
      'normalizeCustomWorshipUrl',
      'prepareWorshipTitleDraft',
      'prefillCustomWorshipTitle'
    ],
    {
      $: (id) => elements[id],
      customWorshipTitleRequestToken: 0,
      lookupWorshipTitle: (url) => new Promise((resolve) => pending.set(url, resolve))
    }
  );

  elements.inCustomWorshipUrl.value = 'https://youtu.be/first11';
  const first = functions.prefillCustomWorshipTitle();
  elements.inCustomWorshipUrl.value = 'https://youtu.be/second22';
  const second = functions.prefillCustomWorshipTitle();

  pending.get('https://youtu.be/second22').call(null, '第二首歌');
  await second;
  assert.equal(elements.inCustomWorshipTitle.value, '第二首歌');
  assert.equal(elements.inCustomWorshipTitle.dataset.url, 'https://youtu.be/second22');

  pending.get('https://youtu.be/first11').call(null, '第一首歌');
  await first;
  assert.equal(elements.inCustomWorshipTitle.value, '第二首歌');
});

test('does not add or clear a newer custom worship draft after a stale lookup', async () => {
  let resolveLookup;
  const cfg = { customWorshipPresets: [] };
  const elements = {
    inCustomWorshipUrl: { value: 'https://youtu.be/first11' },
    inCustomWorshipTitle: { value: '', dataset: {}, focus() {} },
    btnAddWorshipPreset: { textContent: '加入', disabled: false }
  };
  const functions = loadFunctions(
    rendererSource,
    [
      'youtubeVideoId',
      'normalizeWorshipTitle',
      'meaningfulWorshipTitle',
      'sameWorshipUrl',
      'normalizeCustomWorshipUrl',
      'customWorshipPresets',
      'addCustomWorshipPreset'
    ],
    {
      cfg,
      $: (id) => elements[id],
      customWorshipTitleRequestToken: 0,
      lookupWorshipTitle: () => new Promise((resolve) => { resolveLookup = resolve; }),
      renderCustomWorshipPresets() {},
      applyWorshipMode() {},
      collectSettings() {},
      toast() {},
      window: { api: { setConfig: async () => {} } }
    }
  );

  const add = functions.addCustomWorshipPreset();
  elements.inCustomWorshipUrl.value = 'https://youtu.be/second22';
  elements.inCustomWorshipTitle.value = '第二首歌';
  resolveLookup('第一首歌');
  await add;

  assert.deepEqual(cfg.customWorshipPresets, []);
  assert.equal(elements.inCustomWorshipUrl.value, 'https://youtu.be/second22');
  assert.equal(elements.inCustomWorshipTitle.value, '第二首歌');
});

test('keeps an active inline worship-title draft when metadata arrives', () => {
  const cfg = {
    customWorshipPresets: [{ title: '自訂敬拜影片', url: 'https://youtu.be/first11' }]
  };
  const input = { value: '我正在編輯的歌名' };
  const option = { textContent: '自訂敬拜影片' };
  const elements = {
    customWorshipList: { querySelector: () => input },
    customWorshipGroup: { querySelector: () => option }
  };
  const functions = loadFunctions(
    rendererSource,
    [
      'normalizeWorshipTitle',
      'meaningfulWorshipTitle',
      'customWorshipPresets',
      'customWorshipTitleEditor',
      'updateCustomWorshipPresetTitle'
    ],
    {
      cfg,
      $: (id) => elements[id],
      document: { activeElement: input }
    }
  );

  const title = functions.updateCustomWorshipPresetTitle(0, 'YouTube 自動歌名', true);
  assert.equal(title, '我正在編輯的歌名');
  assert.equal(cfg.customWorshipPresets[0].title, '我正在編輯的歌名');
  assert.equal(input.value, '我正在編輯的歌名');
  assert.equal(option.textContent, '我正在編輯的歌名');
});

test('never combines a stale metadata result with a newer worship URL', async () => {
  const firstUrl = 'https://youtu.be/first11';
  const secondUrl = 'https://youtu.be/second22';
  const cfg = {
    useWorshipPreset: false,
    worshipUrl: firstUrl,
    worshipTitle: '',
    worshipTitleUrl: '',
    customWorshipPresets: []
  };
  const elements = {
    inWorshipUrl: { value: firstUrl },
    inWorshipTitle: { value: '', dataset: {} }
  };
  let lookupImplementation;
  let saveResolve = null;
  let delaySave = false;
  const document = { getElementById: () => ({ options: [], selectedOptions: [] }) };
  const functions = loadFunctions(
    rendererSource,
    [
      'youtubeVideoId',
      'normalizeWorshipTitle',
      'meaningfulWorshipTitle',
      'sameWorshipUrl',
      'worshipOptionAnnouncementTitle',
      'selectedCustomWorshipPresetIndex',
      'currentWorshipAnnouncement',
      'ensureCurrentWorshipAnnouncementTitle'
    ],
    {
      cfg,
      document,
      $: (id) => elements[id],
      lookupWorshipTitle: (url) => lookupImplementation(url),
      customWorshipPresets: () => cfg.customWorshipPresets,
      updateCustomWorshipPresetTitle: () => '',
      toast() {},
      window: {
        api: {
          setConfig: async () => {
            if (!delaySave) return;
            await new Promise((resolve) => { saveResolve = resolve; });
          }
        }
      }
    }
  );

  let failLookup;
  lookupImplementation = () => new Promise((resolve) => { failLookup = resolve; });
  const failedRequest = functions.ensureCurrentWorshipAnnouncementTitle();
  cfg.worshipUrl = secondUrl;
  cfg.worshipTitle = '第二首歌';
  cfg.worshipTitleUrl = secondUrl;
  failLookup('');
  assert.deepEqual(plain(await failedRequest), { title: '第二首歌', url: secondUrl });

  cfg.worshipUrl = firstUrl;
  cfg.worshipTitle = '';
  cfg.worshipTitleUrl = firstUrl;
  elements.inWorshipUrl.value = firstUrl;
  elements.inWorshipTitle.value = '';
  lookupImplementation = async () => '第一首歌';
  delaySave = true;
  const savingRequest = functions.ensureCurrentWorshipAnnouncementTitle();
  while (!saveResolve) await new Promise((resolve) => setImmediate(resolve));
  cfg.worshipUrl = secondUrl;
  cfg.worshipTitle = '第二首歌';
  cfg.worshipTitleUrl = secondUrl;
  elements.inWorshipUrl.value = secondUrl;
  elements.inWorshipTitle.value = '第二首歌';
  saveResolve();
  assert.deepEqual(plain(await savingRequest), { title: '第二首歌', url: secondUrl });
});

test('does not mistake interrupted download fragments for final cache files', () => {
  const { isIncompleteCacheName } = loadFunctions(mainSource, ['isIncompleteCacheName']);

  for (const incomplete of [
    'video_hash.mp4.part',
    'video_hash.webm.ytdl',
    'video_hash.mp4.download',
    'video_hash.f137.webm',
    'video_hash.f140.m4a.part'
  ]) {
    assert.equal(isIncompleteCacheName(incomplete), true, incomplete);
  }
  assert.equal(isIncompleteCacheName('video_hash.mp4'), false);
  assert.equal(isIncompleteCacheName('audio_hash.m4a'), false);
});

test('keeps video quality variants in separate cache entries', () => {
  const { cacheKey } = loadFunctions(mainSource, ['cacheKey'], { crypto });
  const url = 'https://www.youtube.com/watch?v=abc';

  assert.notEqual(cacheKey(url, 'video', 720), cacheKey(url, 'video', 1080));
  assert.equal(cacheKey(url, 'audio', 720), cacheKey(url, 'audio', 1080));
});

test('builds the announcement from the renderer implementation and current config', () => {
  const cfg = {
    dateAuto: true,
    zoomUrl: 'https://us06web.zoom.us/j/77730692079?pwd=EbYm30dRERJb8FI3GRHadpkqdNLfE4.1',
    scriptureBook: '提摩太後書',
    scriptureStartCh: 3,
    scriptureStartV: 1,
    scriptureEndCh: 3,
    scriptureEndV: 17,
    useWorshipPreset: true,
    worshipPreset: 'https://youtu.be/stalePreset1',
    worshipUrl: 'https://youtu.be/7mrMh_2tXCI?si=xiVMJ-2zx56L9oeW',
    customWorshipPresets: [{
      title: '讚美之泉（美好的創造）',
      url: 'https://www.youtube.com/watch?v=7mrMh_2tXCI'
    }]
  };
  const functions = loadFunctions(
    rendererSource,
    [
      'parseZoomUrl',
      'todayCNDate',
      'chineseChapterNumber',
      'formatScriptureAnnouncementRef',
      'youtubeVideoId',
      'normalizeWorshipTitle',
      'meaningfulWorshipTitle',
      'sameWorshipUrl',
      'worshipOptionAnnouncementTitle',
      'selectedCustomWorshipPresetIndex',
      'currentWorshipAnnouncement',
      'buildAnnounceText'
    ],
    {
      cfg,
      CN_WEEKDAYS: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
      ZOOM_MEETING_PASSCODE: '52141425',
      ZOOM_PASSCODE_HINT: '我愛耶穌耶穌愛我'
    }
  );
  const announcement = functions.buildAnnounceText(new Date(2026, 6, 17, 9, 0, 0));

  assert.equal(announcement, [
    '親愛的活水家人們，早安，',
    '今天是7月17日星期五。',
    '',
    '請預備大家的聖經',
    '【聖經】提摩太後書三：1-17',
    '【竭誠獻上】',
    '',
    '主題: 早靈修班',
    '時間: 週二-周五 8:30 am',
    '',
    '加入 Zoom 會議',
    'https://us06web.zoom.us/j/77730692079?pwd=EbYm30dRERJb8FI3GRHadpkqdNLfE4.1',
    '',
    '蘋果電腦平板手機，',
    '請手動輸入帳號密碼喔！',
    '帳號：777 3069 2079',
    '密碼：52141425',
    '(我愛耶穌耶穌愛我）',
    '',
    '敬拜詩歌：讚美之泉（美好的創造）',
    'https://youtu.be/7mrMh_2tXCI?si=xiVMJ-2zx56L9oeW'
  ].join('\n'));
});

test('formats manual announcement dates and Chinese scripture chapter numbers', () => {
  const cfg = {
    dateAuto: false,
    dateManual: '7/18',
    scriptureBook: '詩篇',
    scriptureStartCh: 119,
    scriptureStartV: 105,
    scriptureEndCh: 119,
    scriptureEndV: 106
  };
  const functions = loadFunctions(
    rendererSource,
    ['todayCNDate', 'chineseChapterNumber', 'formatScriptureAnnouncementRef'],
    {
      cfg,
      CN_WEEKDAYS: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
    }
  );

  assert.equal(functions.todayCNDate(new Date(2026, 0, 1)), '7月18日星期六');
  assert.equal(functions.chineseChapterNumber(10), '十');
  assert.equal(functions.chineseChapterNumber(105), '一百零五');
  assert.equal(functions.chineseChapterNumber(119), '一百一十九');
  assert.equal(functions.formatScriptureAnnouncementRef(), '詩篇一百一十九：105-106');
  cfg.scriptureBook = '創世記';
  cfg.scriptureStartCh = 3;
  cfg.scriptureStartV = 17;
  cfg.scriptureEndCh = 4;
  cfg.scriptureEndV = 2;
  assert.equal(functions.formatScriptureAnnouncementRef(), '創世記三：17-四：2');
});

test('resolves worship announcement titles by YouTube video id and ignores empty options', () => {
  const cfg = {
    useWorshipPreset: false,
    worshipUrl: 'https://youtu.be/7mrMh_2tXCI?si=current-share',
    worshipPreset: '',
    customWorshipPresets: []
  };
  const select = {
    options: [
      { value: '', textContent: '選擇敬拜影片' },
      {
        value: 'https://www.youtube.com/watch?v=7mrMh_2tXCI&list=example',
        textContent: '讚美之泉（美好的創造）'
      }
    ],
    selectedOptions: []
  };
  const document = { getElementById: () => select };
  const functions = loadFunctions(
    rendererSource,
    ['youtubeVideoId', 'normalizeWorshipTitle', 'meaningfulWorshipTitle', 'sameWorshipUrl',
      'worshipOptionAnnouncementTitle', 'selectedCustomWorshipPresetIndex', 'currentWorshipAnnouncement'],
    { cfg, document }
  );

  assert.equal(functions.youtubeVideoId(cfg.worshipUrl), '7mrMh_2tXCI');
  assert.deepEqual(plain(functions.currentWorshipAnnouncement()), {
    title: '讚美之泉（美好的創造）',
    url: cfg.worshipUrl
  });

  cfg.worshipTitle = '今天要顯示的自訂歌名';
  cfg.worshipTitleUrl = 'https://www.youtube.com/watch?v=7mrMh_2tXCI';
  assert.deepEqual(plain(functions.currentWorshipAnnouncement()), {
    title: '今天要顯示的自訂歌名',
    url: cfg.worshipUrl
  }, 'manual announcement title must override a matching built-in option');

  cfg.worshipUrl = '';
  cfg.worshipPreset = 'https://youtu.be/old-selection';
  cfg.worshipTitle = '不應套用到空網址';
  assert.deepEqual(plain(functions.currentWorshipAnnouncement()), { title: '', url: '' });

  cfg.worshipUrl = 'https://youtu.be/manual123?si=today';
  cfg.worshipTitle = '自行加入的敬拜歌曲';
  cfg.worshipTitleUrl = 'https://www.youtube.com/watch?v=manual123';
  assert.deepEqual(plain(functions.currentWorshipAnnouncement()), {
    title: '自行加入的敬拜歌曲',
    url: cfg.worshipUrl
  });

  cfg.worshipUrl = 'https://youtu.be/different1';
  assert.deepEqual(plain(functions.currentWorshipAnnouncement()), {
    title: '',
    url: cfg.worshipUrl
  }, 'a title saved for another URL must not leak into today\'s announcement');

  cfg.worshipTitle = '';
  cfg.worshipTitleUrl = '';
  cfg.customWorshipPresets = [{ title: '自訂敬拜影片 1', url: cfg.worshipUrl }];
  assert.deepEqual(plain(functions.currentWorshipAnnouncement()), {
    title: '',
    url: cfg.worshipUrl
  }, 'legacy placeholder titles should be treated as unresolved');

  cfg.useWorshipPreset = true;
  cfg.worshipUrl = 'https://youtu.be/duplicate1?si=selected';
  cfg.customWorshipPresets = [
    { title: '另一筆已有的歌名', url: 'https://youtu.be/duplicate1?si=older' },
    { title: '自訂敬拜影片 2', url: cfg.worshipUrl }
  ];
  const selectedPlaceholder = {
    value: cfg.worshipUrl,
    textContent: '自訂敬拜影片 2',
    dataset: { index: '1' },
    selected: true
  };
  select.options = [selectedPlaceholder];
  select.selectedOptions = [selectedPlaceholder];
  assert.deepEqual(plain(functions.currentWorshipAnnouncement()), {
    title: '',
    url: cfg.worshipUrl
  }, 'a selected legacy duplicate must not borrow another preset title');
});

test('keeps every built-in worship announcement title paired with the video that will play', () => {
  const expectedTitles = new Map([
    ['7mrMh_2tXCI', '讚美之泉（美好的創造）'],
    ['v76-wz1mv8w', '讚美之泉（祢的恩典夠我用）'],
    ['mVqSmWIjoZU', '讚美之泉（好喜歡與你在一起）'],
    ['kvrRtRe9AoU', '讚美之泉（我們的神）'],
    ['uSHI-9s4dTU', '盛曉玫（依然愛我）'],
    ['lfP-3JLVvaw', '盛曉玫（活出愛）'],
    ['Q3m-in8i6FU', '盛曉玫（幸福）'],
    ['96WDXhk6qjU', '盛曉玫（有一天）'],
    ['eGAeeQxZ6FM', '盛曉玫（因為祢）'],
    ['KqlvbYd5uJA', '新店行道會（叫我抬起頭的神）'],
    ['v-k7ojwYE08', '新店行道會（這裡有榮耀）']
  ]);
  const options = Array.from(
    rendererHtml.matchAll(/<option\s+value="([^"]+)"\s+data-announcement-title="([^"]+)">([^<]+)<\/option>/g),
    (match) => ({
      value: match[1],
      dataset: { announcementTitle: match[2] },
      textContent: match[3],
      selected: false
    })
  );
  assert.equal(options.length, expectedTitles.size, 'unexpected number of titled built-in worship options');

  const cfg = { useWorshipPreset: true, worshipUrl: '', customWorshipPresets: [] };
  const select = { options, selectedOptions: [] };
  const document = { getElementById: (id) => id === 'worshipPreset' ? select : null };
  const functions = loadFunctions(
    rendererSource,
    ['youtubeVideoId', 'normalizeWorshipTitle', 'meaningfulWorshipTitle', 'sameWorshipUrl',
      'worshipOptionAnnouncementTitle', 'selectedCustomWorshipPresetIndex', 'currentWorshipAnnouncement'],
    { cfg, document }
  );

  for (const option of options) {
    const videoId = functions.youtubeVideoId(option.value);
    assert.ok(expectedTitles.has(videoId), `unexpected worship video id ${videoId}`);
    cfg.worshipUrl = option.value;
    cfg.customWorshipPresets = [{
      title: '不應覆蓋今天選取歌曲的舊名稱',
      url: `https://www.youtube.com/watch?v=${videoId}`
    }];
    select.selectedOptions = [option];
    assert.deepEqual(plain(functions.currentWorshipAnnouncement()), {
      title: expectedTitles.get(videoId),
      url: option.value
    });

    cfg.useWorshipPreset = false;
    select.selectedOptions = [];
    assert.deepEqual(plain(functions.currentWorshipAnnouncement()), {
      title: expectedTitles.get(videoId),
      url: option.value
    }, `manual URL mode used a stale custom title for ${videoId}`);
    cfg.useWorshipPreset = true;
  }
});

test('parses scripture verses across chapter boundaries without losing chapter identity', () => {
  const { parseScriptureVerses } = loadFunctions(
    rendererSource,
    ['parseScriptureVerses'],
    {
      window: {
        BIBLE: [{ n: '測試書', v: [31, 25] }]
      }
    }
  );
  const ref = { book: '測試書', startCh: 1, startV: 30, endCh: 2, endV: 2 };
  const verses = plain(parseScriptureVerses(
    '30 第一章第三十節\n31 第一章第三十一節\n1 第二章第一節\n2 第二章第二節',
    ref
  ));

  assert.deepEqual(
    verses.map(({ chapter, number }) => [chapter, number]),
    [[1, 30], [1, 31], [2, 1], [2, 2]]
  );
  assert.deepEqual(
    verses.map(({ startsChapter }) => startsChapter),
    [false, false, true, false]
  );
  assert.deepEqual(
    verses.map(({ continuation }) => continuation),
    [false, false, false, false]
  );
  assert.equal(new Set(verses.map(({ key }) => key)).size, verses.length);

  // If an upstream passage omits intervening verses, matching must search
  // forward by verse number instead of assigning chapters positionally.
  const withMissingVerses = plain(parseScriptureVerses(
    '30 第一章第三十節\n2 第二章第二節',
    ref
  ));
  assert.deepEqual(
    withMissingVerses.map(({ chapter, number }) => [chapter, number]),
    [[1, 30], [2, 2]]
  );
  assert.equal(withMissingVerses[1].startsChapter, true);

  const withStandaloneChapterMarker = plain(parseScriptureVerses(
    '30 第一章第三十節\n31 第一章第三十一節 2\n1 第二章第一節\n2 第二章第二節',
    ref
  ));
  assert.equal(withStandaloneChapterMarker[1].text, '第一章第三十一節');
  assert.deepEqual(
    withStandaloneChapterMarker.map(({ chapter, number }) => [chapter, number]),
    [[1, 30], [1, 31], [2, 1], [2, 2]]
  );
});

test('does not render a leading chapter number as the first verse number', () => {
  const { normalizeBibleLeadingReferenceLine } = loadFunctions(
    mainSource,
    ['normalizeBibleLeadingReferenceLine']
  );
  const ref = { book: '約翰福音', startCh: 4, startV: 1, endCh: 4, endV: 2 };
  assert.equal(normalizeBibleLeadingReferenceLine('4 1 第一節內容', ref, true), '1 第一節內容');
  assert.equal(normalizeBibleLeadingReferenceLine('4 第一節內容', ref, true), '1 第一節內容');
  assert.equal(normalizeBibleLeadingReferenceLine('4 1 第一節內容', ref, false), '4 1 第一節內容');

  const { parseScriptureVerses } = loadFunctions(
    rendererSource,
    ['parseScriptureVerses'],
    { window: { BIBLE: [{ n: '約翰福音', v: [51, 25, 36, 54] }] } }
  );
  const verses = plain(parseScriptureVerses('4 1 第一節內容\n2 第二節內容', ref));
  assert.deepEqual(verses.map(({ chapter, number, text }) => [chapter, number, text]), [
    [4, 1, '第一節內容'],
    [4, 2, '第二節內容']
  ]);
  const chapterNumberOnly = plain(parseScriptureVerses('4 第一節內容\n2 第二節內容', ref));
  assert.deepEqual(chapterNumberOnly.map(({ chapter, number, text }) => [chapter, number, text]), [
    [4, 1, '第一節內容'],
    [4, 2, '第二節內容']
  ]);
});

test('fills each Scripture page to measured capacity before starting the next', () => {
  const measuredCapacity = 9;
  const pageFits = (verses) => verses.length <= measuredCapacity;
  const { buildScripturePagesByFit } = loadScripturePaginationFunctions(pageFits);
  const verseCounts = [6, 7, 8, 9, 10, 14, 19, 25];

  for (const verseCount of verseCounts) {
    const input = scriptureFixture(verseCount);
    const pages = plain(buildScripturePagesByFit(input));
    const distribution = pages.map((page) => new Set(page.verses.map((verse) => verse.key)).size);
    assert.equal(pages.length, Math.ceil(verseCount / measuredCapacity), `${verseCount} verses used extra pages`);
    assert.ok(distribution.every((count) => count <= measuredCapacity), `${verseCount} verses exceeds measured capacity`);
    assert.ok(
      distribution.slice(0, -1).every((count) => count === measuredCapacity),
      `${verseCount} verses left avoidable space before the final page: ${distribution.join(', ')}`
    );
    assert.deepEqual(
      pages.flatMap((page) => page.verses.map((verse) => verse.key)),
      input.map((verse) => verse.key),
      `${verseCount} verses changed order or content membership`
    );
  }
});

test('obeys measured scripture capacity even on a small viewport', () => {
  const pageFits = (verses) => verses.length <= 3;
  const { buildScripturePagesByFit } = loadScripturePaginationFunctions(pageFits);
  const input = scriptureFixture(8);
  const pages = plain(buildScripturePagesByFit(input));

  assert.deepEqual(pages.map((page) => page.verses.length), [3, 3, 2]);
  assert.ok(pages.every((page) => page.verses.length <= 3));
  assert.deepEqual(
    pages.flatMap((page) => page.verses.map((verse) => verse.key)),
    input.map((verse) => verse.key)
  );
});

test('keeps reader assignments visible without forcing extra reader-boundary pages', () => {
  const pageFits = (verses) => verses.length <= 5;
  const { buildScripturePagesByFit } = loadScripturePaginationFunctions(pageFits);
  const input = scriptureFixture(22);
  const segments = scriptureSegments(
    { book: '測試書', startCh: 1, startV: 1, endCh: 1, endV: 22 },
    [{ n: '測試書', v: [22] }]
  );
  const pages = plain(buildScripturePagesByFit(input, pageFits, segments));

  assert.deepEqual(segments.map((segment) => segment.label), ['1–5 節', '6–10 節', '11–16 節', '17–22 節']);
  assert.deepEqual(pages.map((page) => page.verses.map((verse) => verse.number)), [
    [1, 2, 3, 4, 5],
    [6, 7, 8, 9, 10],
    [11, 12, 13, 14, 15],
    [16, 17, 18, 19, 20],
    [21, 22]
  ]);
  assert.deepEqual(pages[2].readerMarkers.map((marker) => marker.label), ['第 3 位・11–16 節']);
  assert.deepEqual(pages[3].readerMarkers.map((marker) => marker.label), [
    '第 3 位・11–16 節（續）',
    '第 4 位・17–22 節'
  ]);
  assert.deepEqual(pages[4].readerMarkers.map((marker) => marker.label), ['第 4 位・17–22 節（續）']);
  assert.equal(pages[3].verses[0].readerIndex, 3);
  assert.equal(pages[3].verses[1].readerIndex, 4);
  assert.equal(pages.length, 5, 'reader boundaries must not create extra visual pages');
  assert.ok(pages.every((page) => new Set(page.verses.map((verse) => verse.key)).size <= 5));
});

test('uses full chapter references when a reader segment itself crosses chapters', () => {
  const pageFits = (verses) => verses.length <= 2;
  const { buildScripturePagesByFit } = loadScripturePaginationFunctions(pageFits);
  const input = [
    ...scriptureFixture(2).map((verse, index) => ({ ...verse, chapter: 1, number: 30 + index, key: `1:${30 + index}:${index}` })),
    ...scriptureFixture(5).map((verse, index) => ({ ...verse, chapter: 2, number: index + 1, key: `2:${index + 1}:${index + 2}` }))
  ];
  const segments = scriptureSegments(
    { book: '測試書', startCh: 1, startV: 30, endCh: 2, endV: 5 },
    [{ n: '測試書', v: [31, 25] }]
  );
  const pages = plain(buildScripturePagesByFit(input, pageFits, segments));

  assert.deepEqual(segments.map((segment) => segment.label), ['1:30–2:1', '2:2–5']);
  assert.deepEqual(pages[0].readerMarkers.map((marker) => marker.label), ['第 1 位・1:30–2:1']);
  assert.deepEqual(pages[1].readerMarkers.map((marker) => marker.label), [
    '第 1 位・1:30–2:1（續）',
    '第 2 位・2:2–5'
  ]);
});

test('marks an oversized verse as continuing within the same reader segment', () => {
  const fits = (verses) => verses.length === 1 && Array.from(verses[0].text).length <= 4;
  const functions = loadFunctions(
    rendererSource,
    [
      'scriptureSentenceTokens',
      'largestFittingVersePrefix',
      'splitOversizedScriptureVerse',
      'buildScripturePagesByFit'
    ],
    { scripturePageFits: fits }
  );
  const verse = {
    chapter: 1,
    number: 1,
    text: '甲乙丙丁戊己庚辛',
    continuation: false,
    startsChapter: true,
    key: '1:1:0'
  };
  const segments = [{
    label: '1–1 節',
    start: { chapter: 1, verse: 1 },
    end: { chapter: 1, verse: 1 },
    count: 1
  }];
  const pages = plain(functions.buildScripturePagesByFit([verse], fits, segments));

  assert.ok(pages.length > 1);
  assert.deepEqual(pages[0].readerMarkers.map((marker) => marker.label), ['第 1 位・1–1 節']);
  assert.deepEqual(pages[1].readerMarkers.map((marker) => marker.label), ['第 1 位・1–1 節（續）']);
  assert.equal(pages.flatMap((page) => page.verses).map((part) => part.text).join(''), verse.text);
});

test('scales the fixed reading canvas without changing its logical dimensions', () => {
  const properties = new Map();
  const rootProperties = new Map();
  const screen = { style: { setProperty: (name, value) => properties.set(name, value) } };
  const { updateFlowDisplayScale } = loadFunctions(
    rendererSource,
    ['updateFlowDisplayScale'],
    {
      $: (id) => id === 'flowScreen' ? screen : null,
      document: { documentElement: { style: { setProperty: (name, value) => rootProperties.set(name, value) } } },
      window: { innerWidth: 608, innerHeight: 1080 },
      COVER_LAYOUT_WIDTH: 1280,
      COVER_LAYOUT_HEIGHT: 720,
      FLOW_LAYOUT_WIDTH: 405,
      FLOW_LAYOUT_HEIGHT: 720,
      FLOW_MIN_CONTROL_SIZE: 44,
      FLOW_MIN_ICON_SIZE: 19,
      MAIN_TOOLBAR_SCALE_MIN: 0.5,
      MAIN_TOOLBAR_SCALE_MAX: 1.25
    }
  );

  assert.equal(updateFlowDisplayScale(), 1.5);
  assert.equal(rootProperties.get('--toolbar-display-scale'), '0.500000');
  assert.equal(properties.get('--flow-display-scale'), '1.500000');
  assert.equal(properties.get('--flow-control-min-size'), '29.333px');
  assert.equal(properties.get('--flow-icon-min-size'), '12.667px');
});

test('splits an oversized scripture verse without losing text or chapter context', () => {
  const maxCharacters = 8;
  const scripturePageFits = (verses) => (
    verses.length === 1 && Array.from(verses[0].text).length <= maxCharacters
  );
  const { splitOversizedScriptureVerse } = loadFunctions(
    rendererSource,
    ['scriptureSentenceTokens', 'largestFittingVersePrefix', 'splitOversizedScriptureVerse'],
    { scripturePageFits }
  );
  const original = {
    chapter: 2,
    number: 1,
    text: '起初神創造天地。地是空虛混沌。淵面黑暗。',
    continuation: false,
    startsChapter: true,
    key: '2:1:0'
  };
  const parts = plain(splitOversizedScriptureVerse(original));

  assert.ok(parts.length > 1);
  assert.equal(parts.map((part) => part.text).join(''), original.text);
  assert.deepEqual(parts.map((part) => part.chapter), parts.map(() => original.chapter));
  assert.deepEqual(parts.map((part) => part.number), parts.map(() => original.number));
  assert.deepEqual(parts.map((part) => part.key), parts.map(() => original.key));
  assert.equal(parts[0].continuation, false);
  assert.ok(parts.slice(1).every((part) => part.continuation));
  assert.equal(parts[0].startsChapter, true);
  assert.ok(parts.slice(1).every((part) => !part.startsChapter));
  assert.ok(parts.every((part) => part.text && Array.from(part.text).length <= maxCharacters));

  const shortVerse = { ...original, text: '短經文。' };
  assert.deepEqual(plain(splitOversizedScriptureVerse(shortVerse)), [shortVerse]);
});

test('uses code points when splitting an unpunctuated oversized verse', () => {
  const maxCharacters = 3;
  const scripturePageFits = (verses) => (
    verses.length === 1 && Array.from(verses[0].text).length <= maxCharacters
  );
  const { splitOversizedScriptureVerse } = loadFunctions(
    rendererSource,
    ['scriptureSentenceTokens', 'largestFittingVersePrefix', 'splitOversizedScriptureVerse'],
    { scripturePageFits }
  );
  const original = {
    chapter: 1,
    number: 1,
    text: '甲乙😀丙丁戊己庚辛壬癸',
    continuation: false,
    startsChapter: true,
    key: '1:1:0'
  };
  const parts = plain(splitOversizedScriptureVerse(original));

  assert.equal(parts.map((part) => part.text).join(''), original.text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => Array.from(part.text).length <= maxCharacters));
  assert.ok(parts.slice(1).every((part) => part.continuation));
});

test('builds one structured Utmost page with distinct heading, verse and body paragraphs', () => {
  const { createUtmostPage } = loadFunctions(
    rendererSource,
    ['splitUtmostVerseCitation', 'createUtmostPage'],
    { systemDateChinese: () => '7月19日' }
  );
  const maliciousText = '<img src=x onerror=alert(1)>';
  const page = plain(createUtmostPage({
    date: '7月19日',
    title: `信心的操練 ${maliciousText}`,
    verse: '你們要休息，要知道我是神。',
    body: '第一段正文。\n\n第二段正文。\n第三段正文。'
  }));

  assert.deepEqual(page, {
    type: 'utmost',
    date: '7月19日',
    title: `信心的操練 ${maliciousText}`,
    verse: {
      text: '你們要休息，要知道我是神。',
      quote: '你們要休息，要知道我是神。',
      citation: ''
    },
    paragraphs: ['第一段正文。', '第二段正文。', '第三段正文。']
  });
  assert.equal(Array.isArray(page), false, 'Utmost must be represented by one page object');
  assert.equal(page.paragraphs.join(''), '第一段正文。第二段正文。第三段正文。');

  const emptyBody = plain(createUtmostPage({ date: '7月19日', title: '', verse: '', body: '' }));
  assert.equal(emptyBody.type, 'utmost');
  assert.equal(emptyBody.title, '竭誠獻上');
  assert.deepEqual(emptyBody.paragraphs, ['今天暫時沒有正文內容。']);
});

test('keeps the complete Utmost citation together after the final dash', () => {
  const { splitUtmostVerseCitation } = loadFunctions(rendererSource, ['splitUtmostVerseCitation']);
  const cases = [
    ['你們要心裡不要憂愁。—約翰福音', '你們要心裡不要憂愁。', '—約翰福音'],
    ['他說—不要怕—路加福音八章五十節', '他說—不要怕', '—路加福音八章五十節'],
    ['平安留給你們。–約翰福音十四章', '平安留給你們。', '–約翰福音十四章'],
    ['你們要喜樂。 - Philippians 4:4', '你們要喜樂。', '- Philippians 4:4'],
    ['約翰福音 3-16', '約翰福音 3-16', '']
  ];
  for (const [value, quote, citation] of cases) {
    assert.deepEqual(plain(splitUtmostVerseCitation(value)), { text: value, quote, citation });
  }
});

test('uses arrow keys for reading while optionally blocking Scripture-to-worship back navigation', () => {
  const calls = [];
  const cfg = { preventLeftArrowWorship: true };
  let settingsOpen = false;
  const elements = {
    flowScreen: { classList: { contains: (name) => name === 'hidden' ? false : false } },
    settingsPanel: { classList: { contains: (name) => name === 'hidden' ? !settingsOpen : false } }
  };
  const { handleFlowArrowNavigation } = loadFunctions(
    rendererSource,
    ['isEditableFlowNavigationTarget', 'handleFlowArrowNavigation'],
    {
      $: (id) => elements[id],
      cfg,
      flowStep: 'scripture',
      flowPageIndex: 0,
      worshipActive: false,
      flowTransitioning: false,
      flowLoading: false,
      nextFlowPageOrStep: (source) => calls.push(['next', source]),
      prevFlowPageOrStep: () => calls.push(['prev'])
    }
  );
  const target = { tagName: 'DIV', isContentEditable: false, closest: () => null };
  const arrowEvent = (key, overrides = {}) => {
    let prevented = false;
    const event = {
      key,
      repeat: false,
      isComposing: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target,
      preventDefault: () => { prevented = true; },
      ...overrides
    };
    return { event, prevented: () => prevented };
  };

  const right = arrowEvent('ArrowRight');
  assert.equal(handleFlowArrowNavigation(right.event), true);
  assert.equal(right.prevented(), true);
  const left = arrowEvent('ArrowLeft');
  assert.equal(handleFlowArrowNavigation(left.event), true);
  assert.equal(left.prevented(), true);
  assert.deepEqual(calls, [['next', 'keyboard']], 'left arrow should be consumed on the first Scripture page');

  cfg.preventLeftArrowWorship = false;
  const unlockedLeft = arrowEvent('ArrowLeft');
  assert.equal(handleFlowArrowNavigation(unlockedLeft.event), true);
  assert.equal(unlockedLeft.prevented(), true);
  assert.deepEqual(calls, [['next', 'keyboard'], ['prev']], 'disabling the safeguard should restore back navigation');

  for (const blocked of [
    arrowEvent('ArrowRight', { repeat: true }),
    arrowEvent('ArrowRight', { metaKey: true }),
    arrowEvent('ArrowLeft', { target: { tagName: 'INPUT', closest: () => null } }),
    arrowEvent('ArrowLeft', { target: { tagName: 'DIV', isContentEditable: true, closest: () => null } })
  ]) {
    assert.equal(handleFlowArrowNavigation(blocked.event), false);
    assert.equal(blocked.prevented(), false);
  }
  settingsOpen = true;
  const inSettings = arrowEvent('ArrowRight');
  assert.equal(handleFlowArrowNavigation(inSettings.event), false);
  assert.equal(inSettings.prevented(), false);
  assert.deepEqual(calls, [['next', 'keyboard'], ['prev']]);

  settingsOpen = false;
  const laterCalls = [];
  const laterNavigation = loadFunctions(
    rendererSource,
    ['isEditableFlowNavigationTarget', 'handleFlowArrowNavigation'],
    {
      $: (id) => elements[id],
      cfg: { preventLeftArrowWorship: true },
      flowStep: 'scripture',
      flowPageIndex: 1,
      worshipActive: false,
      flowTransitioning: false,
      flowLoading: false,
      nextFlowPageOrStep: (source) => laterCalls.push(['next', source]),
      prevFlowPageOrStep: () => laterCalls.push(['prev'])
    }
  );
  const laterLeft = arrowEvent('ArrowLeft');
  assert.equal(laterNavigation.handleFlowArrowNavigation(laterLeft.event), true);
  assert.equal(laterLeft.prevented(), true);
  assert.deepEqual(laterCalls, [['prev']], 'left arrow must still move between Scripture pages');
  const utmostCalls = [];
  const utmostNavigation = loadFunctions(
    rendererSource,
    ['isEditableFlowNavigationTarget', 'handleFlowArrowNavigation'],
    {
      $: (id) => elements[id],
      cfg: { preventLeftArrowWorship: true },
      flowStep: 'utmost',
      flowPageIndex: 0,
      worshipActive: false,
      flowTransitioning: false,
      flowLoading: false,
      nextFlowPageOrStep: (source) => utmostCalls.push(['next', source]),
      prevFlowPageOrStep: () => utmostCalls.push(['prev'])
    }
  );
  const utmostRight = arrowEvent('ArrowRight');
  assert.equal(utmostNavigation.handleFlowArrowNavigation(utmostRight.event), true);
  assert.equal(utmostRight.prevented(), true);
  const utmostLeft = arrowEvent('ArrowLeft');
  assert.equal(utmostNavigation.handleFlowArrowNavigation(utmostLeft.event), true);
  assert.equal(utmostLeft.prevented(), true);
  assert.deepEqual(utmostCalls, [['next', 'keyboard'], ['prev']]);
});

test('uses right arrow as a global flow shortcut on cover and worship', () => {
  const target = { tagName: 'DIV', isContentEditable: false, closest: () => null };
  const arrowEvent = (overrides = {}) => {
    let prevented = false;
    const event = {
      key: 'ArrowRight',
      repeat: false,
      isComposing: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target,
      preventDefault: () => { prevented = true; },
      ...overrides
    };
    return { event, prevented: () => prevented };
  };
  const elements = {
    flowScreen: { classList: { contains: (name) => name === 'hidden' } },
    settingsPanel: { classList: { contains: (name) => name === 'hidden' } }
  };
  const coverCalls = [];
  const coverNavigation = loadFunctions(
    rendererSource,
    ['isEditableFlowNavigationTarget', 'handleFlowArrowNavigation'],
    {
      $: (id) => elements[id],
      flowStep: 'cover',
      worshipActive: false,
      flowTransitioning: false,
      flowLoading: false,
      nextFlowStep: () => coverCalls.push('worship')
    }
  );
  const coverRight = arrowEvent();
  assert.equal(coverNavigation.handleFlowArrowNavigation(coverRight.event), true);
  assert.equal(coverRight.prevented(), true);
  assert.deepEqual(coverCalls, ['worship']);

  const worshipCalls = [];
  const worshipNavigation = loadFunctions(
    rendererSource,
    ['isEditableFlowNavigationTarget', 'handleFlowArrowNavigation'],
    {
      $: (id) => elements[id],
      flowStep: 'worship',
      worshipActive: true,
      flowTransitioning: false,
      flowLoading: false,
      backToCover: (options) => worshipCalls.push(plain(options))
    }
  );
  const worshipRight = arrowEvent({ target: { id: 'wSeek', tagName: 'INPUT', closest: () => null } });
  assert.equal(worshipNavigation.handleFlowArrowNavigation(worshipRight.event), true);
  assert.equal(worshipRight.prevented(), true);
  assert.deepEqual(worshipCalls, [{ nextAfterWorship: true }]);
});

test('space toggles worship playback even when the seek bar keeps focus', () => {
  let paused = false;
  let prevented = false;
  const video = {
    get paused() { return paused; },
    pause() { paused = true; }
  };
  const elements = {
    settingsPanel: { classList: { contains: (name) => name === 'hidden' } },
    worshipVideo: video,
    worshipLoading: { textContent: '', classList: { remove() {} } }
  };
  const { handleSpacePlaybackToggle } = loadFunctions(
    rendererSource,
    ['isWorshipSeekTarget', 'handleSpacePlaybackToggle'],
    {
      $: (id) => elements[id],
      flowStep: 'worship',
      worshipActive: true,
      setWorshipPlaybackDesired: () => {},
      resumeWorshipPlayback: async () => {},
      toggleMusicPlayPause: () => assert.fail('worship space should not toggle cover music'),
      toast: () => {}
    }
  );
  const event = {
    code: 'Space',
    target: { id: 'wSeek', tagName: 'INPUT', closest: (selector) => selector === '#wSeek' ? event.target : null },
    preventDefault: () => { prevented = true; }
  };

  assert.equal(handleSpacePlaybackToggle(event), true);
  assert.equal(prevented, true);
  assert.equal(paused, true);
});

test('treats one inertial wheel gesture as at most one reading-page action', () => {
  let settingsOpen = false;
  let nextTimerId = 1;
  const timers = new Map();
  const calls = [];
  const elements = {
    flowScreen: { classList: { contains: (name) => name === 'hidden' ? false : false } },
    settingsPanel: { classList: { contains: (name) => name === 'hidden' ? !settingsOpen : false } }
  };
  const functions = loadFunctions(
    rendererSource,
    [
      'isEditableFlowNavigationTarget',
      'resetFlowWheelGesture',
      'normalizedFlowWheelDelta',
      'handleFlowWheelNavigation'
    ],
    {
      $: (id) => elements[id],
      window: { innerHeight: 720 },
      setTimeout: (run, milliseconds) => {
        const id = nextTimerId++;
        timers.set(id, { run, milliseconds });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      flowStep: 'scripture',
      worshipActive: false,
      flowTransitioning: false,
      flowLoading: false,
      flowWheelDelta: 0,
      flowWheelGestureLocked: false,
      flowWheelResetTimer: null,
      FLOW_WHEEL_THRESHOLD: 36,
      FLOW_WHEEL_IDLE_MS: 300,
      nextFlowPageOrStep: (source) => calls.push(['next', source]),
      prevFlowPageOrStep: () => calls.push(['prev'])
    }
  );
  const wheelEvent = (deltaY, overrides = {}) => {
    let prevented = false;
    const event = {
      deltaY,
      deltaX: 0,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      target: { tagName: 'DIV', isContentEditable: false, closest: () => null },
      preventDefault: () => { prevented = true; },
      ...overrides
    };
    return { event, prevented: () => prevented };
  };
  const runIdleTimer = () => {
    assert.equal(timers.size, 1, 'wheel gesture should have one debounced idle timer');
    const [id, timer] = timers.entries().next().value;
    timers.delete(id);
    assert.equal(timer.milliseconds, 300);
    timer.run();
  };

  for (const delta of [10, 11, 16]) {
    const wheel = wheelEvent(delta);
    assert.equal(functions.handleFlowWheelNavigation(wheel.event), true);
    assert.equal(wheel.prevented(), true);
  }
  assert.deepEqual(calls, [['next', 'wheel']]);

  for (const inertialTail of [80, 30, 8, 2]) {
    functions.handleFlowWheelNavigation(wheelEvent(inertialTail).event);
  }
  assert.deepEqual(calls, [['next', 'wheel']], 'inertial tail flipped more than one page');
  runIdleTimer();

  const lineModeWheel = wheelEvent(-3, { deltaMode: 1 });
  assert.equal(functions.handleFlowWheelNavigation(lineModeWheel.event), true);
  assert.deepEqual(calls, [['next', 'wheel'], ['prev']]);
  runIdleTimer();

  settingsOpen = true;
  const settingsWheel = wheelEvent(100);
  assert.equal(functions.handleFlowWheelNavigation(settingsWheel.event), false);
  assert.equal(settingsWheel.prevented(), false, 'settings scrolling must retain its native behavior');
  settingsOpen = false;
  const inputWheel = wheelEvent(100, { target: { tagName: 'TEXTAREA', closest: () => null } });
  assert.equal(functions.handleFlowWheelNavigation(inputWheel.event), false);
  assert.equal(inputWheel.prevented(), false);
});

test('ignores repeated Escape keydown events during reading completion confirmation', () => {
  let returnRequests = 0;
  const elements = {
    settingsPanel: { classList: { contains: (name) => name === 'hidden' } },
    flowScreen: { classList: { contains: (name) => name === 'hidden' ? false : false } }
  };
  const { handleEscapeNavigation } = loadFunctions(rendererSource, ['handleEscapeNavigation'], {
    $: (id) => elements[id],
    flowStep: 'utmost',
    worshipActive: false,
    closeSettings: () => assert.fail('hidden settings panel was closed'),
    requestFlowReturnToCover: (source) => {
      assert.equal(source, 'escape');
      returnRequests++;
    }
  });
  const escapeEvent = (overrides = {}) => {
    let prevented = false;
    const event = {
      key: 'Escape',
      repeat: false,
      isComposing: false,
      preventDefault: () => { prevented = true; },
      ...overrides
    };
    return { event, prevented: () => prevented };
  };

  const first = escapeEvent();
  assert.equal(handleEscapeNavigation(first.event), true);
  assert.equal(first.prevented(), true);
  assert.equal(returnRequests, 1);

  for (const ignored of [escapeEvent({ repeat: true }), escapeEvent({ isComposing: true })]) {
    assert.equal(handleEscapeNavigation(ignored.event), false);
    assert.equal(ignored.prevented(), false);
  }
  assert.equal(returnRequests, 1, 'one held Escape key armed and completed the flow');
});

test('reports the current reading page and progress percentage', () => {
  const cases = [
    { index: 0, total: 3, text: '1 / 3', percentage: 100 / 3, section: '經文' },
    { index: 1, total: 3, text: '2 / 3', percentage: 200 / 3, section: '經文' },
    { index: 2, total: 3, text: '3 / 3', percentage: 100, section: '經文' },
    { index: 0, total: 1, text: '1 / 1', percentage: 100, section: '竭誠獻上', step: 'utmost' }
  ];

  for (const item of cases) {
    const properties = {};
    const attributes = {};
    const info = {
      textContent: '',
      style: { setProperty: (name, value) => { properties[name] = value; } },
      setAttribute: (name, value) => { attributes[name] = value; }
    };
    const { updateFlowPageProgress } = loadFunctions(rendererSource, ['updateFlowPageProgress'], {
      $: () => info,
      flowPages: Array.from({ length: item.total }, () => ({ type: item.step || 'scripture' })),
      flowPageIndex: item.index,
      flowStep: item.step || 'scripture'
    });

    updateFlowPageProgress();
    assert.equal(info.textContent, item.text);
    assert.ok(Math.abs(Number.parseFloat(properties['--flow-page-progress']) - item.percentage) < 0.001);
    assert.match(attributes['aria-label'], new RegExp(`${item.section}.*第 ${item.index + 1} 頁.*共 ${item.total} 頁`));
  }
});

function loadUtmostConfirmationHarness() {
  let now = 1000;
  let nextTimerId = 1;
  const timers = new Map();
  const calls = { returned: 0, revealed: 0, toasts: [], steps: [] };
  const elements = {
    flowScreen: { classList: { contains: (name) => name === 'hidden' ? false : false } },
    flowNextPage: { textContent: '完成' }
  };
  const functions = loadFunctions(
    rendererSource,
    [
      'setFlowButtonLabel',
      'isUtmostFinalPage',
      'resetUtmostFinishConfirmation',
      'requestUtmostFinishConfirmation',
      'requestFlowReturnToCover',
      'prevFlowPageOrStep'
    ],
    {
      $: (id) => elements[id],
      Date: { now: () => now },
      setTimeout: (run, milliseconds) => {
        const id = nextTimerId++;
        timers.set(id, { run, milliseconds });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      flowStep: 'utmost',
      flowPages: [{ type: 'utmost' }],
      flowPageIndex: 0,
      flowTransitioning: false,
      utmostFinishConfirmUntil: 0,
      utmostFinishConfirmTimer: null,
      UTMOST_FINISH_CONFIRM_MS: 3500,
      revealFlowFooter: () => { calls.revealed++; },
      scheduleFlowFooterHide: () => {},
      toast: (message, milliseconds) => calls.toasts.push([message, milliseconds]),
      returnToMainCover: () => { calls.returned++; },
      prevFlowStep: () => calls.steps.push('previous-step'),
      renderFlowPage: () => calls.steps.push('render'),
      goFlowStep: (step) => {
        calls.steps.push(step);
        return Promise.resolve(false);
      }
    }
  );
  return {
    ...functions,
    calls,
    elements,
    timers,
    advanceTime(milliseconds) { now += milliseconds; },
    runOnlyTimer() {
      assert.equal(timers.size, 1, 'expected one pending confirmation timer');
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.run();
      return timer.milliseconds;
    }
  };
}

test('requires a deliberate second action before leaving the Utmost page', () => {
  const harness = loadUtmostConfirmationHarness();

  assert.equal(harness.requestFlowReturnToCover('button'), false);
  assert.equal(harness.calls.returned, 0);
  assert.equal(harness.elements.flowNextPage.textContent, '再按一次完成');
  assert.equal(harness.calls.revealed, 1);
  assert.match(harness.calls.toasts[0][0], /再按一次/);

  assert.equal(harness.requestFlowReturnToCover('keyboard'), true);
  assert.equal(harness.calls.returned, 1);
  assert.equal(harness.elements.flowNextPage.textContent, '完成');
  assert.equal(harness.timers.size, 0);
});

test('does not let inertial wheel scrolling confirm or finish Utmost', () => {
  const harness = loadUtmostConfirmationHarness();

  assert.equal(harness.requestFlowReturnToCover('wheel'), false);
  assert.equal(harness.calls.returned, 0);
  assert.equal(harness.timers.size, 0, 'wheel input must not arm the completion deadline');
  assert.match(harness.calls.toasts[0][0], /右方向鍵/);

  assert.equal(harness.requestFlowReturnToCover('button'), false);
  assert.equal(harness.calls.returned, 0, 'first deliberate action after wheel input must still only arm');
  assert.equal(harness.requestFlowReturnToCover('button'), true);
  assert.equal(harness.calls.returned, 1);
});

test('expires the Utmost completion confirmation and restores its label', () => {
  const harness = loadUtmostConfirmationHarness();

  assert.equal(harness.requestUtmostFinishConfirmation(), false);
  harness.advanceTime(3500);
  assert.equal(harness.runOnlyTimer(), 3500);
  assert.equal(harness.elements.flowNextPage.textContent, '完成');
  assert.equal(harness.requestUtmostFinishConfirmation(), false, 'expired confirmation must arm again');
  assert.equal(harness.elements.flowNextPage.textContent, '再按一次完成');
});

test('uses the first left action to cancel an armed Utmost completion', () => {
  const harness = loadUtmostConfirmationHarness();

  assert.equal(harness.requestUtmostFinishConfirmation(), false);
  harness.prevFlowPageOrStep();
  assert.deepEqual(harness.calls.steps, []);
  assert.equal(harness.elements.flowNextPage.textContent, '完成');

  harness.prevFlowPageOrStep();
  assert.deepEqual(harness.calls.steps, ['scripture']);
});

test('keeps the cover silent after Utmost while preserving manual music playback', () => {
  const audio = {
    paused: false,
    volume: 0.9,
    pauseCalls: 0,
    pause() { this.paused = true; this.pauseCalls++; }
  };
  const switchStates = [];
  let clearedFade = 0;
  let playRequests = 0;
  const elements = {
    bgAudio: audio,
    flowScreen: { classList: { contains: (name) => name === 'hidden' } }
  };
  const { resumeMusicOnCover, toggleMusic } = loadFunctions(
    rendererSource,
    ['stopNativeMusic', 'resumeMusicOnCover', 'isMainCover', 'toggleMusic'],
    {
      $: (id) => elements[id],
      cfg: { autoPlayMusic: true, musicUrl: 'file:///music.mp3', musicVolume: 0.42 },
      flowReachedUtmost: true,
      flowStep: 'cover',
      flowTransitioning: false,
      worshipActive: false,
      musicResumeOnCover: true,
      musicDesired: true,
      musicPlaying: true,
      musicRequestToken: 7,
      musicFadeTimer: 99,
      nativeMusicLoaded: false,
      USE_NATIVE_MAC_AUDIO: false,
      clearInterval: () => { clearedFade++; },
      setMusicSwitchState: (on) => switchStates.push(on),
      sendNativeAudio: () => {},
      resolveAndPlayMusic: () => { playRequests++; },
      fadeOutMusic: () => assert.fail('manual playback was mistaken for a fade-out')
    }
  );

  resumeMusicOnCover();
  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.volume, 0.42);
  assert.equal(clearedFade, 1);
  assert.equal(playRequests, 0, 'auto-play must not override the post-Utmost silence');
  assert.deepEqual(switchStates, [false]);

  toggleMusic();
  assert.equal(playRequests, 1, 'the user must still be able to start music manually');
  assert.deepEqual(switchStates, [false, true]);
});

test('blocks manual music controls until the cover window transition is settled', () => {
  const elements = {
    flowScreen: { classList: { contains: (name) => name === 'hidden' } }
  };
  let playRequests = 0;
  const musicGlobals = (flowTransitioning) => ({
    $: (id) => elements[id],
    cfg: { musicUrl: 'file:///music.mp3' },
    flowTransitioning,
    flowStep: 'cover',
    worshipActive: false,
    musicResumeOnCover: false,
    musicDesired: false,
    musicPlaying: false,
    musicRequestToken: 0,
    setMusicSwitchState: () => {},
    resolveAndPlayMusic: () => { playRequests++; },
    fadeOutMusic: () => assert.fail('inactive music should not fade')
  });
  const transitioning = loadFunctions(
    rendererSource,
    ['isMainCover', 'toggleMusic'],
    musicGlobals(true)
  );
  const settled = loadFunctions(
    rendererSource,
    ['isMainCover', 'toggleMusic'],
    musicGlobals(false)
  );

  transitioning.toggleMusic();
  assert.equal(playRequests, 0);
  settled.toggleMusic();
  assert.equal(playRequests, 1);
});

test('updates paused native music volume without touching the renderer audio element', () => {
  const nativeCommands = [];
  let domAudioLookups = 0;
  const { onSettingsChanged } = loadFunctions(rendererSource, ['onSettingsChanged'], {
    $: (id) => {
      if (id === 'bgAudio') domAudioLookups++;
      return null;
    },
    cfg: { musicVolume: 0.28 },
    USE_NATIVE_MAC_AUDIO: true,
    nativeMusicLoaded: true,
    musicPlaying: false,
    saveTimer: null,
    collectSettings: () => {},
    applyCover: () => {},
    sendNativeAudio: (channel, action, options) => nativeCommands.push({ channel, action, options }),
    clearTimeout: () => {},
    setTimeout: () => 1,
    window: { api: { setConfig: () => {} } }
  });

  onSettingsChanged();
  assert.equal(domAudioLookups, 0);
  assert.deepEqual(plain(nativeCommands), [{ channel: 'music', action: 'volume', options: { volume: 0.28 } }]);
});

test('keeps macOS background music out of the renderer audio element', async () => {
  let sourceAssignments = 0;
  const nativeCommands = [];
  const audio = {
    _src: '',
    volume: 1,
    pauseCalls: 0,
    playCalls: 0,
    get src() { return this._src; },
    set src(value) { this._src = value; sourceAssignments++; },
    pause() { this.pauseCalls++; },
    play() { this.playCalls++; return Promise.resolve(); }
  };
  const elements = {
    flowScreen: { classList: { contains: (name) => name === 'hidden' } },
    bgAudio: audio
  };
  const { resolveAndPlayMusic } = loadFunctions(
    rendererSource,
    ['isMainCover', 'normalizeMediaUrl', 'resolveAndPlayMusic'],
    {
      $: (id) => elements[id],
      window: {
        location: { href: 'file:///Applications/Lingxiu.app/Contents/Resources/app/index.html' },
        api: {
          mediaStatus: async () => ({ cached: true }),
          ensureMedia: async () => ({ ok: true, path: 'file:///tmp/music.m4a' })
        }
      },
      cfg: { musicUrl: 'https://youtu.be/music', musicVolume: 0.37 },
      flowStep: 'cover',
      worshipActive: false,
      musicDesired: false,
      musicPlaying: false,
      musicRequestToken: 0,
      nativeMusicLoaded: false,
      USE_NATIVE_MAC_AUDIO: true,
      nativeAudioCommand: async (channel, action, options) => {
        nativeCommands.push({ channel, action, options });
        return { ok: true };
      },
      stopNativeMusic: () => {},
      setMusicSwitchState: () => {},
      showBadge: () => {},
      hideBadge: () => {},
      toast: () => {},
      openSettings: () => {}
    }
  );

  await resolveAndPlayMusic();
  assert.equal(sourceAssignments, 0, 'macOS must never assign bgAudio.src');
  assert.equal(audio.src, '');
  assert.equal(audio.playCalls, 0, 'macOS must never play through HTMLAudioElement');
  assert.equal(audio.pauseCalls, 0, 'macOS must not touch a source-less HTMLAudioElement');
  assert.equal(nativeCommands.length, 1);
  assert.equal(nativeCommands[0].channel, 'music');
  assert.equal(nativeCommands[0].action, 'load');
  assert.equal(nativeCommands[0].options.source, 'file:///tmp/music.m4a');
});

test('stops and releases native music when the macOS fade completes', () => {
  let tick = null;
  const nativeActions = [];
  const audio = {
    volume: 1,
    pauseCalls: 0,
    pause() { this.pauseCalls++; }
  };
  const { fadeOutMusic } = loadFunctions(
    rendererSource,
    ['stopNativeMusic', 'fadeOutMusic'],
    {
      $: () => audio,
      cfg: { musicVolume: 0.6 },
      USE_NATIVE_MAC_AUDIO: true,
      musicDesired: true,
      musicPlaying: true,
      musicRequestToken: 0,
      musicFadeTimer: null,
      nativeMusicLoaded: true,
      setInterval: (callback) => { tick = callback; return 77; },
      clearInterval: () => {},
      sendNativeAudio: (_channel, action) => nativeActions.push(action),
      setMusicSwitchState: () => {}
    }
  );

  fadeOutMusic();
  for (let i = 0; i < 20 && !nativeActions.includes('stop'); i++) tick();
  assert.equal(nativeActions.at(-1), 'stop');
  assert.equal(nativeActions.includes('pause'), false, 'fade completion must release rather than pause the native output queue');
  assert.equal(audio.pauseCalls, 0);
});

test('keeps the Windows DOM audio source reusable after a fade', () => {
  let tick = null;
  const nativeActions = [];
  const audio = {
    src: 'file:///D:/cache/music.mp3',
    volume: 0.6,
    pauseCalls: 0,
    pause() { this.pauseCalls++; }
  };
  const { fadeOutMusic } = loadFunctions(
    rendererSource,
    ['stopNativeMusic', 'fadeOutMusic'],
    {
      $: () => audio,
      cfg: { musicVolume: 0.6 },
      USE_NATIVE_MAC_AUDIO: false,
      musicDesired: true,
      musicPlaying: true,
      musicRequestToken: 0,
      musicFadeTimer: null,
      nativeMusicLoaded: false,
      setInterval: (callback) => { tick = callback; return 88; },
      clearInterval: () => {},
      sendNativeAudio: (_channel, action) => nativeActions.push(action),
      setMusicSwitchState: () => {}
    }
  );

  fadeOutMusic();
  for (let i = 0; i < 20 && audio.pauseCalls === 0; i++) tick();
  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.src, 'file:///D:/cache/music.mp3');
  assert.equal(audio.volume, 0.6);
  assert.deepEqual(nativeActions, []);
});

test('still completes the programmatic music resume while the cover window settles', async () => {
  const audio = {
    src: '',
    volume: 1,
    playCalls: 0,
    pauseCalls: 0,
    play() { this.playCalls++; return Promise.resolve(); },
    pause() { this.pauseCalls++; }
  };
  const elements = {
    flowScreen: { classList: { contains: (name) => name === 'hidden' } },
    bgAudio: audio
  };
  const { resumeMusicOnCover } = loadFunctions(
    rendererSource,
    ['isMainCover', 'normalizeMediaUrl', 'resolveAndPlayMusic', 'resumeMusicOnCover'],
    {
      $: (id) => elements[id],
      window: {
        location: { href: 'file:///D:/zoomshare/src/renderer/index.html' },
        api: {
          mediaStatus: async () => ({ cached: true }),
          ensureMedia: async () => ({ ok: true, path: 'file:///D:/cache/music.mp3' })
        }
      },
      cfg: { autoPlayMusic: true, musicUrl: 'https://youtu.be/music', musicVolume: 0.37 },
      flowTransitioning: true,
      flowStep: 'cover',
      flowReachedUtmost: false,
      worshipActive: false,
      musicResumeOnCover: true,
      musicDesired: false,
      musicPlaying: false,
      musicRequestToken: 0,
      musicFadeTimer: null,
      USE_NATIVE_MAC_AUDIO: false,
      nativeAudioCommand: async () => ({ ok: true }),
      sendNativeAudio: () => {},
      setMusicSwitchState: () => {},
      showBadge: () => {},
      hideBadge: () => {},
      toast: () => {},
      openSettings: () => {}
    }
  );

  resumeMusicOnCover();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audio.playCalls, 1, 'programmatic cover resume was blocked by the transition guard');
  assert.equal(audio.pauseCalls, 0);
  assert.equal(audio.volume, 0.37);
  assert.equal(audio.src, 'file:///D:/cache/music.mp3');
});

test('retains the previous cover music resume behavior before Utmost is reached', () => {
  let playRequests = 0;
  const { resumeMusicOnCover } = loadFunctions(rendererSource, ['resumeMusicOnCover'], {
    $: () => ({ paused: true, volume: 1 }),
    cfg: { autoPlayMusic: true, musicUrl: 'file:///music.mp3', musicVolume: 0.5 },
    flowReachedUtmost: false,
    musicResumeOnCover: false,
    musicDesired: false,
    musicPlaying: false,
    musicRequestToken: 0,
    musicFadeTimer: null,
    setMusicSwitchState: () => {},
    resolveAndPlayMusic: () => { playRequests++; }
  });

  resumeMusicOnCover();
  assert.equal(playRequests, 1);
});

test('keeps the post-Utmost silence latch when navigating back before the cover', async () => {
  const audio = {
    volume: 1,
    pauseCalls: 0,
    pause() { this.pauseCalls++; }
  };
  let playRequests = 0;
  const classList = { remove: () => {}, contains: (name) => name === 'hidden' ? false : false };
  const elements = {
    toolbar: { classList },
    worshipControls: { classList },
    flowScreen: { dataset: {}, classList },
    bgAudio: audio
  };
  const { goFlowStep } = loadFunctions(rendererSource, ['stopNativeMusic', 'resumeMusicOnCover', 'goFlowStep'], {
    $: (id) => elements[id],
    cfg: { autoPlayMusic: true, musicUrl: 'file:///music.mp3', musicVolume: 0.36 },
    window: { api: { setWindowMode: async () => {} } },
    FLOW_ORDER: ['cover', 'worship', 'scripture', 'utmost'],
    flowStep: 'cover',
    flowReachedUtmost: false,
    flowNavigationToken: 0,
    flowTransitioning: false,
    flowLoading: false,
    worshipActive: false,
    musicResumeOnCover: false,
    musicDesired: false,
    musicPlaying: false,
    musicRequestToken: 0,
    musicFadeTimer: null,
    nativeMusicLoaded: false,
    USE_NATIVE_MAC_AUDIO: false,
    resetUtmostFinishConfirmation: () => false,
    isReadingFlowStep: (step) => step === 'scripture' || step === 'utmost',
    hideFlowFooterImmediately: () => {},
    stopWorshipPlayback: () => {},
    pauseMusicForFlow: () => {},
    setFlowVisible: () => {},
    updateFlowDisplayScale: () => 1,
    waitForFlowLayout: async () => true,
    showScriptureFlow: async () => true,
    showUtmostFlow: async () => true,
    startWorship: async () => true,
    showToolbar: () => {},
    setMusicSwitchState: () => {},
    sendNativeAudio: () => {},
    resolveAndPlayMusic: () => { playRequests++; }
  });

  assert.equal(await goFlowStep('utmost'), true);
  assert.equal(await goFlowStep('scripture'), true);
  assert.equal(await goFlowStep('cover'), true);
  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.volume, 0.36);
  assert.equal(playRequests, 0, 'backtracking must not discard the Utmost silence latch');

  assert.equal(await goFlowStep('scripture'), true);
  assert.equal(await goFlowStep('cover'), true);
  assert.equal(playRequests, 1, 'a later flow that never reaches Utmost keeps the previous resume behavior');
});

async function runTests() {
  let passed = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      passed += 1;
      console.log(`ok ${passed} - ${name}`);
    } catch (error) {
      console.error(`not ok ${passed + 1} - ${name}`);
      throw error;
    }
  }
  console.log(`\n${passed} runtime tests passed`);
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
