# Architecture

One codebase, three surfaces, one shared core.

```text
                       shared/ui  (pd-core, pd-storage, pd-domain, pd-ui, pd.css)
                           │  copied by tools/sync-shared into both deployables
        ┌──────────────────┴───────────────────┐
   extension/                              website/
   ├─ background/service-worker.js         ├─ landing/      static marketing page
   │   alarms, notifications, sweep,       ├─ login/ signup/ ...  real auth pages (assets/api.js)
   │   history writes, desk detection,     └─ dashboard/    account control center
   │   commands, context menu                    │
   ├─ content/                                   │  postMessage
   │   content.js     insert, attach, clipboard, │◄─────────────────────────┐
   │                  expansion, floating pill   │                          │
   │   commandbar.js  Ctrl+Shift+Space overlay   │        content/bridge.js (pastedeck.netlify.app + localhost only)
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
5. **Feature flags + plan gates** decide what is visible. Plan limits come from the server entitlement; there is no cloud sync.

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
| `extension-bridge` | Website when the extension answers a `ping` (dashboard on `pastedeck.netlify.app` / `localhost`) |
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

## Backend: accounts, teams, billing (Netlify Functions + Blobs)

Local-first still holds: desks, snippets, sessions, blueprints, files and clipboard history **never** leave the device.
The server stores only identity, billing, team membership and aggregate usage counts.

```text
netlify/functions/
  signup login logout forgot-password reset-password change-password verify-email passkey
  pair entitlement account trial-start team-update team-invite invite-accept
  analytics-sync analytics checkout checkout-status payment-webhook refund record-payment
  admin-stats admin-migrate founder-bootstrap
  _lib/ config crypto http store entitlements auth email accounts webauthn
        payment-provider creem purchases admin
```

- **Storage** (`_lib/store.js`): Netlify Blobs, one key per record, with atomic create (`onlyIfNew`) and etag
  compare-and-swap (`kv.update` retry loop). Keys: `acct/<email>`, `ix/<email>` (global email uniqueness),
  `tok/<sha256>` (single-use reset/verify/invite/pair tokens), `ord/<orderId>` (webhook idempotency), `chk/<requestId>`,
  `pk/<credentialId>`, `an/<account>` (aggregate counts). A local JSON file stands in when no Blobs context exists (tests).
- **Plans** are only `free` and `premium` and are computed server-side (`_lib/entitlements.js`): paid Premium, a running
  14-day trial, or Free. Free = 1 desk, 1 snippet, 1 session, 1 seat; Capture and Paste Blueprint off. Premium = unlimited +
  5 seats including the owner, extra seats $2.50 each, all one-time. The extension and website only *display* it;
  client-side limits are advisory.
- **One device per login.** Each login rotates the member's `sid`; `authenticate()` rejects any token whose `sid` differs
  (`401 SIGNED_IN_ELSEWHERE`). Device 1 is signed out when device 2 logs in, and vice versa. Revoke/remove clears `sid`.
- **Password recovery.** `forgot-password` always answers the same way (no account enumeration) and emails a 1-hour
  single-use link; resetting ends every session. Passkeys (WebAuthn, ES256/RS256, own verifier in `_lib/webauthn.js`)
  sign in without a password; a passkey sign-in may set a new password without the old one for 15 minutes.
- **Sign-up** requires accepting the Terms and Privacy Policy (version + time recorded); marketing email is a separate,
  optional, unticked checkbox.
- **Extension link.** Website calls `pair create` -> one-time 2-minute code bound to the current session. The bridge
  passes only that code to the service worker, which exchanges it for an extension token (`typ: ext`). The extension
  refreshes `entitlement` periodically; 401/403 unlinks it; a cached entitlement is good for 7 days offline.
- **Analytics** are opt-in in the extension (off by default), counts only, per install, shown per member.
- **Payments**: see `docs/payment-setup.md`. Hosted Creem checkout; webhook + return-page polling both go through
  `applyPurchase`, idempotent on the order id.
- **Admin**: `X-Admin-Token` header = `PASTEBOARD_ADMIN_TOKEN`; no default.

Account document: `{ email, createdAt, members[], invitations[], purchases[], entitlements: { premium, extraSeats }, trial }`.
Member: `id, name, email, passwordHash (scrypt), role owner|admin|member, status active|revoked|removed, analyticsAccess,
emailVerified, termsAcceptedAt, termsVersion, marketingOptIn, sid, sidMethod, passkeys[], failed{count,until}`.

Run the backend tests with `node tests/backend.test.js`.

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
| Bridge on `pastedeck.netlify.app` / `localhost` | Dashboard <-> extension data. Remove `localhost` from the manifest before publishing. |

## Security and privacy notes
- Data never leaves the device today. There are no network calls in the extension.
- The clipboard listener ignores password inputs. Insert and fill refuse password, file and hidden inputs.
- Blueprints store locations, not values. Sessions hold the values and expire.
- The bridge only exposes keys starting `pd:` / `pdb:` and only to pages on the allowed origins. Replace it with authenticated sync.
- Session tokens are signed but not encrypted — never put secrets in the token payload. `PASTEBOARD_SECRET` must be a real random value in production (the code warns loudly if it's missing). Passwords are hashed with scrypt + a random salt, never stored or logged in plain text.
- Site-provided strings are always escaped (`PD.util.esc`) before going into `innerHTML`.
