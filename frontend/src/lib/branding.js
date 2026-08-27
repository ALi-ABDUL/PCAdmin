/**
 * Branding client — one-line loader/saver with a light event bus so any
 * component (sidebar header, browser tab title, etc.) can subscribe to
 * live changes without a page refresh.
 *
 * A single copy of the branding doc is cached in-module, primed once at
 * startup via `refreshBranding()` and then patched by `saveBranding()`.
 * Every mutation fires a `brandingchange` window event so subscribers
 * re-read the cache and re-render.
 */
import axios from "axios";
import { API } from "./api";

// Local cache primed at boot. Kept small on purpose — no reactivity
// framework, just a plain object + event bus. Consumers must call
// `getBranding()` to read (which returns a fresh reference).
let _cache = {
  name: "PCAdmin",
  subtitle: "v1.1 · AU",
  logo: null,
};

export function getBranding() {
  return { ..._cache };
}


/**
 * Push the current branding into <title> and the favicon.
 * Called from every mutation (refresh + save) so tab title and favicon
 * stay in sync without touching the code.
 *
 * Favicon strategy: remove every existing `<link rel~="icon">` and insert
 * a fresh one pointing at the uploaded data-URL. When the admin clears
 * the logo we drop back to the default `/favicon.ico`.
 */
function _applyBrandingToDocument() {
  try {
    document.title = _cache.name || "PCAdmin";
    const links = document.head.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]');
    links.forEach((l) => l.remove());
    const link = document.createElement("link");
    link.rel = "icon";
    if (_cache.logo) {
      link.href = _cache.logo;
      // Best-effort MIME detection from the data-URL prefix so browsers
      // that care (Safari) render it. Falls back to omitting the type.
      const m = /^data:([^;]+);/.exec(_cache.logo);
      if (m) link.type = m[1];
    } else {
      link.href = "/favicon.ico";
    }
    document.head.appendChild(link);
  } catch { /* SSR / non-browser safety net */ }
}


export async function refreshBranding() {
  try {
    const { data } = await axios.get(`${API}/branding`);
    _cache = {
      name: data.name || "PCAdmin",
      subtitle: data.subtitle || "",
      logo: data.logo || null,
    };
    _applyBrandingToDocument();
    window.dispatchEvent(new CustomEvent("brandingchange", { detail: getBranding() }));
    return getBranding();
  } catch {
    return getBranding();
  }
}

export async function saveBranding(patch) {
  const { data } = await axios.put(`${API}/branding`, patch);
  _cache = {
    name: data.name || "PCAdmin",
    subtitle: data.subtitle || "",
    logo: data.logo || null,
  };
  _applyBrandingToDocument();
  window.dispatchEvent(new CustomEvent("brandingchange", { detail: getBranding() }));
  return getBranding();
}
