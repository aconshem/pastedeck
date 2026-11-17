/*
 * Authentication for every protected endpoint. A valid signature is NOT enough: the member's *current* session id
 * must match the token's `sid`. Logging in anywhere else rotates `sid`, so every older token (web or extension) is
 * rejected on its very next request — this is the "one email, one signed-in device at a time" rule — and revoking a
 * member clears `sid`, so removal takes effect immediately rather than when the token happens to expire.
 */
const store = require('./store');
const { verifyToken, signToken, randomToken } = require('./crypto');
const { bearer, httpError } = require('./http');
const { SESSION_TTL_S } = require('./config');
const { activeMembers, seatLimit, enforceSeatLimit } = require('./entitlements');

async function authenticate(event, opts) {
  opts = opts || {};
  const payload = verifyToken(bearer(event));
  if (!payload || !payload.accountEmail || !payload.memberId) throw httpError(401, 'Sign in again.', { code: 'SESSION_INVALID' });
  let account = await store.accounts.get(payload.accountEmail);
  if (!account) throw httpError(401, 'Sign in again.', { code: 'SESSION_INVALID' });
  // A lapsed trial or a refund can leave more active people than seats: revoke the newest ones, lazily, on first contact.
  if (activeMembers(account).length > seatLimit(account)) account = await store.accounts.update(account.email, (acc) => { enforceSeatLimit(acc); });
  const me = (account.members || []).find((m) => m.id === payload.memberId);
  if (!me) throw httpError(403, 'This access has been removed.', { code: 'ACCESS_REMOVED' });
  if (me.status !== 'active') throw httpError(403, 'This access has been revoked. Contact your account owner.', { code: 'ACCESS_REVOKED' });
  if (!me.sid || me.sid !== payload.sid) throw httpError(401, 'You were signed out because this account signed in on another device.', { code: 'SIGNED_IN_ELSEWHERE' });
  if (opts.type && payload.typ !== opts.type) throw httpError(401, 'Wrong kind of session.', { code: 'SESSION_INVALID' });
  if (opts.role && !opts.role.includes(me.role)) throw httpError(403, 'You do not have permission to do this.');
  return { payload, account, me };
}

/* Starts a brand-new session for a member, replacing (and thereby logging out) whatever session existed before. */
async function startSession(accountEmail, memberId, method) {
  const sid = randomToken(18);
  await store.accounts.update(accountEmail, (acc) => {
    const m = acc.members.find((x) => x.id === memberId);
    m.sid = sid; m.sidMethod = method || 'password'; m.sidIssuedAt = Date.now(); m.lastLoginAt = Date.now();
  });
  return sid;
}
function webToken(account, member, sid) {
  return signToken({ typ: 'web', accountEmail: account.email, memberId: member.id, role: member.role, sid }, SESSION_TTL_S);
}
/* The extension's token carries the same sid, so one login = one session shared by that person's web tab and extension. */
function extToken(account, member, sid) {
  return signToken({ typ: 'ext', accountEmail: account.email, memberId: member.id, role: member.role, sid }, SESSION_TTL_S);
}
module.exports = { authenticate, startSession, webToken, extToken };
