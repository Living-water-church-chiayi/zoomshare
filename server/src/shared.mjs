import DevotionalDate from '../../src/devotional-date.js';

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

function sameStringSet(left, right) {
  if (!left || !right || left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

function sharedAccountDisplayName(value) {
  const normalized = normalizePersonName(value);
  if (!normalized) return false;
  return /[&＆+＋/／、]/.test(normalized) || /[\p{Script=Han}](?:和|及)[\p{Script=Han}]/u.test(normalized);
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
      isFullTime: parseBoolean(row[headers.indexOf('全職同工')]),
      enabled: parseBoolean(row[index['啟用']], true),
      order: Number.isFinite(rawOrder) ? rawOrder : rowIndex
    });
  }

  const owners = new Map();
  for (const member of roster.filter((item) => item.enabled)) {
    const labels = [
      { value: member.name, alias: false },
      ...member.aliases.map((alias) => ({ value: alias, alias: true }))
    ];
    for (const label of labels) {
      const key = normalizePersonName(label.value);
      if (!key) continue;
      if (!owners.has(key)) owners.set(key, { memberIds: new Set(), aliasMemberIds: new Set() });
      owners.get(key).memberIds.add(member.memberId);
      if (label.alias) owners.get(key).aliasMemberIds.add(member.memberId);
    }
  }
  for (const [key, owner] of owners) {
    if (owner.memberIds.size > 1 && !sharedAccountDisplayName(key) && !sameStringSet(owner.aliasMemberIds, owner.memberIds)) {
      errors.push(`姓名或別名重複「${key}」：${[...owner.memberIds].join('、')}`);
    }
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
  const { year, month, day } = DevotionalDate.dateParts(date, timeZone);
  return { year, month, day };
}

function isoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function sharingDate(value, year, startMonth = 1) {
  const text = String(value ?? '').normalize('NFKC').trim();
  const match = text.match(/^(?:(\d{4})[年/.-])?(\d{1,2})[月/.-](\d{1,2})(?:日)?(?:\s*[(（]?(?:星期|週)[一二三四五六日天][)）]?)?$/);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  // A fourth-quarter sheet often includes the first few days of January.
  const actualYear = match[1] ? Number(match[1]) : year + (startMonth >= 10 && month <= 2 ? 1 : 0);
  const check = new Date(Date.UTC(actualYear, month - 1, day));
  if (check.getUTCFullYear() !== actualYear || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return isoDate(actualYear, month, day);
}

function sharingEntries(rows, year, startMonth = 1) {
  const entries = [];
  let pairs = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(row)) continue;
    const labels = row.map((cell) => String(cell ?? '').normalize('NFKC').replace(/\s+/g, ''));
    const dateColumns = labels.flatMap((label, index) => /^(?:日期|服事日期|第[一二三四五六七八九十\d]+週)$/.test(label) ? [index] : []);
    const shareColumns = labels.flatMap((label, index) => /^(?:分享|分享者|帶領分享|竭誠獻上分享者)$/.test(label) ? [index] : []);
    if (dateColumns.length) {
      // Each week/date header owns its columns up to the next week/date header.
      pairs = dateColumns.flatMap((column, index) => {
        const next = dateColumns[index + 1] ?? row.length;
        const share = shareColumns.find((candidate) => candidate > column && candidate < next);
        // Also support a vertical table whose sharing column precedes its date.
        const preceding = dateColumns.length === 1 && shareColumns.length === 1 ? shareColumns[0] : undefined;
        return share !== undefined || preceding !== undefined ? [[column, share ?? preceding]] : [];
      });
      continue;
    }
    const columns = pairs ?? row.flatMap((value, column) => sharingDate(value, year, startMonth) ? [[column, column + 1]] : []);
    for (const [dateColumn, sharerColumn] of columns) {
      const date = sharingDate(row[dateColumn], year, startMonth);
      if (!date) continue;
      const sharer = String(row[sharerColumn] ?? '').trim().slice(0, 120);
      entries.push({ date, sharer });
    }
  }
  return entries;
}

