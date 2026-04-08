// history.js — Multi-Account History

const MAX_BARS_PER_PAGE = 21;
let currentPage = 0;
let fullLog = [];
let latestUsage = null;
let selectedAccountId = null;
let colorIntervals = [
  { from: 0, color: '#4CAF50' }, { from: 50, color: '#FFC107' },
  { from: 70, color: '#FF9800' }, { from: 90, color: '#F44336' }
];

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('prev-btn').addEventListener('click', () => { currentPage--; renderPage(); });
  document.getElementById('next-btn').addEventListener('click', () => { currentPage++; renderPage(); });
  document.getElementById('chart-prev').addEventListener('click', () => { currentPage--; renderPage(); });
  document.getElementById('chart-next').addEventListener('click', () => { currentPage++; renderPage(); });
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('clear-log-btn').addEventListener('click', clearLog);
  document.getElementById('account-selector').addEventListener('change', (e) => {
    selectedAccountId = e.target.value;
    loadHistory();
  });

  loadAccounts().then(() => loadHistory());
});

// Auto-reload when settings change (e.g. colors)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.colorIntervals) {
    colorIntervals = changes.colorIntervals.newValue || colorIntervals;
    renderPage();
  }
});

async function openSettings() {
  const settingsUrl = chrome.runtime.getURL('settings.html');
  const tabs = await chrome.tabs.query({ url: settingsUrl });
  if (tabs.length > 0) {
    chrome.tabs.update(tabs[0].id, { active: true });
    chrome.windows.update(tabs[0].windowId, { focused: true });
    return;
  }
  chrome.runtime.openOptionsPage();
}

function clearLog() {
  if (selectedAccountId === '__all__') {
    alert('Selecione uma conta específica para limpar o histórico.');
    return;
  }
  if (!selectedAccountId) return;
  if (!confirm('Tem certeza que deseja limpar o histórico desta conta?')) return;
  chrome.runtime.sendMessage({ action: 'clearUsageLog', orgUuid: selectedAccountId }, () => {
    fullLog = [];
    latestUsage = null;
    currentPage = 0;
    renderPage();
    // Refresh stats
    loadHistory();
  });
}

function loadAccounts() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['accounts', 'activeAccountId'], (data) => {
      const accounts = data.accounts || {};
      const activeId = data.activeAccountId;
      const selector = document.getElementById('account-selector');
      selector.innerHTML = '';

      const accountList = Object.values(accounts);

      if (accountList.length <= 1) {
        // Single account or none — hide selector
        selector.style.display = 'none';
        selectedAccountId = activeId || (accountList[0]?.orgUuid) || null;
        resolve();
        return;
      }

      selector.style.display = '';

      // "All accounts" option
      const allOpt = document.createElement('option');
      allOpt.value = '__all__';
      allOpt.textContent = 'Todas as contas';
      selector.appendChild(allOpt);

      // Individual accounts
      for (const acct of accountList) {
        const opt = document.createElement('option');
        opt.value = acct.orgUuid;
        const name = acct.customLabel || acct.orgName || acct.orgUuid.slice(0, 8);
        opt.textContent = acct.orgUuid === activeId ? `${name} (ativa)` : name;
        selector.appendChild(opt);
      }

      // Default to active account
      selectedAccountId = activeId || '__all__';
      selector.value = selectedAccountId;
      resolve();
    });
  });
}

function loadHistory() {
  // Load color settings
  chrome.storage.sync.get({ colorIntervals: null }, (syncResult) => {
    if (syncResult.colorIntervals) colorIntervals = syncResult.colorIntervals;
  });

  if (!selectedAccountId) {
    showEmpty();
    return;
  }

  if (selectedAccountId === '__all__') {
    loadAllAccountsHistory();
  } else {
    loadSingleAccountHistory(selectedAccountId);
  }
}

function loadSingleAccountHistory(orgUuid) {
  const logKey = `account:${orgUuid}:usageLog`;
  const latestKey = `account:${orgUuid}:latestUsage`;

  chrome.storage.local.get({ [logKey]: [], [latestKey]: null }, (result) => {
    const log = result[logKey] || [];
    const current = result[latestKey];
    processHistory(log, current);
  });
}

