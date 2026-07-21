import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyMeetingMutation,
  eventToMutation,
  hmacHex,
  normalizePersonName,
  parseRosterRows,
  parseScheduleRows,
  parseUtmostSharingRows,
  snapshotFromMeeting
} from '../src/shared.mjs';
import { MeetingPresence, verifiedZoomEvent } from '../src/index.mjs';

test('normalizes names without fuzzy matching', () => {
  assert.equal(normalizePersonName('  Ａmy   王  '), 'amy 王');
  assert.notEqual(normalizePersonName('王小明'), normalizePersonName('王小民'));
});

test('parses roster flags, aliases, ordering, and reports duplicate aliases', () => {
  const result = parseRosterRows([
    ['編號', '姓名', 'Zoom別名', '可讀經文', '可讀竭誠獻上', '啟用', '排序'],
    ['b', '王小明', '小明、Amy', '是', '否', '是', '2'],
    ['a', '林平安', 'Amy', '1', 'TRUE', '', '1'],
    ['off', '停用者', '', '是', '是', '否', '3']
  ]);
  assert.deepEqual(result.roster.map((item) => item.memberId), ['a', 'b', 'off']);
  assert.equal(result.roster[0].canReadScripture, true);
  assert.equal(result.roster[0].canReadUtmost, true);
  assert.match(result.errors.join('\n'), /amy/i);
});

test('parses exact-year and recurring schedule rows in Taipei time', () => {
  const date = new Date('2026-07-20T01:00:00.000Z');
  const result = parseScheduleRows([
    ['7/20', '詩篇', '一', '二', '三', '四'],
    ['2026/7/20', '提摩太前書', '五', '1', '五', '25']
  ], date, 'Asia/Taipei');
  assert.deepEqual(result, {
    ok: true,
    found: true,
    row: { book: '提摩太前書', startCh: 5, startV: 1, endCh: 5, endV: 25 }
  });
});

test('finds today and the next Utmost sharing assignment in horizontal week columns', () => {
  const rows = [
    [],
    [null, '第一週', '分享', '主持人', '第二週', '分享', '主持人'],
    [null, '7月20日', '今天分享者', null, '7月27日', '下週分享者', null]
  ];
  assert.deepEqual(parseUtmostSharingRows(rows, new Date('2026-07-20T04:00:00Z')), {
    found: true,
    date: '2026-07-20',
    sharer: '今天分享者',
    next: { date: '2026-07-27', sharer: '下週分享者' }
  });
});

test('filters webhook events by account and meeting number', () => {
  const payload = {
    event: 'meeting.participant_joined',
    event_ts: 100,
    payload: {
      account_id: 'account',
      object: {
        id: 77730692079,
        uuid: 'meeting-instance',
        participant: { participant_uuid: 'participant-1', user_id: 'connection-1', user_name: '王小明', join_time: '2026-07-20T01:00:00Z' }
      }
    }
  };
  assert.equal(eventToMutation(payload, 'wrong', '77730692079'), null);
  assert.equal(eventToMutation(payload, 'account', '123'), null);
  assert.deepEqual(eventToMutation(payload, 'account', '777 3069 2079'), {
    type: 'meeting.participant_joined',
    meetingNumber: '77730692079',
    meetingUuid: 'meeting-instance',
    eventTs: 100,
    participant: {
      sessionId: 'connection-1',
      displayName: '王小明',
      joinedAt: '2026-07-20T01:00:00Z'
    }
  });
});

