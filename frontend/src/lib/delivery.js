/**
 * Business-day date math shared between the Store Management delivery
 * settings editor and the Product Detail estimate preview.
 *
 * We treat "business days" as Mon-Fri. Public holidays are ignored (the
 * store is Australia-wide but honouring every state's holiday calendar
 * would be a lot of complexity for the tiny UX gain). Weekends are always
 * skipped so N business days from a Friday lands on the following week.
 *
 * The estimate is computed at render time in the browser, so the range
 * automatically rolls forward each new day without any cron job or manual
 * refresh — that's the "auto-updates daily" property the admin asked for.
 *
 * Same-day cutoff: orders placed before `cutoff_hhmm` still ship today,
 * but anything later (or placed on a weekend) starts counting from the
 * next business day. `computeDeliveryEstimate` returns a `shifted` flag +
 * the resolved `shipDate` so the UI can surface a small "shipping
 * tomorrow" chip when the shift kicks in.
 */

const WEEKEND = new Set([0, 6]); // Sun, Sat

/** Return true when `d` is Sat or Sun. */
export function isWeekend(d) {
  return WEEKEND.has(new Date(d).getDay());
}

/** Advance `d` to the next Mon-Fri (returns a new Date). No-op on weekdays. */
export function nextBusinessDay(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  while (WEEKEND.has(out.getDay())) out.setDate(out.getDate() + 1);
  return out;
}

/** Add N business days (weekends skipped) to `date`. Returns a new Date. */
export function addBusinessDays(date, days) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  let added = 0;
  const n = Math.max(0, Math.floor(Number(days) || 0));
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (!WEEKEND.has(d.getDay())) added++;
  }
  return d;
}

/** Parse an "HH:MM" string; returns null when malformed. */
export function parseHHMM(hhmm) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  return { hours: Number(m[1]), minutes: Number(m[2]) };
}

/** Pretty 12-hour render, e.g. "2:00 PM". */
export function formatCutoffLabel(hhmm) {
  const p = parseHHMM(hhmm);
  if (!p) return hhmm || "—";
  const ampm = p.hours >= 12 ? "PM" : "AM";
  const h12 = ((p.hours + 11) % 12) + 1;
  return `${h12}:${String(p.minutes).padStart(2, "0")} ${ampm}`;
}

const FMT = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "Mon, 3 Mar" — the same friendly format eBay uses. */
export function formatDeliveryDate(date) {
  return FMT.format(date);
}

/**
 * Resolve the ship day given the current instant and a cutoff config.
 * When the cutoff is enabled and now is past it (or today is a weekend),
 * shipping moves to the next business day. When the cutoff is disabled,
 * we still skip weekends because the store can't physically dispatch then.
 *
 * Returns `{ shipDate, shifted, reason }` where `reason ∈ 'cutoff' | 'weekend' | null`.
 */
export function resolveShipDate(now, { enabled, hhmm } = {}) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1); // DST-safe next day
  const parsed = parseHHMM(hhmm);
  // Weekend: always shift regardless of cutoff.
  if (WEEKEND.has(now.getDay())) {
    return { shipDate: nextBusinessDay(tomorrow), shifted: true, reason: "weekend" };
  }
  // Cutoff shift.
  if (enabled && parsed) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const cutMin = parsed.hours * 60 + parsed.minutes;
    if (nowMin >= cutMin) {
      return { shipDate: nextBusinessDay(tomorrow), shifted: true, reason: "cutoff" };
    }
  }
  return { shipDate: today, shifted: false, reason: null };
}

/**
 * Compute both bounds of the delivery estimate. Pass `today` for tests;
 * defaults to `new Date()` so every render picks up the current day.
 *
 * `cutoff` is optional — when omitted, the estimate simply counts from
 * today with weekends skipped. When provided, orders placed after the
 * cutoff shift to the next business day.
 */
export function computeDeliveryEstimate(minDays, maxDays, today = new Date(), cutoff = null) {
  const min = Math.max(0, Math.floor(Number(minDays) || 0));
  const max = Math.max(min, Math.floor(Number(maxDays) || 0));
  const { shipDate, shifted, reason } = resolveShipDate(today, cutoff || {});
  const fromDate = addBusinessDays(shipDate, min);
  const toDate = addBusinessDays(shipDate, max);
  return {
    minDays: min,
    maxDays: max,
    shipDate,
    shifted,
    shiftReason: reason,
    fromDate,
    toDate,
    from: formatDeliveryDate(fromDate),
    to: formatDeliveryDate(toDate),
    label: `Estimated delivery between ${formatDeliveryDate(fromDate)} and ${formatDeliveryDate(toDate)}`,
  };
}
