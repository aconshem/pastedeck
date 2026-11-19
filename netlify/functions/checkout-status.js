const store = require('./_lib/store');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const { authenticate } = require('./_lib/auth');
const { getProvider } = require('./_lib/payment-provider');
const { applyCompletedEvent } = require('./_lib/purchases');

/* Called by the dashboard after the customer returns from the hosted checkout. The browser redirect itself proves
   nothing, so this asks the payment provider's API directly ("authoritative verification") and applies the very same
   idempotent entitlement logic the webhook uses. Whichever of the two arrives first wins; the other is a no-op. */
exports.handler = route('POST', async (event) => {
  const { account } = await authenticate(event, { role: ['owner'], type: 'web' });
  const { requestId } = parseBody(event);
  const rec = requestId ? await store.kv.get('chk/' + String(requestId).slice(0, 64)) : null;
  if (!rec || rec.accountEmail !== account.email) throw httpError(404, 'Checkout not found.');
  if (rec.status === 'completed') return ok({ status: 'completed' });
  const provider = getProvider();
  const co = await provider.getCheckout(rec.providerCheckoutId);
  if (!co.completed) return ok({ status: co.status || 'pending' });
  const r = await applyCompletedEvent(provider, Object.assign({}, co, { requestId: rec.requestId || requestId, paid: true }), 'api');
  return ok({ status: 'completed', applied: !!r.applied });
});
