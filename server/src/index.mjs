import {
  applyMeetingMutation,
  constantTimeEqual,
  datePartsInTimeZone,
  eventToMutation,
  hmacHex,
  normalizeMeetingNumber,
  snapshotFromMeeting
} from './shared.mjs';
import { loadSheetBootstrap } from './google-sheets.mjs';

const DIAGNOSTIC_EVENT_NAMES = new Set([
  'meeting.started',
  'meeting.ended',
  'meeting.participant_joined',
  'meeting.participant_left',
  'webhook.error'
]);
const DIAGNOSTIC_OUTCOMES = new Set(['accepted', 'ignored', 'error']);

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});

function bearerToken(request) {
  const match = String(request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function isoDateAt(date, timeZone = 'Asia/Taipei') {
  const parts = datePartsInTimeZone(date, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function shiftIsoDate(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function validMemberIds(value, maximum) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter((item) => item && item.length <= 100))].slice(0, maximum);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function zoomDiagnostic(payload, mutation, env) {
  const eventName = DIAGNOSTIC_EVENT_NAMES.has(String(payload && payload.event || ''))
    ? String(payload.event)
    : 'other';
  if (mutation) return { eventName, outcome: 'accepted', reason: 'accepted' };
  const object = payload && payload.payload && payload.payload.object;
  if (!object || typeof object !== 'object') return { eventName, outcome: 'ignored', reason: 'missing_object' };
  if (String(payload.payload.account_id || '') !== String(env.ZOOM_ACCOUNT_ID || '')) {
    return { eventName, outcome: 'ignored', reason: 'account_mismatch' };
  }
  if (normalizeMeetingNumber(object.id) !== normalizeMeetingNumber(env.ZOOM_MEETING_NUMBER)) {
    return { eventName, outcome: 'ignored', reason: 'meeting_mismatch' };
  }
  if (!['meeting.started', 'meeting.ended', 'meeting.participant_joined', 'meeting.participant_left'].includes(eventName)) {
    return { eventName, outcome: 'ignored', reason: 'unsupported_event' };
  }
  if (eventName.includes('participant_')) {
    const participant = object.participant || {};
    if (!participant.participant_uuid && !participant.user_id) {
      return { eventName, outcome: 'ignored', reason: 'missing_participant_session' };
    }
  }
  return { eventName, outcome: 'ignored', reason: 'invalid_event' };
}

function webhookErrorReason(error) {
  const message = String(error && error.message || '');
  if (/signature/i.test(message)) return 'invalid_signature';
  if (/stale/i.test(message)) return 'stale_request';
  if (/json/i.test(message)) return 'invalid_json';
  if (/too large/i.test(message)) return 'payload_too_large';
  return 'verification_error';
}

export async function verifiedZoomEvent(request, env) {
  if (!env.ZOOM_WEBHOOK_SECRET || String(env.ZOOM_WEBHOOK_SECRET).length < 16) throw new Error('Webhook secret is not configured');
  if (!env.ZOOM_ACCOUNT_ID || !env.ZOOM_MEETING_NUMBER) throw new Error('Zoom account or meeting is not configured');
  const body = await request.text();
  if (body.length > 512 * 1024) throw new Error('Webhook body too large');
  let payload;
  try { payload = JSON.parse(body); } catch { throw new Error('Invalid JSON'); }
  if (payload.event === 'endpoint.url_validation') {
    const plainToken = String(payload.payload && payload.payload.plainToken || '');
    if (!plainToken) throw new Error('Missing validation token');
    return { validation: { plainToken, encryptedToken: await hmacHex(env.ZOOM_WEBHOOK_SECRET, plainToken) } };
  }
  const timestamp = String(request.headers.get('x-zm-request-timestamp') || '');
  const signature = String(request.headers.get('x-zm-signature') || '');
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) throw new Error('Stale webhook');
  const expected = `v0=${await hmacHex(env.ZOOM_WEBHOOK_SECRET, `v0:${timestamp}:${body}`)}`;
  if (!constantTimeEqual(signature, expected)) throw new Error('Invalid webhook signature');
  const mutation = eventToMutation(payload, env.ZOOM_ACCOUNT_ID, env.ZOOM_MEETING_NUMBER);
  return { mutation, diagnostic: zoomDiagnostic(payload, mutation, env) };
}

export class MeetingPresence {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async state() {
    const [meeting, versions] = await Promise.all([
      this.ctx.storage.get('meeting'),
      this.ctx.storage.get('versions')
    ]);
    return { meeting: meeting || null, versions: versions || {} };
  }

  async snapshot() {
    const { meeting } = await this.state();
    return snapshotFromMeeting(meeting);
  }

  async authorizedDevice(request) {
    const token = bearerToken(request);
    if (!token) return null;
    const devices = await this.ctx.storage.get('devices') || {};
    const tokenHash = await sha256(token);
    const entry = Object.entries(devices).find(([, device]) => constantTimeEqual(device.tokenHash, tokenHash));
    return entry ? { deviceId: entry[0], ...entry[1] } : null;
  }

  async authorized(request) {
    return Boolean(await this.authorizedDevice(request));
  }

  async unpair(request) {
    const token = bearerToken(request);
    if (!token) return json({ ok: false, error: '裝置尚未配對' }, 401);
    const tokenHash = await sha256(token);
    const devices = await this.ctx.storage.get('devices') || {};
    const entry = Object.entries(devices).find(([, device]) => constantTimeEqual(device.tokenHash, tokenHash));
    if (!entry) return json({ ok: false, error: '裝置尚未配對' }, 401);
    delete devices[entry[0]];
    await this.ctx.storage.put('devices', devices);
    return json({ ok: true });
  }

  async pair(request) {
    if (!this.env.INSTALL_KEY || String(this.env.INSTALL_KEY).length < 16) {
      return json({ ok: false, error: '伺服器安裝金鑰尚未設定' }, 503);
    }
    const ip = String(request.headers.get('x-client-ip') || 'unknown').slice(0, 128);
    const now = Date.now();
    const attempts = await this.ctx.storage.get('pairAttempts') || {};
    const recent = (attempts[ip] || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
    if (recent.length >= 10) return json({ ok: false, error: '配對嘗試過多，請稍後再試' }, 429);
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: '配對資料格式不正確' }, 400); }
    if (!constantTimeEqual(body.installKey || '', this.env.INSTALL_KEY || '')) {
      attempts[ip] = [...recent, now];
      const keys = Object.keys(attempts);
      if (keys.length > 1000) {
        for (const key of keys.slice(0, keys.length - 1000)) delete attempts[key];
      }
      await this.ctx.storage.put('pairAttempts', attempts);
      return json({ ok: false, error: '安裝金鑰不正確' }, 401);
    }
    delete attempts[ip];
    await this.ctx.storage.put('pairAttempts', attempts);
    const devices = await this.ctx.storage.get('devices') || {};
    if (Object.keys(devices).length >= 20) return json({ ok: false, error: '已達裝置數量上限' }, 409);
    const deviceId = crypto.randomUUID();
    const deviceToken = randomToken();
    devices[deviceId] = {
      deviceId,
      label: String(body.label || '主持人電腦').trim().slice(0, 80),
      tokenHash: await sha256(deviceToken),
      createdAt: new Date().toISOString()
    };
    await this.ctx.storage.put('devices', devices);
    return json({ ok: true, deviceId, deviceToken });
  }

  async mutate(request) {
    const mutation = await request.json();
    const current = await this.state();
    const result = applyMeetingMutation(current.meeting, current.versions, mutation);
    if (result.changed) {
      if (result.meeting) {
        await this.ctx.storage.put({ meeting: result.meeting, versions: result.versions });
        await this.ctx.storage.setAlarm(Date.now() + 6 * 60 * 60 * 1000);
      } else {
        await this.ctx.storage.delete(['meeting', 'versions']);
        await this.ctx.storage.deleteAlarm();
      }
      this.broadcast(snapshotFromMeeting(result.meeting));
    }
    return json({ ok: true });
  }

  async recordDiagnostic(request) {
    const body = await request.json();
    const eventName = DIAGNOSTIC_EVENT_NAMES.has(String(body.eventName || '')) ? String(body.eventName) : 'other';
    const outcome = DIAGNOSTIC_OUTCOMES.has(String(body.outcome || '')) ? String(body.outcome) : 'error';
    const reason = String(body.reason || 'unknown').replace(/[^a-z0-9_]/gi, '').slice(0, 64) || 'unknown';
    const now = new Date().toISOString();
    const diagnostics = await this.ctx.storage.get('diagnostics') || {
      received: 0,
      accepted: 0,
      ignored: 0,
      errors: 0,
      byEvent: {}
    };
    diagnostics.received = Number(diagnostics.received || 0) + 1;
    diagnostics[outcome === 'error' ? 'errors' : outcome] = Number(diagnostics[outcome === 'error' ? 'errors' : outcome] || 0) + 1;
    const eventStats = diagnostics.byEvent[eventName] || { received: 0, accepted: 0, ignored: 0, errors: 0 };
    eventStats.received += 1;
    eventStats[outcome === 'error' ? 'errors' : outcome] += 1;
    eventStats.lastAt = now;
    eventStats.lastOutcome = outcome;
    eventStats.lastReason = reason;
    diagnostics.byEvent[eventName] = eventStats;
    diagnostics.lastEventAt = now;
    diagnostics.lastEvent = eventName;
    diagnostics.lastOutcome = outcome;
    diagnostics.lastReason = reason;
    await this.ctx.storage.put('diagnostics', diagnostics);
    return json({ ok: true });
  }

  async diagnostics() {
    const diagnostics = await this.ctx.storage.get('diagnostics') || {
      received: 0,
      accepted: 0,
      ignored: 0,
      errors: 0,
      byEvent: {},
      lastEventAt: ''
    };
    const snapshot = await this.snapshot();
    return json({
      ...diagnostics,
      meetingStatus: snapshot.status,
      currentOnline: snapshot.participants.length
    });
  }

  async assignmentSummary(deviceId, today = isoDateAt(new Date(), this.env.APP_TIME_ZONE || 'Asia/Taipei')) {
    const history = await this.ctx.storage.get('assignmentHistory') || {};
    const weekStart = mondayOf(today);
    const yesterday = shiftIsoDate(today, -1);
    const memberStats = {};
    const counted = new Set();
    const ensure = (memberId) => {
      if (!memberStats[memberId]) {
        memberStats[memberId] = {
          scriptureCount: 0,
          utmostCount: 0,
          totalCount: 0,
          readYesterday: false,
          yesterdayRoles: [],
          lastReadDate: ''
        };
      }
      return memberStats[memberId];
    };

    for (const [date, deviceRecords] of Object.entries(history)) {
      if (date > today || !deviceRecords || typeof deviceRecords !== 'object') continue;
      for (const record of Object.values(deviceRecords)) {
        for (const role of ['scripture', 'utmost']) {
          for (const memberId of validMemberIds(record && record[role], role === 'scripture' ? 20 : 4)) {
            const stats = ensure(memberId);
            if (!stats.lastReadDate || date > stats.lastReadDate) stats.lastReadDate = date;
            if (date === yesterday) {
              stats.readYesterday = true;
              if (!stats.yesterdayRoles.includes(role)) stats.yesterdayRoles.push(role);
            }
            if (date < weekStart || date > today) continue;
            const countKey = `${date}:${role}:${memberId}`;
            if (counted.has(countKey)) continue;
            counted.add(countKey);
            if (role === 'scripture') stats.scriptureCount += 1;
            else stats.utmostCount += 1;
            stats.totalCount += 1;
          }
        }
      }
    }

    const current = history[today] && history[today][deviceId];
    return {
      date: today,
      weekStart,
      yesterday,
      memberStats,
      currentAssignment: {
        scripture: validMemberIds(current && current.scripture, 20),
        utmost: validMemberIds(current && current.utmost, 4)
      }
    };
  }

  async recordAssignments(request) {
    const device = await this.authorizedDevice(request);
    if (!device) return json({ ok: false, error: '裝置授權無效' }, 401);
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: '安排資料格式錯誤' }, 400); }
    const today = isoDateAt(new Date(), this.env.APP_TIME_ZONE || 'Asia/Taipei');
    if (String(body.date || '') !== today) return json({ ok: false, error: '只能更新今天的閱讀安排' }, 400);
    const history = await this.ctx.storage.get('assignmentHistory') || {};
    const scripture = validMemberIds(body.scripture, 20);
    const utmost = validMemberIds(body.utmost, 4);
    if (!history[today] || typeof history[today] !== 'object') history[today] = {};
    if (scripture.length || utmost.length) {
      history[today][device.deviceId] = { scripture, utmost, updatedAt: new Date().toISOString() };
    } else delete history[today][device.deviceId];
    if (!Object.keys(history[today]).length) delete history[today];
    const cutoff = shiftIsoDate(today, -42);
    for (const date of Object.keys(history)) {
      if (date < cutoff || date > today) delete history[date];
    }
    await this.ctx.storage.put('assignmentHistory', history);
    return json({ ok: true, assignmentStats: await this.assignmentSummary(device.deviceId, today) });
  }

  async bootstrap(request) {
    if (!await this.authorized(request)) return json({ ok: false, error: '裝置尚未配對' }, 401);
    const device = await this.authorizedDevice(request);
    let sheetData;
    try {
      sheetData = await loadSheetBootstrap(this.env);
      await this.ctx.storage.put('bootstrapCache', sheetData);
    } catch (error) {
      const cached = await this.ctx.storage.get('bootstrapCache');
      if (!cached) return json({ ok: false, error: error.message, snapshot: await this.snapshot() }, 503);
      sheetData = { ...cached, stale: true, error: error.message };
    }
    return json({
      ok: true,
      ...sheetData,
      assignmentStats: await this.assignmentSummary(device.deviceId),
      snapshot: await this.snapshot()
    });
  }

  async live(request) {
    if (!await this.authorized(request)) return json({ ok: false, error: '裝置尚未配對' }, 401);
    if (request.headers.get('upgrade') !== 'websocket') return json({ ok: false, error: '需要 WebSocket' }, 426);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connectedAt: Date.now() });
    server.send(JSON.stringify({ type: 'snapshot', snapshot: await this.snapshot() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(snapshot) {
    const message = JSON.stringify({ type: 'snapshot', snapshot });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(message); } catch {}
    }
  }

  async alarm() {
    await this.ctx.storage.delete(['meeting', 'versions']);
    this.broadcast(snapshotFromMeeting(null));
  }

  webSocketMessage(socket, message) {
    if (String(message) === 'ping') socket.send('pong');
  }

  webSocketClose(socket, code, reason) {
    try { socket.close(code, reason); } catch {}
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/pair' && request.method === 'POST') return this.pair(request);
    if (path === '/device' && request.method === 'DELETE') return this.unpair(request);
    if (path === '/event' && request.method === 'POST') return this.mutate(request);
    if (path === '/diagnostic' && request.method === 'POST') return this.recordDiagnostic(request);
    if (path === '/diagnostics' && request.method === 'GET') return this.diagnostics();
    if (path === '/bootstrap' && request.method === 'GET') return this.bootstrap(request);
    if (path === '/assignments' && request.method === 'POST') return this.recordAssignments(request);
    if (path === '/live' && request.method === 'GET') return this.live(request);
    return json({ ok: false, error: 'Not found' }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const object = env.MEETING_PRESENCE.getByName('church');
    if (url.pathname === '/health' && request.method === 'GET') {
      const diagnosticsResponse = await object.fetch(new Request('https://presence.internal/diagnostics'));
      return json({ ok: true, service: 'lingxiu-presence', zoom: await diagnosticsResponse.json() });
    }
    if (url.pathname === '/zoom/webhook' && request.method === 'POST') {
      try {
        const verified = await verifiedZoomEvent(request, env);
        if (verified.validation) return json(verified.validation);
        await object.fetch(new Request('https://presence.internal/diagnostic', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(verified.diagnostic)
        }));
        if (!verified.mutation) return json({ ok: true, ignored: true });
        return object.fetch(new Request('https://presence.internal/event', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(verified.mutation)
        }));
      } catch (error) {
        await object.fetch(new Request('https://presence.internal/diagnostic', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ eventName: 'webhook.error', outcome: 'error', reason: webhookErrorReason(error) })
        })).catch(() => {});
        return json({ ok: false, error: error.message }, 401);
      }
    }
    if (url.pathname === '/v1/devices/pair' && request.method === 'POST') {
      const headers = new Headers(request.headers);
      headers.set('x-client-ip', request.headers.get('cf-connecting-ip') || 'unknown');
      return object.fetch(new Request('https://presence.internal/pair', { method: 'POST', headers, body: request.body }));
    }
    if (url.pathname === '/v1/bootstrap' && request.method === 'GET') {
      return object.fetch(new Request('https://presence.internal/bootstrap', { method: 'GET', headers: request.headers }));
    }
    if (url.pathname === '/v1/assignments' && request.method === 'POST') {
      return object.fetch(new Request('https://presence.internal/assignments', {
        method: 'POST',
        headers: request.headers,
        body: request.body
      }));
    }
    if (url.pathname === '/v1/devices/current' && request.method === 'DELETE') {
      return object.fetch(new Request('https://presence.internal/device', { method: 'DELETE', headers: request.headers }));
    }
    if (url.pathname === '/v1/live' && request.method === 'GET') {
      return object.fetch(new Request('https://presence.internal/live', { method: 'GET', headers: request.headers }));
    }
    return json({ ok: false, error: 'Not found' }, 404);
  }
};
