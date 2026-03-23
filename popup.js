// popup.js

document.addEventListener('DOMContentLoaded', () => {
  loadUsage();

  document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('history-btn').addEventListener('click', async () => {
    const url = chrome.runtime.getURL('history.html');
    const tabs = await chrome.tabs.query({ url });
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url });
    }
  });

  document.getElementById('refresh-btn').addEventListener('click', () => {
    const btn = document.getElementById('refresh-btn');
    btn.style.opacity = '0.3';
    btn.disabled = true;

    chrome.runtime.sendMessage({ action: 'refreshUsage' }, () => {
      setTimeout(() => {
        loadUsage();
        btn.style.opacity = '0.7';
        btn.disabled = false;
      }, 1500);
    });
  });

  // Login screen buttons
  document.getElementById('login-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://claude.ai' });
  });

  document.getElementById('login-retry').addEventListener('click', () => {
    const btn = document.getElementById('login-retry');
    btn.textContent = 'Verificando...';
    btn.disabled = true;

    // Force re-fetch: clear cached org so it re-discovers
    chrome.storage.local.remove('orgUuid', () => {
      chrome.runtime.sendMessage({ action: 'refreshUsage' }, () => {
        setTimeout(() => {
          loadUsage();
          btn.textContent = 'Já fiz login — verificar';
          btn.disabled = false;
        }, 2000);
      });
    });
  });
});

function loadUsage() {
  chrome.storage.local.get('latestUsage', (localResult) => {
    const usage = localResult.latestUsage;

    // Check if not logged in
    if (!usage || usage.error === 401 || usage.error === 403 || usage.error === 'no_org') {
      showLoginScreen();
      return;
    }

    if (usage.error) {
      showContentScreen();
      showError(usage.error);
      return;
    }

    showContentScreen();
    hideError();

    chrome.storage.sync.get({ colorIntervals: null, showSonnet: false }, (settings) => {
      const intervals = settings.colorIntervals || [
        { from: 0, color: '#4CAF50' }, { from: 50, color: '#FFC107' },
        { from: 70, color: '#FF9800' }, { from: 90, color: '#F44336' }
      ];
      renderSection('session', usage.session, usage.sessionResetsAt, intervals);
      renderSection('weekly', usage.weekly, usage.weeklyResetsAt, intervals);
      renderLastUpdated(usage.fetchedAt);

      const sonnetSection = document.getElementById('sonnet-section');
      if (settings.showSonnet && usage.sonnet !== null && usage.sonnet !== undefined) {
        sonnetSection.classList.remove('hidden');
        renderSection('sonnet', usage.sonnet, usage.sonnetResetsAt, intervals);
      } else {
        sonnetSection.classList.add('hidden');
      }
    });
  });
}

function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('content').classList.add('hidden');
  document.querySelector('.footer').classList.add('hidden');
}

function showContentScreen() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');
  document.querySelector('.footer').classList.remove('hidden');
}

function renderSection(prefix, pct, resetsAt, intervals) {
  const bar = document.getElementById(`${prefix}-bar`);
  const pctEl = document.getElementById(`${prefix}-pct`);
  const resetEl = document.getElementById(`${prefix}-reset`);

  if (pct === null || pct === undefined) {
    pctEl.textContent = '—';
    resetEl.textContent = '';
    bar.style.width = '0%';
    return;
  }

  pctEl.textContent = `${pct}%`;
  bar.style.width = `${pct}%`;

  const color = resolveColor(pct, intervals);
  bar.className = 'bar';
  bar.style.background = color;
  pctEl.style.color = color;

  resetEl.textContent = resetsAt ? `Reseta em ${formatTimeUntil(resetsAt)}` : '';
}

function resolveColor(pct, intervals) {
  if (!intervals || intervals.length === 0) return '#4CAF50';
  let color = intervals[0]?.color || '#4CAF50';
  for (const i of intervals) {
    if (pct >= i.from) color = i.color;
  }
  return color;
}

function renderLastUpdated(fetchedAt) {
  if (!fetchedAt) return;
  const el = document.getElementById('last-updated');
  const diff = Date.now() - fetchedAt;
  const mins = Math.floor(diff / 60000);

  if (mins < 1) el.textContent = 'Atualizado agora';
  else if (mins === 1) el.textContent = 'Atualizado há 1 min';
  else el.textContent = `Atualizado há ${mins} min`;
}

function formatTimeUntil(isoString) {
  const now = Date.now();
  const target = new Date(isoString).getTime();
  const diffMs = target - now;

  if (diffMs <= 0) return 'agora';

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

function showError(err) {
  const el = document.getElementById('error-msg');
  el.textContent = 'Erro ao buscar dados. Tentando novamente...';
  el.classList.remove('hidden');
}

function hideError() {
  document.getElementById('error-msg').classList.add('hidden');
}
