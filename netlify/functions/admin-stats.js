const store = require('./_lib/store');
const { ok, route } = require('./_lib/http');
const { requireAdmin } = require('./_lib/admin');
const { effective, seats } = require('./_lib/entitlements');

exports.handler = route(null, async (event) => {
  requireAdmin(event);
  const accounts = await store.accounts.all();
  const t = { accounts: accounts.length, free: 0, premium: 0, activeTrials: 0, members: 0, pendingInvites: 0, extraSeatsSold: 0 };
  let revenue = 0, testRevenue = 0;
  const recentPayments = [];
  accounts.forEach((a) => {
    const e = effective(a); t[e.plan]++; if (e.source === 'trial') t.activeTrials++;
    const s = seats(a); t.members += s.used; t.pendingInvites += s.reserved;
    (a.purchases || []).forEach((p) => {
      if (p.status === 'paid' && p.type === 'seats') t.extraSeatsSold += p.units;
      const row = { accountEmail: a.email, type: p.type, units: p.units, amountUSD: p.amountUSD, at: p.at, status: p.status, test: !!p.test, demo: !!p.demo };
      recentPayments.push(row);
      if (p.status === 'paid' && p.amountUSD) { if (p.test || p.demo) testRevenue += p.amountUSD; else revenue += p.amountUSD; }
    });
  });
  recentPayments.sort((x, y) => y.at - x.at);
  return ok({
    usingBlobs: store.usingBlobs(), totals: t,
    revenueUSD: Math.round(revenue * 100) / 100, // real, paid, live-mode only: test-mode and demo purchases are excluded
    testOrDemoUSD: Math.round(testRevenue * 100) / 100,
    recentPayments: recentPayments.slice(0, 25),
    recentAccounts: accounts.map((a) => ({ email: a.email, plan: effective(a).plan, createdAt: a.createdAt, members: seats(a).used })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 25),
  });
});
