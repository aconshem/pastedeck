# Roadmap

## Phase 0 — Foundation (this repo)
Everything that works without a backend. Local-first storage, feature flags, plan limits, mocked auth.

## Phase 1 — Real-world hardening (next)
- Test every site you actually use (WhatsApp Web, Gmail, visa portals, Google Forms). Tune `insertText`, `attachFile` and selectors where a site fights back.
- Blueprint self-repair: when a CSS selector fails and XPath fails, fall back to label-text matching and ask the user to confirm.
- Blueprint import / export (JSON) so a working blueprint can be shared before team sync exists.
- Iframe support (`all_frames`) for portals that embed forms.
- Image copy in clipboard history from "Copy image" context-menu actions (needs the `clipboardRead` permission and an offscreen document).
- Onboarding: first-run checklist in the side panel.

## Phase 2 — Accounts and licensing
Turn on `realAuth`, `deviceLicensing`, `payments`.
- Auth: Google OAuth + email magic link (replace only `website/assets/auth.js`).
- Extension login = open `pastedeck.com/login`, then receive a token through `externally_connectable` messaging or the bridge script.
- Licensing service: plan, device count, signed license blob cached locally so the extension still works offline.
- Payments: Stripe or Paddle checkout for Pro Lifetime; webhook flips the plan.
- Chrome Web Store listing: privacy policy, permission justifications, screenshots, demo GIF.

## Phase 3 — Cloud sync and teams
Turn on `cloudSync`, `teamBackend`.
- Sync adapter (see architecture.md): push the `pd:outbox`, pull changes by `updatedAt`, merge by `rev`.
- Company / team resources served from the backend: shared snippets, desks, blueprints, images.
- Role enforcement server-side (Owner / Admin / Staff). The UI already hides what a role cannot do.
- Encrypted-at-rest sessions and files in the cloud (they hold passports and IDs).

## Phase 4 — Power features
- AI-assisted blueprint creation and task parsing (`aiParsing` flag): optional, off by default.
- Multi-step workflows: a Desk "runbook" (capture here, fill there, send this reply).
- Firefox / Edge builds (Manifest V3 is largely compatible; `sidePanel` is the main gap).
- Public API and Zapier / Make triggers.
