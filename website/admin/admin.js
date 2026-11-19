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
      '<div class="grid3">' + stat('Total accounts', t.accounts) + stat('People on teams', t.members) + stat('Pending invitations', t.pendingInvites) + '</div>' +
      '<div class="grid3 block">' + stat('Free accounts', t.free) + stat('Premium accounts', t.premium) + stat('Active 14-day trials', t.activeTrials) + '</div>' +
      '<div class="grid3 block">' + stat('Extra seats sold', t.extraSeatsSold) + stat('Revenue (live, paid)', '$' + s.revenueUSD, 'Excludes test-mode and demo purchases') + stat('Test / demo volume', '$' + s.testOrDemoUSD) + '</div>' +
      '<div class="block"><h2>Recent payments</h2><div class="pd-card pd-table-wrap"><table class="pd-table"><thead><tr><th>Account</th><th>Item</th><th>Amount</th><th>Status</th><th>When</th></tr></thead><tbody>' +
      (s.recentPayments.length ? s.recentPayments.map((p) => '<tr><td>' + esc(p.accountEmail) + '</td><td>' + (p.type === 'seats' ? p.units + ' extra seat(s)' : 'Premium') + (p.test ? ' (test)' : '') + (p.demo ? ' (demo)' : '') + '</td><td>$' + esc(String(p.amountUSD)) + '</td><td>' + esc(p.status) + '</td><td>' + new Date(p.at).toLocaleString() + '</td></tr>').join('') : '<tr><td colspan="5" class="pd-muted">No payments yet.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="block"><h2>Most recent accounts</h2><div class="pd-card pd-table-wrap"><table class="pd-table"><thead><tr><th>Email</th><th>Plan</th><th>People</th><th>Created</th></tr></thead><tbody>' +
      (s.recentAccounts.length ? s.recentAccounts.map((a) => '<tr><td>' + esc(a.email) + '</td><td>' + esc(a.plan) + '</td><td>' + a.members + '</td><td>' + new Date(a.createdAt).toLocaleString() + '</td></tr>').join('') : '<tr><td colspan="4" class="pd-muted">No accounts yet.</td></tr>') +
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
