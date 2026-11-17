const store = require('./_lib/store');
const { hashPassword, verifyPassword, needsRehash } = require('./_lib/crypto');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const A = require('./_lib/accounts');
const { startSession, webToken } = require('./_lib/auth');

const DUMMY = 's2:00000000000000000000000000000000:' + '0'.repeat(128);
const MAX_FAILS = 8, LOCK_MS = 15 * 60000;

exports.handler = route('POST', async (event) => {
  const b = parseBody(event);
  const email = A.normEmail(b.email), password = String(b.password || '');
  if (!email || !password) throw httpError(400, 'Enter your email and password.');
  if (!(await A.allow('login:' + email, 30, 900000))) throw httpError(429, 'Too many attempts. Wait a few minutes and try again.');

  const ix = await store.emailIndex.get(email);
  const account = ix && (await store.accounts.get(ix.accountEmail));
  const member = account && account.members.find((m) => m.id === ix.memberId);
  if (!member) { await verifyPassword(password, DUMMY); throw httpError(401, 'Incorrect email or password.'); } // same timing as a real check
  if (member.failed && member.failed.until > Date.now()) throw httpError(429, 'Too many wrong passwords. This account is locked for a few minutes — you can reset your password by email.');

  const good = await verifyPassword(password, member.passwordHash);
  if (!good) {
    await store.accounts.update(account.email, (acc) => { const m = acc.members.find((x) => x.id === member.id); m.failed = m.failed || { count: 0, until: 0 }; m.failed.count++; if (m.failed.count >= MAX_FAILS) { m.failed = { count: 0, until: Date.now() + LOCK_MS }; } });
    throw httpError(401, 'Incorrect email or password.');
  }
  if (member.status !== 'active') throw httpError(403, 'This access has been revoked. Contact your account owner.', { code: 'ACCESS_REVOKED' });

  const rehash = needsRehash(member.passwordHash) ? await hashPassword(password) : null;
  // A new session id replaces the old one: whichever device was signed in before is signed out on its next request.
  const sid = await startSession(account.email, member.id, 'password');
  await store.accounts.update(account.email, (acc) => { const m = acc.members.find((x) => x.id === member.id); m.failed = { count: 0, until: 0 }; if (rehash) m.passwordHash = rehash; });
  const fresh = await store.accounts.get(account.email);
  const m = fresh.members.find((x) => x.id === member.id);
  return ok(A.sessionResponse(fresh, m, webToken(fresh, m, sid)));
});
