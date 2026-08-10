/**
 * ============================================================================
 * Cloud Functions - sendInvoice
 * ============================================================================
 * The client (InvoicePage) generates the invoice PDF locally with jsPDF and
 * calls this function with the base64 bytes. This function:
 *
 *   1. Uploads the PDF to Firebase Storage (default) and makes it publicly
 *      readable, OR - if you set the Drive env vars below - uploads to
 *      Google Drive instead and returns the Drive share link.
 *   2. Sends a WhatsApp message containing that link via Twilio's WhatsApp
 *      API (the most accessible way to send WhatsApp messages
 *      programmatically; swap for the official WhatsApp Business Cloud API
 *      if you have a Meta Business account - see notes below).
 *
 * ---------------------------------------------------------------------------
 * REQUIRED SETUP (things only YOU can provide - no code changes needed):
 * ---------------------------------------------------------------------------
 *   firebase functions:config:set \
 *     twilio.sid="ACxxxxxxxx" \
 *     twilio.token="xxxxxxxx" \
 *     twilio.whatsapp_from="whatsapp:+14155238886"
 *
 *   (Optional, only if you want Drive instead of Storage)
 *   Create a Google Cloud service account with Drive API access, share a
 *   target Drive folder with its email, then:
 *     firebase functions:config:set \
 *       drive.client_email="xxx@yyy.iam.gserviceaccount.com" \
 *       drive.private_key="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" \
 *       drive.folder_id="your-drive-folder-id"
 *
 * If Twilio/Drive config isn't set, this function still runs and uploads to
 * Storage; WhatsApp sending is skipped with a clear log message instead of
 * crashing, so you can wire it up incrementally.
 * ============================================================================
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const functionsConfig = require("firebase-functions").config;

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

exports.sendInvoice = onCall(async (request) => {
  const { invoiceId, pdfBase64, customerPhone, total } = request.data || {};

  if (!invoiceId || !pdfBase64) {
    throw new HttpsError("invalid-argument", "invoiceId and pdfBase64 are required.");
  }

  // ---------------------------------------------------------------------
  // 1) Upload PDF (Storage by default; Drive if configured)
  // ---------------------------------------------------------------------
  const pdfBuffer = Buffer.from(pdfBase64, "base64");
  const cfg = safeConfig();

  let pdfUrl;
  if (cfg.drive?.client_email && cfg.drive?.private_key && cfg.drive?.folder_id) {
    pdfUrl = await uploadToDrive(pdfBuffer, invoiceId, cfg.drive);
  } else {
    pdfUrl = await uploadToStorage(pdfBuffer, invoiceId);
  }

  // ---------------------------------------------------------------------
  // 2) Send WhatsApp message with the link
  // ---------------------------------------------------------------------
  let whatsappStatus = "skipped-not-configured";
  if (customerPhone && cfg.twilio?.sid && cfg.twilio?.token && cfg.twilio?.whatsapp_from) {
    whatsappStatus = await sendWhatsAppMessage({
      to: customerPhone,
      body: `Thank you for your purchase! Your invoice ${invoiceId} (Total ₹${total?.toFixed?.(2) ?? total}) is ready: ${pdfUrl}`,
      cfg: cfg.twilio,
    });
  } else {
    console.log("WhatsApp send skipped - missing customerPhone or twilio.* function config.");
  }

  return { pdfUrl, whatsappStatus };
});

// ============================================================================
// Storage upload (default path)
// ============================================================================
async function uploadToStorage(pdfBuffer, invoiceId) {
  const bucket = admin.storage().bucket();
  const file = bucket.file(`invoices/${invoiceId}.pdf`);
  await file.save(pdfBuffer, { contentType: "application/pdf" });
  await file.makePublic(); // relies on storage.rules also allowing read
  return `https://storage.googleapis.com/${bucket.name}/invoices/${invoiceId}.pdf`;
}

// ============================================================================
// Google Drive upload (optional path - used only if drive.* config is set)
// ============================================================================
async function uploadToDrive(pdfBuffer, invoiceId, driveCfg) {
  const { google } = require("googleapis");
  const { Readable } = require("stream");

  const auth = new google.auth.JWT(
    driveCfg.client_email,
    null,
    driveCfg.private_key.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/drive.file"]
  );
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.create({
    requestBody: {
      name: `${invoiceId}.pdf`,
      parents: [driveCfg.folder_id],
    },
    media: {
      mimeType: "application/pdf",
      body: Readable.from(pdfBuffer),
    },
    fields: "id, webViewLink",
  });

  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: { role: "reader", type: "anyone" },
  });

  return res.data.webViewLink;
}

// ============================================================================
// WhatsApp send via Twilio
// ============================================================================
async function sendWhatsAppMessage({ to, body, cfg }) {
  const twilio = require("twilio")(cfg.sid, cfg.token);
  const formattedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  try {
    const msg = await twilio.messages.create({
      from: cfg.whatsapp_from,
      to: formattedTo,
      body,
    });
    return msg.status;
  } catch (err) {
    console.error("WhatsApp send failed:", err.message);
    return `failed: ${err.message}`;
  }
}

function safeConfig() {
  try {
    return functionsConfig() || {};
  } catch {
    return {};
  }
}
