const store = require('./_lib/store');
const { ok, parseBody, route } = require('./_lib/http');
const A = require('./_lib/accounts');
const { mail } = require('./_lib/email');
const { BASE_URL, RESET_TTL_MS } = require('./_lib/config');

/* Always answers the same way, so this endpoint can't be used to discover which emails have accounts. */
exports.handler = route('POST', async (event) => {
  const email = A.normEmail(parseBody(event).email);
  const generic = ok({ ok: true, message: 'If an account exists for that email, we’ve sent a link to reset the password. It works once and expires in 30 minutes.' });
  if (!A.EMAIL_RE.test(email)) return generic;
  if (!(await A.allow('forgot:' + email, 3, 3600000))) return generic;
  const ix = await store.emailIndex.get(email);
  const account = ix && (await store.accounts.get(ix.accountEmail));
  const member = account && account.members.find((m) => m.id === ix.memberId);
  if (!member || member.status === 'removed') return generic;
  const raw = await A.issueToken('reset', { accountEmail: account.email, memberId: member.id }, RESET_TTL_MS);
  await mail.reset(member.email, BASE_URL + '/reset-password/index.html?token=' + encodeURIComponent(raw));
  return generic;
});
