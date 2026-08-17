// ============================================================================
// INVOICE PDF TEMPLATE
// This is the only file you need to edit to change how the invoice looks.
// It receives a live pdfkit `doc` (see https://pdfkit.org/docs/getting_started.html)
// and the invoice data, and draws directly onto the page. Change fonts,
// colors, spacing, add a logo image, etc. here.
// ============================================================================

const SHOP_NAME = 'Aura Jewellers';
const SHOP_ADDRESS = 'Set your shop address in functions/templates/invoiceTemplate.js';
const GOLD = '#9c7a34';
const INK = '#1a1a1a';
const MUTED = '#666666';

function drawInvoice(doc, data) {
  const { invoiceId, items, total, customerName, customerPhone, paymentMode, address, onlinePurchase } = data;

  // --- Header ---
  // To add a logo: doc.image('path/to/logo.png', 40, 40, { width: 60 });
  doc.fillColor(GOLD).fontSize(22).text(SHOP_NAME, 40, 44);
  doc.fillColor(MUTED).fontSize(9).text(SHOP_ADDRESS, 40, 72);

  doc.fillColor(INK).fontSize(14).text('INVOICE', 400, 44, { align: 'right' });
  doc.fillColor(MUTED).fontSize(9).text(`Invoice #: ${invoiceId}`, 400, 64, { align: 'right' });
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 400, 78, { align: 'right' });

  doc.moveTo(40, 100).lineTo(555, 100).strokeColor('#dddddd').stroke();

  // --- Customer block ---
  doc.fillColor(INK).fontSize(11).text('Billed to', 40, 116);
  doc.fillColor(MUTED).fontSize(10)
    .text(customerName, 40, 132)
    .text(customerPhone, 40, 146);
  if (onlinePurchase && address) {
    doc.text(`${address.line1}${address.line2 ? ', ' + address.line2 : ''}`, 40, 160);
    doc.text(`${address.district}, ${address.state} - ${address.pin}`, 40, 174);
  }
  doc.text(`Payment mode: ${paymentMode}`, 400, 116, { align: 'right' });

  // --- Line items table ---
  // `quantity` is >1 for lot-tracked items (e.g. a batch of rings sold
  // together on one invoice) — printedPrice/finalPrice are always per-unit,
  // so the line total shown is finalPrice * quantity.
  let y = 210;
  doc.fillColor(INK).fontSize(10);
  doc.text('Item', 40, y);
  doc.text('Category', 190, y);
  doc.text('Qty', 275, y, { width: 30, align: 'right' });
  doc.text('Printed Price', 315, y, { width: 75, align: 'right' });
  doc.text('Discount', 395, y, { width: 55, align: 'right' });
  doc.text('Line Total', 460, y, { width: 95, align: 'right' });
  y += 16;
  doc.moveTo(40, y).lineTo(555, y).strokeColor('#dddddd').stroke();
  y += 8;

  doc.fillColor(MUTED).fontSize(10);
  items.forEach((item) => {
    const qty = Number(item.quantity) || 1;
    const lineTotal = Number(item.finalPrice || 0) * qty;
    doc.text(item.name || item.type || '-', 40, y, { width: 145 });
    doc.text(item.category || '-', 190, y, { width: 80 });
    doc.text(String(qty), 275, y, { width: 30, align: 'right' });
    doc.text(Number(item.printedPrice || 0).toFixed(2), 315, y, { width: 75, align: 'right' });
    doc.text(`${item.discountPercent || 0}%`, 395, y, { width: 55, align: 'right' });
    doc.text(lineTotal.toFixed(2), 460, y, { width: 95, align: 'right' });
    y += 20;
  });

  y += 10;
  doc.moveTo(315, y).lineTo(555, y).strokeColor('#dddddd').stroke();
  y += 10;
  doc.fillColor(INK).fontSize(12).text('Total', 315, y, { width: 140, align: 'right' });
  doc.fillColor(GOLD).fontSize(12).text(Number(total).toFixed(2), 460, y, { width: 95, align: 'right' });

  // --- Footer ---
  doc.fillColor(MUTED).fontSize(8).text('Thank you for shopping with us.', 40, 750, { align: 'center', width: 515 });
}

module.exports = { drawInvoice };
