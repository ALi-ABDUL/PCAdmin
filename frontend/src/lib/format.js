export const money = (n, cur = "AUD") => (n == null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n));
export const moneyCents = (n) => (n == null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n));
export const fmtDate = (iso) => { try { return new Date(iso).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; } };
export const fmtDay = (iso) => { try { return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" }); } catch { return iso; } };

/**
 * Long, humanised timestamp used on customer profile & list:
 *   "Monday, 23 Aug 2026 at 7:05 PM"
 * Falls back to the raw string on invalid input.
 */
export const fmtLongDateTime = (iso) => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso || "—";
    const weekday = d.toLocaleDateString("en-AU", { weekday: "long" });
    const rest = d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
    const timePart = d
      .toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })
      .replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toUpperCase()}`);
    return `${weekday}, ${rest} at ${timePart}`;
  } catch { return iso || "—"; }
};

// Pricing rules — loaded from /api/pricing-rules; fallback = 20% + $20 floor.
export const humaniseStatus = (s) => (s || "").replace(/_/g, " ");

