# Jewellery Shop Manager

React + Firebase app for running a jewellery shop: configurable inventory intake,
barcode invoicing, a sales/profit dashboard, and WhatsApp-driven customer
marketing. Deploys to Firebase Hosting; data lives in Firestore; PDFs are
generated and WhatsApp messages sent from Cloud Functions via Twilio.

## 1. What's in here

```
src/
  config/shopConfig.js      <- EDIT THIS FIRST: categories, types, vendors,
                                fields, defaults, logo path, currency
  firebase.js                Firebase SDK init (reads .env)
  components/                Layout/nav, dynamic form field, barcode scanner
  pages/
    InventoryPage.jsx        stock intake form (bulk entry supported)
    InvoicePage.jsx          barcode lookup, cart, checkout
    SummaryPage.jsx          filters, KPIs, charts, editable/filterable table
    CustomersPage.jsx        expand/collapse customer list + WhatsApp blast
  utils/                     calculations, Firestore helpers, date ranges
functions/
  index.js                   Cloud Functions: PDF + Twilio WhatsApp send
  templates/invoiceTemplate.js   <- EDIT THIS to restyle the invoice PDF
firestore.rules, storage.rules, firebase.json
```

## 2. One-time setup

### Firebase project
1. Create a project at console.firebase.google.com.
2. Enable **Firestore** (production mode), **Storage**, and **Hosting**.
3. Enable the **Blaze (pay-as-you-go) plan** — required for Cloud Functions
   to call external APIs like Twilio. Cost for this workload is typically a
   few dollars/month at small shop volume.
4. Project Settings > General > Add app > Web app. Copy the config values
   into a `.env` file (copy `.env.example` first).
5. Install the CLI and log in: `npm install -g firebase-tools && firebase login`
6. `firebase use --add` and select your project.

### Install dependencies
```bash
npm install
cd functions && npm install && cd ..
```

### Twilio (WhatsApp)
1. Sign up at twilio.com, grab your **Account SID** and **Auth Token**.
2. For testing, use the free **WhatsApp Sandbox** (Console > Messaging > Try it
   out > Send a WhatsApp message). It gives you a `whatsapp:+14155238886`-style
   from-number. Each customer must send the sandbox's join code once before
   they can receive messages — fine for testing, not for real customers.
3. For production, apply for **WhatsApp Business** access in Twilio (needs a
   Meta Business verification) and get a real WhatsApp-enabled number.
4. Set the secrets Cloud Functions will use:
   ```bash
   firebase functions:secrets:set TWILIO_ACCOUNT_SID
   firebase functions:secrets:set TWILIO_AUTH_TOKEN
   firebase functions:secrets:set TWILIO_WHATSAPP_FROM   # e.g. whatsapp:+14155238886
   ```
5. **Important — 24 hour session rule:** WhatsApp only allows free-form
   messages within 24 hours of the customer last messaging you. The invoice
   send (right after a sale) is usually fine. For the marketing blast
   (`sendWhatsappMarketing`), you'll likely need a **pre-approved message
   template** instead of free text once you're out of the sandbox. Register
   one in the Twilio Console (Content Editor), then swap the `body:` field
   for `contentSid` / `contentVariables` — there's a commented example
   already in `functions/index.js`.

## 3. Run locally
```bash
npm run dev
```
Cloud Functions won't run locally unless you also start the emulator:
```bash
firebase emulators:start --only functions,firestore,storage
```

## 4. Deploy
```bash
npm run build
firebase deploy --only hosting,functions,firestore:rules,storage:rules
```

## 5. Configuring the shop (no code changes needed for most of this)

Everything in `src/config/shopConfig.js`:

- **`shopName` / `logoPath`** — logo can be a file in `/public` (e.g.
  `/logo.png`) or a full URL. A placeholder ships at `/logo.svg`.
- **`categories`** — the Category dropdown across all pages. All inventory
  is stored in a single Firestore collection with a `category` field (not
  one collection per category), so adding a category here is enough.
