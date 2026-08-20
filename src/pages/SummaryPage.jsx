import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import shopConfig from '../config/shopConfig';
import { subscribeInventory, updateInventoryDoc, markPrinted, deleteInventoryDocs } from '../utils/firestoreHelpers';
import { calcPrintedPrice, formatCurrency } from '../utils/calculations';
import { isSuperUser } from '../utils/auth';
import DateFilter, { useDateFilterState } from '../components/DateFilter';

const COLORS = ['#1f5fb5', '#c19a5a', '#1f7a5e', '#8a6fae', '#c92d39', '#3f6b8a'];
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

// Small text-link toggle used for "only one view at a time, switched by
// clicking a hyperlink" controls (chart grouping, side-table view).
function LinkToggle({ options, value, onChange }) {
  return (
    <span className="link-toggle-group">
      {options.map((opt, i) => (
        <span key={opt.value} style={{ display: 'inline-flex', alignItems: 'center' }}>
          {i > 0 && <span className="link-toggle-sep">|</span>}
          <a
            className={`link-toggle${value === opt.value ? ' active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </a>
        </span>
      ))}
    </span>
  );
}

export default function SummaryPage() {
  const [rows, setRows] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const dateFilter = useDateFilterState();
  const [chartGroupBy, setChartGroupBy] = useState('category'); // 'category' | 'vendor'
  const [sideTableGroupBy, setSideTableGroupBy] = useState('type'); // 'type' | 'vendor' (only when a category is selected)
  const [columnFilters, setColumnFilters] = useState({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const canDelete = isSuperUser();

  useEffect(() => subscribeInventory(setRows), []);

  const inventoryInScope = useMemo(
    () => rows.filter((r) => (categoryFilter === 'All' || r.category === categoryFilter) && dateFilter.matches(r.createdAtMillis)),
    [rows, categoryFilter, dateFilter]
  );

  // ---- Summary stats — inventory-derived, scoped by the date filter above;
  // no profit here (that lives on Sales Summary instead) ----
  const totalInvested = inventoryInScope.reduce(
    (s, r) => s + (Number(r.cost) || 0) * (Number(r.quantityPurchased) || 1),
    0
  );
  const unitsPurchased = inventoryInScope.reduce((s, r) => s + (Number(r.quantityPurchased) || 1), 0);
  const unitsSold = inventoryInScope.reduce((s, r) => {
    if (r.isLot) return s + ((Number(r.quantityPurchased) || 0) - (Number(r.quantityRemaining) || 0));
    return s + (r.status === 'Sold' ? 1 : 0);
  }, 0);

  // ---- Chart: Invested amount by Category or by Vendor ----
  const chartData = useMemo(() => {
    const byGroup = {};
    inventoryInScope.forEach((r) => {
      const key = chartGroupBy === 'category' ? r.category : (r.vendor || 'Unknown');
      const amount = (Number(r.cost) || 0) * (Number(r.quantityPurchased) || 1);
      byGroup[key] = (byGroup[key] || 0) + amount;
    });
    return Object.entries(byGroup).map(([label, invested]) => ({ label, invested: Number(invested.toFixed(2)) }));
  }, [inventoryInScope, chartGroupBy]);

  // ---- Side table: invested amount per Category, or per Type/Vendor when
  // a specific category is selected (the "alternate view") ----
  const sideTableRows = useMemo(() => {
    if (categoryFilter === 'All') {
      const byCat = {};
      inventoryInScope.forEach((r) => {
        const amount = (Number(r.cost) || 0) * (Number(r.quantityPurchased) || 1);
        byCat[r.category] = (byCat[r.category] || 0) + amount;
      });
      return Object.entries(byCat).map(([label, invested]) => ({ label, invested }));
    }
    const byGroup = {};
    inventoryInScope.forEach((r) => {
      const key = sideTableGroupBy === 'type' ? r.type : (r.vendor || 'Unknown');
      const amount = (Number(r.cost) || 0) * (Number(r.quantityPurchased) || 1);
      byGroup[key] = (byGroup[key] || 0) + amount;
    });
    return Object.entries(byGroup).map(([label, invested]) => ({ label, invested }));
  }, [inventoryInScope, categoryFilter, sideTableGroupBy]);

  // ---- Detail list with per-column filters ----
  function setColFilter(key, value) {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  }

  const filterOptions = (col) => {
    if (col.key === 'type') {
      return Array.from(new Set(Object.values(shopConfig.types).flat())).sort();
    }
    if (col.key === 'vendor') {
      return shopConfig.vendors;
    }
    const source = shopConfig[col.source];
    return Array.isArray(source) ? source : [];
  };

  const detailRows = useMemo(() => {
    return inventoryInScope.filter((r) => {
      return shopConfig.inventoryListColumns.every((col) => {
        const raw = columnFilters[col.key];
        if (!raw) return true;
        const cellValue = r[col.key];
        if (col.filter === 'number') {
          const m = raw.match(/^(gt|lt|eq)?:?\s*(-?\d+(\.\d+)?)$/i);
          if (!m) return true;
          const op = (m[1] || 'eq').toLowerCase();
          const target = Number(m[2]);
          const cv = Number(cellValue) || 0;
          if (op === 'gt') return cv > target;
          if (op === 'lt') return cv < target;
          return cv === target;
        }
        if (col.filter === 'select') {
          return String(cellValue) === raw;
        }
        return String(cellValue ?? '').toLowerCase().includes(raw.toLowerCase());
      });
    });
  }, [inventoryInScope, columnFilters]);

  const totalPages = Math.max(1, Math.ceil(detailRows.length / pageSize));
  const pagedRows = useMemo(() => {
    const start = page * pageSize;
    return detailRows.slice(start, start + pageSize);
  }, [detailRows, page, pageSize]);

  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [totalPages, page]);

  const allOnPageSelected = pagedRows.length > 0 && pagedRows.every((r) => selectedIds.has(r.id));

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        pagedRows.forEach((r) => next.delete(r.id));
      } else {
        pagedRows.forEach((r) => next.add(r.id));
      }
      return next;
    });
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected inventory row(s)? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteInventoryDocs([...selectedIds]);
      setSelectedIds(new Set());
    } finally {
      setDeleting(false);
    }
  }

  async function handleCellEdit(row, colKey, newValue) {
    const patch = { [colKey]: colKey === 'name' ? newValue : Number(newValue) };
    if (colKey === 'boxPrice' || colKey === 'profitPercent') {
      const cost = colKey === 'cost' ? Number(newValue) : row.cost;
      const boxPrice = colKey === 'boxPrice' ? Number(newValue) : row.boxPrice;
      const profitPercent = colKey === 'profitPercent' ? Number(newValue) : row.profitPercent;
      patch.printedPrice = calcPrintedPrice(cost, profitPercent, boxPrice);
      if (!row.isLot || (Number(row.quantityRemaining) || 0) === (Number(row.quantityPurchased) || 1)) {
        patch.status = 'Purchased';
      }
    }
    await updateInventoryDoc(row.id, patch);
  }

  // CSV export always covers every row matching the current filters, not
  // just the page currently on screen — pagination is a viewing convenience
  // only, it doesn't narrow what gets printed/marked.
  async function handlePrintCsv() {
    const csvRows = [['row_id', 'printed_price'], ...detailRows.map((r) => [r.rowId, r.printedPrice])];
    const csv = csvRows.map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-print-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await markPrinted(detailRows.map((r) => r.id));
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Inventory Summary</h1>
          <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
            Current stock on hand — what you've invested, how much has sold, and where it's concentrated.
          </p>
        </div>

        <div className="filter-bar-row">
          <DateFilter state={dateFilter} />
          <div className="field category-filter-field">
            <label>Category</label>
            <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}>
              <option value="All">All</option>
              {shopConfig.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="grid-3">
        <div className="panel summary-stat">
          <div className="value">{formatCurrency(totalInvested)}</div>
          <div className="label">Total Invested</div>
        </div>
        <div className="panel summary-stat">
          <div className="value">{unitsPurchased}</div>
          <div className="label">Units Purchased</div>
        </div>
        <div className="panel summary-stat">
          <div className="value">{unitsSold}</div>
          <div className="label">Units Sold</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <h2>Invested Amount</h2>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <LinkToggle
              value={chartGroupBy}
              onChange={setChartGroupBy}
              options={[{ value: 'category', label: 'Category' }, { value: 'vendor', label: 'Vendor' }]}
            />
          </div>
        </div>

        <div className="chart-with-table">
          <div>
            {chartData.length === 0 ? (
              <p className="muted">No inventory in this scope yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={chartData} dataKey="invested" nameKey="label" outerRadius={110} label>
                    {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="side-table-wrap">
            <div className="panel-title-row" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>
                {categoryFilter === 'All' ? 'Category' : `${categoryFilter} breakdown`}
              </h3>
              {categoryFilter !== 'All' && (
                <LinkToggle
                  value={sideTableGroupBy}
                  onChange={setSideTableGroupBy}
                  options={[{ value: 'type', label: 'Type' }, { value: 'vendor', label: 'Vendor' }]}
                />
              )}
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{categoryFilter === 'All' ? 'Category' : (sideTableGroupBy === 'type' ? 'Type' : 'Vendor')}</th>
                  <th>Invested</th>
                </tr>
              </thead>
              <tbody>
                {sideTableRows.map((r) => (
                  <tr key={r.label}><td>{r.label}</td><td>{formatCurrency(r.invested)}</td></tr>
                ))}
                {sideTableRows.length === 0 && (
                  <tr><td colSpan={2} className="muted">No data yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <h2>Inventory Detail ({detailRows.length})</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" className="btn btn-secondary" onClick={handlePrintCsv} disabled={detailRows.length === 0}>
              Print CSV
            </button>
            {selectedIds.size > 0 && <span className="muted">{selectedIds.size} selected</span>}
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleDeleteSelected}
              disabled={!canDelete || selectedIds.size === 0 || deleting}
              title={canDelete ? undefined : 'Only the super user account can delete inventory.'}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
          Rows with a gold "lot" badge share one barcode across multiple units.
        </p>
        <div className="summary-table-wrapper">
          <table className="data-table wide excel-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} /></th>
                {shopConfig.inventoryListColumns.map((col) => (
                  <th key={col.key}>
                    {col.label}
                    {col.filter === 'select' ? (
                      <select className="filter-input" value={columnFilters[col.key] || ''} onChange={(e) => setColFilter(col.key, e.target.value)}>
                        <option value="">Any</option>
                        {filterOptions(col).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        className="filter-input"
                        placeholder={col.filter === 'number' ? 'e.g. gt:100' : 'filter\u2026'}
                        value={columnFilters[col.key] || ''}
                        onChange={(e) => setColFilter(col.key, e.target.value)}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row) => (
                <tr key={row.id}>
                  <td><input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleRow(row.id)} /></td>
                  {shopConfig.inventoryListColumns.map((col) => {
                    const editable = col.editable && row.status !== 'Sold';
                    const val = row[col.key];

                    if (col.key === 'rowId') {
                      return (
                        <td key={col.key}>
                          {val}
                          {row.isLot && <span className="badge badge-printed" style={{ marginLeft: 6 }}>lot × {row.quantityPurchased}</span>}
                        </td>
                      );
                    }
                    if (col.key === 'quantityPurchased' || col.key === 'quantityRemaining') {
                      return <td key={col.key}>{row.isLot ? (val ?? 0) : (col.key === 'quantityPurchased' ? 1 : '\u2014')}</td>;
                    }
                    if (col.key === 'status') {
                      return (
                        <td key={col.key}>
                          <span className={`badge badge-${String(val).toLowerCase()}`}>{val}</span>
                        </td>
                      );
                    }
                    if (col.filter === 'date') {
                      const millis = row.createdAtMillis;
                      return <td key={col.key}>{millis ? new Date(millis).toLocaleDateString() : '\u2014'}</td>;
                    }
                    if (editable) {
                      return (
                        <td key={col.key}>
                          <input
                            className={`filter-input${col.key === 'name' ? ' plain' : ''}`}
                            style={{ marginTop: 0 }}
                            defaultValue={val}
                            onBlur={(e) => e.target.value !== String(val) && handleCellEdit(row, col.key, e.target.value)}
                          />
                        </td>
                      );
                    }
                    return <td key={col.key}>{typeof val === 'number' ? val.toLocaleString('en-IN') : (val ?? '\u2014')}</td>;
                  })}
                </tr>
              ))}
              {pagedRows.length === 0 && (
                <tr><td colSpan={shopConfig.inventoryListColumns.length + 1} className="muted">No rows match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination-bar">
          <div className="field rows-per-page-field">
            <label>Rows per page</label>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}>
              {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="pagination-nav">
            <button type="button" className="btn btn-secondary" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</button>
            <span>Page {page + 1} of {totalPages}</span>
            <button type="button" className="btn btn-secondary" disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
