/*
 * Provider-independent payment interface. Application code (checkout.js, payment-webhook.js, refund.js, ...) only
 * ever talks to this module; to add Lemon Squeezy or Paddle later, write another file next to creem.js that exports
 * the same functions and select it with PAYMENT_PROVIDER.
 *
 * A provider module must export:
 *   isConfigured()                         -> { ok, missing: [envVarNames] }
 *   productFor(type)                       -> provider product id for 'premium' | 'seats'
 *   createCheckout({type, units, requestId, successUrl, customerEmail, metadata})
 *                                          -> { id, checkoutUrl }
 *   getCheckout(checkoutId)                -> { id, status, completed, orderId, transactionId, productId, units,
 *                                              amountCents, currency, mode, requestId, metadata }
 *   verifyWebhook(rawBody, headers)        -> boolean   (signature check on the RAW body)
 *   parseWebhook(rawBody)                  -> normalized event (below) or null for events we ignore
 *   refund({transactionId})                -> { status }
 *
 * Normalized webhook events:
 *   { kind: 'purchase.completed', eventId, requestId, orderId, transactionId, productId, units, amountCents, currency, mode, customerEmail, metadata }
 *   { kind: 'purchase.refunded',  eventId, orderId, transactionId, refundCents, paidCents, partial, mode }
 *   { kind: 'purchase.disputed',  eventId, orderId, transactionId, mode }
 */
const { env } = require('./config');

function getProvider() {
  const name = String(env('PAYMENT_PROVIDER', 'creem')).toLowerCase();
  if (name === 'creem') return require('./creem');
  throw new Error('PAYMENT_PROVIDER "' + name + '" has no implementation. Only "creem" ships today; see docs/payment-setup.md to add another.');
}
module.exports = { getProvider };
