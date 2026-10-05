const store = require('./_lib/store');
const { verifyToken } = require('./_lib/crypto');
const { ok, bad, bearer } = require('./_lib/http');

function dayKey(offsetDays) {
  const d = new Date(Date.now() - offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  const payload = verifyToken(bearer(event));
  if (!payload) return bad('Sign in again.', 401);
  const account = await store.accounts.get(payload.accountEmail);
  if (!account) return bad('Account not found.', 404);
  const me = (account.devices || []).find((d) => d.id === payload.deviceId);
  if (!me || me.status !== 'active') return bad('This access is no longer active.', 403);
  if (me.role !== 'owner' && !me.analyticsAccess) return bad('Analytics is limited to the account owner.', 403);

  const data = await store.analytics.get(payload.accountEmail);
  const nameFor = (id) => { const d = (account.devices || []).find((x) => x.id === id); return d ? d.name : 'Removed device'; };

  const days = [];
  for (let i = 29; i >= 0; i--) {
    const key = dayKey(i);
    const totals = { snippets: 0, autofills: 0, captures: 0, savedSec: 0 };
    Object.values(data.devices || {}).forEach((dev) => { const t = dev.days[key]; if (t) { totals.snippets += t.snippets; totals.autofills += t.autofills; totals.captures += t.captures; totals.savedSec += t.savedSec; } });
    days.push(Object.assign({ day: key }, totals));
  }
  const byDevice = Object.keys(data.devices || {}).map((id) => {
    const dev = data.devices[id];
    const savedSec = Object.values(dev.days).reduce((a, t) => a + (t.savedSec || 0), 0);
    return { deviceId: id, name: nameFor(id), savedSec };
  }).sort((a, b) => b.savedSec - a.savedSec);

  return ok({
    days,
    savedSecLast30Days: days.reduce((a, d) => a + d.savedSec, 0),
    byDevice,
  });
};
