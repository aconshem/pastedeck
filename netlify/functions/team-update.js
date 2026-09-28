const store = require('./_lib/store');
const { verifyToken } = require('./_lib/crypto');
const { ok, bad, parseBody, bearer } = require('./_lib/http');

const ACTIONS = ['setAnalyticsAccess', 'setRole', 'revoke', 'restore', 'remove'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const payload = verifyToken(bearer(event));
  if (!payload) return bad('Sign in again.', 401);
  const account = await store.accounts.get(payload.accountEmail);
  if (!account) return bad('Account not found.', 404);
  if (payload.role !== 'owner') return bad('Only the account owner can manage the team.', 403);

  const b = parseBody(event);
  if (!ACTIONS.includes(b.action)) return bad('Unknown action.');
  const device = account.devices.find((d) => d.id === b.deviceId);
  if (!device) return bad('That device/user was not found.', 404);
  if (device.role === 'owner') return bad('The owner\u2019s own access can\u2019t be changed here.');

  if (b.action === 'setAnalyticsAccess') device.analyticsAccess = !!b.value;
  else if (b.action === 'setRole') device.role = b.value === 'admin' ? 'admin' : 'member';
  else if (b.action === 'revoke') device.status = 'revoked';
  else if (b.action === 'restore') device.status = 'active';
  else if (b.action === 'remove') account.devices = account.devices.filter((d) => d.id !== device.id);

  await store.accounts.save(account);
  return ok({ ok: true });
};
