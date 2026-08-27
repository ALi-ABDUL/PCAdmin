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

export async function refreshBranding() {
  try {
    const { data } = await axios.get(`${API}/branding`);
    _cache = {
      name: data.name || "PCAdmin",
      subtitle: data.subtitle || "",
      logo: data.logo || null,
    };
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
  window.dispatchEvent(new CustomEvent("brandingchange", { detail: getBranding() }));
  return getBranding();
}
