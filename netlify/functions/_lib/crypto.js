/*
 * Node built-in `crypto` only: password hashing (scrypt), signed session tokens (HMAC-SHA256), random tokens.
 * Session tokens are stateless *signatures*, but every authenticated request also checks the member's current
 * session id (`sid`) on the server (see _lib/auth.js) — that is what makes logout-on-other-device and revocation
 * take effect immediately instead of waiting for the token to expire.
 */
const crypto = require('crypto');
const { IS_DEPLOYED } = require('./config');

let warned = false;
function secret() {
  const s = process.env.PASTEBOARD_SECRET;
  if (s && s.length >= 32) return s;
  if (IS_DEPLOYED) throw new Error('PASTEBOARD_SECRET is missing or shorter than 32 characters. Set it in Netlify environment variables.');
  if (!warned) { warned = true; console.warn('[pasteboard] PASTEBOARD_SECRET not set — using a local-only development secret. This is refused on deployed sites.'); }
  return 'local-development-only-secret-not-for-production';
}

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
function scryptAsync(password, salt, len, opts) {
  return new Promise((res, rej) => crypto.scrypt(String(password), salt, len, opts, (e, k) => (e ? rej(e) : res(k))));
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64, SCRYPT)).toString('hex');
  return 's2:' + salt + ':' + hash;
}
/* Accepts the new `s2:salt:hash` format and the legacy `salt:hash` (Node default scrypt cost) so old accounts can still log in. */
async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  let salt, hash, opts;
  if (parts[0] === 's2' && parts.length === 3) { salt = parts[1]; hash = parts[2]; opts = SCRYPT; }
  else if (parts.length === 2) { salt = parts[0]; hash = parts[1]; opts = undefined; }
  else return false;
  const check = (await scryptAsync(password, salt, 64, opts)).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const needsRehash = (stored) => !String(stored || '').startsWith('s2:');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function signToken(payload, ttlSeconds) {
  const body = Object.assign({}, payload, { exp: Date.now() + (ttlSeconds || 30 * 86400) * 1000 });
  const p = b64u(JSON.stringify(body));
  return p + '.' + b64u(crypto.createHmac('sha256', secret()).update(p).digest());
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [p, sig] = token.split('.');
  const expected = b64u(crypto.createHmac('sha256', secret()).update(p).digest());
  if (!safeEqual(sig, expected)) return null;
  let payload;
  try { payload = JSON.parse(unb64u(p).toString('utf8')); } catch (e) { return null; }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const randomToken = (bytes) => b64u(crypto.randomBytes(bytes || 32));
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmacHex = (key, data) => crypto.createHmac('sha256', key).update(data).digest('hex');
const newId = (prefix) => (prefix || 'id') + '_' + crypto.randomBytes(9).toString('hex');

module.exports = { hashPassword, verifyPassword, needsRehash, signToken, verifyToken, safeEqual, randomToken, sha256hex, hmacHex, newId, b64u, unb64u };
