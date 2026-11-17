const store = require('./_lib/store');
const { hashPassword } = require('./_lib/crypto');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const A = require('./_lib/accounts');
const { startSession, webToken } = require('./_lib/auth');

/* Every new account starts on Free. The plan, trial and seats are decided here, never by the request body:
   there is no `plan` or `cardCollected` field to forge. Premium comes only from a verified payment or the
   one-time server-side trial (trial-start.js). */
exports.handler = route('POST', async (event) => {
  const b = parseBody(event);
  const email = A.checkEmail(A.normEmail(b.email));
  const password = A.checkPassword(b.password, email);
  const name = A.cleanName(b.name, null);
  if (!name) throw httpError(400, 'Enter your full name.');
  const username = A.cleanName(b.username, email.split('@')[0]);
  if (b.acceptedTerms !== true) throw httpError(400, 'You must accept the Terms of Service and Privacy Policy to create an account.');
  if (!(await A.allow('signup:' + email, 5, 3600000))) throw httpError(429, 'Too many attempts. Try again later.');

  const member = A.newMember({ username, name, email, passwordHash: await hashPassword(password), role: 'owner', analyticsAccess: true, marketingOptIn: b.marketingOptIn === true });
  // Atomic: only one request can ever claim an email address, however many arrive at once.
  if (!(await store.emailIndex.claim(email, { accountEmail: email, memberId: member.id }))) throw httpError(409, 'An account with that email already exists. Try logging in.');
  const account = {
    email, createdAt: Date.now(), members: [member], invitations: [], purchases: [],
    entitlements: { premium: null, extraSeats: 0 }, trial: null,
  };
  if (!(await store.accounts.create(account))) { await store.emailIndex.release(email); throw httpError(409, 'An account with that email already exists. Try logging in.'); }

  A.sendVerification(account, member).catch(() => {}); // best-effort; the account works while verification is pending
  const sid = await startSession(email, member.id, 'password');
  const fresh = await store.accounts.get(email);
  const m = fresh.members[0];
  return ok(Object.assign(A.sessionResponse(fresh, m, webToken(fresh, m, sid)), { verificationSent: true }));
});
