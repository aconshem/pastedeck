/*
 * End-to-end tests for the Netlify Functions, run against the real handlers with the local file store.
 *   node --test tests/        (Node 20+; no dependencies)
 * Creem, the email provider and the browser's WebAuthn authenticator are simulated.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-test-'));
Object.assign(process.env, {
  PASTEBOARD_LOCAL_DIR: dir, PASTEBOARD_SECRET: 'x'.repeat(48), PASTEBOARD_BASE_URL: 'https://pastedeck.netlify.app',
  PAYMENT_PROVIDER: 'creem', CREEM_API_KEY: 'creem_test_key', CREEM_PREMIUM_PRODUCT_ID: 'prod_premium', CREEM_EXTRA_SEAT_PRODUCT_ID: 'prod_seat',
  CREEM_WEBHOOK_SECRET: 'whsec_test', CREEM_MODE: 'test', RESEND_API_KEY: 're_test', EMAIL_FROM: 'PasteBoard <hello@example.com>',
  PASTEBOARD_ADMIN_TOKEN: 'admin-token-1234567890', FOUNDER_BOOTSTRAP_EMAIL: 'founder@example.com', FOUNDER_BOOTSTRAP_SECRET: 'bootstrap-secret-123456', FOUNDER_DEMO_SEED: 'true',
});

/* ---- fake network: Resend + Creem ---- */
const outbox = [];            // emails "sent"
const creemCalls = [];        // requests our code made to Creem
let creemCheckouts = {};      // id -> checkout object returned by GET /v1/checkouts
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  url = String(url);
  const body = init && init.body ? JSON.parse(init.body) : null;
  const res = (obj, status) => ({ ok: (status || 200) < 400, status: status || 200, json: async () => obj, text: async () => JSON.stringify(obj) });
  if (url.startsWith('https://api.resend.com/emails')) { outbox.push(body); return res({ id: 'em_1' }); }
  if (url.startsWith('https://test-api.creem.io')) {
    creemCalls.push({ url, method: init.method, headers: init.headers, body });
    if (url.endsWith('/v1/checkouts') && init.method === 'POST') { const id = 'ch_' + creemCalls.length; return res({ id, checkout_url: 'https://creem.io/test/checkout/' + id, status: 'pending' }); }
    if (url.includes('/v1/checkouts?checkout_id=')) return res(creemCheckouts[new URL(url).searchParams.get('checkout_id')] || {}, creemCheckouts[new URL(url).searchParams.get('checkout_id')] ? 200 : 404);
    if (url.endsWith('/v1/refunds')) return res({ status: 'pending' });
  }
  throw new Error('unexpected fetch ' + url);
};

const F = (n) => require('../netlify/functions/' + n).handler;
async function call(name, body, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {}); if (opts.token) headers.authorization = 'Bearer ' + opts.token;
  const r = await F(name)({ httpMethod: opts.method || 'POST', headers, body: opts.raw != null ? opts.raw : JSON.stringify(body || {}) });
  return { status: r.statusCode, body: JSON.parse(r.body) };
}
const lastMailLink = (to, re) => { const m = outbox.filter((x) => x.to[0] === to).pop(); return m.text.match(re)[0]; };
const tokenIn = (link) => new URL(link).searchParams.get('token') || new URL(link).searchParams.get('invite');
const signup = (email, extra) => call('signup', Object.assign({ name: 'Test ' + email.split('@')[0], email, password: 'correct horse', acceptedTerms: true }, extra));
const verify = async (email) => { const link = lastMailLink(email, /https:\/\/\S*verify-email\S*/); assert.equal((await call('verify-email', { token: tokenIn(link) })).status, 200); };

test('signup ignores any client plan, requires terms, stores marketing choice, starts on Free', async () => {
  assert.equal((await signup('a@x.com', { acceptedTerms: false })).status, 400);
  const r = await signup('owner@x.com', { plan: 'premiumpro', cardCollected: true, marketingOptIn: true });
  assert.equal(r.status, 200); assert.equal(r.body.plan, 'free');
  const acct = await call('account', null, { token: r.body.token, method: 'GET' });
  assert.equal(acct.body.plan, 'free'); assert.equal(acct.body.seats.limit, 1); assert.equal(acct.body.you.marketingOptIn, true);
  assert.equal(acct.body.trialAvailable, true);
  const stored = require('../netlify/functions/_lib/store'); const doc = await stored.accounts.get('owner@x.com');
  assert.ok(doc.members[0].termsAcceptedAt); assert.ok(doc.members[0].termsVersion); assert.equal((await signup('OWNER@x.com')).status, 409, 'email unique regardless of case');
});

