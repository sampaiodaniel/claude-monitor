// background.js - Claude Usage Monitor Service Worker (Multi-Account)

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
const CRITICAL_THRESHOLD = 95;
const CRITICAL_POLL_MINUTES = 1;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// -- Passive org detection via webRequest --
// Monitors API calls from claude.ai to detect which org the user is actually using.
// This is the most reliable method: we see the real org UUID in every API call.
const ORG_URL_REGEX = /claude\.ai\/api\/organizations\/([0-9a-f-]{36})\//;
let lastDetectedOrgUuid = null;

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Only care about requests from claude.ai tabs (not our own extension fetches)
    if (details.tabId < 0) return; // -1 = service worker / extension

    const match = details.url.match(ORG_URL_REGEX);
    if (!match) return;

    const detectedUuid = match[1];
    if (detectedUuid === lastDetectedOrgUuid) return; // no change

    lastDetectedOrgUuid = detectedUuid;
    console.log('[CM] webRequest detected active org:', detectedUuid);

    // Update active account if it differs
    chrome.storage.local.get(['activeAccountId', 'accounts'], (state) => {
      if (state.activeAccountId === detectedUuid) return;

      console.log('[CM] Switching active account:', state.activeAccountId, '→', detectedUuid);

      // Ensure accounts entry exists
      const accounts = state.accounts || {};
      if (!accounts[detectedUuid]) {
        accounts[detectedUuid] = {
          orgUuid: detectedUuid,
          orgName: '',
          customLabel: '',
          firstSeen: Date.now(),
          lastSeen: Date.now()
        };
      }

      chrome.storage.local.set({
        activeAccountId: detectedUuid,
        accounts
      }, () => {
        // Immediately fetch usage for the new active account
        fetchUsage();
      });
    });
  },
  { urls: ['https://claude.ai/api/organizations/*'] }
);

// -- Namespaced storage helpers --
function accountKey(orgUuid, key) {
  return `account:${orgUuid}:${key}`;
}

async function getLocal(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

async function setLocal(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// -- Migration from single-account to multi-account --
async function migrateToMultiAccount() {
  const data = await getLocal(null);
  console.log('[CM] Migration check — accounts exists:', !!data.accounts, 'orgUuid exists:', !!data.orgUuid);

  // Already migrated?
  if (data.accounts) return;

  const orgUuid = data.orgUuid;
  if (!orgUuid) {
    // No existing data, initialize empty
    await setLocal({ accounts: {}, activeAccountId: null });
    return;
  }

  // Build account entry from existing data
  const accounts = {
    [orgUuid]: {
      orgUuid,
      orgName: '',
      customLabel: '',
      firstSeen: data.usageLog?.[0]?.ts || Date.now(),
      lastSeen: data.latestUsage?.fetchedAt || Date.now()
    }
  };

  // Namespace existing data under the account
  const migrated = {
    accounts,
    activeAccountId: orgUuid,
    [accountKey(orgUuid, 'latestUsage')]: data.latestUsage || null,
    [accountKey(orgUuid, 'usageLog')]: data.usageLog || [],
    [accountKey(orgUuid, 'previousSession')]: data.previousSession || null,
    [accountKey(orgUuid, 'lastTrackedResetAt')]: data.lastTrackedResetAt || null,
    [accountKey(orgUuid, 'notifiedState')]: data.notifiedState || null,
  };

  // Also keep global latestUsage for backward compat with popup quick read
  migrated.latestUsage = data.latestUsage || null;

  await setLocal(migrated);

  // Remove old flat keys
  await new Promise(resolve =>
    chrome.storage.local.remove([
      'orgUuid', 'previousSession', 'lastTrackedResetAt',
      'notifiedState', 'lastLoggedResetAt', 'lastLoggedResetAt'
    ], resolve)
  );
}

// -- Init --
chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.sync.get(null, (stored) => {
    if (!stored.pollIntervalMinutes) {
      chrome.storage.sync.set(DEFAULT_SETTINGS);
    }
  });
  await migrateToMultiAccount();
  setupAlarm();
  fetchUsage();
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateToMultiAccount();
  setupAlarm();
  fetchUsage();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pollUsage') {
    fetchUsage();
  }
});

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
  const cookies = await chrome.cookies.getAll({ domain: 'claude.ai' });
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  return fetch(url, {
    credentials: 'include',
    headers: cookieHeader ? { 'Cookie': cookieHeader } : {}
  });
}

