/*
 * One-time, admin-only migration from the old storage layout (one big `accounts` JSON blob, `devices` array,
 * plans free/freeplus/premium/premiumpro) to the per-record layout. Safe to run repeatedly: existing new-style
 * accounts are skipped. POST with X-Admin-Token. Add {"dryRun":true} to preview.
 *
 *   - devices[] -> members[]; password hashes are kept (old scrypt hashes still verify and upgrade on next login)
 *   - 'pending' access requests are dropped (the open request-access flow no longer exists; owners re-invite by email)
 *   - plan: nobody ever paid (no processor was connected), so every legacy account starts on Free, except accounts whose
 *     14-day trial is still running, which keep it until it ends. 'premiumpro' is retired; it maps to the same rule.
 *   - everyone gets emailVerified:false until they verify; nobody is signed in (no sid) so all must log in again.
 */
const store = require('./_lib/store');
const { ok, parseBody, route } = require('./_lib/http');
const { requireAdmin } = require('./_lib/admin');
const { TERMS_VERSION } = require('./_lib/config');

exports.handler = route('POST', async (event) => {
  requireAdmin(event);
  const { dryRun } = parseBody(event);
  const legacy = (await store.kv.get('accounts')) || {};
  const report = { found: Object.keys(legacy).length, migrated: 0, skipped: 0, droppedPending: 0, emailConflicts: [] };
  for (const key of Object.keys(legacy)) {
    const a = legacy[key], email = String(a.email || key).toLowerCase();
    if (await store.accounts.get(email)) { report.skipped++; continue; }
    const members = [];
    for (const d of a.devices || []) {
      if (d.status === 'pending' || d.status === 'rejected') { report.droppedPending++; continue; }
      members.push({
        id: d.id, username: d.username, name: d.name, email: String(d.email).toLowerCase(), passwordHash: d.passwordHash,
        role: d.role, status: d.status === 'active' ? 'active' : 'revoked', analyticsAccess: !!d.analyticsAccess, createdAt: d.createdAt || Date.now(),
        lastLoginAt: d.lastLoginAt || null, lastActive: d.lastActive || null, emailVerified: false, termsAcceptedAt: d.termsAcceptedAt || a.termsAcceptedAt || null,
        termsVersion: 'legacy', marketingOptIn: false, sid: null, sidMethod: null, sidIssuedAt: null, passkeys: [], failed: { count: 0, until: 0 },
      });
    }
    if (!members.some((m) => m.role === 'owner')) { report.skipped++; continue; }
    const trialLive = a.trial && a.trial.endsAt > Date.now();
    const doc = { email, createdAt: a.createdAt || Date.now(), members, invitations: [], purchases: [], entitlements: { premium: null, extraSeats: 0 }, trial: trialLive ? { startedAt: a.trial.startedAt, endsAt: a.trial.endsAt } : (a.trial ? { startedAt: a.trial.startedAt, endsAt: a.trial.endsAt } : null) };
    if (dryRun) { report.migrated++; continue; }
    let conflict = false;
    for (const m of members) if (!(await store.emailIndex.claim(m.email, { accountEmail: email, memberId: m.id }))) { const cur = await store.emailIndex.get(m.email); if (!cur || cur.accountEmail !== email) { report.emailConflicts.push(m.email); conflict = true; } }
    if (conflict) { report.skipped++; continue; }
    await store.accounts.create(doc);
    report.migrated++;
  }
  return ok(report);
});
