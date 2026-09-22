# PasteDeck

**Your Browser's Second Memory.** A Chrome extension (Manifest V3) plus a small website for marketing, login and account management.

Stack: HTML, CSS, vanilla JavaScript. No React, no TypeScript, no npm, no build step.

```text
pastedeck/
├── website/      landing/, login/, dashboard/, assets/   (Netlify publishes this folder)
├── extension/    popup/, sidepanel/, content/, background/, options/, assets/   (Chrome loads this folder)
├── shared/       ui/ (design system + storage + domain logic), branding/, icons/   <- edit here
├── tools/        sync-shared.sh / .bat   (plain copy of shared/ into website/ and extension/)
└── docs/         README, roadmap, architecture, storage-schema
```

## Run it

### Extension
1. Open `chrome://extensions`, switch on **Developer mode**.
2. **Load unpacked** and choose the `extension/` folder.
3. Press **Ctrl+Shift+Space** on any web page (Command+Shift+Space on Mac). Or click the toolbar icon.

The dev build starts on the **Pro** plan so every feature can be tried. Change it in extension **Settings > Plan**, or set `defaultPlan: 'free'` in `shared/ui/pd-core.js` before launch.

### Website
Everything works by opening the HTML files directly:

- `website/landing/index.html`
- `website/login/index.html` (login is mocked: any email works, nothing is sent)
- `website/dashboard/index.html`

Opened from `file://` the dashboard runs in **demo mode** (sample data in that browser's localStorage).
To see your *real* extension data in the dashboard, serve the site over HTTP on localhost, for example:

```sh
cd website && python3 -m http.server 8080
```

Then open `http://localhost:8080/dashboard/index.html`. The extension's bridge script (`content/bridge.js`) runs on `localhost` and `pastedeck.com` and connects the two. In the extension, set **Settings > Developer > Website address** to `http://localhost:8080` so Log in / Manage devices open your local site.

### Deploy the website
Push the repo to Git and connect it to Netlify. `netlify.toml` already publishes `website/` with no build command.

### After editing `shared/`
Run `tools/sync-shared.sh` (or `tools\sync-shared.bat` on Windows). It copies `shared/` into `website/assets/shared` and `extension/assets/shared`, because each of those folders is deployed on its own.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Command bar | Ctrl+Shift+Space (Mac: Command+Shift+Space) |
| Quick add task | **Alt+Shift+T** (see note) |
| In the command bar | Up / Down, Enter to run, Esc to close, Tab switches to "new task" |

**Note:** Chrome reserves Ctrl+Shift+T ("reopen closed tab") and does not let extensions bind it. Quick Add uses Alt+Shift+T instead. Users can remap both at `chrome://extensions/shortcuts`.

## What works today

| Feature | Status |
| --- | --- |
| Command bar (snippets, files, tasks, desks, sessions, blueprints, commands) | Working |
| Desks + smart context detection by URL, manual pin, "Auto" resume | Working |
| Snippets: search, insert into the active field, copy fallback, `;shortcut` expansion, `{{placeholders}}` | Working |
| Candidate Sessions with 15 min / 30 min / 1 hour / end-of-day expiry and automatic deletion | Working |
| Capture Blueprints (CSS selectors + XPath fallback) -> Copy details into a session | Working |
| Paste Blueprints -> preview -> fill | Working |
| File Shelf (static + session files, attach / copy image / download) | Working (attach is best effort per site) |
| Clipboard history (text, links, pasted images/files, pin, delete, clear, ignore sites, ignores password fields) | Working |
| Tasks with natural-language quick add (mocked parser), recurring, snooze, Chrome notifications | Working |
| Analytics (local): today + weekly, SVG chart | Working |
| Landing, mock login, dashboard (Home, Desks, Clipboard, Analytics, Devices, Team, Company, Tasks, Settings) | Working on local data |
| Team, Company sharing, Devices | UI + local data; no backend (flags `teamBackend`, `deviceLicensing`) |
| Cloud sync, real auth, payments | Scaffolded, off (flags `cloudSync`, `realAuth`, `payments`) |

See [architecture.md](architecture.md), [storage-schema.md](storage-schema.md) and [roadmap.md](roadmap.md).
