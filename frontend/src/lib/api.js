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

/**
 * Rewrite the resolution token in an eBay CDN URL so the browser only pulls
 * the size it actually needs. We store the biggest form (`s-l1600`) in the
 * database and generate thumbnails on the fly.
 *
 *   imgAtSize(url, 300)  → `/s-l300.jpg`
 *   imgAtSize(url, 1600) → `/s-l1600.jpg`
 *
 * URLs without an `s-l<digits>` token (non-eBay CDNs, uploaded assets) are
 * returned unchanged so we never accidentally break a working image.
 */
export const imgAtSize = (u, size = 1600) => {
  if (!u || typeof u !== "string") return u;
  if (!/\/s-l\d+\./i.test(u)) return u;
  return u.replace(/\/s-l\d+\./i, `/s-l${size}.`);
};
export const imgThumb = (u) => imgAtSize(u, 300);
export const imgFull  = (u) => imgAtSize(u, 1600);