function loadAllAccountsHistory() {
  chrome.storage.local.get(null, (data) => {
    // Merge all usageLogs
    const allLogs = [];
    for (const key of Object.keys(data)) {
      if (key.startsWith('account:') && key.endsWith(':usageLog')) {
        const entries = data[key] || [];
        for (const entry of entries) {
          allLogs.push(entry);
        }
      }
    }

    // Use active account's latestUsage for "current" indicator
    const activeId = data.activeAccountId;
    const activeLatestKey = activeId ? `account:${activeId}:latestUsage` : null;
    const current = activeLatestKey ? data[activeLatestKey] : null;

    processHistory(allLogs, current);
  });
}

function processHistory(log, current) {
  latestUsage = current;

  // Show chart with all data initially
  renderChart(log, current);

  if (log.length === 0) {
    document.getElementById('table-container').innerHTML =
      '<div class="empty-msg">Nenhum registro ainda.<br>O histórico é gravado automaticamente ao final de cada sessão de 5h e ao final de cada semana antes do reset.</div>';
    document.getElementById('stats-summary').classList.add('hidden');
    document.getElementById('pagination').classList.add('hidden');
    return;
  }

  // Sort newest first
  log.sort((a, b) => b.ts - a.ts);
  fullLog = log;

  // Stats
  const sessions = log.map(e => e.session).filter(v => v !== null && v !== undefined);
  const weeklies = log.map(e => e.weekly).filter(v => v !== null && v !== undefined);

  const avgSession = sessions.length > 0
    ? Math.round(sessions.reduce((a, b) => a + b, 0) / sessions.length) : 0;
  const totalSessions = sessions.length;
  const avgWeekly = weeklies.length > 0
    ? Math.round(weeklies.reduce((a, b) => a + b, 0) / weeklies.length) : 0;
  const uniqueWeeks = new Set(log.map(e => e.weeklyResetsAt).filter(Boolean));
  const totalWeeks = uniqueWeeks.size;

  document.getElementById('avg-session').textContent = `${avgSession}%`;
  document.getElementById('avg-session').style.color = resolveColor(avgSession);
  document.getElementById('total-sessions').textContent = totalSessions;
  document.getElementById('avg-weekly').textContent = `${avgWeekly}%`;
  document.getElementById('avg-weekly').style.color = resolveColor(avgWeekly);
  document.getElementById('total-weeks').textContent = totalWeeks;
  document.getElementById('stats-summary').classList.remove('hidden');

  buildDayPages();
  currentPage = 0;
  renderPage();
}

function showEmpty() {
  document.getElementById('table-container').innerHTML =
    '<div class="empty-msg">Nenhum registro ainda.</div>';
  document.getElementById('stats-summary').classList.add('hidden');
  document.getElementById('pagination').classList.add('hidden');
}

// Build pages that never split a day across pages
let pages = [];
function buildDayPages() {
  pages = [];
  if (fullLog.length === 0) return;

  const dayGroups = [];
  let currentDay = null;
  let currentGroup = [];

  for (const entry of fullLog) {
    const date = new Date(entry.ts);
    const dayKey = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    if (dayKey !== currentDay) {
      if (currentGroup.length > 0) dayGroups.push(currentGroup);
      currentGroup = [entry];
      currentDay = dayKey;
    } else {
      currentGroup.push(entry);
    }
  }
  if (currentGroup.length > 0) dayGroups.push(currentGroup);

  const oldestFirst = [...dayGroups].reverse();
  const packedPages = [];
  let currentPageEntries = [];
  let currentBarCount = 0;

  for (const group of oldestFirst) {
    if (currentBarCount > 0 && currentBarCount + group.length > MAX_BARS_PER_PAGE) {
      packedPages.push(currentPageEntries);
      currentPageEntries = [...group];
      currentBarCount = group.length;
    } else {
      currentPageEntries.push(...group);
      currentBarCount += group.length;
    }
  }
  if (currentPageEntries.length > 0) packedPages.push(currentPageEntries);

  pages = packedPages.reverse().map(p => p.sort((a, b) => b.ts - a.ts));
  currentPage = 0;
}