test('one signed-in device at a time: logging in on device 2 logs out device 1 (and vice versa)', async () => {
  await signup('single@x.com');
  const d1 = (await call('login', { email: 'single@x.com', password: 'correct horse' })).body.token;
  assert.equal((await call('account', null, { token: d1, method: 'GET' })).status, 200);
  const d2 = (await call('login', { email: 'single@x.com', password: 'correct horse' })).body.token;
  const old = await call('account', null, { token: d1, method: 'GET' });
  assert.equal(old.status, 401); assert.equal(old.body.code, 'SIGNED_IN_ELSEWHERE');
  assert.equal((await call('account', null, { token: d2, method: 'GET' })).status, 200);
  const d3 = (await call('login', { email: 'single@x.com', password: 'correct horse' })).body.token; // "vice versa"
  assert.equal((await call('account', null, { token: d2, method: 'GET' })).status, 401);
  assert.equal((await call('account', null, { token: d3, method: 'GET' })).status, 200);
});

test('wrong passwords are rejected and lock the account after repeated failures', async () => {
  await signup('lock@x.com');
  for (let i = 0; i < 8; i++) assert.equal((await call('login', { email: 'lock@x.com', password: 'nope-nope' + i })).status, 401);
  const locked = await call('login', { email: 'lock@x.com', password: 'correct horse' });
  assert.equal(locked.status, 429);
});

test('forgot password: generic answer, one-time email link, resets password and signs out old sessions', async () => {
  const s = await signup('forgot@x.com');
  const unknown = await call('forgot-password', { email: 'ghost@x.com' }); const known = await call('forgot-password', { email: 'forgot@x.com' });
  assert.deepEqual(unknown.body, known.body, 'same response whether or not the account exists');
  assert.ok(!outbox.some((m) => m.to[0] === 'ghost@x.com'));
  const token = tokenIn(lastMailLink('forgot@x.com', /https:\/\/\S*reset-password\S*/));
  assert.equal((await call('reset-password', { check: true, token })).body.valid, true);
  assert.equal((await call('reset-password', { token, password: 'short' })).status, 400);
  assert.equal((await call('reset-password', { token, password: 'a brand new password' })).status, 200);
  assert.equal((await call('reset-password', { token, password: 'another password!' })).status, 400, 'link is single use');
  assert.equal((await call('account', null, { token: s.body.token, method: 'GET' })).status, 401, 'old session ended');
  assert.equal((await call('login', { email: 'forgot@x.com', password: 'correct horse' })).status, 401);
  assert.equal((await call('login', { email: 'forgot@x.com', password: 'a brand new password' })).status, 200);
});

/* ---- passkey simulator (acts like a platform authenticator) ---- */
const cbor = {
  head(mt, n) { return n < 24 ? Buffer.from([(mt << 5) | n]) : n < 256 ? Buffer.from([(mt << 5) | 24, n]) : Buffer.from([(mt << 5) | 25, n >> 8, n & 255]); },
  enc(v) {
    if (Buffer.isBuffer(v)) return Buffer.concat([cbor.head(2, v.length), v]);
    if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([cbor.head(3, b.length), b]); }
    if (typeof v === 'number') return v >= 0 ? cbor.head(0, v) : cbor.head(1, -1 - v);
    if (v instanceof Map) return Buffer.concat([cbor.head(5, v.size)].concat([...v].flatMap(([k, x]) => [cbor.enc(k), cbor.enc(x)])));
    throw new Error('enc');
  },
};
const b64u = (b) => Buffer.from(b).toString('base64url');
function authenticator() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }); const credId = crypto.randomBytes(32);
  const rpHash = crypto.createHash('sha256').update('pastedeck.netlify.app').digest();
  let counter = 0;
  const cd = (type, challenge, origin) => Buffer.from(JSON.stringify({ type, challenge, origin: origin || 'https://pastedeck.netlify.app' }));
  return {
    id: b64u(credId),
    create(challenge, origin) {
      const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
      const idLen = Buffer.from([credId.length >> 8, credId.length & 255]);
      const authData = Buffer.concat([rpHash, Buffer.from([0x41]), Buffer.alloc(4), Buffer.alloc(16), idLen, credId, cbor.enc(cose)]);
      const att = cbor.enc(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return { id: b64u(credId), response: { clientDataJSON: b64u(cd('webauthn.create', challenge, origin)), attestationObject: b64u(att) } };
    },
    get(challenge, opts) {
      opts = opts || {}; counter++;
      const c = Buffer.alloc(4); c.writeUInt32BE(counter);
      const authData = Buffer.concat([rpHash, Buffer.from([0x01]), c]);
      const clientData = cd('webauthn.get', challenge);
      const sig = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(clientData).digest()]), opts.badKey || privateKey);
      return { id: b64u(credId), response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(sig) } };
    },
  };
}

