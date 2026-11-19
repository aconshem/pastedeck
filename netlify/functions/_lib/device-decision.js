const store = require('./store');
const { verifyToken } = require('./crypto');
const { ok, bad, parseBody, bearer } = require('./http');

async function decide(event, decision) {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const payload = verifyToken(bearer(event));
  if (!payload) return bad('Sign in again.', 401);
  const account = await store.accounts.get(payload.accountEmail);
  if (!account) return bad('Account not found.', 404);
  if (payload.role !== 'owner') return bad('Only the account owner can do this.', 403);

  const { deviceId } = parseBody(event);
  const device = (account.devices || []).find((d) => d.id === deviceId);
  if (!device) return bad('Request not found \u2014 it may already have been handled.', 404);
  if (device.status !== 'pending') return bad('This request was already ' + device.status + '.', 409);

  if (decision === 'approve') device.status = 'active';
  else account.devices = account.devices.filter((d) => d.id !== deviceId);
  await store.accounts.save(account);
  return ok({ decision, deviceId });
}
module.exports = { decide };
