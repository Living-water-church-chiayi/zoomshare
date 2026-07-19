'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const projectRoot = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'app.js'), 'utf8');
const rendererHtml = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');

/*
 * Extract the function declaration from the real application source. This keeps
 * the tests executable in plain Node without loading Electron or booting the UI,
 * while ensuring the implementation under test is not copied into this file.
 */
function extractFunction(source, name) {
  const startMatch = new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(startMatch, `Cannot find function ${name} in application source`);

  const start = startMatch.index;
  const openingBrace = source.indexOf('{', startMatch.index + startMatch[0].length);
  assert.notEqual(openingBrace, -1, `Cannot find opening brace for ${name}`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openingBrace; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  assert.fail(`Cannot find closing brace for ${name}`);
}

function loadFunctions(source, names, globals = {}) {
  const context = vm.createContext({
    URL,
    Date,
    Number,
    String,
    parseInt,
    encodeURIComponent,
    ...globals
  });
  const declarations = names.map((name) => extractFunction(source, name)).join('\n');
  const exportsExpression = names.map((name) => `${name}: ${name}`).join(', ');
  const script = new vm.Script(
    `'use strict';\n${declarations}\nglobalThis.__runtimeTests = { ${exportsExpression} };`,
    { filename: 'extracted-application-functions.js' }
  );
  script.runInContext(context, { timeout: 1000 });
  return context.__runtimeTests;
}

const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

// Values created inside vm contexts have different prototypes from values in
// this Node process. Convert them to plain JSON values before deep comparison.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function scriptureFixture(count) {
  return Array.from({ length: count }, (_, index) => ({
    chapter: 1,
    number: index + 1,
    text: `第 ${index + 1} 節`,
    continuation: false,
    startsChapter: index === 0,
    key: `1:${index + 1}:${index}`
  }));
}

function loadScripturePaginationFunctions(pageFits) {
  return loadFunctions(
    rendererSource,
    ['logicalVerseCount', 'lastLogicalVerseGroup', 'rebalanceScriptureTail', 'buildScripturePagesByFit'],
    {
      SCRIPTURE_MIN_VERSES_PER_PAGE: 4,
      SCRIPTURE_MAX_VERSES_PER_PAGE: 6,
      scripturePageFits: pageFits,
      // Oversized-verse behavior has its own focused tests below. Keeping this
      // stub identity-like makes page distribution deterministic.
      splitOversizedScriptureVerse: (verse) => [verse]
    }
  );
}

test('compares real application versions without lexicographic mistakes', () => {
  const { versionParts, isNewerVersion } = loadFunctions(
    mainSource,
    ['versionParts', 'isNewerVersion']
  );

  assert.equal(isNewerVersion('v1.2.4', '1.2.3'), true);
  assert.equal(isNewerVersion('2.0.0', '1.99.99'), true);
  assert.equal(isNewerVersion('1.10.0', '1.9.99'), true);
  assert.equal(isNewerVersion('1.2.3', '1.2.3'), false);
  assert.equal(isNewerVersion('1.2.2', '1.2.3'), false);
  assert.equal(isNewerVersion('not-a-version', '1.2.3'), false);
  assert.equal(versionParts('1.2.3.4'), null);
});

test('creates a valid file URL for spaces, Unicode, #, ? and %', () => {
  const { fileUrl } = loadFunctions(mainSource, ['fileUrl'], { pathToFileURL });
  const specialPath = path.join(projectRoot, '測試 folder', '歌曲 #1?100%.mp4');
  const actual = fileUrl(specialPath);

  assert.equal(actual, pathToFileURL(specialPath).href);
  assert.match(actual, /^file:/);
  assert.match(actual, /%20/);
  assert.match(actual, /%23/);
  assert.match(actual, /%3F/i);
  assert.match(actual, /%25/);
});

test('converts only exact Zoom hosts or their subdomains', () => {
  const { zoomLaunchUrl } = loadFunctions(rendererSource, ['zoomLaunchUrl']);
  const valid = 'https://us06web.zoom.us/j/77730692079?pwd=A%20B%2F%3D';

  assert.equal(
    zoomLaunchUrl(valid),
    'zoommtg://us06web.zoom.us/join?action=join&confno=77730692079&pwd=A%20B%2F%3D'
  );
  assert.equal(
    zoomLaunchUrl('https://zoom.us/j/123456'),
    'zoommtg://zoom.us/join?action=join&confno=123456'
  );

  for (const untrusted of [
    'https://evilzoom.us/j/123456',
    'https://zoom.us.evil.example/j/123456',
    'https://zoom.us@evil.example/j/123456',
    'not a URL'
  ]) {
    assert.equal(zoomLaunchUrl(untrusted), '');
  }
});

test('rejects unsafe external protocols and forged zoommtg hosts', () => {
  const { normalizeExternalUrl } = loadFunctions(mainSource, ['normalizeExternalUrl']);

  assert.equal(
    normalizeExternalUrl('zoommtg://us06web.zoom.us/join?action=join&confno=123'),
    'zoommtg://us06web.zoom.us/join?action=join&confno=123'
  );
  assert.equal(normalizeExternalUrl('https://example.com/path'), 'https://example.com/path');
  assert.throws(() => normalizeExternalUrl('zoommtg://evilzoom.us/join'), /Zoom/);
  assert.throws(() => normalizeExternalUrl('javascript:alert(1)'), /HTTPS|Zoom/);
  assert.throws(() => normalizeExternalUrl('file:///C:/secret.txt'), /HTTPS|Zoom/);
  assert.throws(() => normalizeExternalUrl('https://user:pass@example.com/'), /帳號|密碼/);
});

