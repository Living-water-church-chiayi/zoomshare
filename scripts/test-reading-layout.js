'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session } = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const rendererEntry = path.join(projectRoot, 'src', 'renderer', 'index.html');
const rendererSource = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'app.js'), 'utf8');
const coverViewports = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 }
];
const viewports = [
  { width: 405, height: 720 },
  { width: 608, height: 1080 },
  { width: 320, height: 560 }
];

const scripturePage = {
  type: 'scripture',
  verses: [
    {
      key: '5:1:0', chapter: 5, number: 1, startsChapter: false, continuation: false,
      text: '不可嚴責老年人，只要勸他如同父親；勸少年人如同弟兄。'
    },
    {
      key: '5:2:1', chapter: 5, number: 2, startsChapter: false, continuation: false,
      text: '勸老年婦女如同母親；勸少年婦女如同姊妹，總要清清潔潔的。'
    },
    {
      key: '6:1:2', chapter: 6, number: 1, startsChapter: true, continuation: false,
      text: '凡在軛下作僕人的，當以自己主人配受十分的恭敬。'
    },
    {
      key: '6:2:3', chapter: 6, number: 2, startsChapter: false, continuation: false,
      text: '僕人有信道的主人，不可因為與他是弟兄就輕看他；'
    },
    {
      key: '6:2:3', chapter: 6, number: 2, startsChapter: false, continuation: true,
      text: '更要加意服事他，因為得服事之益處的，是信道蒙愛的。'
    }
  ]
};

const utmostCases = [
  {
    name: 'utmost-normal',
    date: '七月十九日',
    title: '在主裡安靜等候',
    verse: '你們得力在乎平靜安穩。—以賽亞書三十章十五節',
    paragraphs: [
      '信心不是勉強自己抓緊一個答案，而是在尚未看見道路時，仍然安靜地把今天交在神手中。',
      '當我們停止催促自己，心便重新聽見那微小而確定的引導，並在平凡的責任中忠心前行。'
    ]
  },
  {
    name: 'utmost-long',
    date: '七月十九日',
    title: '讓生命在順服中成為祝福',
    verse: '你們要先求他的國和他的義，這些東西都要加給你們了。—馬太福音六章三十三節',
    paragraphs: [
      '屬靈生命的成熟，不在於我們累積了多少令人驚訝的經驗，而在於每一次清楚看見責任時，是否願意安靜而徹底地順服。',
      '許多時候，我們期待神先把整張地圖攤開，才肯踏出第一步；然而真正的信靠，是只憑今天所得的亮光前行，並把尚未明白的部分留給祂。',
      '順服並不使人失去自由。當心不再同時追逐許多聲音，我們反而能專注於眼前的人、眼前的工作，以及此刻可以付出的愛。',
      '不要輕看重複而細小的忠心。它們像看不見的根，在日復一日之中向下伸展，使生命能在風雨來臨時仍然站立。',
      '今天不必證明自己能完成所有事情；只要誠實回應已經領受的託付，讓結果安穩地留在神手中。',
      '在人看來微不足道的選擇，常是生命方向被重新校準的地方；每一次放下急躁，都讓心更能分辨什麼才是真正重要的。',
      '當答案還沒有出現，我們仍然可以選擇誠實、寬容與感恩，並把不能控制的明天交給那位比我們更清楚全貌的主。',
      '忠心不一定會被看見，卻會在日常的重複中塑造一個可信靠的人，使我們在突然的風雨裡仍能持守所相信的。',
      '願今天的每一份工作都成為敬拜，每一次與人相遇都成為祝福，並讓平安不在結果裡，而在同在中逐漸穩固。'
    ]
  },
  {
    name: 'utmost-extreme',
    date: '七月十九日',
    title: '在漫長等待與未知道路之中，仍然專一仰望那不改變的應許',
    verse: '但那等候耶和華的必重新得力；他們必如鷹展翅上騰，他們奔跑卻不困倦，行走卻不疲乏。—以賽亞書四十章三十一節',
    paragraphs: Array.from({ length: 48 }, (_, index) =>
      `第${index + 1}段：當環境沒有立刻改變，我們很容易把安靜誤認為停滯，把等待誤認為被遺忘。然而信心所學習的，是在答案仍未出現時繼續忠於今天，在每一個細小選擇中保守誠實、溫柔與盼望。這份操練不喧鬧，卻使內在生命逐漸穩固，也讓我們有餘裕看見身旁真正需要被關心的人。`
    )
  }
];

