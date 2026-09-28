# Architecture

One codebase, three surfaces, one shared core.

```text
                       shared/ui  (pd-core, pd-storage, pd-domain, pd-ui, pd.css)
                           │  copied by tools/sync-shared into both deployables
        ┌──────────────────┴───────────────────┐
   extension/                              website/
   ├─ background/service-worker.js         ├─ landing/      static marketing page
   │   alarms, notifications, sweep,       ├─ login/        mock auth (assets/auth.js)
   │   history writes, desk detection,     └─ dashboard/    account control center
   │   commands, context menu                    │
   ├─ content/                                   │  postMessage
   │   content.js     insert, attach, clipboard, │◄─────────────────────────┐
   │                  expansion, floating pill   │                          │
   │   commandbar.js  Ctrl+Shift+Space overlay   │        content/bridge.js (pasteboard.com + localhost only)
   │   blueprint.js   recorder, capture, fill    │
   │   bridge.js      website <-> extension      │
   ├─ popup/ + sidepanel/  (one app: assets/app.js)
   └─ options/
                  chrome.storage.local  (source of truth on the device)
```

## Principles

1. **Local first.** All data lives on the device. The website reads it through a bridge or its own demo store.
2. **Core is shared.** Business rules (limits, expiry, search, task parsing, blueprints) exist once in `shared/ui/pd-domain.js`. UIs only call it.
3. **No build step, no modules — for the product.** Classic scripts attach to `window.PD` (`globalThis.PD`). That is why they load from `file://`, in content scripts and via `importScripts` in the service worker. The one exception is `netlify/functions/`, a genuinely separate backend deploy target with its own `package.json`; it stays dependency-free apart from `@netlify/blobs` (the data store), using Node's built-in `crypto` for password hashing and session tokens.
4. **Cheap on every page.** Content scripts do not load the database until the person uses something. Clipboard captures and page context go through the service worker.
5. **Feature flags + plan gates** decide what is visible. Backend features ship scaffolded and off.

## The `PD` namespace

| Module | Responsibility |
| --- | --- |
| `pd-core.js` | Config, `PD.FLAGS`, `PD.PLANS`, utilities (`PD.util`), icon set |
| `pd-storage.js` | `PD.db` (cache + adapters), `PD.blobs`, `PD.seed` |
| `pd-domain.js` | `PD.plan`, `desks`, `snippets`, `sessions`, `tasks`, `blueprints`, `files`, `history`, `analytics`, `devices`, `team`, `company`, `match`, `search` |
| `pd-ui.js` | Toast, modal, confirm, prompt, menu, snippet editor |

### Storage adapters
`PD.db.init({ adapter })` picks one:

| Adapter | Used by |
| --- | --- |
| `chrome.storage.local` | Extension pages, service worker, content scripts |
| `extension-bridge` | Website when the extension answers a `ping` (dashboard on `pasteboard.com` / `localhost`) |
| `localStorage` | Website demo mode (also `file://`) |
| `memory` | Tests |

An adapter is `{ name, load(keys), save(obj), remove(keys), subscribe(fn) }`.

## Messaging

| From -> To | Message | Purpose |
| --- | --- | --- |
| service worker -> content | `PD_TOGGLE_COMMANDBAR {mode}` | Keyboard commands |
| popup/side panel -> content | `PD_INSERT`, `PD_ATTACH`, `PD_START_RECORDER`, `PD_RUN_BLUEPRINT` | Act on the current page |
| service worker -> content | `PD_TOAST` | Feedback after context-menu save |
| content -> service worker | `PD_HISTORY_ADD` | Clipboard history writes (single writer) |
| content -> service worker | `PD_PAGE_CONTEXT` | Blueprints for this site, pill + expansion settings |
| content -> service worker | `PD_EXPAND {shortcut}` | Text expansion lookup |
| any -> service worker | `PD_OPEN {page}` | Open dashboard / devices / login / pricing on the configured site |
| website <-> bridge | `{pd:'site'|'ext', type:'ping|get|set|remove|changed'}` | Dashboard data access |

## Key flows

**Snippet insert.** Popup or command bar -> `PD.snippets.render()` (placeholders) -> content script `insertText` (contenteditable via `execCommand`, inputs via `setRangeText`) -> on failure copy to clipboard. Never touches password fields.

**Capture -> session -> paste.**
1. *Teach:* recorder highlights elements, stores `{label, css, xpath}` per field (no page data).
2. *Copy details:* `resolve()` tries the CSS selector, then XPath; values go to `PD.sessions.mergeCaptured()` (same name = update, else new session with the default expiry).
3. *Fill form:* paste blueprint labels are matched to session field keys, the person sees a preview with checkboxes, then values are written with the native setter + `input`/`change` events so React/Angular forms notice.

