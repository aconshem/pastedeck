# Payment setup (Creem)

PasteBoard sells two one-time products through **Creem** (merchant of record), behind a provider-independent
interface (`netlify/functions/_lib/payment-provider.js`; Creem lives in `_lib/creem.js`). The server is the only
authority on what has been paid for. The website, extension and dashboard never decide a plan.

| Product | Price | Notes |
|---|---|---|
| Premium | $25 USD, one-time | unlimited desks/snippets/sessions/files/blueprints, **5 seats including the owner** |
| Extra seat | $2.50 USD, one-time | quantity 1–100; only sold on top of Premium |

> **Assumption to confirm:** "5 seats" includes the owner. If you meant 5 *additional* seats, change
> `PRICING.includedSeats` in `_lib/config.js` and the copy on landing/pricing/dashboard.

## 1. Create the products
1. Sign up at creem.io and finish business verification. Creem is the seller of record, so payouts depend on their supported
   payout countries and KYC. **Check that your Kenya payout method is supported before launch** (not verified here).
2. In **Test mode** (toggle in the Creem dashboard) create two *One-time* products: Premium ($25) and Extra seat ($2.50).
   Enable quantity on the extra-seat product. Copy both product IDs (`prod_...`).
3. Developers -> API keys: copy the test API key.
4. Developers -> Webhooks -> add endpoint `https://pastedeck.netlify.app/.netlify/functions/payment-webhook`, subscribe to
   `checkout.completed`, `refund.created`, `dispute.created`. Copy the signing secret.

## 2. Paste into Netlify
Site configuration -> Environment variables:

| Variable | Value |
|---|---|
| `PAYMENT_PROVIDER` | `creem` |
| `CREEM_MODE` | `test` (switch to `live` later) |
| `CREEM_API_KEY` | API key |
| `CREEM_PREMIUM_PRODUCT_ID` | Premium product id |
| `CREEM_EXTRA_SEAT_PRODUCT_ID` | Extra-seat product id |
| `CREEM_WEBHOOK_SECRET` | webhook signing secret |

Redeploy after changing variables. Until all four `CREEM_*` values exist, checkout returns "Payments are not switched on yet".

## 3. Test
Log in as owner -> Billing & plan -> Buy Premium. Pay with Creem's test card. You return to
`/dashboard/index.html?checkout=<id>`; the page polls `checkout-status`, and the webhook also applies the purchase.
Both paths are idempotent by Creem order id, so a purchase applies exactly once. Test-mode purchases are flagged `test`
and excluded from the admin revenue figure.

## 4. Go live
Create the same two products in live mode, replace the key/product IDs/webhook (live webhooks are a separate endpoint
entry), set `CREEM_MODE=live`, redeploy, and make one real small purchase before announcing.

## How it works / what to know
- Creem offers **hosted checkout** (redirect). There is no embedded card form, so PasteBoard never sees card data.
- Checkout is created server-side (`POST /v1/checkouts`, `x-api-key`) with `request_id` and metadata
  `{accountEmail, memberId, purchaseType, units}`.
- Webhooks are verified with HMAC-SHA256 of the raw body vs the `creem-signature` header, constant-time compared.
- Refunds/disputes revoke the entitlement (webhook, or `admin refund` function). Seat access above the new limit is
  released lazily (newest members first, never the owner).
- Switching provider later = implement the interface in `payment-provider.js`; nothing else changes.
- Not verified here: a live Creem test-mode round trip (no network access to Creem from the build environment), so
  field names are written from Creem's documentation and covered by simulated-payload tests. Do one test purchase first.
