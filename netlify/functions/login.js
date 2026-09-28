const store = require('./_lib/store');
const { verifyPassword, signToken } = require('./_lib/crypto');
const { ok, bad, parseBody } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const b = parseBody(event);
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!email || !password) return bad('Enter your email and password.');

  const all = await store.accounts.all();
  for (const accountEmail in all) {
    const account = all[accountEmail];
    const device = (account.devices || []).find((d) => d.email.toLowerCase() === email);
    if (!device) continue;
    if (device.status === 'revoked' || device.status === 'rejected') return bad('This access has been revoked. Contact your account owner.', 403);
    if (device.status === 'pending') return bad('Your access request is still waiting for approval.', 403);
    if (!verifyPassword(password, device.passwordHash)) return bad('Incorrect email or password.', 401);
    device.lastLoginAt = Date.now();
    await store.accounts.save(account);
    const token = signToken({ accountEmail, deviceId: device.id, role: device.role });
    return ok({ token, accountEmail, deviceId: device.id, role: device.role, name: device.name, plan: account.plan });
  }
  return bad('Incorrect email or password.', 401);
};
