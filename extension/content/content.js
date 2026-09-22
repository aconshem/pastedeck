/*
 * PasteDeck content script — core.
 * Loaded on every page (after pd-core / pd-storage / pd-domain). Stays cheap: it does NOT load the database
 * until the person actually uses something (command bar, blueprint, insert...).
 * Exposes window.__PDC for commandbar.js and blueprint.js (same isolated world).
 */
(function () {
  'use strict';
  if (window.__PDC) return;
  const PDC = (window.__PDC = { version: '0.1.0' });
  const alive = () => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;

  /* ---------------------------------------------------------------- messaging / db */
  PDC.send = (msg) => new Promise((resolve) => {
    if (!alive()) return resolve(null);
    try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; resolve(r || null); }); } catch (e) { resolve(null); }
  });
  let dbp = null;
  PDC.ensureDb = () => { if (!dbp) dbp = PD.db.init(); return dbp.then(() => { PD.sessions.sweep(); return PD.db; }); };

  /* ---------------------------------------------------------------- shadow-DOM overlay root */
  PDC.css = `
  :host { all: initial; }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font: 400 14px/1.45 Inter, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111827; }
  .layer * { box-sizing: border-box; }
  button { font: inherit; cursor: pointer; }
  svg.pd-i { flex: none; vertical-align: -3px; }
  kbd { display: inline-block; min-width: 18px; padding: 0 5px; font: 500 11px/17px inherit; text-align: center; color: #6B7280; background: #fff; border: 1px solid #D1D5DB; border-bottom-width: 2px; border-radius: 4px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 12px; font-size: 12px; font-weight: 500; color: #111827; background: #fff; border: 1px solid #D1D5DB; border-radius: 6px; }
  .btn:hover { background: #F3F4F6; }
  .btn.primary { background: #000; color: #fff; border-color: #000; }
  .btn.primary:hover { background: #1f2937; }
  .btn:disabled { opacity: .45; cursor: not-allowed; }
  input.f { width: 100%; height: 32px; padding: 0 10px; font: inherit; font-size: 13px; color: #111827; background: #fff; border: 1px solid #D1D5DB; border-radius: 6px; }
  input.f:focus { outline: none; border-color: #111827; box-shadow: 0 0 0 3px rgba(17,24,39,.08); }

  /* toast */
  .toasts { position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: center; }
  .toast { pointer-events: auto; max-width: 80vw; padding: 9px 14px; font-size: 13px; color: #fff; background: #111; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.25); animation: pop .16s cubic-bezier(.2,.7,.2,1); }
  .toast.error { background: #B42318; }
  @keyframes pop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  /* pill */
  .pill { position: absolute; right: 16px; bottom: 16px; pointer-events: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  .pill-main { display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; color: #fff; background: #111; border: 0; border-radius: 999px; font-size: 12px; font-weight: 500; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
  .pill-menu { min-width: 220px; padding: 4px; background: #fff; border: 1px solid #E5E7EB; border-radius: 10px; box-shadow: 0 8px 24px rgba(17,24,39,.16); animation: pop .12s cubic-bezier(.2,.7,.2,1); }
  .pill-menu button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; text-align: left; font-size: 13px; color: #111827; background: none; border: 0; border-radius: 6px; }
  .pill-menu button:hover { background: #F3F4F6; }
  .pill-menu .sub { padding: 4px 10px 6px; font-size: 11px; color: #6B7280; }
  .pill-x { background: none; border: 0; color: #9CA3AF; font-size: 11px; padding: 2px 6px; }

  /* command bar */
  .cb-back { position: absolute; inset: 0; pointer-events: auto; background: rgba(17,24,39,.35); display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh; }
  .cb { width: min(640px, 92vw); background: #fff; border: 1px solid #E5E7EB; border-radius: 12px; box-shadow: 0 18px 50px rgba(17,24,39,.3); overflow: hidden; animation: pop .14s cubic-bezier(.2,.7,.2,1); }
  .cb-in { display: flex; align-items: center; gap: 10px; padding: 0 16px; height: 54px; border-bottom: 1px solid #E5E7EB; color: #6B7280; }
  .cb-in input { flex: 1; height: 100%; border: 0; outline: 0; font: inherit; font-size: 16px; color: #111827; background: transparent; }
  .cb-mode { font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 999px; background: #111; color: #fff; }
  .cb-list { max-height: min(56vh, 420px); overflow-y: auto; padding: 6px; }
  .cb-group { padding: 8px 10px 4px; font-size: 11px; font-weight: 500; color: #9CA3AF; }
  .cb-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
  .cb-item.sel { background: #F3F4F6; }
  .cb-ic { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; background: #F3F4F6; color: #6B7280; flex: none; }
  .cb-item.sel .cb-ic { background: #fff; border: 1px solid #E5E7EB; }
  .cb-body { flex: 1; min-width: 0; }
  .cb-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cb-sub { font-size: 12px; color: #6B7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cb-hint { font-size: 12px; color: #9CA3AF; flex: none; }
  .cb-empty { padding: 26px 16px; text-align: center; color: #6B7280; font-size: 13px; }
  .cb-foot { display: flex; align-items: center; gap: 14px; padding: 8px 14px; font-size: 12px; color: #6B7280; background: #F8F9FA; border-top: 1px solid #E5E7EB; }
  .cb-foot .sp { flex: 1; text-align: right; }

  /* recorder + preview panels */
  .panel { position: absolute; top: 16px; right: 16px; width: 320px; max-height: calc(100vh - 32px); overflow: auto; pointer-events: auto; background: #fff; border: 1px solid #E5E7EB; border-radius: 12px; box-shadow: 0 12px 34px rgba(17,24,39,.25); animation: pop .14s cubic-bezier(.2,.7,.2,1); }
  .panel-h { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #E5E7EB; font-weight: 600; }
  .panel-h .dot { width: 8px; height: 8px; border-radius: 50%; background: #B42318; animation: blink 1.2s infinite; }
  @keyframes blink { 50% { opacity: .25; } }
  .panel-b { padding: 12px 14px; }
  .panel-f { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid #E5E7EB; background: #F8F9FA; border-radius: 0 0 12px 12px; }
  .hint { font-size: 12px; color: #6B7280; margin: 0 0 10px; }
  .fld { display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin-top: 6px; border: 1px solid #E5E7EB; border-radius: 6px; font-size: 12px; }
  .fld b { font-weight: 500; }
  .fld .s { flex: 1; min-width: 0; color: #6B7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fld button { background: none; border: 0; color: #9CA3AF; }
  .hl { position: absolute; pointer-events: none; border: 2px solid #111; background: rgba(17,24,39,.08); border-radius: 3px; transition: all .06s; }
  .hl.done { border-color: #067647; background: rgba(6,118,71,.1); }
  .center { position: absolute; inset: 0; pointer-events: auto; background: rgba(17,24,39,.35); display: grid; place-items: center; padding: 16px; }
  .dlg { width: min(520px, 94vw); max-height: 86vh; overflow: auto; background: #fff; border: 1px solid #E5E7EB; border-radius: 12px; box-shadow: 0 18px 50px rgba(17,24,39,.3); animation: pop .14s cubic-bezier(.2,.7,.2,1); }
  table.pv { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.pv td { padding: 7px 4px; border-bottom: 1px solid #F3F4F6; vertical-align: middle; }
  table.pv td.v { color: #111827; word-break: break-word; }
  table.pv .off { color: #9CA3AF; }
  @media (prefers-reduced-motion: reduce) { .layer * { animation: none !important; transition: none !important; } }
  `;

  PDC.host = null; PDC.root = null; PDC.layer = null;
  PDC.getLayer = () => {
    if (PDC.layer && PDC.host.isConnected) return PDC.layer;
    const host = document.createElement('div');
    host.id = 'pastedeck-root';
    host.style.cssText = 'all: initial; position: fixed; inset: 0; width: 0; height: 0; z-index: 2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + PDC.css + '</style><div class="layer"></div>';
    (document.documentElement || document.body).appendChild(host);
    PDC.host = host; PDC.root = root; PDC.layer = root.querySelector('.layer');
    return PDC.layer;
  };
  PDC.icon = (n, s) => PD.icon(n, s);
  PDC.isOurs = (el) => !!el && (el === PDC.host || (PDC.host && PDC.host.contains(el)));

  PDC.toast = (text, kind) => {
    const layer = PDC.getLayer();
    let box = layer.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; layer.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast' + (kind === 'error' ? ' error' : '');
    t.textContent = text; box.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .2s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 220); }, kind === 'error' ? 4200 : 2400);
  };

  /* ---------------------------------------------------------------- focus tracking + insert */
  const BAD_TYPES = ['button', 'submit', 'checkbox', 'radio', 'file', 'password', 'reset', 'image', 'range', 'color', 'hidden'];
  const isEditable = (el) => !!el && el.nodeType === 1 && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && BAD_TYPES.indexOf((el.type || 'text').toLowerCase()) < 0));
  let lastEditable = null;
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!t || t === PDC.host) return;
    if (isEditable(t)) lastEditable = t;
    else if (t.closest) { const ce = t.closest('[contenteditable=""],[contenteditable="true"]'); if (ce) lastEditable = ce; }
  }, true);
  PDC.getTarget = () => {
    const a = document.activeElement;
    if (isEditable(a) && a !== PDC.host) return a;
    return lastEditable && document.contains(lastEditable) ? lastEditable : null;
  };

  const nativeSet = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
  };
  PDC.nativeSet = nativeSet;

  PDC.insertText = (text) => {
    const el = PDC.getTarget();
    if (!el) return false;
    try { el.focus({ preventScroll: true }); } catch (e) { /* noop */ }
    try {
      if (el.isContentEditable) {
        const lines = String(text).split('\n');
        let ok = true;
        lines.forEach((ln, i) => {
          if (i > 0) ok = document.execCommand('insertLineBreak') && ok;
          if (ln) ok = document.execCommand('insertText', false, ln) && ok;
        });
        return ok;
      }
      const start = el.selectionStart, end = el.selectionEnd;
      if (typeof start === 'number') {
        el.setRangeText(text, start, end, 'end');
      } else { nativeSet(el, (el.value || '') + text); }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return true;
    } catch (e) {
      try { nativeSet(el, (el.value || '') + text); el.dispatchEvent(new Event('input', { bubbles: true })); return true; } catch (e2) { return false; }
    }
  };

  PDC.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;top:-100px;opacity:0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  };

  /* Best-effort file attach: synthetic paste on the focused editor (WhatsApp Web, Gmail), then <input type=file>. */
  PDC.attachFile = async (rec, dataUrl) => {
    const blob = PD.util.dataUrlToBlob(dataUrl);
    const file = new File([blob], rec.name, { type: rec.mime || blob.type });
    const dt = new DataTransfer(); dt.items.add(file);
    const target = PDC.getTarget() || document.activeElement || document.body;
    try {
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      if (target.dispatchEvent(ev) === false) return { ok: true, via: 'paste' };
    } catch (e) { /* ClipboardEvent init unsupported */ }
    const inputs = Array.prototype.slice.call(document.querySelectorAll('input[type=file]')).filter((i) => !i.disabled);
    const inp = inputs.find((i) => !i.accept || i.accept.split(',').some((a) => { a = a.trim().toLowerCase(); return a === '*/*' || (a[0] === '.' ? rec.name.toLowerCase().endsWith(a) : (rec.mime || '').indexOf(a.replace('/*', '/')) === 0); })) || inputs[0];
    if (inp) {
      inp.files = dt.files;
      inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, via: 'file-input' };
    }
    return { ok: false };
  };
  PDC.attachById = async (id) => {
    await PDC.ensureDb();
    const rec = PD.db.find('files', id); if (!rec) return { ok: false, error: 'File not found' };
    const url = await PD.blobs.get(id); if (!url) return { ok: false, error: 'File data missing' };
    const r = await PDC.attachFile(rec, url);
    if (r.ok) return r;
    // fallback: download so the person can attach manually
    const a = document.createElement('a'); a.href = URL.createObjectURL(PD.util.dataUrlToBlob(url)); a.download = rec.name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    return { ok: false, downloaded: true };
  };

  /* ---------------------------------------------------------------- clipboard history capture (copy + paste events) */
  const selectedText = () => {
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) {
      if ((a.type || '').toLowerCase() === 'password') return null;
      try { return a.value.slice(a.selectionStart, a.selectionEnd); } catch (e) { return ''; }
    }
    const s = window.getSelection();
    return s ? s.toString() : '';
  };
  document.addEventListener('copy', () => {
    if (!alive()) return;
    const text = (selectedText() || '').trim();
    if (!text) return;
    PDC.send({ type: 'PD_HISTORY_ADD', entry: { type: /^https?:\/\/\S+$/i.test(text) ? 'link' : 'text', text: text.slice(0, 5000) } });
  }, true);
  document.addEventListener('paste', (e) => {
    if (!alive() || !e.clipboardData) return;
    const a = document.activeElement;
    if (a && a.tagName === 'INPUT' && (a.type || '').toLowerCase() === 'password') return;
    Array.prototype.slice.call(e.clipboardData.files || []).slice(0, 3).forEach((f) => {
      if (f.type.indexOf('image/') === 0 && f.size <= 1.5 * 1024 * 1024) {
        PD.util.readAsDataUrl(f).then((dataUrl) => PDC.send({ type: 'PD_HISTORY_ADD', entry: { type: 'image', name: f.name || 'image', size: f.size, dataUrl } })).catch(() => {});
      } else PDC.send({ type: 'PD_HISTORY_ADD', entry: { type: 'file', name: f.name, size: f.size, text: '' } });
    });
  }, true);

  /* ---------------------------------------------------------------- text expansion (;shortcut + space) */
  let expansionOn = false;
  const beforeCaret = (el) => {
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
      const n = sel.anchorNode;
      if (!n || n.nodeType !== 3) return null;
      return { text: n.textContent.slice(0, sel.anchorOffset), node: n, offset: sel.anchorOffset };
    }
    if (typeof el.selectionStart !== 'number' || el.selectionStart !== el.selectionEnd) return null;
    return { text: el.value.slice(0, el.selectionStart), pos: el.selectionStart };
  };
  document.addEventListener('input', async (e) => {
    if (!expansionOn || e.inputType !== 'insertText' || e.data !== ' ') return;
    const el = e.target;
    if (!isEditable(el)) return;
    const b = beforeCaret(el); if (!b) return;
    const m = b.text.match(/(?:^|\s)(;[a-z0-9_-]{1,24}) $/i);
    if (!m) return;
    const r = await PDC.send({ type: 'PD_EXPAND', shortcut: m[1].toLowerCase() });
    if (!r || !r.text) return;
    const again = beforeCaret(el);
    if (!again || again.text !== b.text) return; // person kept typing
    const n = m[1].length + 1;
    try {
      if (el.isContentEditable) {
        const range = document.createRange();
        range.setStart(again.node, again.offset - n); range.setEnd(again.node, again.offset);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        PDC.insertText(r.text);
      } else {
        el.setRangeText(r.text, again.pos - n, again.pos, 'end');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: r.text }));
      }
    } catch (err) { /* leave the typed shortcut in place */ }
  }, true);

  /* ---------------------------------------------------------------- floating pill (blueprints available on this site) */
  let pillDismissed = false;
  function renderPill(ctx) {
    if (pillDismissed || !ctx.blueprints.length) return;
    const layer = PDC.getLayer();
    layer.querySelectorAll('.pill').forEach((p) => p.remove());
    const wrap = document.createElement('div'); wrap.className = 'pill';
    const cap = ctx.blueprints.filter((b) => b.kind === 'capture'), pas = ctx.blueprints.filter((b) => b.kind === 'paste');
    let open = false;
    const draw = () => {
      wrap.innerHTML = (open ? '<div class="pill-menu"></div>' : '') +
        '<button class="pill-main">' + PD.icon('zap', 14) + ' PasteDeck <span style="opacity:.6">' + ctx.blueprints.length + '</span></button>' +
        (open ? '' : '');
      if (open) {
        const menu = wrap.querySelector('.pill-menu');
        cap.forEach((b) => menu.appendChild(item('target', 'Copy details', b)));
        pas.forEach((b) => menu.appendChild(item('form', 'Fill form', b)));
        const s = document.createElement('div'); s.className = 'sub';
        s.textContent = ctx.sessionName ? 'Session: ' + ctx.sessionName : 'No active session';
        menu.appendChild(s);
        const x = document.createElement('button'); x.className = 'pill-x'; x.textContent = 'Hide on this page';
        x.onclick = () => { pillDismissed = true; wrap.remove(); };
        menu.appendChild(x);
      }
      wrap.querySelector('.pill-main').onclick = () => { open = !open; draw(); };
    };
    const item = (icon, verb, b) => {
      const btn = document.createElement('button');
      btn.innerHTML = PD.icon(icon, 15) + '<span>' + verb + ' · ' + PD.util.esc(b.name) + '</span>';
      btn.onclick = async () => { open = false; draw(); await PDC.ensureDb(); const bp = PD.db.find('blueprints', b.id); if (bp) PDC.blueprint.run(bp); };
      return btn;
    };
    draw(); layer.appendChild(wrap);
  }

  /* ---------------------------------------------------------------- inbound messages */
  if (alive()) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      (async () => {
        try {
          switch (msg.type) {
            case 'PD_PING': return sendResponse({ ok: true, url: location.href });
            case 'PD_TOAST': PDC.toast(msg.text, msg.kind); return sendResponse({ ok: true });
            case 'PD_INSERT': return sendResponse({ ok: PDC.insertText(msg.text) });
            case 'PD_ATTACH': return sendResponse(await PDC.attachById(msg.fileId));
            case 'PD_TOGGLE_COMMANDBAR': PDC.commandBar.toggle(msg.mode); return sendResponse({ ok: true });
            case 'PD_START_RECORDER': await PDC.ensureDb(); PDC.blueprint.record(msg); return sendResponse({ ok: true });
            case 'PD_RUN_BLUEPRINT': { await PDC.ensureDb(); const bp = PD.db.find('blueprints', msg.id); if (bp) PDC.blueprint.run(bp); return sendResponse({ ok: !!bp }); }
            default: return sendResponse({ ok: false });
          }
        } catch (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
      })();
      return true;
    });

    // Ask the service worker whether this page has blueprints / whether expansion is on.
    setTimeout(async () => {
      if (window.top !== window) return;
      const ctx = await PDC.send({ type: 'PD_PAGE_CONTEXT' });
      if (!ctx || ctx.error) return;
      expansionOn = !!ctx.expansion;
      if (ctx.pill) renderPill(ctx);
    }, 600);
  }
})();
