import { useEffect, useRef, useState } from 'react';

// Generic "label (n) ▾" button that opens a checkbox list panel. Used for the
// Financial Year / Month / Quarter date filter, and reusable anywhere else a
// multi-select is needed.
export default function MultiSelectDropdown({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleDocClick(e) {
      if (open && ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  function toggleValue(value) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  return (
    <div className="multiselect" ref={ref}>
      <button type="button" className="multiselect-trigger" onClick={() => setOpen((v) => !v)}>
        {label} {selected.size > 0 && <span className="multiselect-count">{selected.size}</span>}
        <span className="multiselect-caret">▾</span>
      </button>
      {open && (
        <div className="multiselect-panel">
          {options.map((opt) => (
            <label key={opt.value} className="multiselect-option">
              <input type="checkbox" checked={selected.has(opt.value)} onChange={() => toggleValue(opt.value)} />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
