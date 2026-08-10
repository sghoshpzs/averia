import React from "react";
import appConfig from "../config/appConfig";

// Resolves a dotted path like "dropdowns.type" against appConfig,
// so field configs can point at any list without the component knowing
// what that list is called.
function resolveSource(source) {
  if (!source) return [];
  return source.split(".").reduce((acc, key) => (acc ? acc[key] : undefined), appConfig) || [];
}

export default function DynamicField({ field, value, onChange, onScanClick, disabled }) {
  const { name, label, type, required, placeholder, prefix, min, max, step, helpText } = field;

  const handleChange = (e) => onChange(name, e.target.value);

  return (
    <div className="field">
      <label htmlFor={name}>
        {label}
        {required && <span className="required">*</span>}
      </label>

      {type === "select" && (
        <select id={name} value={value ?? ""} onChange={handleChange} required={required} disabled={disabled}>
          <option value="" disabled>
            Select {label}
          </option>
          {resolveSource(field.source).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {type === "text" && (
        <input
          id={name}
          type="text"
          value={value ?? ""}
          placeholder={placeholder}
          onChange={handleChange}
          required={required}
          disabled={disabled}
        />
      )}

      {type === "number" && (
        <div className={`input-prefix-wrap ${prefix ? "has-prefix" : ""}`}>
          {prefix && <span className="input-prefix">{prefix}</span>}
          <input
            id={name}
            type="number"
            value={value ?? ""}
            min={min}
            max={max}
            step={step || "any"}
            onChange={handleChange}
            required={required}
            disabled={disabled}
          />
        </div>
      )}

      {type === "readonly" && (
        <div className={`input-prefix-wrap has-prefix readonly`}>
          {prefix && <span className="input-prefix">{prefix}</span>}
          <input id={name} type="text" value={value ?? "0.00"} readOnly disabled />
        </div>
      )}

      {type === "barcode" && (
        <div className="barcode-row">
          <input
            id={name}
            type="text"
            inputMode="numeric"
            value={value ?? ""}
            placeholder="8-digit Row ID"
            onChange={handleChange}
            required={required}
            disabled={disabled}
          />
          <button type="button" className="btn-icon" onClick={onScanClick} title="Scan barcode">
            📷 Scan
          </button>
        </div>
      )}

      {helpText && <small className="help-text">{helpText}</small>}
    </div>
  );
}