// -- Detect active account --
// Priority: webRequest-detected org > cached activeAccountId > org probe
// Returns { uuid, orgName, authFailed }
async function detectActiveAccount() {
  const state = await getLocal(['accounts', 'activeAccountId', 'usableOrgUuid']);
  const cachedId = state.activeAccountId;

  // If webRequest already detected the active org, trust it
  if (lastDetectedOrgUuid && lastDetectedOrgUuid !== cachedId) {
    console.log('[CM] Using webRequest-detected org:', lastDetectedOrgUuid);
    return { uuid: lastDetectedOrgUuid, authFailed: false };
  }
  if (cachedId && lastDetectedOrgUuid === cachedId) {
    return { uuid: cachedId, authFailed: false };
  }

  try {
    const resp = await fetchWithCookies('https://claude.ai/api/organizations');
    console.log('[CM] /organizations status:', resp.status);

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        console.log('[CM] Auth failed, need login');
        return { uuid: null, authFailed: true };
      }
      console.log('[CM] API error, using cache:', cachedId);
      return { uuid: cachedUsable || cachedId || null, authFailed: false };
    }

    const orgs = await resp.json();
    console.log('[CM] Orgs:', orgs.map(o => `${o.name}(${o.uuid.slice(0,8)})`).join(', '));

    if (!orgs || orgs.length === 0) {
      return { uuid: cachedUsable || cachedId || null, authFailed: false };
    }

    // Prioritize orgs: Teams/raven with "chat" > personal with "chat" > API-only
    // This ensures the active chat org is selected, not an API-only org
    const orderedOrgs = [...orgs].sort((a, b) => {
      const aChat = (a.capabilities || []).includes('chat');
      const bChat = (b.capabilities || []).includes('chat');
      const aRaven = a.raven_type === 'team';
      const bRaven = b.raven_type === 'team';

      // Teams (raven) with chat first
      if (aRaven && aChat && !(bRaven && bChat)) return -1;
      if (bRaven && bChat && !(aRaven && aChat)) return 1;
      // Then any chat org
      if (aChat && !bChat) return -1;
      if (bChat && !aChat) return 1;
      return 0;
    });

    // If we have a cached usable org, try it first (but after priority sort)
    if (cachedUsable) {
      const idx = orderedOrgs.findIndex(o => o.uuid === cachedUsable);
      // Only promote cached if it's a chat org (don't promote API-only)
      if (idx > 0) {
        const cached = orderedOrgs[idx];
        if ((cached.capabilities || []).includes('chat')) {
          const [hit] = orderedOrgs.splice(idx, 1);
          orderedOrgs.unshift(hit);
        }
      }
    }

    console.log('[CM] Org priority:', orderedOrgs.map(o =>
      `${o.name}(${o.uuid.slice(0,8)}) caps=${(o.capabilities||[]).join(',')} raven=${o.raven_type||'none'}`
    ).join(' → '));

    let usableOrg = null;
    for (const org of orderedOrgs) {
      const usageResp = await fetchWithCookies(
        `https://claude.ai/api/organizations/${org.uuid}/usage`
      );
      console.log('[CM] Probe /usage for', org.name, `(${org.uuid.slice(0,8)})`, '→', usageResp.status);
      if (usageResp.ok) {
        usableOrg = org;
        break;
      }
    }

    if (!usableOrg) {
      console.log('[CM] No org returned 200 for /usage');
      // All orgs returned 403 — use cached if available
      return { uuid: cachedUsable || cachedId || null, authFailed: false };
    }

    const uuid = usableOrg.uuid;
    const orgName = usableOrg.name || '';
    console.log('[CM] Usable org:', orgName, uuid.slice(0, 8));

    const accounts = state.accounts || {};

    // Upsert account in registry
    if (!accounts[uuid]) {
      accounts[uuid] = {
        orgUuid: uuid,
        orgName,
        customLabel: '',
        firstSeen: Date.now(),
        lastSeen: Date.now()
      };
    } else {
      accounts[uuid].orgName = orgName;
      accounts[uuid].lastSeen = Date.now();
    }

    // Detect account switch
    if (cachedId && cachedId !== uuid) {
      console.log('[CM] Account switch detected:', cachedId, '->', uuid);
      await handleAccountSwitch(cachedId, uuid);
    }

    await setLocal({ accounts, activeAccountId: uuid, usableOrgUuid: uuid });
    return { uuid, authFailed: false };
  } catch (e) {
    console.error('[CM] detectActiveAccount error:', e.message);
    return { uuid: cachedUsable || cachedId || null, authFailed: false };
  }
}

