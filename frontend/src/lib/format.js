export const money = (n, cur = "AUD") => (n == null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n));
export const moneyCents = (n) => (n == null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n));
export const fmtDate = (iso) => { try { return new Date(iso).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; } };
export const fmtDay = (iso) => { try { return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" }); } catch { return iso; } };

// Pricing rules — loaded from /api/pricing-rules; fallback = 20% + $20 floor.
export const humaniseStatus = (s) => (s || "").replace(/_/g, " ");

