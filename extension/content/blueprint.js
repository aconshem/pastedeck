/*
 * PasteDeck blueprints.
 *   Capture blueprint: teach once which elements hold Full Name, Passport, Phone… -> "Copy details" extracts them into a Candidate Session.
 *   Paste blueprint:   teach once which form inputs map to which session field  -> "Fill form" previews, then fills.
 * Selectors: CSS first, XPath fallback. No AI.
 */
(function () {
  'use strict';
  const PDC = window.__PDC;
  if (!PDC || PDC.blueprint) return;
  const U = PD.util, esc = U.esc;

  /* ---------------------------------------------------------------- selectors */
  const stableClass = (c) => !!c && c.length <= 32 && !/\d{3,}|^(css|sc|jsx|ng|_)-?|^[a-z]{1,2}[A-Za-z0-9]{6,}$/i.test(c);
  const stableId = (id) => !!id && !/\d{4,}|^:r|^ember|[a-f0-9]{8,}|^react-|^radix-/i.test(id);
  const q = (sel) => { try { return document.querySelectorAll(sel); } catch (e) { return []; } };
  const uniq = (sel, el) => { const r = q(sel); return r.length === 1 && r[0] === el; };
  const attrEsc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  function cssPath(el) {
    if (stableId(el.id) && uniq('#' + CSS.escape(el.id), el)) return '#' + CSS.escape(el.id);
    const tag = el.tagName.toLowerCase();
    for (const a of ['data-testid', 'data-test', 'data-qa', 'data-cy', 'name', 'formcontrolname', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v) { const sel = tag + '[' + a + '="' + attrEsc(v) + '"]'; if (uniq(sel, el)) return sel; }
    }
    // Path from the element upwards. Uses stable classes, keeps at least two levels (a bare "b" or "span" is too fragile),
    // and stops as soon as the selector is unique and anchored, or after a few levels.
    const parts = [];
    let cur = el, depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (stableId(cur.id) && cur !== el) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      let seg = cur.tagName.toLowerCase();
      const cls = Array.prototype.filter.call(cur.classList || [], stableClass).slice(0, 2);
      if (cls.length) seg += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const p = cur.parentElement;
      if (p) {
        const same = Array.prototype.filter.call(p.children, (c) => c.tagName === cur.tagName && (!cls.length || cls.every((k) => c.classList.contains(k))));
        if (same.length > 1) seg += ':nth-of-type(' + (Array.prototype.filter.call(p.children, (c) => c.tagName === cur.tagName).indexOf(cur) + 1) + ')';
      }
      parts.unshift(seg);
      depth++;
      const sel = parts.join(' > ');
      if (depth >= 2 && uniq(sel, el)) return sel;
      if (depth >= 5 && uniq(sel, el)) return sel;
      cur = p;
    }
    return parts.join(' > ');
  }
  function xpathOf(el) {
    if (stableId(el.id)) return '//*[@id="' + el.id + '"]';
    const parts = [];
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
      let i = 1;
      for (let s = cur.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === cur.tagName) i++;
      parts.unshift(cur.tagName.toLowerCase() + '[' + i + ']');
    }
    return '/' + parts.join('/');
  }
  function resolve(field) {
    let el = null;
    try { el = document.querySelector(field.css); } catch (e) { /* bad selector */ }
    if (el) return el;
    if (field.xpath) { try { el = document.evaluate(field.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch (e) { /* bad xpath */ } }
    return el;
  }

  /* ---------------------------------------------------------------- read / write values */
  function extractValue(el) {
    const t = el.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA') { if ((el.type || '').toLowerCase() === 'password') return ''; return (el.value || '').trim(); }
    if (t === 'SELECT') { const o = el.options[el.selectedIndex]; return o ? o.text.trim() : ''; }
    return U.oneLine(el.innerText || el.textContent || '');
  }
  function setValue(el, value) {
    const t = el.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'password' || type === 'file' || type === 'hidden') return false;
      if (type === 'checkbox' || type === 'radio') { const want = /^(yes|true|y|1|checked)$/i.test(value); if (el.checked !== want) el.click(); return true; }
      el.focus(); PDC.nativeSet(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (t === 'SELECT') {
      const k = U.normKey(value);
      const i = Array.prototype.findIndex.call(el.options, (o) => U.normKey(o.text) === k || U.normKey(o.value) === k);
      const j = i >= 0 ? i : Array.prototype.findIndex.call(el.options, (o) => k && (U.normKey(o.text).indexOf(k) >= 0));
      if (j < 0) return false;
      el.selectedIndex = j; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el.isContentEditable) { el.focus(); document.execCommand('selectAll', false); return document.execCommand('insertText', false, value); }
    return false;
  }
  function flash(el) {
    const layer = PDC.getLayer(), r = el.getBoundingClientRect();
    const b = document.createElement('div'); b.className = 'hl done';
    b.style.cssText = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
    layer.appendChild(b); setTimeout(() => b.remove(), 900);
  }

  /* ---------------------------------------------------------------- run (capture / paste) */
  function run(bp) {
    if (bp.kind === 'capture') return runCapture(bp);
    return runPaste(bp);
  }

  function runCapture(bp) {
    try { PD.plan.require('blueprints', 'Blueprints'); } catch (e) { return PDC.toast(e.message, 'error'); }
    const rows = bp.fields.map((f) => { const el = resolve(f); return { label: f.label, value: el ? extractValue(el) : '', found: !!el, el }; });
    const got = rows.filter((r) => r.value);
    if (!got.length) return PDC.toast('No fields found on this page. If the site changed, re-create the blueprint.', 'error');
    let session;
    try { session = PD.sessions.mergeCaptured(got.map((r) => ({ label: r.label, value: r.value })), { deskId: bp.deskId }); }
    catch (e) { return PDC.toast(e.message + ' End a session first.', 'error'); }
    got.forEach((r) => r.el && flash(r.el));
    PD.analytics.track('capture', { n: got.length, deskId: bp.deskId, host: U.hostOf(location.href) });
    const missing = rows.filter((r) => !r.value).map((r) => r.label);
    PDC.toast('Copied ' + got.length + ' of ' + rows.length + ' fields to session “' + session.name + '”' + (missing.length ? ' · missing: ' + missing.join(', ') : ''));
  }

  function runPaste(bp) {
    try { PD.plan.require('autofill', 'Autofill'); } catch (e) { return PDC.toast(e.message, 'error'); }
    const session = PD.sessions.active();
    if (!session) return PDC.toast('No active session. Capture details or start a session first.', 'error');
    const rows = bp.fields.map((f) => {
      const el = resolve(f), value = PD.sessions.value(session, f.label);
      return { f, el, value, use: !!(el && value) };
    });
    const layer = PDC.getLayer();
    const wrap = document.createElement('div'); wrap.className = 'center';
    wrap.innerHTML =
      '<div class="dlg" role="dialog" aria-label="Preview before filling"><div class="panel-h">Fill “' + esc(bp.name) + '” for ' + esc(session.name) + '</div><div class="panel-b">' +
      '<p class="hint">Review what will be filled. Untick anything you want to skip.</p><table class="pv">' +
      rows.map((r, i) => '<tr class="' + (r.use ? '' : 'off') + '"><td style="width:24px"><input type="checkbox" data-i="' + i + '"' + (r.use ? ' checked' : ' disabled') + '></td><td style="width:34%"><b>' + esc(r.f.label) + '</b></td><td class="v">' +
        (r.value ? esc(r.value) : '<span class="off">No value in session</span>') + (r.el ? '' : ' <span class="off">(field not found on this page)</span>') + '</td></tr>').join('') +
      '</table></div><div class="panel-f"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-go></button></div></div>';
    layer.appendChild(wrap);
    ['keydown', 'keyup', 'keypress'].forEach((t) => wrap.addEventListener(t, (e) => e.stopPropagation()));
    const go = wrap.querySelector('[data-go]');
    const sync = () => { const n = wrap.querySelectorAll('input:checked').length; go.textContent = 'Fill ' + n + ' field' + (n === 1 ? '' : 's'); go.disabled = !n; };
    wrap.addEventListener('change', sync); sync();
    const done = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
    document.addEventListener('keydown', onKey, true);
    wrap.querySelector('[data-cancel]').onclick = done;
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) done(); });
    go.onclick = () => {
      let n = 0;
      wrap.querySelectorAll('input:checked').forEach((c) => { const r = rows[+c.dataset.i]; if (r && setValue(r.el, r.value)) { n++; flash(r.el); } });
      done();
      if (n) PD.analytics.track('autofill', { n, deskId: bp.deskId, host: U.hostOf(location.href) });
      PDC.toast(n ? 'Filled ' + n + ' field' + (n === 1 ? '' : 's') : 'Nothing was filled.', n ? '' : 'error');
    };
    go.focus();
  }

  /* ---------------------------------------------------------------- recorder */
  let rec = null;

  function record(opts) {
    if (rec) return;
    try { PD.plan.require('blueprints', 'Blueprints'); } catch (e) { return PDC.toast(e.message, 'error'); }
    const kind = opts.kind === 'paste' ? 'paste' : 'capture';
    const layer = PDC.getLayer();
    const suggestions = (function () {
      const s = PD.sessions.active();
      const base = s ? s.fields.map((f) => f.label) : [];
      return Array.from(new Set(base.concat(PD.SESSION_TEMPLATE, ['Email', 'Address', 'Job Title', 'Height', 'Weight'])));
    })();
    rec = { kind, deskId: opts.deskId || (PD.desks.active() || {}).id, fields: [], picked: null, hoverEl: null };
    const panel = document.createElement('div'); panel.className = 'panel';
    const hl = document.createElement('div'); hl.className = 'hl'; hl.hidden = true;
    layer.appendChild(hl); layer.appendChild(panel);
    rec.panel = panel; rec.hl = hl;

    const draw = () => {
      const picking = !!rec.picked;
      panel.innerHTML =
        '<div class="panel-h"><span class="dot"></span>' + (kind === 'capture' ? 'Teach: capture details' : 'Teach: fill a form') + '</div><div class="panel-b">' +
        '<div style="margin-bottom:10px"><label class="hint" style="display:block;margin-bottom:4px">Blueprint name</label><input class="f" data-name value="' + esc(rec.name || (kind === 'capture' ? 'Capture · ' : 'Form · ') + U.hostOf(location.href)) + '"></div>' +
        (picking
          ? '<p class="hint"><b>' + (kind === 'capture' ? 'What is this?' : 'Which session field goes here?') + '</b></p><input class="f" data-label list="pd-labels" placeholder="e.g. Passport Number" value=""><datalist id="pd-labels">' + suggestions.map((s) => '<option value="' + esc(s) + '">').join('') + '</datalist><p class="hint" style="margin-top:6px">Press Enter to add, Esc to skip.</p>'
          : '<p class="hint">' + (kind === 'capture' ? 'Click a value on the page (name, passport, phone…).' : 'Click a form field to map it.') + '</p>') +
        rec.fields.map((f, i) => '<div class="fld"><b>' + esc(f.label) + '</b><span class="s">' + esc(f._sample || '') + '</span><button data-rm="' + i + '" aria-label="Remove">' + PD.icon('x', 13) + '</button></div>').join('') +
        '</div><div class="panel-f"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save ' + (rec.fields.length ? '' : 'disabled') + '>Save blueprint</button></div>';
      const nm = panel.querySelector('[data-name]'); nm.oninput = () => { rec.name = nm.value; };
      const lab = panel.querySelector('[data-label]');
      if (lab) { lab.focus(); lab.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commitField(lab.value); } else if (e.key === 'Escape') { e.preventDefault(); rec.picked = null; draw(); } }; }
      panel.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { rec.fields.splice(+b.dataset.rm, 1); draw(); }));
      panel.querySelector('[data-cancel]').onclick = stop;
      panel.querySelector('[data-save]').onclick = save;
    };
    rec.draw = draw;

    const commitField = (label) => {
      label = U.oneLine(label); if (!label) return;
      const el = rec.picked;
      rec.fields.push({ id: U.uid('fld'), label, key: U.normKey(label), css: cssPath(el), xpath: xpathOf(el), tag: el.tagName.toLowerCase(), _sample: kind === 'capture' ? U.clip(extractValue(el), 28) : '' });
      rec.picked = null; draw();
    };
    const save = () => {
      if (!rec.fields.length) return;
      const nameEl = panel.querySelector('[data-name]');
      try {
        PD.blueprints.save({
          deskId: rec.deskId, kind, name: U.oneLine(nameEl ? nameEl.value : rec.name) || 'Untitled blueprint', host: location.hostname.replace(/^www\./, ''), pathPrefix: '', shared: false,
          fields: rec.fields.map((f) => ({ id: f.id, label: f.label, key: f.key, css: f.css, xpath: f.xpath, tag: f.tag })),
        });
        const n = rec.fields.length;
        stop(); PDC.toast('Blueprint saved with ' + n + ' field' + (n === 1 ? '' : 's') + '. It belongs to ' + ((PD.desks.get(opts.deskId || rec.deskId) || {}).name || 'your desk') + '.');
      } catch (e) { PDC.toast(e.message, 'error'); }
    };

    // page interaction
    const targetAt = (e) => { const t = e.target; return PDC.isOurs(t) || (e.composedPath && e.composedPath().some((n) => n === PDC.host)) ? null : t; };
    const onMove = (e) => {
      if (rec.picked) return;
      const t = targetAt(e); if (!t || t === document.documentElement || t === document.body) { hl.hidden = true; return; }
      rec.hoverEl = t; const r = t.getBoundingClientRect();
      hl.hidden = false; hl.style.cssText = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
    };
    const onClick = (e) => {
      const t = targetAt(e); if (!t) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (e.type !== 'click' || rec.picked) return;
      let el = t;
      if (kind === 'paste' && el.tagName === 'LABEL' && el.control) el = el.control;
      rec.picked = el; hl.hidden = true; draw();
    };
    const swallow = (e) => { if (targetAt(e)) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } };
    const onKey = (e) => { if (e.key === 'Escape' && !rec.picked) { e.stopPropagation(); stop(); } };
    document.addEventListener('mousemove', onMove, true);
    ['click'].forEach((t) => document.addEventListener(t, onClick, true));
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'submit'].forEach((t) => document.addEventListener(t, swallow, true));
    document.addEventListener('keydown', onKey, true);
    rec.cleanup = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'submit'].forEach((t) => document.removeEventListener(t, swallow, true));
      document.removeEventListener('keydown', onKey, true);
      hl.remove(); panel.remove();
    };
    draw();
  }
  function stop() { if (rec) { rec.cleanup(); rec = null; } }

  PDC.blueprint = { run, record, resolve, cssPath, xpathOf, extractValue, setValue };
})();
