const store = require('./_lib/store');
const { hashPassword } = require('./_lib/crypto');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const A = require('./_lib/accounts');

/* GET-style check is done by the page calling with {check:true}; POST with {token, password} sets the password.
   Using the link proves the person controls the mailbox, so it also verifies the email. Every existing session is
   ended (sid cleared) so a stolen session can't outlive a password reset. */
exports.handler = route('POST', async (event) => {
  const b = parseBody(event);
  if (b.check) return ok({ valid: !!(await A.peekToken('reset', b.token)) });
  const password = A.checkPassword(b.password); // validate BEFORE consuming, so a too-short password doesn't burn the link
  const rec = await A.consumeToken('reset', b.token);
  if (!rec) throw httpError(400, 'This reset link is invalid, already used, or expired. Request a new one.');
  const hash = await hashPassword(password);
  await store.accounts.update(rec.accountEmail, (acc) => {
    const m = acc.members.find((x) => x.id === rec.memberId);
    if (!m) throw httpError(404, 'Account not found.');
    m.passwordHash = hash; m.emailVerified = true; m.sid = null; m.failed = { count: 0, until: 0 };
  });
  return ok({ ok: true });
});
