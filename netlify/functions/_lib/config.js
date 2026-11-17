/*
 * Central server-side configuration. Everything that varies per deployment comes from environment variables
 * (set them in Netlify -> Site configuration -> Environment variables; see .env.example and docs/payment-setup.md).
 * Nothing in the browser or the extension ever sees a secret from here.
 */
const BASE_URL = String(process.env.PASTEBOARD_BASE_URL || 'https://pastedeck.netlify.app').replace(/\/+$/, '');
let host = 'pastedeck.netlify.app';
try { host = new URL(BASE_URL).hostname; } catch (e) { /* keep default */ }

/* Netlify sets CONTEXT to production | deploy-preview | branch-deploy | dev. Plain `node` (tests) leaves it unset. */
const CONTEXT = process.env.CONTEXT || '';
const IS_DEPLOYED = !!CONTEXT && CONTEXT !== 'dev';

/* The single source of truth for what a plan is. The client copy in shared/ui/pd-core.js is only for display and
   local limit enforcement; the server decides who is entitled to what (see _lib/entitlements.js). */
const PRICING = {
  premiumUSD: 25,          // one-time
  extraSeatUSD: 2.5,       // one-time, per additional person
  includedSeats: 5,        // people (owner included) a Premium purchase covers
  freeSeats: 1,
  trialDays: 14,
  currency: 'USD',
};

const TERMS_VERSION = '2026-11-12';
const INVITE_TTL_MS = 7 * 86400000;
const RESET_TTL_MS = 30 * 60000;
const VERIFY_TTL_MS = 2 * 86400000;
const PAIR_TTL_MS = 120000;
const SESSION_TTL_S = 30 * 86400;

module.exports = {
  BASE_URL, RP_ID: host, IS_DEPLOYED, PRICING, TERMS_VERSION,
  INVITE_TTL_MS, RESET_TTL_MS, VERIFY_TTL_MS, PAIR_TTL_MS, SESSION_TTL_S,
  env: (k, d) => (process.env[k] == null || process.env[k] === '' ? d : process.env[k]),
};
