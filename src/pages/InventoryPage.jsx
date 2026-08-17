import { useState } from 'react';
import shopConfig, { resolveDefault, isLotTracked } from '../config/shopConfig';
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

  const printedPrice = calcPrintedPrice(values.cost, values.profitPercent, values.boxPrice);
  const lotMode = isLotTracked(values.category);

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

      if (lotMode) {
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
        </div>

        {lotMode && (
          <p className="muted" style={{ marginTop: 12 }}>
            {values.category} is set up for lot tracking (see shopConfig.js). This save will create <strong>one</strong> inventory
            record with <strong>one</strong> shared barcode for all {values.itemCount || 1} unit(s) — print a single label
            for the batch instead of one per piece. Each unit's sale is still tracked individually at checkout.
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
