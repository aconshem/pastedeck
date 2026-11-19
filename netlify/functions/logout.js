const store = require('./_lib/store');
const { ok, route } = require('./_lib/http');
const { authenticate } = require('./_lib/auth');
/* Ends the session everywhere (web tab and the linked extension share one session id). */
exports.handler = route('POST', async (event) => {
  const { account, me } = await authenticate(event);
  await store.accounts.update(account.email, (acc) => { const m = acc.members.find((x) => x.id === me.id); m.sid = null; });
  return ok({ ok: true });
});
