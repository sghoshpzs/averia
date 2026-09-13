import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { subscribeCustomers, subscribeInvoices, updateCustomer } from '../utils/firestoreHelpers';
import { formatCurrency, formatDate } from '../utils/calculations';
import { functions } from '../firebase';
import { exportRowsToCsv } from '../utils/exportCsv';

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [selected, setSelected] = useState({});
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({ name: '', phone: '' });
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => subscribeCustomers(setCustomers), []);
  useEffect(() => subscribeInvoices(setInvoices), []);

  // invoiceRef -> pdfUrl, so a purchase's "Invoice link" opens the actual PDF
  // (once generateInvoicePdfAndSend has set it on the invoice doc) instead of
  // falling through HashRouter's wildcard route back to the Invoice page.
  const invoicePdfById = useMemo(() => {
    const map = {};
    invoices.forEach((inv) => { if (inv.pdfUrl) map[inv.id] = inv.pdfUrl; });
    return map;
  }, [invoices]);

  function toggleExpand(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }
  function toggleSelect(id) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function startEdit(c) {
    setEditingId(c.id);
    setEditDraft({ name: c.name || '', phone: c.phone || '' });
    setEditError('');
  }
  function cancelEdit() {
    setEditingId(null);
    setEditError('');
  }
  async function saveEdit(id) {
    const name = editDraft.name.trim();
    const phone = editDraft.phone.trim();
    if (!name || !phone) {
      setEditError('Name and phone are both required.');
      return;
    }
    setSaving(true);
    setEditError('');
    try {
      await updateCustomer(id, { name, phone });
      setEditingId(null);
    } catch (err) {
      setEditError(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  function handleExportCsv() {
    const columns = [
      { label: 'Name', get: (c) => c.name },
      { label: 'Phone', get: (c) => c.phone },
      { label: 'Email', get: (c) => c.email || '' },
      { label: 'Address', get: (c) => c.address ? [c.address.line1, c.address.line2, c.address.district, c.address.state, c.address.pin].filter(Boolean).join(', ') : '' },
      { label: 'Total Purchased', get: (c) => c.totalPurchased || 0 }
    ];
    exportRowsToCsv('customers-export', columns, customers);
  }

  async function sendMarketing() {
    if (selectedIds.length === 0 || !message.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const targets = customers.filter((c) => selectedIds.includes(c.id)).map((c) => ({ phone: c.phone, name: c.name }));
      const sendMarketingMessage = httpsCallable(functions, 'sendWhatsappMarketing');
      await sendMarketingMessage({ recipients: targets, message });
      setResult({ type: 'success', text: `Sent to ${targets.length} customer(s).` });
      setSelected({});
      setMessage('');
    } catch (err) {
      setResult({ type: 'error', text: err.message || 'Failed to send.' });
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="panel-title-row" style={{ marginBottom: 8 }}>
        <h1 style={{ marginBottom: 0 }}>Customers</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="muted">{selectedIds.length} selected</span>
          <button type="button" className="btn btn-secondary" onClick={handleExportCsv} disabled={customers.length === 0}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="field-grid" style={{ gridTemplateColumns: '3fr auto' }}>
          <div className="field">
            <label>WhatsApp marketing message</label>
            <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. New AD collection just landed — 20% off this week!" />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button type="button" className="btn btn-primary" disabled={sending || selectedIds.length === 0 || !message.trim()} onClick={sendMarketing}>
              {sending ? 'Sending…' : `Send to ${selectedIds.length || ''}`}
            </button>
          </div>
        </div>
        {result && (
          <p style={{ marginTop: 10, color: result.type === 'error' ? '#b3372c' : '#2f7a4f' }}>{result.text}</p>
        )}
        <p className="muted" style={{ marginTop: 8 }}>
          Uses a pre-approved Twilio WhatsApp template for the sandbox/production number. Edit the template in
          functions/index.js (sendWhatsappMarketing) to match what you've registered with Twilio.
        </p>
      </div>

      <div className="panel">
        {customers.length === 0 && <p className="muted">No customers yet — they're created automatically from invoices.</p>}
        {customers.map((c) => (
          <div key={c.id} className="customer-row">
            {editingId === c.id ? (
              <div className="customer-summary" onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
                <div style={{ flex: 1, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={editDraft.name}
                    onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="Name"
                    style={{ minWidth: 160 }}
                  />
                  <input
                    type="text"
                    value={editDraft.phone}
                    onChange={(e) => setEditDraft((d) => ({ ...d, phone: e.target.value }))}
                    placeholder="Phone"
                    style={{ minWidth: 140 }}
                  />
                  {editError && <span style={{ color: '#b3372c', alignSelf: 'center' }}>{editError}</span>}
                </div>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={() => saveEdit(c.id)}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="btn btn-secondary" disabled={saving} onClick={cancelEdit}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="customer-summary" onClick={() => toggleExpand(c.id)}>
                <input
                  type="checkbox"
                  checked={!!selected[c.id]}
                  onChange={(e) => { e.stopPropagation(); toggleSelect(c.id); }}
                  onClick={(e) => e.stopPropagation()}
                />
                <div style={{ flex: 1 }}>
                  <div className="name">{c.name}</div>
                  <div className="muted">{c.phone}{c.email ? ` · ${c.email}` : ''}{c.address ? ` · ${c.address.district || ''}, ${c.address.state || ''}` : ''}</div>
                </div>
                <div><strong>{formatCurrency(c.totalPurchased)}</strong></div>
                <button type="button" className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); startEdit(c); }}>
                  Edit
                </button>
                <span className="muted">{expanded[c.id] ? '▲' : '▼'}</span>
              </div>
            )}
            {expanded[c.id] && editingId !== c.id && (
              <div className="customer-expand">
                {(c.purchases || []).length === 0 && <p>No purchase history.</p>}
                {[...(c.purchases || [])].sort((a, b) => (b.date || 0) - (a.date || 0)).map((p, idx) => {
                  const pdfUrl = p.invoiceRef ? invoicePdfById[p.invoiceRef] : null;
                  return (
                    <div key={idx} style={{ marginBottom: 4 }}>
                      {formatDate(p.date)} — {formatCurrency(p.amount)}
                      {p.invoiceRef ? (
                        <>
                          {' '}·{' '}
                          {pdfUrl
                            ? <a href={pdfUrl} target="_blank" rel="noopener noreferrer">Invoice link</a>
                            : <span className="muted">Invoice PDF not available yet</span>}
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
