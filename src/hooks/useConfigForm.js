import { useState, useCallback, useMemo } from "react";
import * as formulas from "../utils/formulas";

function buildInitialValues(fields) {
  const initial = {};
  fields.forEach((f) => {
    initial[f.name] = f.default !== undefined ? f.default : "";
  });
  return initial;
}

export default function useConfigForm(fields) {
  const [values, setValues] = useState(() => buildInitialValues(fields));

  const setField = useCallback(
    (name, rawValue) => {
      setValues((prev) => {
        const next = { ...prev, [name]: rawValue };
        // Re-run every formula field so readonly values stay live.
        fields.forEach((f) => {
          if (f.type === "readonly" && f.formula && formulas[f.formula]) {
            next[f.name] = formulas[f.formula](next);
          }
        });
        return next;
      });
    },
    [fields]
  );

  const reset = useCallback(() => setValues(buildInitialValues(fields)), [fields]);

  const setMany = useCallback((patch) => {
    setValues((prev) => {
      const next = { ...prev, ...patch };
      fields.forEach((f) => {
        if (f.type === "readonly" && f.formula && formulas[f.formula]) {
          next[f.name] = formulas[f.formula](next);
        }
      });
      return next;
    });
  }, [fields]);

  const isValid = useMemo(
    () => fields.every((f) => !f.required || (values[f.name] !== "" && values[f.name] != null)),
    [fields, values]
  );

  return { values, setField, setMany, reset, isValid };
}