test('accepts real YouTube hosts and rejects lookalike media URLs', () => {
  const { normalizeMediaRequest } = loadFunctions(mainSource, ['normalizeMediaRequest']);
  const valid = normalizeMediaRequest('https://www.youtube.com/watch?v=abc', 'video', 1080);

  assert.equal(valid.url, 'https://www.youtube.com/watch?v=abc');
  assert.equal(valid.kind, 'video');
  assert.equal(valid.quality, 1080);
  assert.throws(
    () => normalizeMediaRequest('https://youtube.com.evil.example/watch?v=abc', 'video', 1080),
    /YouTube/
  );
  assert.throws(
    () => normalizeMediaRequest('http://youtube.com/watch?v=abc', 'video', 1080),
    /HTTPS YouTube/
  );
  assert.throws(() => normalizeMediaRequest('https://youtu.be/abc', 'video', 9999), /144.*2160/);
  assert.throws(() => normalizeMediaRequest('https://youtu.be/abc', 'document', 1080), /audio.*video/);
});

test('validates custom worship presets with the same YouTube policy', () => {
  const { normalizeCustomWorshipUrl } = loadFunctions(rendererSource, ['normalizeCustomWorshipUrl']);

  assert.equal(
    normalizeCustomWorshipUrl('https://youtu.be/abc'),
    'https://youtu.be/abc'
  );
  assert.equal(normalizeCustomWorshipUrl('http://youtube.com/watch?v=abc'), '');
  assert.equal(normalizeCustomWorshipUrl('https://youtube.com.evil.example/watch?v=abc'), '');
  assert.equal(normalizeCustomWorshipUrl('https://example.com/video'), '');
});

test('does not mistake interrupted download fragments for final cache files', () => {
  const { isIncompleteCacheName } = loadFunctions(mainSource, ['isIncompleteCacheName']);

  for (const incomplete of [
    'video_hash.mp4.part',
    'video_hash.webm.ytdl',
    'video_hash.mp4.download',
    'video_hash.f137.webm',
    'video_hash.f140.m4a.part'
  ]) {
    assert.equal(isIncompleteCacheName(incomplete), true, incomplete);
  }
  assert.equal(isIncompleteCacheName('video_hash.mp4'), false);
  assert.equal(isIncompleteCacheName('audio_hash.m4a'), false);
});

test('keeps video quality variants in separate cache entries', () => {
  const { cacheKey } = loadFunctions(mainSource, ['cacheKey'], { crypto });
  const url = 'https://www.youtube.com/watch?v=abc';

  assert.notEqual(cacheKey(url, 'video', 720), cacheKey(url, 'video', 1080));
  assert.equal(cacheKey(url, 'audio', 720), cacheKey(url, 'audio', 1080));
});

test('builds the announcement from the renderer implementation and current config', () => {
  const cfg = {
    dateAuto: true,
    zoomUrl: 'https://us06web.zoom.us/j/77730692079?pwd=EbYm30dRERJb8FI3GRHadpkqdNLfE4.1',
    scriptureBook: '提摩太後書',
    scriptureStartCh: 3,
    scriptureStartV: 1,
    scriptureEndCh: 3,
    scriptureEndV: 17,
    useWorshipPreset: true,
    worshipPreset: 'https://youtu.be/stalePreset1',
    worshipUrl: 'https://youtu.be/7mrMh_2tXCI?si=xiVMJ-2zx56L9oeW',
    customWorshipPresets: [{
      title: '讚美之泉（美好的創造）',
      url: 'https://www.youtube.com/watch?v=7mrMh_2tXCI'
    }]
  };
  const functions = loadFunctions(
    rendererSource,
    [
      'parseZoomUrl',
      'todayCNDate',
      'chineseChapterNumber',
      'formatScriptureAnnouncementRef',
      'youtubeVideoId',
      'worshipOptionAnnouncementTitle',
      'currentWorshipAnnouncement',
      'buildAnnounceText'
    ],
    {
      cfg,
      CN_WEEKDAYS: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
      ZOOM_MEETING_PASSCODE: '52141425',
      ZOOM_PASSCODE_HINT: '我愛耶穌耶穌愛我'
    }
  );
  const announcement = functions.buildAnnounceText(new Date(2026, 6, 17, 9, 0, 0));

  assert.equal(announcement, [
    '親愛的活水家人們，早安，',
    '今天是7月17日星期五。',
    '',
    '請預備大家的聖經',
    '【聖經】提摩太後書三：1-17',
    '【竭誠獻上】',
    '',
    '主題: 早靈修班',
    '時間: 週二-周五 8:30 am',
    '',
    '加入 Zoom 會議',
    'https://us06web.zoom.us/j/77730692079?pwd=EbYm30dRERJb8FI3GRHadpkqdNLfE4.1',
    '',
    '蘋果電腦平板手機，',
    '請手動輸入帳號密碼喔！',
    '帳號：777 3069 2079',
    '密碼：52141425',
    '(我愛耶穌耶穌愛我）',
    '',
    '敬拜詩歌：讚美之泉（美好的創造）',
    'https://youtu.be/7mrMh_2tXCI?si=xiVMJ-2zx56L9oeW'
  ].join('\n'));
});

