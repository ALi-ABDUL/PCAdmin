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
 */

/** Add N business days (weekends skipped) to `date`. Returns a new Date. */
export function addBusinessDays(date, days) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  let added = 0;
  const n = Math.max(0, Math.floor(Number(days) || 0));
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay(); // 0=Sun, 6=Sat
    if (wd !== 0 && wd !== 6) added++;
  }
  return d;
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
 * Compute both bounds of the delivery estimate. Pass `today` for tests;
 * defaults to `new Date()` so every render picks up the current day.
 */
export function computeDeliveryEstimate(minDays, maxDays, today = new Date()) {
  const min = Math.max(0, Math.floor(Number(minDays) || 0));
  const max = Math.max(min, Math.floor(Number(maxDays) || 0));
  const fromDate = addBusinessDays(today, min);
  const toDate = addBusinessDays(today, max);
  return {
    minDays: min,
    maxDays: max,
    fromDate,
    toDate,
    from: formatDeliveryDate(fromDate),
    to: formatDeliveryDate(toDate),
    label: `Estimated delivery between ${formatDeliveryDate(fromDate)} and ${formatDeliveryDate(toDate)}`,
  };
}
