/*
 * PasteBoard service worker (MV3).
 * Owns: keyboard commands, reminders (alarms + notifications), session expiry sweep, clipboard-history writes,
 * smart desk detection, context menu, and the small message API used by content scripts.
 * Everything else runs in the popup / side panel / content scripts.
 */
importScripts('/assets/shared/ui/pd-core.js', '/assets/shared/ui/pd-storage.js', '/assets/shared/ui/pd-domain.js');

const U = PD.util;
const db = PD.db;
const ready = db.init();
const ICON = chrome.runtime.getURL('assets/shared/icons/icon-128.png');
const CONTENT_FILES = [
  'assets/shared/ui/pd-core.js', 'assets/shared/ui/pd-storage.js', 'assets/shared/ui/pd-domain.js',
  'content/content.js', 'content/commandbar.js', 'content/blueprint.js',
];

/* ------------------------------------------------------------------ lifecycle */
chrome.runtime.onInstalled.addListener(async (details) => {
  await ready;
  PD.devices.registerCurrent();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'pd-save-snippet', title: 'Save selection as PasteBoard snippet', contexts: ['selection'] });
  });
  try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }); } catch (e) { /* older Chrome */ }
  boot();
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#welcome') });
});

chrome.runtime.onStartup.addListener(async () => { await ready; PD.devices.registerCurrent(); boot(); });

function boot() {
  chrome.alarms.create('pd-tick', { periodInMinutes: 1, delayInMinutes: 0.1 });
  chrome.alarms.create('pd-analytics-sync', { periodInMinutes: 5, delayInMinutes: 1 });
  ready.then(syncEntitlement);
  PD.sessions.sweep();
  syncTaskAlarms();
  updateBadge();
}

ready.then(() => {
  // React to task changes made anywhere (popup, side panel, command bar, dashboard bridge).
  db.on((ns) => { if (ns === 'tasks') { syncTaskAlarms(); updateBadge(); } });
});

/* ------------------------------------------------------------------ reminders */
function syncTaskAlarms() {
  chrome.alarms.getAll((all) => {
    (all || []).filter((a) => a.name.indexOf('task:') === 0).forEach((a) => chrome.alarms.clear(a.name));
    const now = Date.now();
    db.get('tasks').forEach((t) => {
      const due = PD.tasks.effectiveDue(t);
      if (!t.done && due && due > now && due < now + 30 * 864e5) chrome.alarms.create('task:' + t.id, { when: due });
    });
  });
}

function updateBadge() {
  const n = PD.tasks.dueNow().length;
  chrome.action.setBadgeBackgroundColor({ color: '#111827' });
  chrome.action.setBadgeText({ text: n ? String(n) : '' });
}