**Sessions expire.** `expiresAt` is stored on the session. The service worker's one-minute alarm and every UI open call `PD.sessions.sweep()`, which deletes expired sessions, their session files and blobs.

**Reminders.** Tasks change -> service worker rebuilds `task:<id>` alarms; a one-minute `pd-tick` alarm is the safety net. Notification buttons: Snooze 10 min / Done. Recurring tasks advance to the next occurrence when completed.

**Smart context.** `tabs.onActivated/onUpdated` -> `PD.desks.autoSwitch(url)` picks the desk with the longest matching pattern unless `settings.manualPin` is true. Picking a desk by hand sets the pin; the header "Auto" button clears it.

## Plugging in the backend later

Nothing below requires changing a data model.

### Cloud sync (`cloudSync`)
- `PD.db._commit` already appends `{ns, id, op, ts}` to `pd:outbox` when the flag is on.
- Write a sync adapter that (1) POSTs the outbox, (2) pulls records with `updatedAt > lastSync`, (3) merges per record by `rev` / `updatedAt`, (4) writes through `PD.db.upsert` with the remote `rev`, (5) trims the outbox. Run it from the service worker on an alarm.
- Files and clipboard images (`pdb:*`) sync separately as blobs.
- Sessions and session files should stay device-only or be encrypted: they hold passports and IDs.

### Auth (`realAuth`)
- Replace the five method bodies in `website/assets/auth.js`. Pages never touch storage directly.
- The extension never renders a login form. "Log in" opens `<siteUrl>/login/index.html?source=extension`. After login, hand the token to the extension via `externally_connectable` (add `pasteboard.com` to the manifest) or the bridge, and store it in `pd:settings.auth`.

### Licensing and devices (`deviceLicensing`, `payments`)
- `PD.plan` reads `settings.plan`. Replace that with a signed license object verified locally, refreshed from the server.
- `PD.devices` already models name / browser / lastActive / status; `add()` is the pairing placeholder.

### Team and company (`teamBackend`)
- `PD.team.canManage()` is the single permission check in the UI. Enforce the same rule on the server. Regular users inherit `shared: true` records.

## Real backend: accounts, teams, admin (Netlify Functions + Blobs)

Everything else in this document is local-first. Accounts are not — signup, login, the team/device roster, trial
state and the founder's aggregate stats live in `netlify/functions/`, backed by Netlify Blobs.

```text
netlify/functions/
├── _lib/
│   ├── crypto.js     scrypt password hashing, HMAC-signed session tokens, id generation — no dependency
│   ├── store.js       JSON-collection store: real Netlify Blobs in production, a /tmp JSON-file fallback
│   │                   for local testing with plain `node` (see readCollection/writeCollection)
│   ├── http.js         ok()/bad()/parseBody()/bearer() response + request helpers shared by every function
│   └── device-decision.js   shared approve/reject logic used by device-approve.js and device-reject.js
├── signup.js          owner signup: creates the account + its first (owner) device/user
├── login.js           matches an email against *any* device on *any* account (each teammate has their own
│                       email+password under the shared account), returns a signed session token
├── device-request.js  request access to an existing account by owner email — sits `pending` until approved
├── device-approve.js / device-reject.js   owner-only decisions on a pending request
├── account.js         GET: the signed-in account's plan/trial/roster, sanitized (no password hashes)
├── team-update.js      owner-only: grant/revoke analytics access, change role, revoke/restore/remove a member
├── track-interest.js   logs a click on the paused Premium Pro CTA — no auth, analytics only
└── admin-stats.js      founder-only aggregate stats across every account, gated by `PASTEBOARD_ADMIN_TOKEN`
```

**Data model** — one JSON object per account, keyed by the owner's email:
```json
{
  "email": "owner@company.com", "plan": "free|freeplus|premium|premiumpro", "createdAt": 0,
  "trial": { "startedAt": 0, "endsAt": 0 } | null,
  "billing": { "cardCollected": false, "chargedAt": null },
  "devices": [
    { "id": "dev_...", "username": "", "name": "", "email": "", "passwordHash": "salt:hash",
      "role": "owner|admin|member", "status": "active|pending|revoked", "analyticsAccess": false,
      "createdAt": 0, "lastLoginAt": 0, "extra": false }
  ]
}
```
A "device" here really means a *person's own login* under the account — matching the brief's "additional
devices/users on the same [account] email" model, where each teammate signs in with their own email/password but
everything is grouped under the owner account. `extra: true` marks a seat beyond the plan's included count (5 for
Premium, unlimited for Premium Pro) — surfaced in the dashboard and counted in admin stats as a $2.50/mo add-on;
nothing is actually billed yet (see Payments below).

