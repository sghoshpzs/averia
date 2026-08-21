// Shared "export table to CSV" helper — used by the export button on every
// detail table. Quotes any cell containing a comma, quote, or newline so
// values like addresses or names with commas don't corrupt columns.
function escapeCsvCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// columns: [{ label, get: (row) => cellValue }]
export function exportRowsToCsv(filenamePrefix, columns, rows) {
  const lines = [
    columns.map((c) => escapeCsvCell(c.label)).join(','),
    ...rows.map((row) => columns.map((c) => escapeCsvCell(c.get(row))).join(','))
  ];
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenamePrefix}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