function notifyDue() {
  if (db.get('settings').notifications === false) return;
  PD.tasks.dueNow().forEach((t) => {
    const due = PD.tasks.effectiveDue(t);
    if (t.notifiedAt && t.notifiedAt >= due) return;
    db.upsert('tasks', { id: t.id, notifiedAt: Date.now() });
    if (Date.now() - due > 864e5) return; // long overdue: shown in the UI, no popup
    chrome.notifications.create('task:' + t.id, {
      type: 'basic', iconUrl: ICON, title: 'PasteBoard reminder', message: t.title,
      buttons: [{ title: 'Snooze 10 min' }, { title: 'Done' }], requireInteraction: true, priority: 2,
    });
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  await ready;
  if (alarm.name === 'pd-analytics-sync') return syncAnalytics();
  PD.sessions.sweep();
  notifyDue();
  updateBadge();
});

/* ------------------------------------------------------------------ account link, entitlement, analytics
   Connect account: the person logs in on the website (https://pastedeck.netlify.app/login?source=extension). The page
   asks the server for a ONE-TIME pairing code and hands only that code to this extension (content/bridge.js). We
   exchange it here for our own session token, which lives only in chrome.storage.local ('pd:account') and is never
   exposed to web pages. The server then tells us the plan ("entitlement"); the plan is never read from local settings.
   One session per person: if they log in on another computer the server rejects this session (401) and we unlink. */
const siteBase = () => PD.CONFIG.siteUrl.replace(/\/+$/, '');
const api = (path, token, body) => fetch(siteBase() + '/.netlify/functions/' + path, {
  method: body ? 'POST' : 'GET',
  headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
  body: body ? JSON.stringify(body) : undefined,
});
const REASONS = {
  SIGNED_IN_ELSEWHERE: 'This account signed in on another device, so this one was signed out.',
  ACCESS_REVOKED: 'Your access to this PasteBoard team was revoked by the account owner.',
  ACCESS_REMOVED: 'You were removed from this PasteBoard team.',
  SESSION_INVALID: 'Your PasteBoard sign-in expired. Connect your account again.',
};
async function unlink(reason) {
  await db.set('account', null);
  await db.patch('settings', { unlinkNotice: reason ? { reason, at: Date.now() } : null });
}
function applyEntitlement(acct, e) {
  return Object.assign({}, acct, {
    accountName: e.accountName, accountEmail: e.accountEmail, name: e.member.name, email: e.member.email, role: e.member.role,
    entitlement: { plan: e.plan, source: e.planSource, trialEndsAt: e.trialEndsAt, seatLimit: e.seatLimit, checkedAt: Date.now(), validUntil: Date.now() + (e.validForMs || 7 * 86400000) },
  });
}
async function pair(code, sender) {
  const origin = new URL(siteBase()).origin;
  if (!sender || !sender.url || new URL(sender.url).origin !== origin) throw new Error('Pairing is only accepted from ' + origin + '.');
  const installId = db.get('meta').deviceId;
  const res = await api('pair', null, { action: 'exchange', code, installId });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not connect the account.');
  const acct = applyEntitlement({ token: data.token, linkedAt: Date.now(), analyticsConsent: !!(db.get('account') || {}).analyticsConsent },
    { plan: data.plan, planSource: data.planSource, trialEndsAt: data.trialEndsAt, seatLimit: null, accountName: data.accountName, accountEmail: data.accountEmail, member: { name: data.name, email: data.email, role: data.role } });
  await db.set('account', acct);
  await db.patch('settings', { unlinkNotice: null });
  syncEntitlement();
  return { linked: true, name: data.name };
}
async function syncEntitlement() {
  const acct = db.get('account');
  if (!acct || !acct.token) return;
  try {
    const res = await api('entitlement', acct.token);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) return unlink(REASONS[data.code] || REASONS.SESSION_INVALID);
    if (res.ok) await db.set('account', applyEntitlement(db.get('account') || acct, data));
  } catch (e) { /* offline: keep the last entitlement until its validUntil passes, then PD.plan falls back to Free */ }
}
async function syncAnalytics() {
  await syncEntitlement();
  const acct = db.get('account');
  if (!acct || !acct.token || acct.analyticsConsent !== true) return; // nothing is sent without explicit opt-in
  try {
    const t = PD.analytics.today();
    // Counts only. No text, URLs, names or file data are ever included.
    const res = await api('analytics-sync', acct.token, { consent: true, installId: db.get('meta').deviceId, day: PD.util.dayKey(), snippets: t.snippets, autofills: t.autofills, captures: t.captures, savedSec: t.savedSec });
    if (res.status === 401 || res.status === 403) { const d = await res.json().catch(() => ({})); unlink(REASONS[d.code] || REASONS.SESSION_INVALID); }
  } catch (e) { /* offline */ }
}

chrome.notifications.onButtonClicked.addListener(async (id, idx) => {
  await ready;
  if (id.indexOf('task:') !== 0) return;
  const tid = id.slice(5);
  if (idx === 0) PD.tasks.snooze(tid, 10 * 60000); else PD.tasks.complete(tid);
  chrome.notifications.clear(id);
});
chrome.notifications.onClicked.addListener((id) => chrome.notifications.clear(id));

/* ------------------------------------------------------------------ smart context detection */
async function autoDetect(url) {
  await ready;
  const d = PD.desks.autoSwitch(url);
  const desk = d || PD.desks.active();
  if (desk) chrome.action.setTitle({ title: 'PasteBoard · ' + desk.name });
}
chrome.tabs.onActivated.addListener(async ({ tabId }) => { try { const t = await chrome.tabs.get(tabId); autoDetect(t.url); } catch (e) { /* tab gone */ } });
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.url && tab.active) autoDetect(info.url); });

