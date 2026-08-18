import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import shopConfig from '../config/shopConfig';
import { subscribeSales } from '../utils/firestoreHelpers';
import { calcProfit, formatCurrency } from '../utils/calculations';
import DateFilter, { useDateFilterState } from '../components/DateFilter';

const COLORS = ['#1f5fb5', '#c19a5a', '#1f7a5e', '#8a6fae', '#c92d39', '#3f6b8a'];
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

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

export default function SalesSummaryPage() {
  const [sales, setSales] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const dateFilter = useDateFilterState();
  const [chartGroupBy, setChartGroupBy] = useState('category'); // 'category' | 'vendor'
  const [sideTableGroupBy, setSideTableGroupBy] = useState('type'); // 'type' | 'vendor'
  const [columnFilters, setColumnFilters] = useState({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => subscribeSales(setSales), []);

  const salesInScope = useMemo(
    () => sales.filter((s) => (categoryFilter === 'All' || s.category === categoryFilter) && dateFilter.matches(s.soldDateMillis)),
    [sales, categoryFilter, dateFilter]
  );

  // ---- Top stats ----
  const totalSales = salesInScope.reduce((s, sale) => s + (Number(sale.soldPrice) || 0), 0);
  const totalProfit = salesInScope.reduce((s, sale) => s + calcProfit(sale.soldPrice, sale.cost), 0);
  const unitsSold = salesInScope.length;

  // ---- Chart: Sold amount by Category or by Vendor ----
  const chartData = useMemo(() => {
    const byGroup = {};
    salesInScope.forEach((s) => {
      const key = chartGroupBy === 'category' ? s.category : (s.vendor || 'Unknown');
      byGroup[key] = (byGroup[key] || 0) + (Number(s.soldPrice) || 0);
    });
    return Object.entries(byGroup).map(([label, sold]) => ({ label, sold: Number(sold.toFixed(2)) }));
  }, [salesInScope, chartGroupBy]);

  // ---- Side table: sold amount + %profit per Category, or per Type/Vendor
  // when a specific category is selected ----
  const sideTableRows = useMemo(() => {
    const byGroup = {};
    const key = (s) => (categoryFilter === 'All' ? s.category : (sideTableGroupBy === 'type' ? s.type : (s.vendor || 'Unknown')));
    salesInScope.forEach((s) => {
      const k = key(s);
      if (!byGroup[k]) byGroup[k] = { sold: 0, profit: 0, cost: 0 };
      byGroup[k].sold += Number(s.soldPrice) || 0;
      byGroup[k].profit += calcProfit(s.soldPrice, s.cost);
      byGroup[k].cost += Number(s.cost) || 0;
    });
    return Object.entries(byGroup).map(([label, v]) => ({
      label,
      sold: v.sold,
      profitPercent: v.cost ? Number(((v.profit / v.cost) * 100).toFixed(1)) : 0
    }));
  }, [salesInScope, categoryFilter, sideTableGroupBy]);

  // ---- Detail table with per-column filters ----
  function setColFilter(key, value) {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  }

  const filterOptions = (col) => {
    if (col.source === 'yesNo') return shopConfig.yesNo;
    const source = shopConfig[col.source];
    return Array.isArray(source) ? source : [];
  };

  const detailRows = useMemo(() => {
    return salesInScope.filter((s) => {
      return shopConfig.salesColumns.every((col) => {
        const raw = columnFilters[col.key];
        if (!raw) return true;
        let cellValue = s[col.key];
        if (col.key === 'profit') cellValue = calcProfit(s.soldPrice, s.cost);
        if (col.key === 'onlinePurchase') cellValue = s.onlinePurchase ? 'Yes' : 'No';
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
        if (col.filter === 'date') {
          return String(cellValue ?? '').toLowerCase().includes(raw.toLowerCase());
        }
        return String(cellValue ?? '').toLowerCase().includes(raw.toLowerCase());
      });
    });
  }, [salesInScope, columnFilters]);

  const totalPages = Math.max(1, Math.ceil(detailRows.length / pageSize));
  const pagedRows = useMemo(() => {
    const start = page * pageSize;
    return detailRows.slice(start, start + pageSize);
  }, [detailRows, page, pageSize]);

  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [totalPages, page]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Sales Summary</h1>
          <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
            Every completed sale, with revenue and margin by category, sub-category, and vendor.
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
          <div className="value">{formatCurrency(totalSales)}</div>
          <div className="label">Total Sales</div>
        </div>
        <div className="panel summary-stat">
          <div className="value">{formatCurrency(totalProfit)}</div>
          <div className="label">Total Profit</div>
        </div>
        <div className="panel summary-stat">
          <div className="value">{unitsSold}</div>
          <div className="label">Units Sold</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <h2>Sold Amount</h2>
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
              <p className="muted">No sales in this scope yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={chartData} dataKey="sold" nameKey="label" outerRadius={110} label>
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
                  <th>Sold Amount</th>
                  <th>% Profit</th>
                </tr>
              </thead>
              <tbody>
                {sideTableRows.map((r) => (
                  <tr key={r.label}><td>{r.label}</td><td>{formatCurrency(r.sold)}</td><td>{r.profitPercent}%</td></tr>
                ))}
                {sideTableRows.length === 0 && (
                  <tr><td colSpan={3} className="muted">No data yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <h2>Sales Detail ({detailRows.length})</h2>
        </div>
        <div className="summary-table-wrapper">
          <table className="data-table wide excel-table">
            <thead>
              <tr>
                {shopConfig.salesColumns.map((col) => (
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
              {pagedRows.map((s) => (
                <tr key={s.id}>
                  {shopConfig.salesColumns.map((col) => {
                    if (col.key === 'invoiceId') return <td key={col.key}>{s.invoiceId || s.invoiceRef || '\u2014'}</td>;
                    if (col.key === 'onlinePurchase') {
                      return (
                        <td key={col.key}>
                          <input type="checkbox" checked={Boolean(s.onlinePurchase)} readOnly />
                        </td>
                      );
                    }
                    if (col.key === 'profit') return <td key={col.key}>{formatCurrency(calcProfit(s.soldPrice, s.cost))}</td>;
                    if (col.key === 'soldDate') {
                      return <td key={col.key}>{s.soldDateMillis ? new Date(s.soldDateMillis).toLocaleDateString() : '\u2014'}</td>;
                    }
                    if (col.filter === 'number' && (col.key === 'printedPrice' || col.key === 'soldPrice')) {
                      return <td key={col.key}>{formatCurrency(s[col.key])}</td>;
                    }
                    if (col.key === 'discountPercent') return <td key={col.key}>{s.discountPercent || 0}%</td>;
                    const val = s[col.key];
                    return <td key={col.key}>{typeof val === 'number' ? val.toLocaleString('en-IN') : (val ?? '\u2014')}</td>;
                  })}
                </tr>
              ))}
              {pagedRows.length === 0 && (
                <tr><td colSpan={shopConfig.salesColumns.length} className="muted">No sales match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination-bar">
          <div className="field" style={{ maxWidth: 160 }}>
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
