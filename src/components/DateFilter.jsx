import { useCallback, useState } from 'react';
import MultiSelectDropdown from './MultiSelectDropdown';
import {
  fyOptions, MONTH_OPTIONS, QUARTER_OPTIONS,
  defaultDateFilterSelections, matchesDateFilter
} from '../utils/dateRanges';

// Shared "Financial Year / Month / Quarter" top-level date filter used by
// Inventory Summary, Sales Summary, and Ad-Hoc Expenses. Each dimension is
// multi-select and defaults to the current period; combining dimensions is
// an AND (a row must match a selected value in every dimension that has one).
export function useDateFilterState() {
  const [selections, setSelections] = useState(defaultDateFilterSelections);

  const setFys = useCallback((fys) => setSelections((s) => ({ ...s, fys })), []);
  const setMonths = useCallback((months) => setSelections((s) => ({ ...s, months })), []);
  const setQuarters = useCallback((quarters) => setSelections((s) => ({ ...s, quarters })), []);

  const matches = useCallback((millis) => matchesDateFilter(millis, selections), [selections]);

  return { selections, setFys, setMonths, setQuarters, matches };
}

export default function DateFilter({ state }) {
  const { selections, setFys, setMonths, setQuarters } = state;
  return (
    <div className="date-filter-bar">
      <MultiSelectDropdown label="Financial Year" options={fyOptions()} selected={selections.fys} onChange={setFys} />
      <MultiSelectDropdown label="Month" options={MONTH_OPTIONS} selected={selections.months} onChange={setMonths} />
      <MultiSelectDropdown label="Quarter" options={QUARTER_OPTIONS} selected={selections.quarters} onChange={setQuarters} />
    </div>
  );
}
