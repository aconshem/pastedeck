const { ok, route } = require('./_lib/http');
const { authenticate } = require('./_lib/auth');
const A = require('./_lib/accounts');
const { PRICING } = require('./_lib/config');
const store = require('./_lib/store');

exports.handler = route(null, async (event) => {
  const { account, me } = await authenticate(event, { type: 'web' });
  if (A.lapseInvitations(account)) await store.accounts.update(account.email, (acc) => { A.lapseInvitations(acc); });
  const p = A.planSummary(account);
  const mng = me.role === 'owner' || me.role === 'admin';
  const owner = account.members.find((m) => m.role === 'owner');
  return ok({
    email: account.email, accountName: owner ? owner.name : account.email,
    plan: p.plan, planSource: p.source, trialEndsAt: p.trialEndsAt, trialAvailable: p.trialAvailable && me.role === 'owner',
    seats: p.seats,
    prices: { premiumUSD: PRICING.premiumUSD, extraSeatUSD: PRICING.extraSeatUSD, includedSeats: PRICING.includedSeats },
    you: { memberId: me.id, name: me.name, email: me.email, role: me.role, analyticsAccess: !!me.analyticsAccess, emailVerified: !!me.emailVerified, passkeyCount: (me.passkeys || []).length, marketingOptIn: !!me.marketingOptIn },
    members: account.members.filter((m) => m.status !== 'removed').map(A.publicMember),
    invitations: mng ? (account.invitations || []).filter((i) => i.status === 'pending' || i.status === 'expired').map((i) => ({ id: i.id, email: i.email, status: i.status, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt })) : [],
    purchases: me.role === 'owner' ? (account.purchases || []).map((x) => ({ id: x.id, type: x.type, units: x.units, amountUSD: x.amountUSD, currency: x.currency, at: x.at, status: x.status, test: !!x.test, demo: !!x.demo, partialRefundUSD: x.partialRefundUSD || null })).sort((a, b) => b.at - a.at) : [],
  });
});
