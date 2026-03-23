// background.js - Claude Usage Monitor Service Worker

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

const GRAY = '#9E9E9E';

// -- State --
let notifiedThresholds = { session: new Set(), weekly: new Set() };
let lastSessionResetAt = null;
let lastWeeklyResetAt = null;

// -- Init --
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(null, (stored) => {
    if (!stored.pollIntervalMinutes) {
      chrome.storage.sync.set(DEFAULT_SETTINGS);
    }
  });
  setupAlarm();
  fetchUsage();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
  fetchUsage();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pollUsage') {
    fetchUsage();
  }
});

async function setupAlarm() {
  const settings = await getSettings();
  chrome.alarms.create('pollUsage', {
    periodInMinutes: settings.pollIntervalMinutes
  });
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, resolve);
  });
}

// -- Auto-discover org UUID --
async function getOrgUuid() {
  const cached = await new Promise(resolve =>
    chrome.storage.local.get('orgUuid', resolve)
  );
  if (cached.orgUuid) return cached.orgUuid;

  try {
    const resp = await fetch('https://claude.ai/api/organizations', { credentials: 'include' });
    if (!resp.ok) return null;
    const orgs = await resp.json();
    if (orgs.length > 0) {
      const uuid = orgs[0].uuid;
      chrome.storage.local.set({ orgUuid: uuid });
      return uuid;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

// -- Fetch Usage --
async function fetchUsage() {
  const orgUuid = await getOrgUuid();
  if (!orgUuid) {
    setBadgeError();
    saveLatest({ error: 'no_org' });
    return;
  }

  const settings = await getSettings();
  const url = `https://claude.ai/api/organizations/${orgUuid}/usage`;

  try {
    const resp = await fetch(url, { credentials: 'include' });

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        chrome.storage.local.remove('orgUuid');
      }
      setBadgeError();
      saveLatest({ error: resp.status });
      return;
    }

    const data = await resp.json();
    const usage = parseUsage(data);

    saveLatest(usage);
    updateBadge(usage, settings);
    checkAlerts(usage, settings);
    maybeLogUsage(usage, settings);
  } catch (err) {
    setBadgeError();
    saveLatest({ error: err.message });
  }
}

function parseUsage(data) {
  return {
    session: data.five_hour?.utilization ?? null,
    sessionResetsAt: data.five_hour?.resets_at ?? null,
    weekly: data.seven_day?.utilization ?? null,
    weeklyResetsAt: data.seven_day?.resets_at ?? null,
    sonnet: data.seven_day_sonnet?.utilization ?? null,
    sonnetResetsAt: data.seven_day_sonnet?.resets_at ?? null,
    fetchedAt: Date.now()
  };
}

// -- Color Resolution --
function resolveColor(pct, intervals) {
  if (!intervals || intervals.length === 0) intervals = DEFAULT_INTERVALS;
  let color = intervals[0]?.color || '#4CAF50';
  for (const i of intervals) {
    if (pct >= i.from) color = i.color;
  }
  return color;
}

// -- Badge --
function updateBadge(usage, settings) {
  const pct = usage.session;
  if (pct === null) {
    setBadgeError();
    return;
  }

  const color = resolveColor(pct, settings.colorIntervals);
  chrome.action.setBadgeText({ text: String(pct) });
  chrome.action.setBadgeBackgroundColor({ color });
}

function setBadgeError() {
  chrome.action.setBadgeText({ text: '?' });
  chrome.action.setBadgeBackgroundColor({ color: GRAY });
}

// -- Alerts (Notifications) --
function checkAlerts(usage, settings) {
  if (!settings.notificationsEnabled) return;

  const alerts = settings.alerts || DEFAULT_ALERTS;

  // Reset cycle detection
  if (usage.sessionResetsAt !== lastSessionResetAt) {
    notifiedThresholds.session.clear();
    lastSessionResetAt = usage.sessionResetsAt;
  }
  if (usage.weeklyResetsAt !== lastWeeklyResetAt) {
    notifiedThresholds.weekly.clear();
    lastWeeklyResetAt = usage.weeklyResetsAt;
  }

  // Session alerts
  for (const threshold of alerts) {
    if (usage.session >= threshold && !notifiedThresholds.session.has(threshold)) {
      notifiedThresholds.session.add(threshold);
      const resetIn = formatTimeUntil(usage.sessionResetsAt);
      fireNotification(
        `session-${threshold}-${Date.now()}`,
        `Claude: Sessão em ${usage.session}%`,
        `Limite de sessão atingiu ${threshold}%. Reseta em ${resetIn}.`
      );
    }
  }

  // Weekly alerts
  for (const threshold of alerts) {
    if (usage.weekly >= threshold && !notifiedThresholds.weekly.has(threshold)) {
      notifiedThresholds.weekly.add(threshold);
      const resetIn = formatTimeUntil(usage.weeklyResetsAt);
      fireNotification(
        `weekly-${threshold}-${Date.now()}`,
        `Claude: Semanal em ${usage.weekly}%`,
        `Limite semanal atingiu ${threshold}%. Reseta em ${resetIn}.`
      );
    }
  }
}

function fireNotification(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title,
    message,
    priority: 2
  });
}

// -- Time Formatting --
function formatTimeUntil(isoString) {
  if (!isoString) return '—';
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

// -- Storage: Latest (for popup) --
function saveLatest(usage) {
  chrome.storage.local.set({ latestUsage: usage });
}

// -- Storage: Usage Log --
async function maybeLogUsage(usage, settings) {
  if (!usage.sessionResetsAt) return;

  const now = Date.now();
  const resetsAt = new Date(usage.sessionResetsAt).getTime();
  const timeUntilResetMs = resetsAt - now;
  const pollIntervalMs = settings.pollIntervalMinutes * 60 * 1000;

  if (timeUntilResetMs > pollIntervalMs || timeUntilResetMs <= 0) return;

  const result = await new Promise(resolve =>
    chrome.storage.local.get({ usageLog: [], lastLoggedResetAt: null }, resolve)
  );

  if (result.lastLoggedResetAt === usage.sessionResetsAt) return;

  const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  const log = result.usageLog;

  log.push({
    ts: now,
    session: usage.session,
    weekly: usage.weekly,
    sonnet: usage.sonnet,
    sessionResetsAt: usage.sessionResetsAt,
    weeklyResetsAt: usage.weeklyResetsAt
  });

  const pruned = log.filter(entry => (now - entry.ts) < MAX_AGE_MS);

  chrome.storage.local.set({
    usageLog: pruned,
    lastLoggedResetAt: usage.sessionResetsAt
  });
}

// -- Listen for settings changes --
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.pollIntervalMinutes) {
    setupAlarm();
  }
});

// -- Listen for messages --
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'refreshUsage') {
    fetchUsage().then(() => sendResponse());
    return true;
  }
  if (msg.action === 'injectTestData') {
    chrome.storage.local.set({ usageLog: msg.data }, () => sendResponse('ok'));
    return true;
  }
});
