'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const projectRoot = path.join(__dirname, '..');
app.commandLine.appendSwitch('disable-gpu');
const today = require('../src/devotional-date').dateKey();

const roster = [
  { memberId: 'reader', name: '王小明', aliases: ['Amy 王'], canReadScripture: true, canReadUtmost: true, enabled: true, order: 1 },
  { memberId: 'utmost', name: '林平安', aliases: [], canReadScripture: false, canReadUtmost: true, enabled: true, order: 2 },
  { memberId: 'sharer', name: '今日分享者', aliases: [], canReadScripture: false, canReadUtmost: true, enabled: true, order: 3 }
];
let state = {
  configured: true,
  serviceUrl: 'https://presence.example.test',
  deviceLabel: '測試主持人電腦',
  connection: 'connected',
  error: '',
  stale: false,
  fetchedAt: new Date().toISOString(),
  roster,
  rosterErrors: [],
  schedule: { ok: true, found: true, date: today, row: { book: '約翰壹書', startCh: 1, startV: 1, endCh: 2, endV: 6 } },
  utmostSharing: { found: true, date: today, sharer: '今日分享者', next: null, error: '' },
  assignmentStats: {
    date: today, weekStart: today, yesterday: '', memberStats: {},
    currentAssignment: { scripture: [], utmost: [] }
  },
  snapshot: {
    status: 'active',
    meetingNumber: '77730692079',
    meetingUuid: 'meeting-1',
    peakParticipants: 4,
    participants: [
      { sessionId: 'p1', displayName: '王小明', joinedAt: '' },
      { sessionId: 'p2', displayName: '林平安', joinedAt: '' },
      { sessionId: 'p3', displayName: '訪客 iPad', joinedAt: '' },
      { sessionId: 'p4', displayName: '今日分享者', joinedAt: '' }
    ]
  }
};
let rosterSheetOpenCount = 0;
let refreshCount = 0;
let scriptureCurrentCount = 0;
let utmostTodayCount = 0;
const readingKeys = [];

