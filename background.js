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

// -- State is persisted in chrome.storage.local to survive SW restarts --

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

const CRITICAL_THRESHOLD = 95;
const CRITICAL_POLL_MINUTES = 1;

async function setupAlarm(overrideMinutes) {
  const settings = await getSettings();
  const minutes = overrideMinutes || settings.pollIntervalMinutes;
  chrome.alarms.create('pollUsage', {
    periodInMinutes: minutes
  });
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, resolve);
  });
}

// -- Fetch helper with explicit cookies (Edge/Chromium compatibility) --
async function fetchWithCookies(url) {
  // First try credentials: 'include' (works in Chrome)
  // If that fails with 401/403, fallback to explicit cookie header (Edge)
  const cookies = await chrome.cookies.getAll({ domain: 'claude.ai' });
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  return fetch(url, {
    credentials: 'include',
    headers: cookieHeader ? { 'Cookie': cookieHeader } : {}
  });
}

// -- Auto-discover org UUID --
async function getOrgUuid() {
  const cached = await new Promise(resolve =>
    chrome.storage.local.get('orgUuid', resolve)
  );
  if (cached.orgUuid) return cached.orgUuid;

  try {
    const resp = await fetchWithCookies('https://claude.ai/api/organizations');
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
    const resp = await fetchWithCookies(url);

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
    await checkAlerts(usage, settings);
    maybeLogUsage(usage, settings);

    // Turbo mode: poll every 1 min when session >= 95%
    const isCritical = usage.session !== null && usage.session >= CRITICAL_THRESHOLD;
    const currentInterval = isCritical ? CRITICAL_POLL_MINUTES : settings.pollIntervalMinutes;
    const stored = await new Promise(r => chrome.storage.local.get('currentPollMinutes', r));
    if (stored.currentPollMinutes !== currentInterval) {
      await setupAlarm(currentInterval);
      chrome.storage.local.set({ currentPollMinutes: currentInterval });
    }
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
// State is persisted in chrome.storage.local so it survives SW restarts
async function loadNotifiedState() {
  return new Promise((resolve) => {
    chrome.storage.local.get('notifiedState', (result) => {
      resolve(result.notifiedState || {
        sessionNotified: [],
        weeklyNotified: [],
        lastSessionResetAt: null,
        lastWeeklyResetAt: null
      });
    });
  });
}

async function saveNotifiedState(state) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ notifiedState: state }, resolve);
  });
}

async function checkAlerts(usage, settings) {
  if (!settings.notificationsEnabled) return;

  const alerts = settings.alerts || DEFAULT_ALERTS;
  const state = await loadNotifiedState();
  let changed = false;

  // Reset cycle detection - clear flags when resets_at changes
  if (usage.sessionResetsAt && usage.sessionResetsAt !== state.lastSessionResetAt) {
    state.sessionNotified = [];
    state.lastSessionResetAt = usage.sessionResetsAt;
    changed = true;
  }
  if (usage.weeklyResetsAt && usage.weeklyResetsAt !== state.lastWeeklyResetAt) {
    state.weeklyNotified = [];
    state.lastWeeklyResetAt = usage.weeklyResetsAt;
    changed = true;
  }

  // Session alerts
  for (const threshold of alerts) {
    if (usage.session >= threshold && !state.sessionNotified.includes(threshold)) {
      state.sessionNotified.push(threshold);
      changed = true;
      const resetIn = formatTimeUntil(usage.sessionResetsAt);
      fireNotification(
        `session-${threshold}`,
        `Claude Monitor: Sessão atingiu ${threshold}%`,
        `Uso atual: ${usage.session}%. Reseta em ${resetIn}.`
      );
    }
  }

  // Weekly alerts
  for (const threshold of alerts) {
    if (usage.weekly >= threshold && !state.weeklyNotified.includes(threshold)) {
      state.weeklyNotified.push(threshold);
      changed = true;
      const resetIn = formatTimeUntil(usage.weeklyResetsAt);
      fireNotification(
        `weekly-${threshold}`,
        `Claude Monitor: Semanal atingiu ${threshold}%`,
        `Uso atual: ${usage.weekly}%. Reseta em ${resetIn}.`
      );
    }
  }

  if (changed) {
    await saveNotifiedState(state);
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
// Two capture strategies combined:
// 1. When resets_at changes (new session detected), log the previous session's final snapshot
// 2. Fallback: when within 5 min of reset, log once per session (in case SW misses the transition)
// The previousSession is updated every poll but ONLY pushed to usageLog on session change.
async function maybeLogUsage(usage, settings) {
  if (!usage.sessionResetsAt) return;

  const now = Date.now();
  const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

  const result = await new Promise(resolve =>
    chrome.storage.local.get({
      usageLog: [],
      previousSession: null,
      lastTrackedResetAt: null,
      lastLoggedResetAt: null
    }, resolve)
  );

  const log = result.usageLog;
  const prevResetAt = result.lastTrackedResetAt;
  let shouldSave = false;

  // Strategy 1: Detect session change — log the PREVIOUS session's final values
  if (prevResetAt && prevResetAt !== usage.sessionResetsAt && result.previousSession) {
    log.push({
      ts: result.previousSession.ts,
      session: result.previousSession.session,
      weekly: result.previousSession.weekly,
      sonnet: result.previousSession.sonnet,
      sessionResetsAt: prevResetAt,
      weeklyResetsAt: result.previousSession.weeklyResetsAt
    });
    shouldSave = true;
  }

  // Strategy 2: Fallback — within 5 min of reset, log once if not already logged
  const resetsAt = new Date(usage.sessionResetsAt).getTime();
  const timeUntilResetMs = resetsAt - now;
  if (timeUntilResetMs > 0 && timeUntilResetMs <= 5 * 60 * 1000
      && result.lastLoggedResetAt !== usage.sessionResetsAt) {
    log.push({
      ts: now,
      session: usage.session,
      weekly: usage.weekly,
      sonnet: usage.sonnet,
      sessionResetsAt: usage.sessionResetsAt,
      weeklyResetsAt: usage.weeklyResetsAt
    });
    shouldSave = true;
  }

  // Always update the snapshot (no push to log — just overwrites in storage)
  const currentSnapshot = {
    ts: now,
    session: usage.session,
    weekly: usage.weekly,
    sonnet: usage.sonnet,
    weeklyResetsAt: usage.weeklyResetsAt
  };

  // Prune old entries
  const pruned = shouldSave ? log.filter(entry => (now - entry.ts) < MAX_AGE_MS) : result.usageLog;

  chrome.storage.local.set({
    usageLog: pruned,
    previousSession: currentSnapshot,
    lastTrackedResetAt: usage.sessionResetsAt,
    lastLoggedResetAt: shouldSave ? usage.sessionResetsAt : result.lastLoggedResetAt
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
  if (msg.action === 'clearUsageLog') {
    chrome.storage.local.set({
      usageLog: [],
      previousSession: null,
      lastTrackedResetAt: null,
      lastLoggedResetAt: null
    }, () => sendResponse('ok'));
    return true;
  }
});
