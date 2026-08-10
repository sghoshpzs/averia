import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import appConfig from "../config/appConfig";

/**
 * Builds an invoice PDF in-memory and returns it as a base64 string
 * (no data: prefix) ready to hand to the sendInvoice Cloud Function,
 * plus a Blob for optional local preview/download.
 */
export function generateInvoicePdf({ invoiceId, customer, items }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const { shopName } = appConfig.brand;

  doc.setFontSize(18);
  doc.text(shopName, 40, 50);
  doc.setFontSize(11);
  doc.text(`Invoice #${invoiceId}`, 40, 70);
  doc.text(`Date: ${new Date().toLocaleString()}`, 40, 86);
  if (customer?.name) doc.text(`Customer: ${customer.name}`, 40, 102);
  if (customer?.phone) doc.text(`Phone: ${customer.phone}`, 40, 118);

  autoTable(doc, {
    startY: 135,
    head: [["Category", "Type", "Barcode", "Printed Price", "% Discount", "Final Price"]],
    body: items.map((it) => [
      it.category,
      it.type,
      it.barcode,
      formatCurrency(it.printedPrice),
      `${it.discountPct || 0}%`,
      formatCurrency(it.finalPrice),
    ]),
  });

  const finalY = doc.lastAutoTable.finalY || 150;
  const total = items.reduce((sum, it) => sum + (parseFloat(it.finalPrice) || 0), 0);
  doc.setFontSize(13);
  doc.text(`Total: ${formatCurrency(total)}`, 40, finalY + 30);

  const base64 = doc.output("datauristring").split(",")[1];
  const blob = doc.output("blob");
  return { base64, blob, total };
}

function formatCurrency(n) {
  return `${appConfig.currencySymbol}${(parseFloat(n) || 0).toFixed(2)}`;
}
