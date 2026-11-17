const { header, httpError } = require('./http');
const { safeEqual } = require('./crypto');
/* Founder/admin endpoints: PASTEBOARD_ADMIN_TOKEN must be set on the server and sent as the X-Admin-Token header. */
function requireAdmin(event) {
  const expected = process.env.PASTEBOARD_ADMIN_TOKEN;
  if (!expected || expected.length < 16) throw httpError(500, 'PASTEBOARD_ADMIN_TOKEN is not set (use 16+ random characters) in the Netlify environment variables.');
  const got = header(event, 'x-admin-token');
  if (!got || !safeEqual(got, expected)) throw httpError(401, 'Not authorized.');
}
module.exports = { requireAdmin };
