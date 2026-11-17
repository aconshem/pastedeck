const store = require('./_lib/store');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const { authenticate } = require('./_lib/auth');
const A = require('./_lib/accounts');
const { newId, sha256hex } = require('./_lib/crypto');
const { mail } = require('./_lib/email');
const { seatLimit, activeMembers, pendingInvites } = require('./_lib/entitlements');
const { BASE_URL, INVITE_TTL_MS } = require('./_lib/config');

const link = (raw) => BASE_URL + '/signup/index.html?invite=' + encodeURIComponent(raw);

exports.handler = route('POST', async (event) => {
  const { account, me } = await authenticate(event, { role: ['owner'], type: 'web' });
  const b = parseBody(event);

  if (b.action === 'invite') {
    if (!me.emailVerified) throw httpError(403, 'Verify your own email address first — check your inbox or resend the verification email from Settings.');
    const email = A.checkEmail(A.normEmail(b.email));
    const role = b.role === 'admin' ? 'admin' : 'member';
    if (!(await A.allow('invite:' + account.email, 20, 3600000))) throw httpError(429, 'Too many invitations. Try again later.');
    // One verified email = one identity in exactly one team. A removed member may be re-invited only by the team they were removed from.
    const ix = await store.emailIndex.get(email);
    if (ix) {
      const sameTeamRemoved = ix.accountEmail === account.email && (account.members.find((m) => m.id === ix.memberId) || {}).status === 'removed';
      if (!sameTeamRemoved) throw httpError(409, 'That email address already belongs to a PasteBoard account, so it can’t be invited. They can keep using their own account.');
    }
    const raw = await A.issueToken('invite', { accountEmail: account.email, inviteId: null }, INVITE_TTL_MS);
    const id = newId('inv');
    await store.accounts.update(account.email, (acc) => {
      A.lapseInvitations(acc);
      if ((acc.invitations || []).some((i) => i.email === email && i.status === 'pending')) throw httpError(409, 'There is already a pending invitation for that email. Use Resend instead.');
      // Seat reservation happens inside the atomic write, so two simultaneous invites can never exceed the limit.
      const free = seatLimit(acc) - activeMembers(acc).length - pendingInvites(acc).length;
      if (free <= 0) throw httpError(402, seatLimit(acc) <= 1 ? 'The Free plan has one seat (yours). Upgrade to Premium to invite people.' : 'All seats are in use. Buy more seats to invite someone else.', { code: 'NO_SEATS' });
      acc.invitations = acc.invitations || [];
      acc.invitations.push({ id, email, role, status: 'pending', invitedBy: me.id, createdAt: Date.now(), expiresAt: Date.now() + INVITE_TTL_MS, tokenHash: sha256hex(raw) });
    });
    await store.kv.set('tok/' + sha256hex(raw), { kind: 'invite', accountEmail: account.email, inviteId: id, exp: Date.now() + INVITE_TTL_MS });
    const sent = await mail.invite(email, link(raw), me.name, me.name + '’s team');
    if (!sent.sent && !sent.dev) {
      await store.accounts.update(account.email, (acc) => { const i = acc.invitations.find((x) => x.id === id); if (i) i.status = 'revoked'; }); // release the seat
      await store.kv.del('tok/' + sha256hex(raw));
      throw httpError(502, 'The invitation email could not be sent (' + (sent.error || 'email provider error') + '). No seat was used.');
    }
    return ok({ ok: true, invitationId: id });
  }

  const inv = (account.invitations || []).find((i) => i.id === b.invitationId);
  if (!inv) throw httpError(404, 'Invitation not found.');

  if (b.action === 'revoke') {
    if (inv.status !== 'pending') throw httpError(409, 'That invitation is no longer pending.');
    await store.accounts.update(account.email, (acc) => { const i = acc.invitations.find((x) => x.id === inv.id); i.status = 'revoked'; });
    await store.kv.del('tok/' + inv.tokenHash);
    return ok({ ok: true });
  }
  if (b.action === 'resend') {
    if (inv.status === 'accepted' || inv.status === 'revoked') throw httpError(409, 'That invitation can’t be resent.');
    if (!(await A.allow('resend:' + inv.id, 3, 3600000))) throw httpError(429, 'Too many resends. Try again later.');
    const raw = await A.issueToken('invite', { accountEmail: account.email, inviteId: inv.id }, INVITE_TTL_MS);
    await store.accounts.update(account.email, (acc) => {
      const i = acc.invitations.find((x) => x.id === inv.id);
      if (i.status === 'expired') { // reviving an expired invite needs a free seat again
        if (seatLimit(acc) - activeMembers(acc).length - pendingInvites(acc).length <= 0) throw httpError(402, 'No free seats to re-send this invitation.', { code: 'NO_SEATS' });
        i.status = 'pending';
      }
      i.expiresAt = Date.now() + INVITE_TTL_MS; i.tokenHash = sha256hex(raw);
    });
    await store.kv.del('tok/' + inv.tokenHash);
    const sent = await mail.invite(inv.email, link(raw), me.name, me.name + '’s team');
    if (!sent.sent && !sent.dev) throw httpError(502, 'The invitation email could not be sent.');
    return ok({ ok: true });
  }
  throw httpError(400, 'Unknown action.');
});
