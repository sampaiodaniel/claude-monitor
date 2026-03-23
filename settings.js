// settings.js

const COLOR_PALETTE = [
  { name: 'Verde',    hex: '#4CAF50' },
  { name: 'Amarelo',  hex: '#FFC107' },
  { name: 'Laranja',  hex: '#FF9800' },
  { name: 'Vermelho', hex: '#F44336' },
  { name: 'Azul',     hex: '#2196F3' },
  { name: 'Roxo',     hex: '#9C27B0' },
  { name: 'Rosa',     hex: '#E91E63' },
  { name: 'Ciano',    hex: '#00BCD4' },
];

const DEFAULT_INTERVALS = [
  { from: 0,  color: '#4CAF50' },
  { from: 50, color: '#FFC107' },
  { from: 70, color: '#FF9800' },
  { from: 90, color: '#F44336' },
];

const DEFAULT_ALERTS = [50, 70, 90];

const DEFAULT_SETTINGS = {
  pollIntervalMinutes: 5,
  colorIntervals: DEFAULT_INTERVALS,
  alerts: DEFAULT_ALERTS,
  notificationsEnabled: true,
  showSonnet: false
};

let colorIntervals = [];
let alerts = [];
let selectedColor = '#FFC107';

// Track history tab to reuse
let historyTabId = null;

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  renderColorPicker();

  document.getElementById('save-btn').addEventListener('click', saveSettings);

  document.getElementById('history-btn').addEventListener('click', openHistory);

  // Interval slider preview
  document.getElementById('new-interval-value').addEventListener('input', (e) => {
    document.getElementById('new-interval-value-display').textContent = `${e.target.value}%`;
  });

  // Add interval
  document.getElementById('add-interval-btn').addEventListener('click', () => {
    const val = parseInt(document.getElementById('new-interval-value').value, 10);
    const existing = colorIntervals.findIndex(i => i.from === val);
    if (existing >= 0) {
      // Replace color of existing interval
      colorIntervals[existing].color = selectedColor;
    } else {
      colorIntervals.push({ from: val, color: selectedColor });
    }
    colorIntervals.sort((a, b) => a.from - b.from);
    renderIntervals();
  });

  // Reset intervals to default
  document.getElementById('reset-intervals-btn').addEventListener('click', () => {
    colorIntervals = JSON.parse(JSON.stringify(DEFAULT_INTERVALS));
    renderIntervals();
  });

  // Alert slider preview
  document.getElementById('new-alert').addEventListener('input', (e) => {
    document.getElementById('new-alert-display').textContent = `${e.target.value}%`;
  });

  // Add alert
  document.getElementById('add-alert-btn').addEventListener('click', () => {
    const val = parseInt(document.getElementById('new-alert').value, 10);
    if (!alerts.includes(val)) {
      alerts.push(val);
      alerts.sort((a, b) => a - b);
      renderAlerts();
    }
  });

  // Polling slider preview
  document.getElementById('pollIntervalMinutes').addEventListener('input', (e) => {
    document.getElementById('poll-value').textContent = `${e.target.value} min`;
  });
});

