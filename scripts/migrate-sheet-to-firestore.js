// ============================================================================
// MIGRATE GOOGLE SHEET INVENTORY -> FIRESTORE
//
// Run once, locally, to import your existing barcode/inventory sheet into
// this app's Firestore. Every row from the sheet becomes ONE inventory doc
// with isLot:false (your existing sheet is one-row-per-physical-item, so
// this preserves that 1:1 traceability exactly as-is — it does NOT try to
// guess which rows should be grouped into a lot; lot tracking only applies
// going forward, to new stock you enter through the Inventory page for
// categories listed in shopConfig.lotTrackedCategories).
//
// If a row's Status is "Sold" (or has both a Sold Price and Sold Date), the
// script ALSO writes a matching doc to the `sales` collection — this is
// required, because the Summary page now reads all profit/sold-date figures
// from `sales`, not from fields on the inventory doc. Skipping this step
// would make historical sales invisible in Summary after migration.
//
// ---- Category / Vendor / Type spelling ----
// The Category, Vendor, and Type filter dropdowns on the Summary pages are
// driven by fixed lists in src/config/shopConfig.js (`categories`, `vendors`,
// `types`), NOT by whatever values happen to exist in Firestore. A migrated
// row whose Category/Vendor/Type text doesn't match shopConfig.js exactly
// (case-sensitive) will still import fine and show up in the unfiltered
// table, but it won't be selectable from those dropdown filters. Check your
// sheet's values against shopConfig.js before running for real — current
// categories: Necklace, Bracelet, Ring, Earring, Bangle, Anklet.
//
// ---- Setup ----
// 1. npm install firebase-admin csv-parse   (run inside this scripts/ folder,
//    or add both to the root package.json devDependencies)
// 2. Firebase Console > Project Settings > Service Accounts > Generate new
//    private key. Save the JSON file as scripts/serviceAccountKey.json
//    (already covered by .gitignore — never commit this file).
// 3. Export your Google Sheet: File > Download > Comma Separated Values
//    (.csv), save it as scripts/inventory-export.csv
// 4. Update COLUMN_MAP below if your sheet's headers don't match the
//    sample row from your original spec.
// 5. Dry run first (writes nothing, just prints what it would do):
//      node scripts/migrate-sheet-to-firestore.js --dry-run
//    Then for real:
//      node scripts/migrate-sheet-to-firestore.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
// firebase-admin v12+ dropped the old admin.credential.cert()/admin.firestore()
// namespace API in favor of these modular imports.
const { cert, initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');

const DRY_RUN = process.argv.includes('--dry-run');
const CSV_PATH = path.join(__dirname, 'inventory-export.csv');
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');

// Map this app's field names -> your sheet's column headers. Edit the
// right-hand values to match your actual CSV header row exactly.
const COLUMN_MAP = {
  rowId: 'Row_id',
  sku: 'SKU',
  category: 'Category', // add this column if your sheet doesn't have one —
                          // e.g. if each category was a separate tab, set it
                          // per-tab instead of reading from a column.
  type: 'Type',
  vendor: 'Vendor',
  name: 'Name',
  cost: 'Cost',
  profitPercent: '% Profit',
  boxPrice: 'Box Price',
  printedPrice: 'Printed Price',
  soldPrice: 'Sold Price',
  status: 'Status',
  created: 'Created',
  soldDate: 'Sold Date'
};

function parseMoney(v) {
  if (v === undefined || v === null || v === '') return 0;
  return Number(String(v).replace(/[^0-9.-]/g, '')) || 0;
}

function parseDateToMillis(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.getTime();
}

// Must match shopConfig.js's `statuses` list exactly — the inventory Status
// filter dropdown and the checkout re-sale guard (`data.status === 'Sold'`)
// both do exact, case-sensitive comparisons against these values.
const VALID_STATUSES = ['Purchased', 'Printed', 'Sold'];

// Sold items ALWAYS normalize to 'Sold', regardless of the sheet's spelling
// ("sold", "SOLD", etc.) — a mismatched case here would let InvoicePage sell
// an already-sold item a second time, since the re-sale guard is exact-match.
function normalizeStatus(raw, isSold) {
  if (isSold) return 'Sold';
  const trimmed = String(raw || '').trim();
  const match = VALID_STATUSES.find((s) => s.toLowerCase() === trimmed.toLowerCase());
  return match || 'Purchased';
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Missing ${CSV_PATH} — export your sheet as CSV and save it there first.`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`Read ${records.length} rows from ${CSV_PATH}.`);

  let db = null;
  if (!DRY_RUN) {
    if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
      console.error(`Missing ${SERVICE_ACCOUNT_PATH} — see the setup notes at the top of this file.`);
      process.exit(1);
    }
    initializeApp({ credential: cert(require(SERVICE_ACCOUNT_PATH)) });
    db = getFirestore();
  }

  let inventoryWrites = 0;
  let salesWrites = 0;
  let skipped = 0;
  let statusNormalized = 0;

  const inventoryBatchOps = [];
  const salesBatchOps = [];

  for (const record of records) {
    const rowId = record[COLUMN_MAP.rowId];
    if (!rowId) {
      skipped++;
      continue;
    }

    const cost = parseMoney(record[COLUMN_MAP.cost]);
    const profitPercent = parseMoney(record[COLUMN_MAP.profitPercent]);
    const boxPrice = parseMoney(record[COLUMN_MAP.boxPrice]);
    const printedPrice = parseMoney(record[COLUMN_MAP.printedPrice]) || (cost + cost * (profitPercent / 100) + boxPrice);
    const soldPrice = parseMoney(record[COLUMN_MAP.soldPrice]);
    const rawStatus = String(record[COLUMN_MAP.status] || '').trim();
    const createdMillis = parseDateToMillis(record[COLUMN_MAP.created]) || Date.now();
    const soldDateMillis = parseDateToMillis(record[COLUMN_MAP.soldDate]);

    const isSold = rawStatus.toLowerCase() === 'sold' || (soldPrice > 0 && soldDateMillis);
    const status = normalizeStatus(rawStatus, isSold);
    if (status !== rawStatus && !(isSold && rawStatus.toLowerCase() === 'sold')) statusNormalized++;

    const inventoryDoc = {
      rowId: String(rowId),
      sku: record[COLUMN_MAP.sku] || `SKU-${rowId}`,
      category: record[COLUMN_MAP.category] || 'Uncategorized',
      type: record[COLUMN_MAP.type] || '',
      vendor: record[COLUMN_MAP.vendor] || '',
      name: record[COLUMN_MAP.name] || '',
      cost,
      profitPercent,
      boxPrice,
      printedPrice,
      isLot: false, // historical rows import 1:1 — see file header comment
      status,
      createdAtMillis: createdMillis,
      soldPrice: soldPrice || null,
      soldDate: soldDateMillis ? Timestamp.fromMillis(soldDateMillis) : null,
      soldDateMillis: soldDateMillis || null
    };

    if (DRY_RUN) {
      console.log(`[dry-run] inventory: ${inventoryDoc.rowId} (${inventoryDoc.category}/${inventoryDoc.type}) status=${status}${isSold ? ' + sales record' : ''}`);
      inventoryWrites++;
      if (isSold) salesWrites++;
      continue;
    }

    const invRef = db.collection('inventory').doc();
    inventoryBatchOps.push({ ref: invRef, data: inventoryDoc });
    inventoryWrites++;

    if (isSold) {
      const saleRef = db.collection('sales').doc();
      salesBatchOps.push({
        ref: saleRef,
        data: {
          // Field set mirrors checkoutInvoice()'s sales docs (see
          // src/utils/firestoreHelpers.js) so the Sales Summary table's
          // columns — customer, payment mode, discount, etc. — don't come
          // up blank for migrated historical rows. None of these are
          // required for the app to function; they're display-only.
          inventoryDocId: invRef.id,
          rowId: inventoryDoc.rowId,
          category: inventoryDoc.category,
          type: inventoryDoc.type,
          vendor: inventoryDoc.vendor || null,
          name: inventoryDoc.name,
          cost: inventoryDoc.cost,
          printedPrice: inventoryDoc.printedPrice ?? null,
          discountPercent: 0,
          quantity: 1,
          soldPrice: soldPrice || printedPrice,
          soldDate: soldDateMillis ? Timestamp.fromMillis(soldDateMillis) : FieldValue.serverTimestamp(),
          soldDateMillis: soldDateMillis || Date.now(),
          invoiceId: null,
          invoiceRef: null,
          customerName: null,
          customerPhone: null,
          customerEmail: null,
          onlinePurchase: false,
          paymentMode: null,
          migratedFromSheet: true
        }
      });
      salesWrites++;
    }
  }

  if (!DRY_RUN) {
    // Firestore batches cap at 500 writes — chunk both write sets.
    const allOps = [...inventoryBatchOps, ...salesBatchOps];
    for (let i = 0; i < allOps.length; i += 450) {
      const batch = db.batch();
      allOps.slice(i, i + 450).forEach((op) => batch.set(op.ref, op.data));
      await batch.commit();
      console.log(`Committed batch ${Math.floor(i / 450) + 1} (${Math.min(450, allOps.length - i)} writes).`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Inventory docs: ${inventoryWrites}`);
  console.log(`Sales docs (from already-sold rows): ${salesWrites}`);
  console.log(`Skipped rows (missing Row ID): ${skipped}`);
  console.log(`Status values normalized to match shopConfig.js (Purchased/Printed/Sold): ${statusNormalized}`);
  if (DRY_RUN) console.log('\nThis was a dry run — nothing was written. Re-run without --dry-run to commit.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
