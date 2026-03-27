// Auto-run cleanup on load
chrome.storage.local.get({ usageLog: [] }, (result) => {
  const logEl = document.getElementById('log');
  const log = result.usageLog;
  const before = log.length;

  if (before === 0) {
    logEl.textContent = 'Log vazio, nada para limpar.';
    return;
  }

  // Group by session window: entries whose resets_at are within 3h of each other
  // belong to the same session. Sort by resets_at, then cluster.
  const withReset = log.filter(e => e.sessionResetsAt).sort((a, b) =>
    new Date(a.sessionResetsAt).getTime() - new Date(b.sessionResetsAt).getTime()
  );
  const noReset = log.filter(e => !e.sessionResetsAt);

  const THREE_HOURS = 3 * 60 * 60 * 1000;
  const groups = {};
  let clusterId = 0;
  let lastResetTime = null;

  for (const entry of withReset) {
    const resetTime = new Date(entry.sessionResetsAt).getTime();
    if (lastResetTime === null || (resetTime - lastResetTime) > THREE_HOURS) {
      clusterId++;
    }
    lastResetTime = resetTime;

    const key = `cluster-${clusterId}`;
    if (!groups[key] || entry.session > groups[key].session) {
      groups[key] = entry;
    }
  }

  // Keep entries without resets_at as-is
  for (const entry of noReset) {
    groups[`noreset-${entry.ts}`] = entry;
  }

  const cleaned = Object.values(groups).sort((a, b) => a.ts - b.ts);
  const after = cleaned.length;

  // First show diagnostics for today before saving
  const today = log.filter(e => {
    const d = new Date(e.ts);
    return d.getDate() === 27 && d.getMonth() === 2;
  });

  const todayDiag = today.map(e => {
    const d = new Date(e.ts);
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `  ${time} — Sessão: ${e.session}%, resetsAt: ${e.sessionResetsAt}`;
  }).join('\n');

  const todayCleaned = cleaned.filter(e => {
    const d = new Date(e.ts);
    return d.getDate() === 27 && d.getMonth() === 2;
  });

  chrome.storage.local.set({ usageLog: cleaned }, () => {
    logEl.textContent =
      `Antes: ${before} registros\n` +
      `Depois: ${after} registros\n` +
      `Removidos: ${before - after} duplicatas\n\n` +
      `--- DIAGNÓSTICO HOJE (27/03) ---\n` +
      `Entradas originais hoje: ${today.length}\n${todayDiag}\n\n` +
      `Entradas após cleanup hoje: ${todayCleaned.length}\n` +
      todayCleaned.map(e => {
        const d = new Date(e.ts);
        const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `  ${time} — Sessão: ${e.session}%, resetsAt: ${e.sessionResetsAt}`;
      }).join('\n') +
      `\n\n--- TODOS OS REGISTROS ---\n` +
      cleaned.map(e => {
        const d = new Date(e.ts);
        const date = d.toLocaleDateString('pt-BR');
        const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `  ${date} ${time} — Sessão: ${e.session}%, Semanal: ${e.weekly}%`;
      }).join('\n');
  });
});
