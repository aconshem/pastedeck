/*
 * PasteDeck bridge — runs ONLY on pastedeck.com and localhost (see manifest).
 * Lets the website dashboard read/write the extension's local data until real cloud sync exists.
 * Only keys starting with "pd:" / "pdb:" are reachable. Replace with authenticated cloud sync (docs/architecture.md).
 */
(function () {
  'use strict';
  if (window.__pdBridge) return;
  window.__pdBridge = true;
  const okKey = (k) => typeof k === 'string' && (k.indexOf('pd:') === 0 || k.indexOf('pdb:') === 0);
  const origin = window.location.origin;

  window.addEventListener('message', async (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.pd !== 'site') return;
    const reply = (o) => window.postMessage(Object.assign({ pd: 'ext', id: d.id }, o), origin);
    try {
      if (d.type === 'ping') return reply({ type: 'pong', version: chrome.runtime.getManifest().version });
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
    Object.keys(changes).forEach((k) => { if (k.indexOf('pd:') === 0) o[k] = changes[k].newValue; });
    if (Object.keys(o).length) window.postMessage({ pd: 'ext', type: 'changed', changes: o }, origin);
  });
})();
