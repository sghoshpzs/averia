const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const twilio = require('twilio');
const { drawInvoice } = require('./templates/invoiceTemplate');

const REGION = 'asia-south1';

admin.initializeApp();
setGlobalOptions({ region: REGION, maxInstances: 10 });

// How long a buyer can keep using their invoice link before it's refused —
// enforced here, not by the underlying signed URL (GCS signed URLs cap out
// at 7 days, far short of what we want).
const PDF_LINK_VALID_MONTHS = 6;

function isPdfLinkExpired(createdAtMillis) {
  if (!createdAtMillis) return true;
  const expiry = new Date(createdAtMillis);
  expiry.setMonth(expiry.getMonth() + PDF_LINK_VALID_MONTHS);
  return Date.now() > expiry.getTime();
}

// Constant-time-ish comparison so a mismatched token doesn't leak timing info.
function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// The link we hand to the buyer — stable for PDF_LINK_VALID_MONTHS, but
// meaningless without the random token (invoiceId alone is guessable: it's
// just the last 8 digits of a millisecond timestamp, see
// src/utils/calculations.js#generateRowId).
function invoicePdfUrl(invoiceId, token) {
  const projectId = admin.app().options.projectId || process.env.GCLOUD_PROJECT;
  return `https://${REGION}-${projectId}.cloudfunctions.net/viewInvoicePdf?invoiceId=${encodeURIComponent(invoiceId)}&token=${encodeURIComponent(token)}`;
}

// ---- Twilio setup ---------------------------------------------------------
// Set these with:
//   firebase functions:secrets:set TWILIO_ACCOUNT_SID
//   firebase functions:secrets:set TWILIO_AUTH_TOKEN
//   firebase functions:secrets:set TWILIO_WHATSAPP_FROM   (e.g. whatsapp:+14155238886 for sandbox)
const TWILIO_SECRETS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM'];

function twilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

function toWhatsappNumber(phone) {
  const cleaned = String(phone).trim();
  return cleaned.startsWith('whatsapp:') ? cleaned : `whatsapp:${cleaned}`;
}

async function buildInvoicePdfBuffer(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawInvoice(doc, data);
    doc.end();
  });
}

// ---- generateInvoicePdfAndSend ---------------------------------------------
// Called from InvoicePage.jsx after an invoice + inventory update succeed.
// 1. Renders the PDF (see functions/templates/invoiceTemplate.js to restyle)
// 2. Uploads it to Firebase Storage under invoices/{invoiceId}.pdf
// 3. Sends a WhatsApp message with the download link via Twilio
exports.generateInvoicePdfAndSend = onCall({ secrets: TWILIO_SECRETS }, async (request) => {
  const data = request.data;
  if (!data?.invoiceId || !data?.customerPhone) {
    throw new HttpsError('invalid-argument', 'invoiceId and customerPhone are required.');
  }

  const pdfBuffer = await buildInvoicePdfBuffer(data);

  const bucket = admin.storage().bucket();
  const filePath = `invoices/${data.invoiceId}.pdf`;
  const file = bucket.file(filePath);
  await file.save(pdfBuffer, { contentType: 'application/pdf' });

  // The buyer-facing link points at viewInvoicePdf (below), which enforces
  // the 6-month window and the access token itself — this URL is stable and
  // isn't a signed URL, so it doesn't inherit GCS's 7-day signing cap.
  const pdfAccessToken = crypto.randomBytes(24).toString('hex');
  const pdfUrl = invoicePdfUrl(data.invoiceId, pdfAccessToken);

  // Record the PDF's URL/token on the invoice doc regardless of whether the
  // WhatsApp send below succeeds — the PDF itself is already safely stored,
  // so a Twilio failure shouldn't also lose this.
  await admin.firestore().collection('invoices').doc(data.invoiceId).update({ pdfUrl, pdfAccessToken });

  let whatsappSent = true;
  let whatsappError = null;
  try {
    const client = twilioClient();
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: toWhatsappNumber(data.customerPhone),
      body: `Hi ${data.customerName || ''}, thank you for your purchase! Your invoice total is ${Number(data.total).toFixed(2)}. Download it here: ${pdfUrl}`
    });
  } catch (twilioErr) {
    // Don't throw — the PDF is already generated and stored, so the caller
    // should still get pdfUrl (and the raw bytes, below) back instead of
    // losing access to it. InvoicePage.jsx uses pdfBase64 to auto-download
    // the PDF client-side when WhatsApp delivery fails.
    whatsappSent = false;
    whatsappError = twilioErr.message;
  }

  return {
    pdfUrl,
    whatsappSent,
    whatsappError,
    ...(whatsappSent ? {} : { pdfBase64: pdfBuffer.toString('base64') })
  };
});

// ---- viewInvoicePdf ---------------------------------------------------------
// Plain HTTPS endpoint (not a callable) so it works as a link clicked from
// WhatsApp. This is the actual buyer-facing invoice URL — it never expires
// on its own, but every request is checked against:
//   1. the random token, so guessing/enumerating invoiceId isn't enough
//      (invoiceId itself is just the last 8 digits of a timestamp), and
//   2. the 6-month window from the invoice's createdAtMillis.
// A passing request gets redirected to a short-lived (5 min) signed URL —
// that URL is single-use-ish and not what's ever shared with the buyer.
exports.viewInvoicePdf = onRequest(async (req, res) => {
  const invoiceId = String(req.query.invoiceId || '');
  const token = String(req.query.token || '');
  if (!invoiceId || !token) {
    res.status(400).send('Missing invoiceId or token.');
    return;
  }

  const snap = await admin.firestore().collection('invoices').doc(invoiceId).get();
  if (!snap.exists) {
    res.status(404).send('Invoice not found.');
    return;
  }

  const invoice = snap.data();
  if (!tokensMatch(token, invoice.pdfAccessToken || '')) {
    res.status(403).send('Invalid or revoked invoice link.');
    return;
  }
  if (isPdfLinkExpired(invoice.createdAtMillis)) {
    res.status(410).send(`This invoice link is more than ${PDF_LINK_VALID_MONTHS} months old and has expired.`);
    return;
  }

  const file = admin.storage().bucket().file(`invoices/${invoiceId}.pdf`);
  const [exists] = await file.exists();
  if (!exists) {
    res.status(404).send('Invoice PDF not found.');
    return;
  }

  const [signedUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 5 * 60 * 1000 });
  res.redirect(302, signedUrl);
});

// ---- sendWhatsappMarketing --------------------------------------------------
// Called from CustomersPage.jsx. Sends a free-text WhatsApp message to each
// selected customer. NOTE: outside Twilio's 24-hour session window, WhatsApp
// requires a pre-approved message template rather than free text — register
// one in the Twilio console and swap `body` for `contentSid` + `contentVariables`
// below once you have it.
exports.sendWhatsappMarketing = onCall({ secrets: TWILIO_SECRETS }, async (request) => {
  const { recipients, message } = request.data || {};
  if (!Array.isArray(recipients) || recipients.length === 0 || !message) {
    throw new HttpsError('invalid-argument', 'recipients[] and message are required.');
  }

  const client = twilioClient();
  const results = await Promise.allSettled(
    recipients.map((r) =>
      client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: toWhatsappNumber(r.phone),
        body: message
        // For an approved template instead of free text, replace `body` with:
        // contentSid: 'HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        // contentVariables: JSON.stringify({ 1: r.name }),
      })
    )
  );

  const failed = results.filter((r) => r.status === 'rejected');
  return { sent: results.length - failed.length, failed: failed.length };
});
