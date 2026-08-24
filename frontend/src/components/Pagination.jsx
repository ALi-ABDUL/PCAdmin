import { useEffect, useState } from "react";

/**
 * Persist a page-size preference per section in localStorage. Falls back to
 * the provided default when nothing is stored / storage is unavailable.
 *
 * Usage: const [pageSize, setPageSize] = usePagePref("orders", 50);
 */
export function usePagePref(key, defaultValue = 50, allowed = [50, 100, 150, 200]) {
  const storageKey = `pref.pageSize.${key}`;
  const [pageSize, setPageSize] = useState(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const n = raw ? Number(raw) : NaN;
      return allowed.includes(n) ? n : defaultValue;
    } catch { return defaultValue; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, String(pageSize)); } catch { /* silent */ }
  }, [storageKey, pageSize]);
  return [pageSize, setPageSize];
}

/**
 * Shared list-pagination footer: "Showing X–Y of TOTAL" + page-size dropdown
 * + Prev / numbered pages / Next. Numbered buttons are windowed (first, last,
 * current ±1) with ellipses so the row stays compact for 100+ pages.
 *
 * Props: total, page, pageSize, onPageChange, onPageSizeChange, testPrefix.
 */
export function Pagination({
  total = 0,
  page = 1,
  pageSize = 50,
  onPageChange,
  onPageSizeChange,
  testPrefix = "pg",
  sizes = [50, 100, 150, 200],
  className = "",
}) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  const nums = (() => {
    const s = new Set([1, totalPages, current, current - 1, current + 1]);
    return [...s].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  })();
  return (
    <div className={`flex items-center justify-between flex-wrap gap-3 ${className}`} data-testid={`${testPrefix}-pagination`}>
      <div className="flex items-center gap-3">
        <div className="text-xs text-slate-500 font-mono">
          {total > 0 ? (
            <>Showing <span className="text-slate-700 font-semibold">{from}</span>–<span className="text-slate-700 font-semibold">{to}</span> of <span className="text-slate-700 font-semibold">{total}</span></>
          ) : (
            <>No results</>
          )}
        </div>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
          className="input px-2 py-1 text-xs"
          data-testid={`${testPrefix}-page-size`}
          aria-label="Rows per page"
        >
          {sizes.map(n => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>
      {total > 0 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange?.(Math.max(1, current - 1))}
            disabled={current <= 1}
            className="btn btn-ghost text-xs !px-3 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid={`${testPrefix}-page-prev`}
          >
            ← Prev
          </button>
          {nums.map((n, i) => {
            const prev = nums[i - 1];
            const gap = prev && n - prev > 1;
            return (
              <span key={n} className="flex items-center gap-1">
                {gap && <span className="text-slate-400 text-xs px-1">…</span>}
                <button
                  onClick={() => onPageChange?.(n)}
                  className={`min-w-[32px] px-2 py-1 rounded-md text-xs font-mono border transition-colors ${n === current ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"}`}
                  data-testid={`${testPrefix}-page-${n}`}
                  aria-current={n === current ? "page" : undefined}
                >
                  {n}
                </button>
              </span>
            );
          })}
          <button
            onClick={() => onPageChange?.(Math.min(totalPages, current + 1))}
            disabled={current >= totalPages}
            className="btn btn-ghost text-xs !px-3 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid={`${testPrefix}-page-next`}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
