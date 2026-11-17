/* The extension asks this on startup and every few minutes. It is the ONLY source of the extension's plan: the
   extension never trusts a plan stored locally. A revoked/removed/signed-out-elsewhere member gets 401/403, which the
   extension treats as "unlink and fall back to Free". */
const { ok, route } = require('./_lib/http');
const { authenticate } = require('./_lib/auth');
const { effective, seatLimit } = require('./_lib/entitlements');
const store = require('./_lib/store');

exports.handler = route(null, async (event) => {
  const { account, me } = await authenticate(event, { type: 'ext' });
  const e = effective(account);
  const owner = account.members.find((m) => m.role === 'owner');
  await store.accounts.update(account.email, (acc) => { acc.members.find((m) => m.id === me.id).lastActive = Date.now(); });
  return ok({
    plan: e.plan, planSource: e.source, trialEndsAt: e.trialEndsAt, seatLimit: seatLimit(account),
    member: { id: me.id, name: me.name, email: me.email, role: me.role },
    accountEmail: account.email, accountName: owner ? owner.name : account.email,
    validForMs: 7 * 86400000, // if the extension can't reach us for longer than this it drops back to Free
  });
});
