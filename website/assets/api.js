/*
<<<<<<< HEAD
 * Thin fetch wrapper for the Netlify Functions backend (same-origin "/.netlify/functions/..."), plus the two browser
 * helpers every auth page needs: connecting the extension (one-time pairing code) and passkeys (WebAuthn).
 * Works with `netlify dev`; a plain static server has no functions behind it, so call() says so clearly.
=======
 * Thin fetch wrapper for the real Netlify Functions backend (signup, login, device requests, account, team,
 * interest tracking). Base path is same-origin "/.netlify/functions/..." so this works once deployed on Netlify
 * — including local testing via `netlify dev`. It will NOT work opened straight from a file:// URL or from a
 * plain static file server, since there is no server behind it in that case; PBApi.call surfaces a clear error
 * rather than failing silently.
>>>>>>> bb4656f6918703bd5f507e283028530221861759
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
<<<<<<< HEAD
        headers: Object.assign({ 'Content-Type': 'application/json' }, opts.auth ? { Authorization: 'Bearer ' + (PBApi.token() || '') } : {}),
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new Error('Could not reach PasteBoard. Check your connection (running locally? use `netlify dev`).');
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data.error || ('Request failed (' + res.status + ')'));
      err.code = data.code; err.status = res.status;
      if (opts.auth && (res.status === 401 || data.code === 'ACCESS_REVOKED' || data.code === 'ACCESS_REMOVED')) { PBApi.signOut(); if (PBApi.onSignedOut) PBApi.onSignedOut(data.code, err.message); }
      throw err;
    }
    return data;
  }

  /* ---- website <-> extension (only for the one-time pairing code and a status badge) ---- */
  function bridgeCall(type, payload, timeout) {
    return new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 1e9) + 1;
      const on = (e) => {
        const d = e.data;
        if (e.source !== g || !d || d.pd !== 'ext' || d.id !== id) return;
        g.removeEventListener('message', on); clearTimeout(t);
        d.error ? reject(new Error(d.error)) : resolve(d.type === 'pong' ? d : d.data);
      };
      const t = setTimeout(() => { g.removeEventListener('message', on); reject(new Error('NO_EXTENSION')); }, timeout || 1500);
      g.addEventListener('message', on);
      g.postMessage(Object.assign({ pd: 'site', type, id }, payload || {}), g.location.origin);
    });
  }

  const b64uToBuf = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
  const bufToB64u = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

  const PBApi = {
    token: () => localStorage.getItem(TOKEN_KEY),
    session() { const t = localStorage.getItem(TOKEN_KEY); if (!t) return null; try { return JSON.parse(localStorage.getItem(TOKEN_KEY + '_meta') || 'null'); } catch (e) { return null; } },
    setSession(data) { localStorage.setItem(TOKEN_KEY, data.token); localStorage.setItem(TOKEN_KEY + '_meta', JSON.stringify({ accountEmail: data.accountEmail, memberId: data.memberId, role: data.role, name: data.name, email: data.email, emailVerified: data.emailVerified, token: data.token })); },
    signOut() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY + '_meta'); },
    onSignedOut: null,
    signup: (b) => call('signup', { body: b }),
    login: (b) => call('login', { body: b }),
    logout: () => call('logout', { body: {}, auth: true }).catch(() => {}),
    forgot: (email) => call('forgot-password', { body: { email } }),
    resetCheck: (token) => call('reset-password', { body: { check: true, token } }),
    reset: (token, password) => call('reset-password', { body: { token, password } }),
    changePassword: (b) => call('change-password', { body: b, auth: true }),
    verifyEmail: (token) => call('verify-email', { body: { token } }),
    resendVerification: () => call('verify-email', { body: { resend: true }, auth: true }),
    inviteCheck: (token) => call('invite-accept', { body: { check: true, token } }),
    inviteAccept: (b) => call('invite-accept', { body: b }),
    account: () => call('account', { auth: true }),
    teamUpdate: (b) => call('team-update', { body: b, auth: true }),
    invite: (b) => call('team-invite', { body: b, auth: true }),
    teamAnalytics: () => call('analytics', { auth: true }),
    startTrial: () => call('trial-start', { body: {}, auth: true }),
    checkout: (b) => call('checkout', { body: b, auth: true }),
    checkoutStatus: (requestId) => call('checkout-status', { body: { requestId }, auth: true }),
    passkey: (b, auth) => call('passkey', { body: b, auth: auth !== false && !!PBApi.token() }),

    /* Connect the extension: the server issues a one-time code; only that code crosses into the extension. */
    async linkExtension() {
      try { await bridgeCall('ping'); } catch (e) { return { ok: false, reason: 'no-extension' }; }
      const { code } = await call('pair', { body: { action: 'create' }, auth: true });
      const r = await bridgeCall('pair', { code }, 8000);
      return { ok: true, name: r && r.name };
    },
    extensionStatus: () => bridgeCall('status', null, 800).catch(() => null),

    passkeysSupported: () => !!(g.PublicKeyCredential && navigator.credentials),
    async passkeyRegister(name) {
      const o = await PBApi.passkey({ action: 'register-options' });
      const pk = o.publicKey;
      pk.challenge = b64uToBuf(pk.challenge); pk.user.id = b64uToBuf(pk.user.id);
      pk.excludeCredentials = (pk.excludeCredentials || []).map((c) => Object.assign({}, c, { id: b64uToBuf(c.id) }));
      const cred = await navigator.credentials.create({ publicKey: pk });
      return PBApi.passkey({ action: 'register-verify', challengeId: o.challengeId, name, credential: { id: cred.id, response: { clientDataJSON: bufToB64u(cred.response.clientDataJSON), attestationObject: bufToB64u(cred.response.attestationObject) } } });
    },
    async passkeyLogin(email) {
      const o = await PBApi.passkey({ action: 'login-options', email: email || '' }, false);
      const pk = o.publicKey;
      pk.challenge = b64uToBuf(pk.challenge);
      pk.allowCredentials = (pk.allowCredentials || []).map((c) => Object.assign({}, c, { id: b64uToBuf(c.id) }));
      const cred = await navigator.credentials.get({ publicKey: pk });
      const r = cred.response;
      return PBApi.passkey({ action: 'login-verify', challengeId: o.challengeId, credential: { id: cred.id, response: { clientDataJSON: bufToB64u(r.clientDataJSON), authenticatorData: bufToB64u(r.authenticatorData), signature: bufToB64u(r.signature) } } }, false);
    },
=======
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
    teamAnalytics: () => call('analytics', { auth: true }),
    trackInterest: (b) => call('track-interest', { body: b }).catch(() => {}), // best-effort; never blocks the UI
>>>>>>> bb4656f6918703bd5f507e283028530221861759
  };
  g.PBApi = PBApi;
})(window);
