/*
 * Who is entitled to what — computed on the server from facts it recorded itself (verified payments, the one-time
 * trial). Nothing here reads anything the client sent. The extension receives the *result* (plan, seat limit,
 * validUntil) and enforces the matching local limits; it can never grant itself Premium.
 */
const { PRICING } = require('./config');

function effective(account, now) {
  now = now || Date.now();
  const prem = account.entitlements && account.entitlements.premium;
  if (prem && prem.active) return { plan: 'premium', source: prem.source || 'purchase', trialEndsAt: null };
  if (account.trial && now < account.trial.endsAt) return { plan: 'premium', source: 'trial', trialEndsAt: account.trial.endsAt };
  return { plan: 'free', source: 'free', trialEndsAt: null };
}
function seatLimit(account, now) {
  const eff = effective(account, now);
  if (eff.plan !== 'premium') return PRICING.freeSeats;
  const extra = eff.source === 'trial' ? 0 : ((account.entitlements && account.entitlements.extraSeats) || 0);
  return PRICING.includedSeats + extra;
}
const pendingInvites = (account, now) => (account.invitations || []).filter((i) => i.status === 'pending' && i.expiresAt > (now || Date.now()));
const activeMembers = (account) => (account.members || []).filter((m) => m.status === 'active');
function seats(account, now) {
  const limit = seatLimit(account, now), used = activeMembers(account).length, reserved = pendingInvites(account, now).length;
  return {
    limit, included: effective(account, now).plan === 'premium' ? PRICING.includedSeats : PRICING.freeSeats,
    extraPurchased: (account.entitlements && account.entitlements.extraSeats) || 0,
    used, reserved, available: Math.max(0, limit - used - reserved),
  };
}
/* Revokes the most recently joined non-owner members until the account fits its seat limit (after a refund or a lapsed trial). */
function enforceSeatLimit(account, now) {
  const limit = seatLimit(account, now);
  const over = activeMembers(account).length - limit;
  if (over <= 0) return [];
  const victims = activeMembers(account).filter((m) => m.role !== 'owner').sort((a, b) => b.createdAt - a.createdAt).slice(0, over);
  victims.forEach((m) => { m.status = 'revoked'; m.revokedReason = 'seat-limit'; m.sid = null; });
  return victims;
}
module.exports = { effective, seatLimit, seats, activeMembers, pendingInvites, enforceSeatLimit };
