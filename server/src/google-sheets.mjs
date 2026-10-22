import { datePartsInTimeZone, parseRosterRows, parseScheduleRows, parseUtmostSharingRows, parseUtmostSharingSheets } from './shared.mjs';

const encoder = new TextEncoder();
let cachedAccessToken = null;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function readJsonLimited(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('Google 回應資料過大');
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Google 回應資料過大');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function readTextLimited(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error('Google 試算表資料過大');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error('Google 試算表資料過大');
  return text;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

// Discover public tabs without credentials or evaluating Google's page scripts.
// Keep the page-format dependency here so an unexpected Google response fails visibly.
export function parsePublicSheetTabs(html) {
  const tabs = [];
  const seen = new Set();
  const pattern = /items\.push\(\{name:\s*("(?:\\.|[^"\\])*"),[^}]*?\bgid:\s*"(\d+)"/g;
  for (const match of String(html || '').matchAll(pattern)) {
    const name = JSON.parse(match[1].replace(/\\x([\da-f]{2})/gi, (_value, hex) => `\\u00${hex}`));
    if (seen.has(match[2])) continue;
    seen.add(match[2]);
    tabs.push({ name, gid: match[2] });
  }
  if (!tabs.length) throw new Error('無法取得服事表分頁清單，請確認試算表可供檢視');
  if (tabs.length > 64) throw new Error('服事表分頁過多（上限 64）');
  return tabs;
}

async function loadUtmostSharing(env, now) {
  // Accept the old setting too, but treat its gid as obsolete: quarterly tabs
  // belong to one workbook and must be discovered on each refresh.
  const value = String(env.UTMOST_ASSIGNMENT_SHEET_URL || env.UTMOST_ASSIGNMENT_CSV_URL || '').trim();
  if (!value) {
    return {
      ...parseUtmostSharingRows([], now, env.APP_TIME_ZONE || 'Asia/Taipei'),
      error: '尚未設定竭誠獻上排班表'
    };
  }
  let url;
  try { url = new URL(value); } catch { throw new Error('竭誠獻上排班表網址格式錯誤'); }
  const path = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/(?:edit|export|htmlview))?\/?$/);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.username || url.password || !path) {
    throw new Error('竭誠獻上排班表必須使用 Google 試算表網址');
  }
  const base = `https://docs.google.com/spreadsheets/d/${path[1]}`;
  const timeZone = env.APP_TIME_ZONE || 'Asia/Taipei';
  const year = datePartsInTimeZone(now, timeZone).year;
  const response = await fetch(`${base}/htmlview`, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`讀取服事表分頁失敗：HTTP ${response.status}`);
  const tabs = parsePublicSheetTabs(await readTextLimited(response)).filter((tab) => {
    const tabYear = tab.name.normalize('NFKC').match(/20\d{2}/);
    return !tabYear || (Number(tabYear[0]) >= year - 1 && Number(tabYear[0]) <= year + 1);
  });
  // Read in small batches to bound concurrent requests even for larger workbooks.
  const sheets = [];
  for (let index = 0; index < tabs.length; index += 4) {
    sheets.push(...await Promise.all(tabs.slice(index, index + 4).map(async (tab) => {
      const csv = await fetch(`${base}/export?format=csv&gid=${tab.gid}`, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
      if (!csv.ok) throw new Error(`讀取服事表「${tab.name}」失敗：HTTP ${csv.status}`);
      const text = await readTextLimited(csv);
      if (/^\s*(?:<!doctype|<html)/i.test(text)) throw new Error(`服事表「${tab.name}」回傳登入頁，請確認檢視權限`);
      return { ...tab, rows: parseCsv(text) };
    })));
  }
  return parseUtmostSharingSheets(sheets, now, timeZone);
}

