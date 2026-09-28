# Storage schema (schema version 1)

> This document covers **local, per-device** data only (the extension's `chrome.storage.local`, or this browser's
> `localStorage` in demo mode). Accounts, plan/trial and the team/device roster are real server-side data now —
> see "Real backend" in [architecture.md](architecture.md) for that schema instead. `pd:team` below is a vestigial
> local-only model still used for backward compatibility in a couple of local sharing checks; the real team roster
> lives on the backend.

Everything lives in `chrome.storage.local` (extension) or `localStorage` (website demo mode) under keys prefixed `pd:`.
The `PD.db` layer reads from an in-memory cache and writes through to the active adapter, so the UI code is synchronous and the storage backend is swappable.

Every array record has: `id`, `createdAt`, `updatedAt`, `rev` (increments on each write). These three fields are what a cloud sync adapter needs; no model has to change to add sync.

| Key | Type | Purpose |
| --- | --- | --- |
| `pd:meta` | object | `schemaVersion`, `installedAt`, `seededAt`, `deviceId` |
| `pd:desks` | array | Desks |
| `pd:snippets` | array | Snippets |
| `pd:sessions` | array | Candidate sessions (temporary) |
| `pd:blueprints` | array | Capture and paste blueprints |
| `pd:tasks` | array | Tasks / reminders |
| `pd:history` | array | Clipboard history entries (metadata + text) |
| `pd:files` | array | File shelf records (metadata only) |
| `pd:company` | object | Company details shared with the team |
| `pd:team` | object | `{ meId, members[] }` |
| `pd:settings` | object | Preferences, active desk, plan, flag overrides |
| `pd:analytics` | object | `{ days: { "YYYY-MM-DD": {...} } }` |
| `pd:devices` | array | Devices (this local install's own device record; unrelated to the backend account roster) |
| `pd:leads` | array | Leads — decoded from a pasted candidate reply, does **not** expire like sessions |
| `pd:outbox` | array | Change log for cloud sync (only written when `cloudSync` is on) |
| `pdb:<id>` | string | Large data (data: URLs) for files and clipboard images. Kept out of the namespaces so content scripts never load them. |

## Records

### desks
```json
{ "id": "desk_recruitment", "name": "Recruitment Desk", "urlPatterns": ["web.whatsapp.com"], "shared": true }
```
`urlPatterns`: host, `*.host`, or `host/path`. Subdomains match. Longest matching pattern wins.

### snippets
```json
{ "id": "snip_salary", "deskId": "desk_recruitment | null", "title": "Salary reply", "body": "Hi, the monthly salary is {{standard.salary}}.",
  "category": "Replies", "favorite": true, "shared": false, "shortcut": ";sal", "uses": 12, "lastUsedAt": 0 }
```
`deskId: null` = available on every desk. `shared: true` = visible on every desk and (later) to the team.
Placeholders: `{{date}}`, `{{time}}`, `{{company.name|address|maps|whatsapp|email}}`, `{{standard.<label>}}`,
`{{session.<field label>}}`. Personalized replies (WhatsApp/email) should use `{{standard.*}}` / `{{company.*}}`,
not `{{session.*}}` — the person you're replying to isn't necessarily the one held in the active session.
`{{session.*}}` stays available (it's what paste blueprints use internally) but the seeded sample snippets no
longer default to it.

### sessions
```json
{ "id": "ses_...", "name": "John Kamau", "deskId": "...", "preset": "15m|30m|1h|eod|none", "expiresAt": 1790000000000,
  "fields": [ { "key": "passportnumber", "label": "Passport Number", "value": "A1234567" } ] }
```
`key` is the label lower-cased with non-alphanumerics removed. Blueprints and sessions match fields by this key. Expired sessions and their session files are deleted by the sweep (service worker every minute, plus whenever a UI opens).

### blueprints
```json
{ "id": "blu_...", "deskId": "...", "kind": "capture | paste", "name": "Immigration portal", "host": "portal.example.com", "pathPrefix": "", "shared": false,
  "fields": [
    { "id": "fld_...", "label": "Passport Number", "key": "passportnumber", "css": "p:nth-of-type(1) > b.pp", "xpath": "/html[1]/body[1]/p[1]/b[1]", "tag": "b" },
    { "id": "fld_...", "label": "Photo", "key": "photo", "css": "img.candidate-photo", "xpath": "...", "tag": "img", "type": "image" },
    { "id": "fld_...", "label": "Marital Status", "key": "maritalstatus", "css": "input[name=ms]", "xpath": "...", "tag": "input", "manual": true }
  ] }
```
No sample values are stored, only locations. Capture blueprints write into a session (or, for `type: "image"`
fields, a session file — a same-origin-only best-effort canvas grab of a photo shown on the page); paste blueprints
read from the active session. A paste field with `manual: true` (a radio/checkbox picked while teaching, e.g.
marital status) is deliberately never auto-filled — the preview highlights it and scrolls to it instead, for the
person to click themselves. Capture also refines the clicked element to the innermost text at the click point
rather than grabbing an entire wrapping row (see `extension/content/blueprint.js`'s `refineCaptureTarget`).

### tasks
```json
{ "id": "tas_...", "title": "Call medical", "dueAt": 1790000000000, "recurrence": "daily|weekdays|weekly|monthly|null",
  "snoozedUntil": null, "done": false, "doneAt": null, "notifiedAt": null, "lastDoneAt": null }
```
Effective due time = `snoozedUntil` if later than `dueAt`, else `dueAt`.

### history
```json
{ "id": "clip_...", "type": "text|link|image|file", "text": "...", "name": "image.png", "size": 1234, "host": "site.com", "pinned": false, "hasBlob": false, "createdAt": 0 }
```
Capped at 200 unpinned entries. Text capped at 5000 characters. Password fields are never recorded.

### files
```json
{ "id": "fil_...", "kind": "static | session", "deskId": null, "sessionId": null, "name": "requirements.pdf", "mime": "application/pdf", "size": 1234, "shared": false, "expiresAt": null }
```
Data lives in `pdb:<id>`. Session files carry the session's `expiresAt` and are deleted with it. Max 5 MB each.

### company
```json
{ "name": "", "logoId": "company_logo | null", "address": "", "mapsLink": "", "whatsapp": "", "email": "" }
```
Shared images are `files` records with `shared: true`.

### team
```json
{ "meId": "usr_me", "members": [ { "id": "usr_me", "name": "You", "email": "", "role": "owner|admin|staff", "status": "active|pending|invited|revoked" } ] }
```

### settings
```json
{ "activeDeskId": "", "activeSessionId": null, "manualPin": false, "autoDetect": true, "clipboardHistory": true, "ignoreHosts": [],
  "notifications": true, "floatingPill": true, "textExpansion": true, "defaultExpiry": "1h", "plan": "free|freeplus|premium|premiumpro",
  "siteUrl": "https://pasteboard.com", "flags": { "cloudSync": false },
  "standardFields": [ { "key": "salary", "label": "Salary figure", "value": "" }, "...(location, workinghours, package by default)" ] }
```
`plan` here is this **local install's own feature-limit preview** (Settings > "This browser's local plan limits"),
kept for testing every limit while building — it is not the real billing plan, which comes from the backend account
(see architecture.md). The legacy id `"pro"` from before the four-tier pricing model still works (`PD.PLAN_ALIASES`
maps it to `"premium"`). `standardFields` are facts that don't change per candidate — used in snippets as
`{{standard.salary}}` etc., editable in extension Settings or the dashboard's Company page.

### leads
```json
{ "id": "lead_...", "name": "Mary Achieng", "deskId": "desk_recruitment | null", "source": "pasted",
  "raw": "Name: Mary Achieng\nPhone: 0722111222\n...",
  "fields": [ { "label": "Name", "value": "Mary Achieng" }, { "label": "Phone", "value": "0722111222" } ] }
```
Created by pasting a candidate's structured reply to a "requirements" WhatsApp/email message (`PD.leads.parseMessage`
splits `Label: value` / `Label - value` lines; unmatched lines are silently skipped — no AI). Unlike sessions, leads
never expire; they're meant to accumulate into a client list. `PD.leads.toSpreadsheetText()` / `.toCsv()` export
them (tab-separated for a direct paste into Google Sheets/Excel, or a CSV file).

### analytics
```json
{ "days": { "2026-09-19": { "snippets": 12, "autofills": 30, "captures": 15, "savedSec": 600,
  "desks": { "deskId": 5 }, "snippetsById": { "snipId": 4 }, "sites": { "web.whatsapp.com": 9 } } } }
```
Kept for 90 days. Time saved = snippets x 20 s + autofilled fields x 6 s + captured fields x 5 s (`PD.TIME_SAVED`).

### devices
```json
{ "id": "dev_...", "name": "Chrome on Windows", "browser": "Chrome (Windows)", "lastActive": 0, "status": "active|pending", "current": true }
```

## Migrations
`meta.schemaVersion` is 1. When a model changes, bump `PD.SCHEMA_VERSION` and add a step in `PD.db.init` that upgrades cached data before the UI reads it.