test('passkeys: register, sign in (rotates session), reject forged/replayed/wrong-origin, recover a forgotten password', async () => {
  const s = await signup('pk@x.com');
  const dev = authenticator();
  const opt = await call('passkey', { action: 'register-options' }, { token: s.body.token });
  assert.equal(opt.status, 200); assert.equal(opt.body.publicKey.rp.id, 'pastedeck.netlify.app');
  assert.equal((await call('passkey', { action: 'register-verify', challengeId: opt.body.challengeId, credential: dev.create(opt.body.publicKey.challenge, 'https://evil.example') }, { token: s.body.token })).status, 400, 'wrong origin');
  const opt2 = await call('passkey', { action: 'register-options' }, { token: s.body.token });
  assert.equal((await call('passkey', { action: 'register-verify', challengeId: opt2.body.challengeId, credential: dev.create(opt2.body.publicKey.challenge), name: 'Laptop' }, { token: s.body.token })).status, 200);
  assert.equal((await call('passkey', { action: 'list' }, { token: s.body.token })).body.passkeys[0].name, 'Laptop');

  const lo = await call('passkey', { action: 'login-options', email: 'pk@x.com' });
  assert.equal(lo.body.publicKey.allowCredentials[0].id, dev.id);
  const assertion = dev.get(lo.body.publicKey.challenge);
  const login = await call('passkey', { action: 'login-verify', challengeId: lo.body.challengeId, credential: assertion });
  assert.equal(login.status, 200); assert.equal(login.body.method, 'passkey');
  assert.equal((await call('account', null, { token: s.body.token, method: 'GET' })).status, 401, 'passkey login signs out the older session');
  assert.equal((await call('passkey', { action: 'login-verify', challengeId: lo.body.challengeId, credential: assertion })).status, 400, 'challenge is single-use');

  const lo2 = await call('passkey', { action: 'login-options' });
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  assert.equal((await call('passkey', { action: 'login-verify', challengeId: lo2.body.challengeId, credential: dev.get(lo2.body.publicKey.challenge, { badKey: other }) })).status, 401, 'forged signature');

  // recovery: signed in with a passkey -> may set a new password without knowing the old one
  assert.equal((await call('change-password', { newPassword: 'recovered password' }, { token: login.body.token })).status, 200);
  assert.equal((await call('login', { email: 'pk@x.com', password: 'recovered password' })).status, 200);
  // ...but an ordinary password session must supply the current password
  const plain = (await call('login', { email: 'pk@x.com', password: 'recovered password' })).body.token;
  assert.equal((await call('change-password', { newPassword: 'sneaky new password' }, { token: plain })).status, 403);
});

test('trial: needs verified email, once only, server-side, no card', async () => {
  const s = await signup('trial@x.com');
  assert.equal((await call('trial-start', {}, { token: s.body.token })).body.code, 'EMAIL_NOT_VERIFIED');
  await verify('trial@x.com');
  assert.equal((await call('trial-start', {}, { token: s.body.token })).status, 200);
  const a = await call('account', null, { token: s.body.token, method: 'GET' });
  assert.equal(a.body.plan, 'premium'); assert.equal(a.body.planSource, 'trial'); assert.equal(a.body.seats.limit, 5);
  assert.equal((await call('trial-start', {}, { token: s.body.token })).status, 409, 'cannot restart');
});

