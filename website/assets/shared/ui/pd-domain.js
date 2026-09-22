/*
 * PasteDeck domain layer — all business rules live here, on top of PD.db.
 * Both the extension and the website dashboard use these services, so behaviour stays identical.
 */
(function (g) {
  'use strict';
  const PD = (g.PD = g.PD || {});
  const U = PD.util, db = PD.db;

  const limitError = (msg) => { const e = new Error(msg); e.code = 'PLAN_LIMIT'; return e; };

  /* ---------------- URL / host matching ---------------- */
  PD.match = {
    /* Desk-style pattern: "web.whatsapp.com", "*.example.com", "example.com/apply". Subdomains match. */
    url(pattern, url) {
      if (!pattern || !url) return false;
      let u; try { u = new URL(url); } catch (e) { return false; }
      const p = String(pattern).trim().toLowerCase().replace(/^https?:\/\//, '');
      const slash = p.indexOf('/');
      const hp = slash >= 0 ? p.slice(0, slash) : p, pp = slash >= 0 ? p.slice(slash) : '';
      const host = u.hostname.toLowerCase();
      let ok;
      if (hp.indexOf('*.') === 0) { const b = hp.slice(2); ok = host === b || host.endsWith('.' + b); }
      else ok = host === hp || host.endsWith('.' + hp);
      return ok && (!pp || u.pathname.toLowerCase().indexOf(pp) === 0);
    },
    /* Blueprint match: exact host (ignoring www.) + optional path prefix. */
    blueprint(bp, url) {
      let u; try { u = new URL(url); } catch (e) { return false; }
      const strip = (h) => h.toLowerCase().replace(/^www\./, '');
      return strip(u.hostname) === strip(bp.host || '') && (!bp.pathPrefix || u.pathname.indexOf(bp.pathPrefix) === 0);
    },
  };

  /* ---------------- plan & limits ---------------- */
  PD.plan = {
    id() { return db.get('settings').plan || PD.CONFIG.defaultPlan; },
    info() { return PD.PLANS[this.id()] || PD.PLANS.free; },
    can(feature) { return !!this.info()[feature]; },
    count(kind) { return kind === 'sessions' ? PD.sessions.live().length : (db.get(kind) || []).length; },
    canAdd(kind) {
      const limit = this.info()[kind], count = this.count(kind);
      const ok = count < limit;
      const names = { snippets: 'snippets', desks: 'desks', sessions: 'sessions' };
      return { ok, limit, count, message: ok ? '' : 'The ' + this.info().label + ' plan allows ' + limit + ' ' + names[kind] + '. Upgrade to add more.' };
    },
    require(feature, label) {
      if (this.can(feature)) return true;
      throw limitError(label + ' is part of Pro Lifetime.');
    },
    set(id) { if (PD.PLANS[id]) return db.patch('settings', { plan: id }); },
  };

  /* ---------------- desks ---------------- */
  PD.desks = {
    all() { return db.get('desks'); },
    get(id) { return db.get('desks').find((d) => d.id === id) || null; },
    active() { return this.get(db.get('settings').activeDeskId) || db.get('desks')[0] || null; },
    setActive(id, opts) {
      const patch = { activeDeskId: id };
      if (opts && opts.manual) patch.manualPin = true;
      return db.patch('settings', patch);
    },
    resumeAuto() { return db.patch('settings', { manualPin: false }); },
    /* Smart context detection: most specific (longest) matching pattern wins. */
    detect(url) {
      let best = null, bestLen = 0;
      this.all().forEach((d) => (d.urlPatterns || []).forEach((p) => {
        if (PD.match.url(p, url) && p.length > bestLen) { best = d; bestLen = p.length; }
      }));
      return best;
    },
    /* Applies detection unless the user pinned a desk manually. Returns the detected desk (or null). */
    autoSwitch(url) {
      const s = db.get('settings');
      if (!PD.flags.get('contextDetection') || s.autoDetect === false || s.manualPin) return null;
      const d = this.detect(url);
      if (d && d.id !== s.activeDeskId) this.setActive(d.id);
      return d;
    },
    create(name) {
      const c = PD.plan.canAdd('desks'); if (!c.ok) throw limitError(c.message);
      return db.upsert('desks', { name: name || 'New desk', urlPatterns: [], shared: false });
    },
    update(id, patch) { return db.upsert('desks', Object.assign({ id }, patch)); },
    remove(id) {
      if (db.get('desks').length <= 1) throw new Error('Keep at least one desk.');
      db.get('blueprints').filter((b) => b.deskId === id).forEach((b) => db.remove('blueprints', b.id));
      db.get('snippets').filter((s) => s.deskId === id).forEach((s) => db.upsert('snippets', { id: s.id, deskId: null }));
      db.remove('desks', id);
      if (db.get('settings').activeDeskId === id) db.patch('settings', { activeDeskId: db.get('desks')[0].id });
    },
    counts(id) {
      return {
        snippets: db.get('snippets').filter((s) => s.deskId === id).length,
        blueprints: db.get('blueprints').filter((b) => b.deskId === id).length,
      };
    },
  };

  /* ---------------- snippets ---------------- */
  PD.snippets = {
    visible(deskId) { return db.get('snippets').filter((s) => !s.deskId || s.deskId === deskId || s.shared); },
    save(rec) {
      if (!rec.id) { const c = PD.plan.canAdd('snippets'); if (!c.ok) throw limitError(c.message); }
      if (!U.oneLine(rec.title) && !U.oneLine(rec.body)) throw new Error('Add a title or some text.');
      if (rec.shortcut) {
        rec.shortcut = String(rec.shortcut).trim().toLowerCase().replace(/\s+/g, '');
        if (rec.shortcut[0] !== ';') rec.shortcut = ';' + rec.shortcut;
        const clash = db.get('snippets').find((s) => s.shortcut === rec.shortcut && s.id !== rec.id);
        if (clash) throw new Error('Shortcut ' + rec.shortcut + ' is already used by "' + clash.title + '".');
      }
      return db.upsert('snippets', rec);
    },
    remove(id) { return db.remove('snippets', id); },
    byShortcut(sc) { return db.get('snippets').find((s) => s.shortcut && s.shortcut === String(sc).toLowerCase()) || null; },
    /* Replace {{date}}, {{time}}, {{company.*}}, {{session.<field>}} placeholders. Unknown ones stay as-is. */
    render(text) {
      const co = db.get('company') || {}, ses = PD.sessions.active();
      return String(text || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => {
        if (k === 'date') return new Date().toLocaleDateString([], { dateStyle: 'medium' });
        if (k === 'time') return new Date().toLocaleTimeString([], { timeStyle: 'short' });
        if (k.indexOf('company.') === 0) {
          const v = { name: co.name, address: co.address, maps: co.mapsLink, whatsapp: co.whatsapp, email: co.email }[k.slice(8)];
          return v || m;
        }
        if (k.indexOf('session.') === 0) { const v = PD.sessions.value(ses, k.slice(8)); return v ? v : m; }
        return m;
      });
    },
    markUsed(s, host) {
      db.upsert('snippets', { id: s.id, uses: (s.uses || 0) + 1, lastUsedAt: Date.now() });
      PD.analytics.track('snippet', { deskId: (PD.desks.active() || {}).id, snippetId: s.id, host });
    },
  };

  /* ---------------- candidate sessions ---------------- */
  PD.sessions = {
    expiryFor(preset, from) {
      from = from || Date.now();
      if (preset === 'eod') return U.endOfDay(from);
      if (preset === 'none') return null;
      const p = PD.SESSION_PRESETS.find((x) => x.id === preset) || PD.SESSION_PRESETS[2];
      return from + p.ms;
    },
    live() { const n = Date.now(); return db.get('sessions').filter((s) => !s.expiresAt || s.expiresAt > n); },
    /* Deletes expired sessions and their session files. Safe to call often. */
    sweep() {
      const n = Date.now();
      const dead = db.get('sessions').filter((s) => s.expiresAt && s.expiresAt <= n);
      dead.forEach((s) => this._drop(s.id));
      // session files whose session no longer exists
      const ids = new Set(db.get('sessions').map((s) => s.id));
      db.get('files').filter((f) => f.kind === 'session' && !ids.has(f.sessionId)).forEach((f) => { PD.blobs.del(f.id).catch(() => {}); db.remove('files', f.id); });
      if (dead.length && !this.live().find((s) => s.id === db.get('settings').activeSessionId)) db.patch('settings', { activeSessionId: null });
      return dead.length;
    },
    _drop(id) {
      db.get('files').filter((f) => f.sessionId === id).forEach((f) => { PD.blobs.del(f.id).catch(() => {}); db.remove('files', f.id); });
      db.remove('sessions', id);
    },
    active() {
      const live = this.live(), id = db.get('settings').activeSessionId;
      return live.find((s) => s.id === id) || live[live.length - 1] || null;
    },
    setActive(id) { return db.patch('settings', { activeSessionId: id }); },
    create(o) {
      o = o || {};
      const c = PD.plan.canAdd('sessions'); if (!c.ok) throw limitError(c.message);
      const preset = o.preset || db.get('settings').defaultExpiry || '1h';
      const labels = o.labels || PD.SESSION_TEMPLATE;
      const s = db.upsert('sessions', {
        name: U.oneLine(o.name) || 'Untitled candidate',
        deskId: o.deskId || (PD.desks.active() || {}).id || null,
        preset, expiresAt: PD.sessions.expiryFor(preset),
        fields: o.fields || labels.map((l) => ({ key: U.normKey(l), label: l, value: '' })),
      });
      this.setActive(s.id);
      return s;
    },
    value(session, label) {
      if (!session) return '';
      const k = U.normKey(label);
      let f = session.fields.find((x) => x.key === k);
      if (!f) f = session.fields.find((x) => x.key && (x.key.indexOf(k) >= 0 || k.indexOf(x.key) >= 0));
      return f ? f.value : '';
    },
    setField(id, label, value) {
      const s = db.find('sessions', id); if (!s) return null;
      const k = U.normKey(label), fields = s.fields.slice();
      const i = fields.findIndex((f) => f.key === k);
      if (i >= 0) fields[i] = Object.assign({}, fields[i], { value }); else fields.push({ key: k, label, value });
      return db.upsert('sessions', { id, fields });
    },
    removeField(id, key) {
      const s = db.find('sessions', id); if (!s) return null;
      return db.upsert('sessions', { id, fields: s.fields.filter((f) => f.key !== key) });
    },
    rename(id, name) { return db.upsert('sessions', { id, name: U.oneLine(name) || 'Untitled candidate' }); },
    extend(id, preset) { return db.upsert('sessions', { id, preset, expiresAt: this.expiryFor(preset) }); },
    end(id) { this._drop(id); if (db.get('settings').activeSessionId === id) db.patch('settings', { activeSessionId: null }); },
    /* Blueprint capture result -> session. Same name => update, otherwise new session. */
    mergeCaptured(rows, o) {
      o = o || {};
      const nameRow = rows.find((r) => /name/i.test(r.label) && r.value);
      const name = nameRow ? nameRow.value : 'Captured candidate';
      let s = this.live().find((x) => U.normKey(x.name) === U.normKey(name));
      if (!s) s = this.create({ name, deskId: o.deskId, labels: [] });
      let fields = s.fields.slice();
      rows.forEach((r) => {
        const k = U.normKey(r.label), i = fields.findIndex((f) => f.key === k);
        if (i >= 0) fields[i] = Object.assign({}, fields[i], { value: r.value }); else fields.push({ key: k, label: r.label, value: r.value });
      });
      s = db.upsert('sessions', { id: s.id, fields });
      this.setActive(s.id);
      return s;
    },
  };

  /* ---------------- tasks + natural language (mocked, deterministic) ---------------- */
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const WD = '(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
  const MO = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const RE_EVERY_WD = new RegExp('\\b(?:every|each)\\s+' + WD + '\\b', 'i');
  const RE_WD = new RegExp('\\b(?:next\\s+)?' + WD + '\\b', 'i');
  const RE_MD = new RegExp('\\b' + MO + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b', 'i');

  PD.tasks = {
    /* "Call medical tomorrow 9am" -> { title, dueAt, recurrence }. No AI; the `aiParsing` flag is the future hook. */
    parse(text, nowMs) {
      const now = new Date(nowMs || Date.now());
      let s = ' ' + String(text || '').trim() + ' ';
      const take = (re) => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };
      let recurrence = null, date = null, h = null, min = 0, relative = null;

      let m;
      if ((m = take(RE_EVERY_WD))) { recurrence = 'weekly'; date = nextWeekday(now, DAYS.indexOf(m[1].toLowerCase().slice(0, 3)), true); }
      else if ((m = take(/\b(?:every|each)\s+(day|weekday|week|month)\b/i))) recurrence = { day: 'daily', weekday: 'weekdays', week: 'weekly', month: 'monthly' }[m[1].toLowerCase()];
      else if ((m = take(/\b(daily|weekly|monthly)\b/i))) recurrence = m[1].toLowerCase();

      if ((m = take(/\bin\s+(\d+)\s*(min(?:ute)?s?|m|h(?:ou)?rs?|hours?|h|days?|d|weeks?|w)\b/i))) {
        const n = +m[1], u = m[2].toLowerCase()[0];
        relative = new Date(now.getTime() + n * ({ m: 60e3, h: 3600e3, d: 864e5, w: 6048e5 }[u]));
      }
      if (!date && !relative) {
        if ((m = take(/\b(today|tonight)\b/i))) { date = new Date(now); if (/tonight/i.test(m[1])) h = 20; }
        else if ((m = take(/\b(tomorrow|tmrw|tmr)\b/i))) { date = new Date(now.getTime() + 864e5); }
        else if ((m = take(RE_WD))) date = nextWeekday(now, DAYS.indexOf(m[1].toLowerCase().slice(0, 3)), false);
        else if ((m = take(/\b(\d{4})-(\d{2})-(\d{2})\b/))) date = new Date(+m[1], +m[2] - 1, +m[3]);
        else if ((m = take(RE_MD))) {
          date = new Date(now.getFullYear(), MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), +m[2]);
          if (date < startOfDay(now)) date.setFullYear(date.getFullYear() + 1);
        }
      }
      if ((m = take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i))) {
        h = +m[1] % 12; if (/p/i.test(m[3])) h += 12; min = +(m[2] || 0);
      } else if ((m = take(/\b(?:at\s+)(\d{1,2})(?::(\d{2}))?\b/i))) { h = +m[1]; min = +(m[2] || 0); }
      else if ((m = take(/\b([01]?\d|2[0-3]):([0-5]\d)\b/))) { h = +m[1]; min = +m[2]; }
      else if ((m = take(/\b(noon|midday)\b/i))) { h = 12; }
      else if ((m = take(/\b(morning)\b/i))) { h = 9; }
      else if ((m = take(/\b(afternoon)\b/i))) { h = 14; }
      else if ((m = take(/\b(evening)\b/i))) { h = 18; }

      let dueAt = null;
      if (relative) dueAt = relative.getTime();
      else if (date || h != null || recurrence) {
        const d = date ? new Date(date) : new Date(now);
        d.setHours(h != null ? h : 9, h != null ? min : 0, 0, 0);
        if (!date && h != null && d <= now) d.setDate(d.getDate() + 1);
        else if (!date && h == null && d <= now) d.setDate(d.getDate() + 1);
        if (date && d <= now && U.dayKey(d.getTime()) === U.dayKey(now.getTime()) && h == null) d.setTime(now.getTime() + 3600e3);
        if (recurrence === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
        dueAt = d.getTime();
      }
      let title = U.oneLine(s).replace(/^(?:on|at|by|in|to|@)\s+/i, '').replace(/\s+(?:on|at|by|in|@)$/i, '').trim();
      if (!title) title = U.oneLine(text);
      title = title.charAt(0).toUpperCase() + title.slice(1);
      return { title, dueAt, recurrence };
    },
    create(input) {
      const p = typeof input === 'string' ? this.parse(input) : input;
      if (!U.oneLine(p.title)) throw new Error('Give the task a title.');
      return db.upsert('tasks', { title: p.title, dueAt: p.dueAt || null, recurrence: p.recurrence || null, snoozedUntil: null, done: false, notifiedAt: null, deskId: p.deskId || null });
    },
    effectiveDue(t) { return t.snoozedUntil && t.snoozedUntil > (t.dueAt || 0) ? t.snoozedUntil : t.dueAt; },
    nextOccurrence(t) {
      let d = new Date(t.dueAt || Date.now()); const now = Date.now();
      const step = () => {
        if (t.recurrence === 'daily') d.setDate(d.getDate() + 1);
        else if (t.recurrence === 'weekly') d.setDate(d.getDate() + 7);
        else if (t.recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
        else if (t.recurrence === 'weekdays') { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
      };
      do { step(); } while (d.getTime() <= now);
      return d.getTime();
    },
    complete(id) {
      const t = db.find('tasks', id); if (!t) return null;
      if (t.recurrence && t.dueAt) return db.upsert('tasks', { id, dueAt: this.nextOccurrence(t), snoozedUntil: null, notifiedAt: null, lastDoneAt: Date.now() });
      return db.upsert('tasks', { id, done: true, doneAt: Date.now() });
    },
    reopen(id) { return db.upsert('tasks', { id, done: false, doneAt: null }); },
    snooze(id, how) {
      const now = new Date();
      let ts;
      if (how === 'tomorrow') { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); ts = d.getTime(); }
      else ts = Date.now() + Number(how);
      return db.upsert('tasks', { id, snoozedUntil: ts, notifiedAt: null });
    },
    remove(id) { return db.remove('tasks', id); },
    dueNow(now) { now = now || Date.now(); return db.get('tasks').filter((t) => !t.done && this.effectiveDue(t) && this.effectiveDue(t) <= now); },
  };
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function nextWeekday(now, wd, allowToday) {
    const d = new Date(now); let diff = (wd - d.getDay() + 7) % 7;
    if (diff === 0 && !allowToday) diff = 7;
    d.setDate(d.getDate() + diff); return d;
  }

  /* ---------------- blueprints ---------------- */
  PD.blueprints = {
    forDesk(deskId, kind) { return db.get('blueprints').filter((b) => (!deskId || b.deskId === deskId || b.shared) && (!kind || b.kind === kind)); },
    /* Blueprints that apply to the page you are on (same website). */
    forUrl(url, deskId) { return db.get('blueprints').filter((b) => PD.match.blueprint(b, url) && (!deskId || b.deskId === deskId || b.shared)); },
    save(rec) { PD.plan.require('blueprints', 'Blueprints'); return db.upsert('blueprints', rec); },
    remove(id) { return db.remove('blueprints', id); },
  };

  /* ---------------- files ---------------- */
  PD.files = {
    visible(deskId) { return db.get('files').filter((f) => f.kind === 'static' && (!f.deskId || f.deskId === deskId || f.shared)); },
    forSession(sessionId) { return db.get('files').filter((f) => f.kind === 'session' && f.sessionId === sessionId); },
    async add(file, o) {
      PD.plan.require('files', 'The file shelf');
      if (file.size > PD.CONFIG.maxFileBytes) throw new Error(file.name + ' is larger than ' + U.fmtBytes(PD.CONFIG.maxFileBytes) + '.');
      o = o || {};
      const dataUrl = await U.readAsDataUrl(file);
      let expiresAt = null;
      if (o.kind === 'session') {
        const s = db.find('sessions', o.sessionId); if (!s) throw new Error('Start a session first.');
        expiresAt = s.expiresAt;
      }
      const rec = db.upsert('files', { kind: o.kind || 'static', deskId: o.kind === 'session' ? null : (o.deskId || null), sessionId: o.sessionId || null, name: file.name, mime: file.type || 'application/octet-stream', size: file.size, shared: false, expiresAt });
      await PD.blobs.put(rec.id, dataUrl);
      return rec;
    },
    async remove(id) { await PD.blobs.del(id).catch(() => {}); db.remove('files', id); },
  };

  /* ---------------- clipboard history ---------------- */
  PD.history = {
    async add(entry) {
      const s = db.get('settings');
      if (!PD.flags.get('clipboardHistory') || s.clipboardHistory === false) return null;
      if (entry.host && (s.ignoreHosts || []).some((h) => h && (entry.host === h || entry.host.endsWith('.' + h)))) return null;
      const list = db.get('history');
      if (entry.text) {
        entry.text = String(entry.text).slice(0, PD.CONFIG.maxClipTextChars);
        if (list.length && list[0].text === entry.text) return null;
      }
      let dataUrl = entry.dataUrl; delete entry.dataUrl;
      if (entry.type === 'image' && (!PD.flags.get('clipboardImages') || !dataUrl)) return null;
      const rec = Object.assign({ id: U.uid('clip'), createdAt: Date.now(), pinned: false }, entry);
      if (dataUrl) { rec.hasBlob = true; await PD.blobs.put(rec.id, dataUrl); }
      list.unshift(rec);
      // trim: keep pinned, cap the rest
      let unpinned = 0;
      db.set('history', list.filter((h) => {
        if (h.pinned) return true;
        unpinned++;
        if (unpinned <= PD.CONFIG.historyLimit) return true;
        if (h.hasBlob) PD.blobs.del(h.id).catch(() => {});
        return false;
      }));
      return rec;
    },
    pin(id) { const h = db.find('history', id); if (h) db.upsert('history', { id, pinned: !h.pinned }); },
    remove(id) { const h = db.find('history', id); if (h && h.hasBlob) PD.blobs.del(id).catch(() => {}); db.remove('history', id); },
    clear(keepPinned) {
      db.get('history').filter((h) => h.hasBlob && !(keepPinned !== false && h.pinned)).forEach((h) => PD.blobs.del(h.id).catch(() => {}));
      db.set('history', keepPinned === false ? [] : db.get('history').filter((h) => h.pinned));
    },
  };

  /* ---------------- analytics (local only) ---------------- */
  const blankDay = () => ({ snippets: 0, autofills: 0, captures: 0, savedSec: 0, desks: {}, snippetsById: {}, sites: {} });
  PD.analytics = {
    track(kind, o) {
      o = o || {};
      const a = db.get('analytics'); if (!a.days) a.days = {};
      const key = U.dayKey(), d = a.days[key] || (a.days[key] = blankDay());
      const n = o.n || 1;
      if (kind === 'snippet') { d.snippets += n; d.savedSec += n * PD.TIME_SAVED.snippet; if (o.snippetId) d.snippetsById[o.snippetId] = (d.snippetsById[o.snippetId] || 0) + n; }
      else if (kind === 'autofill') { d.autofills += n; d.savedSec += n * PD.TIME_SAVED.autofillField; }
      else if (kind === 'capture') { d.captures += n; d.savedSec += n * PD.TIME_SAVED.captureField; }
      if (o.deskId) d.desks[o.deskId] = (d.desks[o.deskId] || 0) + 1;
      if (o.host) d.sites[o.host] = (d.sites[o.host] || 0) + 1;
      const keep = Object.keys(a.days).sort().slice(-90); const days = {}; keep.forEach((k) => (days[k] = a.days[k]));
      db.set('analytics', Object.assign({}, a, { days }));
    },
    today() { return Object.assign(blankDay(), (db.get('analytics').days || {})[U.dayKey()] || {}); },
    range(n) {
      const out = [], days = db.get('analytics').days || {};
      for (let i = n - 1; i >= 0; i--) { const k = U.dayKey(Date.now() - i * 864e5); out.push(Object.assign(blankDay(), days[k] || {}, { day: k })); }
      return out;
    },
    weekly() {
      const days = this.range(7), sum = (f) => { const m = {}; days.forEach((d) => Object.keys(d[f]).forEach((k) => (m[k] = (m[k] || 0) + d[f][k]))); return m; };
      const top = (m) => { const k = Object.keys(m).sort((a, b) => m[b] - m[a])[0]; return k ? { key: k, count: m[k] } : null; };
      const desk = top(sum('desks')), snip = top(sum('snippetsById')), site = top(sum('sites'));
      return {
        days,
        desk: desk && Object.assign(desk, { name: (PD.desks.get(desk.key) || {}).name || 'Deleted desk' }),
        snippet: snip && Object.assign(snip, { name: (db.find('snippets', snip.key) || {}).title || 'Deleted snippet' }),
        site,
        savedSec: days.reduce((a, d) => a + d.savedSec, 0),
      };
    },
  };

  /* ---------------- devices ---------------- */
  PD.devices = {
    guess() {
      const ua = (g.navigator && navigator.userAgent) || '';
      const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
      const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : (g.navigator && navigator.brave) ? 'Brave' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
      return { os, browser };
    },
    registerCurrent() {
      const meta = db.get('meta'); if (!meta.deviceId) return null;
      const { os, browser } = this.guess();
      const cur = db.find('devices', meta.deviceId);
      if (cur) return db.upsert('devices', { id: cur.id, lastActive: Date.now(), current: true });
      return db.upsert('devices', { id: meta.deviceId, name: browser + ' on ' + os, browser: browser + ' (' + os + ')', lastActive: Date.now(), status: 'active', current: true });
    },
    rename(id, name) { return db.upsert('devices', { id, name }); },
    remove(id) { return db.remove('devices', id); },
    /* Placeholder for the real pairing flow (requires backend + deviceLicensing flag). */
    add(name) { return db.upsert('devices', { name: name || 'New device', browser: 'Pending pairing', lastActive: null, status: 'pending', current: false }); },
  };

  /* ---------------- team & company (UI-only; teamBackend flag reserved) ---------------- */
  PD.team = {
    members() { return db.get('team').members || []; },
    me() { const t = db.get('team'); return (t.members || []).find((m) => m.id === t.meId) || { role: 'staff' }; },
    canManage(role) { role = role || this.me().role; return role === 'owner' || role === 'admin'; },
    _set(id, patch) { const t = db.get('team'); db.set('team', Object.assign({}, t, { members: t.members.map((m) => (m.id === id ? Object.assign({}, m, patch, { updatedAt: Date.now() }) : m)) })); },
    invite(email, role) {
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
      const t = db.get('team');
      if (t.members.some((m) => m.email.toLowerCase() === email.toLowerCase() && m.status !== 'removed')) throw new Error('That person is already on the team.');
      const m = { id: U.uid('usr'), name: email.split('@')[0], email, role: role || 'staff', status: 'invited', createdAt: Date.now(), updatedAt: Date.now(), rev: 1 };
      db.set('team', Object.assign({}, t, { members: t.members.concat(m) })); return m;
    },
    approve(id) { this._set(id, { status: 'active' }); },
    reject(id) { const t = db.get('team'); db.set('team', Object.assign({}, t, { members: t.members.filter((m) => m.id !== id) })); },
    revoke(id) { this._set(id, { status: 'revoked' }); },
    restore(id) { this._set(id, { status: 'active' }); },
    remove(id) { this.reject(id); },
    rename(id, name) { this._set(id, { name }); },
    setRole(id, role) { this._set(id, { role }); },
  };

  PD.company = {
    get() { return db.get('company'); },
    save(patch) { if (!PD.team.canManage()) throw new Error('Only the Owner or an Admin can edit company details.'); return db.patch('company', patch); },
  };

  /* ---------------- unified search (command bar + popup) ---------------- */
  PD.COMMANDS = [
    { id: 'new-task', title: 'New task…', keywords: 'add reminder todo remind' },
    { id: 'new-capture', title: 'Create capture blueprint', keywords: 'teach highlight fields copy details' },
    { id: 'new-paste', title: 'Create paste blueprint', keywords: 'teach map form autofill' },
    { id: 'end-session', title: 'End current session', keywords: 'clear candidate' },
    { id: 'resume-auto', title: 'Resume automatic desk detection', keywords: 'auto context' },
    { id: 'open-dashboard', title: 'Open dashboard', keywords: 'account website' },
    { id: 'devices', title: 'Manage devices', keywords: 'license' },
    { id: 'login', title: 'Log in', keywords: 'account sign in' },
  ];

  function tokScore(t, text, fuzzy) {
    if (!text) return 0;
    const i = text.indexOf(t);
    if (i === 0) return 100;
    if (i > 0) return /[^a-z0-9]/.test(text[i - 1]) ? 80 : 55;
    if (fuzzy && t.length >= 4) { let j = 0; for (let k = 0; k < text.length && j < t.length; k++) if (text[k] === t[j]) j++; if (j === t.length) return 25; }
    return 0;
  }
  function matchScore(tokens, title, body) {
    title = (title || '').toLowerCase(); body = (body || '').toLowerCase();
    let total = 0;
    for (const t of tokens) {
      const s = Math.max(tokScore(t, title, true), tokScore(t, body, false) * 0.5);
      if (s === 0) return 0;
      total += s;
    }
    return total / tokens.length;
  }
  const KIND_ORDER = { snippet: 0, task: 1, file: 2, session: 3, blueprint: 4, desk: 5, clip: 6, command: 7 };

  PD.search = function (query, o) {
    o = o || {};
    const deskId = o.deskId || (PD.desks.active() || {}).id;
    const kinds = o.kinds || ['snippet', 'file', 'task', 'desk', 'session', 'blueprint', 'command'];
    const q = (query || '').trim().toLowerCase(), tokens = q ? q.split(/\s+/) : [];
    const out = [];
    const push = (it, title, body, boost) => {
      const s = tokens.length ? matchScore(tokens, title, body) : 1;
      if (s > 0) { it.score = s + (boost || 0); out.push(it); }
    };
    if (kinds.includes('snippet')) PD.snippets.visible(deskId).forEach((s) => push(
      { kind: 'snippet', id: s.id, title: s.title, sub: U.clip(U.oneLine(s.body), 90), hint: s.shortcut || 'Insert', icon: 'zap', ref: s },
      s.title + ' ' + (s.shortcut || '') + ' ' + (s.category || ''), s.body, (s.favorite ? 8 : 0) + (s.deskId === deskId ? 4 : 0) + Math.min(s.uses || 0, 10) / 2));
    if (kinds.includes('file')) {
      const ses = PD.sessions.active();
      PD.files.visible(deskId).concat(ses ? PD.files.forSession(ses.id) : []).forEach((f) => push(
        { kind: 'file', id: f.id, title: f.name, sub: (f.kind === 'session' ? 'Session file · ' : 'File · ') + U.fmtBytes(f.size), hint: 'Attach', icon: f.mime && f.mime.indexOf('image') === 0 ? 'image' : 'file', ref: f }, f.name, '', f.kind === 'session' ? 3 : 0));
    }
    if (kinds.includes('task')) db.get('tasks').filter((t) => !t.done).forEach((t) => push(
      { kind: 'task', id: t.id, title: t.title, sub: U.fmtDue(PD.tasks.effectiveDue(t)) + (t.recurrence ? ' · repeats ' + t.recurrence : ''), hint: 'Done', icon: 'tasks', ref: t },
      t.title, '', (PD.tasks.effectiveDue(t) && PD.tasks.effectiveDue(t) < Date.now() ? 6 : 0)));
    if (kinds.includes('desk')) PD.desks.all().forEach((d) => push(
      { kind: 'desk', id: d.id, title: d.name, sub: (d.urlPatterns || []).join(', ') || 'Desk', hint: d.id === deskId ? 'Active' : 'Switch', icon: 'layers', ref: d }, d.name + ' desk', (d.urlPatterns || []).join(' ')));
    if (kinds.includes('session')) PD.sessions.live().forEach((s) => push(
      { kind: 'session', id: s.id, title: s.name, sub: 'Session · expires in ' + U.fmtCountdown((s.expiresAt || Date.now()) - Date.now()), hint: 'Use', icon: 'user', ref: s }, s.name + ' session candidate', ''));
    if (kinds.includes('blueprint')) PD.blueprints.forDesk(deskId).forEach((b) => push(
      { kind: 'blueprint', id: b.id, title: (b.kind === 'capture' ? 'Copy details · ' : 'Fill form · ') + b.name, sub: b.host, hint: 'Run', icon: b.kind === 'capture' ? 'target' : 'form', ref: b }, b.name + ' blueprint ' + (b.kind === 'capture' ? 'copy details capture' : 'fill form paste autofill'), b.host));
    if (kinds.includes('clip')) db.get('history').forEach((h) => push(
      { kind: 'clip', id: h.id, title: h.type === 'image' ? 'Image' : U.clip(U.oneLine(h.text || h.name), 90), sub: (h.host || 'clipboard') + ' · ' + U.fmtAgo(h.createdAt), hint: 'Copy', icon: h.type === 'image' ? 'image' : h.type === 'link' ? 'link' : 'clipboard', ref: h }, h.text || h.name || 'image', '', h.pinned ? 5 : 0));
    if (kinds.includes('command')) PD.COMMANDS.forEach((c) => push(
      { kind: 'command', id: c.id, title: c.title, sub: '', hint: 'Run', icon: 'command', ref: c }, c.title, c.keywords, -20));

    out.sort((a, b) => b.score - a.score || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    if (!q) { // idle view: a few of each kind
      const caps = { snippet: 6, task: 3, file: 3, session: 2, blueprint: 3, desk: 4, clip: 6, command: 3 }, seen = {};
      const idle = out.filter((r) => (seen[r.kind] = (seen[r.kind] || 0) + 1) <= caps[r.kind]);
      idle.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.score - a.score);
      return idle.slice(0, o.limit || 16);
    }
    return out.slice(0, o.limit || 30);
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
