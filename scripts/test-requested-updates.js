'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DownloadProgress } = require('../src/download-progress');
const { parseTimeParts, playbackRange, envelopeVolume, moveMarker, countdownState } = require('../src/worship-shared');
const { deriveRosterPresence, readingCandidates, compareReadingPriority, DEFAULT_FULL_TIME_NAMES, defaultFullTimeMemberIds } = require('../src/presence-shared');

test('buffers split yt-dlp lines and tracks audio/video bytes without regressions or premature completion', () => {
  const events = [];
  const progress = new DownloadProgress((percent, phase) => events.push({ percent, phase }));
  const formats = '__LINGXIU_FORMATS__' + JSON.stringify([{ format_id: 'v', filesize: 900 }, { format_id: 'a', filesize: 100 }]) + '\n';
  const packet = (id, downloaded, total, status = 'downloading') => '__LINGXIU_PROGRESS__' + JSON.stringify({ format_id: id, downloaded, total, status }) + '\n';
  progress.consume(formats.slice(0, 9));
  progress.consume(formats.slice(9) + packet('v', 30, 900).slice(0, 18));
  progress.consume(packet('v', 30, 900).slice(18));
  progress.consume('[youtube] Downloading webpage\n', 'stderr');
  progress.consume(packet('v', 20, 1800)); // An estimate changed or a fragment retried.
  progress.consume(packet('v', 900, 900, 'finished'));
  progress.consume(packet('a', 5, 100));
  progress.consume('[Merger] Merging formats\n', 'stderr');
  progress.emit(0, 'retry');
  progress.consume(packet('a', 100, 100, 'finished'));
  assert.ok(events.some((event) => Math.abs(event.percent - 88.2) < .001));
  assert.ok(events.every((event, index) => index === 0 || event.percent >= events[index - 1].percent));
  assert.ok(events.every((event) => event.percent < 100));
  progress.emit(100, 'done');
  assert.equal(events.at(-1).percent, 100);
});

test('handles single-file and unknown-size downloads without parsing unrelated percentages', () => {
  const values = [];
  const progress = new DownloadProgress((percent) => values.push(percent));
  progress.consume('[download] 98% unrelated diagnostic\n');
  assert.deepEqual(values, []);
  progress.consume('__LINGXIU_FORMATS__null\n');
  progress.consume('__LINGXIU_PROGRESS__{"format_id":"single","status":"downloading","downloaded":5,"total":null,"estimate":null}\n');
  assert.equal(values.at(-1), 0);
  progress.consume('__LINGXIU_PROGRESS__{"format_id":"single","status":"finished","downloaded":5,"total":null,"estimate":null}');
  progress.flush();
  assert.equal(values.at(-1), 98);
});

test('HLS initialization byte estimates cannot pin video progress at 49 percent', () => {
  const events = [];
  const progress = new DownloadProgress((percent, phase, details) => events.push({ percent, phase, ...details }));
  progress.consume('__LINGXIU_FORMATS__' + JSON.stringify([
    { format_id: '616', filesize: null, filesize_approx: null },
    { format_id: '251', filesize: 4883469 }
  ]) + '\n');
  const packet = (downloaded, index, estimate) => progress.consume('__LINGXIU_PROGRESS__' + JSON.stringify({
    format_id: '616', downloaded, total: null, estimate, fragment_index: index, fragment_count: 53, status: 'downloading'
  }) + '\n');
  // Recorded from the affected video: 712 bytes is just its initialization fragment.
  packet(712, 0, 712);
  assert.equal(events.at(-1).percent, 0);
  packet(712, 1, 75472);
  assert.ok(events.at(-1).percent < 1);
  packet(39386731, 22, 39386731);
  const at22 = events.at(-1).percent;
  packet(48496425, 27, 48496425);
  assert.ok(events.at(-1).percent > at22);
  assert.ok(events.at(-1).percent < 30);
  assert.equal(events.at(-1).downloadedBytes, 48496425);
  packet(75986192, 43, 75986192);
  assert.ok(events.at(-1).percent > 39 && events.at(-1).percent < 40);
  packet(70000000, 42, 70000000); // A retried fragment cannot move the UI backwards.
  assert.equal(events.at(-1).downloadedBytes, 75986192);
  packet(91108257, 53, 91108257);
  progress.consume('__LINGXIU_PROGRESS__{"format_id":"616","downloaded":91108257,"total":91108257,"status":"finished"}\n');
  assert.equal(events.at(-1).percent, 49);
  progress.consume('__LINGXIU_PROGRESS__{"format_id":"251","downloaded":2441734,"total":4883469,"status":"downloading"}\n');
  assert.ok(events.at(-1).percent > 73 && events.at(-1).percent < 74);
  assert.equal(events.at(-1).downloadedBytes, 93549991);
  progress.consume('__LINGXIU_PROGRESS__{"format_id":"251","downloaded":4883469,"total":4883469,"status":"finished"}\n');
  assert.equal(events.at(-1).percent, 98);
  assert.ok(events.every((event, index) => index === 0 || event.percent >= events[index - 1].percent));
});