function extractFunction(source, name) {
  const startMatch = new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(startMatch, `Cannot find renderer function ${name}`);
  const start = startMatch.index;
  const openingBrace = source.indexOf('{', startMatch.index + startMatch[0].length);
  assert.notEqual(openingBrace, -1, `Cannot find opening brace for ${name}`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openingBrace; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index++;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index++;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Cannot find closing brace for ${name}`);
}

function extractConst(source, name) {
  const match = new RegExp(`^const\\s+${name}\\s*=.*;$`, 'm').exec(source);
  assert.ok(match, `Cannot find renderer constant ${name}`);
  return match[0];
}

function rendererHarnessSource() {
  const functionNames = [
    'systemDateChinese',
    'nextPaint',
    'textPage',
    'createScripturePageElement',
    'createUtmostPage',
    'createUtmostPageElement',
    'renderFlowPageContent',
    'flowContentOverflows',
    'fitCurrentFlowPageToScreen',
    'hideUtmostFooterImmediately',
    'revealUtmostFooter',
    'scheduleUtmostFooterHide',
    'setupUtmostFooterReveal'
  ];
  const implementations = functionNames.map((name) => extractFunction(rendererSource, name)).join('\n\n');
  return `(() => {
    const $ = (id) => document.getElementById(id);
    ${extractConst(rendererSource, 'UTMOST_MIN_REGULAR_SCALE')}
    let flowPages = [];
    let flowPageScales = [];
    let flowPageIndex = 0;
    let flowNavigationToken = 0;
    let flowPageRenderToken = 0;
    let flowStep = 'cover';
    let utmostFooterHideTimer = null;
    ${implementations}

    const prepare = (step) => {
      hideUtmostFooterImmediately();
      flowStep = step;
      document.body.className = ${JSON.stringify(process.platform === 'darwin' ? 'plat-mac' : 'plat-win')};
      const screen = $('flowScreen');
      screen.classList.remove('hidden');
      screen.dataset.step = step;
      screen.style.setProperty('--flow-font-scale', '1');
      $('flowEyebrow').textContent = '';
      $('flowTitle').textContent = step === 'scripture' ? '提摩太前書 5:1–6:2' : '';
      $('flowMeta').textContent = '';
      $('flowContent').replaceChildren();
    };

    setupUtmostFooterReveal();

    window.__readingLayoutHarness = {
      async renderScripture(page) {
        prepare('scripture');
        flowPages = [page];
        flowPageScales = [1];
        flowPageIndex = 0;
        flowNavigationToken++;
        flowPageRenderToken++;
        renderFlowPageContent(page);
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await nextPaint();
        await nextPaint();
        return { overflow: flowContentOverflows() };
      },
      async renderUtmost(data) {
        prepare('utmost');
        const page = createUtmostPage(data);
        flowPages = [page];
        flowPageScales = [1];
        flowPageIndex = 0;
        const navigationToken = ++flowNavigationToken;
        const pageRenderToken = ++flowPageRenderToken;
        renderFlowPageContent(page);
        const fitOk = await fitCurrentFlowPageToScreen(
          UTMOST_MIN_REGULAR_SCALE,
          navigationToken,
          pageRenderToken
        );
        return {
          fitOk,
          overflow: flowContentOverflows(),
          regularScale: page.regularScale,
          transformScale: page.extremeScale,
          extreme: page.extremeScale < 1
        };
      },
      async exerciseUtmostFooterAutoHide() {
        prepare('utmost');
        const screen = $('flowScreen');
        const hotzone = $('flowFooterHotzone');
        if (!hotzone) throw new Error('Missing #flowFooterHotzone');

        hideUtmostFooterImmediately();
        const hiddenInitially = !screen.classList.contains('footer-visible');
        hotzone.dispatchEvent(new MouseEvent('mouseenter'));
        const setupRevealWorked = screen.classList.contains('footer-visible');

        hideUtmostFooterImmediately();
        revealUtmostFooter();
        const directRevealWorked = screen.classList.contains('footer-visible');
        const startedAt = performance.now();
        scheduleUtmostFooterHide();
        while (screen.classList.contains('footer-visible') && performance.now() - startedAt < 1800) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const hideElapsed = performance.now() - startedAt;
        const hiddenAfterSchedule = !screen.classList.contains('footer-visible');
        hideUtmostFooterImmediately();
        return {
          hiddenInitially,
          setupRevealWorked,
          directRevealWorked,
          hiddenAfterSchedule,
          hideElapsed
        };
      }
    };
  })()`;
}

function measurementScript(fixture) {
  return `(() => {
    const fixture = ${JSON.stringify(fixture)};
    const rectData = (element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
    };
    return (async () => {
      const harness = window.__readingLayoutHarness;
      if (!harness) throw new Error('Reading layout harness was not installed');
      const fit = fixture.kind === 'scripture'
        ? await harness.renderScripture(fixture.page)
        : await harness.renderUtmost({
            date: fixture.data.date,
            title: fixture.data.title,
            verse: fixture.data.verse,
            body: fixture.data.paragraphs.join('\\n\\n')
          });

      const content = document.getElementById('flowContent');
      const sheet = content.querySelector('.utmost-sheet');
      const scripture = content.querySelector('.scripture-page');
      const contentStyle = getComputedStyle(content);
      const contentRect = content.getBoundingClientRect();
      const screen = document.getElementById('flowScreen');
      const footer = document.querySelector('.flow-footer');
      const footerHotzone = document.getElementById('flowFooterHotzone');
      let footerMetrics = null;
      if (sheet && footer) {
        const finishFooterAnimations = () => {
          footer.getAnimations().forEach((animation) => {
            try { animation.finish(); } catch {}
          });
        };
        screen.classList.remove('footer-visible');
        footer.classList.remove('footer-visible');
        finishFooterAnimations();
        const hiddenStyle = getComputedStyle(footer);
        const defaultOpacity = Number.parseFloat(hiddenStyle.opacity);
        const defaultPointerEvents = hiddenStyle.pointerEvents;
        const defaultState = {
          footerFocusWithin: footer.matches(':focus-within'),
          footerHovered: footer.matches(':hover'),
          hotzoneHovered: footerHotzone ? footerHotzone.matches(':hover') : false,
          hoverNone: matchMedia('(hover: none)').matches,
          activeElement: document.activeElement ? document.activeElement.id || document.activeElement.tagName : ''
        };
        const contentHeightHidden = content.clientHeight;
        const contentRectHeightHidden = content.getBoundingClientRect().height;

        screen.classList.add('footer-visible');
        await new Promise((resolve) => requestAnimationFrame(resolve));
        finishFooterAnimations();
        const visibleStyle = getComputedStyle(footer);
        const visibleOpacity = Number.parseFloat(visibleStyle.opacity);
        const visiblePointerEvents = visibleStyle.pointerEvents;
        const contentHeightVisible = content.clientHeight;
        const contentRectHeightVisible = content.getBoundingClientRect().height;
        footerMetrics = {
          defaultOpacity,
          defaultPointerEvents,
          ...defaultState,
          visibleOpacity,
          visiblePointerEvents,
          contentHeightHidden,
          contentHeightVisible,
          contentRectHeightHidden,
          contentRectHeightVisible
        };
        screen.classList.remove('footer-visible');
        finishFooterAnimations();
      }
      const visibleBounds = {
        top: contentRect.top + (Number.parseFloat(contentStyle.paddingTop) || 0),
        right: contentRect.right - (Number.parseFloat(contentStyle.paddingRight) || 0),
        bottom: contentRect.bottom - (Number.parseFloat(contentStyle.paddingBottom) || 0),
        left: contentRect.left + (Number.parseFloat(contentStyle.paddingLeft) || 0)
      };
      const lastParagraph = content.querySelector('.utmost-paragraph:last-child');
      const continuation = content.querySelector('.scripture-continuation');
      const visualRoot = sheet || scripture;
      const checkedElements = Array.from(content.querySelectorAll(
        '.scripture-page, .scripture-chapter, .scripture-verse, .scripture-verse-number, .scripture-verse-text, .scripture-continuation, .utmost-sheet, .utmost-heading, .utmost-verse-card, .utmost-body, .utmost-paragraph'
      ));
      const horizontalViolations = checkedElements
        .map((element) => ({ className: element.className, rect: rectData(element) }))
        .filter(({ rect }) => rect.left < visibleBounds.left - 1.5 || rect.right > visibleBounds.right + 1.5);
      const verseLabel = content.querySelector('.utmost-verse-card .utmost-section-label');
      const bodyLabel = content.querySelector('.utmost-body > .utmost-section-label');
      const verseTextElement = content.querySelector('.utmost-verse-text');
      const bodyElement = content.querySelector('.utmost-body');
      const paragraphs = Array.from(content.querySelectorAll('.utmost-paragraph'));
      const firstParagraphStyle = paragraphs[0] ? getComputedStyle(paragraphs[0]) : null;
      const secondParagraphStyle = paragraphs[1] ? getComputedStyle(paragraphs[1]) : null;

      return {
        kind: fixture.kind,
        viewport: { width: innerWidth, height: innerHeight },
        content: {
          clientWidth: content.clientWidth,
          clientHeight: content.clientHeight,
          scrollWidth: content.scrollWidth,
          scrollHeight: content.scrollHeight
        },
        visibleBounds,
        visualRoot: rectData(visualRoot),
        lastParagraph: lastParagraph ? rectData(lastParagraph) : null,
        lastParagraphText: lastParagraph ? lastParagraph.textContent : '',
        sheetCount: content.querySelectorAll('.utmost-sheet').length,
        scripturePageCount: content.querySelectorAll('.scripture-page').length,
        continuationCount: content.querySelectorAll('.scripture-continuation').length,
        continuationText: continuation ? continuation.textContent : '',
        chapterLabels: Array.from(content.querySelectorAll('.scripture-chapter'), (element) => element.textContent),
        headingText: content.querySelector('.utmost-heading')?.textContent || '',
        verseLabelText: verseLabel?.textContent || '',
        verseText: content.querySelector('.utmost-verse-text')?.textContent || '',
        bodyLabelText: bodyLabel?.textContent || '',
        paragraphCount: content.querySelectorAll('.utmost-paragraph').length,
        footerHotzoneExists: !!footerHotzone,
        footerMetrics,
        verseFontSize: verseTextElement ? Number.parseFloat(getComputedStyle(verseTextElement).fontSize) : 0,
        bodyFontSize: bodyElement ? Number.parseFloat(getComputedStyle(bodyElement).fontSize) : 0,
        paragraphTextIndent: firstParagraphStyle ? Number.parseFloat(firstParagraphStyle.textIndent) : 0,
        paragraphMarginTop: secondParagraphStyle ? Number.parseFloat(secondParagraphStyle.marginTop) : 0,
        paragraphPaddingTop: secondParagraphStyle ? Number.parseFloat(secondParagraphStyle.paddingTop) : 0,
        horizontalViolations,
        documentScrollWidth: document.documentElement.scrollWidth,
        fontStatus: document.fonts ? document.fonts.status : 'unsupported',
        fontLoaded: document.fonts ? document.fonts.check('16px "SHSans-Bold"') : true,
        ...fit
      };
    })();
  })()`;
}

function coverMeasurementScript() {
  return `(() => (async () => {
    document.body.className = ${JSON.stringify(process.platform === 'darwin' ? 'plat-mac' : 'plat-win')};
    const canvas = document.getElementById('canvas');
    canvas.classList.remove('no-background');
    document.getElementById('flowScreen').classList.add('hidden');
    document.querySelector('.overlay-top').classList.remove('hidden');
    document.querySelector('.overlay-bottom').classList.remove('hidden');
    const reading = document.getElementById('readingLines');
    reading.replaceChildren();
    for (const text of ['提摩太後書三：1-17', '竭誠獻上']) {
      const row = document.createElement('div');
      row.textContent = text;
      reading.appendChild(row);
    }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const top = document.querySelector('.overlay-top').getBoundingClientRect();
    const bottom = document.querySelector('.overlay-bottom').getBoundingClientRect();
    const title = getComputedStyle(document.getElementById('title1'));
    const date = getComputedStyle(document.getElementById('dateText'));
    const card = getComputedStyle(document.querySelector('.overlay-bottom'));
    const withBackground = {
      gap: bottom.top - top.bottom,
      topBottom: top.bottom,
      cardTop: bottom.top,
      cardBottom: bottom.bottom,
      titleStrokeWidth: Number.parseFloat(title.webkitTextStrokeWidth) || 0,
      dateStrokeWidth: Number.parseFloat(date.webkitTextStrokeWidth) || 0,
      titleTextShadow: title.textShadow,
      cardTextShadow: card.textShadow,
      cardBoxShadow: card.boxShadow
    };
    canvas.classList.add('no-background');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const withoutBackgroundStroke = Number.parseFloat(
      getComputedStyle(document.getElementById('title1')).webkitTextStrokeWidth
    ) || 0;
    canvas.classList.remove('no-background');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      withBackground,
      withoutBackgroundStroke
    };
  })())()`;
}

function verifyCoverMetrics(metrics, expectedViewport) {
  const label = `cover at ${expectedViewport.width}x${expectedViewport.height}`;
  assert.deepEqual(metrics.viewport, expectedViewport, `${label}: unexpected viewport`);
  const visual = metrics.withBackground;
  assert.ok(visual.titleStrokeWidth >= 0.5 && visual.titleStrokeWidth <= 1.1, `${label}: title outline is not thin`);
  assert.equal(visual.dateStrokeWidth, 0, `${label}: orange date badge must stay unoutlined`);
  assert.equal(metrics.withoutBackgroundStroke, 0, `${label}: plain-paper cover must not retain an outline`);
  assert.notEqual(visual.titleTextShadow, 'none', `${label}: complex-background title has no compact shadow fallback`);
  assert.equal(visual.cardTextShadow, 'none', `${label}: white scripture card has a dirty text shadow`);
  assert.doesNotMatch(visual.cardBoxShadow, /50px/, `${label}: scripture card still uses the old broad shadow`);
  assert.ok(visual.gap > expectedViewport.height * 0.1, `${label}: title and scripture card are cramped`);
  assert.ok(visual.gap < expectedViewport.height * 0.2, `${label}: title and scripture card remain too far apart`);
  assert.ok(visual.cardBottom < expectedViewport.height * 0.86, `${label}: scripture card was not moved upward`);
}

function verifyMetrics(metrics, fixture, expectedViewport) {
  const label = `${metrics.kind} at ${expectedViewport.width}x${expectedViewport.height}`;
  assert.equal(metrics.viewport.width, expectedViewport.width, `${label}: unexpected CSS viewport width`);
  assert.equal(metrics.viewport.height, expectedViewport.height, `${label}: unexpected CSS viewport height`);
  assert.equal(metrics.fontStatus, 'loaded', `${label}: fonts did not finish loading`);
  assert.equal(metrics.fontLoaded, true, `${label}: bundled SHSans-Bold was not loaded`);
  assert.ok(metrics.documentScrollWidth <= metrics.viewport.width + 1, `${label}: document overflows horizontally`);
  assert.equal(metrics.horizontalViolations.length, 0, `${label}: elements exceed flow content horizontally: ${JSON.stringify(metrics.horizontalViolations)}`);
  assert.ok(metrics.visualRoot.left >= metrics.visibleBounds.left - 1.5, `${label}: content crosses the left bound`);
  assert.ok(metrics.visualRoot.right <= metrics.visibleBounds.right + 1.5, `${label}: content crosses the right bound`);
  assert.ok(
    metrics.visualRoot.bottom <= metrics.visibleBounds.bottom + 1.5,
    `${label}: content bottom ${metrics.visualRoot.bottom.toFixed(1)} exceeds visible bottom ${metrics.visibleBounds.bottom.toFixed(1)}`
  );

  if (metrics.kind === 'scripture') {
    assert.equal(metrics.scripturePageCount, 1, `${label}: expected one rendered scripture page`);
    assert.equal(metrics.continuationCount, 1, `${label}: expected one continuation label`);
    assert.equal(metrics.continuationText, '續', `${label}: incorrect continuation label`);
    assert.deepEqual(metrics.chapterLabels, ['第 6 章'], `${label}: cross-chapter divider is incorrect`);
    assert.ok(metrics.content.scrollHeight <= metrics.content.clientHeight + 2, `${label}: scripture fixture overflows vertically`);
    return;
  }

  assert.equal(metrics.fitOk, true, `${label}: real renderer fit function was cancelled`);
  assert.equal(metrics.sheetCount, 1, `${label}: Utmost must render as exactly one sheet`);
  assert.match(metrics.headingText, new RegExp(fixture.data.date), `${label}: heading is missing the date`);
  assert.match(metrics.headingText, new RegExp(fixture.data.title), `${label}: heading is missing the title`);
  assert.equal(metrics.verseLabelText, '今日經文', `${label}: verse section label is incorrect`);
  assert.equal(metrics.verseText, fixture.data.verse, `${label}: verse text changed during rendering`);
  assert.equal(metrics.bodyLabelText, '正文', `${label}: body section label is incorrect`);
  assert.equal(metrics.paragraphCount, fixture.data.paragraphs.length, `${label}: body paragraphs were merged or lost`);
  assert.equal(metrics.footerHotzoneExists, true, `${label}: missing #flowFooterHotzone`);
  assert.ok(metrics.footerMetrics, `${label}: missing footer style measurements`);
  assert.equal(
    metrics.footerMetrics.defaultOpacity,
    0,
    `${label}: footer is not hidden by default: ${JSON.stringify(metrics.footerMetrics)}`
  );
  assert.equal(metrics.footerMetrics.defaultPointerEvents, 'none', `${label}: hidden footer still receives pointer events`);
  assert.ok(metrics.footerMetrics.visibleOpacity >= 0.99, `${label}: footer-visible does not reveal the footer`);
  assert.notEqual(metrics.footerMetrics.visiblePointerEvents, 'none', `${label}: revealed footer cannot receive pointer events`);
  assert.ok(
    Math.abs(metrics.footerMetrics.contentHeightHidden - metrics.footerMetrics.contentHeightVisible) <= 0.5,
    `${label}: footer visibility changes the content client height`
  );
  assert.ok(
    Math.abs(metrics.footerMetrics.contentRectHeightHidden - metrics.footerMetrics.contentRectHeightVisible) <= 0.5,
    `${label}: footer visibility changes the content usable height`
  );
  assert.ok(metrics.verseFontSize < metrics.bodyFontSize, `${label}: today's verse is not smaller than the body copy`);
  assert.ok(
    metrics.paragraphTextIndent >= metrics.bodyFontSize * 1.5,
    `${label}: body paragraph first-line indent is not visually clear`
  );
  assert.ok(metrics.paragraphMarginTop > 0, `${label}: body paragraphs have no vertical margin`);
  assert.ok(metrics.paragraphPaddingTop > 0, `${label}: body paragraph separator has no breathing room`);
  assert.equal(metrics.lastParagraphText, fixture.data.paragraphs.at(-1), `${label}: final paragraph text changed`);
  assert.ok(metrics.lastParagraph, `${label}: missing final Utmost paragraph`);
  assert.ok(metrics.lastParagraph.height > 0, `${label}: final Utmost paragraph has no rendered height`);
  assert.ok(metrics.lastParagraph.bottom <= metrics.visibleBounds.bottom + 1.5, `${label}: final Utmost paragraph is clipped`);
  assert.ok(metrics.regularScale >= 0.48 - Number.EPSILON, `${label}: regular scale dropped below 48%`);
  if (metrics.kind === 'utmost-long') {
    assert.ok(metrics.regularScale < 1, `${label}: long fixture did not exercise regular fitting`);
    assert.equal(metrics.extreme, false, `${label}: long fixture should fit before emergency transform`);
  }
  if (metrics.kind === 'utmost-extreme') {
    assert.ok(metrics.regularScale <= 0.48 + Number.EPSILON, `${label}: extreme fitting started above the 48% floor`);
    assert.equal(metrics.extreme, true, `${label}: extreme fixture did not exercise transform fitting`);
    assert.ok(metrics.transformScale < 1, `${label}: extreme fixture was not transform-scaled`);
  }
}