function sharingResult(entries, now, timeZone) {
  const today = datePartsInTimeZone(now, timeZone);
  const todayKey = isoDate(today.year, today.month, today.day);
  const byDate = new Map();
  const conflicts = new Set();
  for (const { date, sharer } of entries) {
    if (byDate.has(date) && byDate.get(date) !== sharer) conflicts.add(date);
    else byDate.set(date, sharer);

  }
  const sharer = conflicts.has(todayKey) ? '' : byDate.get(todayKey) || '';
  const nextEntry = [...byDate].sort(([left], [right]) => left.localeCompare(right))
    .find(([date, name]) => date > todayKey && name && !conflicts.has(date));
  const result = {
    found: Boolean(sharer), date: todayKey, sharer,
    next: nextEntry ? { date: nextEntry[0], sharer: nextEntry[1] } : null
  };
  if (conflicts.has(todayKey)) result.error = `${todayKey} 的服事表有不同分享者，請確認重複日期`;
  return result;
}

export function parseUtmostSharingRows(rows, now = new Date(), timeZone = 'Asia/Taipei') {
  return sharingResult(sharingEntries(rows, datePartsInTimeZone(now, timeZone).year), now, timeZone);
}

export function parseUtmostSharingSheets(sheets, now = new Date(), timeZone = 'Asia/Taipei') {
  const today = datePartsInTimeZone(now, timeZone);
  const entries = sheets.flatMap((sheet) => {
    const period = String(sheet.name || '').normalize('NFKC').match(/(20\d{2})(?:[年.\/ -]+(\d{1,2}))?/);
    return sharingEntries(sheet.rows, period ? Number(period[1]) : today.year, period && period[2] ? Number(period[2]) : 1);
  });
  const result = sharingResult(entries, now, timeZone);
  if (!entries.length) result.error = '服事表未找到日期與分享欄位，請確認表格格式';
  return result;
}

export function parseScheduleRows(rows, now = new Date(), timeZone = 'Asia/Taipei') {
  const today = datePartsInTimeZone(now, timeZone);
  const date = isoDate(today.year, today.month, today.day);
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
  return row ? { ok: true, found: true, date, row } : { ok: true, found: false, date };
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
        peakParticipants: 0,
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
    if (current.status === 'ended') return { meeting: current, versions: {}, changed: false };
    return {
      meeting: {
        ...current,
        status: 'ended',
        endedAt: mutation.eventTs,
        peakParticipants: Math.max(
          Number(current.peakParticipants || 0),
          Object.keys(current.participants || {}).length
        ),
        participants: {}
      },
      versions: {},
      changed: true
    };
  }

  let meeting = current;
  if (meeting && meeting.status === 'ended' && meeting.meetingUuid === mutation.meetingUuid) {
    return { meeting, versions: nextVersions, changed: false };
  }
  if (!meeting || meeting.meetingUuid !== mutation.meetingUuid || meeting.status !== 'active') {
    meeting = {
      status: 'active',
      meetingNumber: mutation.meetingNumber,
      meetingUuid: mutation.meetingUuid,
      startedAt: mutation.eventTs,
      peakParticipants: 0,
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
  const peakParticipants = Math.max(Number(meeting.peakParticipants || 0), Object.keys(participants).length);
  return { meeting: { ...meeting, peakParticipants, participants }, versions: nextVersions, changed: true };
}

export function snapshotFromMeeting(meeting) {
  if (!meeting) return { status: 'idle', meetingNumber: '', meetingUuid: '', peakParticipants: 0, participants: [] };
  const active = meeting.status === 'active';
  const participants = active ? Object.values(meeting.participants || {}) : [];
  return {
    status: active ? 'active' : 'idle',
    meetingNumber: meeting.meetingNumber,
    meetingUuid: meeting.meetingUuid,
    peakParticipants: Math.max(Number(meeting.peakParticipants || 0), participants.length),
    participants: participants.map((participant) => ({
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