function renderPage() {
  if (pages.length === 0) return;
  const totalPages = pages.length;
  const page = pages[currentPage] || pages[0];

  // Table
  let html = '<table><thead><tr>';
  html += '<th>Hora</th><th>Sessão</th><th>Semanal</th><th>Sonnet</th>';
  html += '</tr></thead><tbody>';

  let lastDay = '';
  for (const entry of page) {
    const date = new Date(entry.ts);
    const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const weekday = date.toLocaleDateString('pt-BR', { weekday: 'long' });
    const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dayKey = dateStr;

    if (dayKey !== lastDay) {
      const capitalWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
      html += `<tr class="day-header"><td colspan="4">${capitalWeekday}, ${dateStr}</td></tr>`;
      lastDay = dayKey;
    }

    html += '<tr>';
    html += `<td style="padding-left:20px">${timeStr}</td>`;
    html += `<td class="pct-cell" style="color:${resolveColor(entry.session)}">${entry.session ?? '—'}%</td>`;
    html += `<td class="pct-cell" style="color:${resolveColor(entry.weekly)}">${entry.weekly ?? '—'}%</td>`;
    html += `<td class="pct-cell" style="color:${resolveColor(entry.sonnet)}">${entry.sonnet != null ? entry.sonnet + '%' : '—'}</td>`;
    html += '</tr>';
  }

  html += '</tbody></table>';
  document.getElementById('table-container').innerHTML = html;

  // Chart
  const includeCurrentOnChart = currentPage === 0;
  renderChart(page, includeCurrentOnChart ? latestUsage : null);

  // Pagination
  const isFirst = currentPage === 0;
  const isLast = currentPage >= totalPages - 1;
  const showPagination = totalPages > 1;
  const pageLabel = `Página ${currentPage + 1} de ${totalPages}`;

  const pagination = document.getElementById('pagination');
  if (showPagination) {
    pagination.classList.remove('hidden');
    document.getElementById('prev-btn').disabled = isFirst;
    document.getElementById('next-btn').disabled = isLast;
    document.getElementById('page-info').textContent = pageLabel;
  } else {
    pagination.classList.add('hidden');
  }

  const chartPag = document.getElementById('chart-pagination');
  if (showPagination) {
    chartPag.classList.remove('hidden');
    document.getElementById('chart-prev').disabled = isFirst;
    document.getElementById('chart-next').disabled = isLast;
    document.getElementById('chart-page-info').textContent = pageLabel;
  } else {
    chartPag.classList.add('hidden');
  }
}

