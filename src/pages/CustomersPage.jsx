import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { subscribeCustomers } from '../utils/firestoreHelpers';
import { formatCurrency, formatDate } from '../utils/calculations';
import { functions } from '../firebase';
import { exportRowsToCsv } from '../utils/exportCsv';

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [selected, setSelected] = useState({});
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => subscribeCustomers(setCustomers), []);

  function toggleExpand(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }
  function toggleSelect(id) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
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
              <span className="muted">{expanded[c.id] ? '▲' : '▼'}</span>
            </div>
            {expanded[c.id] && (
              <div className="customer-expand">
                {(c.purchases || []).length === 0 && <p>No purchase history.</p>}
                {[...(c.purchases || [])].sort((a, b) => (b.date || 0) - (a.date || 0)).map((p, idx) => (
                  <div key={idx} style={{ marginBottom: 4 }}>
                    {formatDate(p.date)} — {formatCurrency(p.amount)}
                    {p.invoiceRef ? <> · <a href={`#/invoice/${p.invoiceRef}`}>Invoice link</a></> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
