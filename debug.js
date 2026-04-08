const output = document.getElementById('output');

function log(text) {
  output.textContent = text;
}

document.getElementById('btn-state').addEventListener('click', () => {
  chrome.storage.local.get(null, (allData) => {
    const relevant = {
      activeAccountId: allData.activeAccountId,
      usableOrgUuid: allData.usableOrgUuid,
      accounts: allData.accounts || {}
    };

    // Show account details
    const lines = ['=== Estado Atual ===\n'];
    lines.push(`activeAccountId: ${relevant.activeAccountId || 'NENHUM'}`);
    lines.push(`usableOrgUuid: ${relevant.usableOrgUuid || 'NENHUM'}`);
    lines.push('\n=== Contas Registradas ===\n');

    for (const [uuid, acct] of Object.entries(relevant.accounts)) {
      const isActive = uuid === relevant.activeAccountId ? ' ★ ATIVA' : '';
      lines.push(`[${uuid.slice(0, 8)}...] ${acct.orgName || 'sem nome'}${isActive}`);
      lines.push(`  Label: ${acct.customLabel || '(nenhum)'}`);
      lines.push(`  Primeiro uso: ${new Date(acct.firstSeen).toLocaleString('pt-BR')}`);
      lines.push(`  Último uso: ${new Date(acct.lastSeen).toLocaleString('pt-BR')}`);

      // Check for usage log
      const logKey = `account:${uuid}:usageLog`;
      const logEntries = allData[logKey];
      lines.push(`  Registros no log: ${logEntries ? logEntries.length : 0}`);

      // Check latest usage
      const latestKey = `account:${uuid}:latestUsage`;
      const latest = allData[latestKey];
      if (latest) {
        lines.push(`  Último dado: sessão=${latest.session}%, semanal=${latest.weekly}%`);
      }
      lines.push('');
    }

    log(lines.join('\n'));
  });
});

document.getElementById('btn-clear-cache').addEventListener('click', () => {
  if (!confirm('Limpar cache de conta? O monitor vai re-detectar a conta na próxima execução.')) return;
  chrome.storage.local.remove(['usableOrgUuid', 'activeAccountId'], () => {
    log('Cache limpo! Recarregue a extensão para forçar re-detecção.');
  });
});

document.getElementById('btn-force-fetch').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'refreshUsage' }, () => {
    log('Fetch disparado. Clique em "Ver Estado Atual" para ver o resultado.');
  });
});