test('formats manual announcement dates and Chinese scripture chapter numbers', () => {
  const cfg = {
    dateAuto: false,
    dateManual: '7/18',
    scriptureBook: '詩篇',
    scriptureStartCh: 119,
    scriptureStartV: 105,
    scriptureEndCh: 119,
    scriptureEndV: 106
  };
  const functions = loadFunctions(
    rendererSource,
    ['todayCNDate', 'chineseChapterNumber', 'formatScriptureAnnouncementRef'],
    {
      cfg,
      CN_WEEKDAYS: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
    }
  );

  assert.equal(functions.todayCNDate(new Date(2026, 0, 1)), '7月18日星期六');
  assert.equal(functions.chineseChapterNumber(10), '十');
  assert.equal(functions.chineseChapterNumber(105), '一百零五');
  assert.equal(functions.chineseChapterNumber(119), '一百一十九');
  assert.equal(functions.formatScriptureAnnouncementRef(), '詩篇一百一十九：105-106');
  cfg.scriptureBook = '創世記';
  cfg.scriptureStartCh = 3;
  cfg.scriptureStartV = 17;
  cfg.scriptureEndCh = 4;
  cfg.scriptureEndV = 2;
  assert.equal(functions.formatScriptureAnnouncementRef(), '創世記三：17-四：2');
});

test('resolves worship announcement titles by YouTube video id and ignores empty options', () => {
  const cfg = {
    useWorshipPreset: false,
    worshipUrl: 'https://youtu.be/7mrMh_2tXCI?si=current-share',
    worshipPreset: '',
    customWorshipPresets: []
  };
  const document = {
    getElementById() {
      return {
        options: [
          { value: '', textContent: '選擇敬拜影片' },
          {
            value: 'https://www.youtube.com/watch?v=7mrMh_2tXCI&list=example',
            textContent: '讚美之泉（美好的創造）'
          }
        ]
      };
    }
  };
  const functions = loadFunctions(
    rendererSource,
    ['youtubeVideoId', 'worshipOptionAnnouncementTitle', 'currentWorshipAnnouncement'],
    { cfg, document }
  );

  assert.equal(functions.youtubeVideoId(cfg.worshipUrl), '7mrMh_2tXCI');
  assert.deepEqual(plain(functions.currentWorshipAnnouncement()), {
    title: '讚美之泉（美好的創造）',
    url: cfg.worshipUrl
  });

  cfg.worshipUrl = '';
  cfg.worshipPreset = 'https://youtu.be/old-selection';
  cfg.worshipTitle = '不應套用到空網址';
  assert.deepEqual(plain(functions.currentWorshipAnnouncement()), { title: '', url: '' });
});

test('keeps every built-in worship announcement title paired with the video that will play', () => {
  const expectedTitles = new Map([
    ['7mrMh_2tXCI', '讚美之泉（美好的創造）'],
    ['v76-wz1mv8w', '讚美之泉（祢的恩典夠我用）'],
    ['mVqSmWIjoZU', '讚美之泉（好喜歡與你在一起）'],
    ['kvrRtRe9AoU', '讚美之泉（我們的神）'],
    ['uSHI-9s4dTU', '盛曉玫（依然愛我）'],
    ['lfP-3JLVvaw', '盛曉玫（活出愛）'],
    ['Q3m-in8i6FU', '盛曉玫（幸福）'],
    ['96WDXhk6qjU', '盛曉玫（有一天）'],
    ['eGAeeQxZ6FM', '盛曉玫（因為祢）'],
    ['KqlvbYd5uJA', '新店行道會（叫我抬起頭的神）'],
    ['v-k7ojwYE08', '新店行道會（這裡有榮耀）']
  ]);
  const options = Array.from(
    rendererHtml.matchAll(/<option\s+value="([^"]+)"\s+data-announcement-title="([^"]+)">([^<]+)<\/option>/g),
    (match) => ({
      value: match[1],
      dataset: { announcementTitle: match[2] },
      textContent: match[3],
      selected: false
    })
  );
  assert.equal(options.length, expectedTitles.size, 'unexpected number of titled built-in worship options');

  const cfg = { useWorshipPreset: true, worshipUrl: '', customWorshipPresets: [] };
  const select = { options, selectedOptions: [] };
  const document = { getElementById: (id) => id === 'worshipPreset' ? select : null };
  const functions = loadFunctions(
    rendererSource,
    ['youtubeVideoId', 'worshipOptionAnnouncementTitle', 'currentWorshipAnnouncement'],
    { cfg, document }
  );

  for (const option of options) {
    const videoId = functions.youtubeVideoId(option.value);
    assert.ok(expectedTitles.has(videoId), `unexpected worship video id ${videoId}`);
    cfg.worshipUrl = option.value;
    cfg.customWorshipPresets = [{
      title: '不應覆蓋今天選取歌曲的舊名稱',
      url: `https://www.youtube.com/watch?v=${videoId}`
    }];
    select.selectedOptions = [option];
    assert.deepEqual(plain(functions.currentWorshipAnnouncement()), {
      title: expectedTitles.get(videoId),
      url: option.value
    });

    cfg.useWorshipPreset = false;
    select.selectedOptions = [];
    assert.deepEqual(plain(functions.currentWorshipAnnouncement()), {
      title: expectedTitles.get(videoId),
      url: option.value
    }, `manual URL mode used a stale custom title for ${videoId}`);
    cfg.useWorshipPreset = true;
  }
});

