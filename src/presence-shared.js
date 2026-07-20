'use strict';

(function exposePresenceShared(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PresenceShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const HONORIFIC_SUFFIXES = [
    '傳道師', '姊姊', '姐姐', '叔叔', '阿姨', '老師', '爸爸', '媽媽',
    '牧師', '傳道', '長老', '執事', '師母', '先生', '小姐', '大哥', '大姐',
    '姐', '哥'
  ];
  const GENERIC_HAN_TOKENS = new Set([
    '姊姊', '姐姐', '叔叔', '阿姨', '老師', '爸爸', '媽媽', '牧師',
    '傳道', '長老', '執事', '師母', '先生', '小姐', '大哥', '大姐'
  ]);

  function normalizeDisplayName(value) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('zh-Hant');
  }

  function stripHonorificSuffixes(value) {
    let result = normalizeDisplayName(value);
    let changed = true;
    while (changed) {
      changed = false;
      for (const suffix of HONORIFIC_SUFFIXES) {
        if (!result.endsWith(suffix) || result === suffix) continue;
        result = result.slice(0, -suffix.length).trim();
        changed = true;
        break;
      }
    }
    return result;
  }

  function twoCharacterHanTokens(value) {
    const tokens = new Set();
    const nameWithoutHonorific = stripHonorificSuffixes(value);
    for (const run of nameWithoutHonorific.match(/[\p{Script=Han}]+/gu) || []) {
      const characters = Array.from(run);
      for (let index = 0; index < characters.length - 1; index += 1) {
        const token = characters[index] + characters[index + 1];
        if (!GENERIC_HAN_TOKENS.has(token)) tokens.add(token);
      }
    }
    return tokens;
  }

  function buildRosterMatcher(roster) {
    const claims = new Map();
    const tokenClaims = new Map();
    const membersById = new Map();
    const errors = [];
    for (const member of Array.isArray(roster) ? roster : []) {
      if (!member || !member.enabled || !member.memberId) continue;
      membersById.set(String(member.memberId), member);
      for (const label of [member.name, ...(Array.isArray(member.aliases) ? member.aliases : [])]) {
        const key = normalizeDisplayName(label);
        if (!key) continue;
        if (!claims.has(key)) claims.set(key, new Set());
        claims.get(key).add(String(member.memberId));
        for (const token of twoCharacterHanTokens(label)) {
          if (!tokenClaims.has(token)) tokenClaims.set(token, new Set());
          tokenClaims.get(token).add(String(member.memberId));
        }
      }
    }
    const matchByName = new Map();
    const ambiguousNames = new Set();
    for (const [key, memberIds] of claims) {
      if (memberIds.size === 1) matchByName.set(key, [...memberIds][0]);
      else {
        ambiguousNames.add(key);
        errors.push(`姓名或別名重複「${key}」：${[...memberIds].join('、')}`);
      }
    }
    const matchByHanToken = new Map();
    for (const [token, memberIds] of tokenClaims) {
      if (memberIds.size === 1) matchByHanToken.set(token, [...memberIds][0]);
      else errors.push(`姓名片段重複「${token}」：${[...memberIds].join('、')}`);
    }
    return { matchByName, matchByHanToken, ambiguousNames, membersById, errors };
  }

  function matchRosterMember(matcher, displayName) {
    const normalizedName = normalizeDisplayName(displayName);
    if (!normalizedName) return '';
    const exactMemberId = matcher.matchByName.get(normalizedName);
    if (exactMemberId) return exactMemberId;
    if (matcher.ambiguousNames.has(normalizedName)) return '';

    const memberIds = new Set();
    for (const [token, memberId] of matcher.matchByHanToken) {
      if (normalizedName.includes(token)) memberIds.add(memberId);
      if (memberIds.size > 1) return '';
    }
    return memberIds.size === 1 ? [...memberIds][0] : '';
  }

  function deriveRosterPresence(snapshot, roster) {
    const matcher = buildRosterMatcher(roster);
    const onlineMemberIds = new Set();
    const participants = (snapshot && Array.isArray(snapshot.participants) ? snapshot.participants : []).map((participant) => {
      const memberId = matchRosterMember(matcher, participant.displayName);
      if (memberId) onlineMemberIds.add(memberId);
      return { ...participant, memberId };
    });
    const enabledMembers = [...matcher.membersById.values()].sort((left, right) =>
      Number(left.order || 0) - Number(right.order || 0) || String(left.name).localeCompare(String(right.name), 'zh-Hant'));
    const onlineMembers = enabledMembers.filter((member) => onlineMemberIds.has(String(member.memberId)));
    return {
      participants,
      onlineMembers,
      scriptureCandidates: onlineMembers.filter((member) => member.canReadScripture),
      utmostCandidates: onlineMembers.filter((member) => member.canReadUtmost),
      membersById: matcher.membersById,
      errors: matcher.errors
    };
  }

  return { normalizeDisplayName, twoCharacterHanTokens, buildRosterMatcher, matchRosterMember, deriveRosterPresence };
});
