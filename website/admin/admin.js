(function () {
  'use strict';
  const I = PD.icon, esc = PD.util.esc;
  const $ = (id) => document.getElementById(id);
  const KEY = 'pb_admin_token';

  async function fetchStats(token) {
    const res = await fetch('/.netlify/functions/admin-stats', { headers: { 'X-Admin-Token': token } });
    let data = {}; try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  }

  function render(s) {
    const t = s.totals;
    const stat = (label, val, sub) => '<div class="pd-card stat"><div class="stat__l">' + esc(label) + '</div><div class="stat__v">' + esc(String(val)) + '</div>' + (sub ? '<div class="stat__s">' + esc(sub) + '</div>' : '') + '</div>';
    $('wrap').innerHTML =
      '<div class="page-h"><div><h1>PasteBoard \u2014 platform admin</h1><p>' + (s.usingBlobs ? 'Reading live Netlify Blobs data.' : 'No Netlify Blobs deploy context \u2014 showing the local dev fallback store.') + '</p></div><div class="tools"><button class="pd-btn pd-btn--sm" id="refresh">' + I('refresh', 13) + ' Refresh</button><button class="pd-btn pd-btn--sm" id="logout">Log out</button></div></div>' +
      '<div class="grid3">' + stat('Total accounts', t.accounts) + stat('Active devices/users', t.totalDevices) + stat('Pending requests', t.pendingRequests) + '</div>' +
      '<div class="grid3 block">' + stat('Free', t.free) + stat('Free + Email', t.freeplus) + stat('Premium ($20)', t.premium) + '</div>' +
      '<div class="grid3 block">' + stat('Premium Pro ($40, paused)', t.premiumpro) + stat('Active 14-day trials', t.activeTrials) + stat('Extra seats ($2.50/mo each)', t.extraDevices) + '</div>' +
      '<div class="grid2 block">' +
      '<div class="pd-card stat"><div class="stat__l">Estimated revenue (one-time + extra seats)</div><div class="stat__v">$' + esc(String(s.revenueEstimateUSD)) + '</div><div class="stat__s">Card payments aren\u2019t connected yet \u2014 this is a running estimate, not money collected.</div></div>' +
      '<div class="pd-card stat"><div class="stat__l">Premium Pro interest (paused-plan CTA clicks)</div><div class="stat__v">' + s.premiumProInterest.allTime + '</div><div class="stat__s">' + s.premiumProInterest.last30Days + ' in the last 30 days</div></div></div>' +
      '<div class="block"><h2>Most recent accounts</h2><div class="pd-card pd-table-wrap"><table class="pd-table"><thead><tr><th>Email</th><th>Plan</th><th>Active devices</th><th>Created</th></tr></thead><tbody>' +
      (s.recentAccounts.length ? s.recentAccounts.map((a) => '<tr><td>' + esc(a.email) + '</td><td>' + esc(a.plan) + '</td><td>' + a.devices + '</td><td>' + new Date(a.createdAt).toLocaleString() + '</td></tr>').join('') : '<tr><td colspan="4" class="pd-muted">No accounts yet.</td></tr>') +
      '</tbody></table></div></div>';
    $('refresh').onclick = () => boot(sessionStorage.getItem(KEY));
    $('logout').onclick = () => { sessionStorage.removeItem(KEY); location.reload(); };
  }

  async function boot(token) {
    $('gate-err').textContent = '';
    try {
      const stats = await fetchStats(token);
      sessionStorage.setItem(KEY, token);
      $('gate').classList.add('pd-hidden'); $('wrap').classList.remove('pd-hidden');
      render(stats);
    } catch (e) { $('gate-err').textContent = e.message; sessionStorage.removeItem(KEY); }
  }

  $('enter').onclick = () => boot($('token').value.trim());
  $('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('enter').click(); });
  const stored = sessionStorage.getItem(KEY);
  if (stored) boot(stored);
})();
