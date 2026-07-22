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
  { width: 405, height: 720, deviceScaleFactor: 1 },
  { width: 608, height: 1080, deviceScaleFactor: 1 },
  { width: 608, height: 1080, deviceScaleFactor: 2 },
  { width: 320, height: 560, deviceScaleFactor: 1 }
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
scripturePage.verses.forEach((verse, index) => {
  const readerIndex = index < 2 ? 3 : 4;
  verse.readerIndex = readerIndex;
  verse.readerCount = 4;
  verse.segmentLabel = readerIndex === 3 ? '11–16 節' : '17–22 節';
  verse.readerLabel = `第 ${readerIndex} 位・${verse.segmentLabel}`;
  verse.startsReaderSegment = index === 2;
});

const scripturePackingVerses = Array.from({ length: 7 }, (_, index) => ({
  key: `5:${index + 1}:${index}`,
  chapter: 5,
  number: index + 1,
  startsChapter: false,
  continuation: false,
  text: `第 ${index + 1} 節短經文。`
}));

const scriptureMixedVerses = Array.from({ length: 18 }, (_, index) => {
  const inSecondChapter = index >= 9;
  const number = inSecondChapter ? index - 8 : index + 1;
  return {
    key: `${inSecondChapter ? 6 : 5}:${number}:${index}`,
    chapter: inSecondChapter ? 6 : 5,
    number,
    startsChapter: index === 9,
    continuation: false,
    text: index % 3 === 0
      ? `第 ${number} 節稍長經文，混合長度測試不可丟失順序或超出畫面。`
      : `第 ${number} 節經文。`
  };
});

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
    name: 'utmost-long-verse',
    date: '七月十九日',
    title: '平安在主裡',
    verse: Array.from({ length: 32 }, () =>
      '你們心裡不要憂愁，也不要膽怯；我所賜的平安不像世人所賜的。'
    ).join('') + '—約翰福音十四章二十七節',
    paragraphs: [
      '今天只需安靜地回應眼前的託付，並把無法掌握的部分交在神手中。',
      '當心回到同在裡，平安就不再取決於環境是否立刻改變。'
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
    'updateFlowDisplayScale',
    'nextPaint',
    'textPage',
    'createScripturePageElement',
    'splitUtmostVerseCitation',
    'createUtmostPage',
    'createUtmostPageElement',
    'renderFlowPageContent',
    'flowContentOverflows',
    'scripturePageFits',
    'scriptureSentenceTokens',
    'largestFittingVersePrefix',
    'splitOversizedScriptureVerse',
    'logicalVerseCount',
    'buildScripturePagesByFit',
    'fitCurrentFlowPageToScreen',
    'isReadingFlowStep',
    'hideFlowFooterImmediately',
    'revealFlowFooter',
    'scheduleFlowFooterHide',
    'setupFlowFooterReveal',
    'updateFlowPageProgress'
  ];
  const implementations = functionNames.map((name) => extractFunction(rendererSource, name)).join('\n\n');
  return `(() => {
    const $ = (id) => document.getElementById(id);
    ${extractConst(rendererSource, 'FLOW_LAYOUT_WIDTH')}
    ${extractConst(rendererSource, 'FLOW_LAYOUT_HEIGHT')}
    ${extractConst(rendererSource, 'FLOW_MIN_CONTROL_SIZE')}
    ${extractConst(rendererSource, 'FLOW_MIN_ICON_SIZE')}
    ${extractConst(rendererSource, 'UTMOST_MIN_REGULAR_SCALE')}
    let flowPages = [];
    let flowPageScales = [];
    let flowPageIndex = 0;
    let flowNavigationToken = 0;
    let flowPageRenderToken = 0;
    let flowStep = 'cover';
    let flowFooterHideTimer = null;
    let flowFooterHovered = false;
    ${implementations}

    const prepare = (step) => {
      hideFlowFooterImmediately();
      flowStep = step;
      document.body.className = ${JSON.stringify(process.platform === 'darwin' ? 'plat-mac' : 'plat-win')};
      const screen = $('flowScreen');
      screen.classList.remove('hidden');
      screen.dataset.step = step;
      updateFlowDisplayScale();
      screen.style.setProperty('--flow-font-scale', '1');
      $('flowEyebrow').textContent = '';
      $('flowTitle').textContent = step === 'scripture' ? '提摩太前書 5:1–6:2' : '';
      $('flowMeta').textContent = '';
      $('flowContent').replaceChildren();
    };

    setupFlowFooterReveal();

    window.__readingLayoutHarness = {
      async paginateScripture(verses) {
        prepare('scripture');
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await nextPaint();
        await nextPaint();
        const pages = buildScripturePagesByFit(verses);
        const chapterLabels = [];
        const pageOverflows = pages.map((page) => {
          renderFlowPageContent(page);
          chapterLabels.push(...Array.from(document.querySelectorAll('.scripture-chapter'), (element) => element.textContent));
          return flowContentOverflows();
        });
        const logicalKeys = [];
        for (const page of pages) {
          for (const verse of page.verses) {
            if (logicalKeys[logicalKeys.length - 1] !== verse.key) logicalKeys.push(verse.key);
          }
        }
        const fillableBoundaries = pages.slice(0, -1).map((page, index) =>
          scripturePageFits([...page.verses, pages[index + 1].verses[0]])
        );
        return {
          pageCount: pages.length,
          distribution: pages.map((page) => logicalVerseCount(page.verses)),
          pageOverflows,
          logicalKeys,
          chapterLabels,
          fillableBoundaries
        };
      },
      async renderScripture(page) {
        prepare('scripture');
        flowPages = [page];
        flowPageScales = [1];
        flowPageIndex = 0;
        flowNavigationToken++;
        flowPageRenderToken++;
        renderFlowPageContent(page);
        updateFlowPageProgress();
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
        updateFlowPageProgress();
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
      async exerciseFlowFooterAutoHide(step) {
        prepare(step);
        const screen = $('flowScreen');
        const footer = document.querySelector('.flow-footer');

        hideFlowFooterImmediately();
        const hiddenInitially = !screen.classList.contains('footer-visible');
        screen.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse' }));
        const setupRevealWorked = screen.classList.contains('footer-visible');

        hideFlowFooterImmediately();
        revealFlowFooter();
        const directRevealWorked = screen.classList.contains('footer-visible');

        footer.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
        scheduleFlowFooterHide();
        await new Promise((resolve) => setTimeout(resolve, 1150));
        const stayedVisibleWhileHovered = screen.classList.contains('footer-visible');

        footer.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
        const startedAt = performance.now();
        while (screen.classList.contains('footer-visible') && performance.now() - startedAt < 1800) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const hideElapsed = performance.now() - startedAt;
        const hiddenAfterSchedule = !screen.classList.contains('footer-visible');
        hideFlowFooterImmediately();
        return {
          hiddenInitially,
          setupRevealWorked,
          directRevealWorked,
          stayedVisibleWhileHovered,
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
    const textWrapSignature = (element) => {
      const lineStarts = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let textOffset = 0;
      let previousTop = null;
      let node;
      while ((node = walker.nextNode())) {
        for (let index = 0; index < node.data.length; index++) {
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 || rect.height > 0) {
            if (previousTop === null || Math.abs(rect.top - previousTop) > 0.75) {
              lineStarts.push(textOffset + index);
              previousTop = rect.top;
            }
          }
        }
        textOffset += node.data.length;
      }
      range.detach();
      return { length: textOffset, lineStarts };
    };
    return (async () => {
      const harness = window.__readingLayoutHarness;
      if (!harness) throw new Error('Reading layout harness was not installed');
      const scripturePagination = fixture.kind === 'scripture'
        ? {
            short: await harness.paginateScripture(fixture.packingVerses),
            mixed: await harness.paginateScripture(fixture.mixedVerses)
          }
        : null;
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
      const screenRect = screen.getBoundingClientRect();
      const displayScale = screen.clientWidth ? screenRect.width / screen.clientWidth : 1;
      const topbar = document.querySelector('.flow-topbar');
      const heading = document.querySelector('.flow-heading');
      const footer = document.querySelector('.flow-footer');
      const pageInfo = document.getElementById('flowPageInfo');
      const previousButton = document.getElementById('flowPrevPage');
      const nextButton = document.getElementById('flowNextPage');
      let footerMetrics = null;
      if ((sheet || scripture) && footer) {
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
          contentRectHeightVisible,
          footerRect: rectData(footer),
          previousButtonRect: previousButton ? rectData(previousButton) : null,
          nextButtonRect: nextButton ? rectData(nextButton) : null,
        };
        screen.classList.remove('footer-visible');
        finishFooterAnimations();
      }
      const visibleBounds = {
        top: contentRect.top + (Number.parseFloat(contentStyle.paddingTop) || 0) * displayScale,
        right: contentRect.right - (Number.parseFloat(contentStyle.paddingRight) || 0) * displayScale,
        bottom: contentRect.bottom - (Number.parseFloat(contentStyle.paddingBottom) || 0) * displayScale,
        left: contentRect.left + (Number.parseFloat(contentStyle.paddingLeft) || 0) * displayScale
      };
      const lastParagraph = content.querySelector('.utmost-paragraph:last-child');
      const continuation = content.querySelector('.scripture-continuation');
      const scriptureReaders = Array.from(content.querySelectorAll('.scripture-reader'));
      const visualRoot = sheet || scripture;
      const checkedElements = Array.from(content.querySelectorAll(
        '.scripture-page, .scripture-reader, .scripture-chapter, .scripture-verse, .scripture-verse-number, .scripture-verse-text, .scripture-continuation, .utmost-sheet, .utmost-heading, .utmost-verse-card, .utmost-body, .utmost-paragraph'
      ));
      const horizontalViolations = checkedElements
        .map((element) => ({ className: element.className, rect: rectData(element) }))
        .filter(({ rect }) => rect.left < visibleBounds.left - 1.5 || rect.right > visibleBounds.right + 1.5);
      const verseLabel = content.querySelector('.utmost-verse-card .utmost-section-label');
      const utmostKicker = content.querySelector('.utmost-kicker');
      const verseCitation = content.querySelector('.utmost-verse-citation');
      const verseQuote = content.querySelector('.utmost-verse-quote');
      const utmostTitle = content.querySelector('.utmost-title');
      const bodyElement = content.querySelector('.utmost-body');
      const paragraphs = Array.from(content.querySelectorAll('.utmost-paragraph'));
      const firstParagraphStyle = paragraphs[0] ? getComputedStyle(paragraphs[0]) : null;
      const secondParagraphStyle = paragraphs[1] ? getComputedStyle(paragraphs[1]) : null;
      const sheetTransformValue = sheet ? getComputedStyle(sheet).transform : 'none';
      const sheetTransform = !sheet || sheetTransformValue === 'none'
        ? { a: 1, b: 0, c: 0, d: 1 }
        : (() => {
            const matrix = new DOMMatrixReadOnly(sheetTransformValue);
            return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d };
          })();

      const appRegion = (element) => element
        ? getComputedStyle(element).getPropertyValue('-webkit-app-region').trim()
        : '';
      const wrapTargets = fixture.kind === 'scripture'
        ? Array.from(content.querySelectorAll('.scripture-verse-text'))
        : (fixture.kind === 'utmost-normal'
            ? Array.from(content.querySelectorAll('.utmost-title, .utmost-verse-quote, .utmost-paragraph'))
            : []);

      return {
        kind: fixture.kind,
        viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio },
        content: {
          clientWidth: content.clientWidth,
          clientHeight: content.clientHeight,
          scrollWidth: content.scrollWidth,
          scrollHeight: content.scrollHeight
        },
        flowCanvas: {
          clientWidth: screen.clientWidth,
          clientHeight: screen.clientHeight,
          rect: rectData(screen),
          displayScale
        },
        wrapSignature: wrapTargets.map(textWrapSignature),
        visibleBounds,
        visualRoot: rectData(visualRoot),
        lastParagraph: lastParagraph ? rectData(lastParagraph) : null,
        lastParagraphText: lastParagraph ? lastParagraph.textContent : '',
        sheetCount: content.querySelectorAll('.utmost-sheet').length,
        scripturePageCount: content.querySelectorAll('.scripture-page').length,
        continuationCount: content.querySelectorAll('.scripture-continuation').length,
        continuationText: continuation ? continuation.textContent : '',
        scriptureReaderTexts: scriptureReaders.map((element) => element.textContent),
        chapterLabels: Array.from(content.querySelectorAll('.scripture-chapter'), (element) => element.textContent),
        headingText: content.querySelector('.utmost-heading')?.textContent || '',
        kickerText: utmostKicker?.textContent || '',
        verseLabelText: verseLabel?.textContent || '',
        verseText: content.querySelector('.utmost-verse-text')?.textContent || '',
        verseCitationText: verseCitation?.textContent || '',
        verseCitationWhiteSpace: verseCitation ? getComputedStyle(verseCitation).whiteSpace : '',
        verseCitationScrollWidth: verseCitation ? verseCitation.scrollWidth : 0,
        verseCitationClientWidth: verseCitation ? verseCitation.clientWidth : 0,
        verseCitationRect: verseCitation ? rectData(verseCitation) : null,
        verseQuoteRect: verseQuote ? rectData(verseQuote) : null,
        bodyLabelCount: content.querySelectorAll('.utmost-body > .utmost-section-label').length,
        paragraphCount: content.querySelectorAll('.utmost-paragraph').length,
        footerMetrics,
        pageInfoMetrics: pageInfo ? {
          display: getComputedStyle(pageInfo).display,
          opacity: Number.parseFloat(getComputedStyle(pageInfo).opacity),
          text: pageInfo.textContent,
          progress: pageInfo.style.getPropertyValue('--flow-page-progress'),
          rect: rectData(pageInfo),
          topbarRect: topbar ? rectData(topbar) : null,
          headingRect: heading ? rectData(heading) : null
        } : null,
        appRegions: {
          screen: appRegion(screen),
          content: appRegion(content),
          previousButton: appRegion(previousButton),
          nextButton: appRegion(nextButton)
        },
        kickerFontSize: utmostKicker ? Number.parseFloat(getComputedStyle(utmostKicker).fontSize) : 0,
        verseQuoteFontSize: verseQuote ? Number.parseFloat(getComputedStyle(verseQuote).fontSize) : 0,
        citationFontSize: verseCitation ? Number.parseFloat(getComputedStyle(verseCitation).fontSize) : 0,
        titleFontSize: utmostTitle ? Number.parseFloat(getComputedStyle(utmostTitle).fontSize) : 0,
        bodyFontSize: bodyElement ? Number.parseFloat(getComputedStyle(bodyElement).fontSize) : 0,
        sheetTransform,
        paragraphTextIndent: firstParagraphStyle ? Number.parseFloat(firstParagraphStyle.textIndent) : 0,
        paragraphMarginTop: secondParagraphStyle ? Number.parseFloat(secondParagraphStyle.marginTop) : 0,
        paragraphPaddingTop: secondParagraphStyle ? Number.parseFloat(secondParagraphStyle.paddingTop) : 0,
        horizontalViolations,
        documentScrollWidth: document.documentElement.scrollWidth,
        fontStatus: document.fonts ? document.fonts.status : 'unsupported',
        fontLoaded: document.fonts ? document.fonts.check('16px "SHSans-Bold"') : true,
        scripturePagination,
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
    const scriptureLabel = document.getElementById('scriptureLabel');
    scriptureLabel.textContent = '本日經文：';
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
    const readingBox = reading.getBoundingClientRect();
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
      cardBoxShadow: card.boxShadow,
      cardBackgroundImage: card.backgroundImage,
      cardBorderLeftWidth: Number.parseFloat(card.borderLeftWidth) || 0,
      cardWidth: bottom.width,
      cardRight: bottom.right,
      readingRight: readingBox.right
    };
    scriptureLabel.textContent = '這是一段刻意加長的本日經文標籤，用來驗證自訂內容也不會超出卡片';
    const longRow = document.createElement('div');
    longRow.textContent = '這是一段用來驗證很長本日經文內容仍會在卡片內自然換行，而且不會超出封面左右邊界的測試文字。';
    reading.replaceChildren(longRow);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const longBottom = document.querySelector('.overlay-bottom').getBoundingClientRect();
    const longReading = reading.getBoundingClientRect();
    const longContent = {
      gap: longBottom.top - top.bottom,
      cardWidth: longBottom.width,
      cardRight: longBottom.right,
      readingRight: longReading.right,
      scrollWidth: reading.scrollWidth,
      clientWidth: reading.clientWidth,
      labelScrollWidth: scriptureLabel.scrollWidth,
      labelClientWidth: scriptureLabel.clientWidth
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
      longContent,
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
  assert.notEqual(visual.cardBackgroundImage, 'none', `${label}: scripture card lost its warm paper treatment`);
  assert.ok(
    visual.cardBorderLeftWidth >= 2.5 && visual.cardBorderLeftWidth <= 5.1,
    `${label}: scripture card accent is not restrained (${visual.cardBorderLeftWidth}px)`
  );
  assert.ok(visual.cardWidth < expectedViewport.width * 0.65, `${label}: short scripture card still stretches across the cover`);
  assert.ok(visual.readingRight <= visual.cardRight + 1, `${label}: short scripture text escapes its card`);
  assert.ok(visual.gap > expectedViewport.height * 0.1, `${label}: title and scripture card are cramped`);
  assert.ok(visual.gap < expectedViewport.height * 0.2, `${label}: title and scripture card remain too far apart`);
  assert.ok(visual.cardBottom < expectedViewport.height * 0.86, `${label}: scripture card was not moved upward`);
  assert.ok(metrics.longContent.cardWidth <= expectedViewport.width * 0.86 + 1, `${label}: long scripture card exceeds its width cap`);
  assert.ok(metrics.longContent.cardRight <= expectedViewport.width + 1, `${label}: long scripture card crosses the viewport`);
  assert.ok(metrics.longContent.readingRight <= metrics.longContent.cardRight + 1, `${label}: long scripture text escapes its card`);
  assert.ok(metrics.longContent.scrollWidth <= metrics.longContent.clientWidth + 1, `${label}: long scripture text overflows horizontally`);
  assert.ok(metrics.longContent.labelScrollWidth <= metrics.longContent.labelClientWidth + 1, `${label}: long scripture label overflows horizontally`);
  assert.ok(metrics.longContent.gap > 0, `${label}: long scripture card overlaps the title`);
}

function verifyMetrics(metrics, fixture, expectedViewport) {
  const label = `${metrics.kind} at ${expectedViewport.width}x${expectedViewport.height}`;
  assert.equal(metrics.viewport.width, expectedViewport.width, `${label}: unexpected CSS viewport width`);
  assert.equal(metrics.viewport.height, expectedViewport.height, `${label}: unexpected CSS viewport height`);
  assert.ok(
    Math.abs(metrics.viewport.deviceScaleFactor - (expectedViewport.deviceScaleFactor || 1)) < 0.01,
    `${label}: unexpected device scale factor ${metrics.viewport.deviceScaleFactor}`
  );
  assert.equal(metrics.fontStatus, 'loaded', `${label}: fonts did not finish loading`);
  assert.equal(metrics.fontLoaded, true, `${label}: bundled SHSans-Bold was not loaded`);
  assert.equal(metrics.flowCanvas.clientWidth, 405, `${label}: reading canvas logical width changed`);
  assert.equal(metrics.flowCanvas.clientHeight, 720, `${label}: reading canvas logical height changed`);
  const expectedDisplayScale = Math.min(expectedViewport.width / 405, expectedViewport.height / 720);
  assert.ok(
    Math.abs(metrics.flowCanvas.displayScale - expectedDisplayScale) <= 0.001,
    `${label}: expected display scale ${expectedDisplayScale}, observed ${metrics.flowCanvas.displayScale}`
  );
  assert.ok(metrics.flowCanvas.rect.left >= -1, `${label}: scaled reading canvas crosses the left viewport edge`);
  assert.ok(metrics.flowCanvas.rect.right <= metrics.viewport.width + 1, `${label}: scaled reading canvas crosses the right viewport edge`);
  assert.ok(metrics.flowCanvas.rect.top >= -1, `${label}: scaled reading canvas crosses the top viewport edge`);
  assert.ok(metrics.flowCanvas.rect.bottom <= metrics.viewport.height + 1, `${label}: scaled reading canvas crosses the bottom viewport edge`);
  assert.ok(metrics.documentScrollWidth <= metrics.viewport.width + 1, `${label}: document overflows horizontally`);
  assert.equal(metrics.horizontalViolations.length, 0, `${label}: elements exceed flow content horizontally: ${JSON.stringify(metrics.horizontalViolations)}`);
  assert.ok(metrics.visualRoot.left >= metrics.visibleBounds.left - 1.5, `${label}: content crosses the left bound`);
  assert.ok(metrics.visualRoot.right <= metrics.visibleBounds.right + 1.5, `${label}: content crosses the right bound`);
  assert.ok(
    metrics.visualRoot.bottom <= metrics.visibleBounds.bottom + 1.5,
    `${label}: content bottom ${metrics.visualRoot.bottom.toFixed(1)} exceeds visible bottom ${metrics.visibleBounds.bottom.toFixed(1)}`
  );
  assert.ok(metrics.footerMetrics, `${label}: missing footer style measurements`);
  assert.equal(metrics.appRegions.screen, 'drag', `${label}: reading screen cannot drag the window natively`);
  assert.equal(metrics.appRegions.content, 'drag', `${label}: reading content cannot drag the window natively`);
  assert.equal(metrics.appRegions.previousButton, 'no-drag', `${label}: previous button became a drag region`);
  assert.equal(metrics.appRegions.nextButton, 'no-drag', `${label}: next button became a drag region`);
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
  assert.ok(metrics.footerMetrics.previousButtonRect.width >= 43, `${label}: previous arrow is too small to click`);
  assert.ok(metrics.footerMetrics.nextButtonRect.width >= 43, `${label}: next arrow is too small to click`);
  assert.ok(
    metrics.footerMetrics.previousButtonRect.top >= metrics.footerMetrics.footerRect.top - 1 &&
      metrics.footerMetrics.previousButtonRect.bottom <= metrics.footerMetrics.footerRect.bottom + 1 &&
      metrics.footerMetrics.nextButtonRect.top >= metrics.footerMetrics.footerRect.top - 1 &&
      metrics.footerMetrics.nextButtonRect.bottom <= metrics.footerMetrics.footerRect.bottom + 1,
    `${label}: an arrow escapes the floating control pill`
  );
  assert.ok(
    metrics.footerMetrics.previousButtonRect.right <= metrics.footerMetrics.nextButtonRect.left + 1,
    `${label}: the floating arrows overlap`
  );
  assert.ok(metrics.footerMetrics.footerRect.width < metrics.viewport.width * 0.45, `${label}: floating arrows are too wide`);

  if (metrics.kind === 'scripture') {
    assert.ok(metrics.pageInfoMetrics, `${label}: missing fixed Scripture page status`);
    assert.notEqual(metrics.pageInfoMetrics.display, 'none', `${label}: Scripture page status is hidden`);
    assert.equal(metrics.pageInfoMetrics.text, '1 / 1', `${label}: Scripture page count is incorrect`);
    assert.equal(metrics.pageInfoMetrics.progress, '100%', `${label}: Scripture page progress did not reach 100%`);
    assert.ok(metrics.pageInfoMetrics.opacity < 0.8, `${label}: Scripture page status is too visually prominent`);
    assert.ok(
      metrics.pageInfoMetrics.rect.top >= metrics.pageInfoMetrics.topbarRect.top - 1 &&
        metrics.pageInfoMetrics.rect.bottom <= metrics.pageInfoMetrics.topbarRect.bottom + 1,
      `${label}: Scripture page status is not fixed inside the top bar`
    );
    assert.ok(
      metrics.pageInfoMetrics.headingRect.right <= metrics.pageInfoMetrics.rect.left + 1,
      `${label}: Scripture title overlaps the fixed page status`
    );
    assert.equal(metrics.scripturePageCount, 1, `${label}: expected one rendered scripture page`);
    assert.equal(metrics.continuationCount, 1, `${label}: expected one continuation label`);
    assert.equal(metrics.continuationText, '續', `${label}: incorrect continuation label`);
    assert.deepEqual(metrics.scriptureReaderTexts, [
      '第 3 位・11–16 節（續）',
      '第 4 位・17–22 節'
    ], `${label}: reader handoff markers changed`);
    assert.deepEqual(metrics.chapterLabels, ['第 6 章'], `${label}: cross-chapter divider is incorrect`);
    assert.ok(metrics.content.scrollHeight <= metrics.content.clientHeight + 2, `${label}: scripture fixture overflows vertically`);
    assert.equal(metrics.scripturePagination.short.pageCount, 1, `${label}: seven short verses were needlessly split`);
    assert.deepEqual(metrics.scripturePagination.short.distribution, [7], `${label}: scripture paginator did not use measured capacity`);
    assert.deepEqual(metrics.scripturePagination.short.pageOverflows, [false], `${label}: packed scripture page overflows`);
    assert.ok(metrics.scripturePagination.mixed.pageCount > 1, `${label}: mixed fixture did not exercise multiple pages`);
    assert.ok(metrics.scripturePagination.mixed.pageOverflows.every((value) => value === false), `${label}: a mixed scripture page overflows`);
    assert.ok(
      metrics.scripturePagination.mixed.fillableBoundaries.every((value) => value === false),
      `${label}: paginator left room for the next complete verse on an earlier page`
    );
    assert.deepEqual(
      metrics.scripturePagination.mixed.logicalKeys,
      fixture.mixedVerses.map((verse) => verse.key),
      `${label}: mixed scripture order or membership changed`
    );
    assert.deepEqual(metrics.scripturePagination.mixed.chapterLabels, ['第 6 章'], `${label}: mixed pagination lost its chapter divider`);
    return;
  }

  assert.equal(metrics.fitOk, true, `${label}: real renderer fit function was cancelled`);
  assert.equal(metrics.pageInfoMetrics.display, 'none', `${label}: one-page Utmost should not show Scripture page status`);
  assert.equal(metrics.sheetCount, 1, `${label}: Utmost must render as exactly one sheet`);
  assert.match(metrics.headingText, new RegExp(fixture.data.date), `${label}: heading is missing the date`);
  assert.match(metrics.headingText, new RegExp(fixture.data.title), `${label}: heading is missing the title`);
  assert.match(metrics.kickerText, /《竭誠獻上》/, `${label}: kicker is missing the devotional name`);
  assert.match(metrics.kickerText, new RegExp(fixture.data.date), `${label}: kicker is missing the date`);
  assert.equal(metrics.verseLabelText, '今日經文', `${label}: verse section label is incorrect`);
  assert.equal(metrics.verseText, fixture.data.verse, `${label}: verse text changed during rendering`);
  const citation = fixture.data.verse.match(/[—–―－][^—–―－]*$/)?.[0] || '';
  assert.equal(metrics.verseCitationText, citation, `${label}: citation was not separated intact`);
  assert.equal(metrics.verseCitationWhiteSpace, 'nowrap', `${label}: citation can split across lines`);
  assert.ok(metrics.verseCitationScrollWidth <= metrics.verseCitationClientWidth + 1, `${label}: citation exceeds its card`);
  assert.ok(metrics.verseCitationRect.top >= metrics.verseQuoteRect.bottom - 1, `${label}: citation did not start on its own line`);
  assert.equal(metrics.bodyLabelCount, 0, `${label}: body still contains a redundant section label`);
  assert.equal(metrics.paragraphCount, fixture.data.paragraphs.length, `${label}: body paragraphs were merged or lost`);
  for (const [role, fontSize] of [
    ['kicker', metrics.kickerFontSize],
    ['article title', metrics.titleFontSize],
    ["today's verse", metrics.verseQuoteFontSize],
    ['verse citation', metrics.citationFontSize]
  ]) {
    assert.equal(fontSize, metrics.bodyFontSize, `${label}: ${role} font size differs from the body copy`);
  }
  assert.ok(metrics.regularScale <= 1, `${label}: regular scale exceeds its native size`);
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
  if (metrics.kind === 'utmost-long-verse') {
    assert.ok(metrics.regularScale < 1, `${label}: long verse did not exercise unified regular fitting`);
    assert.equal(metrics.extreme, false, `${label}: long verse with short body should not need emergency scaling`);
  }
  assert.ok(Math.abs(metrics.sheetTransform.b) <= 0.0001, `${label}: sheet transform contains horizontal skew or rotation`);
  assert.ok(Math.abs(metrics.sheetTransform.c) <= 0.0001, `${label}: sheet transform contains vertical skew or rotation`);
  assert.ok(
    Math.abs(metrics.sheetTransform.a - metrics.sheetTransform.d) <= 0.0001,
    `${label}: sheet is not scaled uniformly in both axes`
  );
  if (metrics.kind === 'utmost-extreme') {
    assert.ok(metrics.regularScale <= 0.48 + Number.EPSILON, `${label}: extreme fitting started above the 48% floor`);
    assert.equal(metrics.extreme, true, `${label}: extreme fixture did not exercise transform fitting`);
    assert.ok(metrics.transformScale < 1, `${label}: extreme fixture was not transform-scaled`);
    assert.ok(
      Math.abs(metrics.sheetTransform.a - metrics.transformScale) <= 0.001,
      `${label}: emergency scale was not applied to the complete sheet`
    );
  } else {
    assert.ok(
      Math.abs(metrics.sheetTransform.a - 1) <= 0.0001,
      `${label}: non-extreme content received an unexpected transform scale`
    );
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
    const wrapBaselines = new Map();
    let scripturePaginationBaseline = null;
    for (const viewport of coverViewports) {
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor || 1,
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
      console.log(`PASS ${'cover'.padEnd(15)} ${viewport.width}x${viewport.height} (compact card + thin outline)`);
    }
    for (const viewport of viewports) {
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor || 1,
        mobile: false,
        screenWidth: viewport.width,
        screenHeight: viewport.height
      });
      const fixtures = [
        {
          kind: 'scripture',
          page: scripturePage,
          packingVerses: scripturePackingVerses,
          mixedVerses: scriptureMixedVerses
        },
        ...utmostCases.map((data) => ({ kind: data.name, data }))
      ];

      for (const fixture of fixtures) {
        const metrics = await withTimeout(
          window.webContents.executeJavaScript(measurementScript(fixture), true),
          15000,
          `${fixture.kind} ${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor || 1}x`
        );
        verifyMetrics(metrics, fixture, viewport);
        if (metrics.wrapSignature.length) {
          if (!wrapBaselines.has(fixture.kind)) wrapBaselines.set(fixture.kind, metrics.wrapSignature);
          else assert.deepEqual(
            metrics.wrapSignature,
            wrapBaselines.get(fixture.kind),
            `${fixture.kind} text wrapped at different character positions after resizing`
          );
        }
        if (fixture.kind === 'scripture') {
          const paginationSignature = {
            short: {
              pageCount: metrics.scripturePagination.short.pageCount,
              distribution: metrics.scripturePagination.short.distribution
            },
            mixed: {
              pageCount: metrics.scripturePagination.mixed.pageCount,
              distribution: metrics.scripturePagination.mixed.distribution,
              logicalKeys: metrics.scripturePagination.mixed.logicalKeys
            }
          };
          if (!scripturePaginationBaseline) scripturePaginationBaseline = paginationSignature;
          else assert.deepEqual(
            paginationSignature,
            scripturePaginationBaseline,
            'Scripture pagination changed after resizing the fixed reading canvas'
          );
        }
        passed++;
        const fitting = fixture.kind === 'scripture'
          ? 'native + continuation'
          : (metrics.extreme ? `extreme ${metrics.transformScale.toFixed(3)}` : `scale ${metrics.regularScale.toFixed(2)}`);
        console.log(`PASS ${fixture.kind.padEnd(15)} ${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor || 1}x (${fitting})`);
      }
    }

    for (const step of ['scripture', 'utmost']) {
      const footerLifecycle = await withTimeout(
        window.webContents.executeJavaScript(
          `window.__readingLayoutHarness.exerciseFlowFooterAutoHide(${JSON.stringify(step)})`,
          true
        ),
        4000,
        `${step} footer auto-hide`
      );
      assert.equal(footerLifecycle.hiddenInitially, true, `${step} footer lifecycle: footer did not start hidden`);
      assert.equal(footerLifecycle.setupRevealWorked, true, `${step} footer lifecycle: mouse movement did not reveal the arrows`);
      assert.equal(footerLifecycle.directRevealWorked, true, `${step} footer lifecycle: revealFlowFooter did not reveal the footer`);
      assert.equal(footerLifecycle.stayedVisibleWhileHovered, true, `${step} footer lifecycle: footer disappeared while the pointer was over it`);
      assert.equal(footerLifecycle.hiddenAfterSchedule, true, `${step} footer lifecycle: scheduled hide did not hide the footer`);
      assert.ok(
        footerLifecycle.hideElapsed >= 850 && footerLifecycle.hideElapsed <= 1750,
        `${step} footer lifecycle: expected about 1000ms, observed ${footerLifecycle.hideElapsed.toFixed(1)}ms`
      );
      passed++;
      console.log(`PASS ${`${step}-footer`.padEnd(15)} auto-hide ${footerLifecycle.hideElapsed.toFixed(0)}ms`);
    }
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
