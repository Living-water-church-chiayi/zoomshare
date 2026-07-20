'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { buildRosterMatcher, deriveRosterPresence, normalizeDisplayName } = require('../src/presence-shared');
const { smartSegmentSizes, scriptureSegments, utmostParagraphSegments } = require('../src/assignment-shared');

const root = path.join(__dirname, '..');

test('intelligently divides scripture into readable 3-to-6 verse sections', () => {
  assert.deepEqual(smartSegmentSizes(12), [6, 6]);
  assert.deepEqual(smartSegmentSizes(13), [5, 5, 3]);
  assert.deepEqual(smartSegmentSizes(16), [5, 5, 6]);
  assert.deepEqual(scriptureSegments({ startCh: 1, startV: 9, endCh: 1, endV: 21 }, []), [
    { label: '9–13 節', start: { chapter: 1, verse: 9 }, end: { chapter: 1, verse: 13 }, count: 5 },
    { label: '14–18 節', start: { chapter: 1, verse: 14 }, end: { chapter: 1, verse: 18 }, count: 5 },
    { label: '19–21 節', start: { chapter: 1, verse: 19 }, end: { chapter: 1, verse: 21 }, count: 3 }
  ]);
});

test('keeps four Utmost slots while grouping the actual paragraphs', () => {
  assert.deepEqual(utmostParagraphSegments('一\n\n二\n\n三\n\n四\n\n五', 4).map((item) => item.label), [
    '第 1–2 段', '第 3 段', '第 4 段', '第 5 段'
  ]);
});

test('matches normalized Zoom names and aliases exactly', () => {
  const roster = [{
    memberId: 'member-1',
    name: '王小明',
    aliases: ['Amy 王'],
    canReadScripture: true,
    canReadUtmost: false,
    enabled: true,
    order: 1
  }];
  const snapshot = {
    status: 'active',
    participants: [
      { sessionId: 'a', displayName: '  ＡＭＹ   王 ' },
      { sessionId: 'b', displayName: '李小民' }
    ]
  };
  const derived = deriveRosterPresence(snapshot, roster);
  assert.equal(normalizeDisplayName('  ＡＭＹ   王 '), 'amy 王');
  assert.equal(derived.participants[0].memberId, 'member-1');
  assert.equal(derived.participants[1].memberId, '');
  assert.deepEqual(derived.scriptureCandidates.map((member) => member.memberId), ['member-1']);
  assert.equal(derived.utmostCandidates.length, 0);
});

test('matches unique consecutive Chinese name characters inside a longer Zoom name', () => {
  const roster = [
    {
      memberId: 'hui-zhen', name: '慧貞老師', aliases: ['慧貞'], canReadScripture: true,
      canReadUtmost: true, enabled: true, order: 1
    },
    {
      memberId: 'xian-tang', name: '献堂', aliases: ['羅爸爸', '献堂'], canReadScripture: true,
      canReadUtmost: true, enabled: true, order: 2
    }
  ];
  const derived = deriveRosterPresence({
    status: 'active',
    participants: [
      { sessionId: 'teacher', displayName: 'Teacher Amy 慧貞' },
      { sessionId: 'luo', displayName: '小組-献堂-手機' },
      { sessionId: 'generic', displayName: '今天代班老師' }
    ]
  }, roster);

  assert.equal(derived.participants[0].memberId, 'hui-zhen');
  assert.equal(derived.participants[1].memberId, 'xian-tang');
  assert.equal(derived.participants[2].memberId, '');
});

test('does not guess when the same two-character fragment belongs to multiple members', () => {
  const roster = [
    { memberId: 'a', name: '王小明', aliases: [], enabled: true },
    { memberId: 'b', name: '王小美', aliases: [], enabled: true }
  ];
  const matcher = buildRosterMatcher(roster);
  const derived = deriveRosterPresence({
    status: 'active', participants: [{ sessionId: 'guest', displayName: '訪客 王小 同學' }]
  }, roster);

  assert.equal(matcher.matchByHanToken.has('王小'), false);
  assert.match(matcher.errors.join('\n'), /王小/);
  assert.equal(derived.participants[0].memberId, '');
});

test('keeps a member online until all matching Zoom sessions leave', () => {
  const roster = [{
    memberId: 'member-1', name: '王小明', aliases: [], canReadScripture: true,
    canReadUtmost: true, enabled: true, order: 1
  }];
  const twoDevices = deriveRosterPresence({
    status: 'active',
    participants: [
      { sessionId: 'phone', displayName: '王小明' },
      { sessionId: 'computer', displayName: '王小明' }
    ]
  }, roster);
  assert.equal(twoDevices.onlineMembers.length, 1);
  const oneDevice = deriveRosterPresence({
    status: 'active', participants: [{ sessionId: 'computer', displayName: '王小明' }]
  }, roster);
  assert.equal(oneDevice.onlineMembers.length, 1);
  assert.equal(deriveRosterPresence({ status: 'active', participants: [] }, roster).onlineMembers.length, 0);
});

test('disables ambiguous aliases instead of guessing', () => {
  const roster = [
    { memberId: 'a', name: '甲', aliases: ['家用 iPad'], enabled: true },
    { memberId: 'b', name: '乙', aliases: ['家用 iPad'], enabled: true }
  ];
  const matcher = buildRosterMatcher(roster);
  assert.equal(matcher.matchByName.has('家用 ipad'), false);
  assert.match(matcher.errors.join('\n'), /家用 ipad/);
});

test('keeps device secrets out of renderer bridges', () => {
  const preload = fs.readFileSync(path.join(root, 'src', 'host', 'host-preload.js'), 'utf8');
  const presence = fs.readFileSync(path.join(root, 'src', 'presence.js'), 'utf8');
  assert.match(presence, /safeStorage\.encryptString/);
  assert.doesNotMatch(preload, /deviceToken|encryptedToken|safeStorage/);
  assert.match(presence, /authorization: `Bearer \$\{this\.device\.token\}`/);
});

test('host console is a separate locked-down renderer', () => {
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'host', 'index.html'), 'utf8');
  assert.match(main, /HOST_ENTRY_PATH/);
  assert.match(main, /contextIsolation: true,[\s\S]*?nodeIntegration: false,[\s\S]*?sandbox: true/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /id="scriptureAssignments"/);
  assert.match(html, /id="utmostAssignments"/);
  assert.match(html, /id="scriptureEligibleList"/);
  assert.match(html, /id="utmostEligibleList"/);
  assert.doesNotMatch(html, /id="slotPicker"/);
  assert.match(html, /id="allOnlineList"/);
});
