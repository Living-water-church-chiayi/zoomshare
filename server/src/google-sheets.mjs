import { parseRosterRows, parseScheduleRows, parseUtmostSharingRows } from './shared.mjs';

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

async function loadUtmostSharing(env, now) {
  const value = String(env.UTMOST_ASSIGNMENT_CSV_URL || '').trim();
  if (!value) return { found: false, date: '', sharer: '', next: null, error: '尚未設定竭誠獻上排班表' };
  let url;
  try { url = new URL(value); } catch { throw new Error('竭誠獻上排班表網址格式錯誤'); }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !/^\/spreadsheets\/d\/[a-zA-Z0-9_-]+\/export$/.test(url.pathname)) {
    throw new Error('竭誠獻上排班表必須使用 Google 試算表 CSV 匯出網址');
  }
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`讀取竭誠獻上排班表失敗：HTTP ${response.status}`);
  return parseUtmostSharingRows(parseCsv(await readTextLimited(response)), now, env.APP_TIME_ZONE || 'Asia/Taipei');
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
  const rosterRange = env.ROSTER_RANGE || '服務名單!A:G';
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
  const [ranges, utmostSharing] = await Promise.all([
    env.GOOGLE_APPS_SCRIPT_URL ? appsScriptRanges(env) : serviceAccountRanges(env),
    loadUtmostSharing(env, now).catch((error) => ({
      found: false,
      date: '',
      sharer: '',
      next: null,
      error: error.message
    }))
  ]);
  const schedule = parseScheduleRows((ranges[0] && ranges[0].values) || [], now, env.APP_TIME_ZONE || 'Asia/Taipei');
  const { roster, errors } = parseRosterRows((ranges[1] && ranges[1].values) || []);
  return { schedule, roster, rosterErrors: errors, utmostSharing, fetchedAt: new Date().toISOString(), stale: false };
}
