export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const KEYS = { sb: "adm_sb", sa: "adm_sa", method: "adm_method" };
export const loadKeys = () => ({
  scrapingbee_key: localStorage.getItem(KEYS.sb) || "",
  scraperapi_key:  localStorage.getItem(KEYS.sa) || "",
  method: localStorage.getItem(KEYS.method) || "auto",
});
// Data URLs (from local uploads) and blob URLs are served in-place; only external
// http(s) URLs go through the CORS-friendly proxy.
export const proxyImg = (u) => (/^(data:|blob:)/i.test(u || "") ? u : `${API}/image-proxy?url=${encodeURIComponent(u)}`);
