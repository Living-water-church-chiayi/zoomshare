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
    '傳道', '長老', '執事', '師母', '先生', '小姐', '大哥', '大姐',
    '嘉義', '義活', '活水'
  ]);
  const COMMON_SINGLE_CHINESE_SURNAMES = new Set(Array.from(
    '王李張陳林黃吳劉蔡楊許鄭謝郭洪曾邱廖賴徐周葉蘇莊呂江何蕭羅高簡朱鍾游詹沈彭胡余盧潘顏梁趙柯翁魏孫戴范方宋鄧杜侯曹薛傅丁溫紀范姜蔣歐藍連馬董石卓程姚康馮古姜湯汪白田涂鄒巫尤鐘黎龔嚴韓袁金童陸夏柳凃施任孔武崔尹錢段倪易熊秦伍韋申尤毛殷向凌岳丘韋柏鄺祝華車符萬俞皮卜穆饒魯關谷祁艾舒桂花牛解鮑梅盛費成陽裴衛查屈房滕安樊左甘邵苗池季伍阮練駱牟鄢畢聶叢姬申向單杭陽景伏麥賀包寇文聞莘冷甄商鄔談岑胥農尚管柯喬葛全佘封冼隋竇竺濮桑隗郝鄂翟譚裘荀席師辛焦路婁宗宣冉宓雍郁霍亓禹都稽'
  ));

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
    for (const origin of hanTokenOrigins(value)) {
      if (!GENERIC_HAN_TOKENS.has(origin.token)) tokens.add(origin.token);
    }
    return tokens;
  }

  function hanTokenOrigins(value) {
    const origins = [];
    const nameWithoutHonorific = stripHonorificSuffixes(value);
    for (const run of nameWithoutHonorific.match(/[\p{Script=Han}]+/gu) || []) {
      const characters = Array.from(run);
      for (let index = 0; index < characters.length - 1; index += 1) {
        const token = characters[index] + characters[index + 1];
        origins.push({ token, run, index, runLength: characters.length });
      }
    }
    return origins;
  }

  function isLikelySurnamePrefixDuplicate(token, memberIds, tokenOrigins) {
    const characters = Array.from(token);
    if (characters.length !== 2 || !COMMON_SINGLE_CHINESE_SURNAMES.has(characters[0])) return false;
    for (const memberId of memberIds) {
      const origins = tokenOrigins.get(memberId) || [];
      const hasFullNamePrefix = origins.some((origin) => (
        origin.index === 0 &&
        origin.runLength >= 3 &&
        origin.token === token
      ));
      if (!hasFullNamePrefix) return false;
    }
    return true;
  }

  function sameStringSet(left, right) {
    if (!left || !right || left.size !== right.size) return false;
    for (const item of left) {
      if (!right.has(item)) return false;
    }
    return true;
  }

  function sharedAccountDisplayName(value) {
    const normalized = normalizeDisplayName(value);
    if (!normalized) return false;
    return /[&＆+＋/／、]/.test(normalized) || /[\p{Script=Han}](?:和|及)[\p{Script=Han}]/u.test(normalized);
  }

  function duplicateMessage(type, label, memberIds) {
    return `${type}「${label}」：${[...memberIds].join('、')}`;
  }

  function buildRosterMatcher(roster) {
    const claims = new Map();
    const tokenClaims = new Map();
    const tokenClaimOrigins = new Map();
    const membersById = new Map();
    const errors = [];
    for (const member of Array.isArray(roster) ? roster : []) {
      if (!member || !member.enabled || !member.memberId) continue;
      const memberId = String(member.memberId);
      membersById.set(memberId, member);
      const labels = [
        { value: member.name, alias: false },
        ...(Array.isArray(member.aliases) ? member.aliases.map((alias) => ({ value: alias, alias: true })) : [])
      ];
      for (const label of labels) {
        const key = normalizeDisplayName(label.value);
        if (!key) continue;
        if (!claims.has(key)) claims.set(key, { memberIds: new Set(), aliasMemberIds: new Set() });
        claims.get(key).memberIds.add(memberId);
        if (label.alias) claims.get(key).aliasMemberIds.add(memberId);
        for (const origin of hanTokenOrigins(label.value)) {
          const token = origin.token;
          if (GENERIC_HAN_TOKENS.has(token)) continue;
          if (!tokenClaims.has(token)) tokenClaims.set(token, new Set());
          tokenClaims.get(token).add(memberId);
          if (!tokenClaimOrigins.has(token)) tokenClaimOrigins.set(token, new Map());
          const originsByMember = tokenClaimOrigins.get(token);
          if (!originsByMember.has(memberId)) originsByMember.set(memberId, []);
          originsByMember.get(memberId).push(origin);
        }
      }
    }
    const matchByName = new Map();
    const matchBySharedName = new Map();
    const ambiguousNames = new Set();
    const acceptedSharedDuplicateMessages = new Set();
    const suppressedSharedTokenClaims = new Map();
    for (const [key, claim] of claims) {
      const memberIds = claim.memberIds;
      if (memberIds.size === 1) matchByName.set(key, [...memberIds][0]);
      else if (sharedAccountDisplayName(key) || sameStringSet(claim.aliasMemberIds, memberIds)) {
        matchBySharedName.set(key, [...memberIds]);
        acceptedSharedDuplicateMessages.add(duplicateMessage('姓名或別名重複', key, memberIds));
        for (const token of twoCharacterHanTokens(key)) {
          const tokenMemberIds = tokenClaims.get(token);
          if (sameStringSet(tokenMemberIds, memberIds)) {
            suppressedSharedTokenClaims.set(token, memberIds);
            acceptedSharedDuplicateMessages.add(duplicateMessage('姓名片段重複', token, memberIds));
          }
        }
      }
      else {
        ambiguousNames.add(key);
        errors.push(duplicateMessage('姓名或別名重複', key, memberIds));
      }
    }
    const matchByHanToken = new Map();
    for (const [token, memberIds] of tokenClaims) {
      if (memberIds.size === 1) matchByHanToken.set(token, [...memberIds][0]);
      else if (
        !sameStringSet(suppressedSharedTokenClaims.get(token), memberIds) &&
        !isLikelySurnamePrefixDuplicate(token, memberIds, tokenClaimOrigins.get(token) || new Map())
      ) {
        errors.push(duplicateMessage('姓名片段重複', token, memberIds));
      }
    }
    return { matchByName, matchBySharedName, matchByHanToken, ambiguousNames, membersById, errors, acceptedSharedDuplicateMessages };
  }

  function matchRosterMemberIds(matcher, displayName) {
    const normalizedName = normalizeDisplayName(displayName);
    if (!normalizedName) return [];
    const exactMemberId = matcher.matchByName.get(normalizedName);
    if (exactMemberId) return [exactMemberId];
    const sharedMemberIds = matcher.matchBySharedName && matcher.matchBySharedName.get(normalizedName);
    if (sharedMemberIds) return sharedMemberIds.slice();
    if (matcher.ambiguousNames.has(normalizedName)) return [];

    const memberIds = new Set();
    for (const [token, memberId] of matcher.matchByHanToken) {
      if (normalizedName.includes(token)) memberIds.add(memberId);
      if (memberIds.size > 1) return [];
    }
    return memberIds.size === 1 ? [...memberIds] : [];
  }

  function matchRosterMember(matcher, displayName) {
    const memberIds = matchRosterMemberIds(matcher, displayName);
    return memberIds.length === 1 ? memberIds[0] : '';
  }

  function deriveRosterPresence(snapshot, roster) {
    const matcher = buildRosterMatcher(roster);
    const onlineMemberIds = new Set();
    const participants = (snapshot && Array.isArray(snapshot.participants) ? snapshot.participants : []).map((participant) => {
      const memberIds = matchRosterMemberIds(matcher, participant.displayName);
      for (const memberId of memberIds) onlineMemberIds.add(memberId);
      return { ...participant, memberId: memberIds.length === 1 ? memberIds[0] : '', memberIds };
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
      errors: matcher.errors,
      acceptedSharedDuplicateMessages: matcher.acceptedSharedDuplicateMessages
    };
  }

  return { normalizeDisplayName, twoCharacterHanTokens, buildRosterMatcher, matchRosterMember, matchRosterMemberIds, deriveRosterPresence };
});
