const store = require('./_lib/store');
const { ok, bad } = require('./_lib/http');

const PRICES = { free: 0, freeplus: 0, premium: 20, premiumpro: 40 };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  const token = event.headers['x-admin-token'] || event.headers['X-Admin-Token'];
  const expected = process.env.PASTEBOARD_ADMIN_TOKEN;
  if (!expected) return bad('PASTEBOARD_ADMIN_TOKEN is not set on the server.', 500);
  if (token !== expected) return bad('Not authorized.', 401);

  const all = await store.accounts.all();
  const accounts = Object.values(all);
  const byPlan = { free: 0, freeplus: 0, premium: 0, premiumpro: 0 };
  let totalDevices = 0, pendingRequests = 0, activeTrials = 0, extraDevices = 0, revenue = 0;
  const recent = [];

  accounts.forEach((a) => {
    byPlan[a.plan] = (byPlan[a.plan] || 0) + 1;
    revenue += PRICES[a.plan] || 0;
    (a.devices || []).forEach((d) => {
      if (d.status === 'active') totalDevices++;
      if (d.status === 'pending') pendingRequests++;
      if (d.extra && d.status === 'active') extraDevices++;
    });
    if (a.trial && a.trial.endsAt > Date.now()) activeTrials++;
    recent.push({ email: a.email, plan: a.plan, createdAt: a.createdAt, devices: (a.devices || []).filter((d) => d.status === 'active').length });
  });
  revenue += extraDevices * 2.5;
  recent.sort((x, y) => y.createdAt - x.createdAt);

  const interest = await store.interest.all();
  const last30 = Date.now() - 30 * 86400000;
  const interestRecent = interest.filter((i) => i.at >= last30);

  return ok({
    usingBlobs: store.usingBlobs(),
    totals: Object.assign({ accounts: accounts.length }, byPlan, { totalDevices, pendingRequests, extraDevices, activeTrials }),
    revenueEstimateUSD: Math.round(revenue * 100) / 100,
    premiumProInterest: { allTime: interest.length, last30Days: interestRecent.length },
    recentAccounts: recent.slice(0, 25),
  });
};
