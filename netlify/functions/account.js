const store = require('./_lib/store');
const { verifyToken } = require('./_lib/crypto');
const { ok, bad, bearer } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  const payload = verifyToken(bearer(event));
  if (!payload) return bad('Sign in again.', 401);
  const account = await store.accounts.get(payload.accountEmail);
  if (!account) return bad('Account not found.', 404);
  const me = (account.devices || []).find((d) => d.id === payload.deviceId);
  if (!me || me.status !== 'active') return bad('This access is no longer active.', 403);

  const included = account.plan === 'premium' ? 5 : account.plan === 'premiumpro' ? Infinity : 1;
  return ok({
    email: account.email, plan: account.plan, trial: account.trial, billing: account.billing,
    includedDevices: isFinite(included) ? included : null,
    extraDevicePriceUSD: 2.5,
    you: { deviceId: me.id, name: me.name, role: me.role, analyticsAccess: !!me.analyticsAccess },
    devices: account.devices.map((d) => ({ id: d.id, username: d.username, name: d.name, email: d.email, role: d.role, status: d.status, analyticsAccess: !!d.analyticsAccess, lastLoginAt: d.lastLoginAt, lastActive: d.lastActive || null, extra: !!d.extra })),
  });
};