// -- Handle account switch: commit old session, update active --
async function handleAccountSwitch(oldId, newId) {
  const prevKey = accountKey(oldId, 'previousSession');
  const logKey = accountKey(oldId, 'usageLog');
  const resetKey = accountKey(oldId, 'lastTrackedResetAt');

  const oldData = await getLocal([prevKey, logKey, resetKey]);
  const prevSession = oldData[prevKey];
  const log = oldData[logKey] || [];
  const lastReset = oldData[resetKey];

  if (prevSession && lastReset) {
    log.push({
      ts: prevSession.ts,
      session: prevSession.session,
      weekly: prevSession.weekly,
      sonnet: prevSession.sonnet,
      sessionResetsAt: lastReset,
      weeklyResetsAt: prevSession.weeklyResetsAt
    });

    const now = Date.now();
    const pruned = log.filter(entry => (now - entry.ts) < MAX_AGE_MS);
    await setLocal({
      [logKey]: pruned,
      [prevKey]: null,
      [resetKey]: null
    });
  }
}

// -- Get account display name --
async function getAccountDisplayName(orgUuid) {
  const data = await getLocal('accounts');
  const accounts = data.accounts || {};
  const acct = accounts[orgUuid];
  if (!acct) return '';
  return acct.customLabel || acct.orgName || '';
}

