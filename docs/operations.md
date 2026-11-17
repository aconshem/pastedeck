# Operations notes

## Email (Resend)
Create a Resend account, add and verify your sending domain (add the SPF and DKIM DNS records they show), create an API
key, then set `RESEND_API_KEY` and `EMAIL_FROM`. Without them, functions log emails instead of sending (dev only);
password-reset and invitation emails will not arrive in production.

## Founder-only demo bootstrap
Set `FOUNDER_BOOTSTRAP_EMAIL`, `FOUNDER_BOOTSTRAP_SECRET` (16+ chars) and optionally `FOUNDER_DEMO_SEED=true`, deploy, then:
`curl -X POST https://pastedeck.netlify.app/.netlify/functions/founder-bootstrap -H "X-Bootstrap-Secret: <secret>"`
It creates your account with **no password** and returns a one-time link (24 h) to choose one. Demo data uses
`@demo.invalid` addresses and `demo`-flagged purchases excluded from revenue. Remove the three variables afterwards.
Production accounts default to Free.

## Migrating the old data
`POST /.netlify/functions/admin-migrate` with `X-Admin-Token: <PASTEBOARD_ADMIN_TOKEN>`; body `{"dryRun":true}` first.
Old devices become members, hashes are kept, pending access requests are dropped, everyone starts on Free (nobody ever
paid) except running trials, and everyone must sign in again and verify their email. Safe to re-run.

## Extension and website
- The website <-> extension bridge matches only `https://pastedeck.netlify.app/*`. For local development add your
  localhost origin to `extension/manifest.json` (content_scripts matches + host_permissions) and
  set `PASTEBOARD_EXTRA_ORIGINS` for the functions.
- The extension never stores your password. "Connect account" opens the site; the site hands over a one-time 2-minute
  code (bound to the current sign-in) which the extension exchanges for its own token. Signing in on another device
  ends that session, and the extension is unlinked the next time it checks (401).
- Entitlements are cached for up to 7 days offline, then the extension falls back to Free.

## Placeholders to fill
`SUPPORT_EMAIL_HERE` appears in the terms, privacy and refund pages. Replace with your real support address
(`grep -r SUPPORT_EMAIL_HERE website`). Have a lawyer review the policy pages.

## Deliberately deferred
PostgreSQL (Netlify Blobs per-key records with compare-and-swap are used), Google sign-in, per-install keypairs,
Creem embedded checkout, multi-team membership (one email = one account), cloud sync.
