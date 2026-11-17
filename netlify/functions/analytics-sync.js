const store = require('./_lib/store');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const { authenticate } = require('./_lib/auth');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => Math.min(1e7, Math.max(0, Math.round(+v || 0)));

/* Receives COUNTS ONLY: snippets used, autofills, captures, estimated seconds saved. There is deliberately no field
   for text, URLs, names or file data — anything else in the body is ignored, not stored. The extension only calls this
   after the person turns on "Share usage counts" and sends consent:true. */
exports.handler = route('POST', async (event) => {
  const { account, me } = await authenticate(event, { type: 'ext' });
  const b = parseBody(event);
  if (b.consent !== true) throw httpError(400, 'Analytics consent is required.', { code: 'NO_CONSENT' });
  const installId = String(b.installId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  if (!installId) throw httpError(400, 'installId is required.');
  const day = DAY_RE.test(b.day) ? b.day : new Date().toISOString().slice(0, 10);
  await store.analytics.setDay(account.email, me.id, installId, day, { snippets: num(b.snippets), autofills: num(b.autofills), captures: num(b.captures), savedSec: num(b.savedSec) });
  await store.accounts.update(account.email, (acc) => { const m = acc.members.find((x) => x.id === me.id); m.lastActive = Date.now(); m.analyticsConsentAt = m.analyticsConsentAt || Date.now(); });
  return ok({ ok: true });
});