test('invitations: seat reservation, global email uniqueness, accept, revoke/expiry release seats, removal and sessions', async () => {
  const o = await signup('boss@x.com'); await verify('boss@x.com');
  assert.equal((await call('team-invite', { action: 'invite', email: 'p1@x.com' }, { token: o.body.token })).body.code, 'NO_SEATS', 'Free has one seat');
  await call('trial-start', {}, { token: o.body.token }); // 5 seats during trial
  for (let i = 1; i <= 4; i++) assert.equal((await call('team-invite', { action: 'invite', email: 'p' + i + '@x.com' }, { token: o.body.token })).status, 200);
  assert.equal((await call('team-invite', { action: 'invite', email: 'p5@x.com' }, { token: o.body.token })).status, 402, 'pending invites hold seats');
  assert.equal((await call('team-invite', { action: 'invite', email: 'boss@x.com' }, { token: o.body.token })).status, 409);
  await signup('already@x.com'); // someone with their own account cannot be pulled into another team
  assert.equal((await call('team-invite', { action: 'invite', email: 'already@x.com' }, { token: o.body.token })).status, 409, 'someone with their own account cannot be pulled into another team');
  let acct = await call('account', null, { token: o.body.token, method: 'GET' });
  assert.equal(acct.body.seats.reserved, 4); assert.equal(acct.body.seats.available, 0);
  const inv1 = acct.body.invitations.find((i) => i.email === 'p1@x.com');
  assert.equal((await call('team-invite', { action: 'revoke', invitationId: inv1.id }, { token: o.body.token })).status, 200);
  assert.equal((await call('account', null, { token: o.body.token, method: 'GET' })).body.seats.available, 1, 'revoke releases the seat');
  assert.equal((await call('team-invite', { action: 'invite', email: 'already@x.com' }, { token: o.body.token })).status, 409, 'existing identity cannot be invited');

  const link = lastMailLink('p2@x.com', /https:\/\/\S*signup\S*invite=\S+/); const tok = tokenIn(link);
  assert.deepEqual(await call('invite-accept', { check: true, token: tok }).then((r) => [r.body.valid, r.body.email]), [true, 'p2@x.com']);
  assert.equal((await call('invite-accept', { token: tok, name: 'P Two', password: 'password two!', acceptedTerms: false })).status, 400);
  const joined = await call('invite-accept', { token: tok, name: 'P Two', password: 'password two!', acceptedTerms: true, marketingOptIn: false });
  assert.equal(joined.status, 200); assert.equal(joined.body.role, 'member'); assert.equal(joined.body.emailVerified, true);
  assert.equal((await call('invite-accept', { token: tok, name: 'X', password: 'password two!', acceptedTerms: true })).status, 400, 'invite token is single use');
  const member = joined.body.token;
  assert.equal((await call('team-invite', { action: 'invite', email: 'zzz@x.com' }, { token: member })).status, 403, 'members cannot invite');

  // owner revokes -> member is cut off immediately; local data is theirs, nothing server-side to delete
  const mem = (await call('account', null, { token: o.body.token, method: 'GET' })).body.members.find((m) => m.email === 'p2@x.com');
  await call('team-update', { action: 'revoke', memberId: mem.id }, { token: o.body.token });
  const cut = await call('account', null, { token: member, method: 'GET' }); assert.equal(cut.status, 403); assert.equal(cut.body.code, 'ACCESS_REVOKED');
  assert.equal((await call('login', { email: 'p2@x.com', password: 'password two!' })).status, 403);
  await call('team-update', { action: 'restore', memberId: mem.id }, { token: o.body.token });
  assert.equal((await call('login', { email: 'p2@x.com', password: 'password two!' })).status, 200);

  // expiry releases seats
  const store = require('../netlify/functions/_lib/store');
  await store.accounts.update('boss@x.com', (a) => { a.invitations.filter((i) => i.status === 'pending').forEach((i) => (i.expiresAt = Date.now() - 1)); });
  assert.equal((await call('account', null, { token: o.body.token, method: 'GET' })).body.seats.reserved, 0);
});

