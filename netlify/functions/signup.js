const store = require('./_lib/store');
const { hashPassword, signToken, newId } = require('./_lib/crypto');
const { ok, bad, parseBody } = require('./_lib/http');

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const VALID_PLANS = ['free', 'freeplus', 'premium', 'premiumpro'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const b = parseBody(event);
  const username = String(b.username || '').trim();
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const plan = VALID_PLANS.includes(b.plan) ? b.plan : 'free';

  if (!username || !name) return bad('Username and name are required.');
  if (!EMAIL_RE.test(email)) return bad('Enter a valid email address.');
  if (password.length < 8) return bad('Password must be at least 8 characters.');
  if (await store.accounts.get(email)) return bad('An account with that email already exists.', 409);

  const now = Date.now();
  const isPaid = plan === 'premium' || plan === 'premiumpro';
  const account = {
    email, plan, createdAt: now,
    verifiedEmail: false,
    // Paid plans start a 14-day trial with everything unlocked; the card is only collected on the front end for
    // now (no processor connected yet — see docs/architecture.md), so nothing is actually charged here.
    trial: isPaid ? { startedAt: now, endsAt: now + 14 * 86400000 } : null,
    billing: { cardCollected: !!b.cardCollected, chargedAt: null },
    devices: [{
      id: newId('dev'), username, name, email, passwordHash: hashPassword(password),
      role: 'owner', status: 'active', analyticsAccess: true, createdAt: now, lastLoginAt: now,
    }],
  };
  await store.accounts.save(account);
  const token = signToken({ accountEmail: email, deviceId: account.devices[0].id, role: 'owner' });
  return ok({ token, accountEmail: email, deviceId: account.devices[0].id, role: 'owner', plan, trial: account.trial });
};
