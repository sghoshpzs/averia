import { Fragment, useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import shopConfig from '../config/shopConfig';
import { subscribeInventory, subscribeSales, updateInventoryDoc, markPrinted } from '../utils/firestoreHelpers';
import { calcPrintedPrice, calcProfit, formatCurrency } from '../utils/calculations';
import { rangeFor, inRange } from '../utils/dateRanges';

const COLORS = ['#b8912f', '#8c1d2b', '#5c7a5f', '#8a6fae', '#3f6b8a', '#c98f3f'];

export default function SummaryPage() {
  const [rows, setRows] = useState([]);
  const [sales, setSales] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [dateField, setDateField] = useState('created'); // 'created' | 'soldDate'
  const [period, setPeriod] = useState('fy'); // 'month' | 'quarter' | 'fy'
  const [chartView, setChartView] = useState('chart'); // 'chart' | 'table'
  const [columnFilters, setColumnFilters] = useState({});
  const [expandedLots, setExpandedLots] = useState({});

  useEffect(() => subscribeInventory(setRows), []);
  useEffect(() => subscribeSales(setSales), []);

  const range = useMemo(() => rangeFor(period), [period]);

  const inventoryInScope = useMemo(
    () => rows.filter((r) => categoryFilter === 'All' || r.category === categoryFilter),
    [rows, categoryFilter]
  );
  const salesInScope = useMemo(
    () => sales.filter((s) => categoryFilter === 'All' || s.category === categoryFilter),
    [sales, categoryFilter]
  );

  // ---- Two ways to read "in range", depending on which date the toggle points at ----
  // 'created'  -> filter inventory by purchase date, then only count sales
  //               whose underlying inventory doc falls in that filtered set.
  // 'soldDate' -> filter sales by sale date directly (this is what actually
  //               answers "what sold in this period"), then only show
  //               inventory rows that had at least one of those sales. Lot
  //               docs can have sales spread across many periods, so a lot's
  //               cost is never double counted here — see costOfGoodsSold.
  const { filteredInventory, filteredSales } = useMemo(() => {
    if (dateField === 'created') {
      const invRows = inventoryInScope.filter((r) => inRange(r.createdAtMillis, range));
      const invIds = new Set(invRows.map((r) => r.id));
      return { filteredInventory: invRows, filteredSales: salesInScope.filter((s) => invIds.has(s.inventoryDocId)) };
    }
    const saleRows = salesInScope.filter((s) => inRange(s.soldDateMillis, range));
    const soldInvIds = new Set(saleRows.map((s) => s.inventoryDocId));
    return { filteredInventory: inventoryInScope.filter((r) => soldInvIds.has(r.id)), filteredSales: saleRows };
  }, [inventoryInScope, salesInScope, dateField, range]);

  // ---- Summary stats ----
  // "Total Invested" only really means "cost of stock purchased in this
  // period" when dateField is 'created'. In 'soldDate' mode we show cost of
  // goods actually sold in the period instead (summed straight from each
  // sale's cost snapshot, so a lot's cost is per-unit, not double-counted).
  const totalInvested = dateField === 'created'
    ? filteredInventory.reduce((s, r) => s + (Number(r.cost) || 0) * (Number(r.quantityPurchased) || 1), 0)
    : filteredSales.reduce((s, sale) => s + (Number(sale.cost) || 0), 0);
  const investedLabel = dateField === 'created' ? 'Total Invested' : 'Cost of Goods Sold';

  const totalProfit = filteredSales.reduce((s, sale) => s + calcProfit(sale.soldPrice, sale.cost), 0);

  const totalItems = dateField === 'created'
    ? filteredInventory.reduce((s, r) => s + (Number(r.quantityPurchased) || 1), 0)
    : filteredSales.length;
  const itemsLabel = dateField === 'created' ? 'Units Purchased' : 'Units Sold';

  // ---- Profit % by category (always computed from actual sale events) ----
  const profitByCategory = useMemo(() => {
    const byCat = {};
    filteredSales.forEach((s) => {
      if (!byCat[s.category]) byCat[s.category] = { cost: 0, profit: 0 };
      byCat[s.category].cost += Number(s.cost) || 0;
      byCat[s.category].profit += calcProfit(s.soldPrice, s.cost);
    });
    return Object.entries(byCat).map(([category, v]) => ({
      category,
      profitPercent: v.cost ? Number(((v.profit / v.cost) * 100).toFixed(1)) : 0
    }));
  }, [filteredSales]);

  // ---- Profit % by type, within the selected category ----
  const profitByType = useMemo(() => {
    if (categoryFilter === 'All') return [];
    const byType = {};
    filteredSales.forEach((s) => {
      if (!byType[s.type]) byType[s.type] = { cost: 0, profit: 0 };
      byType[s.type].cost += Number(s.cost) || 0;
      byType[s.type].profit += calcProfit(s.soldPrice, s.cost);
    });
    return Object.entries(byType).map(([type, v]) => ({
      type,
      profitPercent: v.cost ? Number(((v.profit / v.cost) * 100).toFixed(1)) : 0
    }));
  }, [filteredSales, categoryFilter]);

  // ---- Detail list with per-column filters ----
  function setColFilter(key, value) {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
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
    return filteredInventory.filter((r) => {
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
        // text / date: substring match
        return String(cellValue ?? '').toLowerCase().includes(raw.toLowerCase());
      });
    });
  }, [filteredInventory, columnFilters]);

  // Sales belonging to a given lot, most recent first — used in the
  // expandable row under each lot-tracked inventory row.
  const salesByLot = useMemo(() => {
    const map = {};
    sales.forEach((s) => {
      if (!s.inventoryDocId) return;
      if (!map[s.inventoryDocId]) map[s.inventoryDocId] = [];
      map[s.inventoryDocId].push(s);
    });
    return map;
  }, [sales]);

  function toggleLotExpand(id) {
    setExpandedLots((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleCellEdit(row, colKey, newValue) {
    const patch = { [colKey]: colKey === 'name' ? newValue : Number(newValue) };
    if (colKey === 'boxPrice' || colKey === 'profitPercent') {
      const cost = colKey === 'cost' ? Number(newValue) : row.cost;
      const boxPrice = colKey === 'boxPrice' ? Number(newValue) : row.boxPrice;
      const profitPercent = colKey === 'profitPercent' ? Number(newValue) : row.profitPercent;
      patch.printedPrice = calcPrintedPrice(cost, profitPercent, boxPrice);
      if (!row.isLot || (Number(row.quantityRemaining) || 0) === (Number(row.quantityPurchased) || 1)) {
        // Only reset a lot back to "Purchased" if nothing has sold from it
        // yet — otherwise a lot that's half-sold would incorrectly look
        // unsold again just because you tweaked its box price.
        patch.status = 'Purchased';
      }
    }
    await updateInventoryDoc(row.id, patch);
  }

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
            Review high level profitability, category performance, and editable inventory details in one place.
          </p>
        </div>

        <div className="field-grid" style={{ maxWidth: 760, width: '100%', margin: 0, flex: '1 1 420px' }}>
          <div className="field">
            <label>Category</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="All">All</option>
              {shopConfig.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="month">Last month</option>
              <option value="quarter">Last quarter</option>
              <option value="fy">Current FY</option>
            </select>
          </div>
          <div className="field">
            <label>Date field</label>
            <select value={dateField} onChange={(e) => setDateField(e.target.value)}>
              <option value="created">Created date</option>
              <option value="soldDate">Sold date</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid-3">
        <div className="panel summary-stat">
          <div className="value">{formatCurrency(totalInvested)}</div>
          <div className="label">{investedLabel}</div>
        </div>
        <div className="panel summary-stat">
          <div className="value">{formatCurrency(totalProfit)}</div>
          <div className="label">Total Profit</div>
        </div>
        <div className="panel summary-stat">
          <div className="value">{totalItems}</div>
          <div className="label">{itemsLabel}</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <h2>% Profit by Category</h2>
          <div className="pill-toggle">
            <button type="button" className={chartView === 'chart' ? 'active' : ''} onClick={() => setChartView('chart')}>Chart</button>
            <button type="button" className={chartView === 'table' ? 'active' : ''} onClick={() => setChartView('table')}>Table</button>
          </div>
        </div>
        {profitByCategory.length === 0 ? (
          <p className="muted">No sales recorded yet in this range.</p>
        ) : chartView === 'chart' ? (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={profitByCategory} dataKey="profitPercent" nameKey="category" outerRadius={100} label>
                {profitByCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => `${v}%`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <table className="data-table">
            <thead><tr><th>Category</th><th>% Profit</th></tr></thead>
            <tbody>
              {profitByCategory.map((r) => <tr key={r.category}><td>{r.category}</td><td>{r.profitPercent}%</td></tr>)}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>% Profit by Type {categoryFilter !== 'All' ? `— ${categoryFilter}` : ''}</h2>
        {categoryFilter === 'All' ? (
          <p className="muted">Select a category above to see the breakdown by type.</p>
        ) : profitByType.length === 0 ? (
          <p className="muted">No sales recorded yet in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={profitByType}>
              <XAxis dataKey="type" stroke="#8a7f70" />
              <YAxis stroke="#8a7f70" />
              <Tooltip formatter={(v) => `${v}%`} />
              <Bar dataKey="profitPercent" fill="#8c1d2b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <h2>Inventory Detail ({detailRows.length})</h2>
          <button type="button" className="btn btn-secondary" onClick={handlePrintCsv} disabled={detailRows.length === 0}>
            Print (CSV) &amp; mark Printed
          </button>
        </div>
        <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
          Rows with a gold "lot" badge share one barcode across multiple units — click the row to see each individual sale.
        </p>
        <div className="summary-table-wrapper">
          <table className="data-table wide excel-table">
            <thead>
              <tr>
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
                        placeholder={col.filter === 'number' ? 'e.g. gt:100' : 'filter…'}
                        value={columnFilters[col.key] || ''}
                        onChange={(e) => setColFilter(col.key, e.target.value)}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detailRows.map((row) => {
                const lotSales = row.isLot ? (salesByLot[row.id] || []) : [];
                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={row.isLot ? () => toggleLotExpand(row.id) : undefined}
                      style={row.isLot ? { cursor: 'pointer' } : undefined}
                    >
                      {shopConfig.inventoryListColumns.map((col) => {
                        const editable = col.editable;
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
                          return <td key={col.key}>{row.isLot ? (val ?? 0) : (col.key === 'quantityPurchased' ? 1 : '—')}</td>;
                        }
                        if (col.key === 'soldPrice') {
                          if (row.isLot) {
                            const soldCount = (row.quantityPurchased || 0) - (row.quantityRemaining || 0);
                            return <td key={col.key}>{soldCount > 0 ? `${soldCount} sold` : '—'}</td>;
                          }
                          return <td key={col.key}>{val ? formatCurrency(val) : '—'}</td>;
                        }
                        if (col.key === 'status') {
                          return (
                            <td key={col.key}>
                              <span className={`badge badge-${String(val).toLowerCase()}`}>{val}</span>
                            </td>
                          );
                        }
                        if (col.filter === 'date') {
                          if (col.key === 'soldDate') {
                            if (row.isLot) return <td key={col.key}>see rows below</td>;
                            return <td key={col.key}>{row.soldDateMillis ? new Date(row.soldDateMillis).toLocaleDateString() : '—'}</td>;
                          }
                          const millis = row.createdAtMillis;
                          return <td key={col.key}>{millis ? new Date(millis).toLocaleDateString() : '—'}</td>;
                        }
                        if (editable) {
                          return (
                            <td key={col.key}>
                              <input
                                className="filter-input"
                                style={{ marginTop: 0 }}
                                defaultValue={val}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) => e.target.value !== String(val) && handleCellEdit(row, col.key, e.target.value)}
                              />
                            </td>
                          );
                        }
                        return <td key={col.key}>{typeof val === 'number' ? val.toLocaleString('en-IN') : (val ?? '—')}</td>;
                      })}
                    </tr>
                    {row.isLot && expandedLots[row.id] && (
                      <tr key={`${row.id}-expand`}>
                        <td colSpan={shopConfig.inventoryListColumns.length} style={{ background: 'var(--surface-sunken)' }}>
                          {lotSales.length === 0 ? (
                            <span className="muted">No units sold from this lot yet.</span>
                          ) : (
                            <table className="data-table" style={{ margin: '6px 0' }}>
                              <thead><tr><th>Sold Date</th><th>Sold Price</th><th>Profit</th></tr></thead>
                              <tbody>
                                {lotSales.map((s) => (
                                  <tr key={s.id}>
                                    <td>{s.soldDateMillis ? new Date(s.soldDateMillis).toLocaleDateString() : '—'}</td>
                                    <td>{formatCurrency(s.soldPrice)}</td>
                                    <td>{formatCurrency(calcProfit(s.soldPrice, s.cost))}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
