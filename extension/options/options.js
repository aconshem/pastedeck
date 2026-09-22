(async function () {
  'use strict';
  const U = PD.util, esc = U.esc, db = PD.db;
  await db.init();
  document.getElementById('ver').textContent = 'Version ' + PD.VERSION + ' · data stays on this device';
  if (location.hash === '#welcome') document.getElementById('welcome').classList.remove('pd-hidden');
  const root = document.getElementById('root');

  const sw = (name, on) => '<label class="pd-switch"><input type="checkbox" data-s="' + name + '"' + (on ? ' checked' : '') + '><span></span></label>';

  function render() {
    const s = db.get('settings');
    const plan = PD.plan.id();
    root.innerHTML =
      '<div class="pd-card card"><h2>Account</h2>' +
      '<div class="item"><div>Log in and manage your account<small>Opens the PasteDeck website. The extension itself never shows a login form.</small></div><div class="ctl auto"><button class="pd-btn" data-a="login">Log in</button> <button class="pd-btn" data-a="devices">Manage devices</button></div></div>' +
      '<div class="item"><div>Dashboard<small>Team, company details, analytics.</small></div><div class="ctl auto"><button class="pd-btn" data-a="dashboard">Open dashboard</button></div></div></div>' +

      '<div class="pd-card card"><h2>General</h2>' +
      '<div class="item"><div>Switch desks automatically<small>Uses the website address. You can always pin a desk by hand.</small></div>' + sw('autoDetect', s.autoDetect !== false) + '</div>' +
      '<div class="item"><div>Show the small PasteDeck button on sites with blueprints<small>Lets you copy details or fill a form in one click.</small></div>' + sw('floatingPill', s.floatingPill !== false) + '</div>' +
      '<div class="item"><div>Type-to-insert shortcuts<small>Type <code>;sal</code> and a space to expand a snippet.</small></div>' + sw('textExpansion', s.textExpansion !== false) + '</div>' +
      '<div class="item"><div>Reminder notifications<small>Uses Chrome notifications.</small></div>' + sw('notifications', s.notifications !== false) + '</div>' +
      '<div class="item"><div>Default session length<small>Candidate sessions delete themselves after this.</small></div><div class="ctl"><select class="pd-select" data-s="defaultExpiry">' + PD.SESSION_PRESETS.map((p) => '<option value="' + p.id + '"' + ((s.defaultExpiry || '1h') === p.id ? ' selected' : '') + '>' + p.label + '</option>').join('') + '</select></div></div>' +
      '<div class="item"><div>Keyboard shortcuts<small>Command bar: Ctrl+Shift+Space. Quick add task: Alt+Shift+T (Chrome reserves Ctrl+Shift+T).</small></div><div class="ctl auto"><button class="pd-btn" data-a="shortcuts">Change shortcuts</button></div></div></div>' +

      '<div class="pd-card card"><h2>Clipboard history</h2>' +
      '<div class="item"><div>Keep clipboard history<small>Text, links and pasted images. Local only. Password fields are always ignored.</small></div>' + sw('clipboardHistory', s.clipboardHistory !== false) + '</div>' +
      '<div class="item"><div>Never record on these sites<small>One per line, e.g. <code>bank.example.com</code></small></div><div class="ctl"><textarea class="pd-textarea" data-s="ignoreHosts" style="min-height:64px">' + esc((s.ignoreHosts || []).join('\n')) + '</textarea></div></div>' +
      '<div class="item"><div>Clear history now<small>Pinned items are kept.</small></div><div class="ctl auto"><button class="pd-btn pd-btn--danger" data-a="clear-history">Clear history</button></div></div></div>' +

      '<div class="pd-card card"><h2>Plan</h2>' +
      '<div class="item"><div>Current plan: <b>' + esc(PD.PLANS[plan].label) + '</b><small>Billing is not connected yet. This switch exists so you can test every limit while building.</small></div>' +
      (PD.flags.get('devPlanSwitcher') ? '<div class="ctl"><select class="pd-select" data-s="plan">' + Object.keys(PD.PLANS).map((k) => '<option value="' + k + '"' + (k === plan ? ' selected' : '') + '>' + PD.PLANS[k].label + '</option>').join('') + '</select></div>' : '') + '</div></div>' +

      '<div class="pd-card card"><h2>Developer</h2>' +
      '<div class="item"><div>Website address<small>Where Log in, Dashboard and Manage devices open. Use <code>http://localhost:8080</code> while developing.</small></div><div class="ctl"><input class="pd-input" data-s="siteUrl" value="' + esc(s.siteUrl || PD.CONFIG.siteUrl) + '"></div></div>' +
      '<div class="item"><div>Feature flags<small>Backend features ship switched off.</small></div></div>' +
      '<div class="flags">' + Object.keys(PD.FLAGS).map((k) => '<div class="item"><div><code>' + k + '</code></div>' + sw('flag:' + k, PD.flags.get(k)) + '</div>').join('') + '</div></div>' +

      '<div class="pd-card card"><h2>Your data</h2>' +
      '<div class="item"><div>Export everything<small>A JSON backup of desks, snippets, sessions, tasks and settings. Files and clipboard images are not included.</small></div><div class="ctl auto"><button class="pd-btn" data-a="export">Export</button></div></div>' +
      '<div class="item"><div>Import a backup<small>Replaces the matching data on this device.</small></div><div class="ctl auto"><button class="pd-btn" data-a="import">Import</button><input type="file" id="imp" accept="application/json" hidden></div></div>' +
      '<div class="item"><div>Reset to the starter setup<small>Deletes all local data and re-creates the sample desks.</small></div><div class="ctl auto"><button class="pd-btn pd-btn--danger" data-a="reset">Reset</button></div></div></div>';
  }
  render();
  db.on((ns, src) => { if (src === 'remote' && !root.contains(document.activeElement)) render(); });

  root.addEventListener('change', (e) => {
    const t = e.target, k = t.dataset && t.dataset.s;
    if (!k) return;
    if (k.indexOf('flag:') === 0) { const flags = Object.assign({}, db.get('settings').flags); flags[k.slice(5)] = t.checked; db.patch('settings', { flags }); return; }
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (k === 'ignoreHosts') v = t.value.split('\n').map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
    if (k === 'siteUrl') v = t.value.trim().replace(/\/+$/, '') || PD.CONFIG.siteUrl;
    if (k === 'plan') { PD.plan.set(v); render(); PD.ui.toast('Plan changed to ' + PD.PLANS[v].label); return; }
    db.patch('settings', { [k]: v });
    PD.ui.toast('Saved');
  });
  document.addEventListener('change', async (e) => {
    if (e.target.id !== 'imp' || !e.target.files[0]) return;
    try { await db.importAll(JSON.parse(await e.target.files[0].text())); render(); PD.ui.toast('Backup imported'); } catch (err) { PD.ui.toast(err.message, 'error'); }
    e.target.value = '';
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (['login', 'devices', 'dashboard'].indexOf(a) >= 0) chrome.runtime.sendMessage({ type: 'PD_OPEN', page: a });
    else if (a === 'shortcuts') chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    else if (a === 'clear-history') { if (await PD.ui.confirm('Clear clipboard history? Pinned items are kept.', { danger: true, confirmLabel: 'Clear' })) { PD.history.clear(true); PD.ui.toast('History cleared'); } }
    else if (a === 'export') U.download('pastedeck-backup-' + U.dayKey() + '.json', JSON.stringify(db.exportAll(), null, 2));
    else if (a === 'import') document.getElementById('imp').click();
    else if (a === 'reset') { if (await PD.ui.confirm('Delete all PasteDeck data on this device?', { danger: true, confirmLabel: 'Delete everything', title: 'Reset PasteDeck' })) { await db.resetAll(); PD.devices.registerCurrent(); render(); PD.ui.toast('Reset complete'); } }
  });
})();