async function run() {
  ipcMain.on('host:reading-arrow', (_event, key) => readingKeys.push(key));
  ipcMain.handle('presence:state', () => state);
  ipcMain.handle('presence:refresh', () => { refreshCount += 1; return state; });
  ipcMain.handle('presence:unpair', () => state);
  ipcMain.handle('presence:pair', () => state);
  ipcMain.handle('presence:assignments', () => state);
  ipcMain.handle('host:utmost-today', () => { utmostTodayCount += 1; return { ok: true, body: '第一段\n\n第二段\n\n第三段\n\n第四段' }; });
  ipcMain.handle('host:scripture-current', () => { scriptureCurrentCount += 1; return { book: '提摩太前書', startCh: 6, startV: 9, endCh: 6, endV: 21 }; });
  ipcMain.handle('host:worship-playback', () => ({ active: false }));
  ipcMain.handle('host:open-roster-sheet', () => { rosterSheetOpenCount += 1; return { ok: true }; });
  ipcMain.handle('host:close', () => ({ ok: true }));
  const window = new BrowserWindow({
    width: 460,
    height: 760,
    useContentSize: true,
    show: false,
    webPreferences: {
      preload: path.join(projectRoot, 'src', 'host', 'host-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  await window.loadFile(path.join(projectRoot, 'src', 'host', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 200));

  async function measureConsole() {
    return window.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('#scriptureAssignments .assignment-card');
      const cardRect = card ? card.getBoundingClientRect() : { height: 0 };
      const titleStyle = getComputedStyle(document.querySelector('.console-header h1'));
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        hostScale: Number.parseFloat(rootStyle.getPropertyValue('--host-display-scale')) || 1,
        setupHidden: document.getElementById('setupView').classList.contains('hidden'),
        consoleVisible: !document.getElementById('consoleView').classList.contains('hidden'),
        scriptureSlots: document.querySelectorAll('#scriptureAssignments .assignment-card').length,
        utmostSlots: document.querySelectorAll('#utmostAssignments .assignment-card').length,
        sharingName: document.getElementById('todaySharingName').textContent,
        onlineRows: document.querySelectorAll('#allOnlineList .online-row').length,
        rosterRows: document.querySelectorAll('#rosterList .roster-row').length,
        firstRosterAlias: document.querySelector('#rosterList .roster-row small').textContent,
        peakOnline: document.getElementById('onlineCount').textContent,
        assignmentColumns: getComputedStyle(document.getElementById('scriptureAssignments')).gridTemplateColumns.split(' ').length,
        eligibleColumns: getComputedStyle(document.getElementById('scriptureEligibleList')).gridTemplateColumns.split(' ').length,
        headingFontSize: Number.parseFloat(titleStyle.fontSize) || 0,
        assignmentCardHeight: cardRect.height,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth
      };
    })()`);
  }

  function expectedHostScale(measurement) {
    return Math.min(
      1,
      Math.max(0.76, Math.min(measurement.viewportWidth / 460, measurement.viewportHeight / 760))
    );
  }

  const initial = await measureConsole();
  assert.equal(initial.setupHidden, true);
  assert.equal(initial.consoleVisible, true);
  assert.equal(initial.scriptureSlots, 3);
  assert.equal(initial.utmostSlots, 4);
  assert.equal(initial.sharingName, '今日分享者');
  assert.equal(initial.onlineRows, 4);
  assert.equal(initial.rosterRows, 3);
  assert.equal(initial.firstRosterAlias, 'Zoom：Amy 王');
  assert.equal(initial.peakOnline, '本次會議最高 4 人在線');
  assert.equal(initial.assignmentColumns, 2);
  assert.equal(initial.eligibleColumns, 3);
  assert.ok(Math.abs(initial.hostScale - expectedHostScale(initial)) < 0.01, 'baseline host scale must follow the actual viewport size');
  assert.ok(initial.bodyScrollWidth <= initial.bodyClientWidth, 'host console overflows horizontally');

  const refreshBaseline = { refreshCount, scriptureCurrentCount, utmostTodayCount };
  await window.webContents.executeJavaScript(`document.getElementById('refreshButton').click()`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(refreshCount, refreshBaseline.refreshCount + 1);
  assert.equal(scriptureCurrentCount, refreshBaseline.scriptureCurrentCount + 1);
  assert.equal(utmostTodayCount, refreshBaseline.utmostTodayCount + 1);

  state = {
    ...state,
    stale: true,
    error: 'Unauthorized',
    utmostSharing: {
      found: false, date: '2026-08-25', sharer: '',
      next: { date: '2026-08-25', sharer: '不應顯示' }, error: ''
    }
  };
  window.webContents.send('presence:state', state);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const staleDailyData = await window.webContents.executeJavaScript(`(() => ({
    sharing: document.getElementById('todaySharingName').textContent,
    next: document.getElementById('todaySharingNext').textContent,
    notice: document.getElementById('notice').textContent
  }))()`);
  assert.equal(staleDailyData.sharing, '排班資料尚未更新');
  assert.doesNotMatch(staleDailyData.next, /下一次|不應顯示/);
  assert.doesNotMatch(staleDailyData.notice, /Unauthorized/i);
  state = {
    ...state,
    stale: false,
    error: '',
    utmostSharing: { found: true, date: today, sharer: '今日分享者', next: null, error: '' }
  };
  window.webContents.send('presence:state', state);
  await new Promise((resolve) => setTimeout(resolve, 100));

  window.setContentSize(340, 460);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const compact = await measureConsole();
  assert.equal(compact.viewportWidth, 340);
  assert.equal(compact.viewportHeight, 460);
  assert.equal(compact.assignmentColumns, 2, 'compact host console must keep the two-column assignment layout');
  assert.equal(compact.eligibleColumns, 3, 'compact host console must keep the three-column candidate layout');
  assert.ok(compact.hostScale < initial.hostScale, 'compact host console did not reduce its display scale');
  assert.ok(compact.headingFontSize < initial.headingFontSize, 'compact host heading did not scale down');
  assert.ok(compact.assignmentCardHeight < initial.assignmentCardHeight, 'compact host cards did not scale down');
  assert.ok(compact.bodyScrollWidth <= compact.bodyClientWidth, 'compact host console overflows horizontally');

  await window.webContents.executeJavaScript(`document.getElementById('openRosterSheetButton').click()`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(rosterSheetOpenCount, 1);

  await window.webContents.executeJavaScript(`document.querySelector('#scriptureAssignments .assignment-card').click()`);
  const inlineCandidates = await window.webContents.executeJavaScript(`(() => ({
    modalRemoved: document.getElementById('slotPicker') === null,
    target: document.getElementById('scriptureTargetSummary').textContent,
    candidateCount: document.querySelectorAll('#scriptureEligibleList .candidate-button').length,
    details: document.querySelector('#scriptureEligibleList .candidate-button small').textContent
  }))()`);
  assert.equal(inlineCandidates.modalRemoved, true);
  assert.match(inlineCandidates.target, /1:1–5/);
  assert.equal(inlineCandidates.candidateCount, 1);
  assert.doesNotMatch(inlineCandidates.details, /昨天沒有讀/);
  assert.match(inlineCandidates.details, /本週/);
  await window.webContents.executeJavaScript(`document.querySelector('#scriptureEligibleList .candidate-button').click()`);
  const selected = await window.webContents.executeJavaScript(`(() => ({
    name: document.querySelector('#scriptureAssignments .assignment-card strong').textContent,
    candidateSelected: document.querySelector('#scriptureEligibleList .candidate-button').classList.contains('selected'),
    details: document.querySelector('#scriptureEligibleList .candidate-button small').textContent
  }))()`);
  assert.equal(selected.name, '王小明');
  assert.equal(selected.candidateSelected, true);
  assert.match(selected.details, /已安排・本週閱讀/);
  // Let the debounced assignment save settle before injecting later snapshots.
  await new Promise((resolve) => setTimeout(resolve, 350));

  await window.webContents.executeJavaScript(`document.querySelector('#utmostAssignments .assignment-card').click()`);
  const utmostCandidateIds = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#utmostEligibleList .candidate-button'), (item) => item.dataset.memberId)`);
  assert.deepEqual(utmostCandidateIds, ['utmost']);

  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.host-settings')`), null, 'staff settings must not appear in the host console');

  // The host selector was removed; stale host preferences and host schedule data
  // must not exclude anyone. Only the sharer is excluded in both reading pools.
  state = {
    ...state,
    hostPreferences: { hostDate: today, hostMemberId: 'reader', fullTimeOverrides: { staff: false } },
    utmostSharing: { ...state.utmostSharing, host: '林平安' },
    roster: [...state.roster.map((member) => ({ ...member, canReadScripture: true })),
      { memberId: 'staff', name: '信一', enabled: true, canReadScripture: true, canReadUtmost: true, isFullTime: false, order: 0 },
      { memberId: 'lay', name: '弟兄姊妹乙', enabled: true, canReadScripture: true, canReadUtmost: true, order: 90 }],
    snapshot: { ...state.snapshot, participants: [...state.snapshot.participants,
      { sessionId: 'p5', displayName: '信一' }, { sessionId: 'p6', displayName: '弟兄姊妹乙' }] }
  };
  window.webContents.send('presence:state', state);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const pools = await window.webContents.executeJavaScript(`(() => ({
    scripture: Array.from(document.querySelectorAll('#scriptureEligibleList button'), (item) => item.dataset.memberId),
    utmost: Array.from(document.querySelectorAll('#utmostEligibleList button'), (item) => item.dataset.memberId),
    assignment: document.querySelector('#scriptureAssignments strong').textContent,
    clock: document.getElementById('hostClock').textContent
  }))()`);
  for (const ids of [pools.scripture, pools.utmost]) {
    assert.ok(!ids.includes('sharer'), 'sharer leaked into a reading pool');
    assert.equal(ids.at(-1), 'staff', 'staff must follow eligible non-staff readers');
  }
  assert.equal(pools.assignment, '王小明', 'legacy host settings must not clear a reading assignment');
  assert.ok(pools.scripture.includes('reader') && pools.scripture.includes('utmost'), 'legacy host settings must not exclude readers');
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('todayHost')`), null);
  assert.match(pools.clock, /\d{2}:\d{2}:\d{2}/);
  const staffLabels = await window.webContents.executeJavaScript(`document.getElementById('consoleView').textContent.includes('全職同工')`);
  assert.equal(staffLabels, false, 'staff classification should not be displayed in the host console');
  const consumedKeys = await window.webContents.executeJavaScript(`(() => {
    const results = [];
    const send = (key, options = {}, target = window) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
      target.dispatchEvent(event);
      results.push(event.defaultPrevented);
    };
    send('ArrowLeft'); send('ArrowRight');
    send('ArrowRight', { repeat: true }); send('ArrowRight', { isComposing: true });
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) send('ArrowRight', { [modifier]: true });
    send('ArrowDown'); send('Escape');
    const input = document.createElement('input'); document.body.appendChild(input);
    input.focus(); send('ArrowLeft', {}, input); input.remove();
    send('ArrowRight', {}, document.querySelector('.all-online summary'));
    const editor = document.createElement('div'); editor.contentEditable = 'true'; document.body.appendChild(editor);
    send('ArrowRight', {}, editor); editor.remove();
    return results;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(readingKeys, ['ArrowLeft', 'ArrowRight']);
  assert.deepEqual(consumedKeys, [true, true, ...Array(11).fill(false)], 'text input, menus, repeat and modified keys must retain their normal behavior');
  state = { ...state,
    roster: [...state.roster, { memberId: 'past', name: '昨天讀過的人', aliases: [], enabled: true, canReadScripture: true, canReadUtmost: true }],
    snapshot: { ...state.snapshot, participants: [...state.snapshot.participants, { sessionId: 'p7', displayName: '昨天讀過的人' }] },
    assignmentStats: { ...state.assignmentStats, memberStats: { ...state.assignmentStats.memberStats, past: { readYesterday: true, totalCount: 1 } } }
  };
  window.webContents.send('presence:state', state);
  await new Promise((resolve) => setTimeout(resolve, 60));
  for (const list of ['scriptureEligibleList', 'utmostEligibleList']) {
    const ids = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#${list} button'), (item) => item.dataset.memberId)`);
    assert.ok(ids.indexOf('staff') < ids.indexOf('past'), 'full-time coworkers must precede yesterday readers');
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#${list} [data-member-id="past"]').disabled`), true);
  }
  const { countdownState } = require('../src/worship-shared');
  for (const [position, text, tone] of [[0,'1:40','normal'],[40,'1:00','minute'],[70,'0:30','soon'],[85,'0:15','ending']]) {
    window.webContents.send('host:worship-playback', countdownState({ active: true, position, end: 100, duration: 300 }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const countdown = await window.webContents.executeJavaScript(`(() => ({
      hidden: document.getElementById('hostWorshipCountdown').classList.contains('hidden'),
      text: document.getElementById('hostWorshipRemaining').textContent,
      tone: document.getElementById('hostWorshipCountdown').dataset.tone,
      overflow: document.body.scrollWidth > document.body.clientWidth
    }))()`);
    assert.deepEqual(countdown, { hidden: false, text, tone, overflow: false });
  }
  window.webContents.send('host:worship-playback', countdownState({ active: true, position: 85, end: 105, duration: 300, paused: true }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('hostWorshipRemaining').textContent`), '0:20');
  assert.match(await window.webContents.executeJavaScript(`document.getElementById('hostWorshipLabel').textContent`), /已暫停/);
  await window.webContents.executeJavaScript(`window.scrollTo(0, 300)`);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const pinnedClock = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('.host-clock-bar').getBoundingClientRect();
    const countdown = document.getElementById('hostWorshipCountdown').getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, scroll: window.scrollY, countdownBottom: countdown.bottom };
  })()`);
  assert.ok(pinnedClock.scroll > 100, 'clock test must actually scroll the host console');
  assert.ok(Math.abs(pinnedClock.top) <= 1 && pinnedClock.bottom < 160 && pinnedClock.countdownBottom <= pinnedClock.bottom, 'clock and worship countdown must remain pinned at the viewport top');
  window.webContents.send('host:worship-playback', { active: false });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(await window.webContents.executeJavaScript(`getComputedStyle(document.getElementById('hostWorshipCountdown')).display`), 'none');
  if (process.env.HOST_PREVIEW_SECTION !== 'clock') await window.webContents.executeJavaScript(`window.scrollTo(0, 0)`);

  const removedMicrophoneControls = await window.webContents.executeJavaScript(`({
    panel: document.getElementById('microphoneMonitor'),
    settings: document.getElementById('zoomSettings'),
    connectApi: typeof window.hostApi.connectZoom
  })`);
  assert.deepEqual(removedMicrophoneControls, { panel: null, settings: null, connectApi: 'undefined' });

  if (!process.env.HOST_PREVIEW_ONLINE) {
    state = { ...state, snapshot: { ...state.snapshot, participants: state.snapshot.participants.filter((item) => item.sessionId !== 'p1') } };
    window.webContents.send('presence:state', state);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const departed = await window.webContents.executeJavaScript(`(() => ({
      offline: document.querySelector('#scriptureAssignments .assignment-card').classList.contains('offline'),
      notice: document.getElementById('notice').textContent
    }))()`);
    assert.equal(departed.offline, true);
    assert.match(departed.notice, /已離線/);

    state = {
      ...state,
      snapshot: {
        status: 'idle', meetingNumber: '77730692079', meetingUuid: 'meeting-1',
        peakParticipants: 8, participants: []
      }
    };
    window.webContents.send('presence:state', state);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const ended = await window.webContents.executeJavaScript(`(() => ({
      meeting: document.getElementById('meetingState').textContent,
      peak: document.getElementById('onlineCount').textContent
    }))()`);
    assert.equal(ended.meeting, 'Zoom 會議已結束・77730692079');
    assert.equal(ended.peak, '本次會議最高 8 人在線');
  }

  const outputPath = process.env.HOST_PREVIEW_OUTPUT;
  if (outputPath) {
    if (process.env.HOST_PREVIEW_SECTION === 'roster') {
      await window.webContents.executeJavaScript(`(() => {
        const roster = document.querySelector('.roster-overview');
        roster.open = true;
        roster.scrollIntoView({ block: 'start' });
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    } else if (process.env.HOST_PREVIEW_SECTION === 'utmost') {
      await window.webContents.executeJavaScript(`document.querySelector('.utmost-service').scrollIntoView({ block: 'start' })`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.resolve(outputPath), image.toPNG());
  }
  window.destroy();
  console.log('Host console layout test passed');
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
