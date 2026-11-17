/* Shared response helpers. CORS is restricted to the production origin — the website is same-origin anyway, and the
   extension's service worker is exempt from CORS through its host permission. */
const { BASE_URL } = require('./config');
const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': BASE_URL,
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token, X-Bootstrap-Secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
function json(status, body) { return { statusCode: status, headers: HEADERS, body: JSON.stringify(body) }; }
const ok = (body) => json(200, body);
const bad = (msg, status, extra) => json(status || 400, Object.assign({ error: msg }, extra || {}));
function parseBody(event) { try { return JSON.parse(event.body || '{}') || {}; } catch (e) { return {}; } }
function header(event, name) {
  const h = event.headers || {};
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? h[k] : undefined;
}
function bearer(event) { return String(header(event, 'authorization') || '').replace(/^Bearer\s+/i, '') || null; }
/* Wraps a handler: handles OPTIONS, enforces the method, and turns thrown errors into JSON instead of a stack dump. */
function route(method, fn) {
  return async (event, context) => {
    if (event.httpMethod === 'OPTIONS') return ok({});
    if (method && event.httpMethod !== method) return bad(method + ' only', 405);
    try { return await fn(event, context); }
    catch (e) {
      if (e && e.status) return bad(e.message, e.status, e.extra);
      console.error('[pasteboard] unhandled', e && e.stack || e);
      return bad('Something went wrong on our side. Try again in a moment.', 500);
    }
  };
}
const httpError = (status, message, extra) => { const e = new Error(message); e.status = status; e.extra = extra; return e; };
module.exports = { ok, bad, json, parseBody, bearer, header, route, httpError, HEADERS };
