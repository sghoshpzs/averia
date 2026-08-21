// ============================================================================
// INVOICE PDF TEMPLATE
// This is the only file you need to edit to change how the invoice looks.
// It receives a live pdfkit `doc` (see https://pdfkit.org/docs/getting_started.html)
// and the invoice data, and draws directly onto the page. Change fonts,
// colors, spacing, add a logo image, etc. here.
// ============================================================================

const path = require('path');
const fs = require('fs');

// Shop identity intentionally comes from functions/.env (gitignored) for
// address/phone/email — src/config/shopConfig.js is part of the public repo
// and those shouldn't be. Shop name matches shopConfig.js's shopName since
// that's already public there. See functions/.env.example.
const SHOP_NAME = process.env.SHOP_NAME || 'Averia Jewellery';
const SHOP_ADDRESS = process.env.SHOP_ADDRESS || 'Set SHOP_ADDRESS in functions/.env';
const SHOP_PHONE = process.env.SHOP_PHONE || '';
const SHOP_EMAIL = process.env.SHOP_EMAIL || '';
// Social links are public by nature (the point is for customers to find
// them), so unlike address/phone/email these are fine hardcoded here.
const INSTAGRAM_URL = 'https://www.instagram.com/averia_jewellery';
const FACEBOOK_URL = 'https://www.facebook.com/1130894276763577/';
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo.png');
const GOLD = '#9c7a34';
const INK = '#1a1a1a';
const MUTED = '#666666';

// Small self-drawn icons (vector, not image assets) so there's no external
// brand-asset file to source/license — just enough to read as "Facebook"/
// "Instagram" at invoice-header size. Each is wrapped in doc.link(...) so
// the icon itself is a clickable hyperlink in the PDF.
function drawFacebookIcon(doc, x, y, size, url) {
  const r = size / 2;
  doc.save();
  doc.circle(x + r, y + r, r).fill('#1877F2');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(size * 0.68)
    .text('f', x, y + size * 0.14, { width: size, align: 'center' });
  doc.font('Helvetica'); // drawInvoice's other text relies on the default font
  doc.restore();
  doc.link(x, y, size, size, url);
}

function drawInstagramIcon(doc, x, y, size, url) {
  const radius = size * 0.28;
  doc.save();
  const gradient = doc.linearGradient(x, y + size, x + size, y);
  gradient.stop(0, '#f9ce34').stop(0.5, '#ee2a7b').stop(1, '#6228d7');
  doc.roundedRect(x, y, size, size, radius).fill(gradient);
  doc.circle(x + size / 2, y + size / 2, size * 0.22).lineWidth(1.1).stroke('#ffffff');
  doc.circle(x + size * 0.76, y + size * 0.24, size * 0.05).fill('#ffffff');
  doc.restore();
  doc.link(x, y, size, size, url);
}

function drawInvoice(doc, data) {
  const { invoiceId, items, total, customerName, customerPhone, paymentMode, address, onlinePurchase } = data;

  // --- Header ---
  const hasLogo = fs.existsSync(LOGO_PATH);
  if (hasLogo) doc.image(LOGO_PATH, 40, 38, { width: 50 });
  const nameX = hasLogo ? 100 : 40;

  doc.fillColor(GOLD).fontSize(22).text(SHOP_NAME, nameX, 44);

  // Flowing (not fixed-y) layout below the name — shop address length
  // varies and can wrap to multiple lines, which would otherwise collide
  // with whatever's hardcoded to sit right below it.
  doc.fillColor(MUTED).fontSize(9);
  const contactWidth = 260;
  let contactY = 70;
  doc.text(SHOP_ADDRESS, nameX, contactY, { width: contactWidth });
  contactY += doc.heightOfString(SHOP_ADDRESS, { width: contactWidth }) + 2;
  if (SHOP_PHONE) {
    const line = `Phone: ${SHOP_PHONE}`;
    doc.text(line, nameX, contactY, { width: contactWidth });
    contactY += doc.heightOfString(line, { width: contactWidth }) + 2;
  }
  if (SHOP_EMAIL) {
    const line = `Email: ${SHOP_EMAIL}`;
    doc.text(line, nameX, contactY, { width: contactWidth });
    contactY += doc.heightOfString(line, { width: contactWidth }) + 2;
  }

  const iconSize = 14;
  const iconY = contactY + 4;
  drawFacebookIcon(doc, nameX, iconY, iconSize, FACEBOOK_URL);
  drawInstagramIcon(doc, nameX + iconSize + 8, iconY, iconSize, INSTAGRAM_URL);

  doc.fillColor(INK).fontSize(14).text('INVOICE', 400, 44, { align: 'right' });
  doc.fillColor(MUTED).fontSize(9).text(`Invoice #: ${invoiceId}`, 400, 64, { align: 'right' });
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 400, 78, { align: 'right' });

  const dividerY = Math.max(iconY + iconSize + 14, 108);
  doc.moveTo(40, dividerY).lineTo(555, dividerY).strokeColor('#dddddd').stroke();

  // --- Customer block ---
  const billedToY = dividerY + 16;
  doc.fillColor(INK).fontSize(11).text('Billed to', 40, billedToY);
  doc.fillColor(MUTED).fontSize(10);
  doc.text(customerName, 40, billedToY + 16);
  doc.text(customerPhone, 40, billedToY + 30);
  let customerBottomY = billedToY + 44;
  if (onlinePurchase && address) {
    const addrLine1 = `${address.line1}${address.line2 ? ', ' + address.line2 : ''}`;
    doc.text(addrLine1, 40, customerBottomY, { width: 300 });
    customerBottomY += doc.heightOfString(addrLine1, { width: 300 }) + 2;
    const addrLine2 = `${address.district}, ${address.state} - ${address.pin}`;
    doc.text(addrLine2, 40, customerBottomY, { width: 300 });
    customerBottomY += doc.heightOfString(addrLine2, { width: 300 }) + 2;
  }
  doc.text(`Payment mode: ${paymentMode}`, 400, billedToY, { align: 'right' });

  // --- Line items table ---
  // `quantity` is >1 for lot-tracked items (e.g. a batch of rings sold
  // together on one invoice) — printedPrice/finalPrice are always per-unit,
  // so the line total shown is finalPrice * quantity.
  let y = Math.max(customerBottomY + 16, 245);
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