/* ------------------------------------------------------------------ commands (keyboard shortcuts) */
async function toggleBar(mode) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id == null) return;
  const msg = { type: 'PD_TOGGLE_COMMANDBAR', mode };
  try { await chrome.tabs.sendMessage(tab.id, msg); return; } catch (e) { /* no content script yet */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
    await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    // Restricted page (chrome://, Web Store, PDF viewer...). Fall back to the popup.
    try { await chrome.action.openPopup(); } catch (e2) { /* needs a recent Chrome + user gesture */ }
  }
}
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'open-command-bar') toggleBar('search');
  if (cmd === 'quick-add-task') toggleBar('task');
});

/* ------------------------------------------------------------------ context menu */
function tellTab(tab, text, kind) { if (tab && tab.id != null) chrome.tabs.sendMessage(tab.id, { type: 'PD_TOAST', text, kind }).catch(() => {}); }
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await ready;
  if (info.menuItemId !== 'pd-save-snippet' || !info.selectionText) return;
  try {
    const text = info.selectionText.trim();
    PD.snippets.save({ title: U.clip(U.oneLine(text), 40), body: text, category: 'Saved', favorite: false, shared: false, deskId: (PD.desks.active() || {}).id || null, shortcut: '', uses: 0 });
    tellTab(tab, 'Saved as a snippet');
  } catch (e) { tellTab(tab, e.message, 'error'); }
});

/* ------------------------------------------------------------------ site links (dashboard / login / devices) */
function siteUrl(page) {
  return PD.CONFIG.siteUrl.replace(/\/+$/, '') + ({
    dashboard: '/dashboard/index.html',
    devices: '/dashboard/index.html#team',
    login: '/login/index.html?source=extension',
    signup: '/signup/index.html?source=extension',
    pricing: '/pricing/index.html',
    faq: '/landing/index.html#faq',
  }[page] || '/landing/index.html');
}

/* ------------------------------------------------------------------ message API (content scripts / pages) */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse).catch((e) => sendResponse({ error: String((e && e.message) || e) }));
  return true;
});

async function handle(msg, sender) {
  await ready;
  const tab = sender.tab, url = tab && tab.url;
  switch (msg.type) {
    case 'PD_HISTORY_ADD': {
      const entry = Object.assign({}, msg.entry, { host: U.hostOf(url) });
      await PD.history.add(entry);
      return { ok: true };
    }
    case 'PD_PAGE_CONTEXT': {
      const s = db.get('settings');
      if (tab && tab.active) PD.desks.autoSwitch(url);
      const ses = PD.sessions.active();
      return {
        pill: PD.flags.get('floatingPill') && s.floatingPill !== false,
        expansion: PD.flags.get('textExpansion') && s.textExpansion !== false,
        blueprints: PD.blueprints.forUrl(url).map((b) => ({ id: b.id, kind: b.kind, name: b.name })),
        deskName: (PD.desks.active() || {}).name || '',
        sessionName: ses ? ses.name : '',
      };
    }
    case 'PD_EXPAND': {
      const sn = PD.snippets.byShortcut(msg.shortcut);
      if (!sn) return { text: null };
      PD.snippets.markUsed(sn, U.hostOf(url));
      return { text: PD.snippets.render(sn.body) };
    }
    case 'PD_OPEN': { chrome.tabs.create({ url: siteUrl(msg.page) }); return { ok: true }; }
    case 'PD_SITE_URL': return { url: siteUrl(msg.page) };
    case 'PD_UNLINK': { await unlink(null); return { ok: true }; }
    case 'PD_PAIR': return pair(msg.code, sender);
    case 'PD_LINK_STATUS': { const a = db.get('account'); return a && a.token ? { linked: true, name: a.name, plan: PD.plan.id() } : { linked: false }; }
    case 'PD_SET_CONSENT': { const a = db.get('account'); if (a) await db.set('account', Object.assign({}, a, { analyticsConsent: !!msg.value })); if (msg.value) syncAnalytics(); return { ok: true }; }
    case 'PD_SYNC_NOW': { await syncAnalytics(); return { ok: true }; }
    default: return { error: 'unknown message ' + msg.type };
  }
}