test('parses scripture verses across chapter boundaries without losing chapter identity', () => {
  const { parseScriptureVerses } = loadFunctions(
    rendererSource,
    ['parseScriptureVerses'],
    {
      window: {
        BIBLE: [{ n: '測試書', v: [31, 25] }]
      }
    }
  );
  const ref = { book: '測試書', startCh: 1, startV: 30, endCh: 2, endV: 2 };
  const verses = plain(parseScriptureVerses(
    '30 第一章第三十節\n31 第一章第三十一節\n1 第二章第一節\n2 第二章第二節',
    ref
  ));

  assert.deepEqual(
    verses.map(({ chapter, number }) => [chapter, number]),
    [[1, 30], [1, 31], [2, 1], [2, 2]]
  );
  assert.deepEqual(
    verses.map(({ startsChapter }) => startsChapter),
    [false, false, true, false]
  );
  assert.deepEqual(
    verses.map(({ continuation }) => continuation),
    [false, false, false, false]
  );
  assert.equal(new Set(verses.map(({ key }) => key)).size, verses.length);

  // If an upstream passage omits intervening verses, matching must search
  // forward by verse number instead of assigning chapters positionally.
  const withMissingVerses = plain(parseScriptureVerses(
    '30 第一章第三十節\n2 第二章第二節',
    ref
  ));
  assert.deepEqual(
    withMissingVerses.map(({ chapter, number }) => [chapter, number]),
    [[1, 30], [2, 2]]
  );
  assert.equal(withMissingVerses[1].startsChapter, true);

  const withStandaloneChapterMarker = plain(parseScriptureVerses(
    '30 第一章第三十節\n31 第一章第三十一節 2\n1 第二章第一節\n2 第二章第二節',
    ref
  ));
  assert.equal(withStandaloneChapterMarker[1].text, '第一章第三十一節');
  assert.deepEqual(
    withStandaloneChapterMarker.map(({ chapter, number }) => [chapter, number]),
    [[1, 30], [1, 31], [2, 1], [2, 2]]
  );
});

test('paginates short scripture passages into balanced groups of four to six verses', () => {
  const pageFits = (verses) => verses.length <= 6;
  const { buildScripturePagesByFit } = loadScripturePaginationFunctions(pageFits);
  const expectedDistributions = new Map([
    [6, [6]],
    [7, [4, 3]],
    [8, [4, 4]],
    [13, [5, 4, 4]],
    [19, [5, 5, 5, 4]],
    [25, [5, 5, 5, 5, 5]]
  ]);

  for (const [verseCount, expectedDistribution] of expectedDistributions) {
    const input = scriptureFixture(verseCount);
    const pages = plain(buildScripturePagesByFit(input));
    const distribution = pages.map((page) => new Set(page.verses.map((verse) => verse.key)).size);
    assert.deepEqual(distribution, expectedDistribution, `${verseCount} verses is not balanced`);
    assert.ok(distribution.every((count) => count <= 6), `${verseCount} verses exceeds six-per-page cap`);
    assert.ok(
      distribution.every((count) => count >= (verseCount === 7 ? 3 : 4)),
      `${verseCount} verses has an avoidably sparse page: ${distribution.join(', ')}`
    );
    assert.ok(
      pages.length === 1 || distribution[distribution.length - 1] >= 3,
      `${verseCount} verses leaves an orphaned one- or two-verse final page`
    );
    assert.deepEqual(
      pages.flatMap((page) => page.verses.map((verse) => verse.key)),
      input.map((verse) => verse.key),
      `${verseCount} verses changed order or content membership`
    );
  }
});

test('allows fewer than four scripture verses only when the measured page cannot fit more', () => {
  const pageFits = (verses) => verses.length <= 3;
  const { buildScripturePagesByFit } = loadScripturePaginationFunctions(pageFits);
  const input = scriptureFixture(8);
  const pages = plain(buildScripturePagesByFit(input));

  assert.deepEqual(pages.map((page) => page.verses.length), [3, 3, 2]);
  assert.ok(pages.every((page) => page.verses.length <= 3));
  assert.deepEqual(
    pages.flatMap((page) => page.verses.map((verse) => verse.key)),
    input.map((verse) => verse.key)
  );
});

test('splits an oversized scripture verse without losing text or chapter context', () => {
  const maxCharacters = 8;
  const scripturePageFits = (verses) => (
    verses.length === 1 && Array.from(verses[0].text).length <= maxCharacters
  );
  const { splitOversizedScriptureVerse } = loadFunctions(
    rendererSource,
    ['scriptureSentenceTokens', 'largestFittingVersePrefix', 'splitOversizedScriptureVerse'],
    { scripturePageFits }
  );
  const original = {
    chapter: 2,
    number: 1,
    text: '起初神創造天地。地是空虛混沌。淵面黑暗。',
    continuation: false,
    startsChapter: true,
    key: '2:1:0'
  };
  const parts = plain(splitOversizedScriptureVerse(original));

  assert.ok(parts.length > 1);
  assert.equal(parts.map((part) => part.text).join(''), original.text);
  assert.deepEqual(parts.map((part) => part.chapter), parts.map(() => original.chapter));
  assert.deepEqual(parts.map((part) => part.number), parts.map(() => original.number));
  assert.deepEqual(parts.map((part) => part.key), parts.map(() => original.key));
  assert.equal(parts[0].continuation, false);
  assert.ok(parts.slice(1).every((part) => part.continuation));
  assert.equal(parts[0].startsChapter, true);
  assert.ok(parts.slice(1).every((part) => !part.startsChapter));
  assert.ok(parts.every((part) => part.text && Array.from(part.text).length <= maxCharacters));

  const shortVerse = { ...original, text: '短經文。' };
  assert.deepEqual(plain(splitOversizedScriptureVerse(shortVerse)), [shortVerse]);
});

