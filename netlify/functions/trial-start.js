const store = require('./_lib/store');
const { ok, route, httpError } = require('./_lib/http');
const { authenticate } = require('./_lib/auth');
const { PRICING } = require('./_lib/config');

/* The 14-day Premium trial: server-side, once per account (and an email can only ever belong to one account), needs a
   verified email, collects no card, and never charges. Reinstalling or clearing extension storage cannot restart it. */
exports.handler = route('POST', async (event) => {
  const { account, me } = await authenticate(event, { role: ['owner'], type: 'web' });
  if (!me.emailVerified) throw httpError(403, 'Verify your email address to start the free trial. Check your inbox, or resend the link from Settings.', { code: 'EMAIL_NOT_VERIFIED' });
  const out = await store.accounts.update(account.email, (acc) => {
    if (acc.trial) throw httpError(409, 'The free trial has already been used on this account.');
    if (acc.entitlements && acc.entitlements.premium && acc.entitlements.premium.active) throw httpError(409, 'You already have Premium.');
    acc.trial = { startedAt: Date.now(), endsAt: Date.now() + PRICING.trialDays * 86400000 };
  });
  return ok({ ok: true, trialEndsAt: out.trial.endsAt });
});
