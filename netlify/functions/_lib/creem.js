/*
 * Creem implementation of the payment-provider interface. Every endpoint, field and header below is taken from the
 * official docs (https://docs.creem.io) as read on 12 Nov 2026:
 *
 *   POST {base}/v1/checkouts           x-api-key header; body: product_id, units, request_id, success_url,
 *                                      customer.email, metadata.   -> { id, checkout_url, status }
 *   GET  {base}/v1/checkouts?checkout_id=...    -> checkout (status: pending | processing | completed | expired)
 *   POST {base}/v1/refunds             body: { transaction_id } (full refund)
 *   Webhooks: header `creem-signature` = hex HMAC-SHA256 of the RAW request body keyed with the webhook secret.
 *             Events used: checkout.completed, refund.created, dispute.created. Retries reuse the same event id.
 *   base = https://test-api.creem.io (test mode) | https://api.creem.io (live)
 *
 * Checkout is a hosted page you redirect to; the docs describe no embedded/overlay checkout. `units` multiplies the
 * product's base price, which is how "N extra seats" is bought with one checkout against the $2.50 product.
 */
const { env } = require('./config');
const { hmacHex, safeEqual } = require('./crypto');
const { header } = require('./http');

const REQUIRED = ['CREEM_API_KEY', 'CREEM_PREMIUM_PRODUCT_ID', 'CREEM_EXTRA_SEAT_PRODUCT_ID', 'CREEM_WEBHOOK_SECRET'];
const base = () => (String(env('CREEM_MODE', 'test')).toLowerCase() === 'live' || String(env('CREEM_MODE')).toLowerCase() === 'prod' ? 'https://api.creem.io' : 'https://test-api.creem.io');

function isConfigured() { const missing = REQUIRED.filter((k) => !env(k)); return { ok: missing.length === 0, missing }; }
function productFor(type) { return type === 'premium' ? env('CREEM_PREMIUM_PRODUCT_ID') : env('CREEM_EXTRA_SEAT_PRODUCT_ID'); }

async function api(method, path, body) {
  const res = await fetch(base() + path, { method, headers: { 'x-api-key': env('CREEM_API_KEY'), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let data = {}; try { data = await res.json(); } catch (e) { /* empty */ }
  if (!res.ok) { const err = new Error('Creem API ' + res.status + ': ' + (data.message || data.error || JSON.stringify(data)).toString().slice(0, 300)); err.status = res.status; throw err; }
  return data;
}

async function createCheckout({ type, units, requestId, successUrl, customerEmail, metadata }) {
  const data = await api('POST', '/v1/checkouts', {
    product_id: productFor(type), units, request_id: requestId, success_url: successUrl,
    customer: customerEmail ? { email: customerEmail } : undefined, metadata,
  });
  if (!data.checkout_url) throw new Error('Creem did not return a checkout URL.');
  return { id: data.id, checkoutUrl: data.checkout_url };
}

const idOf = (x) => (x && typeof x === 'object' ? x.id : x) || null;
function normalizeCheckout(c) {
  const order = c.order && typeof c.order === 'object' ? c.order : {};
  return {
    id: c.id, status: c.status, completed: c.status === 'completed' && order.status === 'paid',
    orderId: idOf(c.order), transactionId: idOf(order.transaction), productId: idOf(c.product), units: c.units || 1,
    amountCents: order.amount != null ? order.amount : null, currency: order.currency || null,
    mode: c.mode || null, requestId: c.request_id || null, metadata: c.metadata || {},
    customerEmail: c.customer && typeof c.customer === 'object' ? c.customer.email : null,
  };
}
async function getCheckout(checkoutId) { return normalizeCheckout(await api('GET', '/v1/checkouts?checkout_id=' + encodeURIComponent(checkoutId))); }

function verifyWebhook(rawBody, headers) {
  const secret = env('CREEM_WEBHOOK_SECRET');
  const sig = header({ headers }, 'creem-signature');
  if (!secret || !sig) return false;
  return safeEqual(hmacHex(secret, rawBody), String(sig).trim().toLowerCase());
}

function parseWebhook(rawBody) {
  let ev; try { ev = JSON.parse(rawBody); } catch (e) { return null; }
  const o = ev.object || {};
  if (ev.eventType === 'checkout.completed') {
    const order = o.order || {};
    return {
      kind: 'purchase.completed', eventId: ev.id, requestId: o.request_id || null, orderId: idOf(o.order),
      transactionId: idOf(order.transaction), productId: idOf(o.product), units: o.units || 1,
      amountCents: order.amount != null ? order.amount : null, currency: order.currency || null,
      paid: order.status === 'paid', mode: o.mode || order.mode || null,
      customerEmail: o.customer && o.customer.email || null, metadata: o.metadata || {},
    };
  }
  if (ev.eventType === 'refund.created') {
    const tr = o.transaction || {};
    const paid = tr.amount_paid != null ? tr.amount_paid : null;
    return {
      kind: 'purchase.refunded', eventId: ev.id, orderId: idOf(o.order) || idOf(tr.order), transactionId: idOf(o.transaction),
      refundCents: o.refund_amount, paidCents: paid, status: o.status,
      partial: paid != null && o.refund_amount != null ? o.refund_amount < paid : false, mode: o.mode || null,
    };
  }
  if (ev.eventType === 'dispute.created') {
    const tr = o.transaction || {};
    return { kind: 'purchase.disputed', eventId: ev.id, orderId: idOf(tr.order), transactionId: idOf(o.transaction), mode: o.mode || null };
  }
  return null; // subscription.* etc. are irrelevant: we sell no subscriptions
}

async function refund({ transactionId }) { const r = await api('POST', '/v1/refunds', { transaction_id: transactionId }); return { status: r.status }; }

module.exports = { isConfigured, productFor, createCheckout, getCheckout, verifyWebhook, parseWebhook, refund, base };
