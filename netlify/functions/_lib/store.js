/*
 * Thin JSON-collection store. In production (deployed on Netlify) this uses Netlify Blobs, which is the
 * "database" this MVP backend runs on, per the brief ("our data is stored on netlify"). When @netlify/blobs
 * can't get a deploy context (e.g. running these functions with plain `node` for testing, before `netlify dev`
 * is set up) it falls back to JSON files under /tmp so the logic can still be exercised locally.
 *
 * Collections: accounts (keyed by lowercased email), interest (list of paused-plan CTA clicks).
 * Swap this file alone if you later move off Netlify Blobs to a real database — nothing else in netlify/functions
 * touches storage directly.
 */
const fs = require('fs');
const path = require('path');
const DIR = process.env.PASTEBOARD_LOCAL_DIR || '/tmp/pasteboard-data';

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
};
