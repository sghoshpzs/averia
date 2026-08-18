import { useEffect, useState } from 'react';
import shopConfig, { resolveDefault } from '../config/shopConfig';
import ConfigField from '../components/ConfigField';
import { calcPrintedPrice, generateRowId, generateSku } from '../utils/calculations';
import { addInventoryRows, addInventoryLot } from '../utils/firestoreHelpers';

function buildInitialValues() {
  const values = {};
  shopConfig.inventoryFields.forEach((f) => {
    if (f.default) values[f.key] = resolveDefault(f.default);
  });
  return values;
}

export default function InventoryPage() {
  const [values, setValues] = useState(buildInitialValues);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // "Batch" auto-checks whenever # Items > 1, but the user can uncheck it
  // manually (e.g. bulk-entering several IDENTICAL pieces that still need
  // individual barcodes). batchTouched tracks whether they've overridden it
  // by hand, so the auto-behavior doesn't keep fighting their choice.
  const [batchChecked, setBatchChecked] = useState(false);
  const [batchTouched, setBatchTouched] = useState(false);

  const printedPrice = calcPrintedPrice(values.cost, values.profitPercent, values.boxPrice);

  useEffect(() => {
    if (!batchTouched) {
      setBatchChecked(Number(values.itemCount) > 1);
    }
  }, [values.itemCount, batchTouched]);

  function handleBatchToggle(checked) {
    setBatchTouched(true);
    setBatchChecked(checked);
  }

  function handleChange(key, val) {
    setValues((prev) => {
      const next = { ...prev, [key]: val };
      // reset type when category changes, since options depend on it
      if (key === 'category') next.type = '';
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage(null);

    const required = shopConfig.inventoryFields.filter((f) => f.required);
    const missing = required.find((f) => !values[f.key]);
    if (missing) {
      setMessage({ type: 'error', text: `${missing.label} is required.` });
      return;
    }

    setSaving(true);
    try {
      const itemCount = Number(values.itemCount) || 1;
      const baseRow = {
        category: values.category,
        type: values.type,
        vendor: values.vendor,
        name: values.name,
        cost: Number(values.cost),
        profitPercent: Number(values.profitPercent),
        boxPrice: Number(values.boxPrice),
        printedPrice: calcPrintedPrice(values.cost, values.profitPercent, values.boxPrice)
      };

      if (batchChecked) {
        const lot = await addInventoryLot(baseRow, itemCount, generateRowId, generateSku);
        setMessage({
          type: 'success',
          text: `Saved 1 lot of ${itemCount} unit(s). Print one barcode for the batch \u2014 Row ID: ${lot.rowId}`
        });
      } else {
        const rows = await addInventoryRows(baseRow, itemCount, generateRowId, generateSku);
        setMessage({ type: 'success', text: `Saved ${rows.length} record(s). Row ID(s): ${rows.map((r) => r.rowId).join(', ')}` });
      }
      setValues(buildInitialValues());
      setBatchTouched(false);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1>Inventory</h1>
      <p className="muted">Add new stock. Each save writes to the shared inventory collection, filtered by category.</p>

      <form className="panel" onSubmit={handleSubmit}>
        <div className="field-grid">
          {shopConfig.inventoryFields.map((field) => {
            const opaqueFields = ['profitPercent', 'boxPrice', 'printedPrice', 'itemCount'];
            if (field.key === 'printedPrice') {
              return (
                <ConfigField
                  key={field.key}
                  field={field}
                  value={printedPrice.toFixed(2)}
                  onChange={() => {}}
                  formValues={values}
                  className={opaqueFields.includes(field.key) ? 'opaque' : ''}
                />
              );
            }
            return (
              <ConfigField
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={handleChange}
                formValues={values}
                className={opaqueFields.includes(field.key) ? 'opaque' : ''}
              />
            );
          })}
          <div className="field">
            <label>Batch</label>
            <input
              type="checkbox"
              checked={batchChecked}
              onChange={(e) => handleBatchToggle(e.target.checked)}
              style={{ width: 20, height: 20 }}
            />
          </div>
        </div>

        {batchChecked && (
          <p className="muted" style={{ marginTop: 12 }}>
            Batch is checked — this save will create <strong>one</strong> inventory record with <strong>one</strong> shared
            barcode for all {values.itemCount || 1} unit(s). Print a single label for the batch instead of one per piece.
            Each unit's sale is still tracked individually at checkout. Uncheck Batch if you'd rather print
            {' '}{values.itemCount || 1} individual barcodes instead.
          </p>
        )}

        {message && (
          <p style={{ marginTop: 14, color: message.type === 'error' ? '#b3372c' : '#2f7a4f' }}>{message.text}</p>
        )}

        <div style={{ marginTop: 16 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving\u2026' : 'Save to inventory'}
          </button>
        </div>
      </form>
    </div>
  );
}
