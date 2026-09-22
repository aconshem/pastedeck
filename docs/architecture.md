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
   │   commandbar.js  Ctrl+Shift+Space overlay   │        content/bridge.js (pastedeck.com + localhost only)
   │   blueprint.js   recorder, capture, fill    │
   │   bridge.js      website <-> extension      │
   ├─ popup/ + sidepanel/  (one app: assets/app.js)
   └─ options/
                  chrome.storage.local  (source of truth on the device)
```

## Principles

1. **Local first.** All data lives on the device. The website reads it through a bridge or its own demo store.
2. **Core is shared.** Business rules (limits, expiry, search, task parsing, blueprints) exist once in `shared/ui/pd-domain.js`. UIs only call it.
3. **No build step, no modules.** Classic scripts attach to `window.PD` (`globalThis.PD`). That is why they load from `file://`, in content scripts and via `importScripts` in the service worker.
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
| `extension-bridge` | Website when the extension answers a `ping` (dashboard on `pastedeck.com` / `localhost`) |
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
- The extension never renders a login form. "Log in" opens `<siteUrl>/login/index.html?source=extension`. After login, hand the token to the extension via `externally_connectable` (add `pastedeck.com` to the manifest) or the bridge, and store it in `pd:settings.auth`.

### Licensing and devices (`deviceLicensing`, `payments`)
- `PD.plan` reads `settings.plan`. Replace that with a signed license object verified locally, refreshed from the server.
- `PD.devices` already models name / browser / lastActive / status; `add()` is the pairing placeholder.

### Team and company (`teamBackend`)
- `PD.team.canManage()` is the single permission check in the UI. Enforce the same rule on the server. Regular users inherit `shared: true` records.

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
| Bridge on `pastedeck.com` / `localhost` | Dashboard <-> extension data. Remove `localhost` from the manifest before publishing. |

## Security and privacy notes
- Data never leaves the device today. There are no network calls in the extension.
- The clipboard listener ignores password inputs. Insert and fill refuse password, file and hidden inputs.
- Blueprints store locations, not values. Sessions hold the values and expire.
- The bridge only exposes keys starting `pd:` / `pdb:` and only to pages on the allowed origins. Replace it with authenticated sync.
- Site-provided strings are always escaped (`PD.util.esc`) before going into `innerHTML`.
