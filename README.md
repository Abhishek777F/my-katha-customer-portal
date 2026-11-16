# My Katha Customer Portal

This separate GitHub Pages project provides a read-only customer portal for the existing Firebase project `katha-777`.

## Existing UI
The existing `index.html` is preserved. It contains the emerald/gold responsive UI, Home, Products, Payments, Profile, and Android APK download sections. Its existing API contract is `GET /portal` with an Authorization Bearer token.

## Files
- `index.html`: existing portal interface
- `config.js`: public API URL configuration
- `portal-worker/worker.js`: secure Cloudflare Worker API
- `portal-worker/wrangler.toml`: Worker deployment settings

## Publish on GitHub Pages
1. Open repository Settings > Pages.
2. Select Deploy from a branch.
3. Choose `main` and `/(root)`, then Save.
4. Portal URL: https://abhishek777f.github.io/my-katha-customer-portal/

## Deploy the separate Cloudflare Worker
1. Create a new Worker named `my-katha-customer-portal-api`. Do not modify the existing notification Worker.
2. Deploy `portal-worker/worker.js` as the Worker entry point.
3. Add a Cloudflare Worker secret named `FIREBASE_SERVICE_ACCOUNT` containing the complete service-account JSON for Firebase project `katha-777`. Never commit this JSON to GitHub.
4. Grant the service account only the Firestore permissions needed to read customers, loans, payments and create/update `customerPortalLinks`.
5. The Worker restricts browser requests to the GitHub Pages origin `https://abhishek777f.github.io`.
6. Replace the placeholder Worker URL in `config.js` with the real deployed URL and commit.

## Endpoints
- `GET /health`: service health check
- `GET /portal`: validate a private bearer token and return that customer's active products and payments
- `POST /admin/create-link`: requires a Firebase ID token for an active admin; JSON body `{"customerId":"ABHI021","expiresInDays":90}`
- `POST /admin/revoke-link`: requires an active admin; JSON body `{"linkId":"<linkId returned when created>"}`

Tokens are random 256-bit values. Only their SHA-256 hashes are stored in Firestore collection `customerPortalLinks`. Default expiry is 90 days; maximum is 365 days. Revoked/expired links cannot return account data.

## Existing My Katha data mapping
- `customers/{customerId}`: `name`, `mobile`, `address`, `totalPaise`, `paidPaise`, `deleted`, `createdAt`
- `loans`: `customerId`, `name`, `qty`, `totalPaise`, `date`, `status`
- `payments`: `customerId`, `amountPaise`, `method`, `paymentDate`, `receiptNo`, `status`

Money is stored in paise and converted to rupees for display. Only active loans and active payments are returned.

## Remaining integration and verification
The API endpoints are implemented, but the existing admin website has not yet been changed to add Generate Link, Copy Link, Share WhatsApp, Regenerate and Revoke controls. Those controls must send the signed-in admin's Firebase ID token to the Worker. Before real customer use, deploy the Worker, set the actual URL in config.js, and test link creation, two separate customer accounts, expiry, revocation, deleted accounts and totals. Firestore rules should not grant public access to customerPortalLinks.
