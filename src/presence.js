'use strict';

const { app, safeStorage } = require('electron');
const { EventEmitter } = require('events');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const WebSocket = require('ws');

const EMPTY_SNAPSHOT = Object.freeze({ status: 'idle', meetingNumber: '', meetingUuid: '', peakParticipants: 0, participants: [] });
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SCHEDULE_CACHE_TTL_MS = 5 * 60 * 1000;
const APP_TIME_ZONE = 'Asia/Taipei';

function appDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function createScheduleCacheEntry(value, now = new Date()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    ...JSON.parse(JSON.stringify(value)),
    date: appDateKey(now),
    cachedAt: now.toISOString()
  };
}

function validScheduleCache(value, now = new Date()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (String(value.date || '') !== appDateKey(now)) return null;
  const cachedAt = Date.parse(String(value.cachedAt || ''));
  if (!Number.isFinite(cachedAt)) return null;
  const age = now.getTime() - cachedAt;
  if (age < -60_000 || age > SCHEDULE_CACHE_TTL_MS) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizeServiceUrl(value, allowLocalHttp = false) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); }
  catch { throw new Error('服務網址格式不正確'); }
  const localHttp = allowLocalHttp && parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !localHttp) throw new Error('服務網址必須使用 HTTPS');
  if (parsed.username || parsed.password) throw new Error('服務網址不可包含帳號或密碼');
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.href.replace(/\/$/, '');
}

function validSnapshot(value) {
  if (!value || typeof value !== 'object' || !['idle', 'active'].includes(value.status)) return { ...EMPTY_SNAPSHOT };
  const participants = Array.isArray(value.participants) ? value.participants.slice(0, 1000).flatMap((participant) => {
    if (!participant || typeof participant !== 'object') return [];
    const sessionId = String(participant.sessionId || '').slice(0, 256);
    if (!sessionId) return [];
    return [{
      sessionId,
      displayName: String(participant.displayName || '').trim().slice(0, 200),
      joinedAt: String(participant.joinedAt || '').slice(0, 64)
    }];
  }) : [];
  return {
    status: value.status,
    meetingNumber: String(value.meetingNumber || '').replace(/\D/g, '').slice(0, 32),
    meetingUuid: String(value.meetingUuid || '').slice(0, 256),
    peakParticipants: Math.max(0, Math.min(1000, Number.parseInt(value.peakParticipants, 10) || participants.length)),
    participants
  };
}

function validRoster(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((member) => {
    if (!member || typeof member !== 'object') return [];
    const memberId = String(member.memberId || '').trim().slice(0, 100);
    const name = String(member.name || '').trim().slice(0, 100);
    if (!memberId || !name) return [];
    return [{
      memberId,
      name,
      aliases: Array.isArray(member.aliases) ? member.aliases.slice(0, 20).map((item) => String(item).trim().slice(0, 100)).filter(Boolean) : [],
      canReadScripture: member.canReadScripture === true,
      canReadUtmost: member.canReadUtmost === true,
      enabled: member.enabled === true,
      order: Number.isFinite(Number(member.order)) ? Number(member.order) : 0
    }];
  });
}

function validUtmostSharing(value) {
  if (!value || typeof value !== 'object') return { found: false, date: '', sharer: '', next: null, error: '' };
  const next = value.next && typeof value.next === 'object' ? {
    date: String(value.next.date || '').slice(0, 10),
    sharer: String(value.next.sharer || '').trim().slice(0, 120)
  } : null;
  return {
    found: value.found === true,
    date: String(value.date || '').slice(0, 10),
    sharer: String(value.sharer || '').trim().slice(0, 120),
    next: next && next.date && next.sharer ? next : null,
    error: String(value.error || '').slice(0, 300)
  };
}

function validAssignmentStats(value) {
  const empty = { date: '', weekStart: '', yesterday: '', memberStats: {}, currentAssignment: { scripture: [], utmost: [] } };
  if (!value || typeof value !== 'object') return empty;
  const memberStats = {};
  for (const [memberId, stats] of Object.entries(value.memberStats || {}).slice(0, 500)) {
    const id = String(memberId || '').trim().slice(0, 100);
    if (!id || !stats || typeof stats !== 'object') continue;
    memberStats[id] = {
      scriptureCount: Math.max(0, Number(stats.scriptureCount) || 0),
      utmostCount: Math.max(0, Number(stats.utmostCount) || 0),
      totalCount: Math.max(0, Number(stats.totalCount) || 0),
      readYesterday: stats.readYesterday === true,
      yesterdayRoles: Array.isArray(stats.yesterdayRoles) ? stats.yesterdayRoles.filter((role) => role === 'scripture' || role === 'utmost') : [],
      lastReadDate: String(stats.lastReadDate || '').slice(0, 10)
    };
  }
  const current = value.currentAssignment && typeof value.currentAssignment === 'object' ? value.currentAssignment : {};
  const ids = (items, maximum) => [...new Set((Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean))].slice(0, maximum);
  return {
    date: String(value.date || '').slice(0, 10),
    weekStart: String(value.weekStart || '').slice(0, 10),
    yesterday: String(value.yesterday || '').slice(0, 10),
    memberStats,
    currentAssignment: { scripture: ids(current.scripture, 20), utmost: ids(current.utmost, 4) }
  };
}