test('keeps two connections from the same signed-in Zoom user', () => {
  const basePayload = {
    event: 'meeting.participant_joined',
    event_ts: 100,
    payload: {
      account_id: 'account',
      object: {
        id: 77730692079,
        uuid: 'meeting-instance',
        participant: {
          participant_uuid: 'shared-account-uuid',
          user_id: 'connection-1',
          user_name: 'Desktop',
          join_time: '2026-07-20T01:00:00Z'
        }
      }
    }
  };
  const secondPayload = structuredClone(basePayload);
  secondPayload.event_ts = 200;
  secondPayload.payload.object.participant.user_id = 'connection-2';
  secondPayload.payload.object.participant.user_name = 'Phone';
  secondPayload.payload.object.participant.join_time = '2026-07-20T01:01:00Z';

  const first = eventToMutation(basePayload, 'account', '77730692079');
  const second = eventToMutation(secondPayload, 'account', '77730692079');
  let state = applyMeetingMutation(null, {}, first);
  state = applyMeetingMutation(state.meeting, state.versions, second);

  assert.equal(snapshotFromMeeting(state.meeting).participants.length, 2);
});

test('maintains an idempotent meeting snapshot and keeps the final peak count', () => {
  const start = { type: 'meeting.started', meetingNumber: '777', meetingUuid: 'm1', eventTs: 10 };
  const joined = {
    type: 'meeting.participant_joined', meetingNumber: '777', meetingUuid: 'm1', eventTs: 20,
    participant: { sessionId: 'p1', displayName: '王小明', joinedAt: '' }
  };
  const staleLeave = { ...joined, type: 'meeting.participant_left', eventTs: 15 };
  const leave = { ...joined, type: 'meeting.participant_left', eventTs: 30 };
  let state = applyMeetingMutation(null, {}, start);
  state = applyMeetingMutation(state.meeting, state.versions, joined);
  assert.deepEqual(snapshotFromMeeting(state.meeting).participants.map((item) => item.displayName), ['王小明']);
  assert.equal(snapshotFromMeeting(state.meeting).peakParticipants, 1);
  state = applyMeetingMutation(state.meeting, state.versions, staleLeave);
  assert.equal(snapshotFromMeeting(state.meeting).participants.length, 1);
  state = applyMeetingMutation(state.meeting, state.versions, leave);
  assert.equal(snapshotFromMeeting(state.meeting).participants.length, 0);
  state = applyMeetingMutation(state.meeting, state.versions, { type: 'meeting.ended', meetingUuid: 'm1', eventTs: 40 });
  assert.equal(state.meeting.status, 'ended');
  assert.deepEqual(state.versions, {});
  assert.deepEqual(snapshotFromMeeting(state.meeting), {
    status: 'idle',
    meetingNumber: '777',
    meetingUuid: 'm1',
    peakParticipants: 1,
    participants: []
  });
});

test('generates Zoom-compatible HMAC values', async () => {
  assert.equal(
    await hmacHex('secret', 'value'),
    '50e03ebe65be98bb8bf11ba2c892d54c079aca2b0d3b0162769c6d757a25434f'
  );
});

