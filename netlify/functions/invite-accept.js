const store = require('./_lib/store');
const { hashPassword } = require('./_lib/crypto');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const A = require('./_lib/accounts');
const { startSession, webToken } = require('./_lib/auth');
const { seatLimit, activeMembers } = require('./_lib/entitlements');

/* {check:true, token}  -> who invited you (does not use up the token)
   {token, name, password, acceptedTerms, marketingOptIn} -> creates the member, activates the seat, starts a session.
   Holding the emailed token IS the proof of owning the invited address, so the new member is email-verified. */
exports.handler = route('POST', async (event) => {
  const b = parseBody(event);
  if (b.check) {
    const rec = await A.peekToken('invite', b.token);
    const account = rec && (await store.accounts.get(rec.accountEmail));
    const inv = account && (account.invitations || []).find((i) => i.id === rec.inviteId);
    if (!inv || inv.status !== 'pending' || inv.expiresAt < Date.now()) return ok({ valid: false });
    const owner = account.members.find((m) => m.role === 'owner');
    return ok({ valid: true, email: inv.email, inviter: owner ? owner.name : 'Your team owner' });
  }
  if (b.acceptedTerms !== true) throw httpError(400, 'You must accept the Terms of Service and Privacy Policy to join.');
  const name = A.cleanName(b.name, null); if (!name) throw httpError(400, 'Enter your full name.');
  const password = A.checkPassword(b.password);
  const rec = await A.consumeToken('invite', b.token);
  if (!rec) throw httpError(400, 'This invitation link is invalid, already used, or expired. Ask the owner to resend it.');

  const account = await store.accounts.get(rec.accountEmail);
  const inv = account && (account.invitations || []).find((i) => i.id === rec.inviteId);
  if (!inv || inv.status !== 'pending' || inv.expiresAt < Date.now()) throw httpError(410, 'This invitation is no longer valid. Ask the owner to send a new one.');
  const email = inv.email;
  const hash = await hashPassword(password);

  const existingIx = await store.emailIndex.get(email);
  const prior = existingIx && existingIx.accountEmail === account.email ? account.members.find((m) => m.id === existingIx.memberId) : null;
  let member;
  if (prior && prior.status === 'removed') member = prior;
  else {
    member = A.newMember({ username: A.cleanName(b.username, email.split('@')[0]), name, email, passwordHash: hash, role: inv.role, emailVerified: true, marketingOptIn: b.marketingOptIn === true });
    // Atomic global claim: if this email became someone's identity since the invite was sent, nobody gets a duplicate.
    if (!(await store.emailIndex.claim(email, { accountEmail: account.email, memberId: member.id }))) throw httpError(409, 'That email address already belongs to a PasteBoard account.');
  }
  try {
    await store.accounts.update(account.email, (acc) => {
      const i = acc.invitations.find((x) => x.id === inv.id);
      if (i.status !== 'pending') throw httpError(410, 'This invitation is no longer valid.');
      if (activeMembers(acc).length >= seatLimit(acc)) throw httpError(409, 'This team has no free seats right now. Ask the owner.');
      i.status = 'accepted'; i.acceptedAt = Date.now();
      if (prior && prior.status === 'removed') {
        const m = acc.members.find((x) => x.id === prior.id);
        Object.assign(m, { status: 'active', name, passwordHash: hash, emailVerified: true, role: inv.role, revokedReason: null, termsAcceptedAt: Date.now() });
      } else acc.members.push(member);
    });
  } catch (e) { if (!prior) await store.emailIndex.release(email); throw e; }
  const sid = await startSession(account.email, member.id, 'password');
  const fresh = await store.accounts.get(account.email);
  const m = fresh.members.find((x) => x.id === member.id);
  return ok(A.sessionResponse(fresh, m, webToken(fresh, m, sid)));
});
