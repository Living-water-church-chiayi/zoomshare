'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorshipShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function parseTimeParts(minutes, seconds) {
    const min = String(minutes ?? '').trim();
    const sec = String(seconds ?? '').trim();
    if (!min && !sec) return null;
    if ((min && !/^\d{1,4}$/.test(min)) || (sec && !/^\d{1,2}$/.test(sec)) || Number(sec) > 59) return Number.NaN;
    return Number(min) * 60 + Number(sec);
  }

  function playbackRange(config, duration) {
    const start = Math.max(0, Number(config.worshipStartSeconds) || 0);
    const requestedEnd = config.worshipEndSeconds == null ? duration : Number(config.worshipEndSeconds);
    const end = Math.min(duration, requestedEnd);
    if (!Number.isFinite(duration) || !Number.isFinite(end) || start >= end) {
      throw new Error('敬拜起訖時間超出影片長度，請調整設定');
    }
    // Short clips scale both fades together so there is no abrupt switch.
    const fadeIn = Math.max(0, Number(config.worshipFadeInSeconds) || 0);
    const fadeOut = Math.max(0, Number(config.worshipFadeOutSeconds) || 0);
    const scale = Math.min(1, (end - start) / Math.max(fadeIn + fadeOut, 0.001));
    return { start, end, fadeIn: fadeIn * scale, fadeOut: fadeOut * scale };
  }

  function envelopeVolume(position, range) {
    const incoming = range.fadeIn > 0 ? (position - range.start) / range.fadeIn : 1;
    const outgoing = range.fadeOut > 0 ? (range.end - position) / range.fadeOut : 1;
    return Math.max(0, Math.min(1, incoming, outgoing));
  }

  function moveMarker(config, duration, edge, position) {
    if (!Number.isFinite(duration) || duration < 1 || !Number.isFinite(position)) return null;
    const range = playbackRange(config, duration);
    const maximum = Math.floor(duration);
    const second = Math.max(0, Math.min(maximum, Math.round(position)));
    const start = edge === 'in' ? Math.min(second, Math.max(0, Math.floor(range.end - 1))) : range.start;
    const end = edge === 'out' ? Math.max(second, Math.floor(start) + 1) : range.end;
    return { worshipStartSeconds: start, worshipEndSeconds: end >= maximum ? null : end };
  }

  function countdownState(value) {
    if (!value || value.active !== true) return { active: false };
    const { position, end, duration } = value;
    const ready = [position, end, duration].every(Number.isFinite) && duration > 0 && end > 0;
    const remainingSeconds = ready ? Math.ceil(Math.max(0, Math.min(end, duration) - Math.max(0, position))) : null;
    const tone = remainingSeconds === null || remainingSeconds > 60 ? 'normal'
      : remainingSeconds > 30 ? 'minute' : remainingSeconds > 15 ? 'soon' : 'ending';
    return { active: true, remainingSeconds, tone, paused: value.paused === true, preview: value.preview === true };
  }

  return { parseTimeParts, playbackRange, envelopeVolume, moveMarker, countdownState };
});
