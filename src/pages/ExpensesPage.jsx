import { useEffect, useMemo, useState } from 'react';
import shopConfig from '../config/shopConfig';
import { subscribeExpenses, addExpense, deleteExpenses } from '../utils/firestoreHelpers';
import { formatCurrency } from '../utils/calculations';
import { isSuperUser } from '../utils/auth';
import DateFilter, { useDateFilterState } from '../components/DateFilter';
import { exportRowsToCsv } from '../utils/exportCsv';

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

const emptyForm = {
  category: shopConfig.expenseCategories[0],
  description: '',
  amount: '',
  date: todayInputValue()
};

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const dateFilter = useDateFilterState();
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const canDelete = isSuperUser();

  useEffect(() => subscribeExpenses(setExpenses), []);

  const expensesInScope = useMemo(
    () => expenses.filter((e) => (categoryFilter === 'All' || e.category === categoryFilter) && dateFilter.matches(e.dateMillis)),
    [expenses, categoryFilter, dateFilter]
  );

  const totalCost = expensesInScope.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const allOnScreenSelected = expensesInScope.length > 0 && expensesInScope.every((e) => selectedIds.has(e.id));

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allOnScreenSelected) {
        const next = new Set(prev);
        expensesInScope.forEach((e) => next.delete(e.id));
        return next;
      }
      const next = new Set(prev);
      expensesInScope.forEach((e) => next.add(e.id));
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage(null);
    if (!form.category || !form.amount || !form.date) {
      setMessage({ type: 'error', text: 'Category, amount, and date are required.' });
      return;
    }
    setSaving(true);
    try {
      await addExpense({
        category: form.category,
        description: form.description,
        amount: Number(form.amount),
        dateMillis: new Date(form.date).getTime()
      });
      setMessage({ type: 'success', text: 'Expense saved.' });
      setForm({ ...emptyForm, date: form.date });
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  }

  function handleExportCsv() {
    const columns = shopConfig.expenseColumns.map((col) => ({
      label: col.label,
      get: (e) => (col.key === 'date' ? (e.dateMillis ? new Date(e.dateMillis).toLocaleDateString() : '') : e[col.key] ?? '')
    }));
    exportRowsToCsv('expenses-export', columns, expensesInScope);
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected expense(s)? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteExpenses([...selectedIds]);
      setSelectedIds(new Set());
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Ad-Hoc Expenses</h1>
          <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>
            Track shop overhead — rent, electricity, repairs, and other one-off costs.
          </p>
        </div>
        <div className="filter-bar-row">
          <DateFilter state={dateFilter} />
          <div className="field category-filter-field">
            <label>Category</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="All">All</option>
              {shopConfig.expenseCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="panel summary-stat" style={{ maxWidth: 280 }}>
        <div className="value">{formatCurrency(totalCost)}</div>
        <div className="label">Total Expenses</div>
      </div>

      <form className="panel" onSubmit={handleSubmit}>
        <div className="field-grid">
          <div className="field">
            <label>Category</label>
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {shopConfig.expenseCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Description</label>
            <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="field">
            <label>Amount</label>
            <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="opaque" />
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="opaque" />
          </div>
        </div>

        {message && (
          <p style={{ marginTop: 14, color: message.type === 'error' ? '#b3372c' : '#2f7a4f' }}>{message.text}</p>
        )}

        <div style={{ marginTop: 16 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Add Expense'}
          </button>
        </div>
      </form>

      <div className="panel">
        <div className="panel-title-row">
          <h2>Expense Detail ({expensesInScope.length})</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" className="btn btn-secondary" onClick={handleExportCsv} disabled={expensesInScope.length === 0}>
              Export CSV
            </button>
            {selectedIds.size > 0 && <span className="muted">{selectedIds.size} selected</span>}
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleDeleteSelected}
              disabled={!canDelete || selectedIds.size === 0 || deleting}
              title={canDelete ? undefined : 'Only the super user account can delete expenses.'}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
        <div className="summary-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allOnScreenSelected} onChange={toggleSelectAll} /></th>
                {shopConfig.expenseColumns.map((col) => <th key={col.key}>{col.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {expensesInScope.map((e) => (
                <tr key={e.id}>
                  <td><input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleRow(e.id)} /></td>
                  <td>{e.dateMillis ? new Date(e.dateMillis).toLocaleDateString() : '—'}</td>
                  <td>{e.category}</td>
                  <td>{e.description || '—'}</td>
                  <td>{formatCurrency(e.amount)}</td>
                </tr>
              ))}
              {expensesInScope.length === 0 && (
                <tr><td colSpan={shopConfig.expenseColumns.length + 1} className="muted">No expenses match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
