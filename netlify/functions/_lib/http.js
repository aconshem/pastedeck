/* Small helpers shared by every function: consistent JSON responses + CORS for same-site fetches. */
const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
function json(status, body) { return { statusCode: status, headers: HEADERS, body: JSON.stringify(body) }; }
function ok(body) { return json(200, body); }
function bad(msg, status) { return json(status || 400, { error: msg }); }
function parseBody(event) { try { return JSON.parse(event.body || '{}'); } catch (e) { return {}; } }
function bearer(event) { const h = event.headers.authorization || event.headers.Authorization || ''; return h.replace(/^Bearer\s+/i, '') || null; }
module.exports = { ok, bad, json, parseBody, bearer, HEADERS };
