const store = require('./_lib/store');
const { hashPassword, verifyPassword } = require('./_lib/crypto');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const A = require('./_lib/accounts');
const { authenticate, startSession, webToken } = require('./_lib/auth');

const FRESH_MS = 15 * 60000;
/* Needs the current password, OR a session that was started in the last 15 minutes by a passkey sign-in — that is the
   "I forgot my password but have a passkey" recovery path. */
exports.handler = route('POST', async (event) => {
  const { account, me } = await authenticate(event);
  const b = parseBody(event);
  const freshPasskey = me.sidMethod === 'passkey' && Date.now() - (me.sidIssuedAt || 0) < FRESH_MS;
  if (!freshPasskey) {
    if (!b.currentPassword || !(await verifyPassword(String(b.currentPassword), me.passwordHash))) throw httpError(403, 'Your current password is incorrect.');
  }
  const next = A.checkPassword(b.newPassword, me.email);
  const hash = await hashPassword(next);
  await store.accounts.update(account.email, (acc) => { acc.members.find((x) => x.id === me.id).passwordHash = hash; });
  // New session id: signs out any other device that might have been using the old password.
  const sid = await startSession(account.email, me.id, 'password');
  const fresh = await store.accounts.get(account.email);
  const m = fresh.members.find((x) => x.id === me.id);
  return ok(A.sessionResponse(fresh, m, webToken(fresh, m, sid)));
});