async function responseJsonLimited(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error('服務回應過大');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('服務回應過大');
  try { return JSON.parse(text); } catch { throw new Error('服務回應格式不正確'); }
}

async function writePrivateJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(tempPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    if (process.platform === 'win32' && fs.existsSync(filePath)) {
      const backup = `${filePath}.bak`;
      await fsp.unlink(backup).catch(() => {});
      await fsp.rename(filePath, backup);
      try { await fsp.rename(tempPath, filePath); }
      catch (error) { await fsp.rename(backup, filePath).catch(() => {}); throw error; }
      await fsp.unlink(backup).catch(() => {});
    } else {
      await fsp.rename(tempPath, filePath);
    }
  } finally {
    await fsp.unlink(tempPath).catch(() => {});
  }
}

class PresenceManager extends EventEmitter {
  constructor() {
    super();
    this.device = null;
    this.socket = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.connectedOnce = false;
    this.bootstrapRefreshPromise = null;
    this.bootstrapGeneration = 0;
    this.scheduleExpiryTimer = null;
    this.stopped = true;
    this.state = {
      configured: false,
      serviceUrl: '',
      deviceLabel: '',
      connection: 'unconfigured',
      error: '',
      stale: false,
      fetchedAt: '',
      snapshot: { ...EMPTY_SNAPSHOT },
      roster: [],
      rosterErrors: [],
      schedule: null,
      utmostSharing: validUtmostSharing(null),
      assignmentStats: validAssignmentStats(null)
    };
  }

  devicePath() { return path.join(app.getPath('userData'), 'presence-device.json'); }
  cachePath() { return path.join(app.getPath('userData'), 'presence-cache.json'); }

  cachePayload() {
    return {
      roster: this.state.roster,
      rosterErrors: this.state.rosterErrors,
      schedule: this.state.schedule,
      utmostSharing: this.state.utmostSharing,
      assignmentStats: this.state.assignmentStats,
      fetchedAt: this.state.fetchedAt
    };
  }

  persistCache() {
    return writePrivateJson(this.cachePath(), this.cachePayload());
  }

  armScheduleExpiry(schedule = this.state.schedule, now = new Date()) {
    clearTimeout(this.scheduleExpiryTimer);
    this.scheduleExpiryTimer = null;
    const valid = validScheduleCache(schedule, now);
    if (!valid) return;
    const remaining = SCHEDULE_CACHE_TTL_MS - (now.getTime() - Date.parse(valid.cachedAt));
    this.scheduleExpiryTimer = setTimeout(() => {
      this.clearScheduleCache().catch(() => {});
    }, Math.max(1, remaining + 50));
    if (typeof this.scheduleExpiryTimer.unref === 'function') this.scheduleExpiryTimer.unref();
  }

  async clearScheduleCache() {
    clearTimeout(this.scheduleExpiryTimer);
    this.scheduleExpiryTimer = null;
    if (!this.state.schedule) return false;
    this.publish({ schedule: null });
    await this.persistCache().catch(() => {});
    return true;
  }

  async clearExpiredScheduleCache(now = new Date()) {
    if (!this.state.schedule) return false;
    if (validScheduleCache(this.state.schedule, now)) {
      this.armScheduleExpiry(this.state.schedule, now);
      return false;
    }
    return this.clearScheduleCache();
  }

