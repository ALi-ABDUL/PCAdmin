import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

/**
 * Persist a per-section sort preference in localStorage as
 * `pref.sort.<key>` in the form "<field>:<asc|desc>".
 *
 * Returns { field, dir, setSort, toggle } where `toggle(field)` implements
 * the "1st click asc → 2nd click desc" pattern (clicking a different column
 * always resets to asc first).
 */
export function useSortPref(key, defaultField, defaultDir = "desc") {
  const storageKey = `pref.sort.${key}`;
  const [{ field, dir }, setState] = useState(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw && /:/.test(raw)) {
        const [f, d] = raw.split(":");
        if (f) return { field: f, dir: d === "asc" ? "asc" : "desc" };
      }
    } catch { /* ignore */ }
    return { field: defaultField, dir: defaultDir };
  });
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, `${field}:${dir}`); } catch { /* ignore */ }
  }, [storageKey, field, dir]);
  const setSort = useCallback((nextField, nextDir) => {
    setState({ field: nextField, dir: nextDir === "asc" ? "asc" : "desc" });
  }, []);
  const toggle = useCallback((nextField) => {
    setState((prev) => {
      if (prev.field !== nextField) return { field: nextField, dir: "asc" };
      return { field: nextField, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }, []);
  const sortParam = `${field}_${dir}`;
  return { field, dir, sortParam, setSort, toggle };
}

/**
 * A clickable table header that displays an arrow indicator when the column
 * is the current sort field. Non-sortable headers can still use plain <th>.
 *
 * <SortableTh label="Total" field="total" active={field} dir={dir} onSort={toggle} align="right"/>
 */
export function SortableTh({ label, field, active, dir, onSort, align = "left", testPrefix = "col", className = "" }) {
  const isActive = active === field;
  const Arrow = !isActive ? ChevronsUpDown : (dir === "asc" ? ArrowUp : ArrowDown);
  const alignClass = align === "right" ? "justify-end text-right" : align === "center" ? "justify-center text-center" : "text-left";
  return (
    <th className={`${className} cursor-pointer select-none group`} onClick={() => onSort?.(field)} aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 w-full ${alignClass} ${isActive ? "text-indigo-600" : "text-inherit"} hover:text-indigo-600 transition-colors`}
        data-testid={`${testPrefix}-sort-${field}`}
      >
        <span>{label}</span>
        <Arrow size={11} className={isActive ? "opacity-100" : "opacity-40 group-hover:opacity-70"} aria-hidden="true"/>
      </button>
    </th>
  );
}
