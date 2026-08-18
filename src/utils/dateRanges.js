// Indian financial year: April 1 - March 31.

export function fyStartYearOf(date = new Date()) {
  return date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
}

export function fyLabel(startYear) {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

// FY dropdown lists 2026-27 onward (the shop's first tracked year) through a
// handful of future years, always extending far enough to include whichever
// FY is current.
const FY_BASE_YEAR = 2026;
const FY_FUTURE_SPAN = 6;

export function fyOptions() {
  const currentStart = fyStartYearOf();
  const endYear = Math.max(currentStart, FY_BASE_YEAR) + FY_FUTURE_SPAN;
  const options = [];
  for (let y = FY_BASE_YEAR; y <= endYear; y++) {
    options.push({ value: fyLabel(y), label: fyLabel(y) });
  }
  return options;
}

export const MONTH_OPTIONS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
].map((label, value) => ({ value, label }));

export const QUARTER_OPTIONS = [
  { value: 1, label: 'Q1 (Apr–Jun)' },
  { value: 2, label: 'Q2 (Jul–Sep)' },
  { value: 3, label: 'Q3 (Oct–Dec)' },
  { value: 4, label: 'Q4 (Jan–Mar)' }
];

export function quarterOfFY(date = new Date()) {
  const month = date.getMonth(); // 0-11
  if (month >= 3 && month <= 5) return 1;
  if (month >= 6 && month <= 8) return 2;
  if (month >= 9 && month <= 11) return 3;
  return 4; // Jan-Mar
}

export function defaultDateFilterSelections() {
  const now = new Date();
  return {
    fys: new Set([fyLabel(fyStartYearOf(now))]),
    months: new Set([now.getMonth()]),
    quarters: new Set([quarterOfFY(now)])
  };
}

// Each dimension only restricts the match when it has at least one value
// selected — an emptied-out selection means "no restriction" on that
// dimension rather than "matches nothing".
export function matchesDateFilter(millis, { fys, months, quarters }) {
  if (!millis) return false;
  const d = new Date(millis);
  if (fys && fys.size > 0 && !fys.has(fyLabel(fyStartYearOf(d)))) return false;
  if (months && months.size > 0 && !months.has(d.getMonth())) return false;
  if (quarters && quarters.size > 0 && !quarters.has(quarterOfFY(d))) return false;
  return true;
}
