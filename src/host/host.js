'use strict';

const $ = (id) => document.getElementById(id);
const { buildRosterMatcher, deriveRosterPresence, matchRosterMember } = window.PresenceShared;
const { scriptureSegments, utmostParagraphSegments } = window.AssignmentShared;

let currentState = null;
let currentMeetingUuid = '';
let selected = { scripture: [], utmost: [] };
let activeSlots = { scripture: 0, utmost: 0 };
let currentScriptureSegments = [];
let currentUtmostSegments = utmostParagraphSegments('', 4);
let utmostBody = '';
let currentScriptureConfig = null;
let assignmentsHydrated = false;
let previousOnlineMemberIds = new Set();
let saveTimer = null;

function setHidden(element, hidden) {
  element.classList.toggle('hidden', hidden);
}

function connectionPresentation(connection) {
  if (connection === 'connected') return { text: '已連線', className: 'connected' };
  if (connection === 'connecting') return { text: '連線中', className: '' };
  if (connection === 'error') return { text: '需要處理', className: 'error' };
  return { text: '目前離線', className: 'error' };
}

function showNotice(message) {
  const notice = $('notice');
  notice.textContent = message;
  setHidden(notice, !message);
}

function formatShortDate(value) {
  const match = String(value || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])} 月 ${Number(match[2])} 日` : String(value || '');
}

function validScriptureConfig(value) {
  if (!value || typeof value !== 'object') return null;
  const config = {
    book: String(value.book || '').trim(),
    startCh: Number(value.startCh),
    startV: Number(value.startV),
    endCh: Number(value.endCh),
    endV: Number(value.endV)
  };
  if (!config.book || ![config.startCh, config.startV, config.endCh, config.endV].every(Number.isInteger)) return null;
  if (config.startCh < 1 || config.startV < 1 || config.endCh < config.startCh) return null;
  return config;
}

function scriptureReference(value) {
  const row = value && value.row ? value.row : value;
  if (!row || !row.book) return '';
  const end = Number(row.startCh) === Number(row.endCh) ? String(row.endV) : `${row.endCh}:${row.endV}`;
  return `${row.book} ${row.startCh}:${row.startV}–${end}`;
}

function assignmentStats(memberId) {
  const stats = currentState && currentState.assignmentStats && currentState.assignmentStats.memberStats;
  return stats && stats[String(memberId)] ? stats[String(memberId)] : {
    scriptureCount: 0,
    utmostCount: 0,
    totalCount: 0,
    readYesterday: false,
    yesterdayRoles: [],
    lastReadDate: ''
  };
}

function todaySharerMemberIds() {
  const sharing = currentState && currentState.utmostSharing;
  if (!sharing || !sharing.found || !sharing.sharer) return new Set();
  const matcher = buildRosterMatcher(currentState.roster || []);
  const labels = String(sharing.sharer).split(/[、/／+＋]|(?:\s*[及和]\s*)/).map((value) => value.trim()).filter(Boolean);
  const memberIds = new Set();
  for (const label of labels) {
    const memberId = matchRosterMember(matcher, label);
    if (memberId) memberIds.add(String(memberId));
  }
  return memberIds;
}

function eligibleCandidates(kind, derived) {
  const candidates = kind === 'scripture' ? derived.scriptureCandidates : derived.utmostCandidates;
  if (kind === 'scripture') return candidates;
  const blocked = new Set(selected.scripture.filter(Boolean));
  for (const memberId of todaySharerMemberIds()) blocked.add(memberId);
  return candidates.filter((member) => !blocked.has(String(member.memberId)));
}

function normalizeSelections() {
  selected.scripture = currentScriptureSegments.map((_segment, index) => String(selected.scripture[index] || ''));
  selected.utmost = currentUtmostSegments.map((_segment, index) => String(selected.utmost[index] || ''));
  if (activeSlots.scripture >= selected.scripture.length) activeSlots.scripture = 0;
  if (activeSlots.utmost >= selected.utmost.length) activeSlots.utmost = 0;
}

function hydrateAssignments(state) {
  if (assignmentsHydrated || !state || !state.assignmentStats) return;
  const saved = state.assignmentStats.currentAssignment || {};
  selected.scripture = Array.isArray(saved.scripture) ? saved.scripture.slice() : [];
  selected.utmost = Array.isArray(saved.utmost) ? saved.utmost.slice() : [];
  assignmentsHydrated = true;
}

function renderTodaySharing(state) {
  const sharing = state.utmostSharing || {};
  if (sharing.found && sharing.sharer) {
    $('todaySharingName').textContent = sharing.sharer;
    $('todaySharingNext').textContent = '';
    return;
  }
  $('todaySharingName').textContent = sharing.error ? '排班表暫時讀取失敗' : '今天沒有排定分享者';
  $('todaySharingNext').textContent = sharing.next
    ? `下一次：${formatShortDate(sharing.next.date)}・${sharing.next.sharer}`
    : '';
}

function renderAssignmentCards(kind, segments, derived) {
  const container = $(kind === 'scripture' ? 'scriptureAssignments' : 'utmostAssignments');
  container.replaceChildren();
  const values = selected[kind];
  segments.forEach((segment, index) => {
    const memberId = String(values[index] || '');
    const member = memberId ? derived.membersById.get(memberId) : null;
    const online = member && derived.onlineMembers.some((item) => String(item.memberId) === memberId);
    const card = document.createElement('article');
    card.className = 'assignment-card';
    card.dataset.kind = kind;
    card.dataset.index = String(index);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    if (activeSlots[kind] === index) card.classList.add('active');
    if (member && !online) card.classList.add('offline');
    if (segment.active === false) card.classList.add('reserve');

    const range = document.createElement('span');
    range.textContent = segment.label;
    const name = document.createElement('strong');
    name.textContent = member ? member.name : '尚未選人';
    const details = document.createElement('small');
    if (member && !online) details.textContent = '已離線，重新加入後會自動恢復';
    else if (member) details.textContent = `本週已讀 ${assignmentStats(memberId).totalCount} 次`;
    else details.textContent = index === activeSlots[kind] ? '已選取・請直接點下方人名' : '點一下選擇這個分段';
    card.append(range, name, details);

    if (member) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'clear-assignment';
      clear.dataset.clearKind = kind;
      clear.dataset.clearIndex = String(index);
      clear.textContent = '清除';
      card.appendChild(clear);
    }
    container.appendChild(card);
  });
}

function renderEligibleList(kind, derived) {
  const container = $(kind === 'scripture' ? 'scriptureEligibleList' : 'utmostEligibleList');
  const target = $(kind === 'scripture' ? 'scriptureTargetSummary' : 'utmostTargetSummary');
  container.replaceChildren();
  const segments = kind === 'scripture' ? currentScriptureSegments : currentUtmostSegments;
  const segment = segments[activeSlots[kind]] || { label: '此名額' };
  target.textContent = `現在安排：${segment.label}`;
  const candidates = eligibleCandidates(kind, derived);
  if (!candidates.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = currentState.snapshot.status === 'active' ? '目前沒有可安排的人在線' : '等待 Zoom 會議開始';
    container.appendChild(empty);
    return;
  }
  const sorted = [...candidates].sort((left, right) => {
    const leftStats = assignmentStats(left.memberId);
    const rightStats = assignmentStats(right.memberId);
    if (leftStats.readYesterday !== rightStats.readYesterday) return leftStats.readYesterday ? 1 : -1;
    return leftStats.totalCount - rightStats.totalCount || Number(left.order || 0) - Number(right.order || 0);
  });
  for (const member of sorted) {
    const memberId = String(member.memberId);
    const stats = assignmentStats(memberId);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'candidate-button';
    button.dataset.memberId = memberId;
    button.dataset.kind = kind;
    const assignedIndex = selected[kind].indexOf(memberId);
    const selectedHere = assignedIndex === activeSlots[kind];
    const selectedAnywhere = assignedIndex >= 0;
    if (selectedAnywhere) button.classList.add('selected');
    if (selectedHere) button.classList.add('selected-here');
    button.setAttribute('aria-pressed', String(selectedAnywhere));
    if (stats.readYesterday && !selectedAnywhere) {
      button.disabled = true;
      button.classList.add('recently-read');
    }
    const name = document.createElement('strong');
    name.textContent = member.name;
    const details = document.createElement('small');
    details.textContent = selectedAnywhere
      ? `已安排・本週閱讀 ${stats.totalCount} 次`
      : (stats.readYesterday ? `昨天已讀・本週閱讀 ${stats.totalCount} 次` : `本週閱讀 ${stats.totalCount} 次`);
    button.append(name, details);
    container.appendChild(button);
  }
}

function renderAllOnline(derived) {
  const container = $('allOnlineList');
  container.replaceChildren();
  if (!derived.participants.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '目前沒有人在線';
    container.appendChild(empty);
    return;
  }
  for (const participant of [...derived.participants].sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hant'))) {
    const row = document.createElement('div');
    row.className = 'online-row';
    const name = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = 'online-dot';
    name.append(dot, document.createTextNode(participant.displayName || '未提供名稱'));
    const details = document.createElement('small');
    if (participant.memberId) {
      const member = derived.membersById.get(participant.memberId);
      const roles = [];
      if (member && member.canReadScripture) roles.push('讀經文');
      if (member && member.canReadUtmost) roles.push('讀竭誠獻上');
      details.textContent = roles.join('、') || '服務名單成員';
    } else details.textContent = '未列入服務名單';
    row.append(name, details);
    container.appendChild(row);
  }
}

function selectedOnlineDepartures(derived) {
  const onlineIds = new Set(derived.onlineMembers.map((member) => String(member.memberId)));
  const departed = [];
  for (const [kind, label] of [['scripture', '經文'], ['utmost', '竭誠獻上']]) {
    for (const memberId of new Set(selected[kind].filter(Boolean))) {
      if (!previousOnlineMemberIds.has(memberId) || onlineIds.has(memberId)) continue;
      const member = derived.membersById.get(memberId);
      if (member) departed.push(`${member.name}（${label}）`);
    }
  }
  previousOnlineMemberIds = onlineIds;
  return departed;
}

function renderState(state) {
  currentState = state;
  setHidden($('setupView'), state.configured);
  setHidden($('consoleView'), !state.configured);
  if (!state.configured) return;

  const snapshot = state.snapshot || { status: 'idle', meetingUuid: '', participants: [] };
  if (snapshot.status !== 'active') {
    currentMeetingUuid = '';
    selected = { scripture: [], utmost: [] };
    activeSlots = { scripture: 0, utmost: 0 };
    assignmentsHydrated = false;
  } else if (currentMeetingUuid && currentMeetingUuid !== snapshot.meetingUuid) {
    selected = { scripture: [], utmost: [] };
    activeSlots = { scripture: 0, utmost: 0 };
    assignmentsHydrated = false;
  }
  currentMeetingUuid = snapshot.status === 'active' ? snapshot.meetingUuid : '';
  if (snapshot.status === 'active') hydrateAssignments(state);

  const scriptureSource = currentScriptureConfig || state.schedule;
  currentScriptureSegments = scriptureSegments(scriptureSource, window.BIBLE);
  if (!currentScriptureSegments.length) currentScriptureSegments = [{ label: '今日經文範圍待確認', count: 0, active: true }];
  currentUtmostSegments = utmostParagraphSegments(utmostBody, 4);
  normalizeSelections();

  const derived = deriveRosterPresence(snapshot, state.roster || []);
  const departed = selectedOnlineDepartures(derived);
  showNotice(departed.length ? `${departed.join('、')} 已離線，安排仍保留。` : (state.error || ''));

  const presentation = connectionPresentation(state.connection);
  $('connectionBadge').textContent = presentation.text;
  $('connectionBadge').className = `status-badge ${presentation.className}`.trim();
  const hasMeetingSummary = Boolean(snapshot.meetingNumber);
  $('meetingState').textContent = snapshot.status === 'active'
    ? `Zoom 會議進行中・${snapshot.meetingNumber}`
    : (hasMeetingSummary ? `Zoom 會議已結束・${snapshot.meetingNumber}` : '尚未偵測到 Zoom 會議');
  const peakParticipants = Math.max(Number(snapshot.peakParticipants || 0), derived.participants.length);
  $('onlineCount').textContent = hasMeetingSummary ? `本次會議最高 ${peakParticipants} 人在線` : '0 人在線';
  $('allOnlineCount').textContent = String(derived.participants.length);
  const reference = scriptureReference(scriptureSource);
  $('scriptureRangeSummary').textContent = `${reference ? `${reference}・` : ''}${currentScriptureSegments.length > 1 ? `${currentScriptureSegments.length} 人較合適` : '1 人較合適'}`;
  const paragraphCount = currentUtmostSegments.reduce((sum, item) => sum + Number(item.count || 0), 0);
  $('utmostParagraphSummary').textContent = paragraphCount ? `共 ${paragraphCount} 段・最多 4 人` : '保留 4 個名額';

  renderTodaySharing(state);
  renderAssignmentCards('scripture', currentScriptureSegments, derived);
  renderAssignmentCards('utmost', currentUtmostSegments, derived);
  renderEligibleList('scripture', derived);
  renderEligibleList('utmost', derived);
  renderAllOnline(derived);

  const errors = [...new Set([...(state.rosterErrors || []), ...derived.errors])];
  $('rosterErrors').textContent = errors.length ? `名單需要檢查：\n${errors.join('\n')}` : '';
  setHidden($('rosterErrors'), errors.length === 0);
  $('deviceDescription').textContent = `${state.deviceLabel || '這台主持人電腦'}・${state.serviceUrl}${state.stale ? '・使用離線資料' : ''}`;
}

function assignmentPayload() {
  const date = currentState && currentState.assignmentStats && currentState.assignmentStats.date;
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  const localDate = `${values.year}-${values.month}-${values.day}`;
  return {
    date: date || localDate,
    scripture: selected.scripture.filter(Boolean),
    utmost: selected.utmost.filter(Boolean)
  };
}

function queueSaveAssignments() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const state = await window.hostApi.saveAssignments(assignmentPayload());
      renderState(state);
    } catch (error) {
      showNotice(error.message || '無法記錄閱讀安排');
    }
  }, 250);
}

async function submitPair(event) {
  event.preventDefault();
  const button = $('pairButton');
  const message = $('pairMessage');
  button.disabled = true;
  message.textContent = '正在配對…';
  try {
    const result = await window.hostApi.pair({
      serviceUrl: $('serviceUrl').value,
      label: $('deviceLabel').value,
      installKey: $('installKey').value
    });
    $('installKey').value = '';
    renderState(result);
  } catch (error) {
    message.textContent = error.message || '配對失敗';
  } finally {
    button.disabled = false;
  }
}

function chooseCandidate(event) {
  const button = event.target.closest('.candidate-button');
  if (!button || button.disabled) return;
  const kind = button.dataset.kind;
  const values = selected[kind];
  const index = activeSlots[kind];
  const memberId = button.dataset.memberId;
  if (kind === 'utmost' && (selected.scripture.includes(memberId) || todaySharerMemberIds().has(memberId))) {
    showNotice('今天讀經文或負責竭誠獻上分享的人，不能再安排朗讀竭誠獻上。');
    return;
  }
  const existingIndex = values.indexOf(memberId);
  if (existingIndex >= 0 && existingIndex !== index) {
    activeSlots[kind] = existingIndex;
    showNotice('同一人不會重複讀同一項；已移到他目前的名額。');
    renderState(currentState);
    return;
  }
  let removedFromUtmost = false;
  if (kind === 'scripture') {
    selected.utmost = selected.utmost.map((value) => {
      if (value !== memberId) return value;
      removedFromUtmost = true;
      return '';
    });
  }
  values[index] = memberId;
  renderState(currentState);
  if (removedFromUtmost) showNotice('此人已改為讀經文，因此已從竭誠獻上朗讀安排移除。');
  queueSaveAssignments();
}

function activateAssignment(event) {
  const clear = event.target.closest('.clear-assignment');
  if (clear) {
    event.stopPropagation();
    const kind = clear.dataset.clearKind;
    const index = Number(clear.dataset.clearIndex);
    selected[kind][index] = '';
    activeSlots[kind] = index;
    renderState(currentState);
    queueSaveAssignments();
    return;
  }
  const card = event.target.closest('.assignment-card');
  if (!card) return;
  activeSlots[card.dataset.kind] = Number(card.dataset.index);
  renderState(currentState);
}

async function loadUtmostParagraphs() {
  try {
    const result = await window.hostApi.utmostToday();
    if (result && result.ok) utmostBody = String(result.body || '');
    else $('utmostParagraphSummary').textContent = '內容尚未取得・保留 4 個名額';
  } catch {
    $('utmostParagraphSummary').textContent = '內容尚未取得・保留 4 個名額';
  }
  if (currentState) renderState(currentState);
}

async function init() {
  document.body.classList.add(window.hostApi.platform === 'darwin' ? 'plat-mac' : 'plat-win');
  $('deviceLabel').value = `${window.hostApi.platform === 'darwin' ? 'Mac' : 'Windows'} 主持人電腦`;
  $('pairForm').addEventListener('submit', submitPair);
  $('scriptureEligibleList').addEventListener('click', chooseCandidate);
  $('utmostEligibleList').addEventListener('click', chooseCandidate);
  $('scriptureAssignments').addEventListener('click', activateAssignment);
  $('utmostAssignments').addEventListener('click', activateAssignment);
  $('refreshButton').addEventListener('click', async () => {
    $('refreshButton').disabled = true;
    try { renderState(await window.hostApi.refresh()); }
    catch (error) { showNotice(error.message || '更新失敗'); }
    finally { $('refreshButton').disabled = false; }
  });
  $('unpairButton').addEventListener('click', async () => {
    if (!window.confirm('解除後需要安裝金鑰才能重新配對。確定要解除嗎？')) return;
    renderState(await window.hostApi.unpair());
  });
  window.hostApi.onState(renderState);
  window.hostApi.onScriptureCurrent((scripture) => {
    currentScriptureConfig = validScriptureConfig(scripture);
    if (currentState) renderState(currentState);
  });
  const [state, scripture] = await Promise.all([
    window.hostApi.getState(),
    window.hostApi.scriptureCurrent()
  ]);
  currentScriptureConfig = validScriptureConfig(scripture);
  renderState(state);
  loadUtmostParagraphs();
}

window.addEventListener('DOMContentLoaded', init);