test('uses code points when splitting an unpunctuated oversized verse', () => {
  const maxCharacters = 3;
  const scripturePageFits = (verses) => (
    verses.length === 1 && Array.from(verses[0].text).length <= maxCharacters
  );
  const { splitOversizedScriptureVerse } = loadFunctions(
    rendererSource,
    ['scriptureSentenceTokens', 'largestFittingVersePrefix', 'splitOversizedScriptureVerse'],
    { scripturePageFits }
  );
  const original = {
    chapter: 1,
    number: 1,
    text: '甲乙😀丙丁戊己庚辛壬癸',
    continuation: false,
    startsChapter: true,
    key: '1:1:0'
  };
  const parts = plain(splitOversizedScriptureVerse(original));

  assert.equal(parts.map((part) => part.text).join(''), original.text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => Array.from(part.text).length <= maxCharacters));
  assert.ok(parts.slice(1).every((part) => part.continuation));
});

test('builds one structured Utmost page with distinct heading, verse and body paragraphs', () => {
  const { createUtmostPage } = loadFunctions(
    rendererSource,
    ['createUtmostPage'],
    { systemDateChinese: () => '7月19日' }
  );
  const maliciousText = '<img src=x onerror=alert(1)>';
  const page = plain(createUtmostPage({
    date: '7月19日',
    title: `信心的操練 ${maliciousText}`,
    verse: '你們要休息，要知道我是神。',
    body: '第一段正文。\n\n第二段正文。\n第三段正文。'
  }));

  assert.deepEqual(page, {
    type: 'utmost',
    date: '7月19日',
    title: `信心的操練 ${maliciousText}`,
    verse: '你們要休息，要知道我是神。',
    paragraphs: ['第一段正文。', '第二段正文。', '第三段正文。']
  });
  assert.equal(Array.isArray(page), false, 'Utmost must be represented by one page object');
  assert.equal(page.paragraphs.join(''), '第一段正文。第二段正文。第三段正文。');

  const emptyBody = plain(createUtmostPage({ date: '7月19日', title: '', verse: '', body: '' }));
  assert.equal(emptyBody.type, 'utmost');
  assert.equal(emptyBody.title, '竭誠獻上');
  assert.deepEqual(emptyBody.paragraphs, ['今天暫時沒有正文內容。']);
});

test('uses unmodified left and right arrows for Scripture and Utmost navigation', () => {
  const calls = [];
  let settingsOpen = false;
  const elements = {
    flowScreen: { classList: { contains: (name) => name === 'hidden' ? false : false } },
    settingsPanel: { classList: { contains: (name) => name === 'hidden' ? !settingsOpen : false } }
  };
  const { handleFlowArrowNavigation } = loadFunctions(
    rendererSource,
    ['isEditableFlowNavigationTarget', 'handleFlowArrowNavigation'],
    {
      $: (id) => elements[id],
      flowStep: 'scripture',
      worshipActive: false,
      flowTransitioning: false,
      flowLoading: false,
      nextFlowPageOrStep: (source) => calls.push(['next', source]),
      prevFlowPageOrStep: () => calls.push(['prev'])
    }
  );
  const target = { tagName: 'DIV', isContentEditable: false, closest: () => null };
  const arrowEvent = (key, overrides = {}) => {
    let prevented = false;
    const event = {
      key,
      repeat: false,
      isComposing: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target,
      preventDefault: () => { prevented = true; },
      ...overrides
    };
    return { event, prevented: () => prevented };
  };

  const right = arrowEvent('ArrowRight');
  assert.equal(handleFlowArrowNavigation(right.event), true);
  assert.equal(right.prevented(), true);
  const left = arrowEvent('ArrowLeft');
  assert.equal(handleFlowArrowNavigation(left.event), true);
  assert.equal(left.prevented(), true);
  assert.deepEqual(calls, [['next', 'keyboard'], ['prev']]);

  for (const blocked of [
    arrowEvent('ArrowRight', { repeat: true }),
    arrowEvent('ArrowRight', { metaKey: true }),
    arrowEvent('ArrowLeft', { target: { tagName: 'INPUT', closest: () => null } }),
    arrowEvent('ArrowLeft', { target: { tagName: 'DIV', isContentEditable: true, closest: () => null } })
  ]) {
    assert.equal(handleFlowArrowNavigation(blocked.event), false);
    assert.equal(blocked.prevented(), false);
  }
  settingsOpen = true;
  const inSettings = arrowEvent('ArrowRight');
  assert.equal(handleFlowArrowNavigation(inSettings.event), false);
  assert.equal(inSettings.prevented(), false);
  assert.deepEqual(calls, [['next', 'keyboard'], ['prev']]);

  settingsOpen = false;
  const utmostCalls = [];
  const utmostNavigation = loadFunctions(
    rendererSource,
    ['isEditableFlowNavigationTarget', 'handleFlowArrowNavigation'],
    {
      $: (id) => elements[id],
      flowStep: 'utmost',
      worshipActive: false,
      flowTransitioning: false,
      flowLoading: false,
      nextFlowPageOrStep: (source) => utmostCalls.push(['next', source]),
      prevFlowPageOrStep: () => utmostCalls.push(['prev'])
    }
  );
  const utmostRight = arrowEvent('ArrowRight');
  assert.equal(utmostNavigation.handleFlowArrowNavigation(utmostRight.event), true);
  assert.equal(utmostRight.prevented(), true);
  assert.deepEqual(utmostCalls, [['next', 'keyboard']]);
});

