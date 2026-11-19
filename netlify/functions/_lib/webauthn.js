/*
 * Minimal WebAuthn (passkey) verification with Node's built-in crypto — no dependency.
 * Supports `none`-style registration (we ask for attestation "none", so no attestation statement is verified) and
 * ES256 / RS256 assertions, which covers platform authenticators (Touch ID, Windows Hello, Android) and security keys.
 * Checks: challenge, origin, RP ID hash, user-present flag, signature, and the signature counter.
 */
const crypto = require('crypto');
const { BASE_URL, RP_ID } = require('./config');
const { b64u, unb64u, randomToken } = require('./crypto');

/* ---- tiny CBOR decoder (maps, arrays, ints, byte/text strings, simple values) ---- */
function cborDecode(buf) {
  let o = 0;
  function readLen(ai) {
    if (ai < 24) return ai;
    if (ai === 24) return buf[o++];
    if (ai === 25) { const v = buf.readUInt16BE(o); o += 2; return v; }
    if (ai === 26) { const v = buf.readUInt32BE(o); o += 4; return v; }
    throw new Error('CBOR: unsupported length');
  }
  function item() {
    const ib = buf[o++], mt = ib >> 5, ai = ib & 31;
    if (mt === 0) return readLen(ai);
    if (mt === 1) return -1 - readLen(ai);
    if (mt === 2) { const n = readLen(ai); const v = buf.slice(o, o + n); o += n; return v; }
    if (mt === 3) { const n = readLen(ai); const v = buf.slice(o, o + n).toString('utf8'); o += n; return v; }
    if (mt === 4) { const n = readLen(ai), a = []; for (let i = 0; i < n; i++) a.push(item()); return a; }
    if (mt === 5) { const n = readLen(ai), m = new Map(); for (let i = 0; i < n; i++) { const k = item(); m.set(k, item()); } return m; }
    if (mt === 7) { if (ai === 20) return false; if (ai === 21) return true; if (ai === 22 || ai === 23) return null; }
    throw new Error('CBOR: unsupported item');
  }
  const v = item();
  return { value: v, bytesRead: o };
}

function parseAuthData(ad) {
  if (ad.length < 37) throw new Error('authData too short');
  const out = { rpIdHash: ad.slice(0, 32), flags: ad[32], counter: ad.readUInt32BE(33) };
  out.up = !!(out.flags & 0x01); out.uv = !!(out.flags & 0x04); out.at = !!(out.flags & 0x40);
  if (out.at) {
    let o = 37 + 16; // skip AAGUID
    const idLen = ad.readUInt16BE(o); o += 2;
    out.credentialId = ad.slice(o, o + idLen); o += idLen;
    out.coseKey = cborDecode(ad.slice(o)).value;
  }
  return out;
}
function coseToJwk(m) {
  const kty = m.get(1), alg = m.get(3);
  if (kty === 2 && (alg === -7 || alg === undefined)) {
    return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64u(m.get(-2)), y: b64u(m.get(-3)) } };
  }
  if (kty === 3 && alg === -257) return { alg: -257, jwk: { kty: 'RSA', n: b64u(m.get(-1)), e: b64u(m.get(-2)) } };
  throw new Error('Unsupported passkey algorithm.');
}

function checkClientData(clientDataJSON, expectedType, expectedChallenge) {
  const cd = JSON.parse(unb64u(clientDataJSON).toString('utf8'));
  if (cd.type !== expectedType) throw new Error('Wrong ceremony type.');
  if (cd.challenge !== expectedChallenge) throw new Error('Challenge mismatch.');
  if (cd.origin !== BASE_URL && !(process.env.PASTEBOARD_EXTRA_ORIGINS || '').split(',').includes(cd.origin)) throw new Error('Unexpected origin.');
  return cd;
}
const rpHash = () => crypto.createHash('sha256').update(RP_ID).digest();

function verifyRegistration({ clientDataJSON, attestationObject }, challenge) {
  checkClientData(clientDataJSON, 'webauthn.create', challenge);
  const att = cborDecode(unb64u(attestationObject)).value;
  const authData = att.get('authData');
  const ad = parseAuthData(authData);
  if (!ad.rpIdHash.equals(rpHash())) throw new Error('RP ID mismatch.');
  if (!ad.up) throw new Error('User presence was not confirmed.');
  if (!ad.at || !ad.credentialId) throw new Error('No credential in response.');
  const { alg, jwk } = coseToJwk(ad.coseKey);
  return { credentialId: b64u(ad.credentialId), publicKeyJwk: jwk, alg, counter: ad.counter };
}

function verifyAssertion({ clientDataJSON, authenticatorData, signature }, challenge, cred) {
  checkClientData(clientDataJSON, 'webauthn.get', challenge);
  const authData = unb64u(authenticatorData);
  const ad = parseAuthData(authData);
  if (!ad.rpIdHash.equals(rpHash())) throw new Error('RP ID mismatch.');
  if (!ad.up) throw new Error('User presence was not confirmed.');
  const clientHash = crypto.createHash('sha256').update(unb64u(clientDataJSON)).digest();
  const data = Buffer.concat([authData, clientHash]);
  const key = crypto.createPublicKey({ key: cred.publicKeyJwk, format: 'jwk' });
  const okSig = crypto.verify('sha256', data, key, unb64u(signature));
  if (!okSig) throw new Error('Passkey signature check failed.');
  if ((ad.counter || cred.counter) && ad.counter <= cred.counter) throw new Error('Passkey counter went backwards (possible cloned authenticator).');
  return { counter: ad.counter };
}

const newChallenge = () => randomToken(32);
module.exports = { verifyRegistration, verifyAssertion, newChallenge, cborDecode, parseAuthData, RP_ID };
