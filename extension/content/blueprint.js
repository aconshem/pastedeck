/*
 * PasteBoard blueprints.
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
  const isManualInput = (el) => el.tagName === 'INPUT' && /^(radio|checkbox)$/i.test(el.type || '');
  const looksLikeDateLabel = (label) => /\bdate\b|\bdob\b|\bbirth/i.test(label || '');

  /* "Grab text, not container": when the clicked element wraps other elements (an icon + value, a label + value
     row…), descend to the innermost element actually under the pointer. Falls back to the container's own direct
     text (excluding nested elements) if nothing more specific sits at that exact point. */
  function leafAtPoint(el, x, y) {
    let node = el;
    while (node && node.children && node.children.length) {
      const hit = Array.prototype.find.call(node.children, (c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      });
      if (!hit) break;
      node = hit;
    }
    return node;
  }
  function ownText(el) {
    return Array.prototype.filter.call(el.childNodes, (n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim();
  }
  function refineCaptureTarget(el, x, y) {
    if (!el.children || !el.children.length) return el; // already a leaf
    const leaf = leafAtPoint(el, x, y);
    if (leaf && leaf !== el && !leaf.children.length) return leaf;
    const own = ownText(el);
    if (own) return el; // container's own text (ignoring children) is the click target's real content
    const leaves = [];
    (function collect(n) { Array.prototype.forEach.call(n.children, (c) => { if (!c.children.length && U.oneLine(c.textContent)) leaves.push(c); else collect(c); }); })(el);
    return leaves.length ? leaves[leaves.length - 1] : el;
  }
  function extractValue(el) {
    const t = el.tagName;
    if (t === 'IMG') return el.currentSrc || el.src || '';
    if (t === 'INPUT' || t === 'TEXTAREA') { if ((el.type || '').toLowerCase() === 'password') return ''; return (el.value || '').trim(); }
    if (t === 'SELECT') { const o = el.options[el.selectedIndex]; return o ? o.text.trim() : ''; }
    if (el.children.length) { const own = ownText(el); if (own) return own; }
    return U.oneLine(el.innerText || el.textContent || '');
  }
  /* Best-effort image grab for capture blueprints (jpg/png shown on the page). Fails quietly on cross-origin
     images a canvas cannot read back (tainted canvas) — the person is told to save those by hand. */
  async function grabImageDataUrl(el) {
    try {
      const src = el.currentSrc || el.src;
      if (/^data:/.test(src)) return src;
      const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height;
      if (!w || !h) return null;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(el, 0, 0, w, h);
      return c.toDataURL('image/png');
    } catch (e) { return null; }
  }
  /* Loose date parse: ISO, D/M/Y or M/D/Y (ambiguous "01/02/2026" is read as day-first, the more common
     convention outside the US), or whatever Date() itself understands. */
  function parseLooseDate(v) {
    v = String(v || '').trim(); let m;
    if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = v.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})$/))) {
      let y = +m[3]; if (y < 100) y += y < 50 ? 2000 : 1900;
      return +m[1] > 12 ? new Date(y, +m[2] - 1, +m[1]) : new Date(y, +m[1] - 1, +m[2]);
    }
    const d = new Date(v); return isNaN(d.getTime()) ? null : d;
  }
  /* Reads the target field's own expected date format from its type or a placeholder/label hint, instead of
     always writing our own default shape. */
  function detectDateFormat(el) {
    if (el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'date') return 'YMD';
    const hint = [el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.name, el.id].filter(Boolean).join(' ');
    if (/dd?[\/\-. ]mm?[\/\-. ]yyyy/i.test(hint)) return 'DMY';
    if (/mm?[\/\-. ]dd?[\/\-. ]yyyy/i.test(hint)) return 'MDY';
    if (/yyyy[\/\-. ]mm?[\/\-. ]dd?/i.test(hint)) return 'YMD';
    return null;
  }
  function formatDate(d, pattern) {
    const p2 = (n) => String(n).padStart(2, '0'), Y = d.getFullYear(), M = p2(d.getMonth() + 1), D = p2(d.getDate());
    if (pattern === 'YMD') return Y + '-' + M + '-' + D;
    if (pattern === 'MDY') return M + '/' + D + '/' + Y;
    return D + '/' + M + '/' + Y;
  }
  function setValue(el, value, opts) {
    opts = opts || {};
    const t = el.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'password' || type === 'file' || type === 'hidden') return false;
      if (isManualInput(el)) return false; // left for the person to click themselves (see runPaste)
      if (opts.dateLike || type === 'date') {
        const d = parseLooseDate(value);
        if (d) value = formatDate(d, detectDateFormat(el) || (type === 'date' ? 'YMD' : 'DMY'));
      }
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
  function flash(el, kind) {
    const layer = PDC.getLayer(), r = el.getBoundingClientRect();
    const b = document.createElement('div'); b.className = 'hl done' + (kind === 'manual' ? ' manual' : '');
    b.style.cssText = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
    layer.appendChild(b); setTimeout(() => b.remove(), kind === 'manual' ? 2200 : 900);
  }

  /* ---------------------------------------------------------------- run (capture / paste) */
  function run(bp) {
    if (bp.kind === 'capture') return runCapture(bp);
    return runPaste(bp);
  }

  async function runCapture(bp) {
    try { PD.plan.require('blueprints', 'Blueprints'); } catch (e) { return PDC.toast(e.message, 'error'); }
    const rows = bp.fields.map((f) => { const el = resolve(f); return { f, label: f.label, value: el ? extractValue(el) : '', found: !!el, el }; });
    const textRows = rows.filter((r) => r.f.type !== 'image');
    const imgRows = rows.filter((r) => r.f.type === 'image' && r.el);
    const got = textRows.filter((r) => r.value);
    if (!got.length && !imgRows.length) return PDC.toast('No fields found on this page. If the site changed, re-create the blueprint.', 'error');
    let session;
    try { session = PD.sessions.mergeCaptured(got.map((r) => ({ label: r.label, value: r.value })), { deskId: bp.deskId }); }
    catch (e) { return PDC.toast(e.message + ' End a session first.', 'error'); }
    got.forEach((r) => r.el && flash(r.el));
    let imgOk = 0, imgFail = 0;
    if (imgRows.length) {
      try {
        PD.plan.require('files', 'The file shelf');
        for (const r of imgRows) {
          const dataUrl = await grabImageDataUrl(r.el);
          if (!dataUrl) { imgFail++; continue; }
          const rec = PD.db.upsert('files', { kind: 'session', sessionId: session.id, deskId: null, name: U.clip(U.oneLine(r.label), 40) + '.png', mime: 'image/png', size: Math.round(dataUrl.length * 0.75), shared: false, expiresAt: session.expiresAt });
          await PD.blobs.put(rec.id, dataUrl);
          flash(r.el); imgOk++;
        }
      } catch (e) { imgFail = imgRows.length; }
    }
    PD.analytics.track('capture', { n: got.length, deskId: bp.deskId, host: U.hostOf(location.href) });
    const missing = textRows.filter((r) => !r.value).map((r) => r.label);
    let msg = 'Copied ' + got.length + ' of ' + textRows.length + ' fields to session “' + session.name + '”';
    if (imgOk) msg += ' + ' + imgOk + ' image' + (imgOk === 1 ? '' : 's');
    if (missing.length) msg += ' · missing: ' + missing.join(', ');
    if (imgFail) msg += ' · ' + imgFail + ' image' + (imgFail === 1 ? '' : 's') + ' could not be read from this site (save manually)';
    PDC.toast(msg);
  }

  function runPaste(bp) {
    try { PD.plan.require('autofill', 'Autofill'); } catch (e) { return PDC.toast(e.message, 'error'); }
    const session = PD.sessions.active();
    if (!session) return PDC.toast('No active session. Capture details or start a session first.', 'error');
    const rows = bp.fields.map((f) => {
      const el = resolve(f), value = PD.sessions.value(session, f.label);
      const manual = !!(el && isManualInput(el));
      return { f, el, value, manual, use: !!(el && value) && !manual };
    });
    const manualCount = rows.filter((r) => r.manual).length;
    const layer = PDC.getLayer();
    const wrap = document.createElement('div'); wrap.className = 'center';
    wrap.innerHTML =
      '<div class="dlg" role="dialog" aria-label="Preview before filling"><div class="panel-h">Fill “' + esc(bp.name) + '” for ' + esc(session.name) + '</div><div class="panel-b">' +
      '<p class="hint">Review what will be filled. Untick anything you want to skip.' + (manualCount ? ' Fields marked “select yourself” (radio / checkbox) will be highlighted so you can click them.' : '') + '</p><table class="pv">' +
      rows.map((r, i) => '<tr class="' + (r.use ? '' : 'off') + '"><td style="width:24px">' + (r.manual ? '' : '<input type="checkbox" data-i="' + i + '"' + (r.use ? ' checked' : ' disabled') + '>') + '</td><td style="width:34%"><b>' + esc(r.f.label) + '</b></td><td class="v">' +
        (r.manual ? '<span class="off">Select yourself — ' + esc(r.value || 'no value in session') + '</span>' : r.value ? esc(r.value) : '<span class="off">No value in session</span>') + (r.el ? '' : ' <span class="off">(field not found on this page)</span>') + '</td></tr>').join('') +
      '</table></div><div class="panel-f"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-go></button></div></div>';
    layer.appendChild(wrap);
    ['keydown', 'keyup', 'keypress'].forEach((t) => wrap.addEventListener(t, (e) => e.stopPropagation()));
    const go = wrap.querySelector('[data-go]');
    const sync = () => { const n = wrap.querySelectorAll('input:checked').length; go.textContent = 'Fill ' + n + ' field' + (n === 1 ? '' : 's') + (manualCount ? ' (+ ' + manualCount + ' to pick yourself)' : ''); go.disabled = !n && !manualCount; };
    wrap.addEventListener('change', sync); sync();
    const done = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
    document.addEventListener('keydown', onKey, true);
    wrap.querySelector('[data-cancel]').onclick = done;
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) done(); });
    go.onclick = () => {
      let n = 0;
      wrap.querySelectorAll('input:checked').forEach((c) => {
        const r = rows[+c.dataset.i];
        if (r && setValue(r.el, r.value, { dateLike: looksLikeDateLabel(r.f.label) })) { n++; flash(r.el); }
      });
      rows.filter((r) => r.manual && r.el).forEach((r) => { r.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(r.el, 'manual'); });
      done();
      if (n) PD.analytics.track('autofill', { n, deskId: bp.deskId, host: U.hostOf(location.href) });
      PDC.toast(n ? 'Filled ' + n + ' field' + (n === 1 ? '' : 's') + (manualCount ? ' · ' + manualCount + ' left for you to pick' : '') : (manualCount ? manualCount + ' field(s) need your own click.' : 'Nothing was filled.'), n || manualCount ? '' : 'error');
    };
    go.focus();
  }

  /* ---------------------------------------------------------------- inline suggestion (Google-style autofill chip)
     When a field the person focuses matches a saved paste-blueprint field on this page, show a small popup right
     under it with the value from the active session — one click fills just that field, like a saved-password chip. */
  let sugg = null;
  function hideSuggestion() { if (sugg) { sugg.remove(); sugg = null; } }
  function showSuggestion(el, label, value, isDate) {
    hideSuggestion();
    const layer = PDC.getLayer(), r = el.getBoundingClientRect();
    const box = document.createElement('div'); box.className = 'sugg';
    box.style.cssText = 'left:' + r.left + 'px;top:' + (r.bottom + 4) + 'px;min-width:' + Math.max(160, r.width) + 'px';
    box.innerHTML = '<button type="button"><span class="sugg-l">' + PD.icon('user', 13) + esc(label) + '</span><span class="sugg-v">' + esc(value) + '</span></button>';
    box.querySelector('button').onmousedown = (e) => { e.preventDefault(); setValue(el, value, { dateLike: isDate }); flash(el); hideSuggestion(); };
    layer.appendChild(box); sugg = box;
  }
  function attachSuggestions() {
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (PDC.isOurs(el) || !PD.flags.get('autofill') || !PD.plan.can('autofill')) return;
      if (!(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') || isManualInput(el)) return hideSuggestion();
      const session = PD.sessions.active(); if (!session) return hideSuggestion();
      let hit = null;
      for (const bp of PD.blueprints.forUrl(location.href).filter((b) => b.kind === 'paste')) {
        for (const f of bp.fields) { if (!isManualInput(el) && resolve(f) === el) { hit = f; break; } }
        if (hit) break;
      }
      if (!hit) return hideSuggestion();
      const value = PD.sessions.value(session, hit.label);
      if (!value || value === el.value) return hideSuggestion();
      showSuggestion(el, hit.label, value, looksLikeDateLabel(hit.label));
    }, true);
    document.addEventListener('focusout', (e) => { setTimeout(() => { if (!sugg || !sugg.contains(document.activeElement)) hideSuggestion(); }, 120); }, true);
    document.addEventListener('scroll', hideSuggestion, true);
  }
  attachSuggestions();

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
      const el = rec.picked, isImage = kind === 'capture' && el.tagName === 'IMG';
      rec.fields.push({
        id: U.uid('fld'), label, key: U.normKey(label), css: cssPath(el), xpath: xpathOf(el), tag: el.tagName.toLowerCase(),
        type: isImage ? 'image' : undefined, manual: rec.pickedManual || undefined,
        _sample: isImage ? '(image)' : kind === 'capture' ? U.clip(extractValue(el), 28) : (rec.pickedManual ? '(select yourself)' : ''),
      });
      rec.picked = null; rec.pickedManual = false; draw();
    };
    const save = () => {
      if (!rec.fields.length) return;
      const nameEl = panel.querySelector('[data-name]');
      try {
        PD.blueprints.save({
          deskId: rec.deskId, kind, name: U.oneLine(nameEl ? nameEl.value : rec.name) || 'Untitled blueprint', host: location.hostname.replace(/^www\./, ''), pathPrefix: '', shared: false,
          fields: rec.fields.map((f) => ({ id: f.id, label: f.label, key: f.key, css: f.css, xpath: f.xpath, tag: f.tag, type: f.type, manual: f.manual })),
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
      let el = t, manual = false;
      if (kind === 'paste' && el.tagName === 'LABEL' && el.control) el = el.control;
      if (kind === 'paste' && isManualInput(el)) manual = true; // marital status etc. — left for the person to click
      if (kind === 'capture' && el.tagName !== 'IMG') el = refineCaptureTarget(el, e.clientX, e.clientY); // grab text, not the whole row
      rec.picked = el; rec.pickedManual = manual; hl.hidden = true; draw();
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
