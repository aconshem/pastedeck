const store = require('./_lib/store');
const { ok, route, httpError } = require('./_lib/http');
const { authenticate } = require('./_lib/auth');

const dayKey = (off) => new Date(Date.now() - off * 86400000).toISOString().slice(0, 10);

exports.handler = route(null, async (event) => {
  const { account, me } = await authenticate(event, { type: 'web' });
  if (me.role !== 'owner' && !me.analyticsAccess) throw httpError(403, 'Analytics is limited to the account owner.');
  const data = await store.analytics.get(account.email);
  const nameFor = (id) => { const m = account.members.find((x) => x.id === id); return m ? m.name : 'Removed member'; };
  const sum = (inst, key) => (inst.days[key] || { snippets: 0, autofills: 0, captures: 0, savedSec: 0 });

  const days = [];
  for (let i = 29; i >= 0; i--) {
    const key = dayKey(i), t = { snippets: 0, autofills: 0, captures: 0, savedSec: 0 };
    Object.values(data.members || {}).forEach((mem) => Object.values(mem.installs || {}).forEach((inst) => { const x = sum(inst, key); t.snippets += x.snippets; t.autofills += x.autofills; t.captures += x.captures; t.savedSec += x.savedSec; }));
    days.push(Object.assign({ day: key }, t));
  }
  const cutoff = Date.now() - 14 * 86400000;
  const byMember = Object.keys(data.members || {}).map((id) => {
    const installs = Object.values(data.members[id].installs || {});
    return {
      memberId: id, name: nameFor(id), installations: installs.length,
      activeInstallations: installs.filter((i) => i.lastSeen > cutoff).length,
      lastActive: installs.reduce((a, i) => Math.max(a, i.lastSeen || 0), 0) || null,
      savedSec: installs.reduce((a, inst) => a + Object.values(inst.days).reduce((s, t) => s + (t.savedSec || 0), 0), 0),
    };
  }).sort((a, b) => b.savedSec - a.savedSec);
  return ok({ days, savedSecLast30Days: days.reduce((a, d) => a + d.savedSec, 0), byMember });
});
