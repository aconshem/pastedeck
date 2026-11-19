const store = require('./_lib/store');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const { requireAdmin } = require('./_lib/admin');
const { getProvider } = require('./_lib/payment-provider');
const { applyRefundEvent } = require('./_lib/purchases');

/* Admin-only. Body: { orderId }. Asks the provider to refund the order's transaction in full. For provider orders the
   entitlement is removed when the provider's `refund.created` webhook arrives (so we only revoke money that really went
   back); manual/bank-transfer purchases have no webhook, so they are reversed immediately. */
exports.handler = route('POST', async (event) => {
  requireAdmin(event);
  const { orderId } = parseBody(event);
  const idx = orderId && (await store.kv.get('ord/' + orderId));
  if (!idx) throw httpError(404, 'Unknown order.');
  const account = await store.accounts.get(idx.accountEmail);
  const p = (account.purchases || []).find((x) => x.orderId === orderId);
  if (!p || p.status !== 'paid') throw httpError(409, 'That order is not in a refundable state.');
  if (p.provider === 'manual') { await applyRefundEvent({ kind: 'purchase.refunded', orderId, partial: false }); return ok({ status: 'reversed' }); }
  if (!p.transactionId) throw httpError(409, 'No transaction id on record for that order.');
  const r = await getProvider().refund({ transactionId: p.transactionId });
  return ok({ status: r.status, note: 'Entitlement is removed when the refund webhook arrives.' });
});
