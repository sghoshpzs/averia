import React, { useState } from "react";
import appConfig from "../config/appConfig";
import DynamicField from "../components/DynamicField";
import useConfigForm from "../hooks/useConfigForm";
import { saveInventoryRecords } from "../firebase/inventoryApi";

export default function InventoryPage() {
  const fields = appConfig.inventoryFields;
  const { values, setField, reset, isValid } = useConfigForm(fields);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid) {
      setMessage({ type: "error", text: "Please fill all required fields." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const count = Math.max(1, parseInt(values.itemCount, 10) || 1);
      const saved = await saveInventoryRecords(values.category, values, count);
      setMessage({
        type: "success",
        text: `Saved ${saved.length} record(s) to "${values.category}". Row ID${
          saved.length > 1 ? "s" : ""
        }: ${saved.map((s) => s.row_id).join(", ")}`,
      });
      reset();
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: `Failed to save: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Inventory</h1>
        <p className="subtitle">Add new stock. Category selects which sheet/tab the record is saved to.</p>
      </div>

      <form className="card form-grid" onSubmit={handleSubmit}>
        {fields.map((f) => (
          <DynamicField key={f.name} field={f} value={values[f.name]} onChange={setField} />
        ))}

        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving..." : "Save to Inventory"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => reset()} disabled={saving}>
            Clear
          </button>
        </div>

        {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}
      </form>
    </div>
  );
}