- **`types`** — a map of `category -> [type options]`. Add a `_default` key
  for categories you haven't listed.
- **`vendors`**, **`paymentModes`**, **`statuses`** — flat option lists.
- **`defaults`** — starting values for % Profit, Box Price, # Items.
- **`inventoryFields` / `invoiceFields`** — the form field lists that drive
  the Inventory and Invoice pages. Reordering or relabeling here reorders/
  relabels the actual form. Field `type` can be `category`, `dropdown`,
  `text`, `number`, or `readonly`.
- **`inventoryListColumns`** — columns (and which are filterable/editable)
  on the Summary page's detail table.

## 6. Business logic reference

- **Printed Price** = Cost + Cost × (%Profit / 100) + Box Price
- **Final Price** (invoice) = Printed Price − Printed Price × (%Discount / 100)
- **Row ID** = last 8 digits of the save timestamp (ms epoch) — doubles as
  the barcode value. Bulk entry (`# items` > 1) writes that many rows in one
  Firestore batch, each with its own Row ID/SKU.
- **Status** flows: `Purchased` (created) → `Printed` (after the CSV export
  on the Summary page) → `Sold` (after an invoice checkout). Editing name,
  Box Price, or % Profit on the Summary table resets status to `Purchased`
  and recalculates Printed Price.
- **Barcode scan on Invoice** looks up the Row ID directly. If not found,
  Printed Price becomes editable so you can still complete the sale.

## 7. Customizing the invoice PDF

Edit **`functions/templates/invoiceTemplate.js`** only — it's isolated from
the Cloud Function logic on purpose. It gets a live [pdfkit](https://pdfkit.org/docs/getting_started.html)
`doc` object and the invoice data; draw whatever layout you want (add a logo
image with `doc.image(...)`, change fonts/colors, add GST/tax lines, etc.).
Redeploy functions after editing: `firebase deploy --only functions`.

## 8. Suggested next addition: a WhatsApp template setup page

Right now the marketing message box on the Customers page sends free text,
which only works within Twilio's 24-hour session window or in the sandbox.
For real production marketing blasts, WhatsApp requires **pre-approved
templates** (fixed text with `{{1}}`, `{{2}}` placeholders, approved by
Meta, 24–48hr review). I'd recommend a small **Templates** admin view where
you:
1. Store your approved Twilio Content SIDs + variable names in a
   `templates` Firestore collection (name, contentSid, variables[]).
2. On the Customers page, pick a template from a dropdown instead of typing
   free text, and fill in the variables.
3. `sendWhatsappMarketing` in `functions/index.js` already has the
   `contentSid` / `contentVariables` call commented in — wiring the above UI
   to it is a small change once you've registered templates in Twilio.

I didn't build this into v1 since it depends on templates you haven't
registered with Twilio yet — happy to build it once you have SIDs.

## 9. Adding authentication (do this before real use)

This scaffold ships **no login screen**, and `firestore.rules` /
`storage.rules` require `request.auth != null` — so as-is, nobody can read
or write until you add sign-in. Easiest path: enable **Email/Password** (or
Google) under Firebase Console > Authentication, then wrap `<App />` with a
simple sign-in gate using `firebase/auth`'s `onAuthStateChanged` /
`signInWithEmailAndPassword`. Ask me if you'd like this wired in — it's a
focused addition (one new page + a few lines in `main.jsx`).

## 10. Known gaps / things to decide as you go

- Barcode scanning uses the device camera via `html5-qrcode`; it reads
  standard 1D/2D barcodes and QR codes. If your printed labels use a format
  it doesn't support, let me know the format and I'll swap the library.
- The "Number of items" summary stat counts inventory rows in the filtered
  range, not sold units — adjust `SummaryPage.jsx` if you want a different
  definition.
- No pagination on the Summary table yet — fine for hundreds of rows, worth
  adding (Firestore cursor pagination) once inventory grows large.
