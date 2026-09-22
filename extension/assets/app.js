/*
 * PasteDeck extension UI — used by both the popup (compact) and the side panel (roomy).
 * PDApp.mount({ surface: 'popup' | 'sidepanel', tabs: [...] })
 */
(function () {
  'use strict';
  const U = PD.util, I = PD.icon, esc = U.esc, db = PD.db;
  const CONTENT_FILES = [
    'assets/shared/ui/pd-core.js', 'assets/shared/ui/pd-storage.js', 'assets/shared/ui/pd-domain.js',
    'content/content.js', 'content/commandbar.js', 'content/blueprint.js',
  ];
  const TAB_DEFS = {
    search: { label: 'Search', icon: 'search' },
    desks: { label: 'Desks', icon: 'layers' },
    session: { label: 'Session', icon: 'user' },
    files: { label: 'Files', icon: 'file' },
    tasks: { label: 'Tasks', icon: 'tasks' },
    clips: { label: 'Clips', icon: 'clipboard' },
  };
  const S = { surface: 'popup', tabs: [], tab: 'search', tabId: null, tabUrl: '', windowId: null, q: '', chip: 'all', results: [], sel: 0, deskDetail: null, newSession: false, clipQ: '' };
  let hdr, tabsEl, main;

  /* ------------------------------------------------------------------ helpers */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const toast = (m, k) => PD.ui.toast(m, k);
  const fail = (e) => PD.ui.fail(e, (err) => upsell(err.message));
  const site = (page) => chrome.runtime.sendMessage({ type: 'PD_OPEN', page });
  const closeIfPopup = () => { if (S.surface === 'popup') setTimeout(() => window.close(), 60); };

  async function loadTab() {
    try {
      const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (t) { S.tabId = t.id; S.tabUrl = t.url || ''; S.windowId = t.windowId; }
    } catch (e) { /* no tab access */ }
  }
  async function sendTab(msg) {
    if (S.tabId == null) return null;
    try { return await chrome.tabs.sendMessage(S.tabId, msg); } catch (e) {
      try { await chrome.scripting.executeScript({ target: { tabId: S.tabId }, files: CONTENT_FILES }); return await chrome.tabs.sendMessage(S.tabId, msg); } catch (e2) { return null; }
    }
  }
  const restricted = () => !/^https?:|^file:/.test(S.tabUrl || '');
  async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } }
  async function toPngBlob(dataUrl) {
    const blob = U.dataUrlToBlob(dataUrl);
    if (blob.type === 'image/png') return blob;
    const img = new Image(); img.src = dataUrl; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return await new Promise((res) => c.toBlob(res, 'image/png'));
  }
  function upsell(msg) {
    PD.ui.modal({
      title: 'Available on Pro Lifetime',
      html: '<p>' + esc(msg) + '</p><p class="pd-muted pd-sm" style="margin-top:8px">Pro Lifetime unlocks unlimited snippets and desks, the file shelf, blueprints and autofill.</p>',
      actions: [{ label: 'Not now' }, { label: 'See plans', primary: true, onClick() { site('pricing'); } }],
    });
  }

  /* ------------------------------------------------------------------ shell */
  function mount(opts) {
    S.surface = opts.surface; S.tabs = opts.tabs;
    document.body.classList.add('pd', 'surface-' + S.surface);
    const root = document.getElementById('app');
    root.className = 'app';
    root.innerHTML = '<header class="app-hdr" id="hdr"></header><nav class="app-tabs" id="tabs"></nav><main class="app-main" id="main"></main>';
    hdr = $('#hdr'); tabsEl = $('#tabs'); main = $('#main');
    main.addEventListener('click', onClick);
    main.addEventListener('change', onChange);
    main.addEventListener('input', onInput);
    main.addEventListener('keydown', onKeydown);

    (async () => {
      await db.init();
      await loadTab();
      PD.sessions.sweep();
      PD.devices.registerCurrent();
      if (PD.desks.autoSwitch(S.tabUrl)) { /* desk switched by URL */ }
      try { const r = await chrome.storage.local.get('pdui:tab'); if (r['pdui:tab'] && S.tabs.includes(r['pdui:tab'])) { S.tab = r['pdui:tab']; } await chrome.storage.local.remove('pdui:tab'); } catch (e) { /* ignore */ }
      renderAll();
      db.on((ns, source) => {
        if (source !== 'remote') return;
        if (main.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && S.tab !== 'search' && S.tab !== 'clips') return;
        renderHeader(); refreshTab();
      });
      setInterval(tick, 1000);
      if (S.surface === 'sidepanel') chrome.tabs.onActivated.addListener(async () => { await loadTab(); PD.desks.autoSwitch(S.tabUrl); renderHeader(); refreshTab(); });
    })();
  }

  function renderAll() { renderHeader(); renderTabs(); renderTab(); }

  function renderHeader() {
    const s = db.get('settings'), desks = PD.desks.all(), active = PD.desks.active();
    const auto = s.autoDetect !== false && !s.manualPin;
    hdr.innerHTML =
      '<img class="logo" src="../assets/shared/icons/icon-48.png" alt="">' +
      '<select class="pd-select desk-select" id="deskSel" aria-label="Active desk">' + desks.map((d) => '<option value="' + d.id + '"' + (active && d.id === active.id ? ' selected' : '') + '>' + esc(d.name) + '</option>').join('') + '</select>' +
      (auto ? '<span class="pd-badge" title="The desk follows the website you are on">Auto</span>' : '<button class="pd-btn pd-btn--sm" data-act="resume-auto" title="Go back to automatic desk detection">' + I('refresh', 12) + ' Auto</button>') +
      (S.surface === 'popup' ? '<button class="pd-btn pd-btn--ghost pd-btn--icon" data-act="open-panel" title="Open side panel" aria-label="Open side panel">' + I('panel') + '</button>' : '') +
      '<button class="pd-btn pd-btn--ghost pd-btn--icon" data-act="menu" title="Menu" aria-label="Menu">' + I('settings') + '</button>';
    $('#deskSel', hdr).onchange = (e) => { PD.desks.setActive(e.target.value, { manual: true }); renderHeader(); refreshTab(); };
    $$('[data-act]', hdr).forEach((b) => (b.onclick = () => headerAct(b)));
  }
  function headerAct(b) {
    const a = b.dataset.act;
    if (a === 'resume-auto') { PD.desks.resumeAuto(); PD.desks.autoSwitch(S.tabUrl); renderHeader(); refreshTab(); }
    else if (a === 'open-panel') { chrome.sidePanel.open({ windowId: S.windowId }).then(() => window.close()).catch(() => toast('Could not open the side panel here.', 'error')); }
    else if (a === 'menu') {
      PD.ui.menu(b, [
        { label: 'Open dashboard', icon: 'home', onClick: () => site('dashboard') },
        { label: 'Manage devices', icon: 'monitor', onClick: () => site('devices') },
        { label: 'Log in', icon: 'user', onClick: () => site('login') },
        '-',
        { label: 'Settings', icon: 'settings', onClick: () => chrome.runtime.openOptionsPage() },
        { label: 'Keyboard shortcuts', icon: 'command', onClick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) },
      ]);
    }
  }

  function renderTabs() {
    tabsEl.innerHTML = '<div class="pd-tabs" role="tablist">' + S.tabs.map((t) =>
      '<button class="pd-tab" role="tab" data-tab="' + t + '" aria-selected="' + (t === S.tab) + '" title="' + TAB_DEFS[t].label + '">' + I(TAB_DEFS[t].icon, 14) + '<span class="lbl">' + TAB_DEFS[t].label + '</span></button>').join('') + '</div>';
    $$('.pd-tab', tabsEl).forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; S.deskDetail = null; renderTabs(); renderTab(); }));
  }

  function renderTab() {
    ({ search: tabSearch, desks: tabDesks, session: tabSession, files: tabFiles, tasks: tabTasks, clips: tabClips }[S.tab] || tabSearch)();
  }
  function refreshTab() {
    if (S.tab === 'search') updateResults(); else if (S.tab === 'clips') updateClips(); else renderTab();
  }

  function tick() {
    $$('[data-exp]', main).forEach((n) => {
      const ms = +n.dataset.exp - Date.now();
      n.textContent = ms <= 0 ? 'expired' : U.fmtCountdown(ms);
      if (ms <= 0 && !n.dataset.done) { n.dataset.done = '1'; PD.sessions.sweep(); renderTab(); }
    });
  }

  /* ------------------------------------------------------------------ SEARCH */
  const CHIPS = [['all', 'All'], ['snippet', 'Snippets'], ['clip', 'Clips'], ['file', 'Files'], ['task', 'Tasks']];
  function tabSearch() {
    main.innerHTML =
      '<div class="search">' + I('search', 16) + '<input id="q" placeholder="Search snippets, files, tasks, desks…" autocomplete="off" spellcheck="false" value="' + esc(S.q) + '" aria-label="Search"><span class="pd-kbd">↵</span></div>' +
      '<div class="chips" id="chips">' + CHIPS.map((c) => '<button class="chip" data-chip="' + c[0] + '" aria-pressed="' + (S.chip === c[0]) + '">' + c[1] + '</button>').join('') + '</div>' +
      '<div class="results" id="results"></div>' +
      '<div class="foot"><button class="pd-btn pd-btn--sm" data-act="new-snippet">' + I('plus', 13) + ' New snippet</button><span class="pd-sm pd-muted"><span class="pd-kbd">Ctrl</span> <span class="pd-kbd">Shift</span> <span class="pd-kbd">Space</span> on any page</span></div>';
    updateResults();
    setTimeout(() => { const q = $('#q'); if (q) q.focus(); }, 30);
  }
  function updateResults() {
    const box = $('#results'); if (!box) return;
    const kinds = S.chip === 'all' ? null : [S.chip];
    S.results = PD.search(S.q, { kinds: kinds || undefined, limit: 40 });
    if (S.sel >= S.results.length) S.sel = 0;
    if (!S.results.length) {
      const none = !db.get('snippets').length;
      box.innerHTML = '<div class="pd-empty"><strong>' + (S.q ? 'Nothing matches “' + esc(S.q) + '”' : none ? 'No snippets yet' : 'Nothing here yet') + '</strong>' + (S.q ? 'Try a shorter word.' : 'Save the replies you type every day and insert them in one click.') + (none || !S.q ? '<br><button class="pd-btn pd-btn--primary pd-btn--sm" data-act="new-snippet">' + I('plus', 13) + ' New snippet</button>' : '') + '</div>';
      return;
    }
    const label = { snippet: 'Snippets', clip: 'Clipboard', file: 'Files', task: 'Reminders', session: 'Sessions', desk: 'Desks', blueprint: 'Blueprints', command: 'Commands' };
    let html = '', last = null;
    S.results.forEach((r, i) => {
      if (r.kind !== last && S.chip === 'all') { html += '<div class="grp">' + label[r.kind] + '</div>'; last = r.kind; }
      html += '<div class="pd-row' + (i === S.sel ? ' is-sel' : '') + '" data-i="' + i + '"><div class="pd-row__icon">' + I(r.icon, 15) + '</div><div class="pd-row__body"><div class="pd-row__title">' + esc(r.title) + '</div>' + (r.sub ? '<div class="pd-row__sub">' + esc(r.sub) + '</div>' : '') + '</div>' +
        '<span class="pd-row__hint">' + esc(r.hint || '') + '</span>' +
        (r.kind === 'snippet' ? '<div class="pd-row__actions"><button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="fav" data-id="' + r.id + '" title="' + (r.ref.favorite ? 'Unfavourite' : 'Favourite') + '">' + I('star', 14) + '</button><button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="edit-snippet" data-id="' + r.id + '" title="Edit">' + I('edit', 14) + '</button></div>' : '') + '</div>';
    });
    box.innerHTML = html;
    const sel = $('.pd-row.is-sel', box); if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  function moveSel(d) {
    if (!S.results.length) return;
    S.sel = (S.sel + d + S.results.length) % S.results.length;
    $$('#results .pd-row').forEach((n) => n.classList.toggle('is-sel', +n.dataset.i === S.sel));
    const s = $('#results .pd-row.is-sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  }

  async function runItem(it) {
    try {
      switch (it.kind) {
        case 'snippet': {
          const text = PD.snippets.render(it.ref.body);
          const r = restricted() ? null : await sendTab({ type: 'PD_INSERT', text });
          if (r && r.ok) { PD.snippets.markUsed(it.ref, U.hostOf(S.tabUrl)); toast('Inserted'); closeIfPopup(); }
          else { const ok = await copyText(text); PD.snippets.markUsed(it.ref, U.hostOf(S.tabUrl)); toast(ok ? 'Copied to clipboard. Click a text field first to insert directly.' : 'Could not copy.', ok ? '' : 'error'); }
          break;
        }
        case 'clip': await copyClip(it.ref); break;
        case 'file': await attachFile(it.ref); break;
        case 'task': PD.tasks.complete(it.id); toast('Done'); refreshTab(); break;
        case 'desk': PD.desks.setActive(it.id, { manual: true }); renderHeader(); refreshTab(); break;
        case 'session': PD.sessions.setActive(it.id); S.tab = 'session'; renderTabs(); renderTab(); break;
        case 'blueprint': await runBlueprint(it.ref); break;
        case 'command': await runCommand(it.id); break;
      }
    } catch (e) { fail(e); }
  }
  async function copyClip(h) {
    if (h.type === 'image' && h.hasBlob) {
      const url = await PD.blobs.get(h.id); if (!url) return toast('Image data is gone.', 'error');
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toPngBlob(url) })]); toast('Image copied'); } catch (e) { toast('Could not copy the image.', 'error'); }
    } else { const ok = await copyText(h.text || ''); toast(ok ? 'Copied' : 'Could not copy.', ok ? '' : 'error'); }
  }
  async function attachFile(f) {
    if (restricted()) return toast('Open a regular web page first.', 'error');
    const r = await sendTab({ type: 'PD_ATTACH', fileId: f.id });
    if (r && r.ok) { toast('Attached ' + f.name); closeIfPopup(); }
    else if (r && r.downloaded) toast('This page did not accept the file, so it was downloaded.');
    else toast((r && r.error) || 'Could not attach the file here.', 'error');
  }
  async function runBlueprint(bp) {
    try { PD.plan.require(bp.kind === 'capture' ? 'blueprints' : 'autofill', bp.kind === 'capture' ? 'Blueprints' : 'Autofill'); } catch (e) { return fail(e); }
    if (restricted()) return toast('Open the website this blueprint was made for.', 'error');
    const r = await sendTab({ type: 'PD_RUN_BLUEPRINT', id: bp.id });
    if (!r) return toast('Could not reach this page. Reload it and try again.', 'error');
    closeIfPopup();
  }
  async function runCommand(id) {
    const desk = PD.desks.active();
    switch (id) {
      case 'new-task': S.tab = 'tasks'; renderTabs(); renderTab(); setTimeout(() => { const t = $('#taskIn'); if (t) t.focus(); }, 30); break;
      case 'new-capture': case 'new-paste': startRecorder(id === 'new-capture' ? 'capture' : 'paste', desk && desk.id); break;
      case 'end-session': { const s = PD.sessions.active(); if (s) { PD.sessions.end(s.id); toast('Session ended'); refreshTab(); } else toast('No active session'); break; }
      case 'resume-auto': PD.desks.resumeAuto(); renderHeader(); break;
      case 'open-dashboard': site('dashboard'); break;
      case 'devices': site('devices'); break;
      case 'login': site('login'); break;
    }
  }
  async function startRecorder(kind, deskId) {
    try { PD.plan.require('blueprints', 'Blueprints'); } catch (e) { return fail(e); }
    if (restricted()) return toast('Open the website you want to teach PasteDeck first.', 'error');
    const r = await sendTab({ type: 'PD_START_RECORDER', kind, deskId });
    if (!r || !r.ok) return toast('Could not start on this page. Reload it and try again.', 'error');
    closeIfPopup();
  }

  /* ------------------------------------------------------------------ snippet editor (shared modal) */
  function editSnippet(id) { PD.ui.snippetEditor({ id, onSaved: refreshTab }); }

  /* ------------------------------------------------------------------ DESKS */
  function tabDesks() {
    if (S.deskDetail) return deskDetail(S.deskDetail);
    const s = db.get('settings'), active = PD.desks.active(), auto = s.autoDetect !== false && !s.manualPin;
    const det = PD.desks.detect(S.tabUrl);
    main.innerHTML =
      '<div class="status-line">' + I('zap', 13) + '<span>' + (auto ? 'Desks follow the website you are on.' : 'Desk pinned by you.') + (det && det.id !== (active && active.id) ? ' This site suggests <b>' + esc(det.name) + '</b>.' : '') + '</span></div>' +
      PD.desks.all().map((d) => {
        const c = PD.desks.counts(d.id), on = active && d.id === active.id;
        return '<div class="desk-card' + (on ? ' is-active' : '') + '" data-act="switch-desk" data-id="' + d.id + '"><div class="avatar' + (on ? '' : ' is-off') + '">' + esc(d.name.charAt(0).toUpperCase()) + '</div><div class="desk-card__b"><div class="desk-card__t">' + esc(d.name) + (d.shared ? ' <span class="pd-badge">Shared</span>' : '') + '</div><div class="desk-card__s">' + c.snippets + ' snippets · ' + c.blueprints + ' blueprints' + ((d.urlPatterns || []).length ? ' · ' + esc(d.urlPatterns.join(', ')) : '') + '</div></div><button class="pd-btn pd-btn--ghost pd-btn--icon" data-act="open-desk" data-id="' + d.id + '" aria-label="Manage ' + esc(d.name) + '">' + I('chevron') + '</button></div>';
      }).join('') +
      '<button class="pd-btn pd-btn--block" data-act="new-desk">' + I('plus', 14) + ' New desk</button>' +
      '<p class="pd-help" style="margin-top:8px">' + PD.plan.count('desks') + ' of ' + (isFinite(PD.plan.info().desks) ? PD.plan.info().desks : 'unlimited') + ' desks on the ' + esc(PD.plan.info().label) + ' plan.</p>';
  }
  function deskDetail(id) {
    const d = PD.desks.get(id); if (!d) { S.deskDetail = null; return tabDesks(); }
    const bps = db.get('blueprints').filter((b) => b.deskId === id);
    main.innerHTML =
      '<button class="pd-btn pd-btn--ghost pd-btn--sm" data-act="back-desks" style="margin:-4px 0 8px -6px">' + I('back', 14) + ' All desks</button>' +
      '<div class="pd-field"><label class="pd-label">Desk name</label><input class="pd-input" data-desk-name value="' + esc(d.name) + '"></div>' +
      '<div class="pd-field"><label class="pd-label">Switch to this desk on these websites</label><input class="pd-input" data-desk-urls value="' + esc((d.urlPatterns || []).join(', ')) + '" placeholder="web.whatsapp.com, mail.google.com"><div class="pd-help">Comma separated. Subdomains match automatically.</div></div>' +
      '<div class="sec-h"><span>Blueprints</span></div>' +
      (bps.length ? bps.map((b) => '<div class="bp-row"><div class="pd-row__icon">' + I(b.kind === 'capture' ? 'target' : 'form', 15) + '</div><div class="bp-row__b"><div class="bp-row__t">' + esc(b.name) + '</div><div class="pd-row__sub">' + (b.kind === 'capture' ? 'Copies from ' : 'Fills on ') + esc(b.host) + ' · ' + b.fields.length + ' fields</div></div><button class="pd-btn pd-btn--sm" data-act="run-bp" data-id="' + b.id + '">' + I('play', 12) + ' Run</button><button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="del-bp" data-id="' + b.id + '" aria-label="Delete blueprint">' + I('trash', 14) + '</button></div>').join('') : '<p class="pd-muted pd-sm">No blueprints yet. Open a client page, then teach PasteDeck once.</p>') +
      '<div style="display:flex;gap:8px;margin-top:10px"><button class="pd-btn pd-btn--sm" data-act="new-bp" data-kind="capture" style="flex:1">' + I('target', 13) + ' Capture blueprint</button><button class="pd-btn pd-btn--sm" data-act="new-bp" data-kind="paste" style="flex:1">' + I('form', 13) + ' Paste blueprint</button></div>' +
      '<div style="margin-top:18px"><button class="pd-btn pd-btn--danger pd-btn--sm" data-act="del-desk" data-id="' + id + '">' + I('trash', 13) + ' Delete desk</button></div>';
  }

  /* ------------------------------------------------------------------ SESSION */
  function tabSession() {
    const live = PD.sessions.live(), cur = PD.sessions.active();
    const here = PD.blueprints.forUrl(S.tabUrl);
    let html = '';
    if (!cur || S.newSession) {
      html += newSessionForm(!cur);
    } else {
      html +=
        '<div class="sess-h"><h3>' + esc(cur.name) + '</h3><button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="rename-session" title="Rename" aria-label="Rename">' + I('edit', 14) + '</button></div>' +
        '<div class="status-line">' + I('clock', 13) + '<span>' + (cur.expiresAt ? 'Deletes itself in <b data-exp="' + cur.expiresAt + '">' + U.fmtCountdown(cur.expiresAt - Date.now()) + '</b>' : 'No expiry') + '</span>' +
        '<select class="pd-select" data-extend style="width:auto;height:24px;min-height:24px;padding:0 6px;font-size:12px;margin-left:auto"><option value="">Change…</option>' + PD.SESSION_PRESETS.map((p) => '<option value="' + p.id + '">Expire in ' + p.label.toLowerCase() + '</option>').join('') + '</select></div>' +
        '<div id="sfields">' + cur.fields.map((f) => sfRow(f)).join('') + '</div>' +
        '<div class="sf" style="grid-template-columns:1fr auto"><input class="pd-input" data-newfield placeholder="Add a field, e.g. Visa Type"><button class="pd-btn pd-btn--sm" data-act="add-field">' + I('plus', 13) + '</button></div>';
    }
    if (here.length && cur) {
      html += '<div class="sec-h"><span>On this page</span></div>' + here.map((b) => '<div class="bp-row"><div class="pd-row__icon">' + I(b.kind === 'capture' ? 'target' : 'form', 15) + '</div><div class="bp-row__b"><div class="bp-row__t">' + esc(b.name) + '</div></div><button class="pd-btn pd-btn--primary pd-btn--sm" data-act="run-bp" data-id="' + b.id + '">' + (b.kind === 'capture' ? 'Copy details' : 'Fill form') + '</button></div>').join('');
    } else if (cur && !S.newSession && S.tabUrl && !restricted()) {
      html += '<div class="sec-h"><span>Teach this website</span></div><div style="display:flex;gap:8px"><button class="pd-btn pd-btn--sm" data-act="new-bp" data-kind="capture" style="flex:1">' + I('target', 13) + ' Capture blueprint</button><button class="pd-btn pd-btn--sm" data-act="new-bp" data-kind="paste" style="flex:1">' + I('form', 13) + ' Paste blueprint</button></div>';
    }
    if (live.length && !S.newSession) {
      html += '<div class="sec-h"><span>Sessions (' + live.length + ')</span><button class="pd-btn pd-btn--sm" data-act="new-session">' + I('plus', 12) + ' New</button></div><div class="chipset">' +
        live.map((s) => '<button class="chip" data-act="use-session" data-id="' + s.id + '" aria-pressed="' + (cur && s.id === cur.id) + '">' + esc(s.name) + '</button>').join('') + '</div>' +
        (cur ? '<div style="margin-top:14px"><button class="pd-btn pd-btn--danger pd-btn--sm" data-act="end-session" data-id="' + cur.id + '">End this session now</button></div>' : '');
    }
    main.innerHTML = html;
  }
  function sfRow(f) {
    return '<div class="sf"><label title="' + esc(f.label) + '">' + esc(f.label) + '</label><input class="pd-input" data-field="' + esc(f.label) + '" value="' + esc(f.value) + '" placeholder="—"><div class="sf__act"><button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="ins-field" data-label="' + esc(f.label) + '" title="Insert into the page">' + I('upload', 13) + '</button><button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="copy-field" data-label="' + esc(f.label) + '" title="Copy">' + I('copy', 13) + '</button><button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="rm-field" data-key="' + esc(f.key) + '" title="Remove field">' + I('x', 13) + '</button></div></div>';
  }
  function newSessionForm(first) {
    const def = db.get('settings').defaultExpiry || '1h';
    return '<div class="' + (first ? 'pd-empty' : '') + '" style="' + (first ? 'padding:8px 0 16px' : '') + '">' + (first ? '<strong>Start a candidate session</strong>Keep one person’s details in reach across WhatsApp, forms and email. It deletes itself when the timer ends.' : '<div class="sec-h"><span>New session</span></div>') + '</div>' +
      '<div class="pd-field"><label class="pd-label">Candidate name</label><input class="pd-input" id="nsName" placeholder="John Kamau"></div>' +
      '<div class="pd-field"><label class="pd-label">Delete after</label><select class="pd-select" id="nsExp">' + PD.SESSION_PRESETS.map((p) => '<option value="' + p.id + '"' + (p.id === def ? ' selected' : '') + '>' + p.label + '</option>').join('') + '</select></div>' +
      '<div style="display:flex;gap:8px"><button class="pd-btn pd-btn--primary" data-act="create-session" style="flex:1">Start session</button>' + (first ? '' : '<button class="pd-btn" data-act="cancel-session">Cancel</button>') + '</div>';
  }

  /* ------------------------------------------------------------------ FILES */
  function tabFiles() {
    if (!PD.plan.can('files')) {
      main.innerHTML = '<div class="lock">' + I('lock', 28) + '<p style="margin:10px 0 4px;font-weight:600">The file shelf is part of Pro</p><p class="pd-muted pd-sm">Keep your logo, location and requirements PDF one click away. Free plans stay text-only.</p><button class="pd-btn pd-btn--primary" style="margin-top:14px" data-act="see-plans">See plans</button></div>';
      return;
    }
    const desk = PD.desks.active(), cur = PD.sessions.active();
    const stat = PD.files.visible(desk && desk.id), sess = cur ? PD.files.forSession(cur.id) : [];
    const addBtn = (kind, label, dis) => '<button class="pd-btn pd-btn--sm" data-act="add-file" data-kind="' + kind + '"' + (dis ? ' disabled' : '') + '>' + I('plus', 12) + ' ' + label + '</button>';
    main.innerHTML =
      '<div class="sec-h"><span>Static files</span>' + addBtn('static', 'Add') + '</div>' + (stat.length ? stat.map(fileRow).join('') : '<p class="pd-muted pd-sm">Logo, office location, requirements PDF. They stay until you delete them.</p>') +
      '<div class="sec-h"><span>Session files' + (cur ? ' · ' + esc(cur.name) : '') + '</span>' + addBtn('session', 'Add', !cur) + '</div>' + (sess.length ? sess.map(fileRow).join('') : '<p class="pd-muted pd-sm">' + (cur ? 'Passport photo, full-body photo. Deleted when the session expires.' : 'Start a session to add photos for one candidate.') + '</p>') +
      '<input type="file" id="fileIn" multiple hidden>';
    $$('.file__th[data-thumb]', main).forEach(async (n) => { const url = await PD.blobs.get(n.dataset.thumb); if (url) n.innerHTML = '<img alt="" src="' + url + '">'; });
  }
  function fileRow(f) {
    const img = f.mime && f.mime.indexOf('image/') === 0;
    return '<div class="file"><div class="file__th"' + (img ? ' data-thumb="' + f.id + '"' : '') + '>' + (img ? '' : I('file', 16)) + '</div><div class="file__b"><div class="pd-row__title">' + esc(f.name) + '</div><div class="pd-row__sub">' + U.fmtBytes(f.size) + (f.expiresAt ? ' · expires with session' : '') + '</div></div>' +
      '<button class="pd-btn pd-btn--sm" data-act="attach" data-id="' + f.id + '" title="Attach to the page">' + I('paperclip', 12) + ' Attach</button>' +
      (img ? '<button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="copy-file" data-id="' + f.id + '" title="Copy image">' + I('copy', 13) + '</button>' : '') +
      '<button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="dl-file" data-id="' + f.id + '" title="Download">' + I('download', 13) + '</button>' +
      '<button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="del-file" data-id="' + f.id + '" title="Delete">' + I('trash', 13) + '</button></div>';
  }

  /* ------------------------------------------------------------------ TASKS */
  function tabTasks() {
    const now = Date.now(), all = db.get('tasks');
    const open = all.filter((t) => !t.done).sort((a, b) => (PD.tasks.effectiveDue(a) || 9e15) - (PD.tasks.effectiveDue(b) || 9e15));
    const eod = U.endOfDay();
    const groups = [
      ['Overdue', open.filter((t) => PD.tasks.effectiveDue(t) && PD.tasks.effectiveDue(t) < now)],
      ['Today', open.filter((t) => { const d = PD.tasks.effectiveDue(t); return d && d >= now && d <= eod; })],
      ['Upcoming', open.filter((t) => PD.tasks.effectiveDue(t) > eod)],
      ['No due time', open.filter((t) => !PD.tasks.effectiveDue(t))],
    ];
    const done = all.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 5);
    main.innerHTML =
      '<div class="search">' + I('plus', 16) + '<input id="taskIn" placeholder="Call medical tomorrow 9am" autocomplete="off" aria-label="New task"><span class="pd-kbd">↵</span></div><div class="parse-prev" id="tprev"></div>' +
      groups.filter((g) => g[1].length).map((g) => '<div class="sec-h"><span>' + g[0] + '</span></div>' + g[1].map(taskRow).join('')).join('') +
      (!open.length ? '<div class="pd-empty"><strong>Nothing to do</strong>Type a task above. Try “Call medical tomorrow 9am”.</div>' : '') +
      (done.length ? '<div class="sec-h"><span>Done</span></div>' + done.map(taskRow).join('') : '');
    setTimeout(() => { const t = $('#taskIn'); if (t && !document.activeElement.matches('input,select,textarea')) t.focus(); }, 30);
  }
  function taskRow(t) {
    const due = PD.tasks.effectiveDue(t), late = !t.done && due && due < Date.now();
    return '<div class="task"><button class="chk' + (t.done ? ' is-done' : '') + '" data-act="toggle-task" data-id="' + t.id + '" aria-label="' + (t.done ? 'Mark not done' : 'Mark done') + '">' + (t.done ? I('check', 12) : '') + '</button>' +
      '<div class="task__b"><div class="task__t' + (t.done ? ' is-done' : '') + '">' + esc(t.title) + '</div><div class="task__s' + (late ? ' is-late' : '') + '">' + (due ? U.fmtDue(due) : 'No due time') + (t.recurrence ? ' · repeats ' + t.recurrence : '') + (t.snoozedUntil && t.snoozedUntil > (t.dueAt || 0) ? ' · snoozed' : '') + '</div></div>' +
      (t.done ? '' : '<div class="snooze-wrap" title="Snooze">' + I('clock', 15) + '<select class="mini" data-snooze="' + t.id + '" aria-label="Snooze"><option value="">Snooze</option><option value="600000">10 minutes</option><option value="3600000">1 hour</option><option value="tomorrow">Tomorrow 9:00</option></select></div>') +
      '<button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="del-task" data-id="' + t.id + '" aria-label="Delete task">' + I('trash', 13) + '</button></div>';
  }

  /* ------------------------------------------------------------------ CLIPS (side panel) */
  function tabClips() {
    main.innerHTML =
      '<div class="search">' + I('search', 16) + '<input id="clipQ" placeholder="Search clipboard history" autocomplete="off" value="' + esc(S.clipQ) + '" aria-label="Search clipboard history"></div>' +
      '<div class="status-line" style="margin-top:10px">' + I('lock', 13) + '<span>Stays on this device. Password fields are never recorded.</span><button class="pd-btn pd-btn--sm" data-act="clear-clips" style="margin-left:auto">Clear</button></div><div id="clipList"></div>';
    updateClips();
  }
  function updateClips() {
    const box = $('#clipList'); if (!box) return;
    const q = S.clipQ.trim().toLowerCase();
    const list = db.get('history').filter((h) => !q || ((h.text || h.name || '') + ' ' + (h.host || '')).toLowerCase().indexOf(q) >= 0).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).slice(0, 80);
    if (!list.length) { box.innerHTML = '<div class="pd-empty"><strong>' + (q ? 'No matches' : 'Nothing copied yet') + '</strong>Text you copy on web pages shows up here.</div>'; return; }
    box.innerHTML = list.map((h) => '<div class="clip" data-act="copy-clip" data-id="' + h.id + '">' +
      (h.type === 'image' ? '<div class="file__th" data-thumb="' + h.id + '" style="width:40px;height:40px">' + I('image', 16) + '</div>' : '<div class="pd-row__icon">' + I(h.type === 'link' ? 'link' : h.type === 'file' ? 'file' : 'text', 15) + '</div>') +
      '<div class="clip__t"><div class="clip__x">' + esc(h.type === 'image' ? (h.name || 'Image') : h.type === 'file' ? (h.name || 'File') : h.text) + '</div><div class="pd-row__sub">' + esc(h.host || '') + ' · ' + U.fmtAgo(h.createdAt) + (h.pinned ? ' · pinned' : '') + '</div></div>' +
      '<div class="acts"><button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="pin-clip" data-id="' + h.id + '" title="' + (h.pinned ? 'Unpin' : 'Pin') + '">' + I('pin', 13) + '</button><button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="del-clip" data-id="' + h.id + '" title="Delete">' + I('trash', 13) + '</button></div></div>').join('');
    $$('.file__th[data-thumb]', box).forEach(async (n) => { const url = await PD.blobs.get(n.dataset.thumb); if (url) n.innerHTML = '<img alt="" src="' + url + '">'; });
  }

  /* ------------------------------------------------------------------ events */
  function onInput(e) {
    const t = e.target;
    if (t.id === 'q') { S.q = t.value; S.sel = 0; updateResults(); }
    else if (t.id === 'clipQ') { S.clipQ = t.value; updateClips(); }
    else if (t.id === 'taskIn') {
      const p = t.value.trim() ? PD.tasks.parse(t.value) : null;
      $('#tprev').textContent = p ? '→ ' + p.title + ' · ' + (p.dueAt ? U.fmtDue(p.dueAt) : 'no due time') + (p.recurrence ? ' · repeats ' + p.recurrence : '') : '';
    }
  }
  function onKeydown(e) {
    const t = e.target;
    if (t.id === 'q') {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); const it = S.results[S.sel]; if (it) runItem(it); }
    } else if (t.id === 'taskIn' && e.key === 'Enter') {
      const v = t.value.trim(); if (!v) return;
      try { const task = PD.tasks.create(v); toast('Added: ' + task.title + (task.dueAt ? ' · ' + U.fmtDue(task.dueAt) : '')); renderTab(); } catch (err) { fail(err); }
    } else if (t.id === 'nsName' && e.key === 'Enter') { createSession(); }
    else if (t.matches && t.matches('[data-newfield]') && e.key === 'Enter') { addField(); }
  }
  function onChange(e) {
    const t = e.target;
    if (t.matches('[data-field]')) { const s = PD.sessions.active(); if (s) PD.sessions.setField(s.id, t.dataset.field, t.value); }
    else if (t.matches('[data-extend]')) { const s = PD.sessions.active(); if (s && t.value) { PD.sessions.extend(s.id, t.value); renderTab(); } }
    else if (t.matches('[data-snooze]')) { if (t.value) { PD.tasks.snooze(t.dataset.snooze, t.value === 'tomorrow' ? 'tomorrow' : +t.value); toast('Snoozed'); renderTab(); } }
    else if (t.matches('[data-desk-name]')) { const d = PD.desks.get(S.deskDetail); if (d && t.value.trim()) { PD.desks.update(d.id, { name: t.value.trim() }); renderHeader(); } }
    else if (t.matches('[data-desk-urls]')) { const d = PD.desks.get(S.deskDetail); if (d) { PD.desks.update(d.id, { urlPatterns: t.value.split(',').map((x) => x.trim()).filter(Boolean) }); toast('Saved'); } }
    else if (t.id === 'fileIn') { addFiles(t); }
  }
  async function addFiles(input) {
    const kind = input.dataset.kind, cur = PD.sessions.active(), desk = PD.desks.active();
    for (const f of Array.prototype.slice.call(input.files)) {
      try { await PD.files.add(f, { kind, sessionId: cur && cur.id, deskId: desk && desk.id }); toast('Added ' + f.name); } catch (e) { fail(e); }
    }
    input.value = ''; renderTab();
  }

  function createSession() {
    const name = ($('#nsName') || {}).value || '', preset = ($('#nsExp') || {}).value;
    try { PD.sessions.create({ name, preset }); S.newSession = false; renderTab(); } catch (e) { fail(e); }
  }
  function addField() {
    const s = PD.sessions.active(), inp = $('[data-newfield]'); if (!s || !inp || !inp.value.trim()) return;
    PD.sessions.setField(s.id, inp.value.trim(), ''); renderTab(); setTimeout(() => { const n = $$('[data-field]'); if (n.length) n[n.length - 1].focus(); }, 20);
  }

  async function onClick(e) {
    const chip = e.target.closest('[data-chip]');
    if (chip) { S.chip = chip.dataset.chip; $$('.chip[data-chip]').forEach((c) => c.setAttribute('aria-pressed', c.dataset.chip === S.chip)); S.sel = 0; updateResults(); return; }
    const row = e.target.closest('.pd-row[data-i]');
    const act = e.target.closest('[data-act]');
    if (row && !act) { const it = S.results[+row.dataset.i]; if (it) runItem(it); return; }
    if (!act) return;
    e.stopPropagation();
    const id = act.dataset.id;
    try {
      switch (act.dataset.act) {
        case 'new-snippet': editSnippet(); break;
        case 'edit-snippet': editSnippet(id); break;
        case 'fav': { const s = db.find('snippets', id); db.upsert('snippets', { id, favorite: !s.favorite }); updateResults(); break; }
        case 'switch-desk': PD.desks.setActive(id, { manual: true }); renderHeader(); renderTab(); break;
        case 'open-desk': S.deskDetail = id; renderTab(); break;
        case 'back-desks': S.deskDetail = null; renderTab(); break;
        case 'new-desk': { const name = await PD.ui.prompt('New desk', 'Desk name', '', { placeholder: 'Visa Desk', confirmLabel: 'Create desk' }); if (name) { const d = PD.desks.create(name); S.deskDetail = d.id; renderTab(); } break; }
        case 'del-desk': if (await PD.ui.confirm('Delete this desk and its blueprints? Snippets move to “All desks”.', { danger: true, confirmLabel: 'Delete desk' })) { PD.desks.remove(id); S.deskDetail = null; renderHeader(); renderTab(); } break;
        case 'new-bp': startRecorder(act.dataset.kind, S.deskDetail || (PD.desks.active() || {}).id); break;
        case 'run-bp': runBlueprint(db.find('blueprints', id)); break;
        case 'del-bp': if (await PD.ui.confirm('Delete this blueprint?', { danger: true, confirmLabel: 'Delete' })) { PD.blueprints.remove(id); renderTab(); } break;
        case 'new-session': S.newSession = true; renderTab(); setTimeout(() => { const n = $('#nsName'); if (n) n.focus(); }, 20); break;
        case 'cancel-session': S.newSession = false; renderTab(); break;
        case 'create-session': createSession(); break;
        case 'use-session': PD.sessions.setActive(id); renderTab(); break;
        case 'end-session': if (await PD.ui.confirm('End this session? Its details and files are deleted.', { danger: true, confirmLabel: 'End session' })) { PD.sessions.end(id); renderTab(); } break;
        case 'rename-session': { const s = PD.sessions.active(); const n = s && await PD.ui.prompt('Rename session', 'Candidate name', s.name); if (n) { PD.sessions.rename(s.id, n); renderTab(); } break; }
        case 'add-field': addField(); break;
        case 'rm-field': { const s = PD.sessions.active(); if (s) { PD.sessions.removeField(s.id, act.dataset.key); renderTab(); } break; }
        case 'copy-field': { const s = PD.sessions.active(); const v = PD.sessions.value(s, act.dataset.label); toast(v ? ((await copyText(v)) ? 'Copied' : 'Could not copy.') : 'That field is empty.', v ? '' : 'error'); break; }
        case 'ins-field': {
          const s = PD.sessions.active(), v = PD.sessions.value(s, act.dataset.label);
          if (!v) return toast('That field is empty.', 'error');
          const r = restricted() ? null : await sendTab({ type: 'PD_INSERT', text: v });
          if (r && r.ok) { toast('Inserted'); closeIfPopup(); } else toast((await copyText(v)) ? 'Copied. Click a text field first to insert directly.' : 'Could not copy.');
          break;
        }
        case 'see-plans': site('pricing'); break;
        case 'add-file': { const inp = $('#fileIn'); inp.dataset.kind = act.dataset.kind; if (S.surface === 'popup') { await chrome.storage.local.set({ 'pdui:tab': 'files' }); chrome.sidePanel.open({ windowId: S.windowId }).then(() => window.close()).catch(() => inp.click()); } else inp.click(); break; }
        case 'attach': attachFile(db.find('files', id)); break;
        case 'copy-file': { const url = await PD.blobs.get(id); try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toPngBlob(url) })]); toast('Image copied'); } catch (err) { toast('Could not copy the image.', 'error'); } break; }
        case 'dl-file': { const f = db.find('files', id), url = await PD.blobs.get(id); if (url) { const a = document.createElement('a'); a.href = URL.createObjectURL(U.dataUrlToBlob(url)); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); } break; }
        case 'del-file': if (await PD.ui.confirm('Delete this file?', { danger: true, confirmLabel: 'Delete' })) { await PD.files.remove(id); renderTab(); } break;
        case 'toggle-task': { const t = db.find('tasks', id); if (t.done) PD.tasks.reopen(id); else PD.tasks.complete(id); renderTab(); break; }
        case 'del-task': PD.tasks.remove(id); renderTab(); break;
        case 'copy-clip': { const h = db.find('history', id); if (h) copyClip(h); break; }
        case 'pin-clip': PD.history.pin(id); updateClips(); break;
        case 'del-clip': PD.history.remove(id); updateClips(); break;
        case 'clear-clips': if (await PD.ui.confirm('Clear clipboard history? Pinned items are kept.', { danger: true, confirmLabel: 'Clear history' })) { PD.history.clear(true); updateClips(); } break;
      }
    } catch (err) { fail(err); }
  }

  window.PDApp = { mount };
})();
