const textEncoder = new TextEncoder();

export function normalizeMeetingNumber(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function normalizePersonName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('zh-Hant');
}

export function parseBoolean(value, defaultValue = false) {
  const normalized = String(value ?? '').normalize('NFKC').trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes', 'y', '是', '有', '可', '啟用'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', '否', '無', '不可', '停用'].includes(normalized)) return false;
  return defaultValue;
}

export function parseRosterRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { roster: [], errors: ['服務名單沒有資料'] };
  const headers = rows[0].map((value) => String(value ?? '').trim());
  const required = ['編號', '姓名', 'Zoom別名', '可讀經文', '可讀竭誠獻上', '啟用', '排序'];
  const index = Object.fromEntries(required.map((header) => [header, headers.indexOf(header)]));
  const missing = required.filter((header) => index[header] < 0);
  if (missing.length) return { roster: [], errors: [`服務名單缺少欄位：${missing.join('、')}`] };

  const roster = [];
  const errors = [];
  const ids = new Set();
  for (let rowIndex = 1; rowIndex < Math.min(rows.length, 501); rowIndex++) {
    const row = rows[rowIndex] || [];
    const name = String(row[index['姓名']] ?? '').trim();
    if (!name) continue;
    const memberId = String(row[index['編號']] ?? '').trim();
    if (!memberId) {
      errors.push(`第 ${rowIndex + 1} 列缺少編號`);
      continue;
    }
    if (ids.has(memberId)) {
      errors.push(`編號重複：${memberId}`);
      continue;
    }
    ids.add(memberId);
    const aliases = String(row[index['Zoom別名']] ?? '')
      .split(/[、,，;；|]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const rawOrder = Number.parseInt(String(row[index['排序']] ?? ''), 10);
    roster.push({
      memberId,
      name,
      aliases,
      canReadScripture: parseBoolean(row[index['可讀經文']]),
      canReadUtmost: parseBoolean(row[index['可讀竭誠獻上']]),
      enabled: parseBoolean(row[index['啟用']], true),
      order: Number.isFinite(rawOrder) ? rawOrder : rowIndex
    });
  }

  const owners = new Map();
  for (const member of roster.filter((item) => item.enabled)) {
    for (const label of [member.name, ...member.aliases]) {
      const key = normalizePersonName(label);
      if (!key) continue;
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(member.memberId);
    }
  }
  for (const [key, memberIds] of owners) {
    if (memberIds.size > 1) errors.push(`姓名或別名重複「${key}」：${[...memberIds].join('、')}`);
  }

  roster.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hant'));
  return { roster, errors };
}

function chineseNumber(value) {
  const text = String(value ?? '').trim().normalize('NFKC');
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100 };
  let total = 0;
  let current = 0;
  for (const character of text) {
    if (Object.prototype.hasOwnProperty.call(digits, character)) current = digits[character];
    else if (Object.prototype.hasOwnProperty.call(units, character)) {
      total += (current || 1) * units[character];
      current = 0;
    }
  }
  return total + current || Number.NaN;
}

export function datePartsInTimeZone(date = new Date(), timeZone = 'Asia/Taipei') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number.parseInt(part.value, 10)]));
  return { year: values.year, month: values.month, day: values.day };
}

function isoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseUtmostSharingRows(rows, now = new Date(), timeZone = 'Asia/Taipei') {
  const today = datePartsInTimeZone(now, timeZone);
  const todayKey = isoDate(today.year, today.month, today.day);
  const entriesByDate = new Map();
  const columnPairs = [[1, 2], [4, 5], [7, 8], [10, 11], [13, 14]];

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(row)) continue;
    for (const [dateColumn, sharerColumn] of columnPairs) {
      const match = String(row[dateColumn] ?? '').normalize('NFKC').trim().match(/^(\d{1,2})月(\d{1,2})日$/);
      if (!match) continue;
      const month = Number(match[1]);
      const day = Number(match[2]);
      const check = new Date(Date.UTC(today.year, month - 1, day));
      if (check.getUTCFullYear() !== today.year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) continue;
      const sharer = String(row[sharerColumn] ?? '').trim().slice(0, 120);
      if (!sharer) continue;
      entriesByDate.set(isoDate(today.year, month, day), sharer);
    }
  }

  const entries = [...entriesByDate].sort(([left], [right]) => left.localeCompare(right));
  const sharer = entriesByDate.get(todayKey) || '';
  const nextEntry = entries.find(([date]) => date > todayKey);
  return {
    found: Boolean(sharer),
    date: todayKey,
    sharer,
    next: nextEntry ? { date: nextEntry[0], sharer: nextEntry[1] } : null
  };
}

