/*
 * No external dependencies on purpose — Node's built-in `crypto` module covers everything this MVP backend
 * needs (password hashing, signed session tokens). If this grows into a real production auth system, swap
 * scrypt for a vetted library and these tokens for real JWTs — but for now this keeps the functions folder
 * dependency-free and easy to audit.
 */
const crypto = require('crypto');

const SECRET = process.env.PASTEBOARD_SECRET || 'dev-secret-change-me-in-netlify-env-vars';
if (!process.env.PASTEBOARD_SECRET) console.warn('[pasteboard] PASTEBOARD_SECRET is not set — using an insecure dev default. Set it in Netlify env vars before going live.');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(password, stored) {
  if (!stored || stored.indexOf(':') < 0) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function b64u(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

/* Signed, stateless session token: base64url(payload).base64url(hmac). Not encrypted — don't put secrets in payload. */
function signToken(payload, ttlSeconds) {
  const body = Object.assign({}, payload, { exp: Date.now() + (ttlSeconds || 30 * 86400) * 1000 });
  const p = b64u(JSON.stringify(body));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(p).digest());
  return p + '.' + sig;
}
function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [p, sig] = token.split('.');
  const expected = b64u(crypto.createHmac('sha256', SECRET).update(p).digest());
  if (sig !== expected) return null;
  let payload;
  try { payload = JSON.parse(unb64u(p).toString('utf8')); } catch (e) { return null; }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}
function newId(prefix) { return (prefix || 'id') + '_' + crypto.randomBytes(9).toString('hex'); }

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, newId };
