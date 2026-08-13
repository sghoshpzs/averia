import shopConfig, { resolveDropdownSource } from '../config/shopConfig';

// Renders one input based on a field definition from shopConfig.
// Supports: category, dropdown, text, number, readonly. Barcode/lookupEditable
// are handled by InvoicePage directly since they need extra behaviour.
export default function ConfigField({ field, value, onChange, formValues, disabled, className }) {
  const handle = (e) => onChange(field.key, e.target.value);

  if (field.type === 'category') {
    return (
      <div className="field">
        <label>{field.label}</label>
        <select value={value ?? ''} onChange={handle} disabled={disabled} className={className || ''}>
          <option value="" disabled>Select category</option>
          {shopConfig.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    );
  }

  if (field.type === 'dropdown') {
    const options = resolveDropdownSource(field, formValues);
    return (
      <div className="field">
        <label>{field.label}</label>
        <select value={value ?? ''} onChange={handle} disabled={disabled} className={className || ''}>
          <option value="" disabled>Select {field.label.toLowerCase()}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  if (field.type === 'number') {
    return (
      <div className="field">
        <label>{field.label}</label>
        <input
          type="number"
          value={value ?? ''}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={handle}
          disabled={disabled}
          className={className || ''}
        />
      </div>
    );
  }

  if (field.type === 'readonly') {
    return (
      <div className="field">
        <label>{field.label}</label>
        <input type="text" value={value ?? ''} readOnly className={className || ''} />
      </div>
    );
  }

  // default: text
  return (
    <div className="field">
      <label>{field.label}</label>
      <input type="text" value={value ?? ''} onChange={handle} disabled={disabled} className={className || ''} />
    </div>
  );
}