test('validates Zoom webhook challenge and signed meeting events', async () => {
  const env = {
    ZOOM_WEBHOOK_SECRET: 'webhook-secret-long',
    ZOOM_ACCOUNT_ID: 'account',
    ZOOM_MEETING_NUMBER: '77730692079'
  };
  const challenge = await verifiedZoomEvent(new Request('https://example.test/zoom/webhook', {
    method: 'POST',
    body: JSON.stringify({ event: 'endpoint.url_validation', payload: { plainToken: 'plain' } })
  }), env);
  assert.equal(challenge.validation.plainToken, 'plain');
  assert.equal(challenge.validation.encryptedToken, await hmacHex('webhook-secret-long', 'plain'));

  const payload = JSON.stringify({
    event: 'meeting.started',
    event_ts: Date.now(),
    payload: { account_id: 'account', object: { id: 77730692079, uuid: 'meeting-1' } }
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${await hmacHex('webhook-secret-long', `v0:${timestamp}:${payload}`)}`;
  const verified = await verifiedZoomEvent(new Request('https://example.test/zoom/webhook', {
    method: 'POST',
    headers: { 'x-zm-request-timestamp': timestamp, 'x-zm-signature': signature },
    body: payload
  }), env);
  assert.equal(verified.mutation.type, 'meeting.started');
  assert.deepEqual(verified.diagnostic, {
    eventName: 'meeting.started',
    outcome: 'accepted',
    reason: 'accepted'
  });
  await assert.rejects(
    verifiedZoomEvent(new Request('https://example.test/zoom/webhook', {
      method: 'POST',
      headers: { 'x-zm-request-timestamp': timestamp, 'x-zm-signature': 'v0=bad' },
      body: payload
    }), env),
    /signature/i
  );
});

test('stores name-free webhook health counters', async () => {
  const values = new Map();
  const storage = {
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, value)
  };
  const presence = new MeetingPresence({ storage }, {});
  for (const entry of [
    { eventName: 'meeting.started', outcome: 'accepted', reason: 'accepted' },
    { eventName: 'meeting.participant_joined', outcome: 'ignored', reason: 'meeting_mismatch' },
    { eventName: 'webhook.error', outcome: 'error', reason: 'invalid_signature', participantName: '不應保存' }
  ]) {
    const response = await presence.recordDiagnostic(new Request('https://example.test/diagnostic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry)
    }));
    assert.equal(response.status, 200);
  }
  const diagnostics = await (await presence.diagnostics()).json();
  assert.equal(diagnostics.received, 3);
  assert.equal(diagnostics.accepted, 1);
  assert.equal(diagnostics.ignored, 1);
  assert.equal(diagnostics.errors, 1);
  assert.equal(diagnostics.byEvent['meeting.participant_joined'].lastReason, 'meeting_mismatch');
  assert.doesNotMatch(JSON.stringify(diagnostics), /不應保存/);
});

test('summarizes shared reading history without storing participant names', async () => {
  const values = new Map([
    ['assignmentHistory', {
      '2026-07-21': {
        hostA: { scripture: ['member-1'], utmost: [], updatedAt: '2026-07-21T01:00:00Z' }
      },
      '2026-07-22': {
        hostB: { scripture: [], utmost: ['member-2'], updatedAt: '2026-07-22T01:00:00Z' }
      }
    }]
  ]);
  const presence = new MeetingPresence({ storage: { get: async (key) => values.get(key) } }, {});
  const summary = await presence.assignmentSummary('hostB', '2026-07-22');
  assert.equal(summary.memberStats['member-1'].readYesterday, true);
  assert.equal(summary.memberStats['member-1'].totalCount, 1);
  assert.equal(summary.memberStats['member-2'].utmostCount, 1);
  assert.deepEqual(summary.currentAssignment, { scripture: [], utmost: ['member-2'] });
  assert.doesNotMatch(JSON.stringify(values.get('assignmentHistory')), /displayName|participantName/);
});

test('pairs seven hosts with independent device tokens', async () => {
  const values = new Map();
  const storage = {
    get: async (key) => values.get(key),
    put: async (key, value) => {
      if (typeof key === 'object' && value === undefined) {
        for (const [entryKey, entryValue] of Object.entries(key)) values.set(entryKey, entryValue);
      } else values.set(key, value);
    }
  };
  const presence = new MeetingPresence({ storage }, { INSTALL_KEY: 'this-is-a-long-install-key' });
  const tokens = new Set();
  for (let index = 1; index <= 7; index++) {
    const response = await presence.pair(new Request('https://example.test/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-ip': `192.0.2.${index}` },
      body: JSON.stringify({ installKey: 'this-is-a-long-install-key', label: `主持人 ${index}` })
    }));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    tokens.add(data.deviceToken);
  }
  assert.equal(tokens.size, 7);
  assert.equal(Object.keys(values.get('devices')).length, 7);
  const denied = await presence.pair(new Request('https://example.test/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-ip': '198.51.100.1' },
    body: JSON.stringify({ installKey: 'wrong-install-key', label: '攻擊者' })
  }));
  assert.equal(denied.status, 401);
});
