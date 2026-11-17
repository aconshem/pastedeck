/* Shared account/member helpers used by several endpoints. */
const store = require('./store');
const { newId, randomToken, sha256hex } = require('./crypto');
const { effective, seats, enforceSeatLimit } = require('./entitlements');
const { PRICING, BASE_URL, TERMS_VERSION, VERIFY_TTL_MS } = require('./config');
const { httpError } = require('./http');
const { mail } = require('./email');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normEmail = (e) => String(e || '').trim().toLowerCase();
function checkEmail(e) { if (!EMAIL_RE.test(e) || e.length > 254) throw httpError(400, 'Enter a valid email address.'); return e; }
function checkPassword(pw, email) {
  pw = String(pw || '');
  if (pw.length < 8) throw httpError(400, 'Password must be at least 8 characters.');
  if (pw.length > 200) throw httpError(400, 'Password is too long.');
  if (email && pw.toLowerCase() === String(email).toLowerCase()) throw httpError(400, 'Password cannot be your email address.');
  return pw;
}
const cleanName = (s, fallback) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 80) || fallback;

/* Single-use token helper: only the SHA-256 is stored, so a database leak cannot be replayed. */
async function issueToken(kind, data, ttlMs) {
  const raw = randomToken(32);
  await store.kv.set('tok/' + sha256hex(raw), Object.assign({ kind, exp: Date.now() + ttlMs }, data));
  return raw;
}
async function consumeToken(kind, raw) {
  if (!raw || typeof raw !== 'string' || raw.length > 200) return null;
  const rec = await store.kv.consume('tok/' + sha256hex(raw));
  if (!rec || rec.kind !== kind || rec.exp < Date.now()) return null;
  return rec;
}
async function peekToken(kind, raw) {
  if (!raw || typeof raw !== 'string' || raw.length > 200) return null;
  const rec = await store.kv.get('tok/' + sha256hex(raw));
  return rec && !rec.used && rec.kind === kind && rec.exp >= Date.now() ? rec : null;
}

/* Simple fixed-window limiter: allow(key, max, windowMs) -> boolean */
async function allow(key, max, windowMs) {
  const k = 'rl/' + sha256hex(key).slice(0, 32), now = Date.now();
  const cur = await store.kv.get(k);
  if (!cur || cur.reset < now) { await store.kv.set(k, { n: 1, reset: now + windowMs }); return true; }
  if (cur.n >= max) return false;
  await store.kv.set(k, { n: cur.n + 1, reset: cur.reset });
  return true;
}

function newMember(o) {
  const now = Date.now();
  return {
    id: newId('mem'), username: o.username, name: o.name, email: o.email, passwordHash: o.passwordHash,
    role: o.role, status: 'active', analyticsAccess: !!o.analyticsAccess, createdAt: now, lastLoginAt: null, lastActive: null,
    emailVerified: !!o.emailVerified, termsAcceptedAt: now, termsVersion: TERMS_VERSION, marketingOptIn: !!o.marketingOptIn,
    sid: null, sidMethod: null, sidIssuedAt: null, passkeys: [], failed: { count: 0, until: 0 },
  };
}
async function sendVerification(account, member) {
  const raw = await issueToken('verify', { accountEmail: account.email, memberId: member.id }, VERIFY_TTL_MS);
  return mail.verify(member.email, BASE_URL + '/verify-email/index.html?token=' + encodeURIComponent(raw));
}

const publicMember = (m) => ({
  id: m.id, username: m.username, name: m.name, email: m.email, role: m.role, status: m.status, analyticsAccess: !!m.analyticsAccess,
  emailVerified: !!m.emailVerified, lastLoginAt: m.lastLoginAt, lastActive: m.lastActive || null, revokedReason: m.revokedReason || null,
  passkeyCount: (m.passkeys || []).length,
});
function planSummary(account) {
  const e = effective(account);
  return { plan: e.plan, source: e.source, trialEndsAt: e.trialEndsAt, trialAvailable: !account.trial && !(account.entitlements && account.entitlements.premium && account.entitlements.premium.active), seats: seats(account) };
}
function sessionResponse(account, member, token) {
  const p = planSummary(account);
  return { token, accountEmail: account.email, memberId: member.id, role: member.role, name: member.name, email: member.email, plan: p.plan, emailVerified: !!member.emailVerified };
}
/* Lazily lapse expired invitations so their reserved seats are released. */
function lapseInvitations(account) {
  let changed = false;
  (account.invitations || []).forEach((i) => { if (i.status === 'pending' && i.expiresAt <= Date.now()) { i.status = 'expired'; changed = true; } });
  return changed;
}
module.exports = { EMAIL_RE, normEmail, checkEmail, checkPassword, cleanName, issueToken, consumeToken, peekToken, allow, newMember, sendVerification, publicMember, planSummary, sessionResponse, lapseInvitations, enforceSeatLimit, PRICING };
