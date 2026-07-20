import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSheetBootstrap, parseCsv } from '../src/google-sheets.mjs';

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
    assert.equal(url, 'https://script.google.com/macros/s/deployment-id/exec');
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects an untrusted Apps Script endpoint', async () => {
  await assert.rejects(() => loadSheetBootstrap({
    GOOGLE_SHEET_ID: 'sheet-id',
    GOOGLE_APPS_SCRIPT_URL: 'https://example.com/macros/s/deployment-id/exec',
    GOOGLE_APPS_SCRIPT_SECRET: 'a-very-long-bridge-secret-value'
  }), /Google Apps Script/);
});
