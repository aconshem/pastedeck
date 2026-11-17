const store = require('./_lib/store');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const A = require('./_lib/accounts');
const { authenticate } = require('./_lib/auth');
const { mail } = require('./_lib/email');

exports.handler = route('POST', async (event) => {
  const b = parseBody(event);
  if (b.resend) { // authenticated "send me another verification email"
    const { account, me } = await authenticate(event);
    if (me.emailVerified) return ok({ ok: true, alreadyVerified: true });
    if (!(await A.allow('verify:' + me.email, 3, 3600000))) throw httpError(429, 'Too many requests. Try again later.');
    const r = await A.sendVerification(account, me);
    if (!r.sent && !r.dev) throw httpError(502, r.error || 'Could not send the email.');
    return ok({ ok: true });
  }
  const rec = await A.consumeToken('verify', b.token);
  if (!rec) throw httpError(400, 'This verification link is invalid or has expired. Log in and request a new one from Settings.');
  await store.accounts.update(rec.accountEmail, (acc) => { const m = acc.members.find((x) => x.id === rec.memberId); if (m) m.emailVerified = true; });
  return ok({ ok: true });
});
