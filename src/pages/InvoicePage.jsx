import React, { useState } from "react";
import appConfig from "../config/appConfig";
import DynamicField from "../components/DynamicField";
import BarcodeScannerModal from "../components/BarcodeScannerModal";
import useConfigForm from "../hooks/useConfigForm";
import { lookupByRowId, markAsSold } from "../firebase/inventoryApi";
import { sendInvoice } from "../firebase/invoiceApi";
import { generateInvoicePdf } from "../utils/generateInvoicePdf";

export default function InvoicePage() {
  const fields = appConfig.invoiceFields;
  const { values, setField, setMany, reset } = useConfigForm(fields);

  const [items, setItems] = useState([]); // cart of items for this invoice
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lookupState, setLookupState] = useState(null); // 'found' | 'not-found' | null
  const [matchedDoc, setMatchedDoc] = useState(null); // { docId, Cost, ... } for markAsSold later
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { pdfUrl } after successful send
  const [message, setMessage] = useState(null);

  async function runLookup(category, barcode) {
    if (!category || !barcode) return;
    try {
      const match = await lookupByRowId(category, barcode);
      if (match) {
        setMatchedDoc(match);
        setLookupState("found");
        setMany({ printedPrice: match["Printed Price"] });
      } else {
        setMatchedDoc(null);
        setLookupState("not-found");
      }
    } catch (err) {
      console.error(err);
      setLookupState("not-found");
    }
  }

  const handleFieldChange = (name, value) => {
    setField(name, value);
    if (name === "barcode") {
      runLookup(values.category, value);
    }
    if (name === "category" && values.barcode) {
      runLookup(value, values.barcode);
    }
  };

  const handleScanDetected = (decodedText) => {
    setScannerOpen(false);
    setField("barcode", decodedText);
    runLookup(values.category, decodedText);
  };

  const addItemToInvoice = () => {
    if (!values.category || !values.type || !values.barcode || !values.printedPrice) {
      setMessage({ type: "error", text: "Fill Category, Type, Barcode and Printed Price before adding." });
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        ...values,
        cost: matchedDoc?.Cost ?? null,
        docId: matchedDoc?.docId ?? null,
      },
    ]);
    reset();
    setMatchedDoc(null);
    setLookupState(null);
    setMessage(null);
  };

  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const submitInvoice = async () => {
    if (items.length === 0) {
      setMessage({ type: "error", text: "Add at least one item to the invoice." });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const invoiceId = `INV-${Date.now().toString().slice(-8)}`;
      const { base64, total } = generateInvoicePdf({ invoiceId, customer, items });

      // 1) Upload PDF + send WhatsApp link (Cloud Function - see functions/index.js)
      const { pdfUrl } = await sendInvoice({
        invoiceId,
        pdfBase64: base64,
        customerPhone: customer.phone,
        total,
      });

      // 2) Mark each sold item back in its inventory collection
      await Promise.all(
        items
          .filter((it) => it.docId)
          .map((it) =>
            markAsSold(it.category, it.docId, {
              soldPrice: parseFloat(it.finalPrice) || 0,
              cost: it.cost,
            })
          )
      );

      setResult({ pdfUrl, invoiceId, total });
      setItems([]);
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: `Failed to submit invoice: ${err.message}` });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Invoice</h1>
        <p className="subtitle">Scan or enter each item's barcode, add to the invoice, then submit.</p>
      </div>

      <div className="card form-grid">
        <div className="field">
          <label>Customer Name</label>
          <input
            type="text"
            value={customer.name}
            onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
          />
        </div>
        <div className="field">
          <label>Customer Phone (WhatsApp)</label>
          <input
            type="tel"
            placeholder="+91XXXXXXXXXX"
            value={customer.phone}
            onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))}
          />
        </div>
      </div>

      <div className="card form-grid">
        {fields.map((f) => (
          <DynamicField
            key={f.name}
            field={f}
            value={values[f.name]}
            onChange={handleFieldChange}
            onScanClick={() => setScannerOpen(true)}
          />
        ))}

        {lookupState === "found" && (
          <div className="alert alert-success span-all">Barcode matched inventory - price auto-filled.</div>
        )}
        {lookupState === "not-found" && (
          <div className="alert alert-error span-all">
            No inventory match for that barcode. You can enter the Printed Price manually.
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="btn-primary" onClick={addItemToInvoice}>
            + Add Item to Invoice
          </button>
        </div>
      </div>

      {items.length > 0 && (
        <div className="card">
          <h3>Items in this invoice ({items.length})</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Type</th>
                <th>Barcode</th>
                <th>Printed Price</th>
                <th>% Discount</th>
                <th>Final Price</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx}>
                  <td>{it.category}</td>
                  <td>{it.type}</td>
                  <td>{it.barcode}</td>
                  <td>{appConfig.currencySymbol}{parseFloat(it.printedPrice).toFixed(2)}</td>
                  <td>{it.discountPct || 0}%</td>
                  <td>{appConfig.currencySymbol}{parseFloat(it.finalPrice).toFixed(2)}</td>
                  <td>
                    <button type="button" className="btn-icon" onClick={() => removeItem(idx)}>
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="form-actions">
            <button type="button" className="btn-primary" onClick={submitInvoice} disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Invoice (PDF + WhatsApp)"}
            </button>
          </div>
        </div>
      )}

      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

      {result && (
        <div className="card alert alert-success">
          Invoice {result.invoiceId} sent. Total {appConfig.currencySymbol}
          {result.total.toFixed(2)}.{" "}
          <a href={result.pdfUrl} target="_blank" rel="noreferrer">
            View PDF
          </a>
        </div>
      )}

      {scannerOpen && (
        <BarcodeScannerModal onDetected={handleScanDetected} onClose={() => setScannerOpen(false)} />
      )}
    </div>
  );
}
