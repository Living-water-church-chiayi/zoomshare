'use strict';

(function exposeDevotionalDate(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DevotionalDate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  // At 17:30 Taipei time, all daily content belongs to the following day.
  // Keep the wall-clock hour for refresh/retry decisions; advance only the date.
  function dateParts(now = new Date(), timeZone = 'Asia/Taipei') {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, Number.parseInt(part.value, 10)]));
    const preparingTomorrow = values.hour * 60 + values.minute >= 17 * 60 + 30;
    const target = new Date(Date.UTC(values.year, values.month - 1, values.day + Number(preparingTomorrow)));
    return {
      year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate(),
      hour: values.hour, minute: values.minute, preparingTomorrow
    };
  }

  function dateKey(now = new Date(), timeZone = 'Asia/Taipei') {
    const { year, month, day } = dateParts(now, timeZone);
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return { dateParts, dateKey };
});
