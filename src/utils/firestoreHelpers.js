import {
  collection,
  addDoc,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  writeBatch,
  serverTimestamp,
  runTransaction
} from 'firebase/firestore';
import { db } from '../firebase';
import shopConfig from '../config/shopConfig';
import { generateRowId } from './calculations';

const inventoryCol = () => collection(db, shopConfig.collections.inventory);
const customersCol = () => collection(db, shopConfig.collections.customers);
const invoicesCol = () => collection(db, shopConfig.collections.invoices);
const salesCol = () => collection(db, shopConfig.collections.sales);
const expensesCol = () => collection(db, shopConfig.collections.expenses);

// ---- Inventory --------------------------------------------------------

// Writes `count` rows in a single batch (bulk entry when # items > 1).
export async function addInventoryRows(baseRow, count, generateRowId, generateSku) {
  const batch = writeBatch(db);
  const createdRows = [];
  for (let i = 0; i < count; i++) {
    const rowId = generateRowId();
    const ref = doc(inventoryCol());
    const row = {
      ...baseRow,
      rowId,
      sku: generateSku(rowId),
      status: 'Purchased',
      created: serverTimestamp(),
      createdAtMillis: Date.now(),
      soldPrice: null,
      soldDate: null
    };
    batch.set(ref, row);
    createdRows.push(row);
  }
  await batch.commit();
  return createdRows;
}

// Writes ONE lot doc covering `quantity` units under a single shared
// barcode (used for categories in shopConfig.lotTrackedCategories).
export async function addInventoryLot(baseRow, quantity, generateRowId, generateSku) {
  const rowId = generateRowId();
  const row = {
    ...baseRow,
    rowId,
    sku: generateSku(rowId),
    isLot: true,
    quantityPurchased: quantity,
    quantityRemaining: quantity,
    status: 'Purchased',
    created: serverTimestamp(),
    createdAtMillis: Date.now(),
    // kept null/absent on purpose — a lot doc represents many units, so a
    // single soldPrice/soldDate doesn't apply here. Per-unit sale info
    // lives in the `sales` collection instead (see checkoutInvoice below).
    soldPrice: null,
    soldDate: null
  };
  const ref = await addDoc(inventoryCol(), row);
  return { id: ref.id, ...row };
}

