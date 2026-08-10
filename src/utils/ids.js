// Row IDs are 8 digits, derived from the current timestamp so they are
// naturally unique and roughly sortable by creation time.
export function generateRowId() {
  // Date.now() is 13 digits (ms since epoch). Take the last 8 digits,
  // then add a random single digit swap-in on collision risk within the
  // same millisecond loop (bulk inserts call this in a tight loop).
  const base = Date.now().toString().slice(-7);
  const rand = Math.floor(Math.random() * 10); // extra digit to avoid dupes in bulk loops
  return `${base}${rand}`;
}

export function generateSKU(rowId) {
  return `SKU-${rowId}`;
}

export function formattedTimestamp(date = new Date()) {
  // Matches sample data style: 8/5/2026 0:00:00
  const d = date;
  const datePart = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  const timePart = d.toLocaleTimeString("en-US", { hour12: false });
  return `${datePart} ${timePart}`;
}
