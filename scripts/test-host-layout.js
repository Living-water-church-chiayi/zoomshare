'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const projectRoot = path.join(__dirname, '..');
app.commandLine.appendSwitch('disable-gpu');

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
  schedule: { ok: true, found: true, row: { book: 'Test', startCh: 1, startV: 9, endCh: 1, endV: 21 } },
  utmostSharing: { found: true, date: '2026-07-20', sharer: '今日分享者', next: null, error: '' },
  assignmentStats: {
    date: '2026-07-20', weekStart: '2026-07-20', yesterday: '2026-07-19', memberStats: {},
    currentAssignment: { scripture: [], utmost: [] }
  },
  snapshot: {
    status: 'active',
    meetingNumber: '77730692079',
    meetingUuid: 'meeting-1',
    participants: [
      { sessionId: 'p1', displayName: '王小明', joinedAt: '' },
      { sessionId: 'p2', displayName: '林平安', joinedAt: '' },
      { sessionId: 'p3', displayName: '訪客 iPad', joinedAt: '' },
      { sessionId: 'p4', displayName: '今日分享者', joinedAt: '' }
    ]
  }
};

async function run() {
  ipcMain.handle('presence:state', () => state);
  ipcMain.handle('presence:refresh', () => state);
  ipcMain.handle('presence:unpair', () => state);
  ipcMain.handle('presence:pair', () => state);
  ipcMain.handle('presence:assignments', () => state);
  ipcMain.handle('host:utmost-today', () => ({ ok: true, body: '第一段\n\n第二段\n\n第三段\n\n第四段' }));
  ipcMain.handle('host:scripture-current', () => ({ book: '提摩太前書', startCh: 6, startV: 9, endCh: 6, endV: 21 }));
  ipcMain.handle('host:close', () => ({ ok: true }));

  const window = new BrowserWindow({
    width: 460,
    height: 760,
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
  const initial = await window.webContents.executeJavaScript(`(() => ({
    setupHidden: document.getElementById('setupView').classList.contains('hidden'),
    consoleVisible: !document.getElementById('consoleView').classList.contains('hidden'),
    scriptureSlots: document.querySelectorAll('#scriptureAssignments .assignment-card').length,
    utmostSlots: document.querySelectorAll('#utmostAssignments .assignment-card').length,
    sharingName: document.getElementById('todaySharingName').textContent,
    onlineRows: document.querySelectorAll('#allOnlineList .online-row').length,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth
  }))()`);
  assert.equal(initial.setupHidden, true);
  assert.equal(initial.consoleVisible, true);
  assert.equal(initial.scriptureSlots, 3);
  assert.equal(initial.utmostSlots, 4);
  assert.equal(initial.sharingName, '今日分享者');
  assert.equal(initial.onlineRows, 4);
  assert.ok(initial.bodyScrollWidth <= initial.bodyClientWidth, 'host console overflows horizontally');

  await window.webContents.executeJavaScript(`document.querySelector('#scriptureAssignments .assignment-card').click()`);
  const inlineCandidates = await window.webContents.executeJavaScript(`(() => ({
    modalRemoved: document.getElementById('slotPicker') === null,
    target: document.getElementById('scriptureTargetSummary').textContent,
    candidateCount: document.querySelectorAll('#scriptureEligibleList .candidate-button').length,
    details: document.querySelector('#scriptureEligibleList .candidate-button small').textContent
  }))()`);
  assert.equal(inlineCandidates.modalRemoved, true);
  assert.match(inlineCandidates.target, /9–13/);
  assert.equal(inlineCandidates.candidateCount, 1);
  assert.match(inlineCandidates.details, /昨天/);
  assert.match(inlineCandidates.details, /本週/);
  await window.webContents.executeJavaScript(`document.querySelector('#scriptureEligibleList .candidate-button').click()`);
  const selected = await window.webContents.executeJavaScript(`document.querySelector('#scriptureAssignments .assignment-card strong').textContent`);
  assert.equal(selected, '王小明');

  await window.webContents.executeJavaScript(`document.querySelector('#utmostAssignments .assignment-card').click()`);
  const utmostCandidateIds = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#utmostEligibleList .candidate-button'), (item) => item.dataset.memberId)`);
  assert.deepEqual(utmostCandidateIds, ['utmost']);

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
  }

  const outputPath = process.env.HOST_PREVIEW_OUTPUT;
  if (outputPath) {
    if (process.env.HOST_PREVIEW_SECTION === 'utmost') {
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
