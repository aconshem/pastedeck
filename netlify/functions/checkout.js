const store = require('./_lib/store');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const { authenticate } = require('./_lib/auth');
const { getProvider } = require('./_lib/payment-provider');
const { randomToken } = require('./_lib/crypto');
const { BASE_URL, PRICING } = require('./_lib/config');

/* Creates a hosted checkout for either Premium ($25 one-time) or N additional seats ($2.50 each, one-time). The account
   and purchase type are attached server-side as metadata and in our own pending-checkout record, so attribution never
   depends on anything the browser sends back. Nothing is granted here: only a verified webhook (or the authoritative
   checkout lookup in checkout-status.js) can grant an entitlement. */
exports.handler = route('POST', async (event) => {
  const { account, me } = await authenticate(event, { role: ['owner'], type: 'web' });
  const b = parseBody(event);
  const type = b.type === 'seats' ? 'seats' : b.type === 'premium' ? 'premium' : null;
  if (!type) throw httpError(400, 'Choose Premium or extra seats.');
  const hasPremium = !!(account.entitlements && account.entitlements.premium && account.entitlements.premium.active);
  let units = 1;
  if (type === 'premium' && hasPremium) throw httpError(409, 'This account already has Premium.');
  if (type === 'seats') {
    if (!hasPremium) throw httpError(409, 'Extra seats are added on top of Premium. Buy Premium first.');
    units = parseInt(b.quantity, 10);
    if (!(units >= 1 && units <= 100)) throw httpError(400, 'Choose between 1 and 100 extra seats.');
  }
  const provider = getProvider();
  const cfg = provider.isConfigured();
  if (!cfg.ok) { console.error('[pasteboard] payments not configured; missing: ' + cfg.missing.join(', ')); throw httpError(503, 'Payments are not switched on yet. Please try again later.'); }

  const requestId = 'pb_' + randomToken(12);
  const metadata = { accountEmail: account.email, memberId: me.id, purchaseType: type, units };
  const co = await provider.createCheckout({ type, units, requestId, successUrl: BASE_URL + '/dashboard/index.html?checkout=' + requestId, customerEmail: me.email, metadata });
  await store.kv.set('chk/' + requestId, { accountEmail: account.email, memberId: me.id, type, units, providerCheckoutId: co.id, createdAt: Date.now(), status: 'pending' });
  return ok({ checkoutUrl: co.checkoutUrl, requestId, totalUSD: type === 'premium' ? PRICING.premiumUSD : Math.round(units * PRICING.extraSeatUSD * 100) / 100 });
});