**Auth flow.** Session tokens are `base64url(payload).base64url(hmac)` — stateless, 30-day expiry, signed with
`PASTEBOARD_SECRET`. `bearer(event)` reads `Authorization: Bearer <token>`; every owner-only endpoint calls
`verifyToken` then checks `payload.role === 'owner'`. There is no email verification or password reset flow yet —
see roadmap.md.

**Why a device-approval flow instead of open self-signup per seat**: the brief's model is one super-admin (owner)
per paying account, who must approve every additional login. `device-request.js` is intentionally the *only* way
to add a device/user (no direct signup into someone else's account), and `team-update.js` is the *only* way to
change what an approved member can do (role, analytics access, revoke).

**Analytics gating.** The dashboard's Analytics page checks `account().you.role === 'owner' || account().you.analyticsAccess`
before rendering anything — a non-owner without that grant sees a lock message instead of local usage data. This
mirrors the brief's "additional devices/users can't access the analytics dashboard unless access is given by the
super admin."

**Pricing & payments (front end ready, nothing wired to a processor).** Four tiers live in `PD.PLANS`
(`shared/ui/pd-core.js`) mirrored by `netlify/functions/*` seat/price math: Free (4 snippets, 1 desk, 1 seat),
Free+Email (7 snippets, 2 desks), Premium ($20 one-time, all features, 5 seats, $2.50/extra), Premium Pro ($40,
unlimited seats + cloud sync, **paused**). Signing up for a paid tier starts a 14-day trial (`account.trial`) with
everything unlocked; `billing.cardCollected` is just a boolean the signup form sets today — there is no Stripe/etc.
integration, so nothing is ever actually charged. Premium Pro's card is intentionally never taken: its landing-page
CTA calls `track-interest.js` and shows a polite "joining soon" message instead of completing signup, while still
recording the click so `admin-stats.js` can report demand.

**Founder admin panel** (`website/admin/`) is deliberately separate from the customer dashboard: a single admin
token (`PASTEBOARD_ADMIN_TOKEN`, no per-founder accounts) gates `admin-stats.js`, which aggregates every account's
plan, active devices, pending requests, active trials, Premium Pro interest clicks, and a revenue *estimate* (it is
not real payment data, since none exists yet).

**Testing without a Netlify deploy.** Every function was exercised directly with plain `node` (no Netlify CLI): the
JSON-file fallback in `_lib/store.js` stands in for Blobs, and a stubbed `window.fetch` in jsdom drives the actual
website pages against the real handlers end-to-end (signup → pending request → owner approval → login → analytics
gating). `@netlify/blobs` degrades to that same fallback gracefully even when the package is installed but no
deploy context exists — confirmed by loading it directly. What could *not* be tested here is the real Netlify Blobs
runtime itself, or the Chrome Web Store install path.

## Permissions rationale

| Permission | Why |
| --- | --- |
| `storage`, `unlimitedStorage` | Local data, files and images |
| `tabs`, `activeTab`, `scripting` | Read the current URL for desk detection, message the page, inject the content script on tabs opened before install |
| `alarms`, `notifications` | Reminders, session expiry sweep |
| `sidePanel` | Roomy UI, file picking (popups close when a file dialog opens) |
| `contextMenus` | "Save selection as snippet" |
| `clipboardWrite` | Copy fallbacks |
| Content script on `<all_urls>` | Clipboard history, floating pill, text expansion, recorder. This produces Chrome's "read and change all your data on all websites" warning. If that is a problem at review time, drop always-on scripts and inject with `activeTab` only, at the cost of automatic clipboard history and expansion. |
| Bridge on `pasteboard.com` / `localhost` | Dashboard <-> extension data. Remove `localhost` from the manifest before publishing. |

## Security and privacy notes
- Data never leaves the device today. There are no network calls in the extension.
- The clipboard listener ignores password inputs. Insert and fill refuse password, file and hidden inputs.
- Blueprints store locations, not values. Sessions hold the values and expire.
- The bridge only exposes keys starting `pd:` / `pdb:` and only to pages on the allowed origins. Replace it with authenticated sync.
- Session tokens are signed but not encrypted — never put secrets in the token payload. `PASTEBOARD_SECRET` must be a real random value in production (the code warns loudly if it's missing). Passwords are hashed with scrypt + a random salt, never stored or logged in plain text.
- Site-provided strings are always escaped (`PD.util.esc`) before going into `innerHTML`.
