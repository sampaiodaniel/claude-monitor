// 3 semanas de dados simulados (02-22/mar/2026)
// Cota semanal: cada sessão consome ~3-5% da cota semanal dependendo do uso
// Sessão de 80%+ consome ~5%, sessão de 50-79% consome ~3%, sessão <50% consome ~1-2%

const fakeLog = [];

function weeklyImpact(sessionPct) {
  if (sessionPct >= 80) return 4 + Math.round(Math.random() * 2); // 4-6%
  if (sessionPct >= 50) return 2 + Math.round(Math.random() * 2); // 2-4%
  return 1 + Math.round(Math.random());                           // 1-2%
}

function buildWeek(startDate, weeklyReset, sessionsPerDay) {
  let weekly = 0;
  for (const dayData of sessionsPerDay) {
    const [year, month, day] = dayData.date.split('-').map(Number);
    for (const s of dayData.sessions) {
      const dt = new Date(`${dayData.date}T${s.time}:00`);
      const resetDt = new Date(dt.getTime() + 5 * 60 * 1000);
      weekly = Math.min(95, weekly + weeklyImpact(s.pct));
      fakeLog.push({
        ts: dt.getTime(),
        session: s.pct,
        weekly: weekly,
        sonnet: Math.round(s.pct * 0.08),
        sessionResetsAt: resetDt.toISOString(),
        weeklyResetsAt: weeklyReset
      });
    }
  }
}

// === Semana 1: 02-08/mar ===
buildWeek('2026-03-02', '2026-03-08T22:59:59Z', [
  { date: '2026-03-02', sessions: [
    { time: '12:55', pct: 70 }, { time: '17:55', pct: 82 }, { time: '22:55', pct: 20 }
  ]},
  { date: '2026-03-03', sessions: [
    { time: '12:55', pct: 65 }, { time: '17:55', pct: 88 }, { time: '22:55', pct: 12 }
  ]},
  { date: '2026-03-04', sessions: [ // dia pesado, deixou rodando
    { time: '12:55', pct: 75 }, { time: '17:55', pct: 90 }, { time: '22:55', pct: 42 }
  ]},
  { date: '2026-03-05', sessions: [ // saiu cedo
    { time: '12:55', pct: 58 }, { time: '17:55', pct: 72 }
  ]},
  { date: '2026-03-06', sessions: [
    { time: '12:55', pct: 68 }, { time: '17:55', pct: 85 }, { time: '22:55', pct: 15 }
  ]},
  { date: '2026-03-07', sessions: [ // sábado
    { time: '12:55', pct: 30 }
  ]},
]);

// === Semana 2: 09-15/mar ===
buildWeek('2026-03-09', '2026-03-15T22:59:59Z', [
  { date: '2026-03-09', sessions: [ // deixou rodando de madrugada
    { time: '12:55', pct: 72 }, { time: '17:55', pct: 80 }, { time: '22:55', pct: 35 }
  ]},
  { date: '2026-03-10', sessions: [
    { time: '12:55', pct: 60 }, { time: '17:55', pct: 78 }, { time: '22:55', pct: 18 }
  ]},
  { date: '2026-03-11', sessions: [ // dia pesado
    { time: '12:55', pct: 82 }, { time: '17:55', pct: 95 }, { time: '22:55', pct: 50 }
  ]},
  { date: '2026-03-12', sessions: [ // dia tranquilo
    { time: '12:55', pct: 45 }, { time: '17:55', pct: 62 }
  ]},
  { date: '2026-03-13', sessions: [
    { time: '12:55', pct: 70 }, { time: '17:55', pct: 88 }, { time: '22:55', pct: 25 }
  ]},
  { date: '2026-03-14', sessions: [ // sábado
    { time: '12:55', pct: 22 }
  ]},
]);

// === Semana 3: 16-22/mar ===
buildWeek('2026-03-16', '2026-03-22T22:59:59Z', [
  { date: '2026-03-16', sessions: [ // deixou rodando
    { time: '12:55', pct: 72 }, { time: '17:55', pct: 85 }, { time: '22:55', pct: 45 }
  ]},
  { date: '2026-03-17', sessions: [
    { time: '12:55', pct: 68 }, { time: '17:55', pct: 91 }, { time: '22:55', pct: 22 }
  ]},
  { date: '2026-03-18', sessions: [ // dia mais pesado
    { time: '12:55', pct: 78 }, { time: '17:55', pct: 95 }, { time: '22:55', pct: 62 }
  ]},
  { date: '2026-03-19', sessions: [ // saiu cedo
    { time: '12:55', pct: 55 }, { time: '17:55', pct: 38 }
  ]},
  { date: '2026-03-20', sessions: [
    { time: '12:55', pct: 65 }, { time: '17:55', pct: 76 }, { time: '22:55', pct: 15 }
  ]},
  { date: '2026-03-21', sessions: [ // sábado
    { time: '12:55', pct: 25 }
  ]},
]);

chrome.storage.local.set({ usageLog: fakeLog }, () => {
  // Count per week
  const w1 = fakeLog.filter(e => e.weeklyResetsAt.includes('03-08')).length;
  const w2 = fakeLog.filter(e => e.weeklyResetsAt.includes('03-15')).length;
  const w3 = fakeLog.filter(e => e.weeklyResetsAt.includes('03-22')).length;
  const lastW1 = fakeLog.filter(e => e.weeklyResetsAt.includes('03-08')).pop();
  const lastW2 = fakeLog.filter(e => e.weeklyResetsAt.includes('03-15')).pop();
  const lastW3 = fakeLog.filter(e => e.weeklyResetsAt.includes('03-22')).pop();

  document.getElementById('log').textContent =
    `✅ ${fakeLog.length} registros inseridos (02-22/mar/2026)\n\n` +
    `Semana 1 (02-08/mar): ${w1} sessões, cota semanal final: ${lastW1.weekly}%\n` +
    `Semana 2 (09-15/mar): ${w2} sessões, cota semanal final: ${lastW2.weekly}%\n` +
    `Semana 3 (16-22/mar): ${w3} sessões, cota semanal final: ${lastW3.weekly}%\n\n` +
    `Total: ${fakeLog.length} registros\n\n` +
    `Agora abra o Histórico de Uso para ver o gráfico e paginação.`;
});