async function loadPublicSchedule(env, now) {
  const sheetId = String(env.GOOGLE_SHEET_ID || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(sheetId)) throw new Error('Google 試算表 ID 格式不正確');
  const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/export`);
  url.searchParams.set('format', 'csv');
  url.searchParams.set('gid', '0');
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`讀取今日經文排班失敗：HTTP ${response.status}`);
  return parseScheduleRows(parseCsv(await readTextLimited(response)), now, env.APP_TIME_ZONE || 'Asia/Taipei');
}

export async function loadDailyBootstrap(env, now = new Date()) {
  const schedule = await loadPublicSchedule(env, now);
  const utmostSharing = await loadUtmostSharing(env, now).catch((error) => ({
    found: false,
    date: schedule.date || '',
    sharer: '',
    next: null,
    error: error.message
  }));
  return { schedule, utmostSharing, dailyFetchedAt: new Date().toISOString() };
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemBytes(pem) {
  const normalized = String(pem || '').replace(/\\n/g, '\n');
  const body = normalized.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  if (!body) throw new Error('Google 服務帳號私鑰尚未設定');
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function serviceAccountAssertion(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64Url(encoder.encode(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(env.GOOGLE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

async function googleAccessToken(env) {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) return cachedAccessToken.value;
  const assertion = await serviceAccountAssertion(env);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!response.ok) throw new Error(`Google 授權失敗（HTTP ${response.status}）`);
  const data = await readJsonLimited(response);
  if (!data.access_token) throw new Error('Google 沒有回傳 access token');
  cachedAccessToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedAccessToken.value;
}

function appsScriptUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error('Google Apps Script 網址格式不正確'); }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) {
    throw new Error('請使用正式部署的 Google Apps Script /exec 網址');
  }
  return url.href;
}

async function appsScriptRanges(env) {
  if (!env.GOOGLE_APPS_SCRIPT_SECRET || String(env.GOOGLE_APPS_SCRIPT_SECRET).length < 24) {
    throw new Error('Google Apps Script 連線密鑰尚未設定');
  }
  const response = await fetch(appsScriptUrl(env.GOOGLE_APPS_SCRIPT_URL), {
    method: 'POST',
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: JSON.stringify({ version: 1, secret: env.GOOGLE_APPS_SCRIPT_SECRET }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Google Apps Script 讀取失敗（HTTP ${response.status}）`);
  const data = await readJsonLimited(response);
  if (!data || data.ok !== true || !Array.isArray(data.valueRanges)) {
    throw new Error(String(data && data.error || 'Google Apps Script 回應格式不正確'));
  }
  return data.valueRanges;
}

async function serviceAccountRanges(env) {
  const scheduleRange = env.SCHEDULE_RANGE || '經文進度!A:F';
  const rosterRange = env.ROSTER_RANGE || '服務名單!A:H';
  const query = new URLSearchParams();
  query.append('ranges', scheduleRange);
  query.append('ranges', rosterRange);
  query.set('majorDimension', 'ROWS');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID)}/values:batchGet?${query}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${await googleAccessToken(env)}` } });
  if (!response.ok) throw new Error(`讀取 Google 試算表失敗（HTTP ${response.status}）`);
  const data = await readJsonLimited(response);
  return Array.isArray(data.valueRanges) ? data.valueRanges : [];
}

export async function loadSheetBootstrap(env, now = new Date()) {
  if (!env.GOOGLE_SHEET_ID) throw new Error('Google 試算表 ID 尚未設定');
  const [rangesResult, dailyResult] = await Promise.allSettled([
    env.GOOGLE_APPS_SCRIPT_URL ? appsScriptRanges(env) : serviceAccountRanges(env),
    loadDailyBootstrap(env, now)
  ]);
  if (rangesResult.status === 'rejected') {
    if (dailyResult.status === 'fulfilled' && rangesResult.reason && typeof rangesResult.reason === 'object') {
      rangesResult.reason.dailyData = dailyResult.value;
    }
    throw rangesResult.reason;
  }
  const ranges = rangesResult.value;
  const fallbackSchedule = parseScheduleRows((ranges[0] && ranges[0].values) || [], now, env.APP_TIME_ZONE || 'Asia/Taipei');
  const dailyData = dailyResult.status === 'fulfilled' ? dailyResult.value : {
    schedule: fallbackSchedule,
    utmostSharing: {
      found: false, date: fallbackSchedule.date || '', sharer: '', next: null,
      error: dailyResult.reason && dailyResult.reason.message || '每日排班資料讀取失敗'
    },
    dailyFetchedAt: ''
  };
  const { roster, errors } = parseRosterRows((ranges[1] && ranges[1].values) || []);
  return { ...dailyData, roster, rosterErrors: errors, fetchedAt: new Date().toISOString(), stale: false };
}
