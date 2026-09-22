/*
 * PasteDeck command bar — Spotlight-style overlay (Ctrl+Shift+Space).
 * Selecting a result performs its action immediately.
 */
(function () {
  'use strict';
  const PDC = window.__PDC;
  if (!PDC || PDC.commandBar) return;
  const U = PD.util, esc = U.esc;

  let el = null, input = null, list = null, state = { open: false, items: [], sel: 0, mode: 'search' };
  const KIND_LABEL = { snippet: 'Snippets', task: 'Reminders', file: 'Files', session: 'Sessions', blueprint: 'Blueprints', desk: 'Desks', command: 'Commands', 'create-task': 'Create' };

  async function open(mode) {
    if (state.open) return close();
    try { await PDC.ensureDb(); } catch (e) { PDC.toast('PasteDeck could not load your data.', 'error'); return; }
    if (!PD.flags.get('commandBar')) return;
    state = { open: true, items: [], sel: 0, mode: mode === 'task' ? 'task' : 'search' };
    build();
    refresh();
  }
  function close() {
    state.open = false;
    if (el) { el.remove(); el = null; }
  }

  function build() {
    const layer = PDC.getLayer();
    el = document.createElement('div');
    el.className = 'cb-back';
    const desk = PD.desks.active();
    el.innerHTML =
      '<div class="cb" role="dialog" aria-label="PasteDeck command bar">' +
      '<div class="cb-in">' + PD.icon('search', 18) + '<input type="text" spellcheck="false" autocomplete="off" aria-label="Search PasteDeck"><span class="cb-mode" hidden></span></div>' +
      '<div class="cb-list" role="listbox"></div>' +
      '<div class="cb-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>↵</kbd> run</span><span><kbd>Esc</kbd> close</span><span class="sp">' + esc(desk ? desk.name : '') + '</span></div></div>';
    layer.appendChild(el);
    input = el.querySelector('input'); list = el.querySelector('.cb-list');
    input.placeholder = state.mode === 'task' ? 'New task — e.g. Call medical tomorrow 9am' : 'Search snippets, files, reminders, desks, sessions…';
    if (state.mode === 'task') { const m = el.querySelector('.cb-mode'); m.hidden = false; m.textContent = 'New task'; }
    // keep page hotkeys from seeing what is typed here
    ['keydown', 'keyup', 'keypress', 'input'].forEach((t) => el.addEventListener(t, (e) => e.stopPropagation()));
    el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', onKey);
    list.addEventListener('mousemove', (e) => { const it = e.target.closest('.cb-item'); if (it && +it.dataset.i !== state.sel) { state.sel = +it.dataset.i; paintSel(); } });
    list.addEventListener('click', (e) => { const it = e.target.closest('.cb-item'); if (it) run(state.items[+it.dataset.i]); });
    setTimeout(() => input.focus(), 0);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = state.items[state.sel]; if (it) run(it); }
    else if (e.key === 'Tab') { e.preventDefault(); state.mode = state.mode === 'task' ? 'search' : 'task'; const m = el.querySelector('.cb-mode'); m.hidden = state.mode !== 'task'; m.textContent = 'New task'; refresh(); }
  }
  function move(d) { const n = state.items.length; if (!n) return; state.sel = (state.sel + d + n) % n; paintSel(); }
  function paintSel() {
    list.querySelectorAll('.cb-item').forEach((n) => n.classList.toggle('sel', +n.dataset.i === state.sel));
    const s = list.querySelector('.cb-item.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  }

  function refresh() {
    const q = input.value.trim();
    let items = [];
    if (state.mode === 'task') {
      if (q) {
        const p = PD.tasks.parse(q);
        items = [{ kind: 'create-task', id: 'create', title: 'Create task: ' + p.title, sub: (p.dueAt ? U.fmtDue(p.dueAt) : 'No due time') + (p.recurrence ? ' · repeats ' + p.recurrence : ''), hint: 'Add', icon: 'plus', parsed: p }];
      }
    } else {
      items = PD.search(q, { limit: 14 });
      if (q.length > 1) { const p = PD.tasks.parse(q); items.push({ kind: 'create-task', id: 'create', title: 'Create task: ' + p.title, sub: p.dueAt ? U.fmtDue(p.dueAt) : 'No due time', hint: 'Add', icon: 'plus', parsed: p }); }
    }
    state.items = items; state.sel = 0;
    if (!items.length) { list.innerHTML = '<div class="cb-empty">' + (state.mode === 'task' ? 'Type a task, for example “Call medical tomorrow 9am”.' : 'Nothing found. Try a different word.') + '</div>'; return; }
    let html = '', lastKind = null;
    items.forEach((it, i) => {
      if (it.kind !== lastKind) { html += '<div class="cb-group">' + esc(KIND_LABEL[it.kind] || it.kind) + '</div>'; lastKind = it.kind; }
      html += '<div class="cb-item' + (i === 0 ? ' sel' : '') + '" data-i="' + i + '" role="option"><div class="cb-ic">' + PD.icon(it.icon, 15) + '</div><div class="cb-body"><div class="cb-title">' + esc(it.title) + '</div>' + (it.sub ? '<div class="cb-sub">' + esc(it.sub) + '</div>' : '') + '</div><div class="cb-hint">' + esc(it.hint || '') + '</div></div>';
    });
    list.innerHTML = html;
  }

  /* ---------------------------------------------------------------- actions */
  async function run(it) {
    if (!it) return;
    try {
      const host = U.hostOf(location.href);
      switch (it.kind) {
        case 'snippet': {
          close();
          const text = PD.snippets.render(it.ref.body);
          const ok = PDC.insertText(text);
          if (ok) PDC.toast('Inserted “' + it.title + '”');
          else { const c = await PDC.copy(text); PDC.toast(c ? 'No text field is focused, so “' + it.title + '” was copied.' : 'Could not insert or copy.', c ? '' : 'error'); }
          PD.snippets.markUsed(it.ref, host);
          break;
        }
        case 'file': {
          close();
          const r = await PDC.attachById(it.id);
          PDC.toast(r.ok ? 'Attached ' + it.title : r.downloaded ? 'Could not attach here, so ' + it.title + ' was downloaded.' : (r.error || 'Could not attach the file.'), r.ok || r.downloaded ? '' : 'error');
          break;
        }
        case 'task': close(); PD.tasks.complete(it.id); PDC.toast('Done: ' + it.title); break;
        case 'desk': close(); PD.desks.setActive(it.id, { manual: true }); PDC.toast('Switched to ' + it.title); break;
        case 'session': close(); PD.sessions.setActive(it.id); PDC.toast('Session active: ' + it.title); break;
        case 'blueprint': close(); PDC.blueprint.run(it.ref); break;
        case 'create-task': { close(); const t = PD.tasks.create(it.parsed); PDC.toast('Task added: ' + t.title + (t.dueAt ? ' · ' + U.fmtDue(t.dueAt) : '')); break; }
        case 'command': close(); await runCommand(it.id); break;
      }
    } catch (e) { PDC.toast(e.message || 'Something went wrong.', 'error'); }
  }

  async function runCommand(id) {
    const desk = PD.desks.active();
    switch (id) {
      case 'new-task': open('task'); break;
      case 'new-capture': case 'new-paste': PDC.blueprint.record({ kind: id === 'new-capture' ? 'capture' : 'paste', deskId: desk && desk.id }); break;
      case 'end-session': { const s = PD.sessions.active(); if (s) { PD.sessions.end(s.id); PDC.toast('Session ended'); } else PDC.toast('No active session'); break; }
      case 'resume-auto': PD.desks.resumeAuto(); PDC.toast('Automatic desk detection is on'); break;
      case 'open-dashboard': PDC.send({ type: 'PD_OPEN', page: 'dashboard' }); break;
      case 'devices': PDC.send({ type: 'PD_OPEN', page: 'devices' }); break;
      case 'login': PDC.send({ type: 'PD_OPEN', page: 'login' }); break;
    }
  }

  PDC.commandBar = { toggle: (mode) => open(mode), close };
})();
