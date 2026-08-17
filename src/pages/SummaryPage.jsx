import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import shopConfig from '../config/shopConfig';
import { subscribeInventory, updateInventoryDoc, markPrinted } from '../utils/firestoreHelpers';
import { calcPrintedPrice, calcProfit, formatCurrency } from '../utils/calculations';
import { rangeFor, inRange } from '../utils/dateRanges';

const COLORS = ['#b8912f', '#8c1d2b', '#5c7a5f', '#8a6fae', '#3f6b8a', '#c98f3f'];

export default function SummaryPage() {
  const [rows, setRows] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [dateField, setDateField] = useState('created'); // 'created' | 'soldDate'
  const [period, setPeriod] = useState('fy'); // 'month' | 'quarter' | 'fy'
  const [chartView, setChartView] = useState('chart'); // 'chart' | 'table'
  const [columnFilters, setColumnFilters] = useState({});

  useEffect(() => subscribeInventory(setRows), []);

  const range = useMemo(() => rangeFor(period), [period]);

  const filteredByTopFilters = useMemo(() => {
    return rows.filter((r) => {
      if (categoryFilter !== 'All' && r.category !== categoryFilter) return false;
      const millis = dateField === 'created' ? r.createdAtMillis : r.soldDateMillis;
      return inRange(millis, range);
    });
  }, [rows, categoryFilter, dateField, range]);

  // ---- Summary stats ----
  const totalInvested = filteredByTopFilters.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const totalProfit = filteredByTopFilters
    .filter((r) => r.status === 'Sold')
    .reduce((s, r) => s + calcProfit(r.soldPrice, r.cost), 0);
  const totalItems = filteredByTopFilters.length;

  // ---- Profit % by category ----
  const profitByCategory = useMemo(() => {
    const byCat = {};
    filteredByTopFilters.forEach((r) => {
      if (!byCat[r.category]) byCat[r.category] = { cost: 0, profit: 0 };
      byCat[r.category].cost += Number(r.cost) || 0;
      if (r.status === 'Sold') byCat[r.category].profit += calcProfit(r.soldPrice, r.cost);
    });
    return Object.entries(byCat).map(([category, v]) => ({
      category,
      profitPercent: v.cost ? Number(((v.profit / v.cost) * 100).toFixed(1)) : 0
    }));
  }, [filteredByTopFilters]);

  // ---- Profit % by type, within the selected category ----
  const profitByType = useMemo(() => {
    if (categoryFilter === 'All') return [];
    const byType = {};
    filteredByTopFilters.forEach((r) => {
      if (!byType[r.type]) byType[r.type] = { cost: 0, profit: 0 };
      byType[r.type].cost += Number(r.cost) || 0;
      if (r.status === 'Sold') byType[r.type].profit += calcProfit(r.soldPrice, r.cost);
    });
    return Object.entries(byType).map(([type, v]) => ({
      type,
      profitPercent: v.cost ? Number(((v.profit / v.cost) * 100).toFixed(1)) : 0
    }));
  }, [filteredByTopFilters, categoryFilter]);

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
    return filteredByTopFilters.filter((r) => {
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
  }, [filteredByTopFilters, columnFilters]);

  async function handleCellEdit(row, colKey, newValue) {
    const patch = { [colKey]: colKey === 'name' ? newValue : Number(newValue) };
    if (colKey === 'boxPrice' || colKey === 'profitPercent') {
      const cost = colKey === 'cost' ? Number(newValue) : row.cost;
      const boxPrice = colKey === 'boxPrice' ? Number(newValue) : row.boxPrice;
      const profitPercent = colKey === 'profitPercent' ? Number(newValue) : row.profitPercent;
      patch.printedPrice = calcPrintedPrice(cost, profitPercent, boxPrice);
      patch.status = 'Purchased';
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
          <div className="label">Total Invested</div>
        </div>
        <div className="panel summary-stat">
          <div className="value">{formatCurrency(totalProfit)}</div>
          <div className="label">Total Profit</div>
        </div>
        <div className="panel summary-stat">
          <div className="value">{totalItems}</div>
          <div className="label">Number of Items</div>
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
        {chartView === 'chart' ? (
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
        <h2>% Profit by Type {categoryFilter !== 'All' ? `&mdash; ${categoryFilter}` : ''}</h2>
        {categoryFilter === 'All' ? (
          <p className="muted">Select a category above to see the breakdown by type.</p>
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
                        placeholder={col.filter === 'number' ? 'e.g. gt:100' : 'filter&mldr;'}
                        value={columnFilters[col.key] || ''}
                        onChange={(e) => setColFilter(col.key, e.target.value)}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detailRows.map((row) => (
                <tr key={row.id}>
                  {shopConfig.inventoryListColumns.map((col) => {
                    const editable = col.editable;
                    const val = row[col.key];
                    if (col.key === 'status') {
                      return (
                        <td key={col.key}>
                          <span className={`badge badge-${String(val).toLowerCase()}`}>{val}</span>
                        </td>
                      );
                    }
                    if (col.filter === 'date') {
                      const millis = col.key === 'created' ? row.createdAtMillis : row.soldDateMillis;
                      return <td key={col.key}>{millis ? new Date(millis).toLocaleDateString() : '\u2014'}</td>;
                    }
                    if (editable) {
                      return (
                        <td key={col.key}>
                          <input
                            className="filter-input"
                            style={{ marginTop: 0 }}
                            defaultValue={val}
                            onBlur={(e) => e.target.value !== String(val) && handleCellEdit(row, col.key, e.target.value)}
                          />
                        </td>
                      );
                    }
                    return <td key={col.key}>{typeof val === 'number' ? val.toLocaleString('en-IN') : (val ?? '&mdash;')}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
