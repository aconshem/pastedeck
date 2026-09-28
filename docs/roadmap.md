# Roadmap

## Done
Everything in the founder spec that could be built without a payment processor or real email delivery:
- Local-first product: desks, snippets (+ standard values), sessions, blueprints (leaf-precise capture, image
  fields, radio/checkbox left for manual pick, target-field date formatting), inline autofill suggestions, leads,
  file shelf, clipboard history, tasks, local analytics.
- Real accounts backend (Netlify Functions + Blobs): owner signup, email+password login, request-access-to-a-team,
  owner-only approve/reject/revoke/role/analytics-access, a founder-only admin panel with aggregate stats.
- Four-tier pricing front end with a 14-day trial on paid tiers, and Premium Pro's cloud-sync CTA paused with
  interest tracking instead of a broken checkout.

## Phase 1 — Auth hardening
- Password reset / forgot-password flow (currently: none — a lost password has no recovery path yet).
- Email verification, actually sending mail (the "Free + Email" tier currently only checks that an email was given,
  not that it was verified — needs a transactional email provider).
- Rate limiting / lockout on `login.js` and `device-request.js` (currently unlimited attempts).
- Real social login once Supabase (or another provider) API keys are available — the Google button was
  deliberately removed rather than left as a disabled placeholder.
- Move off HMAC-signed stateless tokens to real refresh/access tokens with revocation if session hijacking risk
  matters at scale.

## Phase 2 — Payments
- Connect a real processor (Stripe is the natural fit for one-time + subscription in USD). Replace
  `billing.cardCollected` (a boolean the front end sets) with a real charge/subscription id.
- Trial-to-paid conversion: charge automatically when `trial.endsAt` passes, or downgrade to Free with a warning.
- Un-pause Premium Pro once cloud sync (Phase 3) exists to actually deliver what it's charging for.
- Extra-seat billing ($2.50/device on Premium) — currently just a flag (`device.extra`) surfaced in the UI/admin
  panel, not an actual recurring charge.

## Phase 3 — Cloud sync (Premium Pro)
- `PD.db._commit` already appends to `pd:outbox` when the `cloudSync` flag is on — write the adapter that pushes
  it, pulls remote changes by `updatedAt`, and merges by `rev`.
- Encrypt sessions and session files at rest specifically (they hold passports and IDs) even though the rest of a
  synced account might not need it.
- "Connect your own storage" option ($7/mo tier) — Google Drive / Dropbox OAuth + file API integration.

## Phase 4 — Product hardening
- Test every real site (WhatsApp Web, Gmail, visa portals, Google Forms) and tune `insertText`/`attachFile`/blueprint
  selectors where a site fights back.
- Blueprint self-repair when a selector breaks (fall back to label-text matching, prompt to re-teach).
- Blueprint import/export (JSON) so a working blueprint can be shared before real-time team sync exists.
- iframe support (`all_frames`) for portals that embed forms.
- Lead parsing: handle more reply shapes than "Label: value" per line (numbered lists, multi-line answers).
- Chrome Web Store listing (screenshots, privacy policy, permission justifications) — once published, set
  `CHROME_STORE_URL` in `website/landing/index.html` and every "Install extension" link switches automatically.

## Phase 5 — Power features
- AI-assisted blueprint creation and task parsing (`aiParsing` flag): optional, off by default.
- Multi-step "runbooks": a Desk that chains capture → fill → send in one step.
- Firefox / Edge builds.
- Public API and Zapier/Make triggers for leads and tasks.
