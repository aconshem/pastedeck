/*
 * PasteDeck storage layer.
 *
 *   PD.db  — synchronous reads from an in-memory cache, async write-through to an adapter.
 *   Adapters: chrome.storage.local (extension) | extension-bridge (website talking to the extension)
 *             | localStorage (website demo mode) | memory (tests)
 *
 * Every record carries { id, createdAt, updatedAt, rev } so a cloud sync adapter can be plugged in
 * later WITHOUT changing data models. When the `cloudSync` flag is on, every write is also appended to `pd:outbox`.
 */
(function (g) {
  'use strict';
  const PD = (g.PD = g.PD || {});
  if (PD.db && PD.db.NAMESPACES) return; // already loaded (e.g. content script injected twice)
  const U = PD.util;

  const NAMESPACES = ['meta', 'desks', 'snippets', 'sessions', 'blueprints', 'tasks', 'history', 'files', 'company', 'team', 'settings', 'analytics', 'devices', 'outbox'];
  const DEFAULTS = () => ({
    meta: {}, desks: [], snippets: [], sessions: [], blueprints: [], tasks: [], history: [], files: [],
    company: {}, team: {}, settings: {}, analytics: { days: {} }, devices: [], outbox: [],
  });
  const K = (ns) => 'pd:' + ns;

  /* ---------------- adapters ---------------- */
  function chromeAdapter() {
    return {
      name: 'chrome.storage.local',
      load: (keys) => chrome.storage.local.get(keys),
      save: (obj) => chrome.storage.local.set(obj),
      remove: (keys) => chrome.storage.local.remove(keys),
      subscribe(fn) {
        chrome.storage.onChanged.addListener((ch, area) => {
          if (area !== 'local') return;
          const o = {};
          for (const k in ch) if (k.indexOf('pd:') === 0) o[k] = ch[k].newValue;
          if (Object.keys(o).length) fn(o);
        });
      },
    };
  }

  function localAdapter() {
    const ls = g.localStorage;
    return {
      name: 'localStorage',
      async load(keys) {
        const o = {};
        keys.forEach((k) => { const v = ls.getItem(k); if (v != null) { try { o[k] = JSON.parse(v); } catch (e) { /* ignore */ } } });
        return o;
      },
      async save(obj) { for (const k in obj) ls.setItem(k, JSON.stringify(obj[k])); },
      async remove(keys) { keys.forEach((k) => ls.removeItem(k)); },
      subscribe(fn) {
        g.addEventListener('storage', (e) => {
          if (e.key && e.key.indexOf('pd:') === 0) { let v = null; try { v = JSON.parse(e.newValue); } catch (x) { /* ignore */ } fn({ [e.key]: v }); }
        });
      },
    };
  }

  function memoryAdapter() {
    const m = {};
    return {
      name: 'memory',
      async load(keys) { const o = {}; keys.forEach((k) => { if (k in m) o[k] = JSON.parse(JSON.stringify(m[k])); }); return o; },
      async save(obj) { for (const k in obj) m[k] = JSON.parse(JSON.stringify(obj[k])); },
      async remove(keys) { keys.forEach((k) => delete m[k]); },
      subscribe() {},
    };
  }

  /* Website <-> extension bridge (content/bridge.js answers these messages on pastedeck.com / localhost). */
  function bridgeAdapter() {
    let seq = 0; const pending = new Map(); const subs = [];
    g.addEventListener('message', (e) => {
      const d = e.data;
      if (e.source !== g || !d || d.pd !== 'ext') return;
      if (d.type === 'result' && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
      else if (d.type === 'changed') subs.forEach((f) => f(d.changes));
    });
    const call = (type, payload) => new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, (r) => (r.error ? rej(new Error(r.error)) : res(r.data)));
      g.postMessage(Object.assign({ pd: 'site', type, id }, payload), g.location.origin);
      setTimeout(() => { if (pending.delete(id)) rej(new Error('Extension bridge timed out')); }, 6000);
    });
    return {
      name: 'extension-bridge',
      load: (keys) => call('get', { keys }),
      save: (obj) => call('set', { obj }),
      remove: (keys) => call('remove', { keys }),
      subscribe: (f) => subs.push(f),
    };
  }

  function detectBridge(timeout) {
    return new Promise((resolve) => {
      if (!g.postMessage || !g.location || !/^https?:$/.test(g.location.protocol)) return resolve(false);
      const done = (v) => { g.removeEventListener('message', on); clearTimeout(t); resolve(v); };
      const on = (e) => { if (e.source === g && e.data && e.data.pd === 'ext' && e.data.type === 'pong') done(true); };
      g.addEventListener('message', on);
      const t = setTimeout(() => done(false), timeout || 500);
      g.postMessage({ pd: 'site', type: 'ping', id: 0 }, g.location.origin);
    });
  }

  async function pickAdapter(pref) {
    if (pref && typeof pref === 'object') return pref;
    if (pref === 'memory') return memoryAdapter();
    if (pref === 'local') return localAdapter();
    const inExtension = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && chrome.runtime && chrome.runtime.id;
    if (inExtension) return chromeAdapter();
    if (pref === 'web' && (await detectBridge(600))) return bridgeAdapter();
    return localAdapter();
  }

  /* ---------------- db ---------------- */
  const listeners = [];
  const db = (PD.db = {
    NAMESPACES, cache: DEFAULTS(), adapter: null, ready: null,

    init(opts) {
      opts = opts || {};
      if (db.ready) return db.ready;
      db.ready = (async () => {
        db.adapter = await pickAdapter(opts.adapter);
        const stored = await db.adapter.load(NAMESPACES.map(K));
        NAMESPACES.forEach((ns) => { const v = stored[K(ns)]; if (v !== undefined && v !== null) db.cache[ns] = v; });
        db.adapter.subscribe((changes) => {
          const changed = [];
          for (const k in changes) {
            const ns = k.slice(3);
            if (NAMESPACES.indexOf(ns) < 0) continue;
            const nv = changes[k] == null ? DEFAULTS()[ns] : changes[k];
            if (JSON.stringify(nv) !== JSON.stringify(db.cache[ns])) { db.cache[ns] = nv; changed.push(ns); }
          }
          changed.forEach((ns) => db._emit(ns, 'remote'));
        });
        if (!db.cache.meta.schemaVersion && opts.seed !== false) await PD.seed(opts.seedOptions);
        return db;
      })();
      return db.ready;
    },

    on(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    _emit(ns, source) { listeners.slice().forEach((f) => { try { f(ns, source); } catch (e) { console.error(e); } }); },
    _persist(ns) { return Promise.resolve(db.adapter && db.adapter.save({ [K(ns)]: db.cache[ns] })).catch((e) => console.error('[PasteDeck] storage write failed', ns, e)); },
    _commit(ns, id, op) {
      const p = db._persist(ns);
      if (ns !== 'outbox' && PD.flags.get('cloudSync')) { db.cache.outbox.push({ ns, id, op, ts: Date.now() }); db._persist('outbox'); }
      db._emit(ns, 'local');
      return p;
    },

    get(ns) { return db.cache[ns]; },
    set(ns, val) { db.cache[ns] = val; return db._commit(ns, null, 'replace'); },
    patch(ns, patch) { db.cache[ns] = Object.assign({}, db.cache[ns], patch); return db._commit(ns, null, 'patch'); },

    find(ns, id) { return db.cache[ns].find((r) => r.id === id) || null; },
    upsert(ns, rec) {
      const arr = db.cache[ns], now = Date.now();
      const i = rec.id ? arr.findIndex((r) => r.id === rec.id) : -1;
      let out;
      if (i < 0) { out = Object.assign({ id: U.uid(ns.slice(0, 3)), createdAt: now }, rec, { updatedAt: now, rev: 1 }); arr.push(out); }
      else { out = Object.assign({}, arr[i], rec, { updatedAt: now, rev: (arr[i].rev || 0) + 1 }); arr[i] = out; }
      db._commit(ns, out.id, 'put');
      return out;
    },
    remove(ns, id) {
      const arr = db.cache[ns], i = arr.findIndex((r) => r.id === id);
      if (i < 0) return false;
      arr.splice(i, 1);
      db._commit(ns, id, 'delete');
      return true;
    },

    exportAll() {
      const data = {}; NAMESPACES.forEach((ns) => { if (ns !== 'outbox') data[ns] = db.cache[ns]; });
      return { app: 'pastedeck', schemaVersion: PD.SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
    },
    async importAll(obj) {
      if (!obj || obj.app !== 'pastedeck' || !obj.data) throw new Error('Not a PasteDeck export file');
      for (const ns of NAMESPACES) { if (ns !== 'outbox' && obj.data[ns] !== undefined) { db.cache[ns] = obj.data[ns]; await db._persist(ns); } }
      NAMESPACES.forEach((ns) => db._emit(ns, 'local'));
    },
    async resetAll() {
      const keys = NAMESPACES.map(K);
      await db.adapter.remove(keys);
      db.cache = DEFAULTS();
      await PD.seed();
      NAMESPACES.forEach((ns) => db._emit(ns, 'local'));
    },
  });

  /* Large payloads (file shelf, clipboard images) live outside the namespaces as `pdb:<id>`
     so content scripts never load megabytes of data on every page. */
  PD.blobs = {
    async put(id, dataUrl) { await db.adapter.save({ ['pdb:' + id]: dataUrl }); },
    async get(id) { const r = await db.adapter.load(['pdb:' + id]); return r['pdb:' + id] || null; },
    async del(id) { await db.adapter.remove(['pdb:' + id]); },
  };

  /* ---------------- seed ---------------- */
  PD.seed = async function (opts) {
    opts = opts || {};
    const now = Date.now();
    const meta = (r) => Object.assign({ createdAt: now, updatedAt: now, rev: 1 }, r);
    const D = { rec: 'desk_recruitment', mail: 'desk_email', visa: 'desk_visa' };

    db.cache.desks = [
      meta({ id: D.rec, name: 'Recruitment Desk', urlPatterns: ['web.whatsapp.com'], shared: true }),
      meta({ id: D.mail, name: 'Email Desk', urlPatterns: ['mail.google.com'], shared: false }),
      meta({ id: D.visa, name: 'Visa Desk', urlPatterns: ['visa.example.com'], shared: false }),
    ];
    db.cache.snippets = [
      meta({ id: 'snip_salary', deskId: D.rec, title: 'Salary reply', category: 'Replies', favorite: true, shared: false, shortcut: ';sal', uses: 0,
        body: 'Hi {{session.Full Name}}, the monthly salary for this position is {{session.Salary}}. Let me know if you would like to proceed.' }),
      meta({ id: 'snip_office', deskId: D.rec, title: 'Office location', category: 'Company', favorite: true, shared: true, shortcut: ';loc', uses: 0,
        body: 'Our office is at {{company.address}}.\nMap: {{company.maps}}' }),
      meta({ id: 'snip_req', deskId: D.rec, title: 'Requirements checklist', category: 'Replies', favorite: false, shared: false, shortcut: ';req', uses: 0,
        body: 'Please send us:\n1. A clear copy of your passport\n2. A passport-size photo\n3. A full-body photo\n4. Your phone number' }),
      meta({ id: 'snip_interview', deskId: D.rec, title: 'Interview invitation', category: 'Replies', favorite: false, shared: false, shortcut: ';int', uses: 0,
        body: 'Hello {{session.Full Name}}, you are invited for an interview at {{company.address}}. Please bring your original passport and ID.' }),
      meta({ id: 'snip_thanks', deskId: null, title: 'Thanks, will follow up', category: 'General', favorite: false, shared: false, shortcut: ';ty', uses: 0,
        body: "Thank you. I'll get back to you shortly." }),
      meta({ id: 'snip_sig', deskId: D.mail, title: 'Email signature', category: 'Email', favorite: false, shared: false, shortcut: ';sig', uses: 0,
        body: 'Kind regards,\n{{company.name}}\n{{company.whatsapp}}' }),
    ];
    db.cache.sessions = [];
    db.cache.blueprints = [];
    db.cache.files = [];
    db.cache.history = [];
    db.cache.tasks = [
      meta({ id: 'task_welcome', title: 'Try the command bar: press Ctrl+Shift+Space on any page', dueAt: null, recurrence: null, snoozedUntil: null, done: false, notifiedAt: null }),
    ];
    db.cache.company = {
      name: 'Your Company Ltd', logoId: null, address: '12 Example Street, Nairobi', mapsLink: 'https://maps.google.com/?q=Nairobi',
      whatsapp: '+254 700 000000', email: 'hello@example.com',
    };
    db.cache.team = {
      meId: 'usr_me',
      members: [
        meta({ id: 'usr_me', name: 'You', email: 'you@example.com', role: 'owner', status: 'active' }),
        meta({ id: 'usr_amina', name: 'Amina Wanjiru', email: 'amina@example.com', role: 'admin', status: 'active' }),
        meta({ id: 'usr_brian', name: 'Brian Otieno', email: 'brian@example.com', role: 'staff', status: 'active' }),
        meta({ id: 'usr_grace', name: 'Grace Njeri', email: 'grace@example.com', role: 'staff', status: 'pending' }),
      ],
    };
    db.cache.settings = {
      activeDeskId: D.rec, activeSessionId: null, manualPin: false, autoDetect: true,
      clipboardHistory: true, ignoreHosts: [], notifications: true, floatingPill: true, textExpansion: true,
      defaultExpiry: '1h', plan: PD.CONFIG.defaultPlan, siteUrl: PD.CONFIG.siteUrl, flags: {},
    };
    db.cache.analytics = { days: {} };
    db.cache.devices = [];
    db.cache.outbox = [];
    db.cache.meta = { schemaVersion: PD.SCHEMA_VERSION, seededAt: now, installedAt: now, deviceId: U.uid('dev') };
    if (opts.demoAnalytics) PD.seedDemoAnalytics(true);
    for (const ns of NAMESPACES) await db._persist(ns);
  };

  /* Sample analytics so charts are not empty in website demo mode / when the founder asks for demo data. */
  PD.seedDemoAnalytics = function (silent) {
    const days = {};
    const deskIds = db.cache.desks.map((d) => d.id);
    const snips = db.cache.snippets.map((s) => s.id);
    const sites = ['web.whatsapp.com', 'mail.google.com', 'visa.example.com', 'docs.google.com'];
    for (let i = 6; i >= 0; i--) {
      const key = U.dayKey(Date.now() - i * 864e5);
      const s = 8 + ((i * 7) % 13), a = (i * 11) % 9 + 2, c = (i * 5) % 6 + 1;
      const d = { snippets: s, autofills: a * 5, captures: c * 5, savedSec: s * PD.TIME_SAVED.snippet + a * 5 * PD.TIME_SAVED.autofillField + c * 5 * PD.TIME_SAVED.captureField, desks: {}, snippetsById: {}, sites: {} };
      deskIds.forEach((id, n) => { d.desks[id] = Math.max(1, Math.round((s + a) / (n + 1.5))); });
      snips.forEach((id, n) => { d.snippetsById[id] = Math.max(0, Math.round(s / (n + 2))); });
      sites.forEach((h, n) => { d.sites[h] = Math.max(1, Math.round((s + a) / (n + 1.7))); });
      days[key] = d;
    }
    db.cache.analytics = { days, demo: true };
    if (!silent) return db.set('analytics', db.cache.analytics);
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