test('extension pairing: one-time code, token never in the code, session bound to current login', async () => {
  const s = await signup('ext@x.com');
  const p = await call('pair', { action: 'create' }, { token: s.body.token });
  assert.ok(p.body.code && !p.body.code.includes('.'), 'code is opaque, not a signed token');
  const ex = await call('pair', { action: 'exchange', code: p.body.code, installId: 'inst1' });
  assert.equal(ex.status, 200); assert.equal(ex.body.plan, 'free');
  assert.equal((await call('pair', { action: 'exchange', code: p.body.code, installId: 'inst1' })).status, 400, 'code works once');
  assert.equal((await call('entitlement', null, { token: ex.body.token, method: 'GET' })).body.plan, 'free');
  assert.equal((await call('account', null, { token: ex.body.token, method: 'GET' })).status, 401, 'extension token cannot call web-only endpoints');
  assert.equal((await call('entitlement', null, { token: s.body.token, method: 'GET' })).status, 401, 'web token is not an extension token');
  // consent is required; counts only
  assert.equal((await call('analytics-sync', { installId: 'inst1', snippets: 3 }, { token: ex.body.token })).status, 400);
  assert.equal((await call('analytics-sync', { consent: true, installId: 'inst1', snippets: 3, autofills: 1, captures: 2, savedSec: 90, text: 'SECRET CLIPBOARD', url: 'https://bank' }, { token: ex.body.token })).status, 200);
  const dump = fs.readdirSync(dir).filter((f) => f.startsWith('an%2F')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  assert.ok(!dump.includes('SECRET CLIPBOARD') && !dump.includes('bank'), 'no content is stored');
  const an = await call('analytics', null, { token: s.body.token, method: 'GET' }); assert.equal(an.body.byMember[0].savedSec, 90);
  // logging in on another device kills the extension session too
  await call('login', { email: 'ext@x.com', password: 'correct horse' });
  assert.equal((await call('entitlement', null, { token: ex.body.token, method: 'GET' })).status, 401);
});

/* ---- payments ---- */
const sign = (raw) => crypto.createHmac('sha256', 'whsec_test').update(raw).digest('hex');
const hook = (payload, sig) => { const raw = JSON.stringify(payload); return call('payment-webhook', null, { raw, headers: { 'creem-signature': sig === undefined ? sign(raw) : sig } }); };
const completedEvent = (id, requestId, productId, units, order, email) => ({ id, eventType: 'checkout.completed', created_at: Date.now(), object: { id: 'ch_x', object: 'checkout', request_id: requestId, units, status: 'completed', mode: 'test', product: { id: productId }, customer: { email }, metadata: { accountEmail: email }, order: { id: order, status: 'paid', amount: productId === 'prod_seat' ? 250 * units : 2500, currency: 'USD', transaction: 'tran_' + order } } });

test('payments: Premium checkout -> webhook grants, duplicates ignored, forged/unsigned rejected', async () => {
  const s = await signup('buyer@x.com');
  const co = await call('checkout', { type: 'premium' }, { token: s.body.token });
  assert.equal(co.status, 200); assert.match(co.body.checkoutUrl, /^https:\/\/creem\.io\/test\/checkout\//); assert.equal(co.body.totalUSD, 25);
  const sent = creemCalls.filter((c) => c.url.endsWith('/v1/checkouts') && c.method === 'POST').pop();
  assert.equal(sent.body.product_id, 'prod_premium'); assert.equal(sent.body.units, 1); assert.equal(sent.headers['x-api-key'], 'creem_test_key');
  assert.equal(sent.body.metadata.accountEmail, 'buyer@x.com'); assert.equal(sent.body.metadata.purchaseType, 'premium'); assert.ok(sent.body.request_id.startsWith('pb_'));
  assert.equal(sent.body.success_url, 'https://pastedeck.netlify.app/dashboard/index.html?checkout=' + co.body.requestId);

  assert.equal((await call('account', null, { token: s.body.token, method: 'GET' })).body.plan, 'free', 'redirect/return alone grants nothing');
  const ev = completedEvent('evt_1', co.body.requestId, 'prod_premium', 1, 'ord_1', 'buyer@x.com');
  assert.equal((await hook(ev, 'bad')).status, 401); assert.equal((await hook(ev, '')).status, 401);
  assert.equal((await call('account', null, { token: s.body.token, method: 'GET' })).body.plan, 'free');
  assert.equal((await hook(ev)).status, 200);
  const a = await call('account', null, { token: s.body.token, method: 'GET' });
  assert.equal(a.body.plan, 'premium'); assert.equal(a.body.seats.limit, 5); assert.equal(a.body.purchases[0].amountUSD, 25); assert.equal(a.body.purchases[0].test, true);
  assert.equal((await hook(ev)).body.duplicate, true);
  assert.equal((await hook(Object.assign({}, ev, { id: 'evt_resent' }))).status, 200); // manual resend: new event id, same order
  assert.equal((await call('account', null, { token: s.body.token, method: 'GET' })).body.purchases.length, 1, 'same order never granted twice');
  assert.equal((await call('checkout', { type: 'premium' }, { token: s.body.token })).status, 409, 'already premium');
});

test('payments: extra seats use units, raise the limit permanently, removal frees a seat, refund reverses and revokes overflow', async () => {
  const s = await signup('seats@x.com'); await verify('seats@x.com');
  assert.equal((await call('checkout', { type: 'seats', quantity: 5 }, { token: s.body.token })).status, 409, 'need Premium first');
  const p = await call('checkout', { type: 'premium' }, { token: s.body.token });
  await hook(completedEvent('evt_p', p.body.requestId, 'prod_premium', 1, 'ord_p', 'seats@x.com'));
  assert.equal((await call('checkout', { type: 'seats', quantity: 0 }, { token: s.body.token })).status, 400);
  const c = await call('checkout', { type: 'seats', quantity: 5 }, { token: s.body.token });
  assert.equal(c.body.totalUSD, 12.5);
  const sent = creemCalls.filter((x) => x.method === 'POST' && x.url.endsWith('/v1/checkouts')).pop();
  assert.equal(sent.body.product_id, 'prod_seat'); assert.equal(sent.body.units, 5);
  // customer returned before the webhook arrived: the status endpoint verifies with Creem's API and grants (idempotently)
  const providerId = (await require('../netlify/functions/_lib/store').kv.get('chk/' + c.body.requestId)).providerCheckoutId;
  creemCheckouts[providerId] = { id: providerId, status: 'pending' };
  assert.equal((await call('checkout-status', { requestId: c.body.requestId }, { token: s.body.token })).body.status, 'pending');
  creemCheckouts[providerId] = { id: providerId, status: 'completed', request_id: c.body.requestId, units: 5, mode: 'test', product: { id: 'prod_seat' }, order: { id: 'ord_s', status: 'paid', amount: 1250, currency: 'USD', transaction: 'tran_ord_s' }, metadata: { accountEmail: 'seats@x.com' } };
  assert.equal((await call('checkout-status', { requestId: c.body.requestId }, { token: s.body.token })).body.status, 'completed');
  let a = await call('account', null, { token: s.body.token, method: 'GET' });
  assert.equal(a.body.seats.limit, 10); assert.equal(a.body.seats.extraPurchased, 5);
  assert.equal((await hook(completedEvent('evt_s', c.body.requestId, 'prod_seat', 5, 'ord_s', 'seats@x.com'))).status, 200); // webhook after API verification
  a = await call('account', null, { token: s.body.token, method: 'GET' }); assert.equal(a.body.seats.limit, 10); assert.equal(a.body.purchases.length, 2, 'no double grant');
  assert.equal(a.body.purchases.reduce((t, x) => t + x.amountUSD, 0), 37.5);

  // fill 9 members, then refund the 5 extra seats -> newest overflow members are revoked, never exceeding the limit
  const store = require('../netlify/functions/_lib/store');
  await store.accounts.update('seats@x.com', (acc) => { for (let i = 0; i < 8; i++) acc.members.push(Object.assign(require('../netlify/functions/_lib/accounts').newMember({ username: 'm' + i, name: 'M' + i, email: 'm' + i + '@x.com', passwordHash: null, role: 'member' }), { createdAt: Date.now() + i })); });
  assert.equal((await call('team-invite', { action: 'invite', email: 'late@x.com' }, { token: s.body.token })).status, 200);
  const refundEv = { id: 'evt_r', eventType: 'refund.created', created_at: 1, object: { id: 'ref_1', status: 'succeeded', refund_amount: 1250, refund_currency: 'USD', transaction: { id: 'tran_ord_s', amount_paid: 1250, order: 'ord_s' }, order: { id: 'ord_s' }, mode: 'test' } };
  assert.equal((await hook(refundEv)).status, 200);
  a = await call('account', null, { token: s.body.token, method: 'GET' });
  assert.equal(a.body.seats.limit, 5); assert.ok(a.body.seats.used <= 5, 'never above the limit'); assert.equal(a.body.purchases.find((x) => x.id === 'ord_s').status, 'refunded');
  assert.equal((await hook(Object.assign({}, refundEv, { id: 'evt_r2' }))).status, 200);
  assert.equal((await call('account', null, { token: s.body.token, method: 'GET' })).body.seats.limit, 5, 'refund is idempotent');
  // partial refund: recorded, entitlement unchanged
  const partial = { id: 'evt_pr', eventType: 'refund.created', created_at: 1, object: { id: 'ref_2', status: 'succeeded', refund_amount: 500, transaction: { id: 'tran_ord_p', amount_paid: 2500, order: 'ord_p' }, order: { id: 'ord_p' } } };
  assert.equal((await hook(partial)).status, 200);
  a = await call('account', null, { token: s.body.token, method: 'GET' }); assert.equal(a.body.plan, 'premium'); assert.equal(a.body.purchases.find((x) => x.id === 'ord_p').partialRefundUSD, 5);
});

test('admin: refund calls Creem /v1/refunds, stats exclude test purchases, unauthenticated rejected', async () => {
  assert.equal((await call('refund', { orderId: 'ord_1' })).status, 401);
  const r = await call('refund', { orderId: 'ord_1' }, { headers: { 'x-admin-token': 'admin-token-1234567890' } });
  assert.equal(r.status, 200); const sent = creemCalls.filter((c) => c.url.endsWith('/v1/refunds')).pop(); assert.equal(sent.body.transaction_id, 'tran_ord_1');
  const st = await call('admin-stats', null, { method: 'GET', headers: { 'x-admin-token': 'admin-token-1234567890' } });
  assert.equal(st.body.revenueUSD, 0, 'CREEM_MODE=test purchases are not real revenue'); assert.ok(st.body.testOrDemoUSD > 0);
});

test('founder bootstrap: no default password, secret required, demo data clearly synthetic and never counted as sales', async () => {
  assert.equal((await call('founder-bootstrap', {}, { headers: { 'x-bootstrap-secret': 'wrong-secret-1234567' } })).status, 401);
  const r = await call('founder-bootstrap', {}, { headers: { 'x-bootstrap-secret': 'bootstrap-secret-123456' } });
  assert.equal(r.status, 200); assert.equal(r.body.founderEmail, 'founder@example.com'); assert.ok(r.body.setPasswordUrl.includes('reset-password'));
  assert.equal((await call('login', { email: 'founder@example.com', password: 'anything at all' })).status, 401, 'no password exists until the link is used');
  const token = tokenIn(r.body.setPasswordUrl);
  assert.equal((await call('reset-password', { token, password: 'founder chosen pass' })).status, 200);
  const login = await call('login', { email: 'founder@example.com', password: 'founder chosen pass' }); assert.equal(login.status, 200);
  const a = await call('account', null, { token: login.body.token, method: 'GET' });
  assert.ok(a.body.members.some((m) => m.email.endsWith('@demo.invalid'))); assert.ok(a.body.purchases.every((p) => p.demo));
  assert.equal((await call('founder-bootstrap', {}, { headers: { 'x-bootstrap-secret': 'bootstrap-secret-123456' } })).body.demoSeeded, 'already-seeded');
  const st = await call('admin-stats', null, { method: 'GET', headers: { 'x-admin-token': 'admin-token-1234567890' } });
  assert.ok(!st.body.recentPayments.some((p) => p.accountEmail === 'founder@example.com' && !p.demo));
});

test('refuses to run on a deployed site without a real PASTEBOARD_SECRET', async () => {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, ['-e', "process.env.CONTEXT='production';delete process.env.PASTEBOARD_SECRET;try{require('./netlify/functions/_lib/crypto').signToken({});console.log('SIGNED')}catch(e){console.log('REFUSED')}"], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(out.trim(), 'REFUSED');
});

test('concurrency: parallel signups for one email create one account; parallel invites never exceed the seat limit', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => signup('race@x.com')));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  const o = await signup('racer@x.com'); await verify('racer@x.com'); await call('trial-start', {}, { token: o.body.token }); // 5 seats, owner uses 1
  const inv = await Promise.all(Array.from({ length: 10 }, (_, i) => call('team-invite', { action: 'invite', email: 'rc' + i + '@x.com' }, { token: o.body.token })));
  assert.equal(inv.filter((r) => r.status === 200).length, 4, 'exactly the 4 free seats are reserved');
  assert.equal((await call('account', null, { token: o.body.token, method: 'GET' })).body.seats.available, 0);
});
