# PasteBoard

**Your Browser's Second Memory.** A Chrome extension (Manifest V3), a marketing/login/dashboard website, and a small
real backend (Netlify Functions + Netlify Blobs) for accounts, team/device approval and platform-wide admin stats.

Product code (website, extension, shared): HTML, CSS, vanilla JavaScript. No React, no TypeScript, no npm, no build step.
Backend code (`netlify/functions/`): plain Node, no auth-library dependency (Node's built-in `crypto` handles password
hashing and session tokens); `@netlify/blobs` is the one real dependency, used as the data store in production.

```text
pasteboard/
├── website/      landing/, login/, signup/, dashboard/, admin/, assets/   (Netlify publishes this folder)
├── extension/    popup/, sidepanel/, content/, background/, options/, assets/   (Chrome loads this folder)
├── shared/       ui/ (design system + storage + domain logic), branding/, icons/   <- edit here
├── netlify/functions/   the real backend: signup, login, device requests/approval, account, team-update,
│                        track-interest, admin-stats, plus _lib/ (crypto, store, http helpers)
├── tools/        sync-shared.sh / .bat   (plain copy of shared/ into website/ and extension/)
└── docs/         README, roadmap, architecture, storage-schema
```

## Run it

### Extension
1. Open `chrome://extensions`, switch on **Developer mode**.
2. **Load unpacked** and choose the `extension/` folder.
3. Press **Ctrl+Shift+Space** on any web page (Command+Shift+Space on Mac). Or click the toolbar icon.

The dev build starts on the **Premium** plan (see `PD.CONFIG.defaultPlan` in `shared/ui/pd-core.js`) so every local
feature can be tried before wiring up a real account. Change it in extension **Settings > This browser's local plan
limits**, or set `defaultPlan: 'free'` before launch. This is separate from — and does not affect — the real
account plan that comes from signing in (see below).

### Website + backend
The site and its backend now need `netlify dev` (or a real Netlify deploy) rather than opening HTML files directly,
because Landing → Install → **Sign up / Log in** now hits real functions:

```sh
npm install -g netlify-cli   # once
cd pasteboard
netlify dev                  # serves website/ + netlify/functions/ together, usually on http://localhost:8888
```

Then:
- `http://localhost:8888/landing/index.html` — the landing page, four real pricing tiers
- `http://localhost:8888/signup/index.html` — create an owner account, or request access to an existing one
- `http://localhost:8888/login/index.html` — email + password (the only auth method right now — see below)
- `http://localhost:8888/dashboard/index.html` — Home / Desks / Clipboard / Analytics / Team & Devices / Company / Tasks / Settings
- `http://localhost:8888/admin/index.html` — founder-only aggregate stats, gated by `PASTEBOARD_ADMIN_TOKEN` (see below)
- `http://localhost:8888/pricing/index.html`, `/terms/index.html`, `/privacy/index.html`, `/refunds/index.html` — standalone legal/pricing pages (needed for payment-provider review, e.g. Paddle). `_redirects` also maps the clean paths `/pricing`, `/terms`, `/privacy`, `/refunds` on a real Netlify deploy. These are templates, not legal advice — have them reviewed before relying on them.

Desks, snippets, sessions, blueprints, files, clipboard history and tasks are still local-first — the same
`chrome.storage.local` (through the extension) or `localStorage` (this browser) data as before. Only **accounts,
plan/trial, and the team/device roster** are real, server-side data now (see docs/architecture.md).

If you just open `website/*.html` straight from disk or a plain static file server, Landing/Desks/Company/Tasks/etc.
still work fine on local data, but Signup/Login/Dashboard's Team & Devices/Admin will show a clear "couldn't reach
the backend" error instead of failing silently — there's no server behind a plain `python3 -m http.server`.

### Environment variables (set these in Netlify, or a local `.env` for `netlify dev`)
| Variable | Purpose |
| --- | --- |
| `PASTEBOARD_SECRET` | Signs session tokens (HMAC). **Set a real random value before going live** — the code falls back to an insecure dev default and logs a warning if it's missing. |
| `PASTEBOARD_ADMIN_TOKEN` | Required for the founder admin panel (`/admin`). No default — `admin-stats` refuses every request until this is set. |
| `PASTEBOARD_LOCAL_DIR` | Optional. Where the local JSON-file fallback store writes when `@netlify/blobs` has no deploy context (plain `node`, or `netlify dev` without blobs configured). Defaults to `/tmp/pasteboard-data`. Never used once deployed on Netlify with Blobs available. |

