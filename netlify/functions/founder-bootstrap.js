/*
 * Founder-only bootstrap. Not linked from anywhere and useless without the secret.
 *   Env vars (Netlify): FOUNDER_BOOTSTRAP_EMAIL, FOUNDER_BOOTSTRAP_SECRET (16+ random chars), optional FOUNDER_DEMO_SEED=true
 *   Call:   POST /.netlify/functions/founder-bootstrap   header  X-Bootstrap-Secret: <the secret>
 * It creates YOUR account with NO password and returns a one-time link (valid 24 h) where you choose one — nothing is
 * hard-coded. With FOUNDER_DEMO_SEED=true it also adds clearly-marked synthetic data so you can inspect the dashboard:
 * members on @demo.invalid addresses (a reserved, undeliverable domain), pending invitations, sample aggregate counts
 * and purchases flagged `demo` that are excluded from revenue. No clipboard or other real content is ever created.
 * Normal customer accounts are never seeded: they start empty.
 */
const store = require('./_lib/store');
const { json, ok, route, header, httpError } = require('./_lib/http');
const { safeEqual, newId, sha256hex } = require('./_lib/crypto');
const A = require('./_lib/accounts');
const { BASE_URL, env } = require('./_lib/config');

exports.handler = route('POST', async (event) => {
  const email = A.normEmail(env('FOUNDER_BOOTSTRAP_EMAIL', '')), secret = env('FOUNDER_BOOTSTRAP_SECRET', '');
  const missing = [];
  if (!email) missing.push('FOUNDER_BOOTSTRAP_EMAIL'); if (!secret || secret.length < 16) missing.push('FOUNDER_BOOTSTRAP_SECRET (16+ characters)');
  if (missing.length) return json(500, { error: 'Set these Netlify environment variables first, then redeploy: ' + missing.join(', ') });
  const got = header(event, 'x-bootstrap-secret');
  if (!got || !safeEqual(got, secret)) throw httpError(401, 'Not authorized.');
  A.checkEmail(email);

  let account = await store.accounts.get(email);
  let created = false;
  if (!account) {
    const m = A.newMember({ username: 'founder', name: 'Founder', email, passwordHash: null, role: 'owner', analyticsAccess: true, emailVerified: true });
    if (!(await store.emailIndex.claim(email, { accountEmail: email, memberId: m.id }))) throw httpError(409, 'That email already belongs to another account.');
    account = { email, createdAt: Date.now(), members: [m], invitations: [], purchases: [], entitlements: { premium: { active: true, source: 'founder', paidAt: Date.now() }, extraSeats: 0 }, trial: null };
    await store.accounts.create(account); created = true;
  }
  const seeded = env('FOUNDER_DEMO_SEED') === 'true' ? await seedDemo(email) : false;
  const raw = await A.issueToken('reset', { accountEmail: email, memberId: account.members[0].id }, 24 * 3600000);
  return ok({
    founderEmail: email, accountCreated: created, demoSeeded: seeded,
    setPasswordUrl: BASE_URL + '/reset-password/index.html?token=' + encodeURIComponent(raw),
    next: 'Open setPasswordUrl within 24 hours, choose a password, then log in at ' + BASE_URL + '/login/index.html with ' + email + '. Call this endpoint again any time to get a fresh link.',
  });
});

async function seedDemo(email) {
  const acc = await store.accounts.get(email);
  if (acc.demoSeeded) return 'already-seeded';
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const people = [['Amina Demo', 'member'], ['Brian Demo', 'member'], ['Carol Demo', 'admin']];
  const members = people.map(([name, role], i) => Object.assign(A.newMember({ username: 'demo' + (i + 1), name, email: 'demo' + (i + 1) + '@demo.invalid', passwordHash: null, role, emailVerified: true }), { demo: true, lastActive: Date.now() - i * 3600000 }));
  const an = { members: {} };
  [acc.members[0].id].concat(members.map((m) => m.id)).forEach((id, mi) => {
    const days = {}; for (let d = 0; d < 30; d++) days[day(d)] = { snippets: 4 + ((d * 7 + mi * 3) % 9), autofills: (d + mi) % 5, captures: (d * 2 + mi) % 4, savedSec: 150 + ((d * 53 + mi * 97) % 400) };
    an.members[id] = { installs: { ['demo-install-' + mi]: { days, lastSeen: Date.now() - mi * 7200000 } } };
  });
  await store.kv.set('an/' + email, an);
  await store.accounts.update(email, (a) => {
    if (a.demoSeeded) return false;
    a.members.push(...members);
    a.invitations.push(...['pending1', 'pending2'].map((n) => ({ id: newId('inv'), email: n + '@demo.invalid', role: 'member', status: 'pending', invitedBy: a.members[0].id, createdAt: Date.now() - 86400000, expiresAt: Date.now() + 6 * 86400000, tokenHash: sha256hex('demo-' + n), demo: true })));
    a.entitlements.extraSeats = 5;
    a.purchases.push({ id: 'demo_order_1', orderId: 'demo_order_1', provider: 'demo', type: 'premium', units: 1, amountUSD: 25, currency: 'USD', at: Date.now() - 20 * 86400000, status: 'paid', test: true, demo: true });
    a.purchases.push({ id: 'demo_order_2', orderId: 'demo_order_2', provider: 'demo', type: 'seats', units: 5, amountUSD: 12.5, currency: 'USD', at: Date.now() - 5 * 86400000, status: 'paid', test: true, demo: true });
    a.demoSeeded = true;
  });
  return true;
}
