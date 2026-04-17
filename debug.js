const output = document.getElementById('output');

function log(text) {
  output.textContent = text;
}

function appendLog(text) {
  output.textContent += '\n' + text;
}

document.getElementById('btn-state').addEventListener('click', () => {
  chrome.storage.local.get(null, (allData) => {
    const lines = ['=== Estado Atual ===\n'];
    lines.push(`activeAccountId: ${allData.activeAccountId || 'NENHUM'}`);
    lines.push(`usableOrgUuid: ${allData.usableOrgUuid || 'NENHUM'}`);

    // Global latestUsage
    const gUsage = allData.latestUsage;
    lines.push(`\nlatestUsage (global): ${gUsage ? JSON.stringify(gUsage).slice(0, 200) : 'NENHUM'}`);

    lines.push('\n=== Contas Registradas ===\n');

    const accounts = allData.accounts || {};
    for (const [uuid, acct] of Object.entries(accounts)) {
      const isActive = uuid === allData.activeAccountId ? ' ★ ATIVA' : '';
      lines.push(`[${uuid.slice(0, 8)}...] ${acct.email || acct.orgName || 'sem nome'}${isActive}`);
      lines.push(`  orgUuid: ${acct.orgUuid || 'NENHUM'}`);
      lines.push(`  email: ${acct.email || '(nenhum)'}`);
      lines.push(`  displayName: ${acct.displayName || '(nenhum)'}`);
      lines.push(`  customLabel: ${acct.customLabel || '(nenhum)'}`);
      lines.push(`  Primeiro uso: ${new Date(acct.firstSeen).toLocaleString('pt-BR')}`);
      lines.push(`  Último uso: ${new Date(acct.lastSeen).toLocaleString('pt-BR')}`);

      // Usage log
      const logKey = `account:${uuid}:usageLog`;
      const logEntries = allData[logKey];
      lines.push(`  Registros no log: ${logEntries ? logEntries.length : 0}`);

      // Latest usage (per account)
      const latestKey = `account:${uuid}:latestUsage`;
      const latest = allData[latestKey];
      if (latest) {
        if (latest.error) {
          lines.push(`  latestUsage: ERRO — ${latest.error}`);
        } else {
          lines.push(`  latestUsage: sessão=${latest.session}%, semanal=${latest.weekly}%`);
        }
      } else {
        lines.push(`  latestUsage: NENHUM`);
      }
      lines.push('');
    }

    // Show ALL storage keys for debugging
    lines.push('=== Todas as chaves no storage ===\n');
    const keys = Object.keys(allData).sort();
    for (const k of keys) {
      const val = allData[k];
      const preview = typeof val === 'object' ? JSON.stringify(val).slice(0, 80) : String(val);
      lines.push(`  ${k}: ${preview}`);
    }

    log(lines.join('\n'));
  });
});

document.getElementById('btn-clear-cache').addEventListener('click', () => {
  if (!confirm('Limpar cache de conta? O monitor vai re-detectar a conta na próxima execução.')) return;
  chrome.storage.local.remove(['usableOrgUuid', 'activeAccountId', 'latestUsage'], () => {
    log('Cache limpo! Clique em "Diagnóstico Completo" ou recarregue a extensão.');
  });
});

document.getElementById('btn-force-fetch').addEventListener('click', () => {
  log('Disparando fetch...');
  chrome.runtime.sendMessage({ action: 'refreshUsage' }, () => {
    appendLog('Fetch concluído. Clique em "Ver Estado Atual" para ver o resultado.');
  });
});

