import { httpsCallable } from "firebase/functions";
import { functions } from "./firebaseConfig";

/**
 * Calls the `sendInvoice` Cloud Function (see functions/index.js), which:
 *   1. Uploads the given base64 PDF to Google Drive (or Firebase Storage,
 *      depending on which path you enable server-side)
 *   2. Sends a WhatsApp message with the resulting shareable link
 * Returns { pdfUrl, whatsappStatus }.
 */
export async function sendInvoice({ invoiceId, pdfBase64, customerPhone, total }) {
  const callable = httpsCallable(functions, "sendInvoice");
  const res = await callable({ invoiceId, pdfBase64, customerPhone, total });
  return res.data;
}
