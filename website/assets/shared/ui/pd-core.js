/*
 * PasteDeck core — config, feature flags, plan limits, utilities, icons.
 * Classic script (no ES modules) so it runs from file://, in extension pages,
 * in content scripts and in the MV3 service worker (importScripts).
 */
(function (g) {
  'use strict';
  const PD = (g.PD = g.PD || {});

  PD.VERSION = '0.1.0';
  PD.SCHEMA_VERSION = 1;

  PD.CONFIG = {
    siteUrl: 'https://pastedeck.com',   // extension setting can override (dev: http://localhost:8080)
    defaultPlan: 'pro',                 // DEV BUILD: everything unlocked. Set to 'free' before public launch.
    historyLimit: 200,
    maxFileBytes: 5 * 1024 * 1024,
    maxClipImageBytes: 1.5 * 1024 * 1024,
    maxClipTextChars: 5000,
    sessionFileNote: 'Session files are deleted when their session expires.',
  };

  /* Feature flags. Backend-dependent features ship scaffolded but OFF. Overridable per user in settings.flags. */
  PD.FLAGS = {
    commandBar: true,
    blueprints: true,
    autofill: true,
    fileShelf: true,
    clipboardHistory: true,
    clipboardImages: true,
    textExpansion: true,
    floatingPill: true,
    contextDetection: true,
    devPlanSwitcher: true,
    // ---- backend-dependent (scaffolded) ----
    cloudSync: false,
    realAuth: false,
    teamBackend: false,
    payments: false,
    deviceLicensing: false,
    aiParsing: false,
  };

  PD.PLANS = {
    free:     { id: 'free',     label: 'Free',         snippets: 5,        desks: 2,        sessions: 2,        files: false, blueprints: false, autofill: false },
    freeplus: { id: 'freeplus', label: 'Free+ Email',  snippets: 10,       desks: 2,        sessions: 2,        files: false, blueprints: false, autofill: false },
    pro:      { id: 'pro',      label: 'Pro Lifetime', snippets: Infinity, desks: Infinity, sessions: Infinity, files: true,  blueprints: true,  autofill: true },
  };

  /* Estimated seconds saved per action (used for the analytics estimate). */
  PD.TIME_SAVED = { snippet: 20, autofillField: 6, captureField: 5 };

  PD.SESSION_TEMPLATE = ['Full Name', 'Passport Number', 'Phone', 'ID Number', 'Nationality', 'Salary', 'Medical Status', 'Date of Birth'];
  PD.SESSION_PRESETS = [
    { id: '15m', label: '15 minutes', ms: 15 * 60000 },
    { id: '30m', label: '30 minutes', ms: 30 * 60000 },
    { id: '1h',  label: '1 hour',     ms: 60 * 60000 },
    { id: 'eod', label: 'End of day', ms: null },
  ];

  /* ---------- utilities ---------- */
  const U = (PD.util = {});
  U.uid = (p) => (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  U.dayKey = (ts) => {
    const d = new Date(ts == null ? Date.now() : ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  U.endOfDay = (ts) => { const d = new Date(ts == null ? Date.now() : ts); d.setHours(23, 59, 59, 999); return d.getTime(); };
  U.hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  U.debounce = (fn, ms) => { let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms); }; };
  U.clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  U.oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  U.fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  U.fmtCountdown = (ms) => {
    if (ms <= 0) return 'expired';
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    if (m > 0) return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
    return s + 's';
  };
  U.fmtDuration = (sec) => {
    sec = Math.round(sec);
    if (sec < 60) return sec + 's';
    const m = Math.round(sec / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  };
  U.fmtDue = (ts) => {
    if (!ts) return 'No due time';
    const d = new Date(ts), n = new Date();
    const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const dk = U.dayKey(ts), tk = U.dayKey(n.getTime()), tm = U.dayKey(n.getTime() + 864e5);
    if (dk === tk) return 'Today ' + t;
    if (dk === tm) return 'Tomorrow ' + t;
    const diff = (d - n) / 864e5;
    if (diff > 0 && diff < 7) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + t;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + t;
  };
  U.fmtAgo = (ts) => {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 172800) return 'yesterday';
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  U.download = (name, text, mime) => {
    const blob = new Blob([text], { type: mime || 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  U.readAsDataUrl = (file) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file);
  });
  U.dataUrlToBlob = (url) => {
    const [head, b64] = String(url).split(',');
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };
  U.isLink = (s) => /^https?:\/\/[^\s]+$/i.test(String(s || '').trim());

  /* ---------- feature flags (reads overrides from settings once the db is ready) ---------- */
  PD.flags = {
    get(name) {
      const o = (PD.db && PD.db.cache && PD.db.cache.settings && PD.db.cache.settings.flags) || {};
      return name in o ? !!o[name] : !!PD.FLAGS[name];
    },
    all() { const r = {}; Object.keys(PD.FLAGS).forEach((k) => (r[k] = this.get(k))); return r; },
  };

  /* ---------- icons (24px stroke set) ---------- */
  const P = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    tasks: '<path d="m9 11 3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3v2H7v-2l3-3z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    chart: '<path d="M3 3v18h18"/><path d="M8 17v-7M13 17V6M18 17v-4"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    paperclip: '<path d="m21 12-9 9a5 5 0 0 1-7-7l9-9a3 3 0 0 1 4 4l-9 9a1 1 0 0 1-2-2l8-8"/>',
    text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
    form: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    command: '<path d="M15 6a3 3 0 1 1 3 3H6a3 3 0 1 1 3-3v12a3 3 0 1 1-3-3h12a3 3 0 1 1-3 3z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    play: '<path d="m6 4 14 8-14 8z"/>',
  };
  PD.icon = (name, size) => {
    size = size || 16;
    return '<svg class="pd-i" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || P.file) + '</svg>';
  };
  PD.iconNames = () => Object.keys(P);
})(typeof globalThis !== 'undefined' ? globalThis : self);
