import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  limit,
} from "firebase/firestore";
import { db } from "./firebaseConfig";
import { generateRowId, generateSKU, formattedTimestamp } from "../utils/ids";
import appConfig from "../config/appConfig";

/**
 * Saves `count` copies of a record into the collection named by `category`.
 * (Category doubles as the Firestore collection name - i.e. your sheet tab.)
 */
export async function saveInventoryRecords(category, record, count = 1) {
  const results = [];
  const colRef = collection(db, category);

  for (let i = 0; i < count; i++) {
    const rowId = generateRowId();
    const payload = {
      row_id: rowId,
      SKU: generateSKU(rowId),
      Type: record.type,
      Vendor: record.vendor,
      Name: record.name,
      Cost: parseFloat(record.cost) || 0,
      "% Profit": parseFloat(record.profitPct) || 0,
      "Item Price":
        (parseFloat(record.cost) || 0) +
        (parseFloat(record.cost) || 0) * ((parseFloat(record.profitPct) || 0) / 100),
      "Box Price": parseFloat(record.boxPrice) || 0,
      "Printed Price": parseFloat(record.printedPrice) || 0,
      "Sold Price": null,
      Profit: null,
      Status: appConfig.defaultStatus,
      Created: formattedTimestamp(),
      "Sold Date": null,
    };
    // eslint-disable-next-line no-await-in-loop
    const ref = await addDoc(colRef, payload);
    results.push({ docId: ref.id, ...payload });
  }
  return results;
}

/**
 * Looks up a row_id (barcode) inside a category collection.
 * Returns the matching doc (with its Firestore doc id attached) or null.
 */
export async function lookupByRowId(category, rowId) {
  const colRef = collection(db, category);
  const q = query(colRef, where("row_id", "==", String(rowId)), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { docId: docSnap.id, ...docSnap.data() };
}

/**
 * Marks an inventory record as sold after an invoice is issued.
 */
export async function markAsSold(category, docId, { soldPrice, cost }) {
  const ref = doc(db, category, docId);
  const profit = soldPrice != null && cost != null ? round2(soldPrice - cost) : null;
  await updateDoc(ref, {
    Status: appConfig.soldStatus,
    "Sold Price": soldPrice,
    Profit: profit,
    "Sold Date": formattedTimestamp(),
  });
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
