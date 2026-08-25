/**
 * Global admin theme. The active theme lives in `settings.theme` on the
 * backend (persisted in the `settings` collection) so it survives logout /
 * new browsers. We mirror it to `localStorage` for two reasons:
 *   1. It lets us apply the correct theme on the very first paint —
 *      before the /api/settings fetch resolves — so the page doesn't
 *      flash light-then-dark on load.
 *   2. It's a resilient fallback if the settings request is slow / offline.
 *
 * Applying is dead simple: toggle a `dark` class on <html>. `index.css`
 * defines a `html.dark { --var: … }` block that recolours every CSS
 * variable the design system reads from, so the whole dashboard flips
 * paint colours instantly.
 */

export const THEMES = ["light", "dark"];
const STORAGE_KEY = "admin_theme";

export function applyTheme(theme) {
  const t = THEMES.includes(theme) ? theme : "light";
  const root = document.documentElement;
  root.classList.toggle("dark", t === "dark");
  root.dataset.theme = t;
  try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
  // Emit an event so any component that needs to react (e.g. re-render a
  // chart with new stroke colours) can subscribe without prop-drilling.
  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: t } }));
  return t;
}

export function getCachedTheme() {
  try { return localStorage.getItem(STORAGE_KEY) || "light"; }
  catch { return "light"; }
}
