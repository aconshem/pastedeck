/*
 * Thin fetch wrapper for the real Netlify Functions backend (signup, login, device requests, account, team,
 * interest tracking). Base path is same-origin "/.netlify/functions/..." so this works once deployed on Netlify
 * — including local testing via `netlify dev`. It will NOT work opened straight from a file:// URL or from a
 * plain static file server, since there is no server behind it in that case; PBApi.call surfaces a clear error
 * rather than failing silently.
 */
(function (g) {
  'use strict';
  const TOKEN_KEY = 'pb_session';

  async function call(name, opts) {
    opts = opts || {};
    let res;
    try {
      res = await fetch('/.netlify/functions/' + name, {
        method: opts.method || (opts.body ? 'POST' : 'GET'),
        headers: Object.assign({ 'Content-Type': 'application/json' }, opts.auth ? { Authorization: 'Bearer ' + (PBApi.token() || '') } : {}, opts.headers || {}),
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new Error('Could not reach the PasteBoard backend. If you\u2019re running this locally, start it with `netlify dev` instead of a plain static server.');
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }

  const PBApi = {
    token: () => localStorage.getItem(TOKEN_KEY),
    session() { const t = localStorage.getItem(TOKEN_KEY); if (!t) return null; try { return JSON.parse(localStorage.getItem(TOKEN_KEY + '_meta') || 'null'); } catch (e) { return null; } },
    setSession(data) { localStorage.setItem(TOKEN_KEY, data.token); localStorage.setItem(TOKEN_KEY + '_meta', JSON.stringify(data)); },
    signOut() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY + '_meta'); },
    signup: (b) => call('signup', { body: b }),
    login: (b) => call('login', { body: b }),
    deviceRequest: (b) => call('device-request', { body: b }),
    account: () => call('account', { auth: true }),
    deviceApprove: (deviceId) => call('device-approve', { body: { deviceId }, auth: true }),
    deviceReject: (deviceId) => call('device-reject', { body: { deviceId }, auth: true }),
    teamUpdate: (b) => call('team-update', { body: b, auth: true }),
    trackInterest: (b) => call('track-interest', { body: b }).catch(() => {}), // best-effort; never blocks the UI
  };
  g.PBApi = PBApi;
})(window);
