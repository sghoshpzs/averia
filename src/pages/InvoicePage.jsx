import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import shopConfig from '../config/shopConfig';
import BarcodeScanner from '../components/BarcodeScanner';
import { calcFinalPrice, formatCurrency } from '../utils/calculations';
import { findInventoryByRowId, checkoutInvoice, upsertCustomerOnPurchase, reserveInvoiceId } from '../utils/firestoreHelpers';
import { functions } from '../firebase';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BARCODE_NUMBER_REGEX = /^\d+$/;
const emptyDraft = {
  category: '', type: '', barcode: '', barcodeError: null, printedPrice: '', discountPercent: 0,
  inventoryDocId: null, inventoryDoc: null, lookupFailed: false, name: '',
  isLot: false, quantityRemaining: null, quantity: 1
};
const emptyAddress = { line1: '', line2: '', district: '', state: '', pin: '' };

export default function InvoicePage() {
  const [draft, setDraft] = useState(emptyDraft);
  const [lookingUp, setLookingUp] = useState(false);
  const [items, setItems] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [onlinePurchase, setOnlinePurchase] = useState(false);
  const [address, setAddress] = useState(emptyAddress);
  const [paymentMode, setPaymentMode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [invoiceId, setInvoiceId] = useState(reserveInvoiceId);

  async function lookupBarcode(barcode) {
    setDraft((d) => ({ ...d, barcode, barcodeError: null }));
    if (!barcode) {
      setDraft({ ...emptyDraft });
      return;
    }
    setLookingUp(true);
    try {
      const found = await findInventoryByRowId(barcode);
      if (found) {
        const isLot = Boolean(found.isLot);
        if (isLot && (Number(found.quantityRemaining) || 0) <= 0) {
          setDraft({ ...emptyDraft, barcode, lookupFailed: false });
          setLookingUp(false);
          return;
        }
        setDraft((d) => ({
          ...d,
          barcode,
          category: found.category,
          type: found.type,
          name: found.name,
          printedPrice: found.printedPrice,
          inventoryDocId: found.id,
          inventoryDoc: found,
          isLot,
          quantityRemaining: isLot ? Number(found.quantityRemaining) || 0 : null,
          quantity: 1,
          lookupFailed: false
        }));
      } else {
        setDraft((d) => ({
          ...d,
          barcode,
          category: '',
          type: '',
          name: '',
          printedPrice: '',
          lookupFailed: true,
          inventoryDocId: null,
          inventoryDoc: null,
          isLot: false,
          quantityRemaining: null,
          quantity: 1
        }));
      }
    } finally {
      setLookingUp(false);
    }
  }

  // Barcode must be a plain positive number (looked up in inventory) or the
  // literal "NA" (manual entry, no inventory lookup) — anything else is
  // rejected with an inline error instead of being looked up.
  function handleBarcodeChange(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
      setDraft({ ...emptyDraft });
      return;
    }
    if (trimmed.toUpperCase() === 'NA') {
      setDraft({ ...emptyDraft, barcode: 'NA', lookupFailed: true });
      return;
    }
    if (!BARCODE_NUMBER_REGEX.test(trimmed)) {
      setDraft((d) => ({ ...d, barcode: raw, barcodeError: 'Barcode must be a number or "NA".' }));
      return;
    }
    lookupBarcode(trimmed);
  }

  function addItemToCart() {
    if (!draft.barcode || !draft.printedPrice) return;
    let qty = Math.max(1, Number(draft.quantity) || 1);
    if (draft.isLot) {
      qty = Math.min(qty, draft.quantityRemaining || 1);
      if (qty > (draft.quantityRemaining || 0)) return;
    } else if (draft.inventoryDocId) {
      // Uniquely-barcoded item — only one physical piece exists under this
      // code, so #Items can't exceed 1 regardless of what was typed.
      qty = 1;
    }
    const finalPrice = calcFinalPrice(draft.printedPrice, draft.discountPercent);
    setItems((prev) => [...prev, { ...draft, quantity: qty, finalPrice, id: `${draft.barcode}-${Date.now()}` }]);
    setDraft(emptyDraft);
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  const cartTotal = items.reduce((sum, i) => sum + Number(i.finalPrice || 0) * (Number(i.quantity) || 1), 0);
  const activated = Boolean(draft.barcode) && !draft.barcodeError;

  async function handleCheckout() {
    setResult(null);
    if (items.length === 0) {
      setResult({ type: 'error', text: 'Add at least one item before checkout.' });
      return;
    }
    if (!customerName || !customerPhone) {
      setResult({ type: 'error', text: 'Customer name and phone are required.' });
      return;
    }
    if (customerEmail && !EMAIL_REGEX.test(customerEmail)) {
      setResult({ type: 'error', text: 'Please enter a valid email address.' });
      return;
    }
    if (!paymentMode) {
      setResult({ type: 'error', text: 'Please select a payment mode.' });
      return;
    }
    if (onlinePurchase) {
      const requiredAddr = ['line1', 'district', 'state', 'pin'];
      const missing = requiredAddr.find((k) => !address[k]);
      if (missing) {
        setResult({ type: 'error', text: 'Full address is required for online purchases.' });
        return;
      }
    }

    setSubmitting(true);
    try {
      // Slim, PDF/invoice-safe view of each line item — drop internal fields
      // like the full inventoryDoc (which carries cost) before this gets
      // written to Firestore or sent to the customer-facing PDF.
      const invoiceItems = items.map((i) => ({
        category: i.category,
        type: i.type,
        name: i.name,
        barcode: i.barcode,
        printedPrice: i.printedPrice,
        discountPercent: i.discountPercent,
        finalPrice: i.finalPrice,
        quantity: Number(i.quantity) || 1
      }));

      // 1+2. Invoice doc + inventory decrement/status + sales records all
      // commit as ONE atomic transaction — either all of it happens or
      // none of it does, so a failed line item (e.g. a lot sold out a
      // second ago) can never leave behind an invoice with no matching
      // stock deduction.
      await checkoutInvoice(
        items.map((i) => ({
          inventoryDoc: i.inventoryDoc,
          quantity: i.quantity,
          soldPricePerUnit: Number(i.finalPrice),
          printedPrice: i.printedPrice,
          discountPercent: i.discountPercent
        })),
        {
          items: invoiceItems,
          total: cartTotal,
          customerName,
          customerPhone,
          customerEmail: customerEmail || null,
          onlinePurchase,
          address: onlinePurchase ? address : null,
          paymentMode
        },
        invoiceId
      );

      // 3. upsert customer record — deliberately outside the transaction
      // above (see checkoutInvoice's comment for why). If this one call
      // fails, the sale/inventory are still correct; only the customer's
      // running total would need a manual nudge.
      await upsertCustomerOnPurchase(
        { name: customerName, phone: customerPhone, email: customerEmail || null, address: onlinePurchase ? address : null },
        cartTotal,
        invoiceId
      );

      // 4. call Cloud Function to render PDF, upload to Storage, send WhatsApp via Twilio
      let pdfUrl = null;
      try {
        const generateInvoice = httpsCallable(functions, 'generateInvoicePdfAndSend');
        const res = await generateInvoice({
          invoiceId,
          items: invoiceItems,
          total: cartTotal,
          customerName,
          customerPhone,
          paymentMode
        });
        pdfUrl = res?.data?.pdfUrl || null;
      } catch (fnErr) {
        // Invoice + inventory updates already succeeded — surface the PDF/WhatsApp
        // failure separately so the sale itself isn't lost.
        setResult({
          type: 'warn',
          text: `Invoice saved, but PDF/WhatsApp step failed: ${fnErr.message}. You can resend from the invoice record.`
        });
      }

      if (!result) {
        setResult({
          type: 'success',
          text: pdfUrl ? `Invoice saved and sent. PDF: ${pdfUrl}` : 'Invoice saved.'
        });
      }

      setItems([]);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerEmail('');
      setOnlinePurchase(false);
      setAddress(emptyAddress);
      setPaymentMode('');
      setInvoiceId(reserveInvoiceId());
    } catch (err) {
      setResult({ type: 'error', text: err.message || 'Checkout failed.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>Invoice</h1>
      <p className="muted">Scan or enter a barcode to look up the item's printed price, apply a discount, and add it to the cart.</p>

      <div className="panel">
        <div className="field-grid">
          <div className="field">
            <label>Barcode</label>
            <div className="barcode-input-row">
              <input
                type="text"
                value={draft.barcode}
                onChange={(e) => handleBarcodeChange(e.target.value)}
                placeholder="Scan or type barcode / NA"
                className={activated ? 'opaque' : ''}
              />
              <BarcodeScanner compact onDetected={handleBarcodeChange} />
            </div>
            {draft.barcodeError && <p className="muted" style={{ color: '#b3372c', margin: '4px 0 0' }}>{draft.barcodeError}</p>}
          </div>
          <div className="field">
            <label>Category</label>
            <select
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value, type: '' }))}
              disabled={Boolean(draft.inventoryDocId) && !draft.lookupFailed}
              className={activated ? 'opaque' : ''}
            >
              <option value="" disabled>Select category</option>
              {shopConfig.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Type</label>
            <select
              value={draft.type}
              onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
              disabled={Boolean(draft.inventoryDocId) && !draft.lookupFailed || !draft.category}
              className={activated ? 'opaque' : ''}
            >
              <option value="" disabled>Select type</option>
              {(shopConfig.types[draft.category] || shopConfig.types._default).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {draft.isLot && (
            <p className="muted" style={{ margin: 0 }}>{draft.quantityRemaining} unit(s) left in this lot.</p>
          )}
          <div className="field">
            <label>
              #Items
              {!draft.isLot && draft.inventoryDocId && <span style={{ color: 'var(--ink-muted)' }}> (max 1 — unique barcode)</span>}
            </label>
            <input
              type="number"
              min="1"
              max={draft.isLot ? (draft.quantityRemaining || 1) : (draft.inventoryDocId ? 1 : undefined)}
              value={draft.quantity}
              disabled={!draft.isLot && Boolean(draft.inventoryDocId)}
              className={activated ? 'opaque' : ''}
              onChange={(e) => setDraft((d) => {
                let next = Math.max(1, Number(e.target.value) || 1);
                if (d.isLot) next = Math.min(next, d.quantityRemaining || 1);
                else if (d.inventoryDocId) next = 1;
                return { ...d, quantity: next };
              })}
            />
          </div>
          <div className="field">
            <label>Printed Price {draft.lookupFailed && <span style={{ color: '#b3372c' }}>(not found — enter manually)</span>}</label>
            <input
              type="number"
              value={draft.printedPrice}
              readOnly={!draft.lookupFailed}
              onChange={(e) => setDraft((d) => ({ ...d, printedPrice: e.target.value }))}
              className={draft.lookupFailed ? 'opaque' : ''}
            />
          </div>
          <div className="field">
            <label>% Discount</label>
            <input type="number" min="0" max="100" value={draft.discountPercent} onChange={(e) => setDraft((d) => ({ ...d, discountPercent: e.target.value }))} className="opaque" />
          </div>
          <div className="field">
            <label>Final Price</label>
            <input type="text" readOnly value={formatCurrency(calcFinalPrice(draft.printedPrice || 0, draft.discountPercent))} className="opaque" />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-secondary" disabled={lookingUp || !draft.printedPrice || Boolean(draft.barcodeError)} onClick={addItemToCart}>
            Add to Cart
          </button>
        </div>
      </div>

      {items.length > 0 && (
        <div className="panel">
          <h2>Cart ({items.length})</h2>
          <div className="line-items">
            {items.map((i) => (
              <div key={i.id} className="line-item-row detailed">
                <div className="line-item-cell"><span className="cell-label">Barcode</span><span className="cell-value">{i.barcode}</span></div>
                <div className="line-item-cell"><span className="cell-label">Category</span><span className="cell-value">{i.category}</span></div>
                <div className="line-item-cell"><span className="cell-label">Type</span><span className="cell-value">{i.type}</span></div>
                <div className="line-item-cell"><span className="cell-label">#Items</span><span className="cell-value">{i.quantity}</span></div>
                <div className="line-item-cell"><span className="cell-label">Printed Price</span><span className="cell-value">{formatCurrency(i.printedPrice)}</span></div>
                <div className="line-item-cell"><span className="cell-label">% Discount</span><span className="cell-value">{i.discountPercent || 0}%</span></div>
                <div className="line-item-cell"><span className="cell-label">Final Price</span><span className="cell-value">{formatCurrency(Number(i.finalPrice) * Number(i.quantity || 1))}</span></div>
                <button type="button" className="btn btn-danger" onClick={() => removeItem(i.id)}>Remove</button>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 14, fontSize: 18 }}><strong>Total: {formatCurrency(cartTotal)}</strong></p>
        </div>
      )}

      <div className="panel">
        <h2>Checkout</h2>
        <div className="field-grid">
          <div className="field">
            <label>Invoice Id</label>
            <input type="text" readOnly value={invoiceId} className="opaque" />
          </div>
          <div className="field">
            <label>Customer Name</label>
            <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          <div className="field">
            <label>Customer Phone (WhatsApp)</label>
            <input type="text" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+91XXXXXXXXXX" />
          </div>
          <div className="field">
            <label>Email ID</label>
            <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="name@example.com" />
          </div>
          <div className="field">
            <label>Payment Mode</label>
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
              <option value="" disabled>Select payment mode</option>
              {shopConfig.paymentModes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Online Purchase</label>
            <input type="checkbox" checked={onlinePurchase} onChange={(e) => setOnlinePurchase(e.target.checked)} style={{ width: 20, height: 20 }} />
          </div>
        </div>

        {onlinePurchase && (
          <div className="field-grid" style={{ marginTop: 14 }}>
            <div className="field"><label>Address Line 1</label><input value={address.line1} onChange={(e) => setAddress((a) => ({ ...a, line1: e.target.value }))} /></div>
            <div className="field"><label>Address Line 2</label><input value={address.line2} onChange={(e) => setAddress((a) => ({ ...a, line2: e.target.value }))} /></div>
            <div className="field"><label>District</label><input value={address.district} onChange={(e) => setAddress((a) => ({ ...a, district: e.target.value }))} /></div>
            <div className="field"><label>State</label><input value={address.state} onChange={(e) => setAddress((a) => ({ ...a, state: e.target.value }))} /></div>
            <div className="field"><label>Pin</label><input value={address.pin} onChange={(e) => setAddress((a) => ({ ...a, pin: e.target.value }))} /></div>
          </div>
        )}

        {result && (
          <p style={{ marginTop: 14, color: result.type === 'error' ? '#b3372c' : result.type === 'warn' ? '#b8912f' : '#2f7a4f' }}>
            {result.text}
          </p>
        )}

        <div style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-primary" disabled={submitting} onClick={handleCheckout}>
            {submitting ? 'Processing\u2026' : 'Send Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