// -- Fetch Usage --
async function fetchUsage() {
  console.log('[CM] fetchUsage() starting...');
  const detected = await detectActiveAccount();
  console.log('[CM] detectActiveAccount result:', JSON.stringify(detected));

  // Auth truly failed (401/403 from /organizations) — show login
  if (detected.authFailed) {
    console.log('[CM] Auth failed, showing login');
    setBadgeError();
    saveLatest({ error: 'no_org' }, null);
    return;
  }

  // No account at all (never logged in)
  if (!detected.uuid) {
    console.log('[CM] No uuid at all, showing login');
    setBadgeError();
    saveLatest({ error: 'no_org' }, null);
    return;
  }

  const orgUuid = detected.uuid;
  const settings = await getSettings();
  const url = `https://claude.ai/api/organizations/${orgUuid}/usage`;
  console.log('[CM] Fetching usage for:', orgUuid);

  try {
    const resp = await fetchWithCookies(url);
    console.log('[CM] Usage API status:', resp.status);

    if (!resp.ok) {
      // detectActiveAccount already probed /usage, so this shouldn't happen often.
      // If it does (race condition, session expired mid-request), just show error badge
      // but DON'T clear activeAccountId — the account is still valid.
      console.log('[CM] Usage fetch failed:', resp.status);
      if (resp.status === 401 || resp.status === 403) {
        // Clear usableOrgUuid so next poll re-probes all orgs
        await setLocal({ usableOrgUuid: null });
      }
      setBadgeError();
      return;
    }

    const data = await resp.json();
    const usage = parseUsage(data);
    console.log('[CM] Usage parsed:', JSON.stringify(usage));

    saveLatest(usage, orgUuid);
    updateBadge(usage, settings);
    await checkAlerts(usage, settings, orgUuid);
    await maybeLogUsage(usage, settings, orgUuid);

    // Turbo mode: poll every 1 min when session >= 95%
    const isCritical = usage.session !== null && usage.session >= CRITICAL_THRESHOLD;
    const currentInterval = isCritical ? CRITICAL_POLL_MINUTES : settings.pollIntervalMinutes;
    const stored = await getLocal('currentPollMinutes');
    if (stored.currentPollMinutes !== currentInterval) {
      await setupAlarm(currentInterval);
      await setLocal({ currentPollMinutes: currentInterval });
    }
  } catch (err) {
    // Network error — don't overwrite valid cached data
    setBadgeError();
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

// -- Alerts (Notifications) -- namespaced per account --
async function loadNotifiedState(orgUuid) {
  const key = accountKey(orgUuid, 'notifiedState');
  const result = await getLocal(key);
  return result[key] || {
    sessionNotified: [],
    weeklyNotified: [],
    lastSessionResetAt: null,
    lastWeeklyResetAt: null
  };
}

async function saveNotifiedState(orgUuid, state) {
  const key = accountKey(orgUuid, 'notifiedState');
  await setLocal({ [key]: state });
}

async function checkAlerts(usage, settings, orgUuid) {
  if (!settings.notificationsEnabled) return;

  const alerts = settings.alerts || DEFAULT_ALERTS;
  const state = await loadNotifiedState(orgUuid);
  let changed = false;

  // Account name prefix for notifications
  const accountName = await getAccountDisplayName(orgUuid);
  const prefix = accountName ? `[${accountName}] ` : '';

  // Reset cycle detection
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
        `session-${threshold}-${orgUuid}`,
        `${prefix}Sessão atingiu ${threshold}%`,
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
        `weekly-${threshold}-${orgUuid}`,
        `${prefix}Semanal atingiu ${threshold}%`,
        `Uso atual: ${usage.weekly}%. Reseta em ${resetIn}.`
      );
    }
  }

  if (changed) {
    await saveNotifiedState(orgUuid, state);
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

// -- Storage: Latest (for popup) -- namespaced + global copy --
function saveLatest(usage, orgUuid) {
  const updates = { latestUsage: usage };
  if (orgUuid) {
    updates[accountKey(orgUuid, 'latestUsage')] = usage;
    updates.activeAccountId = orgUuid;
  }
  chrome.storage.local.set(updates);
}

// -- Storage: Usage Log -- namespaced per account --
function isSameSession(resetA, resetB) {
  if (!resetA || !resetB) return false;
  const THIRTY_MINUTES = 30 * 60 * 1000;
  const diff = Math.abs(new Date(resetA).getTime() - new Date(resetB).getTime());
  return diff < THIRTY_MINUTES;
}

async function maybeLogUsage(usage, settings, orgUuid) {
  if (!usage.sessionResetsAt) return;

  const now = Date.now();
  const logKey = accountKey(orgUuid, 'usageLog');
  const prevKey = accountKey(orgUuid, 'previousSession');
  const resetKey = accountKey(orgUuid, 'lastTrackedResetAt');

  const result = await getLocal({
    [logKey]: [],
    [prevKey]: null,
    [resetKey]: null
  });

  const log = result[logKey] || [];
  const prevResetAt = result[resetKey];
  let shouldSave = false;

  // Detect session change — log the PREVIOUS session's final values.
  if (prevResetAt && !isSameSession(prevResetAt, usage.sessionResetsAt) && result[prevKey]) {
    log.push({
      ts: result[prevKey].ts,
      session: result[prevKey].session,
      weekly: result[prevKey].weekly,
      sonnet: result[prevKey].sonnet,
      sessionResetsAt: prevResetAt,
      weeklyResetsAt: result[prevKey].weeklyResetsAt
    });
    shouldSave = true;
  }

  // Always update the snapshot
  const currentSnapshot = {
    ts: now,
    session: usage.session,
    weekly: usage.weekly,
    sonnet: usage.sonnet,
    weeklyResetsAt: usage.weeklyResetsAt
  };

  // Prune old entries
  const pruned = shouldSave ? log.filter(entry => (now - entry.ts) < MAX_AGE_MS) : (result[logKey] || []);

  await setLocal({
    [logKey]: pruned,
    [prevKey]: currentSnapshot,
    [resetKey]: usage.sessionResetsAt
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
  if (msg.action === 'getAccounts') {
    getLocal(['accounts', 'activeAccountId']).then((data) => {
      sendResponse({ accounts: data.accounts || {}, activeAccountId: data.activeAccountId });
    });
    return true;
  }
  if (msg.action === 'setAccountLabel') {
    getLocal('accounts').then((data) => {
      const accounts = data.accounts || {};
      if (accounts[msg.orgUuid]) {
        accounts[msg.orgUuid].customLabel = msg.label;
        setLocal({ accounts }).then(() => sendResponse('ok'));
      } else {
        sendResponse('not_found');
      }
    });
    return true;
  }
  if (msg.action === 'injectTestData') {
    // For test data injection, need orgUuid context
    const orgUuid = msg.orgUuid;
    if (orgUuid) {
      setLocal({ [accountKey(orgUuid, 'usageLog')]: msg.data }).then(() => sendResponse('ok'));
    } else {
      // Fallback: inject into active account
      getLocal('activeAccountId').then((data) => {
        const id = data.activeAccountId;
        if (id) {
          setLocal({ [accountKey(id, 'usageLog')]: msg.data }).then(() => sendResponse('ok'));
        } else {
          sendResponse('no_active');
        }
      });
    }
    return true;
  }
  if (msg.action === 'clearUsageLog') {
    const orgUuid = msg.orgUuid;
    if (!orgUuid) {
      sendResponse('no_org');
      return true;
    }
    setLocal({
      [accountKey(orgUuid, 'usageLog')]: [],
      [accountKey(orgUuid, 'previousSession')]: null,
      [accountKey(orgUuid, 'lastTrackedResetAt')]: null,
    }).then(() => sendResponse('ok'));
    return true;
  }
});
