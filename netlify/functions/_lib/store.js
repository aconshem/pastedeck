/*
 * Storage layer. ONE place touches Netlify Blobs; every record is its own key (not a whole-collection JSON blob),
 * which fixes the lost-update problem of the old read-modify-write-everything design:
 *
 *   create(key, v)      atomic "only if absent" (Blobs `onlyIfNew`)  -> used for global email uniqueness, idempotency
 *   cas(key, v, etag)   atomic "only if unchanged" (`onlyIfMatch`)    -> used by update() for safe read-modify-write
 *   update(key, fn)     read -> mutate -> cas, retried on conflict
 *
 * Key map (all in the `pasteboard` store):
 *   acct/<ownerEmail>          the account document (members, invitations, entitlements, purchases)
 *   ix/<anyEmail>              email -> { accountEmail, memberId }   (one identity per email, enforced by create())
 *   pk/<credentialId>          passkey credential -> { accountEmail, memberId }
 *   tok/<sha256(token)>        single-use tokens: reset / verify / invite / pair   (only the hash is stored)
 *   chal/<id>                  short-lived WebAuthn challenges
 *   chk/<requestId>            pending checkout (created server-side before redirecting to the provider)
 *   ev/<eventId>               processed webhook events (idempotency)
 *   an/<ownerEmail>            aggregate analytics (counts only)
 *   rl/<key>                   rate-limit counters
 *
 * This is still a key-value store: it gives per-record atomicity, not multi-record transactions. If you outgrow it,
 * replace only this file (see docs/architecture.md, "When to move to PostgreSQL").
 * Without a Netlify deploy context (plain `node`, tests) it falls back to files under PASTEBOARD_LOCAL_DIR.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.PASTEBOARD_LOCAL_DIR || '/tmp/pasteboard-data';
const ANALYTICS_DAYS_KEPT = 90;
let blobsMod = null;
try { blobsMod = require('@netlify/blobs'); } catch (e) { /* not installed — local fallback */ }

let _blob; // undefined = not tried yet, null = unavailable
function blob() {
  if (_blob !== undefined) return _blob;
  try { _blob = blobsMod ? blobsMod.getStore({ name: 'pasteboard', consistency: 'strong' }) : null; } catch (e) { _blob = null; }
  return _blob;
}
const usingBlobs = () => !!blob();

/* ----- local fallback (synchronous fs => atomic within one process, which is all tests need) ----- */
const lp = (key) => path.join(DIR, encodeURIComponent(key) + '.json');
const etagOf = (txt) => crypto.createHash('md5').update(txt).digest('hex');
const local = {
  get(key) { try { const t = fs.readFileSync(lp(key), 'utf8'); return { value: JSON.parse(t), etag: etagOf(t) }; } catch (e) { return null; } },
  put(key, value, mode, etag) {
    fs.mkdirSync(DIR, { recursive: true });
    const t = JSON.stringify(value);
    if (mode === 'new') { try { fs.writeFileSync(lp(key), t, { flag: 'wx' }); return true; } catch (e) { return false; } }
    if (mode === 'match') { const cur = local.get(key); if (!cur || cur.etag !== etag) return false; }
    fs.writeFileSync(lp(key), t); return true;
  },
  del(key) { try { fs.unlinkSync(lp(key)); } catch (e) { /* absent */ } },
  list(prefix) { try { return fs.readdirSync(DIR).map(decodeURIComponent).map((f) => f.replace(/\.json$/, '')).filter((k) => k.indexOf(prefix) === 0); } catch (e) { return []; } },
};

