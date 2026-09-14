import { useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import shopConfig from '../config/shopConfig';
import BarcodeScanner from '../components/BarcodeScanner';
import { calcFinalPrice, formatCurrency, formatDate, sortAsc } from '../utils/calculations';
import { findInventoryByRowId, checkoutInvoice, upsertCustomerOnPurchase, findCustomerByPhone, reserveInvoiceId } from '../utils/firestoreHelpers';
import { functions } from '../firebase';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BARCODE_NUMBER_REGEX = /^\d+$/;
const emptyDraft = {
  category: '', type: '', barcode: '', barcodeError: null, printedPrice: '', discountPercent: 0,
  inventoryDocId: null, inventoryDoc: null, lookupFailed: false, name: '',
  isLot: false, quantityRemaining: null, quantity: 1
};
const emptyAddress = { line1: '', line2: '', district: '', state: '', pin: '' };

// Fallback for when WhatsApp delivery fails — the Cloud Function still ships
// the PDF bytes back (base64) so we can save it locally instead of leaving
// the customer with nothing.
function downloadPdfFromBase64(base64, filename) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function InvoicePage() {
  const [draft, setDraft] = useState(emptyDraft);
  const [lookingUp, setLookingUp] = useState(false);
  const [items, setItems] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [phoneExt, setPhoneExt] = useState('+91');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerLookup, setCustomerLookup] = useState(null); // null | 'checking' | 'found' | 'new'
  const [matchedPhone, setMatchedPhone] = useState(null); // phone the current name/email auto-fill came from
  const [onlinePurchase, setOnlinePurchase] = useState(false);
  const [address, setAddress] = useState(emptyAddress);
  const [paymentMode, setPaymentMode] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => formatDate(new Date()));
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [invoiceId, setInvoiceId] = useState(reserveInvoiceId);
  const barcodeInputRef = useRef(null);

  // Combined phone stored/looked-up everywhere (Firestore, WhatsApp) — kept
  // as one string like before ("+91XXXXXXXXXX"), just entered as two fields.
  // Empty unless a local number has actually been typed, so validation and
  // stale-match checks below don't treat a bare "+91" as a real phone.
  const customerPhone = phoneNumber.trim() ? `${phoneExt.trim()}${phoneNumber.trim()}` : '';

  function handlePhoneFieldChange(nextExt, nextNumber) {
    setPhoneExt(nextExt);
    setPhoneNumber(nextNumber);
    setCustomerLookup(null);
    // The name/email currently shown came from a lookup match on the OLD
    // phone number — clear them so a stale match doesn't silently get
    // attached to a different phone at checkout.
    const nextFull = nextNumber.trim() ? `${nextExt.trim()}${nextNumber.trim()}` : '';
    if (matchedPhone && nextFull !== matchedPhone) {
      setCustomerName('');
      setCustomerEmail('');
      setMatchedPhone(null);
    }
  }

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
    // Cashier's next action is almost always scanning/typing the next item,
    // so send focus straight back to Barcode instead of leaving it wherever
    // the mouse happened to be (the Add to Cart button).
    barcodeInputRef.current?.focus();
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  const cartTotal = items.reduce((sum, i) => sum + Number(i.finalPrice || 0) * (Number(i.quantity) || 1), 0);
  const activated = Boolean(draft.barcode) && !draft.barcodeError;

  // Looked up once the cashier finishes typing the phone number — auto-fills
  // name/email for a returning customer instead of re-typing them and
  // accidentally creating a second customer record under the same phone.
  // This is purely a Firestore lookup of the `customers` collection — it has
  // nothing to do with WhatsApp/SMS delivery, which only happens later, at
  // checkout, via the generateInvoicePdfAndSend Cloud Function.
  async function handlePhoneBlur() {
    const phone = customerPhone.trim();
    if (!phone) {
      setCustomerLookup(null);
      return;
    }
    setCustomerLookup('checking');
    try {
      const existing = await findCustomerByPhone(phone);
      if (existing) {
        setCustomerName(existing.name || '');
        setCustomerEmail((prev) => prev || existing.email || '');
        setMatchedPhone(phone);
        setCustomerLookup('found');
      } else {
        setCustomerLookup('new');
      }
    } catch (err) {
      // Without this, a failed lookup (permissions, offline, etc.) left the
      // banner stuck on "Looking up customer…" forever with no way to tell
      // it had actually failed.
      setCustomerLookup('error');
    }
  }

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
    if (!invoiceDate) {
      setResult({ type: 'error', text: 'Please enter an invoice date.' });
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
          paymentMode,
          invoiceDate
        },
        invoiceId
      );

      // 3. upsert customer record — deliberately outside the transaction
      // above (see checkoutInvoice's comment for why). If this one call
      // fails, the sale/inventory are still correct; only the customer's
      // running total would need a manual nudge.
      const customerId = await upsertCustomerOnPurchase(
        { name: customerName, phone: customerPhone, email: customerEmail || null, address: onlinePurchase ? address : null },
        cartTotal,
        invoiceId
      );

      // 4. best-effort sync of this customer into the shop's real Google
      // Contacts (see functions/googleContacts.js + README for the one-time
      // OAuth setup) — never blocks or fails the checkout; a sync failure
      // just gets appended to whatever success/warning message is shown
      // below instead of its own error path.
      let contactSyncError = null;
      try {
        const syncGoogleContact = httpsCallable(functions, 'syncGoogleContact');
        await syncGoogleContact({ customerId, name: customerName, phone: customerPhone, email: customerEmail || null });
      } catch (syncErr) {
        contactSyncError = syncErr.message || 'Google Contacts sync failed.';
      }

      // 5. call Cloud Function to render PDF, upload to Storage, send WhatsApp via Twilio
      try {
        const generateInvoice = httpsCallable(functions, 'generateInvoicePdfAndSend');
        const res = await generateInvoice({
          invoiceId,
          items: invoiceItems,
          total: cartTotal,
          customerName,
          customerPhone,
          paymentMode,
          invoiceDate
        });
        const { pdfUrl, whatsappSent, whatsappError, pdfBase64 } = res?.data || {};

        if (whatsappSent === false) {
          // WhatsApp delivery failed but the PDF was still generated and
          // stored — auto-download it locally so the sale isn't left with
          // no invoice in hand, instead of just reporting the failure.
          if (pdfBase64) {
            downloadPdfFromBase64(pdfBase64, `invoice-${invoiceId}.pdf`);
            // The download already happened, so this banner is just a
            // heads-up, not something to act on — clear it on its own
            // instead of leaving it sitting on screen after the fact.
            setTimeout(() => setResult((r) => (r?.autoDownloaded ? null : r)), 6000);
          }
          setResult({
            type: 'warn',
            text: `Invoice saved, but WhatsApp delivery failed (${whatsappError || 'unknown error'}) — the PDF ${pdfBase64 ? 'downloaded automatically. You can also open it below' : 'is available below'} instead.`,
            link: pdfUrl,
            autoDownloaded: Boolean(pdfBase64)
          });
        } else {
          setResult({
            type: 'success',
            text: pdfUrl ? 'Invoice saved and sent.' : 'Invoice saved.',
            link: pdfUrl
          });
        }
      } catch (fnErr) {
        // Invoice + inventory updates already succeeded — surface the PDF/WhatsApp
        // failure separately so the sale itself isn't lost. No PDF to fall back to
        // here since the Cloud Function call itself failed before returning one.
        setResult({
          type: 'warn',
          text: `Invoice saved, but PDF/WhatsApp step failed: ${fnErr.message}. You can resend from the invoice record.`
        });
      }

      if (contactSyncError) {
        setResult((r) => (r ? { ...r, text: `${r.text} (Google Contacts sync failed: ${contactSyncError})` } : r));
      }

      setItems([]);
      setCustomerName('');
      setPhoneExt('+91');
      setPhoneNumber('');
      setCustomerEmail('');
      setCustomerLookup(null);
      setMatchedPhone(null);
      setOnlinePurchase(false);
      setAddress(emptyAddress);
      setPaymentMode('');
      setInvoiceDate(formatDate(new Date()));
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
                ref={barcodeInputRef}
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
              {sortAsc(shopConfig.categories).map((c) => <option key={c} value={c}>{c}</option>)}
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
              {sortAsc(shopConfig.types[draft.category] || shopConfig.types._default).map((t) => <option key={t} value={t}>{t}</option>)}
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
            {items.map((i, idx) => (
              <div key={i.id} className="line-item-row detailed">
                <div className="line-item-cell"><span className="cell-label">#</span><span className="cell-value">{idx + 1}</span></div>
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
            <label>Date</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Customer Phone (WhatsApp)</label>
            <div className="phone-input-row">
              <input
                type="text"
                className="phone-ext"
                value={phoneExt}
                onChange={(e) => handlePhoneFieldChange(e.target.value, phoneNumber)}
                placeholder="+91"
              />
              <input
                type="text"
                className="phone-number"
                value={phoneNumber}
                onChange={(e) => handlePhoneFieldChange(phoneExt, e.target.value)}
                onBlur={handlePhoneBlur}
                placeholder="XXXXXXXXXX"
              />
            </div>
            {customerLookup === 'checking' && <p className="muted" style={{ margin: '4px 0 0' }}>Looking up customer…</p>}
            {customerLookup === 'found' && <p className="muted" style={{ margin: '4px 0 0' }}>Existing customer — name filled in below.</p>}
            {customerLookup === 'new' && <p className="muted" style={{ margin: '4px 0 0' }}>New customer — enter their name below.</p>}
            {customerLookup === 'error' && <p className="muted" style={{ margin: '4px 0 0', color: '#b3372c' }}>Couldn't look up this customer — enter their name below and continue.</p>}
          </div>
          <div className="field">
            <label>Email ID</label>
            <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="name@example.com" />
          </div>
          <div className="field">
            <label>Customer Name</label>
            <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          <div className="field">
            <label>Payment Mode</label>
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
              <option value="" disabled>Select payment mode</option>
              {sortAsc(shopConfig.paymentModes).map((m) => <option key={m} value={m}>{m}</option>)}
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
            {result.link && (
              <> <a href={result.link} target="_blank" rel="noopener noreferrer">View / download invoice PDF</a></>
            )}
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
