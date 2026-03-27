// Auto-run: remove specific 0% entry from 23/03 at 05:59
chrome.storage.local.get({ usageLog: [] }, (result) => {
  const logEl = document.getElementById('log');
  const log = result.usageLog;
  const before = log.length;

  const cleaned = log.filter(e => {
    const d = new Date(e.ts);
    // Only remove: day 23, March, hour 5, minute 59, session 0%
    if (d.getDate() === 23 && d.getMonth() === 2 && d.getHours() === 5 && d.getMinutes() === 59 && e.session === 0) {
      logEl.textContent += `Removendo: ${d.toLocaleString('pt-BR')} — Sessão: ${e.session}%\n`;
      return false;
    }
    return true;
  });

  const after = cleaned.length;
  chrome.storage.local.set({ usageLog: cleaned }, () => {
    logEl.textContent += `\nAntes: ${before} | Depois: ${after} | Removidos: ${before - after}`;
  });
});
