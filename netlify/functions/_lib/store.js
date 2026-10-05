/*
 * Thin JSON-collection store. In production (deployed on Netlify) this uses Netlify Blobs, which is the
 * "database" this MVP backend runs on, per the brief ("our data is stored on netlify"). When @netlify/blobs
 * can't get a deploy context (e.g. running these functions with plain `node` for testing, before `netlify dev`
 * is set up) it falls back to JSON files under /tmp so the logic can still be exercised locally.
 *
 * Collections: accounts (keyed by lowercased email), interest (list of paused-plan CTA clicks),
 * analytics (per-account usage rollups, keyed by lowercased account email), payments (an append-only ledger).
 * Swap this file alone if you later move off Netlify Blobs to a real database — nothing else in netlify/functions
 * touches storage directly.
 */
const fs = require('fs');
const path = require('path');
const DIR = process.env.PASTEBOARD_LOCAL_DIR || '/tmp/pasteboard-data';
const ANALYTICS_DAYS_KEPT = 90;

let blobsMod = null;
try { blobsMod = require('@netlify/blobs'); } catch (e) { /* not installed / not bundled — fine, local fallback below */ }

async function blobStore() {
  if (!blobsMod) return null;
  try { return blobsMod.getStore('pasteboard'); } catch (e) { return null; } // no deploy context yet
}

function localPath(collection) { return path.join(DIR, collection + '.json'); }
function localRead(collection) {
  try { return JSON.parse(fs.readFileSync(localPath(collection), 'utf8')); } catch (e) { return null; }
}
function localWrite(collection, obj) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(localPath(collection), JSON.stringify(obj));
}

/* Each collection is one JSON blob holding a plain object (accounts: {email: account}) or array (interest: []).
   Fine at this scale (an MVP); move to per-key blobs first if the account list grows large. */
async function readCollection(collection, fallback) {
  const store = await blobStore();
  if (store) { const v = await store.get(collection, { type: 'json' }); return v == null ? fallback : v; }
  const v = localRead(collection);
  return v == null ? fallback : v;
}
async function writeCollection(collection, value) {
  const store = await blobStore();
  if (store) return store.setJSON(collection, value);
  return localWrite(collection, value);
}

module.exports = {
  usingBlobs: () => !!blobsMod,
  accounts: {
    all: () => readCollection('accounts', {}),
    get: async (email) => (await readCollection('accounts', {}))[String(email || '').toLowerCase()] || null,
    save: async (account) => {
      const all = await readCollection('accounts', {});
      all[account.email.toLowerCase()] = account;
      await writeCollection('accounts', all);
      return account;
    },
  },
  interest: {
    all: () => readCollection('interest', []),
    add: async (entry) => {
      const all = await readCollection('interest', []);
      all.push(entry);
      await writeCollection('interest', all.slice(-5000)); // cap so the blob doesn't grow forever
      return entry;
    },
  },
  /* One entry per account email: { devices: { <deviceId>: { days: { <YYYY-MM-DD>: {snippets,autofills,captures,savedSec} } } } }.
     Devices push their own day's totals (idempotent overwrite, not additive — see analytics-sync.js); only the
     account owner, or a member the owner has granted analyticsAccess to, can read the aggregate (analytics.js). */
  analytics: {
    all: () => readCollection('analytics', {}),
    get: async (accountEmail) => (await readCollection('analytics', {}))[String(accountEmail || '').toLowerCase()] || { devices: {} },
    setDeviceDay: async (accountEmail, deviceId, day, totals) => {
      const all = await readCollection('analytics', {});
      const key = String(accountEmail || '').toLowerCase();
      const acc = all[key] || (all[key] = { devices: {} });
      const dev = acc.devices[deviceId] || (acc.devices[deviceId] = { days: {} });
      dev.days[day] = totals;
      const keep = Object.keys(dev.days).sort().slice(-ANALYTICS_DAYS_KEPT);
      const trimmed = {}; keep.forEach((d) => (trimmed[d] = dev.days[d]));
      dev.days = trimmed;
      await writeCollection('analytics', all);
      return acc;
    },
  },
  /* Append-only. No processor is connected yet, so this is written to either by hand (admin panel's "record a
     payment" form, for bank transfers etc.) or, later, by a real payment webhook — see docs/architecture.md. */
  payments: {
    all: () => readCollection('payments', []),
    add: async (entry) => {
      const all = await readCollection('payments', []);
      all.push(entry);
      await writeCollection('payments', all);
      return entry;
    },
  },
};