// -- Chart --
function renderChart(log, current) {
  const canvas = document.getElementById('usage-chart');
  const ctx = canvas.getContext('2d');
  const section = document.getElementById('chart-section');

  const byDay = {};
  for (const entry of log) {
    if (entry.session === null || entry.session === undefined) continue;
    const date = new Date(entry.ts);
    const dayKey = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    if (!byDay[dayKey]) byDay[dayKey] = [];
    byDay[dayKey].push({ value: entry.session, isCurrent: false, resetsAt: entry.sessionResetsAt, ts: entry.ts });
  }

  if (current && current.session !== null && current.session !== undefined && !current.error) {
    const currentResetAt = current.sessionResetsAt;
    const THREE_HOURS = 3 * 60 * 60 * 1000;
    const now = new Date();
    const todayKey = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

    if (currentResetAt && byDay[todayKey]) {
      byDay[todayKey] = byDay[todayKey].filter(e => {
        if (!e.resetsAt) return true;
        const diff = Math.abs(new Date(e.resetsAt).getTime() - new Date(currentResetAt).getTime());
        return diff >= THREE_HOURS;
      });
    }

    if (!byDay[todayKey]) byDay[todayKey] = [];
    byDay[todayKey].push({ value: current.session, isCurrent: true, ts: now.getTime() });
  }

  // Sort bars within each day oldest-first
  for (const key of Object.keys(byDay)) {
    byDay[key].sort((a, b) => a.ts - b.ts);
  }

  const days = Object.keys(byDay);
  days.sort((a, b) => {
    const [da, ma] = a.split('/').map(Number);
    const [db, mb] = b.split('/').map(Number);
    if (ma !== mb) return ma - mb;
    return da - db;
  });

  if (days.length < 1) {
    section.classList.remove('hidden');
    document.getElementById('chart-section').querySelector('h2').textContent =
      'Uso por sessão (por dia) — sem dados ainda';
    return;
  }

  section.classList.remove('hidden');

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const padLeft = 44;
  const padRight = 40;
  const padTop = 24;
  const padBottom = 36;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  const dayGroups = days.map(day => ({
    day, entries: byDay[day], hasCurrent: byDay[day].some(e => e.isCurrent)
  }));

  const totalBars = dayGroups.reduce((sum, g) => sum + g.entries.length, 0);
  if (totalBars === 0) return;

  const numGaps = dayGroups.length - 1;
  const innerGap = 2;
  const barWidth = Math.max(6, Math.min(18, chartW / (totalBars + numGaps * 1.2)));
  const gapWidth = barWidth * 1.2;
  const totalInnerGaps = dayGroups.reduce((sum, g) => sum + Math.max(0, g.entries.length - 1), 0);
  const marginLeft = barWidth;
  const startX = padLeft + marginLeft;

  const barPositions = [];
  const groupCenters = [];
  let curX = startX;

  for (const group of dayGroups) {
    const groupStartX = curX;
    for (let i = 0; i < group.entries.length; i++) {
      const entry = group.entries[i];
      barPositions.push({ x: curX + barWidth / 2, value: entry.value, isCurrent: entry.isCurrent });
      curX += barWidth;
      if (i < group.entries.length - 1) curX += innerGap;
    }
    groupCenters.push({ day: group.day, cx: (groupStartX + curX) / 2, hasCurrent: group.hasCurrent });
    curX += gapWidth;
  }

  // Grid
  ctx.strokeStyle = '#2a2a3e';
  ctx.lineWidth = 1;
  for (const pct of [0, 25, 50, 75, 100]) {
    const y = padTop + chartH - (pct / 100) * chartH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.stroke();
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${pct}%`, padLeft - 6, y + 3);
  }

  // Thresholds
  for (const threshold of [50, 70, 90]) {
    const y = padTop + chartH - (threshold / 100) * chartH;
    ctx.strokeStyle = threshold === 50 ? '#FFC10744' : threshold === 70 ? '#FF980044' : '#F4433644';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Bars
  for (const bp of barPositions) {
    const barH = Math.max(2, (bp.value / 100) * chartH);
    const y = padTop + chartH - barH;

    ctx.fillStyle = resolveColor(bp.value);

    if (bp.isCurrent) ctx.globalAlpha = 0.6;
    ctx.beginPath();
    roundedRect(ctx, bp.x - barWidth / 2, y, barWidth, barH, Math.min(3, barWidth / 2));
    ctx.fill();
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = '#ccc';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${bp.value}%`, bp.x, y - 3);
  }

  // Day labels
  ctx.fillStyle = '#888';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  for (const gc of groupCenters) {
    const label = gc.hasCurrent ? `${gc.day} ⏱` : gc.day;
    ctx.fillText(label, gc.cx, H - 8);
  }

  // Legend
  let legend = document.getElementById('chart-legend');
  if (!legend) {
    legend = document.createElement('div');
    legend.id = 'chart-legend';
    legend.style.cssText = 'text-align:right;font-size:10px;color:#555;margin-top:4px;';
    canvas.parentElement.appendChild(legend);
  }
  const hasCurrent = barPositions.some(bp => bp.isCurrent);
  legend.textContent = hasCurrent ? '⏱ = sessão em andamento' : '';
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function resolveColor(pct) {
  if (pct === null || pct === undefined) return '#666';
  let color = colorIntervals[0]?.color || '#4CAF50';
  for (const i of colorIntervals) {
    if (pct >= i.from) color = i.color;
  }
  return color;
}
