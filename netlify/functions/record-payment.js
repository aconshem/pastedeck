const store = require('./_lib/store');
const { ok, bad, parseBody } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const token = event.headers['x-admin-token'] || event.headers['X-Admin-Token'];
  const expected = process.env.PASTEBOARD_ADMIN_TOKEN;
  if (!expected) return bad('PASTEBOARD_ADMIN_TOKEN is not set on the server.', 500);
  if (token !== expected) return bad('Not authorized.', 401);

  const b = parseBody(event);
  const accountEmail = String(b.accountEmail || '').trim().toLowerCase();
  const amountUSD = Number(b.amountUSD);
  if (!accountEmail) return bad('accountEmail is required.');
  if (!isFinite(amountUSD) || amountUSD <= 0) return bad('amountUSD must be a positive number.');

  const account = await store.accounts.get(accountEmail);
  if (!account) return bad('No account uses that email.', 404);

  const entry = {
    accountEmail, amountUSD,
    plan: b.plan && ['free', 'freeplus', 'premium', 'premiumpro'].includes(b.plan) ? b.plan : account.plan,
    method: String(b.method || 'manual').slice(0, 40),
    note: String(b.note || '').slice(0, 300),
    at: Date.now(),
  };
  await store.payments.add(entry);
  return ok({ recorded: entry });
};
