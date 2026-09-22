# Storage schema (schema version 1)

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
| `pd:devices` | array | Devices |
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
{ "id": "snip_salary", "deskId": "desk_recruitment | null", "title": "Salary reply", "body": "Hi {{session.Full Name}}, ...",
  "category": "Replies", "favorite": true, "shared": false, "shortcut": ";sal", "uses": 12, "lastUsedAt": 0 }
```
`deskId: null` = available on every desk. `shared: true` = visible on every desk and (later) to the team.
Placeholders: `{{date}}`, `{{time}}`, `{{company.name|address|maps|whatsapp|email}}`, `{{session.<field label>}}`.

### sessions
```json
{ "id": "ses_...", "name": "John Kamau", "deskId": "...", "preset": "15m|30m|1h|eod|none", "expiresAt": 1790000000000,
  "fields": [ { "key": "passportnumber", "label": "Passport Number", "value": "A1234567" } ] }
```
`key` is the label lower-cased with non-alphanumerics removed. Blueprints and sessions match fields by this key. Expired sessions and their session files are deleted by the sweep (service worker every minute, plus whenever a UI opens).

### blueprints
```json
{ "id": "blu_...", "deskId": "...", "kind": "capture | paste", "name": "Immigration portal", "host": "portal.example.com", "pathPrefix": "", "shared": false,
  "fields": [ { "id": "fld_...", "label": "Passport Number", "key": "passportnumber", "css": "p:nth-of-type(1) > b.pp", "xpath": "/html[1]/body[1]/p[1]/b[1]", "tag": "b" } ] }
```
No sample values are stored, only locations. Capture blueprints write into a session; paste blueprints read from the active session.

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
  "notifications": true, "floatingPill": true, "textExpansion": true, "defaultExpiry": "1h", "plan": "free|freeplus|pro",
  "siteUrl": "https://pastedeck.com", "flags": { "cloudSync": false } }
```

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
