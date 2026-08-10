// Every readonly field in appConfig.js points at a function name here.
// Add a new formula, then reference its name from a field's "formula" key -
// no page component needs to change.

export function computePrintedPrice(values) {
  const cost = parseFloat(values.cost) || 0;
  const profitPct = parseFloat(values.profitPct) || 0;
  const boxPrice = parseFloat(values.boxPrice) || 0;
  const itemPrice = cost + cost * (profitPct / 100);
  return round2(itemPrice + boxPrice);
}

export function computeFinalPrice(values) {
  const printedPrice = parseFloat(values.printedPrice) || 0;
  const discountPct = parseFloat(values.discountPct) || 0;
  return round2(printedPrice - printedPrice * (discountPct / 100));
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const formulas = { computePrintedPrice, computeFinalPrice };
export default formulas;
