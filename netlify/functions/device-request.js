const store = require('./_lib/store');
const { hashPassword, newId } = require('./_lib/crypto');
const { ok, bad, parseBody } = require('./_lib/http');

const EMAIL_RE = /^\S+@\S+\.\S+$/;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const b = parseBody(event);
  const ownerEmail = String(b.ownerEmail || '').trim().toLowerCase();
  const username = String(b.username || '').trim();
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');

  if (!EMAIL_RE.test(ownerEmail)) return bad('Enter the account owner\u2019s email.');
  if (!username || !name) return bad('Username and name are required.');
  if (!EMAIL_RE.test(email)) return bad('Enter a valid email address.');
  if (password.length < 8) return bad('Password must be at least 8 characters.');

  const account = await store.accounts.get(ownerEmail);
  if (!account) return bad('No PasteBoard account uses that owner email.', 404);
  if ((account.devices || []).some((d) => d.email.toLowerCase() === email)) return bad('That email is already on this account.', 409);

  const included = account.plan === 'premium' ? 5 : account.plan === 'premiumpro' ? Infinity : 1;
  const activeCount = account.devices.filter((d) => d.status === 'active').length;
  const device = {
    id: newId('dev'), username, name, email, passwordHash: hashPassword(password),
    role: 'member', status: 'pending', analyticsAccess: false, createdAt: Date.now(), lastLoginAt: null,
    extra: activeCount >= included, // beyond the plan's included seats — flagged for the $2.5/device add-on
  };
  account.devices.push(device);
  await store.accounts.save(account);
  return ok({ requested: true, message: 'Request sent. ' + (account.devices.find((d) => d.role === 'owner') || {}).name + ' needs to approve it before you can sign in.' });
};
