/* Payment provider webhook. Order of operations matters:
     1. verify the signature over the RAW body  -> otherwise 401, nothing parsed or trusted
     2. skip events we've already processed     -> duplicate/retried deliveries are harmless
     3. apply the entitlement change (itself idempotent per order)
     4. record the event id as processed
   A 5xx makes the provider retry later, which is what we want for transient storage errors. */
const { json, route } = require('./_lib/http');
const store = require('./_lib/store');
const { getProvider } = require('./_lib/payment-provider');
const { applyCompletedEvent, applyRefundEvent } = require('./_lib/purchases');

exports.handler = route('POST', async (event) => {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  const provider = getProvider();
  if (!provider.verifyWebhook(raw, event.headers)) return json(401, { error: 'Invalid signature.' });
  const ev = provider.parseWebhook(raw);
  if (!ev) return json(200, { ignored: true });
  if (ev.eventId && (await store.kv.get('ev/' + ev.eventId))) return json(200, { duplicate: true });

  let result;
  if (ev.kind === 'purchase.completed') result = await applyCompletedEvent(provider, ev, 'webhook');
  else if (ev.kind === 'purchase.refunded' && ev.status && ev.status !== 'succeeded') result = { ignored: 'refund not final yet' };
  else result = await applyRefundEvent(ev);

  if (result.ignored) console.warn('[pasteboard] webhook ' + ev.eventId + ' ignored: ' + result.ignored);
  if (ev.eventId) await store.kv.set('ev/' + ev.eventId, { kind: ev.kind, at: Date.now(), orderId: ev.orderId || null });
  return json(200, { ok: true });
});
