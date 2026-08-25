/**
 * Dashboard Layout preferences.
 * Stored in localStorage so every admin/browser can hide widgets they
 * don't care about without server changes. The Dashboard page reads
 * `loadDashboardLayout()` on every render — flipping a toggle in
 * Settings › Dashboard Layout instantly hides/shows the section.
 */
const STORAGE_KEY = "dashboard_layout";

export const DASHBOARD_WIDGETS = [
  { id: "kpi_primary",    label: "Primary KPIs",          hint: "Revenue YTD, Profit YTD, Units sold, Avg order value" },
  { id: "kpi_secondary",  label: "Secondary KPIs",        hint: "Monthly / 7-day revenue, product count, Low stock" },
  { id: "profit_calc",    label: "Profit calculator",     hint: "Live sell-price + expected profit from an eBay price" },
  { id: "revenue_chart",  label: "Revenue chart + Category donut", hint: "30-day revenue-vs-profit area chart and category split" },
  { id: "stuck_orders",   label: "Stuck orders widget",   hint: "Orders that haven't advanced through fulfilment in 24h+" },
  { id: "top_recent",     label: "Top products & Recent orders", hint: "Top revenue products + latest 8 orders" },
];

const DEFAULTS = Object.fromEntries(DASHBOARD_WIDGETS.map(w => [w.id, true]));

export function loadDashboardLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULTS }; }
}

export function saveDashboardLayout(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("dashboardlayoutchange", { detail: next }));
  } catch { /* ignore */ }
}

export function resetDashboardLayout() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("dashboardlayoutchange", { detail: { ...DEFAULTS } }));
}
