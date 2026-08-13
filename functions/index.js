const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const PDFDocument = require('pdfkit');
const twilio = require('twilio');
const { drawInvoice } = require('./templates/invoiceTemplate');

admin.initializeApp();
setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });

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

  // Signed URL valid for 7 days. Extend or switch to file.makePublic() if you
  // prefer a permanent public link instead.
  const [pdfUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000
  });

  try {
    const client = twilioClient();
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: toWhatsappNumber(data.customerPhone),
      body: `Hi ${data.customerName || ''}, thank you for your purchase! Your invoice total is ${Number(data.total).toFixed(2)}. Download it here: ${pdfUrl}`
    });
  } catch (twilioErr) {
    // PDF is still generated and stored even if the WhatsApp send fails
    // (e.g. sandbox number not opted-in). Surface this to the caller.
    throw new HttpsError('internal', `PDF saved but WhatsApp send failed: ${twilioErr.message}`);
  }

  await admin.firestore().collection('invoices').doc(data.invoiceId).update({ pdfUrl });

  return { pdfUrl };
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
