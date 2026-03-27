// Auto-run: deduplicate all entries (keep highest session% per 3h window)
chrome.storage.local.get({ usageLog: [] }, (result) => {
  const logEl = document.getElementById('log');
  const log = result.usageLog;
  const before = log.length;

  if (before === 0) {
    logEl.textContent = 'Log vazio.';
    return;
  }

  // Sort by resets_at time
  const sorted = [...log].sort((a, b) => {
    const ta = a.sessionResetsAt ? new Date(a.sessionResetsAt).getTime() : a.ts;
    const tb = b.sessionResetsAt ? new Date(b.sessionResetsAt).getTime() : b.ts;
    return ta - tb;
  });

  // Cluster by 3h window on resets_at, keep highest session%
  const THREE_HOURS = 3 * 60 * 60 * 1000;
  const clusters = [];
  let currentCluster = [sorted[0]];
  let clusterResetTime = sorted[0].sessionResetsAt ? new Date(sorted[0].sessionResetsAt).getTime() : sorted[0].ts;

  for (let i = 1; i < sorted.length; i++) {
    const entry = sorted[i];
    const resetTime = entry.sessionResetsAt ? new Date(entry.sessionResetsAt).getTime() : entry.ts;

    if (resetTime - clusterResetTime <= THREE_HOURS) {
      currentCluster.push(entry);
    } else {
      clusters.push(currentCluster);
      currentCluster = [entry];
      clusterResetTime = resetTime;
    }
  }
  clusters.push(currentCluster);

  // Keep the entry with highest session% from each cluster
  const cleaned = clusters.map(cluster => {
    return cluster.reduce((best, e) => (e.session > best.session) ? e : best, cluster[0]);
  }).sort((a, b) => a.ts - b.ts);

  const after = cleaned.length;

  chrome.storage.local.set({ usageLog: cleaned }, () => {
    logEl.textContent =
      `Antes: ${before} registros\nDepois: ${after} registros\nRemovidos: ${before - after} duplicatas\n\n` +
      cleaned.map(e => {
        const d = new Date(e.ts);
        const date = d.toLocaleDateString('pt-BR');
        const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `  ${date} ${time} — Sessão: ${e.session}%, Semanal: ${e.weekly}%`;
      }).join('\n');
  });
});
