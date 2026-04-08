// reassign-data.js — Move usage history between accounts

let allData = {};
let accountsList = [];
let activeId = null;

document.addEventListener('DOMContentLoaded', loadAll);

function loadAll() {
  chrome.storage.local.get(null, (data) => {
    allData = data;
    activeId = data.activeAccountId;
    const accounts = data.accounts || {};
    accountsList = Object.values(accounts);

    const container = document.getElementById('accounts-container');
    const actions = document.getElementById('actions');
    const log = document.getElementById('log');

    // Check for orphaned flat usageLog
    const flatLog = data.usageLog || [];
    const hasOrphaned = flatLog.length > 0 && flatLog.some(e => e.session !== undefined);

    let html = '';

    if (hasOrphaned) {
      html += `
        <div class="orphan-section">
          <div class="label">Dados órfãos (chave antiga "usageLog")</div>
          <div class="account-stats">${flatLog.length} registros não associados a nenhuma conta</div>
          <div class="entries-preview">${formatEntries(flatLog)}</div>
        </div>
      `;
    }

    for (const acct of accountsList) {
      const logKey = `account:${acct.orgUuid}:usageLog`;
      const acctLog = data[logKey] || [];
      const isActive = acct.orgUuid === activeId;

      html += `
        <div class="account-box ${isActive ? 'active' : ''}">
          <div class="account-name">${acct.customLabel || acct.orgName || 'Sem nome'} ${isActive ? '(ativa)' : ''}</div>
          <div class="account-uuid">${acct.orgUuid}</div>
          <div class="account-stats">${acctLog.length} registros no histórico</div>
          ${acctLog.length > 0 ? `<div class="entries-preview">${formatEntries(acctLog)}</div>` : ''}
        </div>
      `;
    }

    container.innerHTML = html;

    // Build action buttons
    actions.innerHTML = '';

    if (accountsList.length >= 2) {
      for (const source of accountsList) {
        const sourceLog = data[`account:${source.orgUuid}:usageLog`] || [];
        if (sourceLog.length === 0) continue;

        for (const target of accountsList) {
          if (target.orgUuid === source.orgUuid) continue;
          const sourceName = source.customLabel || source.orgName || source.orgUuid.slice(0, 8);
          const targetName = target.customLabel || target.orgName || target.orgUuid.slice(0, 8);

          const btn = document.createElement('button');
          btn.className = 'btn';
          btn.textContent = `Mover tudo de "${sourceName}" → "${targetName}"`;
          btn.addEventListener('click', () => moveAllData(source.orgUuid, target.orgUuid));
          actions.appendChild(btn);
        }
      }
    }

    if (hasOrphaned && accountsList.length > 0) {
      for (const target of accountsList) {
        const targetName = target.customLabel || target.orgName || target.orgUuid.slice(0, 8);

        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = `Mover órfãos → "${targetName}"`;
        btn.addEventListener('click', () => moveOrphanedTo(target.orgUuid));
        actions.appendChild(btn);
      }
    }

    if (actions.children.length === 0) {
      actions.innerHTML = '<p style="color:#666;font-size:12px;">Nenhuma ação disponível.</p>';
    }

    // Summary
    const lines = [];
    lines.push(`Contas detectadas: ${accountsList.length}`);
    lines.push(`Conta ativa: ${activeId?.slice(0, 8) || 'nenhuma'}`);
    if (hasOrphaned) lines.push(`Dados órfãos (flat): ${flatLog.length} registros`);
    for (const acct of accountsList) {
      const logKey = `account:${acct.orgUuid}:usageLog`;
      const acctLog = data[logKey] || [];
      const name = acct.customLabel || acct.orgName || acct.orgUuid.slice(0, 8);
      lines.push(`  ${name}: ${acctLog.length} registros`);
    }
    lines.push('\nPronto para ações.');
    log.textContent = lines.join('\n');
  });
}

function formatEntries(entries) {
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);
  const first5 = sorted.slice(0, 5);
  const last5 = sorted.slice(-5);
  const shown = sorted.length <= 10 ? sorted : [...first5, null, ...last5];

  return shown.map(e => {
    if (!e) return '  ...';
    const d = new Date(e.ts);
    const date = d.toLocaleDateString('pt-BR');
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `  ${date} ${time} — Sessão: ${e.session}%, Semanal: ${e.weekly}%`;
  }).join('\n');
}

function moveAllData(sourceUuid, targetUuid) {
  const sourceKey = `account:${sourceUuid}:usageLog`;
  const targetKey = `account:${targetUuid}:usageLog`;

  const sourceLog = allData[sourceKey] || [];
  const targetLog = allData[targetKey] || [];

  if (sourceLog.length === 0) {
    document.getElementById('log').textContent = 'Nada para mover — fonte vazia.';
    return;
  }

  const sourceName = getName(sourceUuid);
  const targetName = getName(targetUuid);

  if (!confirm(`Mover ${sourceLog.length} registros de "${sourceName}" para "${targetName}"?\n\nIsso vai ESVAZIAR o histórico de "${sourceName}".`)) {
    return;
  }

  const merged = [...targetLog, ...sourceLog];
  const seen = new Set();
  const deduped = merged.filter(e => {
    const key = `${e.ts}-${e.session}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.ts - b.ts);

  chrome.storage.local.set({
    [targetKey]: deduped,
    [sourceKey]: []
  }, () => {
    document.getElementById('log').textContent =
      `Movidos ${sourceLog.length} registros de "${sourceName}" para "${targetName}".\n` +
      `"${targetName}" agora tem ${deduped.length} registros.\n` +
      `"${sourceName}" agora tem 0 registros.\n\n` +
      `Recarregue o histórico para ver as mudanças.`;
    loadAll();
  });
}

function moveOrphanedTo(targetUuid) {
  const flatLog = allData.usageLog || [];
  const targetKey = `account:${targetUuid}:usageLog`;
  const targetLog = allData[targetKey] || [];
  const targetName = getName(targetUuid);

  if (flatLog.length === 0) {
    document.getElementById('log').textContent = 'Nenhum dado órfão para mover.';
    return;
  }

  if (!confirm(`Mover ${flatLog.length} registros órfãos para "${targetName}"?`)) {
    return;
  }

  const merged = [...targetLog, ...flatLog];
  const seen = new Set();
  const deduped = merged.filter(e => {
    const key = `${e.ts}-${e.session}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.ts - b.ts);

  chrome.storage.local.set({
    [targetKey]: deduped,
    usageLog: []
  }, () => {
    document.getElementById('log').textContent =
      `Movidos ${flatLog.length} registros órfãos para "${targetName}".\n` +
      `"${targetName}" agora tem ${deduped.length} registros.\n\n` +
      `Recarregue o histórico para ver as mudanças.`;
    loadAll();
  });
}

function getName(uuid) {
  const acct = accountsList.find(a => a.orgUuid === uuid);
  return acct?.customLabel || acct?.orgName || uuid.slice(0, 8);
}