test('treats one inertial wheel gesture as at most one reading-page action', () => {
  let settingsOpen = false;
  let nextTimerId = 1;
  const timers = new Map();
  const calls = [];
  const elements = {
    flowScreen: { classList: { contains: (name) => name === 'hidden' ? false : false } },
    settingsPanel: { classList: { contains: (name) => name === 'hidden' ? !settingsOpen : false } }
  };
  const functions = loadFunctions(
    rendererSource,
    [
      'isEditableFlowNavigationTarget',
      'resetFlowWheelGesture',
      'normalizedFlowWheelDelta',
      'handleFlowWheelNavigation'
    ],
    {
      $: (id) => elements[id],
      window: { innerHeight: 720 },
      setTimeout: (run, milliseconds) => {
        const id = nextTimerId++;
        timers.set(id, { run, milliseconds });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      flowStep: 'scripture',
      worshipActive: false,
      flowTransitioning: false,
      flowLoading: false,
      flowWheelDelta: 0,
      flowWheelGestureLocked: false,
      flowWheelResetTimer: null,
      FLOW_WHEEL_THRESHOLD: 36,
      FLOW_WHEEL_IDLE_MS: 300,
      nextFlowPageOrStep: (source) => calls.push(['next', source]),
      prevFlowPageOrStep: () => calls.push(['prev'])
    }
  );
  const wheelEvent = (deltaY, overrides = {}) => {
    let prevented = false;
    const event = {
      deltaY,
      deltaX: 0,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      target: { tagName: 'DIV', isContentEditable: false, closest: () => null },
      preventDefault: () => { prevented = true; },
      ...overrides
    };
    return { event, prevented: () => prevented };
  };
  const runIdleTimer = () => {
    assert.equal(timers.size, 1, 'wheel gesture should have one debounced idle timer');
    const [id, timer] = timers.entries().next().value;
    timers.delete(id);
    assert.equal(timer.milliseconds, 300);
    timer.run();
  };

  for (const delta of [10, 11, 16]) {
    const wheel = wheelEvent(delta);
    assert.equal(functions.handleFlowWheelNavigation(wheel.event), true);
    assert.equal(wheel.prevented(), true);
  }
  assert.deepEqual(calls, [['next', 'wheel']]);

  for (const inertialTail of [80, 30, 8, 2]) {
    functions.handleFlowWheelNavigation(wheelEvent(inertialTail).event);
  }
  assert.deepEqual(calls, [['next', 'wheel']], 'inertial tail flipped more than one page');
  runIdleTimer();

  const lineModeWheel = wheelEvent(-3, { deltaMode: 1 });
  assert.equal(functions.handleFlowWheelNavigation(lineModeWheel.event), true);
  assert.deepEqual(calls, [['next', 'wheel'], ['prev']]);
  runIdleTimer();

  settingsOpen = true;
  const settingsWheel = wheelEvent(100);
  assert.equal(functions.handleFlowWheelNavigation(settingsWheel.event), false);
  assert.equal(settingsWheel.prevented(), false, 'settings scrolling must retain its native behavior');
  settingsOpen = false;
  const inputWheel = wheelEvent(100, { target: { tagName: 'TEXTAREA', closest: () => null } });
  assert.equal(functions.handleFlowWheelNavigation(inputWheel.event), false);
  assert.equal(inputWheel.prevented(), false);
});

test('ignores repeated Escape keydown events during reading completion confirmation', () => {
  let returnRequests = 0;
  const elements = {
    settingsPanel: { classList: { contains: (name) => name === 'hidden' } },
    flowScreen: { classList: { contains: (name) => name === 'hidden' ? false : false } }
  };
  const { handleEscapeNavigation } = loadFunctions(rendererSource, ['handleEscapeNavigation'], {
    $: (id) => elements[id],
    flowStep: 'utmost',
    worshipActive: false,
    closeSettings: () => assert.fail('hidden settings panel was closed'),
    requestFlowReturnToCover: (source) => {
      assert.equal(source, 'escape');
      returnRequests++;
    }
  });
  const escapeEvent = (overrides = {}) => {
    let prevented = false;
    const event = {
      key: 'Escape',
      repeat: false,
      isComposing: false,
      preventDefault: () => { prevented = true; },
      ...overrides
    };
    return { event, prevented: () => prevented };
  };

  const first = escapeEvent();
  assert.equal(handleEscapeNavigation(first.event), true);
  assert.equal(first.prevented(), true);
  assert.equal(returnRequests, 1);

  for (const ignored of [escapeEvent({ repeat: true }), escapeEvent({ isComposing: true })]) {
    assert.equal(handleEscapeNavigation(ignored.event), false);
    assert.equal(ignored.prevented(), false);
  }
  assert.equal(returnRequests, 1, 'one held Escape key armed and completed the flow');
});

function loadUtmostConfirmationHarness() {
  let now = 1000;
  let nextTimerId = 1;
  const timers = new Map();
  const calls = { returned: 0, revealed: 0, toasts: [], steps: [] };
  const elements = {
    flowScreen: { classList: { contains: (name) => name === 'hidden' ? false : false } },
    flowNextPage: { textContent: '完成' }
  };
  const functions = loadFunctions(
    rendererSource,
    [
      'isUtmostFinalPage',
      'resetUtmostFinishConfirmation',
      'requestUtmostFinishConfirmation',
      'requestFlowReturnToCover',
      'prevFlowPageOrStep'
    ],
    {
      $: (id) => elements[id],
      Date: { now: () => now },
      setTimeout: (run, milliseconds) => {
        const id = nextTimerId++;
        timers.set(id, { run, milliseconds });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      flowStep: 'utmost',
      flowPages: [{ type: 'utmost' }],
      flowPageIndex: 0,
      flowTransitioning: false,
      utmostFinishConfirmUntil: 0,
      utmostFinishConfirmTimer: null,
      UTMOST_FINISH_CONFIRM_MS: 3500,
      revealUtmostFooter: () => { calls.revealed++; },
      toast: (message, milliseconds) => calls.toasts.push([message, milliseconds]),
      returnToMainCover: () => { calls.returned++; },
      prevFlowStep: () => calls.steps.push('previous-step'),
      renderFlowPage: () => calls.steps.push('render'),
      goFlowStep: (step) => {
        calls.steps.push(step);
        return Promise.resolve(false);
      }
    }
  );
  return {
    ...functions,
    calls,
    elements,
    timers,
    advanceTime(milliseconds) { now += milliseconds; },
    runOnlyTimer() {
      assert.equal(timers.size, 1, 'expected one pending confirmation timer');
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.run();
      return timer.milliseconds;
    }
  };
}

test('requires a deliberate second action before leaving the Utmost page', () => {
  const harness = loadUtmostConfirmationHarness();

  assert.equal(harness.requestFlowReturnToCover('button'), false);
  assert.equal(harness.calls.returned, 0);
  assert.equal(harness.elements.flowNextPage.textContent, '再按一次完成');
  assert.equal(harness.calls.revealed, 1);
  assert.match(harness.calls.toasts[0][0], /再按一次/);

  assert.equal(harness.requestFlowReturnToCover('keyboard'), true);
  assert.equal(harness.calls.returned, 1);
  assert.equal(harness.elements.flowNextPage.textContent, '完成');
  assert.equal(harness.timers.size, 0);
});

test('does not let inertial wheel scrolling confirm or finish Utmost', () => {
  const harness = loadUtmostConfirmationHarness();

  assert.equal(harness.requestFlowReturnToCover('wheel'), false);
  assert.equal(harness.calls.returned, 0);
  assert.equal(harness.timers.size, 0, 'wheel input must not arm the completion deadline');
  assert.match(harness.calls.toasts[0][0], /右方向鍵/);

  assert.equal(harness.requestFlowReturnToCover('button'), false);
  assert.equal(harness.calls.returned, 0, 'first deliberate action after wheel input must still only arm');
  assert.equal(harness.requestFlowReturnToCover('button'), true);
  assert.equal(harness.calls.returned, 1);
});

test('expires the Utmost completion confirmation and restores its label', () => {
  const harness = loadUtmostConfirmationHarness();

  assert.equal(harness.requestUtmostFinishConfirmation(), false);
  harness.advanceTime(3500);
  assert.equal(harness.runOnlyTimer(), 3500);
  assert.equal(harness.elements.flowNextPage.textContent, '完成');
  assert.equal(harness.requestUtmostFinishConfirmation(), false, 'expired confirmation must arm again');
  assert.equal(harness.elements.flowNextPage.textContent, '再按一次完成');
});

test('uses the first left action to cancel an armed Utmost completion', () => {
  const harness = loadUtmostConfirmationHarness();

  assert.equal(harness.requestUtmostFinishConfirmation(), false);
  harness.prevFlowPageOrStep();
  assert.deepEqual(harness.calls.steps, []);
  assert.equal(harness.elements.flowNextPage.textContent, '完成');

  harness.prevFlowPageOrStep();
  assert.deepEqual(harness.calls.steps, ['scripture']);
});

test('keeps the cover silent after Utmost while preserving manual music playback', () => {
  const audio = {
    paused: false,
    volume: 0.9,
    pauseCalls: 0,
    pause() { this.paused = true; this.pauseCalls++; }
  };
  const switchStates = [];
  let clearedFade = 0;
  let playRequests = 0;
  const elements = {
    bgAudio: audio,
    flowScreen: { classList: { contains: (name) => name === 'hidden' } }
  };
  const { resumeMusicOnCover, toggleMusic } = loadFunctions(
    rendererSource,
    ['resumeMusicOnCover', 'isMainCover', 'toggleMusic'],
    {
      $: (id) => elements[id],
      cfg: { autoPlayMusic: true, musicUrl: 'file:///music.mp3', musicVolume: 0.42 },
      flowReachedUtmost: true,
      flowStep: 'cover',
      flowTransitioning: false,
      worshipActive: false,
      musicResumeOnCover: true,
      musicDesired: true,
      musicPlaying: true,
      musicRequestToken: 7,
      musicFadeTimer: 99,
      clearInterval: () => { clearedFade++; },
      setMusicSwitchState: (on) => switchStates.push(on),
      resolveAndPlayMusic: () => { playRequests++; },
      fadeOutMusic: () => assert.fail('manual playback was mistaken for a fade-out')
    }
  );

  resumeMusicOnCover();
  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.volume, 0.42);
  assert.equal(clearedFade, 1);
  assert.equal(playRequests, 0, 'auto-play must not override the post-Utmost silence');
  assert.deepEqual(switchStates, [false]);

  toggleMusic();
  assert.equal(playRequests, 1, 'the user must still be able to start music manually');
  assert.deepEqual(switchStates, [false, true]);
});

test('blocks manual music controls until the cover window transition is settled', () => {
  const elements = {
    flowScreen: { classList: { contains: (name) => name === 'hidden' } }
  };
  let playRequests = 0;
  const musicGlobals = (flowTransitioning) => ({
    $: (id) => elements[id],
    cfg: { musicUrl: 'file:///music.mp3' },
    flowTransitioning,
    flowStep: 'cover',
    worshipActive: false,
    musicResumeOnCover: false,
    musicDesired: false,
    musicPlaying: false,
    musicRequestToken: 0,
    setMusicSwitchState: () => {},
    resolveAndPlayMusic: () => { playRequests++; },
    fadeOutMusic: () => assert.fail('inactive music should not fade')
  });
  const transitioning = loadFunctions(
    rendererSource,
    ['isMainCover', 'toggleMusic'],
    musicGlobals(true)
  );
  const settled = loadFunctions(
    rendererSource,
    ['isMainCover', 'toggleMusic'],
    musicGlobals(false)
  );

  transitioning.toggleMusic();
  assert.equal(playRequests, 0);
  settled.toggleMusic();
  assert.equal(playRequests, 1);
});

test('still completes the programmatic music resume while the cover window settles', async () => {
  const audio = {
    src: '',
    volume: 1,
    playCalls: 0,
    pauseCalls: 0,
    play() { this.playCalls++; return Promise.resolve(); },
    pause() { this.pauseCalls++; }
  };
  const elements = {
    flowScreen: { classList: { contains: (name) => name === 'hidden' } },
    bgAudio: audio
  };
  const { resumeMusicOnCover } = loadFunctions(
    rendererSource,
    ['isMainCover', 'normalizeMediaUrl', 'resolveAndPlayMusic', 'resumeMusicOnCover'],
    {
      $: (id) => elements[id],
      window: {
        location: { href: 'file:///D:/zoomshare/src/renderer/index.html' },
        api: {
          mediaStatus: async () => ({ cached: true }),
          ensureMedia: async () => ({ ok: true, path: 'file:///D:/cache/music.mp3' })
        }
      },
      cfg: { autoPlayMusic: true, musicUrl: 'https://youtu.be/music', musicVolume: 0.37 },
      flowTransitioning: true,
      flowStep: 'cover',
      flowReachedUtmost: false,
      worshipActive: false,
      musicResumeOnCover: true,
      musicDesired: false,
      musicPlaying: false,
      musicRequestToken: 0,
      musicFadeTimer: null,
      setMusicSwitchState: () => {},
      showBadge: () => {},
      hideBadge: () => {},
      toast: () => {},
      openSettings: () => {}
    }
  );

  resumeMusicOnCover();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audio.playCalls, 1, 'programmatic cover resume was blocked by the transition guard');
  assert.equal(audio.pauseCalls, 0);
  assert.equal(audio.volume, 0.37);
});