function withTimeout(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}

async function run() {
  const isolatedSession = session.fromPartition(`reading-layout-${process.pid}`);
  let blockedAppScript = false;
  isolatedSession.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (details, callback) => {
    const isAppScript = details.resourceType === 'script' && /\/app\.js(?:[?#]|$)/i.test(details.url);
    if (isAppScript) blockedAppScript = true;
    callback({ cancel: isAppScript });
  });

  const window = new BrowserWindow({
    width: viewports[0].width,
    height: viewports[0].height,
    show: false,
    frame: false,
    useContentSize: true,
    resizable: true,
    webPreferences: {
      session: isolatedSession,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  try {
    await withTimeout(window.loadFile(rendererEntry), 15000, 'Renderer fixture load');
    assert.equal(blockedAppScript, true, 'The production app.js initializer was not blocked');
    window.webContents.setZoomFactor(1);
    await window.webContents.executeJavaScript(rendererHarnessSource(), true);
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [
        { name: 'hover', value: 'hover' },
        { name: 'any-hover', value: 'hover' },
        { name: 'pointer', value: 'fine' },
        { name: 'any-pointer', value: 'fine' }
      ]
    });

    let passed = 0;
    for (const viewport of coverViewports) {
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: viewport.width,
        screenHeight: viewport.height
      });
      const metrics = await withTimeout(
        window.webContents.executeJavaScript(coverMeasurementScript(), true),
        15000,
        `cover ${viewport.width}x${viewport.height}`
      );
      verifyCoverMetrics(metrics, viewport);
      passed++;
      console.log(`PASS ${'cover'.padEnd(15)} ${viewport.width}x${viewport.height} (clean card + thin outline)`);
    }
    for (const viewport of viewports) {
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: viewport.width,
        screenHeight: viewport.height
      });
      const fixtures = [
        { kind: 'scripture', page: scripturePage },
        ...utmostCases.map((data) => ({ kind: data.name, data }))
      ];

      for (const fixture of fixtures) {
        const metrics = await withTimeout(
          window.webContents.executeJavaScript(measurementScript(fixture), true),
          15000,
          `${fixture.kind} ${viewport.width}x${viewport.height}`
        );
        verifyMetrics(metrics, fixture, viewport);
        passed++;
        const fitting = fixture.kind === 'scripture'
          ? 'native + continuation'
          : (metrics.extreme ? `extreme ${metrics.transformScale.toFixed(3)}` : `scale ${metrics.regularScale.toFixed(2)}`);
        console.log(`PASS ${fixture.kind.padEnd(15)} ${viewport.width}x${viewport.height} (${fitting})`);
      }
    }

    window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    const footerLifecycle = await withTimeout(
      window.webContents.executeJavaScript('window.__readingLayoutHarness.exerciseUtmostFooterAutoHide()', true),
      4000,
      'Utmost footer auto-hide'
    );
    assert.equal(footerLifecycle.hiddenInitially, true, 'Utmost footer lifecycle: footer did not start hidden');
    assert.equal(footerLifecycle.setupRevealWorked, true, 'Utmost footer lifecycle: hotzone setup did not reveal the footer');
    assert.equal(footerLifecycle.directRevealWorked, true, 'Utmost footer lifecycle: revealUtmostFooter did not reveal the footer');
    assert.equal(footerLifecycle.hiddenAfterSchedule, true, 'Utmost footer lifecycle: scheduled hide did not hide the footer');
    assert.ok(
      footerLifecycle.hideElapsed >= 850 && footerLifecycle.hideElapsed <= 1750,
      `Utmost footer lifecycle: expected about 1000ms, observed ${footerLifecycle.hideElapsed.toFixed(1)}ms`
    );
    passed++;
    console.log(`PASS ${'utmost-footer'.padEnd(15)} auto-hide ${footerLifecycle.hideElapsed.toFixed(0)}ms`);
    console.log(`Reading layout smoke passed: ${passed} cases using renderer app.js functions`);
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    window.destroy();
  }
}

app.disableHardwareAcceleration();
app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  });