test('unknown totals report actual bytes rather than turning unstable estimates into percentages', () => {
  const events = [];
  const progress = new DownloadProgress((percent, phase, details) => events.push({ percent, ...details }));
  progress.consume('__LINGXIU_FORMATS__null\n');
  for (const downloaded of [712, 1000000, 4000000]) {
    progress.consume('__LINGXIU_PROGRESS__' + JSON.stringify({
      format_id: 'single', status: 'downloading', downloaded, total: null, estimate: downloaded
    }) + '\n');
    assert.equal(events.at(-1).percent, 0);
    assert.equal(events.at(-1).downloadedBytes, downloaded);
  }
});

test('parses start/end times, bounds a clip, and scales fades for short clips', () => {
  assert.equal(parseTimeParts('1', '25'), 85);
  assert.equal(parseTimeParts('', ''), null);
  assert.equal(parseTimeParts('2', ''), 120);
  assert.equal(parseTimeParts('', '5'), 5);
  assert.ok(Number.isNaN(parseTimeParts('1', '60')));
  assert.ok(Number.isNaN(parseTimeParts('-1', '20')));
  const range = playbackRange({ worshipStartSeconds: 85, worshipEndSeconds: 330, worshipFadeInSeconds: 2, worshipFadeOutSeconds: 3 }, 600);
  assert.equal(envelopeVolume(85, range), 0);
  assert.equal(envelopeVolume(86, range), .5);
  assert.equal(envelopeVolume(100, range), 1);
  assert.equal(envelopeVolume(328.5, range), .5);
  assert.equal(envelopeVolume(330, range), 0);
  assert.equal(playbackRange({ worshipStartSeconds: 0, worshipEndSeconds: 800 }, 100).end, 100);
  assert.throws(() => playbackRange({ worshipStartSeconds: 110 }, 100), /起訖時間/);
  const short = playbackRange({ worshipStartSeconds: 10, worshipEndSeconds: 12, worshipFadeInSeconds: 4, worshipFadeOutSeconds: 4 }, 100);
  assert.equal(short.fadeIn, 1);
  assert.equal(short.fadeOut, 1);
  assert.equal(envelopeVolume(11, short), 1);
});

test('keeps draggable markers ordered, within the original duration, and represents the full end as empty', () => {
  const config = { worshipStartSeconds: 85, worshipEndSeconds: 330 };
  assert.deepEqual(moveMarker(config, 600, 'in', 100), { worshipStartSeconds: 100, worshipEndSeconds: 330 });
  assert.equal(moveMarker(config, 600, 'in', 400).worshipStartSeconds, 329);
  assert.equal(moveMarker(config, 600, 'out', 20).worshipEndSeconds, 86);
  assert.equal(moveMarker(config, 600, 'out', 800).worshipEndSeconds, null);
  assert.equal(moveMarker(config, 600, 'in', -40).worshipStartSeconds, 0);
  assert.equal(moveMarker({worshipEndSeconds:null}, 6.04, 'in', 6).worshipStartSeconds, 5);
  assert.equal(moveMarker(config, Number.NaN, 'out', 100), null);
});

