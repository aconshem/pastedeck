/*
 * PasteBoard dashboard — account control center.
 * Two data sources, kept deliberately separate:
 *   - Account / Team / trial & plan billing -> the real Netlify Functions backend (website/assets/api.js).
 *     This is genuine, persisted, cross-device data (see docs/architecture.md).
 *   - Desks, snippets, sessions, blueprints, files, clipboard history, tasks, company details -> this
 *     device's own local data (the extension's storage, reached through the bridge, or this browser's
 *     localStorage when there's no extension to bridge to). Premium accounts move this between devices
 *     only through Export / Import (Settings) — there is no cloud sync yet (Premium Pro, paused).
 */
(async function () {
  'use strict';
  const session = PBApi.session();
  if (!session) { location.replace('../login/index.html?next=dashboard'); return; }

  const U = PD.util, I = PD.icon, esc = U.esc;
  const content = document.getElementById('content');
  await PD.db.init({ adapter: 'web' });
  const db = PD.db;
  const bridged = db.adapter.name === 'extension-bridge';
  if (!bridged) PD.devices.registerCurrent();

  let ACC = null, backendErr = null;
  async function loadAccount() {
    try { ACC = await PBApi.account(); backendErr = null; }
    catch (e) { ACC = null; backendErr = e.message; }
  }
  await loadAccount();

  const PAGES = [
    ['home', 'Home', 'home'], ['desks', 'Desks', 'layers'], ['history', 'Clipboard History', 'clipboard'], ['analytics', 'Analytics', 'chart'],
    ['team', 'Team & Devices', 'users'], ['company', 'Company', 'building'], ['tasks', 'Tasks', 'tasks'], ['settings', 'Settings', 'settings'],
  ];
  const S = { deskId: null, histQ: '' };
  const canManage = () => !!ACC && (ACC.you.role === 'owner' || ACC.you.role === 'admin');
  const canSeeAnalytics = () => !!ACC && (ACC.you.role === 'owner' || ACC.you.analyticsAccess);
  const toast = (m, k) => PD.ui.toast(m, k);
  const fail = (e) => PD.ui.fail(e);
  const route = () => { const r = location.hash.slice(1); return PAGES.some((p) => p[0] === r) ? r : 'home'; };
  const badge = (t, c) => '<span class="pd-badge' + (c ? ' pd-badge--' + c : '') + '">' + esc(t) + '</span>';
  const head = (title, sub, actions) => '<div class="page-h"><div><h1>' + title + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div><div class="tools">' + (actions || '') + '</div></div>';
  const empty = (t, s, btn) => '<div class="pd-empty"><strong>' + t + '</strong>' + s + (btn || '') + '</div>';
  const lockNote = () => canManage() ? '' : '<div class="banner warn">' + I('lock', 16) + '<span>Only the account owner (or someone they\u2019ve made an admin) can change this.</span></div>';
  const backendBanner = () => backendErr ? '<div class="banner warn">' + I('monitor', 16) + '<span><b>Account features are offline.</b> ' + esc(backendErr) + '</span></div>' : '';

  /* ---------------------------------------------------------------- shell */
  function renderShell() {
    const r = route(), plan = PD.plan.info();
    document.getElementById('side').innerHTML =
      '<a class="brand" href="../landing/index.html"><img src="../assets/shared/icons/icon-48.png" alt="">PasteBoard</a><nav>' +
      PAGES.map((p) => '<a class="nav" href="#' + p[0] + '"' + (p[0] === r ? ' aria-current="page"' : '') + '>' + I(p[2], 16) + p[1] + '</a>').join('') + '</nav><div class="spacer"></div>' +
      '<div class="plan-chip"><b>' + esc(ACC ? PD.PLANS[ACC.plan].label : 'Account offline') + '</b>' + (ACC && (ACC.plan === 'premium' || ACC.plan === 'premiumpro') ? 'All features unlocked' : ACC ? 'Upgrade for files and blueprints' : '') + '</div>';
    document.getElementById('top').innerHTML =
      '<span class="pd-badge ' + (bridged ? 'pd-badge--ok' : 'pd-badge--warn') + '" title="' + (bridged ? 'Reading and writing your extension data' : 'Desks/snippets/etc. are stored in this browser only') + '">' + (bridged ? 'Connected to extension' : 'This browser only \u2014 install the extension for your real data') + '</span><div class="grow"></div>' +
      (ACC ? '<span class="pd-sm pd-muted">' + esc(ACC.you.name) + ' \u00b7 ' + (ACC.you.role === 'owner' ? 'Owner' : 'Member') + '</span>' : '<span class="pd-sm pd-muted">' + esc(session.accountEmail || '') + '</span>') +
      '<button class="pd-btn pd-btn--sm" data-act="signout">' + I('logout', 13) + ' Log out</button>';
  }

  function render() {
    renderShell();
    const r = route();
    const fn = { home, desks, history, analytics, team, company, tasks, settings }[r];
    const y = window.scrollY;
    content.innerHTML = r === 'analytics' && !canSeeAnalytics() ? lockedAnalytics() : fn();
    document.title = PAGES.find((p) => p[0] === r)[1] + ' \u00b7 PasteBoard';
    hydrate();
    if (y) window.scrollTo(0, y);
  }
  function hydrate() {
    content.querySelectorAll('[data-blob]').forEach(async (n) => { const u = await PD.blobs.get(n.dataset.blob); if (u) { const img = document.createElement('img'); img.alt = ''; img.src = u; n.appendChild(img); } });
  }
  function lockedAnalytics() {
    return head('Analytics') + '<div class="lock pd-card">' + I('lock', 28) + '<p style="margin:10px 0 4px;font-weight:600">Analytics is limited to the account owner</p><p class="pd-muted pd-sm">Ask ' + esc((ACC && ACC.devices.find((d) => d.role === 'owner') || {}).name || 'the account owner') + ' to grant you access from the Team & Devices page.</p></div>';
  }
  function trialBanner() {
    if (!ACC || !ACC.trial) return '';
    const days = Math.ceil((ACC.trial.endsAt - Date.now()) / 86400000);
    if (days > 0) return '<div class="banner">' + I('star', 16) + '<span><b>' + days + '-day free trial</b> \u2014 every ' + esc(PD.PLANS[ACC.plan].label) + ' feature is unlocked. Card payments are USD only; nothing is charged until the trial ends, and the processor isn\u2019t connected yet, so nothing will actually be charged today either.</span></div>';
    return '<div class="banner warn">' + I('star', 16) + '<span>Your 14-day trial ended. Billing isn\u2019t connected yet, so you keep full access for now \u2014 this will change once card payments go live.</span></div>';
  }

  /* ---------------------------------------------------------------- Home */
  function home() {
    const t = PD.analytics.today(), plan = PD.plan.info(), desk = PD.desks.active();
    const open = db.get('tasks').filter((x) => !x.done).sort((a, b) => (PD.tasks.effectiveDue(a) || 9e15) - (PD.tasks.effectiveDue(b) || 9e15)).slice(0, 5);
    const meter = (label, k) => {
      const n = PD.plan.count(k), l = plan[k], fin = isFinite(l);
      return '<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>' + label + '</span><span class="pd-muted">' + n + (fin ? ' of ' + l : ' \u00b7 unlimited') + '</span></div>' + (fin ? '<div class="meter"><i style="width:' + Math.min(100, n / l * 100) + '%"></i></div>' : '') + '</div>';
    };
    return head('Home', 'Your account at a glance.') + backendBanner() + trialBanner() +
      '<div class="grid3">' +
      '<div class="pd-card stat"><div class="stat__l">Snippets used today</div><div class="stat__v">' + t.snippets + '</div><div class="stat__s">Inserted or expanded</div></div>' +
      '<div class="pd-card stat"><div class="stat__l">Forms autofilled today</div><div class="stat__v">' + t.autofills + '</div><div class="stat__s">Fields filled by blueprints</div></div>' +
      '<div class="pd-card stat"><div class="stat__l">Estimated time saved</div><div class="stat__v">' + U.fmtDuration(t.savedSec) + '</div><div class="stat__s">Today</div></div></div>' +
      '<div class="grid2 block"><div class="pd-card pad"><h2 style="font-size:14px;margin-bottom:12px">Active desk</h2>' +
      (desk ? '<div class="t" style="font-weight:600;font-size:16px">' + esc(desk.name) + '</div><div class="pd-muted pd-sm" style="margin:2px 0 12px">' + (desk.urlPatterns || []).map(esc).join(', ') + '</div><a class="pd-btn pd-btn--sm" href="#desks">Manage desks</a>' : '\u2014') + '</div>' +
      '<div class="pd-card pad"><h2 style="font-size:14px;margin-bottom:12px">This browser\u2019s plan limits \u00b7 ' + esc(plan.label) + '</h2>' + meter('Snippets', 'snippets') + meter('Desks', 'desks') + meter('Sessions', 'sessions') + '</div></div>' +
      '<div class="block"><h2>Up next</h2><div class="pd-card">' + (open.length ? open.map((x) => '<div class="line"><div class="grow"><div class="t">' + esc(x.title) + '</div><div class="s">' + U.fmtDue(PD.tasks.effectiveDue(x)) + '</div></div></div>').join('') : empty('Nothing scheduled', 'Add reminders from the Tasks page or the extension.')) + '</div></div>';
  }

  /* ---------------------------------------------------------------- Desks */
  function desks() {
    const all = PD.desks.all();
    if (!S.deskId || !PD.desks.get(S.deskId)) S.deskId = (PD.desks.active() || all[0] || {}).id;
    const d = PD.desks.get(S.deskId);
    const snips = db.get('snippets').filter((s) => s.deskId === d.id), bps = db.get('blueprints').filter((b) => b.deskId === d.id);
    return head('Desks', 'A desk is a working environment. Switching desks changes which snippets, files and blueprints are in reach.', '<button class="pd-btn pd-btn--primary" data-act="new-desk">' + I('plus', 14) + ' New desk</button>') +
      '<div class="split"><div class="desk-list">' + all.map((x) => { const c = PD.desks.counts(x.id); return '<button class="desk-item" data-act="pick-desk" data-id="' + x.id + '" aria-current="' + (x.id === d.id) + '"><div class="pd-row__icon">' + I('layers', 15) + '</div><div><div class="t">' + esc(x.name) + '</div><div class="s">' + c.snippets + ' snippets \u00b7 ' + c.blueprints + ' blueprints</div></div></button>'; }).join('') +
      '<p class="pd-help">' + PD.plan.count('desks') + ' of ' + (isFinite(PD.plan.info().desks) ? PD.plan.info().desks : 'unlimited') + ' desks used.</p></div>' +
      '<div><div class="pd-card pad"><div class="pd-field-row"><div class="pd-field"><label class="pd-label">Desk name</label><input class="pd-input" data-f="desk-name" value="' + esc(d.name) + '"></div>' +
      '<div class="pd-field"><label class="pd-label">Switch to this desk on</label><input class="pd-input" data-f="desk-urls" value="' + esc((d.urlPatterns || []).join(', ')) + '" placeholder="web.whatsapp.com, mail.google.com"></div></div>' +
      '<label class="pd-check' + '"><input type="checkbox" data-f="desk-shared"' + (d.shared ? ' checked' : '') + (canManage() ? '' : ' disabled') + '> Share this desk with the team' + (canManage() ? '' : ' (Owner / Admin only)') + '</label></div>' +
      '<div class="block"><div class="page-h" style="margin-bottom:8px"><h2 style="font-size:14px">Snippets</h2><button class="pd-btn pd-btn--sm" data-act="new-snippet">' + I('plus', 13) + ' Add snippet</button></div><div class="pd-card pd-table-wrap">' +
      (snips.length ? '<table class="pd-table"><thead><tr><th>Title</th><th>Shortcut</th><th>Category</th><th>Used</th><th></th></tr></thead><tbody>' + snips.map((s) => '<tr><td><b>' + esc(s.title) + '</b> ' + (s.favorite ? I('star', 12) : '') + (s.shared ? ' ' + badge('Shared') : '') + '<div class="pd-muted pd-sm">' + esc(U.clip(U.oneLine(s.body), 80)) + '</div></td><td>' + esc(s.shortcut || '\u2014') + '</td><td>' + esc(s.category || '') + '</td><td>' + (s.uses || 0) + '</td><td style="text-align:right"><button class="pd-btn pd-btn--sm" data-act="edit-snippet" data-id="' + s.id + '">Edit</button></td></tr>').join('') + '</tbody></table>' : empty('No snippets on this desk', 'Save the replies you type every day.')) + '</div></div>' +
      '<div class="block"><h2>Blueprints</h2><div class="pd-card">' + (bps.length ? bps.map((b) => '<div class="line"><div class="pd-row__icon">' + I(b.kind === 'capture' ? 'target' : 'form', 15) + '</div><div class="grow"><div class="t">' + esc(b.name) + (b.shared ? ' ' + badge('Shared') : '') + '</div><div class="s">' + (b.kind === 'capture' ? 'Capture' : 'Paste') + ' \u00b7 ' + esc(b.host) + ' \u00b7 ' + b.fields.length + ' fields: ' + esc(b.fields.map((f) => f.label).join(', ')) + '</div></div><button class="pd-btn pd-btn--ghost pd-btn--sm pd-btn--danger" data-act="del-bp" data-id="' + b.id + '">Delete</button></div>').join('') : empty('No blueprints yet', 'Blueprints are taught inside the extension: open a client page and click Create Blueprint.')) + '</div></div>' +
      '<div class="block"><button class="pd-btn pd-btn--danger pd-btn--sm" data-act="del-desk" data-id="' + d.id + '">' + I('trash', 13) + ' Delete this desk</button></div></div></div>';
  }

  /* ---------------------------------------------------------------- Clipboard history */
  function history() {
    const q = S.histQ.trim().toLowerCase();
    const list = db.get('history').filter((h) => !q || ((h.text || h.name || '') + ' ' + (h.host || '')).toLowerCase().indexOf(q) >= 0).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt - a.createdAt).slice(0, 200);
    return head('Clipboard history', 'Text, links and images copied in your browser. Stored on this device only. Password fields are never recorded.', '<input class="pd-input" data-f="hist-q" placeholder="Search history" value="' + esc(S.histQ) + '" aria-label="Search history"><button class="pd-btn pd-btn--danger" data-act="clear-hist">Clear history</button>') +
      '<div class="pd-card">' + (list.length ? list.map((h) => '<div class="line"><div class="pd-row__icon"' + (h.type === 'image' ? ' data-blob="' + h.id + '" style="width:40px;height:40px;overflow:hidden"' : '') + '>' + (h.type === 'image' ? '' : I(h.type === 'link' ? 'link' : h.type === 'file' ? 'file' : 'text', 15)) + '</div><div class="grow"><div class="clipx">' + esc(h.type === 'image' || h.type === 'file' ? (h.name || h.type) : h.text) + '</div><div class="s">' + esc(h.host || 'unknown site') + ' \u00b7 ' + U.fmtAgo(h.createdAt) + (h.pinned ? ' \u00b7 pinned' : '') + '</div></div>' +
        (h.text ? '<button class="pd-btn pd-btn--sm" data-act="copy-hist" data-id="' + h.id + '">' + I('copy', 12) + ' Copy</button>' : '') + '<button class="pd-btn pd-btn--sm" data-act="pin-hist" data-id="' + h.id + '">' + (h.pinned ? 'Unpin' : 'Pin') + '</button><button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="del-hist" data-id="' + h.id + '" aria-label="Delete">' + I('trash', 14) + '</button></div>').join('') : empty(q ? 'No matches' : 'Nothing copied yet', 'Text you copy on web pages will appear here once the extension is installed.')) + '</div>';
  }

  /* ---------------------------------------------------------------- Analytics */
  function barChart(vals, labels, hi) {
    const W = 640, H = 210, pl = 34, pb = 26, pt = 10, step = (W - pl) / vals.length, bw = Math.min(54, step - 16), max = Math.max(1, Math.max.apply(null, vals));
    let g = '';
    [0, 0.5, 1].forEach((f) => { const y = pt + (H - pt - pb) * (1 - f); g += '<line x1="' + pl + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#E5E7EB"/><text x="' + (pl - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + Math.round(max * f) + '</text>'; });
    vals.forEach((v, i) => { const h = (H - pt - pb) * v / max, x = pl + i * step + (step - bw) / 2, y = H - pb - h; g += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(h, v ? 2 : 0) + '" rx="4" fill="' + (i === hi ? '#111827' : '#C7CBD1') + '"/><text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + labels[i] + '</text>'; });
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Minutes saved per day, last 7 days">' + g + '</svg>';
  }
  function analytics() {
    const t = PD.analytics.today(), w = PD.analytics.weekly();
    const labels = w.days.map((d) => new Date(d.day + 'T12:00:00').toLocaleDateString([], { weekday: 'short' }));
    const has = w.days.some((d) => d.savedSec > 0);
    return head('Analytics', 'Tracked on this device. Time saved is an estimate.') +
      '<div class="grid3"><div class="pd-card stat"><div class="stat__l">Snippets used</div><div class="stat__v">' + t.snippets + '</div><div class="stat__s">Today</div></div><div class="pd-card stat"><div class="stat__l">Forms autofilled</div><div class="stat__v">' + t.autofills + '</div><div class="stat__s">Fields, today</div></div><div class="pd-card stat"><div class="stat__l">Estimated time saved</div><div class="stat__v">' + U.fmtDuration(t.savedSec) + '</div><div class="stat__s">Today</div></div></div>' +
      '<div class="block"><h2>Minutes saved, last 7 days</h2><div class="pd-card pad">' + (has ? barChart(w.days.map((d) => Math.round(d.savedSec / 60)), labels, 6) : empty('No usage yet', 'Use a snippet or fill a form and it will show up here.')) + '</div></div>' +
      '<div class="block"><h2>This week</h2><div class="grid3">' +
      '<div class="pd-card stat"><div class="stat__l">Most used desk</div><div class="stat__v" style="font-size:20px">' + (w.desk ? esc(w.desk.name) : '\u2014') + '</div><div class="stat__s">' + (w.desk ? w.desk.count + ' actions' : 'No data') + '</div></div>' +
      '<div class="pd-card stat"><div class="stat__l">Most used snippet</div><div class="stat__v" style="font-size:20px">' + (w.snippet ? esc(w.snippet.name) : '\u2014') + '</div><div class="stat__s">' + (w.snippet ? w.snippet.count + ' uses' : 'No data') + '</div></div>' +
      '<div class="pd-card stat"><div class="stat__l">Most used website</div><div class="stat__v" style="font-size:20px">' + (w.site ? esc(w.site.key) : '\u2014') + '</div><div class="stat__s">' + (w.site ? w.site.count + ' actions' : 'No data') + '</div></div></div></div>' +
      '<div class="block"><h2>Time saved this week: ' + U.fmtDuration(w.savedSec) + '</h2></div>';
  }

  /* ---------------------------------------------------------------- Team & Devices (real backend) */
  function team() {
    if (!ACC) return head('Team & Devices') + backendBanner();
    const pending = ACC.devices.filter((d) => d.status === 'pending');
    const roster = ACC.devices.filter((d) => d.status !== 'pending');
    const mng = canManage();
    const included = ACC.includedDevices, activeCount = ACC.devices.filter((d) => d.status === 'active').length;
    const row = (d) => {
      const owner = d.role === 'owner', isMe = d.id === ACC.you.deviceId;
      return '<tr><td><b>' + esc(d.name) + '</b> ' + (isMe ? badge('You', 'dark') : '') + (d.extra ? badge('+$2.50/mo seat') : '') + '<div class="pd-muted pd-sm">' + esc(d.email) + '</div></td><td>' + esc(owner ? 'Owner' : d.role === 'admin' ? 'Admin' : 'Member') + '</td>' +
        '<td>' + badge(d.status === 'active' ? 'Active' : d.status === 'revoked' ? 'Revoked' : d.status, d.status === 'active' ? 'ok' : 'danger') + '</td>' +
        '<td>' + (owner ? badge('Always on', 'dark') : mng ? '<label class="pd-switch"><input type="checkbox" data-act="toggle-analytics" data-id="' + d.id + '"' + (d.analyticsAccess ? ' checked' : '') + '><span></span></label>' : (d.analyticsAccess ? 'On' : 'Off')) + '</td>' +
        '<td style="text-align:right;white-space:nowrap">' + (mng && !owner ? (d.status === 'revoked' ? '<button class="pd-btn pd-btn--sm" data-act="restore-member" data-id="' + d.id + '">Restore</button> ' : '<button class="pd-btn pd-btn--sm" data-act="revoke-member" data-id="' + d.id + '">Revoke</button> ') + '<button class="pd-btn pd-btn--sm pd-btn--danger" data-act="remove-member" data-id="' + d.id + '">Remove</button>' : '') + '</td></tr>';
    };
    return head('Team & Devices', 'Every additional device/user signs in with their own email under your account. New requests wait here until you approve them.') + backendBanner() +
      (mng ? '' : lockNote()) +
      '<div class="banner"><span>' + activeCount + ' of ' + (isFinite(included) ? included : 'unlimited') + ' included seats used' + (isFinite(included) && activeCount > included ? ' \u2014 extra seats are $2.50/user/month' : '') + '. Share your account email (<b>' + esc(ACC.email) + '</b>) with teammates and point them to <b>Request access</b> on the login page.' + '</span></div>' +
      (pending.length ? '<div class="block" style="margin-top:0"><h2>Pending requests (' + pending.length + ')</h2><div class="pd-card">' + pending.map((d) => '<div class="line"><div class="grow"><div class="t">' + esc(d.name) + '</div><div class="s">' + esc(d.email) + ' asked for access' + (d.extra ? ' \u00b7 beyond your included seats ($2.50/mo)' : '') + '</div></div>' + (mng ? '<button class="pd-btn pd-btn--primary pd-btn--sm" data-act="approve-member" data-id="' + d.id + '">Approve</button><button class="pd-btn pd-btn--sm" data-act="reject-member" data-id="' + d.id + '">Reject</button>' : '') + '</div>').join('') + '</div></div>' : '') +
      '<div class="block"><h2>Members</h2><div class="pd-card pd-table-wrap"><table class="pd-table"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Analytics access</th><th></th></tr></thead><tbody>' + roster.map(row).join('') + '</tbody></table></div></div>' +
      '<div class="block"><h2>About analytics access</h2><div class="pd-card pad pd-sm pd-muted">Only the account owner sees the Analytics page by default. Turn on \u201cAnalytics access\u201d for a member above to let them see it too.</div></div>';
  }

  /* ---------------------------------------------------------------- Company */
  function company() {
    const c = db.get('company'), mng = canManage(), dis = mng ? '' : ' disabled';
    const imgs = db.get('files').filter((f) => f.shared && f.mime && f.mime.indexOf('image/') === 0);
    const chk = (ns, label, items, name) => '<div class="block"><h2>' + label + '</h2><div class="pd-card checklist">' + (items.length ? items.map((x) => '<label><input type="checkbox" data-share="' + ns + '" data-id="' + x.id + '"' + (x.shared ? ' checked' : '') + dis + '>' + esc(name(x)) + '<span class="s">' + (x.shared ? 'Shared with team' : 'Private') + '</span></label>').join('') : '<div class="pd-empty">Nothing here yet.</div>') + '</div></div>';
    return head('Company', 'Details everyone on your team inherits. Use them in snippets as {{company.name}}, {{company.address}}, {{company.maps}}, {{company.whatsapp}} and {{company.email}}.') + lockNote() +
      '<div class="pd-card pad"><div style="display:flex;gap:16px;align-items:center;margin-bottom:16px"><div class="logo-prev"' + (c.logoId ? ' data-blob="' + c.logoId + '"' : '') + '>' + (c.logoId ? '' : I('image', 22)) + '</div><div><div class="pd-label" style="margin-bottom:6px">Company logo</div><button class="pd-btn pd-btn--sm" data-act="pick-logo"' + dis + '>' + (c.logoId ? 'Replace logo' : 'Upload logo') + '</button>' + (c.logoId ? ' <button class="pd-btn pd-btn--sm pd-btn--ghost" data-act="rm-logo"' + dis + '>Remove</button>' : '') + '<input type="file" id="logoIn" accept="image/*" hidden></div></div>' +
      '<div class="pd-field-row"><div class="pd-field"><label class="pd-label">Company name</label><input class="pd-input" data-f="co" data-k="name" value="' + esc(c.name) + '"' + dis + '></div><div class="pd-field"><label class="pd-label">Email</label><input class="pd-input" type="email" data-f="co" data-k="email" value="' + esc(c.email) + '"' + dis + '></div></div>' +
      '<div class="pd-field"><label class="pd-label">Office address</label><input class="pd-input" data-f="co" data-k="address" value="' + esc(c.address) + '"' + dis + '></div>' +
      '<div class="pd-field-row"><div class="pd-field"><label class="pd-label">Google Maps link</label><input class="pd-input" data-f="co" data-k="mapsLink" value="' + esc(c.mapsLink) + '"' + dis + '></div><div class="pd-field"><label class="pd-label">WhatsApp number</label><input class="pd-input" data-f="co" data-k="whatsapp" value="' + esc(c.whatsapp) + '"' + dis + '></div></div></div>' +
      '<div class="block"><h2>Standard values</h2><p class="pd-help" style="margin:-4px 0 10px">Facts that don\u2019t change per candidate \u2014 salary, location, working hours. Snippets use these as <code>{{standard.salary}}</code> etc. instead of session data, since the person you\u2019re replying to isn\u2019t necessarily the one in your active session.</p>' +
      '<div class="pd-card pad">' + (db.get('settings').standardFields || PD.STANDARD_DEFAULTS).map((f, i) => '<div class="pd-field-row" style="margin-bottom:8px"><input class="pd-input" data-std-label="' + i + '" value="' + esc(f.label) + '" placeholder="Label"' + dis + '><input class="pd-input" data-std-value="' + i + '" value="' + esc(f.value) + '" placeholder="Value"' + dis + '></div>').join('') + (mng ? '<button class="pd-btn pd-btn--sm" data-act="add-standard">+ Add value</button>' : '') + '</div></div>' +
      '<div class="block"><div class="page-h" style="margin-bottom:8px"><h2 style="font-size:14px">Shared images</h2><button class="pd-btn pd-btn--sm" data-act="pick-img"' + dis + '>' + I('plus', 13) + ' Add image</button><input type="file" id="imgIn" accept="image/*" multiple hidden></div>' +
      (imgs.length ? '<div class="thumbs">' + imgs.map((f) => '<div class="thumb" data-blob="' + f.id + '">' + esc(f.name) + (mng ? '<button class="pd-btn pd-btn--icon pd-btn--sm" data-act="rm-img" data-id="' + f.id + '" aria-label="Remove image">' + I('x', 12) + '</button>' : '') + '</div>').join('') + '</div>' : '<div class="pd-card">' + empty('No shared images', 'Add your logo, office photo or location image. They show up in every teammate\u2019s file shelf.') + '</div>') + '</div>' +
      chk('snippets', 'Shared snippets', db.get('snippets'), (x) => x.title) + chk('desks', 'Shared desks', db.get('desks'), (x) => x.name) + chk('blueprints', 'Shared blueprints', db.get('blueprints'), (x) => x.name + ' \u00b7 ' + x.host);
  }

  /* ---------------------------------------------------------------- Tasks */
  function tasks() {
    const all = db.get('tasks'), open = all.filter((t) => !t.done).sort((a, b) => (PD.tasks.effectiveDue(a) || 9e15) - (PD.tasks.effectiveDue(b) || 9e15)), done = all.filter((t) => t.done).slice(-8).reverse();
    const line = (t) => { const due = PD.tasks.effectiveDue(t), late = !t.done && due && due < Date.now(); return '<div class="line"><button class="pd-btn pd-btn--icon pd-btn--sm" data-act="toggle-task" data-id="' + t.id + '" aria-label="Toggle done">' + (t.done ? I('check', 14) : '') + '</button><div class="grow"><div class="t"' + (t.done ? ' style="text-decoration:line-through;color:var(--pd-faint)"' : '') + '>' + esc(t.title) + '</div><div class="s"' + (late ? ' style="color:var(--pd-danger)"' : '') + '>' + (due ? U.fmtDue(due) : 'No due time') + (t.recurrence ? ' \u00b7 repeats ' + t.recurrence : '') + '</div></div><button class="pd-btn pd-btn--ghost pd-btn--icon pd-btn--sm" data-act="del-task" data-id="' + t.id + '" aria-label="Delete">' + I('trash', 14) + '</button></div>'; };
    return head('Tasks', 'Reminders that reach you as Chrome notifications. Type them the way you would say them.') +
      '<div class="pd-card pad"><input class="pd-input" id="taskIn" placeholder="Call medical tomorrow 9am" aria-label="New task"><div class="pd-help" id="tprev">Try: \u201cSend visa documents Monday 2pm\u201d, \u201cStandup every weekday 9am\u201d, \u201cin 30 minutes check email\u201d.</div></div>' +
      '<div class="block"><h2>Open (' + open.length + ')</h2><div class="pd-card">' + (open.length ? open.map(line).join('') : empty('All clear', 'Nothing left to do.')) + '</div></div>' + (done.length ? '<div class="block"><h2>Done</h2><div class="pd-card">' + done.map(line).join('') + '</div></div>' : '');
  }

  /* ---------------------------------------------------------------- Settings */
  function settings() {
    const s = db.get('settings'), plan = PD.plan.id();
    const usage = (k) => PD.plan.count(k) + (isFinite(PD.plan.info()[k]) ? ' of ' + PD.plan.info()[k] : '');
    return head('Settings') +
      '<div class="pd-card"><div class="line"><div class="grow"><div class="t">Account</div><div class="s">' + esc(ACC ? ACC.email : session.accountEmail) + (ACC ? ' \u00b7 signed in as ' + esc(ACC.you.name) + ' (' + (ACC.you.role === 'owner' ? 'owner' : 'member') + ')' : '') + '</div></div><button class="pd-btn pd-btn--sm" data-act="signout">Log out</button></div>' +
      (ACC ? '<div class="line"><div class="grow"><div class="t">Billing plan</div><div class="s">' + esc(PD.PLANS[ACC.plan].label) + (ACC.trial ? ' \u00b7 14-day trial' : '') + ' \u00b7 card payments in USD only \u00b7 processor not connected yet</div></div></div>' : '') +
      '</div>' +
      '<div class="block"><h2>This browser\u2019s local plan limits (for testing)</h2><div class="pd-card"><div class="line"><div class="grow"><div class="s">This does <b>not</b> change your real billing plan above \u2014 it only changes what this local copy of PasteBoard lets you try, so every limit can be tested while building.</div></div>' +
      (PD.flags.get('devPlanSwitcher') ? '<select class="pd-select" data-f="plan" style="width:170px">' + Object.keys(PD.PLANS).map((k) => '<option value="' + k + '"' + (k === plan ? ' selected' : '') + '>' + PD.PLANS[k].label + '</option>').join('') + '</select>' : '') + '</div>' +
      '<div class="line"><div class="grow"><div class="t">Data location</div><div class="s">' + (bridged ? 'Your extension\u2019s local storage, through the PasteBoard bridge.' : 'This browser\u2019s local storage.') + ' Cloud sync is ' + (PD.flags.get('cloudSync') ? 'on' : 'off') + '.</div></div></div></div>' +
      '<div class="block"><h2>Feature flags</h2><div class="pd-card">' + Object.keys(PD.FLAGS).map((k) => '<div class="line"><div class="grow"><code style="font-family:var(--pd-mono);font-size:12px">' + k + '</code></div><label class="pd-switch"><input type="checkbox" data-f="flag" data-k="' + k + '"' + (PD.flags.get(k) ? ' checked' : '') + '><span></span></label></div>').join('') + '</div></div>' +
      '<div class="block"><h2>Your data</h2><div class="pd-card"><div class="line"><div class="grow"><div class="t">Export</div><div class="s">Download a JSON backup of desks, snippets, sessions, tasks and settings \u2014 the way Premium moves local data between devices.</div></div><button class="pd-btn pd-btn--sm" data-act="export">Export</button></div>' +
      '<div class="line"><div class="grow"><div class="t">Import</div><div class="s">Restore a backup. Replaces matching data.</div></div><button class="pd-btn pd-btn--sm" data-act="import">Import</button><input type="file" id="impIn" accept="application/json" hidden></div>' +
      '<div class="line"><div class="grow"><div class="t">Reset</div><div class="s">Delete everything on this device and start from the sample setup.</div></div><button class="pd-btn pd-btn--sm pd-btn--danger" data-act="reset">Reset data</button></div></div></div>';
  }

  /* ---------------------------------------------------------------- events */
  const guard = (fn) => { try { return fn(); } catch (e) { fail(e); } };
  content.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.f === 'hist-q') { S.histQ = t.value; const pos = t.selectionStart; render(); const n = content.querySelector('[data-f="hist-q"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
    else if (t.id === 'taskIn') { const p = t.value.trim() ? PD.tasks.parse(t.value) : null; document.getElementById('tprev').textContent = p ? '\u2192 ' + p.title + ' \u00b7 ' + (p.dueAt ? U.fmtDue(p.dueAt) : 'no due time') + (p.recurrence ? ' \u00b7 repeats ' + p.recurrence : '') : ''; }
  });
  content.addEventListener('keydown', (e) => {
    if (e.target.id === 'taskIn' && e.key === 'Enter' && e.target.value.trim()) guard(() => { const t = PD.tasks.create(e.target.value.trim()); toast('Added: ' + t.title); render(); const n = document.getElementById('taskIn'); if (n) n.focus(); });
  });
  content.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.stdLabel !== undefined || t.dataset.stdValue !== undefined) {
      if (!canManage()) { fail(new Error('Only the account owner or an admin can change standard values.')); render(); return; }
      const i = +(t.dataset.stdLabel !== undefined ? t.dataset.stdLabel : t.dataset.stdValue);
      const list = (db.get('settings').standardFields || PD.STANDARD_DEFAULTS).slice();
      const row = Object.assign({}, list[i]);
      if (t.dataset.stdLabel !== undefined) row.label = t.value.trim() || row.label; else row.value = t.value;
      list[i] = row; db.patch('settings', { standardFields: list }); toast('Saved'); return;
    }
    const f = t.dataset.f;
    guard(() => {
      if (f === 'desk-name' && t.value.trim()) { PD.desks.update(S.deskId, { name: t.value.trim() }); render(); }
      else if (f === 'desk-urls') { PD.desks.update(S.deskId, { urlPatterns: t.value.split(',').map((x) => x.trim()).filter(Boolean) }); toast('Saved'); }
      else if (f === 'desk-shared') { if (!canManage()) throw new Error('Only the Owner or an Admin can share desks.'); PD.desks.update(S.deskId, { shared: t.checked }); toast('Saved'); }
      else if (f === 'co') { if (!canManage()) throw new Error('Only the Owner or an Admin can edit company details.'); db.patch('company', { [t.dataset.k]: t.value.trim() }); toast('Saved'); }
      else if (f === 'plan') { PD.plan.set(t.value); render(); toast('Local plan limits changed to ' + PD.PLANS[t.value].label); }
      else if (f === 'flag') { const flags = Object.assign({}, db.get('settings').flags); flags[t.dataset.k] = t.checked; db.patch('settings', { flags }); toast('Saved'); }
      else if (t.dataset.share) { if (!canManage()) throw new Error('Only the Owner or an Admin can share resources.'); db.upsert(t.dataset.share, { id: t.dataset.id, shared: t.checked }); render(); }
    });
    if (t.dataset.act === 'toggle-analytics') { try { await PBApi.teamUpdate({ action: 'setAnalyticsAccess', deviceId: t.dataset.id, value: t.checked }); await loadAccount(); render(); toast('Saved'); } catch (err) { fail(err); render(); } }
    if (t.id === 'logoIn' && t.files[0]) { try { if (!canManage()) throw new Error('Only the Owner or an Admin can change the logo.'); await PD.blobs.put('company_logo', await U.readAsDataUrl(t.files[0])); PD.company.save({ logoId: 'company_logo' }); render(); } catch (err) { fail(err); } }
    if (t.id === 'imgIn') { try { if (!canManage()) throw new Error('Only the Owner or an Admin can share images.'); for (const file of t.files) { const rec = await PD.files.add(file, { kind: 'static' }); db.upsert('files', { id: rec.id, shared: true }); } render(); toast('Image shared'); } catch (err) { fail(err); } }
    if (t.id === 'impIn' && t.files[0]) { try { await db.importAll(JSON.parse(await t.files[0].text())); render(); toast('Backup imported'); } catch (err) { fail(err); } }
  });

  content.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.dataset.id, a = b.dataset.act;
    try { await act(a, id, b); } catch (err) { fail(err); }
  });
  document.getElementById('top').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && b.dataset.act === 'signout') act('signout'); });

  async function act(a, id) {
    switch (a) {
      case 'signout': PBApi.signOut(); location.href = '../login/index.html?switch=1'; break;
      case 'new-desk': { const n = await PD.ui.prompt('New desk', 'Desk name', '', { placeholder: 'Visa Desk', confirmLabel: 'Create desk' }); if (n) { S.deskId = PD.desks.create(n).id; render(); } break; }
      case 'pick-desk': S.deskId = id; render(); break;
      case 'del-desk': if (await PD.ui.confirm('Delete this desk and its blueprints? Its snippets move to \u201cAll desks\u201d.', { danger: true, confirmLabel: 'Delete desk' })) { PD.desks.remove(id); S.deskId = null; render(); } break;
      case 'new-snippet': PD.ui.snippetEditor({ deskId: S.deskId, onSaved: render }); break;
      case 'edit-snippet': PD.ui.snippetEditor({ id, onSaved: render }); break;
      case 'del-bp': if (await PD.ui.confirm('Delete this blueprint?', { danger: true, confirmLabel: 'Delete' })) { PD.blueprints.remove(id); render(); } break;
      case 'copy-hist': { const h = db.find('history', id); try { await navigator.clipboard.writeText(h.text); toast('Copied'); } catch (err) { toast('Could not copy.', 'error'); } break; }
      case 'pin-hist': PD.history.pin(id); render(); break;
      case 'del-hist': PD.history.remove(id); render(); break;
      case 'clear-hist': if (await PD.ui.confirm('Clear clipboard history? Pinned items are kept.', { danger: true, confirmLabel: 'Clear history' })) { PD.history.clear(true); render(); } break;
      case 'add-standard': { const list = (db.get('settings').standardFields || PD.STANDARD_DEFAULTS).concat([{ key: 'field' + Date.now(), label: 'New value', value: '' }]); db.patch('settings', { standardFields: list }); render(); break; }
      case 'approve-member': await PBApi.deviceApprove(id); await loadAccount(); render(); toast('Approved'); break;
      case 'reject-member': if (await PD.ui.confirm('Reject this request?', { danger: true, confirmLabel: 'Reject' })) { await PBApi.deviceReject(id); await loadAccount(); render(); } break;
      case 'revoke-member': if (await PD.ui.confirm('Revoke access? They will no longer be able to log in.', { confirmLabel: 'Revoke access' })) { await PBApi.teamUpdate({ action: 'revoke', deviceId: id }); await loadAccount(); render(); } break;
      case 'restore-member': await PBApi.teamUpdate({ action: 'restore', deviceId: id }); await loadAccount(); render(); break;
      case 'remove-member': if (await PD.ui.confirm('Remove this person from the team? This can\u2019t be undone.', { danger: true, confirmLabel: 'Remove' })) { await PBApi.teamUpdate({ action: 'remove', deviceId: id }); await loadAccount(); render(); } break;
      case 'pick-logo': document.getElementById('logoIn').click(); break;
      case 'rm-logo': PD.blobs.del('company_logo'); PD.company.save({ logoId: null }); render(); break;
      case 'pick-img': document.getElementById('imgIn').click(); break;
      case 'rm-img': await PD.files.remove(id); render(); break;
      case 'toggle-task': { const t = db.find('tasks', id); if (t.done) PD.tasks.reopen(id); else PD.tasks.complete(id); render(); break; }
      case 'del-task': PD.tasks.remove(id); render(); break;
      case 'export': U.download('pasteboard-backup-' + U.dayKey() + '.json', JSON.stringify(db.exportAll(), null, 2)); break;
      case 'import': document.getElementById('impIn').click(); break;
      case 'reset': if (await PD.ui.confirm('Delete all local PasteBoard data on this device and start again? (Your account and team on the server are unaffected.)', { danger: true, confirmLabel: 'Delete everything', title: 'Reset local data' })) { await db.resetAll(); render(); toast('Reset complete'); } break;
    }
  }

  db.on((ns, source) => { if (source === 'remote' && !content.contains(document.activeElement)) render(); });
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
  setInterval(() => { PD.sessions.sweep(); }, 60000);
  render();
})();
