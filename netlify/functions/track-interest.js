const store = require('./_lib/store');
const { ok, bad, parseBody } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const b = parseBody(event);
  await store.interest.add({
    plan: String(b.plan || 'premiumpro').slice(0, 40),
    page: String(b.page || '').slice(0, 200),
    email: b.email ? String(b.email).slice(0, 200).toLowerCase() : null,
    at: Date.now(),
  });
  return ok({ ok: true });
};
