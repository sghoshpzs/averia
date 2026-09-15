# Averia — Jewellery Shop Inventory & Invoicing Manager

A lightweight single-page React application for managing a small jewellery shop: inventory intake, barcode-driven invoicing, customer management, sales summary, and WhatsApp-based communication. The app uses Firebase for authentication, storage, Firestore database and Cloud Functions to generate PDFs and send WhatsApp messages via Twilio.

---

## Table of contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Firebase setup](#firebase-setup)
- [Twilio / WhatsApp setup](#twilio--whatsapp-setup)
- [Google Contacts sync — one-time setup](#google-contacts-sync--one-time-setup)
- [Configuration](#configuration)
- [Development & build](#development--build)
- [Deploy](#deploy)
- [CI/CD (GitHub Actions)](#cicd-github-actions)
- [Customizing invoice PDF](#customizing-invoice-pdf)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- Role-based access (admin / worker), with a super-user override for destructive actions.
- Inventory intake with configurable categories, types and vendors; supports both unique-barcode items and shared-barcode "lots" (e.g. a batch of identical beads sold as individual units).
- Barcode/QR scanning for fast invoice line-item lookup (html5-qrcode).
- Create invoices, apply discounts, and generate/send PDFs via a Cloud Function — the PDF uploads to Storage and a WhatsApp message goes out via Twilio with a stable, token-protected download link; if WhatsApp delivery fails, the PDF downloads automatically in the browser instead.
- Inventory Summary — invested-amount chart/table (grouped by category or vendor, excludes stock that's already sold), a filterable/sortable detail table (sold rows are highlighted), bulk delete, and CSV export.
- Sales Summary — revenue/profit chart and detail table with per-sale profit, filterable by date/category, and CSV export; each row links to that sale's invoice PDF.
- Ad-Hoc Expenses tracking (rent, utilities, repairs, etc.) with bulk delete and CSV export.
- Customers list (auto-created from invoices) with purchase history and WhatsApp marketing blasts (Twilio).
- Responsive layout and simple admin UI for shop configuration.

## Screenshots

| Inventory intake | Invoice / checkout |
| --- | --- |
| ![Inventory intake form](docs/screenshots/inventory.png) | ![Invoice barcode lookup and checkout](docs/screenshots/invoice.png) |

| Inventory Summary | Sales Summary |
| --- | --- |
| ![Inventory Summary with invested-amount chart](docs/screenshots/inventory-summary.png) | ![Sales Summary with revenue and profit chart](docs/screenshots/sales-summary.png) |

| Ad-Hoc Expenses | Customers |
| --- | --- |
| ![Ad-Hoc Expenses table with bulk delete](docs/screenshots/ad-hoc-expenses.png) | ![Customers list with WhatsApp marketing](docs/screenshots/customers.png) |

## Tech stack

- React + JSX
- Vite (build tooling)
- Firebase: Authentication, Firestore, Storage, Cloud Functions
- Twilio (WhatsApp) used from Cloud Functions
- html5-qrcode (client barcode scanner)

## Prerequisites

- Node.js 18+ and npm for the frontend; `functions/` pins Node 20 specifically (see `functions/package.json`'s `engines` field)
- A Firebase project with Billing enabled (Blaze) for external API calls
- Twilio account for WhatsApp (sandbox for testing)

## Quick start

1. Copy the example env and fill in Firebase config:

   cp .env.example .env
   # edit .env and add Firebase SDK config and allowed admin/worker emails

2. Install dependencies:

   npm install
   cd functions && npm install && cd ..

3. Run dev server:

   npm run dev

4. To run Cloud Functions locally (optional):

   firebase emulators:start --only functions,firestore,storage

## Firebase setup

1. Create a Firebase project and enable Firestore, Storage and Hosting.
2. Enable Billing (Blaze) if you plan to use Twilio or other external APIs.
3. From Project Settings → General → Add web app, copy the Firebase config into `.env` (use `.env.example` as a template).
4. Authenticate the Firebase CLI and select the project:

   npm install -g firebase-tools
   firebase login
   firebase use --add

5. (Optional) Set Cloud Functions secrets for Twilio:

   firebase functions:secrets:set TWILIO_ACCOUNT_SID
   firebase functions:secrets:set TWILIO_AUTH_TOKEN
   firebase functions:secrets:set TWILIO_WHATSAPP_FROM

## Twilio / WhatsApp setup

- For local testing you can use Twilio's WhatsApp sandbox (Console → Messaging → Try it out). For production you must provision a WhatsApp-enabled number and register templates for marketing messages.
- The app's Cloud Function expects Twilio credentials as secrets (see above).
- Note: WhatsApp free-form messages are permitted only within 24 hours of a user's last message; marketing blasts require approved templates.

## Google Contacts sync — one-time setup

Every checkout in InvoicePage.jsx also syncs the customer (name, phone, email) into the shop's real Google Contacts, via the `syncGoogleContact` Cloud Function (`functions/googleContacts.js`) and the Google People API. It's free — no billing tier, just a generous default quota — but needs a one-time OAuth grant for whichever Google account should own these contacts (e.g. the shop's own account), since Contacts can't be accessed by Firebase's own service account.

1. Google Cloud Console (same project as this Firebase app) → **APIs & Services → Library** → enable **Google People API**.
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → Application type **Desktop app**. Note the Client ID and Client Secret.
3. `cd scripts && npm install googleapis` (one-time; not part of the app's own dependencies).
4. `node get-google-contacts-token.js` — paste the Client ID/Secret, open the printed URL, sign in as the Google account that should own these contacts, and approve access. The script prints a refresh token.
5. Set all three as Cloud Functions secrets, then redeploy:
   ```
   firebase functions:secrets:set GOOGLE_CONTACTS_CLIENT_ID
   firebase functions:secrets:set GOOGLE_CONTACTS_CLIENT_SECRET
   firebase functions:secrets:set GOOGLE_CONTACTS_REFRESH_TOKEN
   firebase deploy --only functions
   ```

A sync failure never blocks or fails the checkout itself (invoice/inventory/PDF/WhatsApp all still go through) — it's surfaced as an appended note on the result banner, e.g. "Invoice saved and sent. (Google Contacts sync failed: ...)".

## Configuration

Primary configuration lives in `src/config/shopConfig.js`:

- shopName, logoPath, currencySymbol
- categories, types (per-category type lists), vendors
- paymentModes, defaults (profit percent, box price, default item count)
- inventoryFields / invoiceFields — drive which form fields are shown and their behavior

To change allowed admin/worker users, set the environment variables in `.env`:

- VITE_ALLOWED_ADMINS (comma separated emails)
- VITE_ALLOWED_WORKERS (comma separated emails)
- VITE_SUPER_USER (single email) — the only account that can bulk-delete rows on Inventory Summary and Ad-Hoc Expenses; must also appear in VITE_ALLOWED_ADMINS to sign in at all

## Development & build

- Start dev server:

  npm run dev

- Build for production:

  npm run build

## Deploy

Deploys normally happen automatically via GitHub Actions on push to `main` — see [CI/CD](#cicd-github-actions) below. To deploy manually instead:

1. Build assets: `npm run build`
2. Deploy hosting, functions and security rules:

   firebase deploy --only hosting,functions,firestore:rules,storage

   (`storage`, not `storage:rules` — this project's `firebase.json` doesn't
   define a named storage target, so `storage:rules` fails with "Could not
   find rules for the following storage targets: rules".)

### Cloud Functions Gen 2 — one-time IAM setup

The Cloud Functions here (`generateInvoicePdfAndSend`, `viewInvoicePdf`, `sendWhatsappMarketing`) are 2nd Gen, which run on Cloud Run under the project's default Compute Engine service account (`PROJECT_NUMBER-compute@developer.gserviceaccount.com`). Whoever/whatever deploys them — your own Google account for local deploys, or the CI service account for GitHub Actions — must be granted **Service Account User** (`roles/iam.serviceAccountUser`) on that specific service account, or every deploy fails with a `403 iam.serviceaccounts.actAs` error. This is a one-time grant per deploying identity:

1. Google Cloud Console → **IAM & Admin → Service Accounts** → click the `...-compute@developer.gserviceaccount.com` row (not the project-level IAM page — this must be granted on the service account's own Permissions tab).
2. **Permissions** tab → **Grant Access**.
3. Add the deploying principal (your Google account email, and/or the CI deploy service account's email) with role **Service Account User**.
4. Save, then re-run the deploy.

### Storage rules deploy — one-time IAM setup

`firebase deploy --only storage` (deployed by CI's `deploy_rules` job on every push, and by the manual command in [Deploy](#deploy) above) needs to resolve the project's default Storage bucket first, which requires the `firebasestorage.defaultBucket.get` permission. The CI deploy identity (`firebase-adminsdk-fbsvc@averia-jewelry.iam.gserviceaccount.com` — the account behind the `FIREBASE_FUNCTIONS_DEPLOY_KEY` secret) doesn't have it by default, so this step fails with:

```
Error: Request to https://firebasestorage.googleapis.com/v1alpha/projects/averia-jewelry/defaultBucket had HTTP Error: 403,
Permission 'firebasestorage.defaultBucket.get' denied on resource '//firebasestorage.googleapis.com/projects/averia-jewelry/defaultBucket'
```

One-time grant to fix it:

1. Google Cloud Console → **IAM & Admin → IAM** (the project-level page this time, not a single service account's Permissions tab).
2. **Grant Access**.
3. New principal: `firebase-adminsdk-fbsvc@averia-jewelry.iam.gserviceaccount.com` (or whichever account's key is in `FIREBASE_FUNCTIONS_DEPLOY_KEY`/used for local manual deploys).
4. Role: **Firebase Storage Admin** (`roles/firebasestorage.admin`).
5. Save, then re-run the deploy/workflow.

## CI/CD (GitHub Actions)

`.github/workflows/firebase-deploy.yml` deploys on every push to `main`:

- **Hosting** rebuilds and deploys on every push.
- **Firestore/Storage rules** (`deploy_rules` job) redeploy on every push, same as hosting — see the Storage rules IAM note above if this job fails with a `firebasestorage.defaultBucket.get` 403.
- **Cloud Functions** redeploy only when `functions/**` changed (or via manual "Run workflow" dispatch), so an unrelated frontend change doesn't trigger a functions redeploy.

Required repo secrets (Settings → Secrets and variables → Actions):

| Secret | Used for |
| --- | --- |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | Baked into the hosting build (same values as `.env`) |
| `VITE_ALLOWED_ADMINS`, `VITE_ALLOWED_WORKERS`, `VITE_SUPER_USER` | Baked into the hosting build (same as `.env`) — missing `VITE_SUPER_USER` silently disables the Delete button on Inventory Summary/Ad-Hoc Expenses for everyone, with no visible error |
| `FIREBASE_SERVICE_ACCOUNT_AVERIA_JEWELRY` | Hosting deploy credential |
| `FIREBASE_FUNCTIONS_DEPLOY_KEY` | Full JSON of a service account key, reused for both Cloud Functions deploys and the `deploy_rules` job — see the IAM notes above: needs `roles/iam.serviceAccountUser` on the compute service account, and `roles/firebasestorage.admin` at the project level |
| `SHOP_NAME`, `SHOP_ADDRESS`, `SHOP_PHONE`, `SHOP_EMAIL` | Written into `functions/.env` at deploy time (see `functions/.env.example`) |

Twilio secrets (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`) are **not** managed by this workflow — they live in Google Secret Manager already (set via `firebase functions:secrets:set`, see [Firebase setup](#firebase-setup)) and are read directly by the functions at runtime.

A separate `.github/workflows/firebase-hosting-pull-request.yml` deploys a preview hosting channel for pull requests from within this repo.

## Customizing invoice PDF

Edit `functions/templates/invoiceTemplate.js`. The template receives a `pdfkit` `doc` instance and invoice data. Make layout and styling changes there and redeploy functions.

## Contributing

- Please open issues for bugs or feature requests.
- Create topic branches for changes and open pull requests to `main`.
- Keep commits focused and add a short description for reviews.

## License

MIT — see [LICENSE](LICENSE).