test('retains the previous cover music resume behavior before Utmost is reached', () => {
  let playRequests = 0;
  const { resumeMusicOnCover } = loadFunctions(rendererSource, ['resumeMusicOnCover'], {
    $: () => ({ paused: true, volume: 1 }),
    cfg: { autoPlayMusic: true, musicUrl: 'file:///music.mp3', musicVolume: 0.5 },
    flowReachedUtmost: false,
    musicResumeOnCover: false,
    musicDesired: false,
    musicPlaying: false,
    musicRequestToken: 0,
    musicFadeTimer: null,
    setMusicSwitchState: () => {},
    resolveAndPlayMusic: () => { playRequests++; }
  });

  resumeMusicOnCover();
  assert.equal(playRequests, 1);
});

test('keeps the post-Utmost silence latch when navigating back before the cover', async () => {
  const audio = {
    volume: 1,
    pauseCalls: 0,
    pause() { this.pauseCalls++; }
  };
  let playRequests = 0;
  const classList = { remove: () => {}, contains: (name) => name === 'hidden' ? false : false };
  const elements = {
    toolbar: { classList },
    worshipControls: { classList },
    flowScreen: { dataset: {}, classList },
    bgAudio: audio
  };
  const { goFlowStep } = loadFunctions(rendererSource, ['resumeMusicOnCover', 'goFlowStep'], {
    $: (id) => elements[id],
    cfg: { autoPlayMusic: true, musicUrl: 'file:///music.mp3', musicVolume: 0.36 },
    window: { api: { setWindowMode: async () => {} } },
    FLOW_ORDER: ['cover', 'worship', 'scripture', 'utmost'],
    flowStep: 'cover',
    flowReachedUtmost: false,
    flowNavigationToken: 0,
    flowTransitioning: false,
    flowLoading: false,
    worshipActive: false,
    musicResumeOnCover: false,
    musicDesired: false,
    musicPlaying: false,
    musicRequestToken: 0,
    musicFadeTimer: null,
    resetUtmostFinishConfirmation: () => false,
    hideUtmostFooterImmediately: () => {},
    stopWorshipPlayback: () => {},
    pauseMusicForFlow: () => {},
    setFlowVisible: () => {},
    waitForFlowLayout: async () => true,
    showScriptureFlow: async () => true,
    showUtmostFlow: async () => true,
    startWorship: async () => true,
    showToolbar: () => {},
    setMusicSwitchState: () => {},
    resolveAndPlayMusic: () => { playRequests++; }
  });

  assert.equal(await goFlowStep('utmost'), true);
  assert.equal(await goFlowStep('scripture'), true);
  assert.equal(await goFlowStep('cover'), true);
  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.volume, 0.36);
  assert.equal(playRequests, 0, 'backtracking must not discard the Utmost silence latch');

  assert.equal(await goFlowStep('scripture'), true);
  assert.equal(await goFlowStep('cover'), true);
  assert.equal(playRequests, 1, 'a later flow that never reaches Utmost keeps the previous resume behavior');
});

async function runTests() {
  let passed = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      passed += 1;
      console.log(`ok ${passed} - ${name}`);
    } catch (error) {
      console.error(`not ok ${passed + 1} - ${name}`);
      throw error;
    }
  }
  console.log(`\n${passed} runtime tests passed`);
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
