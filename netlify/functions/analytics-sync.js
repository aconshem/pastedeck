const store = require('./_lib/store');
const { verifyToken } = require('./_lib/crypto');
const { ok, bad, parseBody, bearer } = require('./_lib/http');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const payload = verifyToken(bearer(event));
  if (!payload) return bad('Sign in again.', 401);

  const account = await store.accounts.get(payload.accountEmail);
  if (!account) return bad('Account not found.', 404);
  const device = (account.devices || []).find((d) => d.id === payload.deviceId);
  if (!device || device.status !== 'active') return bad('This access is no longer active.', 403);

  const b = parseBody(event);
  const day = DAY_RE.test(b.day) ? b.day : new Date().toISOString().slice(0, 10);
  const totals = {
    snippets: Math.max(0, +b.snippets || 0),
    autofills: Math.max(0, +b.autofills || 0),
    captures: Math.max(0, +b.captures || 0),
    savedSec: Math.max(0, +b.savedSec || 0),
  };

  // Idempotent: the device sends its own cumulative totals for that day each time, so repeated syncs never double-count.
  await store.analytics.setDeviceDay(payload.accountEmail, payload.deviceId, day, totals);

  device.lastActive = Date.now();
  await store.accounts.save(account);
  return ok({ ok: true });
};