export function parseScheduleRows(rows, now = new Date(), timeZone = 'Asia/Taipei') {
  const today = datePartsInTimeZone(now, timeZone);
  let exact = null;
  let loose = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const parts = String(row[0] ?? '')
      .normalize('NFKC')
      .split(/[\/\-.]/)
      .map((value) => Number.parseInt(value, 10))
      .filter(Number.isFinite);
    if (parts.length < 2) continue;
    const year = parts.find((value) => value >= 1000) ?? null;
    const monthDay = parts.filter((value) => value < 1000);
    if (monthDay.length < 2 || monthDay[0] !== today.month || monthDay[1] !== today.day) continue;
    const candidate = {
      book: String(row[1] ?? '').trim(),
      startCh: chineseNumber(row[2]),
      startV: chineseNumber(row[3]),
      endCh: chineseNumber(row[4]),
      endV: chineseNumber(row[5])
    };
    if (!candidate.book || ![candidate.startCh, candidate.startV, candidate.endCh, candidate.endV].every(Number.isFinite)) continue;
    if (year === today.year && !exact) exact = candidate;
    else if (year === null && !loose) loose = candidate;
  }
  const row = exact || loose;
  return row ? { ok: true, found: true, row } : { ok: true, found: false };
}

export function eventToMutation(payload, expectedAccountId, expectedMeetingNumber) {
  if (!payload || typeof payload !== 'object') return null;
  const eventName = String(payload.event || '');
  const object = payload.payload && payload.payload.object;
  if (!object || typeof object !== 'object') return null;
  if (String(payload.payload.account_id || '') !== String(expectedAccountId || '')) return null;
  const meetingNumber = normalizeMeetingNumber(object.id);
  if (!meetingNumber || meetingNumber !== normalizeMeetingNumber(expectedMeetingNumber)) return null;
  const meetingUuid = String(object.uuid || '');
  const eventTs = Number(payload.event_ts) || Date.now();
  if (eventName === 'meeting.started') return { type: 'meeting.started', meetingNumber, meetingUuid, eventTs };
  if (eventName === 'meeting.ended') return { type: 'meeting.ended', meetingNumber, meetingUuid, eventTs };
  if (!['meeting.participant_joined', 'meeting.participant_left'].includes(eventName)) return null;
  const participant = object.participant || {};
  // Zoom's meeting user_id identifies a specific connection and changes when a
  // person leaves and rejoins. participant_uuid can be shared when the same
  // signed-in Zoom user joins from more than one device, so it is only a
  // fallback here.
  const sessionId = String(participant.user_id || participant.participant_uuid || '');
  if (!sessionId) return null;
  return {
    type: eventName,
    meetingNumber,
    meetingUuid,
    eventTs,
    participant: {
      sessionId,
      displayName: String(participant.user_name || '').trim().slice(0, 200),
      joinedAt: String(participant.join_time || '')
    }
  };
}

export function applyMeetingMutation(current, versions, mutation) {
  const nextVersions = { ...(versions || {}) };
  if (!mutation) return { meeting: current || null, versions: nextVersions, changed: false };
  if (mutation.type === 'meeting.started') {
    if (current && current.meetingUuid === mutation.meetingUuid && current.status === 'active') {
      return { meeting: current, versions: nextVersions, changed: false };
    }
    return {
      meeting: {
        status: 'active',
        meetingNumber: mutation.meetingNumber,
        meetingUuid: mutation.meetingUuid,
        startedAt: mutation.eventTs,
        participants: {}
      },
      versions: {},
      changed: true
    };
  }
  if (mutation.type === 'meeting.ended') {
    if (!current || (mutation.meetingUuid && current.meetingUuid && mutation.meetingUuid !== current.meetingUuid)) {
      return { meeting: current || null, versions: nextVersions, changed: false };
    }
    return { meeting: null, versions: {}, changed: true };
  }

  let meeting = current;
  if (!meeting || meeting.meetingUuid !== mutation.meetingUuid) {
    meeting = {
      status: 'active',
      meetingNumber: mutation.meetingNumber,
      meetingUuid: mutation.meetingUuid,
      startedAt: mutation.eventTs,
      participants: {}
    };
    for (const key of Object.keys(nextVersions)) delete nextVersions[key];
  }
  const sessionId = mutation.participant.sessionId;
  const previousVersion = Number(nextVersions[sessionId] || 0);
  if (mutation.eventTs < previousVersion) return { meeting, versions: nextVersions, changed: meeting !== current };
  nextVersions[sessionId] = mutation.eventTs;
  const participants = { ...(meeting.participants || {}) };
  if (mutation.type === 'meeting.participant_joined') participants[sessionId] = mutation.participant;
  else delete participants[sessionId];
  return { meeting: { ...meeting, participants }, versions: nextVersions, changed: true };
}

export function snapshotFromMeeting(meeting) {
  if (!meeting) return { status: 'idle', meetingNumber: '', meetingUuid: '', participants: [] };
  return {
    status: 'active',
    meetingNumber: meeting.meetingNumber,
    meetingUuid: meeting.meetingUuid,
    participants: Object.values(meeting.participants || {}).map((participant) => ({
      sessionId: participant.sessionId,
      displayName: participant.displayName,
      joinedAt: participant.joinedAt || ''
    }))
  };
}

export async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(String(value)));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(left, right) {
  const a = textEncoder.encode(String(left));
  const b = textEncoder.encode(String(right));
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) mismatch |= (a[index % Math.max(a.length, 1)] || 0) ^ (b[index % Math.max(b.length, 1)] || 0);
  return mismatch === 0;
}
