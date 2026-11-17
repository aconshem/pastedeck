/* Passkeys (WebAuthn). One endpoint, `action` selects the step:
     register-options / register-verify / list / remove   -> need a signed-in session
     login-options / login-verify                         -> public; a successful login starts a new session
   A passkey sign-in is also the account-recovery path for a forgotten password (see change-password.js). */
const store = require('./_lib/store');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const { authenticate, startSession, webToken } = require('./_lib/auth');
const { newId, b64u, unb64u } = require('./_lib/crypto');
const A = require('./_lib/accounts');
const W = require('./_lib/webauthn');

const CHAL_TTL = 5 * 60000;
async function takeChallenge(id, kind) {
  const rec = await store.kv.consume('chal/' + String(id || '').slice(0, 64));
  if (!rec || rec.kind !== kind || rec.exp < Date.now()) throw httpError(400, 'That passkey request expired. Start again.');
  return rec;
}

exports.handler = route('POST', async (event) => {
  const b = parseBody(event);
  switch (b.action) {
    case 'register-options': {
      const { me } = await authenticate(event);
      const id = newId('chal'), challenge = W.newChallenge();
      await store.kv.set('chal/' + id, { kind: 'reg', memberId: me.id, challenge, exp: Date.now() + CHAL_TTL });
      return ok({ challengeId: id, publicKey: {
        challenge, rp: { id: W.RP_ID, name: 'PasteBoard' },
        user: { id: b64u(Buffer.from(me.id)), name: me.email, displayName: me.name },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
        attestation: 'none', timeout: 60000,
        excludeCredentials: (me.passkeys || []).map((p) => ({ type: 'public-key', id: p.id })),
      } });
    }
    case 'register-verify': {
      const { account, me } = await authenticate(event);
      const rec = await takeChallenge(b.challengeId, 'reg');
      if (rec.memberId !== me.id) throw httpError(403, 'Not allowed.');
      let r; try { r = W.verifyRegistration(b.credential && b.credential.response || {}, rec.challenge); } catch (e) { throw httpError(400, 'Passkey could not be verified: ' + e.message); }
      if (await store.kv.get('pk/' + r.credentialId)) throw httpError(409, 'That passkey is already registered.');
      await store.accounts.update(account.email, (acc) => {
        const m = acc.members.find((x) => x.id === me.id);
        if ((m.passkeys || []).length >= 10) throw httpError(400, 'You can register up to 10 passkeys.');
        m.passkeys = m.passkeys || [];
        m.passkeys.push({ id: r.credentialId, publicKeyJwk: r.publicKeyJwk, alg: r.alg, counter: r.counter, name: A.cleanName(b.name, 'Passkey'), createdAt: Date.now() });
      });
      await store.kv.set('pk/' + r.credentialId, { accountEmail: account.email, memberId: me.id });
      return ok({ ok: true });
    }
    case 'list': {
      const { me } = await authenticate(event);
      return ok({ passkeys: (me.passkeys || []).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt })) });
    }
    case 'remove': {
      const { account, me } = await authenticate(event);
      await store.accounts.update(account.email, (acc) => { const m = acc.members.find((x) => x.id === me.id); m.passkeys = (m.passkeys || []).filter((p) => p.id !== b.id); });
      await store.kv.del('pk/' + String(b.id || ''));
      return ok({ ok: true });
    }
    case 'login-options': {
      const email = A.normEmail(b.email);
      const id = newId('chal'), challenge = W.newChallenge();
      let allow = [];
      if (email) {
        const ix = await store.emailIndex.get(email);
        const acc = ix && (await store.accounts.get(ix.accountEmail));
        const m = acc && acc.members.find((x) => x.id === ix.memberId);
        allow = m ? (m.passkeys || []).map((p) => ({ type: 'public-key', id: p.id })) : [];
      }
      await store.kv.set('chal/' + id, { kind: 'auth', challenge, exp: Date.now() + CHAL_TTL });
      return ok({ challengeId: id, publicKey: { challenge, rpId: W.RP_ID, allowCredentials: allow, userVerification: 'preferred', timeout: 60000 } });
    }
    case 'login-verify': {
      const rec = await takeChallenge(b.challengeId, 'auth');
      const cred = b.credential || {};
      const owner = await store.kv.get('pk/' + String(cred.id || ''));
      if (!owner) throw httpError(401, 'That passkey is not registered for any account.');
      const account = await store.accounts.get(owner.accountEmail);
      const member = account && account.members.find((m) => m.id === owner.memberId);
      const pk = member && (member.passkeys || []).find((p) => p.id === cred.id);
      if (!pk) throw httpError(401, 'That passkey is not registered for any account.');
      if (member.status !== 'active') throw httpError(403, 'This access has been revoked. Contact your account owner.');
      let res; try { res = W.verifyAssertion(cred.response || {}, rec.challenge, pk); } catch (e) { throw httpError(401, 'Passkey check failed: ' + e.message); }
      await store.accounts.update(account.email, (acc) => { const p = acc.members.find((m) => m.id === member.id).passkeys.find((x) => x.id === pk.id); p.counter = res.counter; p.lastUsedAt = Date.now(); });
      const sid = await startSession(account.email, member.id, 'passkey');
      const fresh = await store.accounts.get(account.email);
      const m = fresh.members.find((x) => x.id === member.id);
      return ok(Object.assign(A.sessionResponse(fresh, m, webToken(fresh, m, sid)), { method: 'passkey' }));
    }
    default: throw httpError(400, 'Unknown action.');
  }
});
