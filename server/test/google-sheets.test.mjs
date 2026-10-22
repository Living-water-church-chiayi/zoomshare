import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDailyBootstrap, loadSheetBootstrap, parseCsv, parsePublicSheetTabs } from '../src/google-sheets.mjs';

test('discovers public tabs safely, including escaped titles, and rejects login pages', () => {
  assert.deepEqual(parsePublicSheetTabs(String.raw`items.push({name: "2026.10-12月", pageUrl: "x", gid: "123"});items.push({name: "下一季\x26\u0020排班", gid: "456"});items.push({name: "duplicate", gid: "123"});`), [
    { name: '2026.10-12月', gid: '123' }, { name: '下一季& 排班', gid: '456' }
  ]);
  assert.throws(() => parsePublicSheetTabs('<html>Sign in</html>'), /分頁清單/);
});

test('discovers a new quarter even when configured with the old quarter CSV gid', async (t) => {
  const calls = [];
  let newQuarter = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const address = String(url);
    calls.push(address);
    if (address.includes('/spreadsheets/d/scripture/export')) return new Response('10/13,啟示錄,4,1,4,11');
    if (address.endsWith('/htmlview')) return new Response(
      'items.push({name: "2026.7-9月", gid: "111"});' +
      (newQuarter ? 'items.push({name: "2026.10-12月", gid: "222"});' : '') +
      'items.push({name: "2025.10-12月", gid: "333"});'
    );
    if (address.endsWith('gid=111')) return new Response('第一週,分享,主持人\n9月29日,舊季度,主持\n10月2日,舊季末,主持');
    if (address.endsWith('gid=222')) return new Response('日期,主持人,分享\n10月13日,育農/道萱,月琴\n10月14日,,信一');
    if (address.endsWith('gid=333')) return new Response('日期,分享\n10月13日,去年的人選');
    assert.fail(`Unexpected request: ${address}`);
  });
  const env = { GOOGLE_SHEET_ID: 'scripture', UTMOST_ASSIGNMENT_CSV_URL: 'https://docs.google.com/spreadsheets/d/sharing/export?format=csv&gid=111' };
  const now = new Date('2026-10-13T01:00Z');
  assert.equal((await loadDailyBootstrap(env, now)).utmostSharing.found, false);
  newQuarter = true;
  const result = (await loadDailyBootstrap(env, now)).utmostSharing;
  assert.deepEqual(result, { found: true, date: '2026-10-13', sharer: '月琴', next: { date: '2026-10-14', sharer: '信一' } });
  assert.equal(calls.filter((url) => url.endsWith('/htmlview')).length, 2, 'new tabs must be discovered on refresh');
});

test('reports discovery, permission, and format failures instead of an empty schedule', async (t) => {
  let failure = 'discovery';
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('/spreadsheets/d/scripture/export')) return new Response('10/13,啟示錄,4,1,4,11');
    if (String(url).endsWith('/htmlview')) return new Response(failure === 'discovery' ? '<html>Login</html>' : 'items.push({name: "2026.10-12月", gid: "222"});');
    if (failure === 'permission') return new Response('Forbidden', { status: 403 });
    return new Response('檢查項目,結果\n主持人,1');
  });
  const env = { GOOGLE_SHEET_ID: 'scripture', UTMOST_ASSIGNMENT_SHEET_URL: 'https://docs.google.com/spreadsheets/d/sharing/edit' };
  const now = new Date('2026-10-13T01:00Z');
  for (const [mode, message] of [['discovery', /分頁清單/], ['permission', /HTTP 403/], ['format', /日期與分享欄位/]]) {
    failure = mode;
    const result = await loadDailyBootstrap(env, now);
    assert.equal(result.schedule.found, true);
    assert.equal(result.utmostSharing.found, false);
    assert.match(result.utmostSharing.error, message);
  }
});

test('parses quoted CSV cells used by the public assignment sheet', () => {
  assert.deepEqual(parseCsv('date,"name, title"\r\n7/20,"Amy ""A"""\r\n'), [
    ['date', 'name, title'],
    ['7/20', 'Amy "A"']
  ]);
});

test('loads private sheet data through the keyless Apps Script bridge', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://docs.google.com/spreadsheets/d/sheet-id/export')) {
      return new Response('日期,書卷,開始章,開始節,結束章,結束節\n7/20,約翰福音,1,1,1,18\n');
    }
    assert.equal(String(url), 'https://script.google.com/macros/s/deployment-id/exec');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['content-type'], 'text/plain; charset=utf-8');
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      ok: true,
      valueRanges: [
        { values: [['日期', '經文'], ['7/20', '約翰福音 1']] },
        { values: [
          ['編號', '姓名', 'Zoom別名', '可讀經文', '可讀竭誠獻上', '啟用', '排序'],
          ['1', '王小明', '小明', '是', '否', '是', '1']
        ] }
      ]
    }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await loadSheetBootstrap({
      GOOGLE_SHEET_ID: 'sheet-id',
      GOOGLE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/deployment-id/exec',
      GOOGLE_APPS_SCRIPT_SECRET: 'a-very-long-bridge-secret-value',
      APP_TIME_ZONE: 'Asia/Taipei'
    }, new Date('2026-07-20T01:00:00Z'));
    assert.deepEqual(requestBody, { version: 1, secret: 'a-very-long-bridge-secret-value' });
    assert.equal(result.roster.length, 1);
    assert.equal(result.roster[0].name, '王小明');
    assert.equal(result.roster[0].canReadScripture, true);
    assert.equal(result.roster[0].canReadUtmost, false);
    assert.equal(result.schedule.date, '2026-07-20');
    assert.equal(result.schedule.row.book, '約翰福音');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects an untrusted Apps Script endpoint', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('日期,書卷,開始章,開始節,結束章,結束節\n');
  try {
    await assert.rejects(() => loadSheetBootstrap({
      GOOGLE_SHEET_ID: 'sheet-id',
      GOOGLE_APPS_SCRIPT_URL: 'https://example.com/macros/s/deployment-id/exec',
      GOOGLE_APPS_SCRIPT_SECRET: 'a-very-long-bridge-secret-value'
    }), /Google Apps Script/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps current public daily data when the private bridge is unauthorized', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://docs.google.com/spreadsheets/d/sheet-id/export')) {
      return new Response('日期,書卷,開始章,開始節,結束章,結束節\n8/26,雅各書,1,1,1,18\n');
    }
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const env = {
      GOOGLE_SHEET_ID: 'sheet-id',
      GOOGLE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/deployment-id/exec',
      GOOGLE_APPS_SCRIPT_SECRET: 'a-very-long-bridge-secret-value',
      APP_TIME_ZONE: 'Asia/Taipei'
    };
    const date = new Date('2026-08-26T01:00:00Z');
    const daily = await loadDailyBootstrap(env, date);
    assert.equal(daily.schedule.date, '2026-08-26');
    assert.equal(daily.schedule.row.book, '雅各書');
    assert.equal(daily.utmostSharing.date, '2026-08-26');
    await assert.rejects(
      () => loadSheetBootstrap(env, date),
      (error) => error.message === 'Unauthorized' && error.dailyData.schedule.row.book === '雅各書'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
