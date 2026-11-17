/*
 * Extension <-> account pairing. The long-lived session token NEVER travels through window.postMessage.
 *   1. The signed-in website calls  {action:'create'}  -> a one-time code that works for 2 minutes.
 *   2. The website hands only that code to the extension (content/bridge.js accepts exactly one message type).
 *   3. The extension's service worker calls  {action:'exchange', code, installId}  -> receives its own session token.
 * The code is bound to the member's *current* session id, so if they log in elsewhere in between, the exchange fails.
 */
const store = require('./_lib/store');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const A = require('./_lib/accounts');
const { authenticate, extToken } = require('./_lib/auth');
const { PAIR_TTL_MS } = require('./_lib/config');
const { effective } = require('./_lib/entitlements');

exports.handler = route('POST', async (event) => {
  const b = parseBody(event);
  if (b.action === 'create') {
    const { account, me, payload } = await authenticate(event, { type: 'web' });
    const code = await A.issueToken('pair', { accountEmail: account.email, memberId: me.id, sid: payload.sid }, PAIR_TTL_MS);
    return ok({ code, expiresInSec: PAIR_TTL_MS / 1000 });
  }
  if (b.action === 'exchange') {
    if (!(await A.allow('pair:' + String(b.installId || '').slice(0, 64), 20, 600000))) throw httpError(429, 'Too many attempts.');
    const rec = await A.consumeToken('pair', b.code);
    if (!rec) throw httpError(400, 'This link code expired. Click Connect account in the extension again.');
    const account = await store.accounts.get(rec.accountEmail);
    const me = account && account.members.find((m) => m.id === rec.memberId);
    if (!me || me.status !== 'active' || me.sid !== rec.sid) throw httpError(401, 'That sign-in is no longer current. Log in again and retry.');
    const e = effective(account);
    const owner = account.members.find((m) => m.role === 'owner');
    return ok({
      token: extToken(account, me, me.sid), accountEmail: account.email, accountName: owner ? owner.name : account.email,
      memberId: me.id, name: me.name, email: me.email, role: me.role, plan: e.plan, planSource: e.source, trialEndsAt: e.trialEndsAt,
    });
  }
  throw httpError(400, 'Unknown action.');
});
