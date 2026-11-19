/*
 * PasteBoard bridge — injected ONLY on https://pastedeck.netlify.app (see manifest).
 * It answers exactly four message types from the website:
 *   ping    -> is the extension installed (version)
 *   status  -> { linked, name, plan } for the "Connected" badge (no token, no email)
 *   pair    -> hands a ONE-TIME pairing code to the service worker, which exchanges it with the server
 *   get/set/remove on a fixed allow-list of local-workspace keys, so the dashboard can show a clearly-labelled
 *   "this computer only" view of desks, snippets, tasks etc.
 * It can never read or write `pd:account` (the session), `pd:outbox` or anything outside the allow-list, and the
 * session token is never sent through window.postMessage in either direction.
 */
(function () {
  'use strict';
  if (window.__pdBridge) return;
  window.__pdBridge = true;
  const origin = window.location.origin;
  const WORKSPACE = ['meta', 'desks', 'snippets', 'sessions', 'blueprints', 'tasks', 'history', 'files', 'company', 'team', 'settings', 'analytics', 'devices', 'leads'];
  const okKey = (k) => typeof k === 'string' && (k.indexOf('pdb:') === 0 || (k.indexOf('pd:') === 0 && WORKSPACE.indexOf(k.slice(3)) >= 0));
  const CODE_RE = /^[A-Za-z0-9_-]{20,100}$/;
  const send = (m) => new Promise((res) => chrome.runtime.sendMessage(m, (r) => res(r || { error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'no response' })));

  window.addEventListener('message', async (e) => {
    const d = e.data;
    if (e.source !== window || e.origin !== origin || !d || d.pd !== 'site') return;
    const reply = (o) => window.postMessage(Object.assign({ pd: 'ext', id: d.id }, o), origin);
    try {
      if (d.type === 'ping') return reply({ type: 'pong', version: chrome.runtime.getManifest().version });
      if (d.type === 'status') { const r = await send({ type: 'PD_LINK_STATUS' }); return reply({ type: 'result', data: r }); }
      if (d.type === 'pair') {
        if (typeof d.code !== 'string' || !CODE_RE.test(d.code)) return reply({ type: 'result', error: 'Bad pairing code.' });
        const r = await send({ type: 'PD_PAIR', code: d.code });
        return reply(r.error ? { type: 'result', error: r.error } : { type: 'result', data: r });
      }
      if (d.type === 'get') return reply({ type: 'result', data: await chrome.storage.local.get((d.keys || []).filter(okKey)) });
      if (d.type === 'set') {
        const o = {};
        Object.keys(d.obj || {}).forEach((k) => { if (okKey(k)) o[k] = d.obj[k]; });
        await chrome.storage.local.set(o);
        return reply({ type: 'result', data: true });
      }
      if (d.type === 'remove') { await chrome.storage.local.remove((d.keys || []).filter(okKey)); return reply({ type: 'result', data: true }); }
    } catch (err) { reply({ type: 'result', error: String((err && err.message) || err) }); }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const o = {};
    Object.keys(changes).forEach((k) => { if (okKey(k) && k.indexOf('pd:') === 0) o[k] = changes[k].newValue; });
    if (Object.keys(o).length) window.postMessage({ pd: 'ext', type: 'changed', changes: o }, origin);
  });
})();