export function subscribeInventory(callback) {
  const q = query(inventoryCol(), orderBy('createdAtMillis', 'desc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function findInventoryByRowId(rowId) {
  const q = query(inventoryCol(), where('rowId', '==', String(rowId)));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function updateInventoryDoc(docId, patch) {
  await updateDoc(doc(db, shopConfig.collections.inventory, docId), patch);
}

export async function markSold(docId, soldPrice) {
  await updateDoc(doc(db, shopConfig.collections.inventory, docId), {
    status: 'Sold',
    soldPrice,
    soldDate: serverTimestamp(),
    soldDateMillis: Date.now()
  });
}

// ---- Sales (per-unit sale events) ----------------------------------------
// Every completed sale — lot or unique-barcode item — writes one doc here.
// This is the single source of truth Summary reads for profit/sold-date
// filtering, so a lot doc being reused across many sales never loses history.
export function subscribeSales(callback) {
  const q = query(salesCol(), orderBy('soldDateMillis', 'desc'));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Records every item in one checkout, AND the invoice doc itself, as a
// SINGLE Firestore transaction: reads all referenced inventory docs first
// (Firestore requires every read in a transaction to happen before any
// write), validates lot quantities against every line item at once, then
// commits the invoice + every inventory decrement/status update + every
// sales doc together. If ANY item fails validation (e.g. a lot sold out
// moments ago in a different checkout), NONE of it is written \u2014 there is
// no state where an invoice exists without matching stock deduction, which
// was the gap in the original sequential-await version.
//
// Customer upsert is intentionally NOT part of this transaction \u2014 it
// requires a `where()` query read, and reading a query inside a web-SDK
// transaction is not something to rely on for money-correctness-critical
// code. It's called separately, right after this succeeds. Worst case if
// that one call fails is a customer's running total is slightly stale,
// which is recoverable and non-destructive, unlike an inventory mismatch.
//
// Reserves an 8-digit, timestamp-based invoice number (same scheme as
// inventory row IDs) without writing anything, so the Invoice Id can be
// shown in the UI before checkout actually happens. Pass the returned ID
// into checkoutInvoice() so the doc it writes lands under this same ID.
export function reserveInvoiceId() {
  return generateRowId();
}

// cartItems: [{ inventoryDoc, quantity, soldPricePerUnit }] — entries
// without an inventoryDoc (manual/lookup-failed lines) are skipped for the
// inventory/sales writes but still appear in the invoice's item list.
export async function checkoutInvoice(cartItems, invoiceData, invoiceId) {
  const invoiceRef = invoiceId ? doc(db, shopConfig.collections.invoices, invoiceId) : doc(invoicesCol());
  const itemsWithInventory = cartItems.filter((i) => i.inventoryDoc);

  await runTransaction(db, async (tx) => {
    // ---- READ PHASE — every tx.get() must happen before any tx.set/update ----
    const resolved = [];
    for (const item of itemsWithInventory) {
      const invRef = doc(db, shopConfig.collections.inventory, item.inventoryDoc.id);
      const snap = await tx.get(invRef);
      if (!snap.exists()) {
        throw new Error(`${item.inventoryDoc.rowId || item.inventoryDoc.id} no longer exists in inventory.`);
      }
      resolved.push({ item, invRef, data: snap.data() });
    }

    // ---- VALIDATE PHASE — check every line before writing any of them ----
    resolved.forEach(({ item, data }) => {
      const qty = Math.max(1, Number(item.quantity) || 1);
      if (data.isLot) {
        const remaining = Number(data.quantityRemaining) || 0;
        if (remaining < qty) {
          throw new Error(`Only ${remaining} unit(s) left of ${data.rowId} (${data.name || data.type}) \u2014 reduce the quantity and try again.`);
        }
      } else if (data.status === 'Sold') {
        throw new Error(`${data.rowId} (${data.name || data.type}) was already sold \u2014 remove it from the cart.`);
      }
    });

    // ---- WRITE PHASE ----
    tx.set(invoiceRef, { ...invoiceData, createdAtMillis: Date.now() });

    resolved.forEach(({ item, invRef, data }) => {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const soldPricePerUnit = item.soldPricePerUnit;
      // Denormalized onto every sale doc so the Sales Summary table can
      // render directly from `sales` without joining against `invoices` or
      // `inventory` at read time.
      const saleExtras = {
        vendor: data.vendor || null,
        printedPrice: item.printedPrice ?? null,
        discountPercent: item.discountPercent ?? 0,
        quantity: 1, // each doc is always exactly one physical unit sold
        invoiceId: invoiceRef.id,
        customerName: invoiceData.customerName || null,
        customerPhone: invoiceData.customerPhone || null,
        customerEmail: invoiceData.customerEmail || null,
        onlinePurchase: Boolean(invoiceData.onlinePurchase),
        paymentMode: invoiceData.paymentMode || null
      };

      if (data.isLot) {
        const nextRemaining = (Number(data.quantityRemaining) || 0) - qty;
        tx.update(invRef, {
          quantityRemaining: nextRemaining,
          status: nextRemaining === 0 ? 'Sold' : data.status
        });
        for (let i = 0; i < qty; i++) {
          const saleRef = doc(salesCol());
          tx.set(saleRef, {
            inventoryDocId: item.inventoryDoc.id,
            rowId: data.rowId,
            category: data.category,
            type: data.type,
            name: data.name,
            cost: data.cost,
            soldPrice: soldPricePerUnit,
            soldDate: serverTimestamp(),
            soldDateMillis: Date.now(),
            invoiceRef: invoiceRef.id,
            ...saleExtras
          });
        }
      } else {
        tx.update(invRef, {
          status: 'Sold',
          soldPrice: soldPricePerUnit,
          soldDate: serverTimestamp(),
          soldDateMillis: Date.now()
        });
        const saleRef = doc(salesCol());
        tx.set(saleRef, {
          inventoryDocId: item.inventoryDoc.id,
          rowId: data.rowId,
          category: data.category,
          type: data.type,
          name: data.name,
          cost: data.cost,
          soldPrice: soldPricePerUnit,
          soldDate: serverTimestamp(),
          soldDateMillis: Date.now(),
          invoiceRef: invoiceRef.id,
          ...saleExtras
        });
      }
    });
  });

  return invoiceRef.id;
}

export async function markPrinted(docIds) {
  const batch = writeBatch(db);
  docIds.forEach((id) => batch.update(doc(db, shopConfig.collections.inventory, id), { status: 'Printed' }));
  await batch.commit();
}

// Firestore batches cap at 500 writes — chunk deletes the same way the
// migration script chunks its writes.
export async function deleteInventoryDocs(docIds) {
  for (let i = 0; i < docIds.length; i += 450) {
    const batch = writeBatch(db);
    docIds.slice(i, i + 450).forEach((id) => batch.delete(doc(db, shopConfig.collections.inventory, id)));
    await batch.commit();
  }
}

// ---- Customers ----------------------------------------------------------

export function subscribeCustomers(callback) {
  const q = query(customersCol(), orderBy('name'));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Creates the customer if new, or increments totals if they already exist
// (matched by phone number). Called from the invoice checkout flow.
export async function upsertCustomerOnPurchase({ name, phone, email, address }, invoiceAmount, invoiceRef) {
  const q = query(customersCol(), where('phone', '==', phone));
  const snap = await getDocs(q);
  if (snap.empty) {
    await addDoc(customersCol(), {
      name,
      phone,
      email: email || null,
      address: address || null,
      totalPurchased: invoiceAmount,
      purchases: [{ date: Date.now(), amount: invoiceAmount, invoiceRef }]
    });
  } else {
    const existing = snap.docs[0];
    const data = existing.data();
    await updateDoc(doc(db, shopConfig.collections.customers, existing.id), {
      totalPurchased: (data.totalPurchased || 0) + invoiceAmount,
      purchases: [...(data.purchases || []), { date: Date.now(), amount: invoiceAmount, invoiceRef }]
    });
  }
}

// ---- Invoices -------------------------------------------------------------
// createInvoiceRecord is superseded by checkoutInvoice above (which writes
// the invoice doc as part of the same atomic transaction as the inventory
// deduction) — kept here only in case some other tooling wants to write an
// invoice-shaped doc without touching inventory at all.
export async function createInvoiceRecord(invoiceData) {
  const ref = await addDoc(invoicesCol(), { ...invoiceData, createdAtMillis: Date.now() });
  return ref.id;
}

// Used by SalesSummaryPage to link each sale row's invoice number to its
// PDF (invoices/{id}.pdfUrl, set by the generateInvoicePdfAndSend Cloud
// Function once the WhatsApp/PDF step completes).
export function subscribeInvoices(callback) {
  return onSnapshot(invoicesCol(), (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// ---- Ad-Hoc Expenses -------------------------------------------------------

export function subscribeExpenses(callback) {
  const q = query(expensesCol(), orderBy('dateMillis', 'desc'));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function addExpense({ category, description, amount, dateMillis }) {
  const ref = await addDoc(expensesCol(), {
    category,
    description: description || '',
    amount: Number(amount) || 0,
    dateMillis,
    createdAtMillis: Date.now()
  });
  return ref.id;
}

export async function deleteExpenses(docIds) {
  for (let i = 0; i < docIds.length; i += 450) {
    const batch = writeBatch(db);
    docIds.slice(i, i + 450).forEach((id) => batch.delete(doc(db, shopConfig.collections.expenses, id)));
    await batch.commit();
  }
}
