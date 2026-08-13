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
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import shopConfig from '../config/shopConfig';

const inventoryCol = () => collection(db, shopConfig.collections.inventory);
const customersCol = () => collection(db, shopConfig.collections.customers);
const invoicesCol = () => collection(db, shopConfig.collections.invoices);

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
