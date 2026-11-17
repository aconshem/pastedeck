const store = require('./_lib/store');
const { ok, parseBody, route, httpError } = require('./_lib/http');
const { authenticate } = require('./_lib/auth');
const { activeMembers, pendingInvites, seatLimit } = require('./_lib/entitlements');

const ACTIONS = ['setAnalyticsAccess', 'setRole', 'revoke', 'restore', 'remove'];

/* Owner-only changes to existing members. Revoke/remove clear the member's session id, so they are signed out on
   their very next request (web and extension). Their local PasteBoard data on their own computer is never touched. */
exports.handler = route('POST', async (event) => {
  const { account, me } = await authenticate(event, { role: ['owner'], type: 'web' });
  const b = parseBody(event);
  if (!ACTIONS.includes(b.action)) throw httpError(400, 'Unknown action.');
  const target = account.members.find((m) => m.id === b.memberId);
  if (!target) throw httpError(404, 'That person was not found.');
  if (target.role === 'owner') throw httpError(400, 'The owner’s own access can’t be changed here.');

  await store.accounts.update(account.email, (acc) => {
    const m = acc.members.find((x) => x.id === b.memberId);
    if (b.action === 'setAnalyticsAccess') m.analyticsAccess = !!b.value;
    else if (b.action === 'setRole') m.role = b.value === 'admin' ? 'admin' : 'member';
    else if (b.action === 'revoke') { m.status = 'revoked'; m.revokedReason = 'owner'; m.sid = null; }
    else if (b.action === 'remove') { m.status = 'removed'; m.sid = null; }
    else if (b.action === 'restore') {
      if (m.status === 'active') return false;
      if (activeMembers(acc).length + pendingInvites(acc).length >= seatLimit(acc)) throw httpError(409, 'No free seats. Remove someone or buy more seats first.');
      m.status = 'active'; m.revokedReason = null;
    }
  });
  return ok({ ok: true });
});
