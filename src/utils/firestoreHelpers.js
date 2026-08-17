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

const inventoryCol = () => collection(db, shopConfig.collections.inventory);
const customersCol = () => collection(db, shopConfig.collections.customers);
const invoicesCol = () => collection(db, shopConfig.collections.invoices);
const salesCol = () => collection(db, shopConfig.collections.sales);

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
    // lives in the `sales` collection instead (see recordSale below).
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

// Records the sale of `quantity` units (default 1) from the given inventory
// doc, whether it's a lot or a uniquely-barcoded item, and returns the
// created sale doc IDs. Uses a Firestore transaction for lot items so two
// staff selling from the same lot at the same time can't oversell it.
export async function recordSale(inventoryDoc, quantity, soldPricePerUnit, invoiceRef) {
  const qty = Math.max(1, Number(quantity) || 1);
  const invRef = doc(db, shopConfig.collections.inventory, inventoryDoc.id);
  const saleIds = [];

  if (inventoryDoc.isLot) {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(invRef);
      if (!snap.exists()) throw new Error('Inventory lot no longer exists.');
      const data = snap.data();
      const remaining = Number(data.quantityRemaining) || 0;
      if (remaining < qty) {
        throw new Error(`Only ${remaining} unit(s) left in this lot \u2014 reduce the quantity.`);
      }
      const nextRemaining = remaining - qty;
      tx.update(invRef, {
        quantityRemaining: nextRemaining,
        status: nextRemaining === 0 ? 'Sold' : data.status
      });
      for (let i = 0; i < qty; i++) {
        const saleRef = doc(salesCol());
        tx.set(saleRef, {
          inventoryDocId: inventoryDoc.id,
          rowId: data.rowId,
          category: data.category,
          type: data.type,
          name: data.name,
          cost: data.cost,
          soldPrice: soldPricePerUnit,
          soldDate: serverTimestamp(),
          soldDateMillis: Date.now(),
          invoiceRef: invoiceRef || null
        });
        saleIds.push(saleRef.id);
      }
    });
    return saleIds;
  }

  // Non-lot: one physical item, one sale. Still mark the inventory doc
  // itself (existing behavior other tooling/exports may rely on) AND write
  // a sales record so Summary can read every sale from one place.
  await markSold(inventoryDoc.id, soldPricePerUnit);
  const saleRef = await addDoc(salesCol(), {
    inventoryDocId: inventoryDoc.id,
    rowId: inventoryDoc.rowId,
    category: inventoryDoc.category,
    type: inventoryDoc.type,
    name: inventoryDoc.name,
    cost: inventoryDoc.cost,
    soldPrice: soldPricePerUnit,
    soldDate: serverTimestamp(),
    soldDateMillis: Date.now(),
    invoiceRef: invoiceRef || null
  });
  return [saleRef.id];
}

export async function markPrinted(docIds) {
  const batch = writeBatch(db);
  docIds.forEach((id) => batch.update(doc(db, shopConfig.collections.inventory, id), { status: 'Printed' }));
  await batch.commit();
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

export async function createInvoiceRecord(invoiceData) {
  const ref = await addDoc(invoicesCol(), { ...invoiceData, createdAtMillis: Date.now() });
  return ref.id;
}
