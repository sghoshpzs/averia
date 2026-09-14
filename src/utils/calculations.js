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

// Real cost is unknown for sales with no inventory link (manual/"NA"
// barcode entries — the item was never in the inventory system, so no cost
// was ever recorded anywhere for it). Treating that as ₹0 cost would
// overstate profit to the full sale price, so this falls back to an
// estimate instead: the shop's own pricing rule is printed price ≈ 2×cost
// (+ box price) at the default 100% profit margin (see calcPrintedPrice),
// so half of printed price is used as the best available stand-in — only
// when cost is genuinely missing, never overriding a real recorded cost.
export function calcProfit(soldPrice, cost, printedPrice) {
  const s = Number(soldPrice) || 0;
  if (cost == null) {
    return s - (Number(printedPrice) || 0) * 0.5;
  }
  return s - (Number(cost) || 0);
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

// Ascending, case-insensitive sort for dropdown option lists — returns a new
// array so the source config array's original order (some of it meaningful,
// e.g. ExpensesPage's default new-expense category) is left untouched.
export function sortAsc(list) {
  return [...list].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
}

// YYYY-MM-DD everywhere a date is displayed, instead of toLocaleDateString()
// (whose format silently changes with the viewer's browser locale).
export function formatDate(millisOrDate) {
  if (!millisOrDate) return '';
  const d = millisOrDate instanceof Date ? millisOrDate : new Date(millisOrDate);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