test('excludes both the host and sharer in both reading pools, preserving online matching', () => {
  const roster = ['host', 'sharer', 'reader', 'staff'].map((id, index) => ({
    memberId: id, name: id, enabled: true, aliases: [], canReadScripture: true, canReadUtmost: true, order: index, isFullTime: id === 'staff'
  }));
  const derived = deriveRosterPresence({ participants: roster.map((member) => ({ displayName: member.name })) }, roster);
  for (const kind of ['scripture', 'utmost']) {
    assert.deepEqual(readingCandidates(kind, derived, ['host', 'sharer']).map((member) => member.memberId), ['reader', 'staff']);
  }
  assert.deepEqual(readingCandidates('utmost', derived, ['host', 'sharer'], ['reader']).map((member) => member.memberId), ['staff']);
  const stats = (id) => ({ totalCount: id === 'reader' ? 4 : 0, readYesterday: false });
  const sorted = [...derived.onlineMembers].sort((a, b) => compareReadingPriority(a, b, stats));
  assert.equal(sorted.at(-1).memberId, 'reader', 'unread staff must precede readers who already read this week');
  assert.ok(sorted.findIndex((member) => member.memberId === 'staff') > sorted.findIndex((member) => member.memberId === 'host'));
});

test('marks the seven requested full-time coworkers by roster identity, including future roster additions', () => {
  const roster = DEFAULT_FULL_TIME_NAMES.map((name, index) => ({ memberId: String(index), name, aliases: [], enabled: true }));
  assert.equal(defaultFullTimeMemberIds(roster).size, 7);
  assert.equal(defaultFullTimeMemberIds(roster.slice(0, 5)).size, 5);
  const ids = defaultFullTimeMemberIds([...roster, { memberId: 'lay', name: '信二', aliases: [], enabled: true }]);
  assert.ok(!ids.has('lay'));
});

test('unread full-time coworkers follow other unread readers but precede yesterday readers', () => {
  const members = [
    { memberId: 'yesterday', name: '昨天已讀', order: 1 },
    { memberId: 'already', name: '本週已讀', order: 1 },
    { memberId: 'staff', name: '全職同工', isFullTime: true, order: 2 },
    { memberId: 'reader', name: '其他弟兄姊妹', order: 3 }
  ];
  const stats = (id) => ({ readYesterday: id === 'yesterday', totalCount: ['already', 'yesterday'].includes(id) ? 1 : 0 });
  assert.deepEqual(members.sort((a, b) => compareReadingPriority(a, b, stats)).map((member) => member.memberId),
    ['reader', 'staff', 'already', 'yesterday']);
});

test('worship countdown follows the actual out point, pauses, seeks and threshold boundaries', () => {
  assert.deepEqual(countdownState(null), { active: false });
  assert.deepEqual(countdownState({ active: false, position: 1, end: 100, duration: 300 }), { active: false });
  assert.equal(countdownState({ active: true, position: null, end: null, duration: null }).remainingSeconds, null);
  const base = { active: true, position: 0, end: 100, duration: 300, paused: false };
  for (const [position, seconds, tone] of [[39,61,'normal'],[40,60,'minute'],[69,31,'minute'],[70,30,'soon'],[84,16,'soon'],[85,15,'ending'],[110,0,'ending']]) {
    const state = countdownState({ ...base, position });
    assert.equal(state.remainingSeconds, seconds);
    assert.equal(state.tone, tone);
  }
  assert.equal(countdownState({ ...base, position: 50.2 }).remainingSeconds, 50);
  assert.equal(countdownState({ ...base, position: 50, paused: true }).paused, true);
  assert.equal(countdownState({ ...base, position: 50, end: 80 }).remainingSeconds, 30);
  assert.equal(countdownState({ ...base, position: 20 }).remainingSeconds, 80);
  assert.equal(countdownState({ ...base, position: 90, end: 600 }).remainingSeconds, 210);
});