const kv = {
  async get(key) { const r = await kv.getWithEtag(key); return r ? r.value : null; },
  async getWithEtag(key) {
    const b = blob();
    if (!b) return local.get(key);
    const r = await b.getWithMetadata(key, { type: 'json' });
    return r ? { value: r.data, etag: r.etag } : null;
  },
  async create(key, value) {
    const b = blob();
    if (!b) return local.put(key, value, 'new');
    const r = await b.setJSON(key, value, { onlyIfNew: true });
    return !!r.modified;
  },
  async set(key, value) { const b = blob(); if (!b) return local.put(key, value); await b.setJSON(key, value); return true; },
  async cas(key, value, etag) {
    const b = blob();
    if (!b) return local.put(key, value, 'match', etag);
    const r = await b.setJSON(key, value, { onlyIfMatch: etag });
    return !!r.modified;
  },
  async del(key) { const b = blob(); if (!b) return local.del(key); await b.delete(key); },
  async list(prefix) {
    const b = blob();
    if (!b) return local.list(prefix);
    const out = [];
    for await (const page of b.list({ prefix, paginate: true })) (page.blobs || []).forEach((x) => out.push(x.key));
    return out;
  },
  /* Read-modify-write that cannot lose updates: mutate a copy, write only if nobody else wrote in between, retry. */
  async update(key, mutate, tries) {
    for (let i = 0; i < (tries || 8); i++) {
      const cur = await kv.getWithEtag(key);
      if (!cur) return null;
      const draft = JSON.parse(JSON.stringify(cur.value));
      const res = await mutate(draft);
      const next = res === undefined ? draft : res;
      if (next === false) return cur.value; // mutate() decided nothing needs to change
      if (await kv.cas(key, next, cur.etag)) return next;
      await new Promise((r) => setTimeout(r, 15 + Math.random() * 40));
    }
    throw new Error('Could not save because of repeated concurrent changes. Try again.');
  },
  /* Single-use consume: true for exactly one caller. */
  async consume(key) {
    const cur = await kv.getWithEtag(key);
    if (!cur || cur.value.used) return null;
    const used = Object.assign({}, cur.value, { used: true, usedAt: Date.now() });
    return (await kv.cas(key, used, cur.etag)) ? cur.value : null;
  },
};

const lc = (e) => String(e || '').trim().toLowerCase();
const akey = (email) => 'acct/' + lc(email);

module.exports = {
  kv, usingBlobs, lc,
  accounts: {
    get: (email) => kv.get(akey(email)),
    getWithEtag: (email) => kv.getWithEtag(akey(email)),
    create: (account) => kv.create(akey(account.email), account),
    update: (email, mutate) => kv.update(akey(email), mutate),
    async all() { const keys = await kv.list('acct/'); const out = []; for (const k of keys) { const v = await kv.get(k); if (v) out.push(v); } return out; },
  },
  /* email -> identity. create() is the atomic guard that makes one email = one identity across the whole system. */
  emailIndex: {
    get: (email) => kv.get('ix/' + lc(email)),
    claim: (email, rec) => kv.create('ix/' + lc(email), rec),
    set: (email, rec) => kv.set('ix/' + lc(email), rec),
    release: (email) => kv.del('ix/' + lc(email)),
  },
  /* Aggregate counts only, per member, per installation (a person may use several computers; seats are people, not
     installs). Each install overwrites its own day totals, so repeated syncs never double-count. */
  analytics: {
    async get(ownerEmail) { return (await kv.get('an/' + lc(ownerEmail))) || { members: {} }; },
    async setDay(ownerEmail, memberId, installId, day, totals) {
      const key = 'an/' + lc(ownerEmail);
      const apply = (doc) => {
        doc.members = doc.members || {};
        const m = doc.members[memberId] || (doc.members[memberId] = { installs: {} });
        const inst = m.installs[installId] || (m.installs[installId] = { days: {} });
        inst.days[day] = totals; inst.lastSeen = Date.now();
        const keep = Object.keys(inst.days).sort().slice(-ANALYTICS_DAYS_KEPT); const t = {}; keep.forEach((d) => (t[d] = inst.days[d])); inst.days = t;
        return doc;
      };
      if (!(await kv.get(key))) { if (await kv.create(key, apply({ members: {} }))) return; }
      await kv.update(key, apply);
    },
  },
};