  publicState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  publish(patch = {}) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.publicState());
  }

  async loadDevice() {
    try {
      const stored = JSON.parse(await fsp.readFile(this.devicePath(), 'utf8'));
      if (!safeStorage.isEncryptionAvailable()) throw new Error('作業系統安全儲存目前無法使用');
      const token = safeStorage.decryptString(Buffer.from(String(stored.encryptedToken || ''), 'base64'));
      const serviceUrl = normalizeServiceUrl(stored.serviceUrl, !app.isPackaged);
      if (!token || !stored.deviceId) throw new Error('裝置配對資料不完整');
      this.device = { serviceUrl, deviceId: String(stored.deviceId), label: String(stored.label || ''), token };
      this.publish({ configured: true, serviceUrl, deviceLabel: this.device.label, connection: 'offline', error: '' });
      return true;
    } catch (error) {
      if (error && error.code !== 'ENOENT') this.publish({ connection: 'error', error: `讀取配對資料失敗：${error.message}` });
      return false;
    }
  }

  async loadCache() {
    try {
      const cache = JSON.parse(await fsp.readFile(this.cachePath(), 'utf8'));
      const schedule = validScheduleCache(cache.schedule);
      this.publish({
        roster: validRoster(cache.roster),
        rosterErrors: Array.isArray(cache.rosterErrors) ? cache.rosterErrors.map(String).slice(0, 100) : [],
        schedule,
        utmostSharing: validUtmostSharing(cache.utmostSharing),
        assignmentStats: validAssignmentStats(cache.assignmentStats),
        fetchedAt: String(cache.fetchedAt || ''),
        stale: true
      });
      this.armScheduleExpiry(schedule);
      if (cache.schedule && !schedule) await this.persistCache().catch(() => {});
    } catch {}
  }

  async start() {
    this.stopped = false;
    await this.loadCache();
    if (!await this.loadDevice()) return;
    this.connect();
    this.refreshBootstrap().catch(() => {});
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connectedOnce = false;
    this.bootstrapGeneration += 1;
    this.bootstrapRefreshPromise = null;
    clearTimeout(this.scheduleExpiryTimer);
    this.scheduleExpiryTimer = null;
    if (this.socket) {
      try { this.socket.close(1000, 'app closing'); } catch {}
      this.socket = null;
    }
  }

  async pair({ serviceUrl, installKey, label }) {
    const normalizedUrl = normalizeServiceUrl(serviceUrl, !app.isPackaged);
    const key = String(installKey || '').trim();
    const deviceLabel = String(label || '').trim().slice(0, 80) || `${process.platform === 'darwin' ? 'Mac' : 'Windows'} 主持人電腦`;
    if (key.length < 16 || key.length > 512) throw new Error('安裝金鑰格式不正確');
    const response = await fetch(`${normalizedUrl}/v1/devices/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installKey: key, label: deviceLabel }),
      signal: AbortSignal.timeout(15_000)
    });
    const data = await responseJsonLimited(response);
    if (!response.ok || !data.ok || !data.deviceToken || !data.deviceId) throw new Error(data.error || `配對失敗（HTTP ${response.status}）`);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('作業系統安全儲存目前無法使用');
    await writePrivateJson(this.devicePath(), {
      serviceUrl: normalizedUrl,
      deviceId: String(data.deviceId),
      label: deviceLabel,
      encryptedToken: safeStorage.encryptString(String(data.deviceToken)).toString('base64')
    });
    this.stop();
    this.device = { serviceUrl: normalizedUrl, deviceId: String(data.deviceId), label: deviceLabel, token: String(data.deviceToken) };
    this.publish({ configured: true, serviceUrl: normalizedUrl, deviceLabel, connection: 'connecting', error: '' });
    this.stopped = false;
    this.connect();
    await this.refreshBootstrap().catch((error) => {
      this.publish({ error: error.message, stale: true });
    });
    return this.publicState();
  }

  async unpair() {
    const device = this.device;
    this.stop();
    if (device) {
      await fetch(`${device.serviceUrl}/v1/devices/current`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${device.token}` },
        signal: AbortSignal.timeout(8_000)
      }).catch(() => {});
    }
    this.device = null;
    await fsp.unlink(this.devicePath()).catch(() => {});
    this.publish({
      configured: false,
      serviceUrl: '',
      deviceLabel: '',
      connection: 'unconfigured',
      error: '',
      snapshot: { ...EMPTY_SNAPSHOT }
    });
    return this.publicState();
  }

  applyBootstrap(data) {
    const roster = validRoster(data.roster);
    const schedule = createScheduleCacheEntry(data.schedule);
    const rosterErrors = Array.isArray(data.rosterErrors) ? data.rosterErrors.map(String).slice(0, 100) : [];
    const utmostSharing = validUtmostSharing(data.utmostSharing);
    const assignmentStats = validAssignmentStats(data.assignmentStats);
    const fetchedAt = String(data.fetchedAt || new Date().toISOString());
    this.publish({
      roster,
      rosterErrors,
      schedule,
      utmostSharing,
      assignmentStats,
      snapshot: validSnapshot(data.snapshot),
      stale: data.stale === true,
      fetchedAt,
      error: data.error ? String(data.error) : ''
    });
    this.armScheduleExpiry(schedule);
    this.persistCache().catch(() => {});
  }

  async saveAssignments({ date, scripture, utmost }) {
    if (!this.device) throw new Error('裝置尚未配對');
    const response = await fetch(`${this.device.serviceUrl}/v1/assignments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.device.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ date, scripture, utmost }),
      signal: AbortSignal.timeout(15_000)
    });
    const data = await responseJsonLimited(response);
    if (!response.ok || !data.ok) throw new Error(data.error || `更新閱讀安排失敗（HTTP ${response.status}）`);
    const assignmentStats = validAssignmentStats(data.assignmentStats);
    this.publish({ assignmentStats, error: '' });
    this.persistCache().catch(() => {});
    return this.publicState();
  }

  async fetchBootstrap(device, generation) {
    if (!device) throw new Error('裝置尚未配對');
    let response;
    try {
      response = await fetch(`${device.serviceUrl}/v1/bootstrap`, {
        headers: { authorization: `Bearer ${device.token}` },
        signal: AbortSignal.timeout(20_000)
      });
    } catch (error) {
      if (generation !== this.bootstrapGeneration || device !== this.device) return this.publicState();
      this.publish({ error: `同步失敗：${error.message}`, stale: true });
      throw error;
    }
    const data = await responseJsonLimited(response);
    if (generation !== this.bootstrapGeneration || device !== this.device) return this.publicState();
    if (!response.ok || !data.ok) {
      const error = new Error(data.error || `同步失敗（HTTP ${response.status}）`);
      if (response.status === 401) this.publish({ connection: 'error', error: '裝置配對已失效，請重新配對' });
      else this.publish({ error: error.message, stale: true });
      throw error;
    }
    this.applyBootstrap(data);
    return this.publicState();
  }

  refreshBootstrap() {
    if (this.bootstrapRefreshPromise) return this.bootstrapRefreshPromise;
    const generation = this.bootstrapGeneration;
    const request = this.fetchBootstrap(this.device, generation);
    const tracked = request.finally(() => {
      if (this.bootstrapRefreshPromise === tracked) this.bootstrapRefreshPromise = null;
    });
    this.bootstrapRefreshPromise = tracked;
    return tracked;
  }

  async scheduleToday({ forceRefresh = false } = {}) {
    await this.clearExpiredScheduleCache();
    if (forceRefresh) await this.clearScheduleCache();
    if (this.device) {
      if (forceRefresh && this.bootstrapRefreshPromise) await this.bootstrapRefreshPromise.catch(() => {});
      let refreshed = false;
      try {
        await this.refreshBootstrap();
        refreshed = true;
      } catch {}
      if (forceRefresh && !refreshed) return null;
    }
    await this.clearExpiredScheduleCache();
    return validScheduleCache(this.state.schedule);
  }

  websocketUrl() {
    const url = new URL(this.device.serviceUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/live`;
    return url.href;
  }

  connect() {
    if (this.stopped || !this.device || this.socket) return;
    this.publish({ connection: 'connecting' });
    const socket = new WebSocket(this.websocketUrl(), {
      headers: { authorization: `Bearer ${this.device.token}` },
      handshakeTimeout: 12_000,
      maxPayload: MAX_RESPONSE_BYTES
    });
    this.socket = socket;
    socket.on('open', () => {
      if (this.socket !== socket) return;
      const reconnected = this.connectedOnce;
      this.connectedOnce = true;
      this.reconnectAttempt = 0;
      this.publish({ connection: 'connected', error: '' });
      if (reconnected) this.refreshBootstrap().catch(() => {});
    });
    socket.on('message', (buffer) => {
      if (this.socket !== socket) return;
      try {
        const message = JSON.parse(String(buffer));
        if (message.type === 'snapshot') this.publish({ snapshot: validSnapshot(message.snapshot), connection: 'connected', error: '' });
      } catch {}
    });
    socket.on('error', (error) => {
      if (this.socket === socket) this.publish({ connection: 'offline', error: `即時連線中斷：${error.message}` });
    });
    socket.on('unexpected-response', (_request, response) => {
      if (response.statusCode === 401) this.publish({ connection: 'error', error: '裝置配對已失效，請重新配對' });
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return;
      if (this.state.connection !== 'error') this.publish({ connection: 'offline' });
      const delay = Math.min(30_000, 1000 * (2 ** Math.min(this.reconnectAttempt++, 5))) + Math.floor(Math.random() * 500);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }
}

module.exports = {
  SCHEDULE_CACHE_TTL_MS,
  PresenceManager,
  appDateKey,
  createScheduleCacheEntry,
  normalizeServiceUrl,
  validScheduleCache,
  validRoster,
  validSnapshot,
  validUtmostSharing,
  validAssignmentStats
};
