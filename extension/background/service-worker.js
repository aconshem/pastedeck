/*
 * PasteDeck service worker (MV3).
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
    chrome.contextMenus.create({ id: 'pd-save-snippet', title: 'Save selection as PasteDeck snippet', contexts: ['selection'] });
  });
  try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }); } catch (e) { /* older Chrome */ }
  boot();
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#welcome') });
});

chrome.runtime.onStartup.addListener(async () => { await ready; PD.devices.registerCurrent(); boot(); });

function boot() {
  chrome.alarms.create('pd-tick', { periodInMinutes: 1, delayInMinutes: 0.1 });
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
      type: 'basic', iconUrl: ICON, title: 'PasteDeck reminder', message: t.title,
      buttons: [{ title: 'Snooze 10 min' }, { title: 'Done' }], requireInteraction: true, priority: 2,
    });
  });
}

chrome.alarms.onAlarm.addListener(async () => {
  await ready;
  PD.sessions.sweep();
  notifyDue();
  updateBadge();
});

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
  if (desk) chrome.action.setTitle({ title: 'PasteDeck · ' + desk.name });
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
  const base = String(db.get('settings').siteUrl || PD.CONFIG.siteUrl).replace(/\/+$/, '');
  return base + ({
    dashboard: '/dashboard/index.html',
    devices: '/dashboard/index.html#devices',
    login: '/login/index.html?source=extension',
    pricing: '/landing/index.html#pricing',
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
    default: return { error: 'unknown message ' + msg.type };
  }
}
