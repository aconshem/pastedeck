/* PasteDeck UI helpers — toast, modal, confirm, menu. Depends on pd-core.js + pd.css. */
(function (g) {
  'use strict';
  const PD = (g.PD = g.PD || {});
  const esc = PD.util.esc, I = PD.icon;
  const ui = (PD.ui = {});

  ui.toast = function (msg, kind, ms) {
    let box = document.querySelector('.pd-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'pd-toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'pd-toast' + (kind === 'error' ? ' pd-toast--error' : '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .2s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 220); }, ms || (kind === 'error' ? 4200 : 2200));
  };

  /*
   * ui.modal({ title, html, wide, actions:[{label, primary, danger, onClick(handle) -> false to keep open}], onOpen(handle) })
   * handle = { el, close(), $(sel), values() }  — values() reads all named inputs inside the modal.
   */
  ui.modal = function (o) {
    const overlay = document.createElement('div');
    overlay.className = 'pd-overlay';
    overlay.innerHTML =
      '<div class="pd-modal' + (o.wide ? ' pd-modal--wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
      '<div class="pd-modal__head"><h3>' + esc(o.title) + '</h3><button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-x aria-label="Close">' + I('x') + '</button></div>' +
      '<div class="pd-modal__body">' + (o.html || '') + '</div>' +
      ((o.actions && o.actions.length) ? '<div class="pd-modal__foot"></div>' : '') + '</div>';
    const prevFocus = document.activeElement;
    const handle = {
      el: overlay,
      $: (s) => overlay.querySelector(s),
      close() { overlay.remove(); document.removeEventListener('keydown', onKey, true); if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* noop */ } if (o.onClose) o.onClose(); },
      values() {
        const v = {};
        overlay.querySelectorAll('[name]').forEach((el) => {
          if (el.type === 'checkbox') v[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) v[el.name] = el.value; } else v[el.name] = el.value;
        });
        return v;
      },
    };
    const onKey = (e) => {
      if (!overlay.isConnected) return;
      if (e.key === 'Escape') { e.stopPropagation(); handle.close(); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { const p = overlay.querySelector('.pd-btn--primary'); if (p) p.click(); }
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) handle.close(); });
    overlay.querySelector('[data-x]').onclick = () => handle.close();
    const foot = overlay.querySelector('.pd-modal__foot');
    (o.actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.className = 'pd-btn' + (a.primary ? ' pd-btn--primary' : '') + (a.danger ? ' pd-btn--danger' : '');
      b.textContent = a.label;
      b.onclick = async () => { const r = a.onClick ? await a.onClick(handle) : undefined; if (r !== false) handle.close(); };
      foot.appendChild(b);
    });
    document.body.appendChild(overlay);
    const first = overlay.querySelector('input:not([type=checkbox]):not([type=file]), textarea, select');
    if (first) setTimeout(() => { first.focus(); if (first.select && first.tagName === 'INPUT') first.select(); }, 30);
    if (o.onOpen) o.onOpen(handle);
    return handle;
  };

  ui.confirm = function (message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let answered = false;
      ui.modal({
        title: opts.title || 'Are you sure?',
        html: '<p>' + esc(message) + '</p>',
        onClose() { if (!answered) resolve(false); },
        actions: [
          { label: 'Cancel', onClick() { answered = true; resolve(false); } },
          { label: opts.confirmLabel || 'Confirm', primary: !opts.danger, danger: !!opts.danger, onClick() { answered = true; resolve(true); } },
        ],
      });
    });
  };

  ui.prompt = function (title, label, value, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let answered = false;
      ui.modal({
        title,
        html: '<div class="pd-field"><label class="pd-label">' + esc(label) + '</label><input class="pd-input" name="v" value="' + esc(value || '') + '" placeholder="' + esc(opts.placeholder || '') + '"></div>',
        onClose() { if (!answered) resolve(null); },
        onOpen(h) { h.$('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') h.el.querySelector('.pd-btn--primary').click(); }); },
        actions: [
          { label: 'Cancel', onClick() { answered = true; resolve(null); } },
          { label: opts.confirmLabel || 'Save', primary: true, onClick(h) { const v = h.values().v.trim(); if (!v) return false; answered = true; resolve(v); } },
        ],
      });
    });
  };

  /* Anchored menu: ui.menu(anchorEl, [{label, icon, onClick}, '-', ...]) */
  ui.menu = function (anchor, items) {
    document.querySelectorAll('.pd-menu').forEach((m) => m.remove());
    const m = document.createElement('div'); m.className = 'pd-menu'; m.setAttribute('role', 'menu');
    items.forEach((it) => {
      if (it === '-') { m.appendChild(document.createElement('hr')); return; }
      const b = document.createElement(it.href ? 'a' : 'button');
      if (it.href) { b.href = it.href; b.target = '_blank'; b.rel = 'noopener'; }
      b.setAttribute('role', 'menuitem');
      b.innerHTML = (it.icon ? I(it.icon, 15) : '') + '<span>' + esc(it.label) + '</span>';
      b.onclick = () => { m.remove(); if (it.onClick) it.onClick(); };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
    let left = r.right - mw, top = r.bottom + 4;
    if (left < 8) left = 8;
    if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    m.style.left = left + 'px'; m.style.top = top + 'px'; m.style.position = 'fixed';
    const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off, true); document.removeEventListener('keydown', esc2, true); } };
    const esc2 = (e) => { if (e.key === 'Escape') { m.remove(); document.removeEventListener('mousedown', off, true); document.removeEventListener('keydown', esc2, true); } };
    setTimeout(() => { document.addEventListener('mousedown', off, true); document.addEventListener('keydown', esc2, true); }, 0);
    const f = m.querySelector('button,a'); if (f) f.focus();
    return m;
  };


  /* Snippet editor modal shared by the extension and the dashboard.
     ui.snippetEditor({ id, deskId, onSaved }) */
  ui.snippetEditor = function (o) {
    o = o || {};
    const cur = o.id ? PD.db.find('snippets', o.id) : null;
    const canShare = PD.team.canManage();
    const defDesk = cur ? cur.deskId : (o.deskId !== undefined ? o.deskId : (PD.desks.active() || {}).id);
    return ui.modal({
      title: cur ? 'Edit snippet' : 'New snippet',
      html:
        '<div class="pd-field"><label class="pd-label">Title</label><input class="pd-input" name="title" value="' + esc(cur ? cur.title : '') + '" placeholder="Salary reply"></div>' +
        '<div class="pd-field"><label class="pd-label">Text</label><textarea class="pd-textarea" name="body" placeholder="Hi {{session.Full Name}}, …">' + esc(cur ? cur.body : '') + '</textarea><div class="pd-help">Placeholders: {{session.Full Name}}, {{company.address}}, {{date}}</div></div>' +
        '<div class="pd-field-row"><div class="pd-field"><label class="pd-label">Category</label><input class="pd-input" name="category" value="' + esc(cur ? cur.category : 'General') + '"></div>' +
        '<div class="pd-field"><label class="pd-label">Type-to-insert shortcut</label><input class="pd-input" name="shortcut" value="' + esc(cur ? cur.shortcut || '' : '') + '" placeholder=";sal"></div></div>' +
        '<div class="pd-field"><label class="pd-label">Available in</label><select class="pd-select" name="deskId"><option value="">All desks</option>' + PD.desks.all().map((d) => '<option value="' + d.id + '"' + (defDesk === d.id ? ' selected' : '') + '>' + esc(d.name) + '</option>').join('') + '</select></div>' +
        '<label class="pd-check"><input type="checkbox" name="favorite"' + (cur && cur.favorite ? ' checked' : '') + '> Favourite</label>' +
        '<label class="pd-check" style="margin-top:8px' + (canShare ? '' : ';opacity:.5') + '"><input type="checkbox" name="shared"' + (cur && cur.shared ? ' checked' : '') + (canShare ? '' : ' disabled') + '> Share with the whole team' + (canShare ? '' : ' (Owner / Admin only)') + '</label>',
      actions: [].concat(cur ? [{ label: 'Delete', danger: true, async onClick() {
        if (await ui.confirm('Delete “' + cur.title + '”?', { danger: true, confirmLabel: 'Delete' })) { PD.snippets.remove(cur.id); if (o.onSaved) o.onSaved(); } else return false;
      } }] : [], [
        { label: 'Cancel' },
        { label: 'Save', primary: true, onClick(h) {
          const v = h.values();
          try {
            PD.snippets.save(Object.assign({}, cur ? { id: cur.id } : { uses: 0 }, { title: v.title.trim() || PD.util.clip(PD.util.oneLine(v.body), 32), body: v.body, category: v.category.trim() || 'General', shortcut: v.shortcut, deskId: v.deskId || null, favorite: !!v.favorite, shared: !!v.shared }));
            if (o.onSaved) o.onSaved();
          } catch (e) { ui.fail(e); return false; }
        } },
      ]),
    });
  };

  /* Turns a thrown domain error into a toast, with a special path for plan limits. */
  ui.fail = function (err, onUpgrade) {
    if (err && err.code === 'PLAN_LIMIT') {
      ui.toast(err.message, 'error');
      if (onUpgrade) onUpgrade(err);
    } else ui.toast((err && err.message) || 'Something went wrong.', 'error');
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
