/*
 * The ONLY code that changes what an account has paid for. Called from the verified webhook, from the authoritative
 * checkout-status reconciliation, and from the admin tools — never from anything the browser can reach directly.
 * Both entry points are idempotent: applying the same order twice, or a refund twice, changes nothing the second time.
 */
const store = require('./store');
const { PRICING, env } = require('./config');
const { enforceSeatLimit } = require('./entitlements');

const isTestMode = () => String(env('CREEM_MODE', 'test')).toLowerCase() !== 'live';

/* Grants the entitlement for one paid order. Returns { applied: boolean }. */
async function applyPurchase(accountEmail, p) {
  let applied = false;
  const res = await store.accounts.update(accountEmail, (acc) => {
    acc.purchases = acc.purchases || [];
    if (acc.purchases.some((x) => x.orderId === p.orderId)) return false; // duplicate delivery / replay
    acc.entitlements = acc.entitlements || { premium: null, extraSeats: 0 };
    acc.purchases.push({
      id: p.orderId, orderId: p.orderId, transactionId: p.transactionId || null, provider: p.provider, type: p.type, units: p.units,
      amountUSD: p.amountCents != null ? Math.round(p.amountCents) / 100 : null, currency: p.currency || 'USD',
      requestId: p.requestId || null, at: Date.now(), status: 'paid', test: !!p.test, demo: !!p.demo,
    });
    if (p.type === 'premium') acc.entitlements.premium = { active: true, source: p.provider === 'manual' ? 'manual' : 'purchase', orderId: p.orderId, paidAt: Date.now() };
    else if (p.type === 'seats') acc.entitlements.extraSeats = (acc.entitlements.extraSeats || 0) + p.units;
    applied = true;
  });
  if (!res) return { applied: false, missing: true };
  if (applied) await store.kv.set('ord/' + p.orderId, { accountEmail: accountEmail.toLowerCase() });
  return { applied };
}

/* Turns a normalized `purchase.completed` event into an entitlement. Throws on anything inconsistent. */
async function applyCompletedEvent(provider, ev, source) {
  if (!ev.paid && ev.paid !== undefined) return { ignored: 'not paid' };
  const pending = ev.requestId ? await store.kv.get('chk/' + ev.requestId) : null;
  const accountEmail = String((pending && pending.accountEmail) || (ev.metadata && ev.metadata.accountEmail) || '').toLowerCase();
  if (!accountEmail) return { ignored: 'no account attribution' };
  if (pending && ev.metadata && ev.metadata.accountEmail && String(ev.metadata.accountEmail).toLowerCase() !== accountEmail) throw new Error('Metadata does not match the pending checkout.');

  let type = null;
  if (ev.productId && ev.productId === provider.productFor('premium')) type = 'premium';
  else if (ev.productId && ev.productId === provider.productFor('seats')) type = 'seats';
  if (!type) return { ignored: 'unknown product ' + ev.productId };
  if (pending && pending.type !== type) throw new Error('Product does not match the type this checkout was created for.');

  const units = type === 'premium' ? 1 : Math.max(1, Math.min(500, parseInt(ev.units, 10) || 1));
  if (!ev.orderId) throw new Error('Completed checkout has no order id.');
  const r = await applyPurchase(accountEmail, {
    provider: 'creem', type, units, orderId: ev.orderId, transactionId: ev.transactionId, amountCents: ev.amountCents,
    currency: ev.currency, requestId: ev.requestId, test: isTestMode(),
  });
  if (pending) await store.kv.set('chk/' + ev.requestId, Object.assign({}, pending, { status: 'completed', orderId: ev.orderId, completedVia: source }));
  return { accountEmail, type, units, applied: r.applied };
}

/* Full refunds and disputes remove the entitlement they granted; partial refunds are recorded only. */
async function applyRefundEvent(ev) {
  if (!ev.orderId) return { ignored: 'no order id' };
  const idx = await store.kv.get('ord/' + ev.orderId);
  if (!idx) return { ignored: 'unknown order' };
  const full = ev.kind === 'purchase.disputed' || !ev.partial;
  let victims = [];
  await store.accounts.update(idx.accountEmail, (acc) => {
    const p = (acc.purchases || []).find((x) => x.orderId === ev.orderId);
    if (!p || p.status !== 'paid') return false; // unknown, or already refunded (idempotent)
    if (!full) { p.partialRefundUSD = Math.round(ev.refundCents) / 100; return; }
    p.status = ev.kind === 'purchase.disputed' ? 'disputed' : 'refunded'; p.refundedAt = Date.now();
    acc.entitlements = acc.entitlements || { premium: null, extraSeats: 0 };
    if (p.type === 'premium' && acc.entitlements.premium && acc.entitlements.premium.orderId === p.orderId) acc.entitlements.premium.active = false;
    if (p.type === 'seats') acc.entitlements.extraSeats = Math.max(0, (acc.entitlements.extraSeats || 0) - p.units);
    victims = enforceSeatLimit(acc);
  });
  return { accountEmail: idx.accountEmail, full, revokedMembers: victims.length };
}

module.exports = { applyPurchase, applyCompletedEvent, applyRefundEvent, isTestMode, PRICING };
