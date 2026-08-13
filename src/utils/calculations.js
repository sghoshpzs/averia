// Printed Price = (Cost + Cost * %Profit/100) + Box Price
export function calcPrintedPrice(cost, profitPercent, boxPrice) {
  const c = Number(cost) || 0;
  const p = Number(profitPercent) || 0;
  const b = Number(boxPrice) || 0;
  return c + c * (p / 100) + b;
}

// Final Price = Printed Price - discount%
export function calcFinalPrice(printedPrice, discountPercent) {
  const pp = Number(printedPrice) || 0;
  const d = Number(discountPercent) || 0;
  return pp - pp * (d / 100);
}

export function calcProfit(soldPrice, cost) {
  const s = Number(soldPrice) || 0;
  const c = Number(cost) || 0;
  return s - c;
}

// 8-digit unique ID derived from the current timestamp (last 8 digits of ms
// epoch), collision risk is negligible for single-writer bulk-entry use.
export function generateRowId() {
  const ts = Date.now().toString();
  return ts.slice(-8);
}

export function generateSku(rowId) {
  return `SKU-${rowId}`;
}

export function formatCurrency(amount, symbol = '\u20B9') {
  const n = Number(amount) || 0;
  return `${symbol}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
