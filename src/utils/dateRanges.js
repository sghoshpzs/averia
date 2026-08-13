// Indian financial year: April 1 - March 31.
export function currentFYRange(now = new Date()) {
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { start: new Date(year, 3, 1), end: new Date(year + 1, 2, 31, 23, 59, 59) };
}

export function currentMonthRange(now = new Date()) {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  };
}

export function currentQuarterRange(now = new Date()) {
  const q = Math.floor(now.getMonth() / 3);
  return {
    start: new Date(now.getFullYear(), q * 3, 1),
    end: new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59)
  };
}

export function rangeFor(periodKey) {
  if (periodKey === 'month') return currentMonthRange();
  if (periodKey === 'quarter') return currentQuarterRange();
  return currentFYRange(); // 'fy' default
}

export function inRange(millis, range) {
  if (!millis) return false;
  return millis >= range.start.getTime() && millis <= range.end.getTime();
}
