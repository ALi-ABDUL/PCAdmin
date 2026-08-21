export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const KEYS = { sb: "adm_sb", sa: "adm_sa", method: "adm_method" };
export const loadKeys = () => ({
  scrapingbee_key: localStorage.getItem(KEYS.sb) || "",
  scraperapi_key:  localStorage.getItem(KEYS.sa) || "",
  method: localStorage.getItem(KEYS.method) || "auto",
});
export const proxyImg = (u) => `${API}/image-proxy?url=${encodeURIComponent(u)}`;