### Deploy
Push the repo to Git and connect it to Netlify. `netlify.toml` already publishes `website/` with no build command and
points `functions` at `netlify/functions/`. Netlify installs `netlify/functions/package.json`'s one dependency
(`@netlify/blobs`) automatically — nothing to run by hand.

### After editing `shared/`
Run `tools/sync-shared.sh` (or `tools\sync-shared.bat` on Windows). It copies `shared/` into `website/assets/shared`
and `extension/assets/shared`, because each of those folders is deployed on its own.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Command bar | Ctrl+Shift+Space (Mac: Command+Shift+Space) |
| Quick add task | **Alt+Shift+T** (see note) |
| In the command bar | Up / Down, Enter to run, Esc to close, Tab switches to "new task" |

**Note:** Chrome reserves Ctrl+Shift+T ("reopen closed tab") and does not let extensions bind it. Quick Add uses
Alt+Shift+T instead. Users can remap both at `chrome://extensions/shortcuts`.

## The account journey
1. **Landing page** — the main CTA is **Install extension**. There's no published Chrome Web Store listing yet, so
   it currently scrolls to manual "Load unpacked" steps; set `CHROME_STORE_URL` in `website/landing/index.html`'s
   inline script once it's published and every "Install extension" link switches to the real store page automatically.
2. **Install** the unpacked extension (or, later, from the Web Store).
3. **Activate the account** — either from the landing page's install steps, the extension's first-run Settings page
   (shown automatically on install), or the popup's menu: **Create account** (owner) or **Log in** (returning user,
   or someone joining an existing team via **Request access**).
4. Returning, already-installed users who get logged out on the *website* just log in again — the extension itself
   never needed the account token for its local features, so nothing about the extension changes.

Social login (Google, etc.) is intentionally left out for now — planned once real API keys (Supabase) are wired
in; the Google button was removed rather than shown disabled, to avoid promising something that isn't there yet.
Password fields have a Show/Hide toggle on login and signup.

## What works today

| Feature | Status |
| --- | --- |
| Command bar (snippets, files, tasks, desks, sessions, blueprints, leads, commands) | Working |
| Desks + smart context detection by URL, manual pin, "Auto" resume | Working |
| Snippets: search, insert into the active field, copy fallback, `;shortcut` expansion, `{{placeholders}}` | Working |
| Standard values (Settings/Company) for `{{standard.salary}}` etc. — used instead of `{{session.*}}` in personalized replies, since the person you're messaging isn't necessarily the one in the active session | Working |
| Candidate Sessions with 15 min / 30 min / 1 hour / end-of-day expiry and automatic deletion | Working |
| Capture Blueprints: click a value (leaf-precise, not the whole row/container), CSS + XPath fallback, optional image fields (jpg/png) saved to the session's File Shelf | Working (image grab fails gracefully on cross-origin images) |
| Paste Blueprints: preview → fill, radio/checkbox fields left for the person to click themselves, dates written in the target field's own format (not ours) | Working |
| Inline autofill suggestion (Google-password-manager-style chip under a focused field) | Working |
| Leads: paste a candidate's structured WhatsApp/email reply and it's decoded into a permanent (non-expiring) lead list, exportable as tab-separated text (paste straight into Sheets/Excel) or CSV | Working |
| File Shelf, clipboard history | Working |
| Tasks with natural-language quick add, recurring, snooze, Chrome notifications | Working |
| Analytics (local, per-device) | Working |
| **Real accounts**: owner signup, email+password login, request-access-to-a-team flow, owner-only approve/reject, revoke/restore/remove, per-member analytics-access grant | Working (Netlify Functions + Blobs, tested end-to-end — see docs/architecture.md) |
| Dashboard: Home, Desks, Clipboard, Analytics (gated to owner / granted members), Team & Devices, Company, Tasks, Settings | Working |
| Founder admin panel (`/admin`): accounts by plan, active devices, pending requests, trial count, revenue estimate, Premium Pro interest clicks | Working, gated by `PASTEBOARD_ADMIN_TOKEN` |
| Pricing: Free / Free+Email / Premium ($20 one-time, 5 seats, $2.50/extra) / Premium Pro ($40, unlimited seats, cloud sync) with a 14-day trial on paid tiers | Front end + trial bookkeeping working; **no payment processor connected** — nothing is ever actually charged |
| Premium Pro cloud sync | **Paused** — the plan is listed, its CTA logs interest (`track-interest`) instead of completing signup, with a polite "joining soon" message |
| Google / social login | Not implemented (removed rather than faked) — planned once Supabase keys are available |

See [docs/architecture.md](architecture.md), [docs/storage-schema.md](storage-schema.md) and [docs/roadmap.md](roadmap.md).
