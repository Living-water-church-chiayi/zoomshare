'use strict';

(function exposeAssignmentShared(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AssignmentShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function smartSegmentSizes(totalVerses) {
    const total = Math.max(0, Math.floor(Number(totalVerses) || 0));
    if (!total) return [];
    const readerCount = Math.max(1, Math.ceil(total / 6));
    if (readerCount === 1) return [total];

    const fiveVerseGroups = Array(readerCount - 1).fill(5);
    const tail = total - fiveVerseGroups.reduce((sum, value) => sum + value, 0);
    if (tail >= 3 && tail <= 6) return [...fiveVerseGroups, tail];

    const base = Math.floor(total / readerCount);
    const remainder = total % readerCount;
    const balanced = Array(readerCount).fill(base);
    for (let index = readerCount - remainder; index < readerCount; index += 1) {
      if (index >= 0) balanced[index] += 1;
    }
    return balanced;
  }

  function scheduleRow(schedule) {
    if (!schedule || typeof schedule !== 'object') return null;
    if (schedule.row && typeof schedule.row === 'object') return schedule.found === false ? null : schedule.row;
    return schedule;
  }

  function scriptureVerseUnits(schedule, bible) {
    const row = scheduleRow(schedule);
    if (!row) return [];
    const startCh = Number(row.startCh);
    const startV = Number(row.startV);
    const endCh = Number(row.endCh);
    const endV = Number(row.endV);
    if (![startCh, startV, endCh, endV].every(Number.isInteger) || startCh < 1 || startV < 1 || endCh < startCh) return [];
    const book = (Array.isArray(bible) ? bible : []).find((item) => String(item && item.n) === String(row.book || ''));
    if (!book && startCh === endCh && endV >= startV) {
      return Array.from({ length: endV - startV + 1 }, (_value, index) => ({ chapter: startCh, verse: startV + index }));
    }
    if (!book || !Array.isArray(book.v) || endCh > book.v.length) return [];
    const units = [];
    for (let chapter = startCh; chapter <= endCh; chapter += 1) {
      const first = chapter === startCh ? startV : 1;
      const last = chapter === endCh ? endV : Number(book.v[chapter - 1]);
      if (!Number.isInteger(last) || first > last || last > Number(book.v[chapter - 1])) return [];
      for (let verse = first; verse <= last; verse += 1) {
        units.push({ chapter, verse });
        if (units.length > 500) return [];
      }
    }
    return units;
  }

  function scriptureSegments(schedule, bible) {
    const row = scheduleRow(schedule);
    const units = scriptureVerseUnits(schedule, bible);
    if (!row || !units.length) return [];
    const samePassageChapter = Number(row.startCh) === Number(row.endCh);
    const segments = [];
    let offset = 0;
    for (const size of smartSegmentSizes(units.length)) {
      const start = units[offset];
      const end = units[offset + size - 1];
      const label = samePassageChapter
        ? `${start.verse}–${end.verse} 節`
        : (start.chapter === end.chapter
          ? `${start.chapter}:${start.verse}–${end.verse}`
          : `${start.chapter}:${start.verse}–${end.chapter}:${end.verse}`);
      segments.push({ label, start, end, count: size });
      offset += size;
    }
    return segments;
  }

  function utmostParagraphSegments(body, slotCount = 4) {
    const maximum = Math.max(1, Math.min(4, Math.floor(Number(slotCount) || 4)));
    const paragraphs = String(body || '').split(/\n\s*\n+/).map((value) => value.trim()).filter(Boolean);
    const activeCount = Math.min(maximum, paragraphs.length);
    const sizes = activeCount ? Array(activeCount).fill(Math.floor(paragraphs.length / activeCount)) : [];
    for (let index = 0; index < paragraphs.length % Math.max(activeCount, 1); index += 1) sizes[index] += 1;
    const segments = [];
    let paragraph = 1;
    for (let index = 0; index < maximum; index += 1) {
      const size = sizes[index] || 0;
      if (!size) {
        segments.push({ label: '備用名額', startParagraph: 0, endParagraph: 0, count: 0, active: false });
        continue;
      }
      const startParagraph = paragraph;
      const endParagraph = paragraph + size - 1;
      segments.push({
        label: startParagraph === endParagraph ? `第 ${startParagraph} 段` : `第 ${startParagraph}–${endParagraph} 段`,
        startParagraph,
        endParagraph,
        count: size,
        active: true
      });
      paragraph = endParagraph + 1;
    }
    return segments;
  }

  return { smartSegmentSizes, scriptureVerseUnits, scriptureSegments, utmostParagraphSegments };
});