// Full diagnostic button
document.getElementById('btn-diagnostic').addEventListener('click', async () => {
  const lines = ['=== DIAGNÓSTICO COMPLETO ===\n'];
  lines.push(`Horário: ${new Date().toLocaleString('pt-BR')}\n`);

  // Step 1: Check cookies
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'claude.ai' });
    lines.push(`[1] Cookies claude.ai: ${cookies.length} encontrados`);
    const cookieNames = cookies.map(c => c.name).sort();
    lines.push(`    Nomes: ${cookieNames.join(', ')}`);
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    lines.push(`    Header length: ${cookieHeader.length} chars`);
    lines.push('');
  } catch (e) {
    lines.push(`[1] ERRO cookies: ${e.message}\n`);
  }

  // Step 2: Test /api/account
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'claude.ai' });
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const resp = await fetch('https://claude.ai/api/account', {
      credentials: 'include',
      headers: cookieHeader ? { 'Cookie': cookieHeader } : {}
    });
    lines.push(`[2] /api/account: status ${resp.status}`);

    if (resp.ok) {
      const acct = await resp.json();
      lines.push(`    email: ${acct.email_address}`);
      lines.push(`    uuid: ${acct.uuid}`);
      lines.push(`    full_name: ${acct.full_name}`);
      const memberships = acct.memberships || [];
      lines.push(`    memberships: ${memberships.length}`);
      if (memberships.length > 0) {
        const org = memberships[0].organization;
        lines.push(`    org[0].uuid: ${org?.uuid}`);
        lines.push(`    org[0].name: ${org?.name}`);
      } else {
        lines.push(`    ⚠️ SEM MEMBERSHIPS — orgUuid será null!`);
      }
    } else {
      const text = await resp.text();
      lines.push(`    Resposta: ${text.slice(0, 200)}`);
    }
    lines.push('');
  } catch (e) {
    lines.push(`[2] ERRO /api/account: ${e.message}\n`);
  }

  // Step 3: Test /usage
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'claude.ai' });
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Get orgUuid from /api/account first
    const acctResp = await fetch('https://claude.ai/api/account', {
      credentials: 'include',
      headers: cookieHeader ? { 'Cookie': cookieHeader } : {}
    });

    if (acctResp.ok) {
      const acct = await acctResp.json();
      const orgUuid = acct.memberships?.[0]?.organization?.uuid;

      if (!orgUuid) {
        lines.push(`[3] /usage: SKIP — orgUuid é null (sem memberships)\n`);
      } else {
        const url = `https://claude.ai/api/organizations/${orgUuid}/usage`;
        lines.push(`[3] Fetching: ${url}`);

        const usageResp = await fetch(url, {
          credentials: 'include',
          headers: cookieHeader ? { 'Cookie': cookieHeader } : {}
        });
        lines.push(`    Status: ${usageResp.status}`);

        if (usageResp.ok) {
          const usage = await usageResp.json();
          lines.push(`    ✅ session: ${usage.five_hour?.utilization}%`);
          lines.push(`    ✅ weekly: ${usage.seven_day?.utilization}%`);
          lines.push(`    ✅ sonnet: ${usage.seven_day_sonnet?.utilization}%`);
        } else {
          const text = await usageResp.text();
          lines.push(`    ❌ Resposta: ${text.slice(0, 200)}`);
        }
      }
    } else {
      lines.push(`[3] SKIP — /api/account falhou`);
    }
    lines.push('');
  } catch (e) {
    lines.push(`[3] ERRO /usage: ${e.message}\n`);
  }

  // Step 4: Check storage state
  const data = await new Promise(r => chrome.storage.local.get(null, r));
  lines.push(`[4] Storage state:`);
  lines.push(`    activeAccountId: ${data.activeAccountId || 'NENHUM'}`);
  lines.push(`    latestUsage: ${data.latestUsage ? (data.latestUsage.error || `session=${data.latestUsage.session}%`) : 'NENHUM'}`);

  const accounts = data.accounts || {};
  const acctCount = Object.keys(accounts).length;
  lines.push(`    accounts: ${acctCount} registradas`);
  for (const [id, a] of Object.entries(accounts)) {
    const active = id === data.activeAccountId ? ' ★' : '';
    lines.push(`      [${id.slice(0, 8)}] ${a.email || a.orgName || '?'}${active} (org: ${(a.orgUuid || '?').slice(0, 8)})`);
  }

  // Step 5: Try refreshUsage via message
  lines.push('\n[5] Disparando refreshUsage via background...');
  log(lines.join('\n'));

  chrome.runtime.sendMessage({ action: 'refreshUsage' }, () => {
    // Re-read state after refresh
    chrome.storage.local.get(['latestUsage', 'activeAccountId', 'accounts'], (updated) => {
      const more = [];
      more.push(`\n[5] Após refresh:`);
      more.push(`    activeAccountId: ${updated.activeAccountId || 'NENHUM'}`);
      const lu = updated.latestUsage;
      if (lu) {
        if (lu.error) {
          more.push(`    latestUsage: ERRO — ${lu.error}`);
        } else {
          more.push(`    ✅ latestUsage: session=${lu.session}%, weekly=${lu.weekly}%`);
        }
      } else {
        more.push(`    latestUsage: NENHUM`);
      }
      more.push('\n=== FIM DIAGNÓSTICO ===');
      appendLog(more.join('\n'));
    });
  });
});
