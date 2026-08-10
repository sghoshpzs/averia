# Aurelia Fine Jewellery - Inventory & Invoice App

A config-driven React app for a jewellery shop, deployed on Firebase (Hosting
+ Firestore + Storage + Cloud Functions).

## What's configurable (edit one file: `src/config/appConfig.js`)

- **Logo & shop name** - `brand.logoPath` (a `public/assets/...` path or any
  URL), `brand.shopName`.
- **Categories** - the list of jewellery types (Necklace, Bracelet, ...).
  Each one is also the Firestore collection name records are saved into -
  this is your "sheet tab" equivalent.
- **Dropdown option lists** - `dropdowns.type`, `dropdowns.vendor`, etc.
- **Every form field** on both pages - `inventoryFields` / `invoiceFields`
  arrays define name, label, type (`select` / `text` / `number` / `readonly`
  / `barcode`), which dropdown it pulls from, default values, and which
  formula computes a readonly field. Add/remove/reorder fields here and both
  pages update automatically - no component code changes needed.
- **Formulas** for readonly fields live in `src/utils/formulas.js` and are
  referenced by name from the config (`formula: "computePrintedPrice"`).

## Pages

### Inventory (`/`)
Enter Category, Type, Vendor, Name, Cost, %Profit (default 100), Box Price
(default ₹70), auto-computed Printed Price, and #Items (bulk entry). On
submit it writes `#Items` documents into the Firestore collection named by
Category, each with an 8-digit `row_id` (derived from the current
timestamp), a generated `SKU`, `Status: "Purchased"`, and a `Created`
timestamp - matching the sample row schema you provided.

### Invoice (`/invoice`)
Enter Category, Type, and a Barcode (type it, or tap **Scan** to open the
device camera via `html5-qrcode`). The barcode is looked up against
`row_id` in that category's collection; a match auto-fills Printed Price
(read-only lookup, but still editable if no match is found). Enter
%Discount to get a live Final Price. Add as many items as needed, then
**Submit Invoice**, which:

1. Generates a PDF client-side (`jsPDF`).
2. Calls the `sendInvoice` Cloud Function, which uploads the PDF (Storage by
   default, or Drive if you configure it) and sends a WhatsApp message with
   the link (via Twilio's WhatsApp API).
3. Marks each sold item's inventory record `Status: "Sold"`, `Sold Price`,
   `Profit`, and `Sold Date`.

## Local setup

```bash
npm install
cp .env.example .env        # fill in your Firebase web app config
npm start                   # runs at http://localhost:3000
```

Put your real logo at `public/assets/logo.png` (or point
`brand.logoPath` in the config at any URL). If no image is found, the app
falls back to a monogram badge automatically.

## Firebase project setup

1. Create a Firebase project, enable **Firestore**, **Storage**, and
   **Authentication** (add at least one sign-in method - the starter
   Firestore rules require a signed-in user for read/write; wire up a login
   screen, or relax the rules for a closed internal tool on a private
   network).
2. `firebase login`
3. Set your project id in `.firebaserc`.
4. Deploy Firestore/Storage rules and functions:
   ```bash
   firebase deploy --only firestore:rules,storage:rules
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```
5. Build and deploy the web app:
   ```bash
   npm run build
   firebase deploy --only hosting
   ```
   (or just `npm run deploy`, which does both).

## Wiring up PDF storage + WhatsApp (functions/index.js)

These need credentials only you can provide - the function already runs
without them (PDF still uploads to Firebase Storage), WhatsApp sending is
just skipped with a log message until configured:

```bash
firebase functions:config:set \
  twilio.sid="ACxxxxxxxx" \
  twilio.token="xxxxxxxx" \
  twilio.whatsapp_from="whatsapp:+14155238886"
```
Get these from a [Twilio account](https://www.twilio.com/whatsapp) with the
WhatsApp Sandbox (for testing) or an approved WhatsApp sender (for
production). If you'd rather use Meta's official WhatsApp Business Cloud
API directly, swap `sendWhatsAppMessage()` in `functions/index.js` for a
call to `graph.facebook.com/v19.0/{phone-number-id}/messages` - the rest of
the flow (PDF upload -> get link -> send message) stays the same.

To upload to **Google Drive** instead of Firebase Storage, create a service
account with Drive API access, share a target folder with its email, then:
```bash
firebase functions:config:set \
  drive.client_email="xxx@yyy.iam.gserviceaccount.com" \
  drive.private_key="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" \
  drive.folder_id="your-drive-folder-id"
```

## Notes / things to review before going live

- **Auth**: Firestore rules currently only require `request.auth != null`
  (any signed-in user can read/write everything). Add a login screen and
  tighten rules to your actual staff accounts before real use.
- **Barcode scanning** uses the device camera via `html5-qrcode`, reading
  either real barcodes or QR codes containing the 8-digit Row ID - print
  your item tags as QR codes of the `row_id` for the most reliable scans.
- **Row ID collisions**: IDs are the last 7 digits of the millisecond
  timestamp plus one random digit, so bulk inserts in the same request don't
  collide in practice; for very high-volume shops consider switching to a
  Firestore transaction-based counter instead.
