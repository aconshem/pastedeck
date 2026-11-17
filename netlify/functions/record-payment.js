const store = require('./_lib/store');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const { requireAdmin } = require('./_lib/admin');
const { applyPurchase } = require('./_lib/purchases');
const { newId } = require('./_lib/crypto');
const { PRICING } = require('./_lib/config');

/* Admin-only: record an offline payment (e.g. a bank transfer) and grant what was bought, using the same code path
   as a provider payment. Body: { accountEmail, type: 'premium'|'seats', units?, amountUSD?, note? } */
exports.handler = route('POST', async (event) => {
  requireAdmin(event);
  const b = parseBody(event);
  const email = String(b.accountEmail || '').trim().toLowerCase();
  const type = b.type === 'seats' ? 'seats' : b.type === 'premium' ? 'premium' : null;
  if (!email || !type) throw httpError(400, 'accountEmail and type (premium|seats) are required.');
  if (!(await store.accounts.get(email))) throw httpError(404, 'No account uses that email.');
  const units = type === 'seats' ? Math.max(1, parseInt(b.units, 10) || 1) : 1;
  const amountUSD = b.amountUSD != null ? Number(b.amountUSD) : (type === 'premium' ? PRICING.premiumUSD : units * PRICING.extraSeatUSD);
  const r = await applyPurchase(email, { provider: 'manual', type, units, orderId: newId('manual'), amountCents: Math.round(amountUSD * 100), currency: 'USD', test: false });
  return ok({ recorded: r.applied });
});