// -- Open history (reuse tab) --
async function openHistory() {
  const historyUrl = chrome.runtime.getURL('history.html');

  // Check if we have a stored tab that's still open
  if (historyTabId !== null) {
    try {
      const tab = await chrome.tabs.get(historyTabId);
      if (tab && tab.url && tab.url.startsWith(historyUrl)) {
        chrome.tabs.update(historyTabId, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
        return;
      }
    } catch (e) {
      // Tab no longer exists
    }
  }

  // Search all tabs for an existing history page
  const tabs = await chrome.tabs.query({ url: historyUrl });
  if (tabs.length > 0) {
    historyTabId = tabs[0].id;
    chrome.tabs.update(tabs[0].id, { active: true });
    chrome.windows.update(tabs[0].windowId, { focused: true });
    return;
  }

  // Open new tab
  const newTab = await chrome.tabs.create({ url: historyUrl });
  historyTabId = newTab.id;
}

// -- Load --
function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    document.getElementById('pollIntervalMinutes').value = settings.pollIntervalMinutes;
    document.getElementById('poll-value').textContent = `${settings.pollIntervalMinutes} min`;
    document.getElementById('notificationsEnabled').checked = settings.notificationsEnabled;
    document.getElementById('showSonnet').checked = settings.showSonnet;

    // Migrate old format
    if (settings.colorIntervals) {
      colorIntervals = [...settings.colorIntervals];
    } else if (settings.thresholds) {
      // Migrate from old thresholds format
      colorIntervals = JSON.parse(JSON.stringify(DEFAULT_INTERVALS));
    }

    if (settings.alerts) {
      alerts = [...settings.alerts];
    } else if (settings.thresholds) {
      // Migrate: extract values from old thresholds
      alerts = Array.isArray(settings.thresholds)
        ? settings.thresholds.map(t => typeof t === 'number' ? t : t.value)
        : DEFAULT_ALERTS;
    }

    renderIntervals();
    renderAlerts();
  });
}

// -- Color Picker --
function renderColorPicker() {
  const container = document.getElementById('color-picker');
  container.innerHTML = '';
  for (const c of COLOR_PALETTE) {
    const swatch = document.createElement('button');
    swatch.className = 'color-swatch' + (c.hex === selectedColor ? ' selected' : '');
    swatch.style.background = c.hex;
    swatch.title = c.name;
    swatch.addEventListener('click', () => {
      selectedColor = c.hex;
      renderColorPicker();
    });
    container.appendChild(swatch);
  }
}

// -- Intervals --
function renderIntervals() {
  const container = document.getElementById('intervals-list');
  container.innerHTML = '';

  for (let i = 0; i < colorIntervals.length; i++) {
    const interval = colorIntervals[i];
    const nextFrom = i < colorIntervals.length - 1 ? colorIntervals[i + 1].from : 100;

    const row = document.createElement('div');
    row.className = 'interval-row';

    const dot = document.createElement('span');
    dot.className = 'interval-color-dot';
    dot.style.background = interval.color;

    const range = document.createElement('span');
    range.className = 'interval-range';
    range.innerHTML = `<strong>${interval.from}%</strong> — <strong>${nextFrom}%</strong>`;

    const preview = document.createElement('span');
    preview.className = 'interval-preview';
    preview.style.background = interval.color;

    row.appendChild(dot);
    row.appendChild(range);
    row.appendChild(preview);

    // Don't allow removing the 0% interval
    if (interval.from > 0) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'interval-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        colorIntervals = colorIntervals.filter((_, idx) => idx !== i);
        renderIntervals();
      });
      row.appendChild(removeBtn);
    }

    container.appendChild(row);
  }
}

// -- Alerts --
function renderAlerts() {
  const container = document.getElementById('alert-chips');
  container.innerHTML = '';

  for (const val of alerts) {
    const chip = document.createElement('span');
    chip.className = 'alert-chip';
    chip.innerHTML = `🔔 ${val}% <button class="alert-chip-remove" data-val="${val}">×</button>`;
    container.appendChild(chip);
  }

  container.querySelectorAll('.alert-chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const val = parseInt(e.target.dataset.val, 10);
      alerts = alerts.filter(a => a !== val);
      renderAlerts();
    });
  });
}

// -- Save --
function saveSettings() {
  const settings = {
    pollIntervalMinutes: parseInt(document.getElementById('pollIntervalMinutes').value, 10) || 5,
    colorIntervals: colorIntervals.length > 0 ? colorIntervals : DEFAULT_INTERVALS,
    alerts: alerts.length > 0 ? alerts : DEFAULT_ALERTS,
    notificationsEnabled: document.getElementById('notificationsEnabled').checked,
    showSonnet: document.getElementById('showSonnet').checked
  };

  chrome.storage.sync.set(settings, () => {
    const msg = document.getElementById('status-msg');
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 2500);
  });
}
