# Aussie Admin Dashboard — PRD

## Problem statement
Build an eBay Australia scraper (ebay.com.au only) with manual + auto scraping methods,
anti-bot tactics, item detail import, and a full-featured admin dashboard for an e-commerce
store (electronics, home, tools). Products imported from eBay flow into the catalog.
Light, modern theme.

## Architecture
- Backend: FastAPI + MongoDB (motor). `curl_cffi` for browser TLS impersonation to defeat
  eBay anti-bot. `httpx` + BeautifulSoup fallback. ScrapingBee & ScraperAPI as external fallbacks.
- Frontend: React 19 + Tailwind + Framer Motion + Recharts + Sonner. Light theme
  (#F7F7FB background, indigo/pink accents, Outfit/Inter/JetBrains Mono fonts).

### Backend endpoints
- `GET /api/analytics/report` (2026-02-19) — supplies the new Reporting page:
  `top_suppliers` (top 5 by revenue), `margin_trend` (30 days with margin %),
  `category_performance` (revenue+profit+margin per category), `best_margin_products`
  (top 20 by margin %). `/api/analytics/overview` still powers the main Dashboard.

### Duplicate URL detection + Bulk push to Products (2026-02-20)
**Duplicate URL detection** — a light-weight `existingUrls` Map keyed by `item_id`
and full URL is fetched once on Product Sourcing mount (`limit=500`). As you type
into the URL input, a regex pulls the eBay `item_id` from any URL shape (`/itm/…`
paths, `?iid=`) and matches against the Map. If a match is found a big amber
banner (`[data-testid=dup-warning]`) appears under the input showing the existing
title, price, import date and a **View existing** button. Clicking Import on a
duplicate URL now prompts `window.confirm` before proceeding, so accidental
re-imports need explicit consent.

**Bulk push to Products** — new backend action `add_to_products` on
`POST /api/items/bulk`. For each selected item it computes the sell price via
active pricing rules, creates a `Product`, links `source_item_id`, and marks the
scraped item `added_to_products=True`. Items already added are counted as
`skipped` so re-runs are idempotent. Toast reports `created / skipped / errors`.
Frontend button `[data-testid=scraper-bulk-add-products]` sits first on the bulk
bar and refreshes the existence map on completion.

### Product Sourcing filters + bulk actions (2026-02-20)
**New filters** on `GET /api/items`: `category`, `min_price`, `max_price`, extra
`status` values `active` / `out_of_stock` / `price_changed` / `inactive`, plus a
`sort=margin_desc` mode that runs the rules-aware `calc_pricing` server-side.

**Bulk endpoint** `POST /api/items/bulk { ids, action }` — supports `delete`,
`deactivate`, `activate`. New `active: bool = True` field on `ScrapedItem`.

**Frontend** toolbar (data-testid `scraper-toolbar`):
- Debounced 250 ms search box (title / seller / location)
- Category dropdown (populated from `/api/categories`)
- Status dropdown: All / Active / Out of stock / Price changed
- Min / Max price inputs
- Sort dropdown: Newest, Price low→high, Price high→low, **Highest margin**,
  Oldest, Title A→Z
- "Reset filters" chip appears whenever ≥1 filter is active

**Bulk selection**:
- Per-card checkbox (`scraped-card-checkbox`) + "Select all" toggle
- Sticky bulk bar (`scraper-bulk-bar`) with actions: **Delete**, **Mark inactive**,
  **Reactivate**
- Cards get an indigo ring while selected; inactive cards render with a dimmed
  "Inactive" chip. Cards flagged `price_changed` show a warning chip.

### Push credentials — DB-only, no .env (2026-02-20)
- `.env` no longer contains any Resend / Telegram keys. Fallback code paths were
  removed from `_send_email`, `_send_telegram`, `_push_channel_status`.
- Credentials live exclusively in `db.push_settings` (single doc, id="singleton").
- `_send_email` / `_send_telegram` re-read from the DB on every call, so edits from
  the UI take effect on the next notification without any restart.
- UI's `.env` badge removed; help copy now reads "stored in the database and read
  live on every send — no restart needed".

### Editable push credentials from the UI (2026-02-20)
- Push credentials (`resend_api_key`, `resend_to_email`, `resend_from_email`,
  `telegram_bot_token`, `telegram_chat_id`) now live in `db.push_settings` and are
  editable from **Store Management → Push Notifications**.
- Secrets returned masked in `GET /api/push/settings` (e.g. `re_••••abc`) with
  `_set` / `_from_env` flags so the UI knows whether a value is saved, coming from
  `.env`, or absent.
- `PATCH /api/push/settings` accepts any subset of fields. Empty-string secrets are
  ignored so users don't wipe a saved key by mistake; use the trash icon or
  `POST /api/push/settings/clear-secret?field=…` to explicitly clear.
- Runtime priority is **DB value → env var → no-op** — existing `.env` still works.
- Frontend: each channel card shows the API key + address inputs with reveal-eye,
  clear-trash, "saved / .env" badges; a single **Save credentials** button commits
  the whole draft; **Discard** reverts. Send-test button uses the live configured
  channels.

### In-app toasts on new notifications (2026-02-20)
- `NotificationBell` keeps a `seenIdsRef` (initialised silently on first load so we don't
  toast the backlog on page refresh). On every subsequent poll it diffs and fires a
  Sonner toast for each fresh, unread notification with the type icon + coloured
  accent + smart description (price arrow + margin swing for `price_change`,
  `body` for other types) + an "Open" action that runs the same click-to-navigate as
  the dropdown row.
- Polling interval dropped from 30 s to 15 s so alerts feel real-time.
- Verified end-to-end via Playwright: a fresh notification inserted after mount
  reliably produces `[data-sonner-toast]:has-text("New order received")` within the
  next poll cycle.

### More notification types + Push-to-Phone (2026-02-20)
**Types added** — the bell now emits and renders 6 types with distinct icons/colours:
- `price_change`, `new_order`, `out_of_stock`, `low_stock`, `order_status`, `new_customer`.

**Auto-emitted from**:
- `POST /api/orders` → `new_order` (+ `low_stock` if resulting stock ≤ 3)
- `PATCH /api/orders/{id}` with a new `status` → `order_status`
- `POST /api/customers` → `new_customer`
- Scrape/refresh detecting a listing went sold → `out_of_stock` for every linked product

**Click-to-navigate**: each row deep-links to the relevant Orders / Products /
Customers / Product Sourcing tab via `onNavigate({tab, section})` passed through
`NotificationBell → TopHeader → AppShell.navigateTo`.

**Push channels (Email · Resend + Telegram)**:
- Backend `_push_notification(n)` fires channels in parallel via
  `asyncio.create_task(...)` right after inserting the DB row — never blocks the request.
- Critical-only filter (default ON): only `new_order`, `out_of_stock`, and
  `price_change` with margin drop ≥ threshold (default 3pp) push to phone.
- Endpoints: `GET/PATCH /api/push/settings`, `POST /api/push/test`.
- Env vars: `RESEND_API_KEY`, `RESEND_TO_EMAIL`, `RESEND_FROM_EMAIL`,
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Missing keys are silently skipped.
- Frontend page **Store Management → Push Notifications** shows configured/ready state,
  channel enable-toggles, critical-only checkbox, threshold input, and a live
  **Send test push** button.

### Notification bell + price-change alerts (2026-02-20)
- New `Notification` collection. `_emit_price_change_notifications()` fires whenever a
  scrape/refresh detects `price_value != last price_history value` on a scraped item.
  Each notification captures: product title, image, old/new eBay price, old/new sell
  price + profit computed via active pricing rules, old/new margin %, and delta_margin
  (pp change). Fires once per linked product (or once against the raw item if none linked).
- Endpoints: `GET /api/notifications?unread_only=&limit=`, `POST
  /api/notifications/{id}/read`, `POST /api/notifications/mark-all-read`.
- Frontend `<NotificationBell/>` component in the top bar, next to the admin pill.
  Red circular badge shows unread count (or `99+` beyond 99). Clicking opens a 380px
  dropdown with product thumb, title, `old → new` price (arrow + colour), margin swing
  in percentage points. Click a row → mark that one read. "Mark all read" clears the
  badge. 30-second polling keeps the count fresh; outside-click closes the dropdown.
- Seeded 4 demo alerts covering both drops and rises so the badge / dropdown is visible
  from day one.

### Order delivery address (2026-02-20)
- New `ShippingAddress { full_name, street, suburb, state, postcode, country }` on every
  order. `POST /api/orders` accepts it and `create_order` persists it.
- Demo seed now generates realistic AU addresses across 30 popular suburbs (all 8 states/
  territories) with unit + street numbers. Existing 1592 orders were backfilled with a
  seeded RNG so every order in the DB now has an address.
- `OrderDetailsModal` shows a dedicated **Delivery address** panel with test IDs
  `order-delivery-address`, `addr-name`, `addr-street`, `addr-suburb`, `addr-state`,
  `addr-postcode`, `addr-country`.

### Pricing Rules — Store Management (2026-02-20)
- New page **Store Management › Pricing Rules** (data-testid `store-pricing-rules`).
- Backend model `PricingRule { label, min_price, max_price?, kind: flat|percent, value,
  active, sort_order }`. Endpoints: `GET/POST /api/pricing-rules`, `PATCH/DELETE
  /api/pricing-rules/{id}`. Seeded on first startup with the 5 default tiers.
- `calc_pricing(ebay, rules)` walks rules in ascending `sort_order` — first active rule
  whose `min <= ebay < max` wins. Falls back to the old `20% + $20` rule when no
  tier matches. Response now includes `matched_rule`.
- `POST /api/products/from-item/{id}` and `GET /api/pricing/calc` both use active rules.
- Frontend `usePricingRules()` hook fetches rules once (shared cache + listener pool)
  so the scraper cards, All Products table and Dashboard Profit Calculator all reflect
  edits without extra fetches. The calculator shows the matched tier chip live.

### Profit / pricing calculator (2026-02-19)
- **Pricing rule**: `sell = eBay × 1.20 + $20` (20% margin + $20 minimum profit floor).
  `profit = sell − eBay`.
- Backend helper `calc_pricing(ebay_price, margin_pct, min_profit)` + endpoint
  `GET /api/pricing/calc?ebay_price=…` for on-demand manual calls.
- `POST /api/products/from-item/{id}` now uses the rule (dropped the old 25% markup).
- **Product Sourcing card**: 3-tile inline pricing (eBay / Sell / Profit).
- **All Products table**: added three right-aligned columns — eBay / Sell / Profit.
- **Dashboard "Profit calculator" widget**: manual eBay-price input → live eBay / Sell /
  Profit + ROI %. Positioned right after the KPI rows for immediate visibility.

## Features implemented (through 2026-02-19)
### Automatic category detection (2026-02-19)
- `scraper.py` now extracts eBay's own category breadcrumb from JSON-LD `BreadcrumbList`
  first, then falls back to the visible breadcrumb widget (`nav.breadcrumbs`,
  `#vi-VR-brumb-lnkLst`, `.breadcrumbs a`, `.seo-breadcrumb-text`).
- `_guess_category(title, breadcrumbs, specifics)` is a 3-signal guesser: it walks the
  breadcrumb leaf→root against `_EBAY_BREADCRUMB_MAP` (30 top eBay AU categories), then
  falls back to keyword rules on the crumb text; if still unmatched, checks item
  specifics keys `Category / Sub-Type / Type / Product Type / Model / Brand`; last
  resort is the title. Falls back to `"other"` only when nothing matches.
- Every scraped item now stores `category` and `ebay_category_path`. "Add to products"
  inherits the item's category (falls back to a re-guess if missing).
- Backfilled the 34 existing items (title-only signal available): 8 → "other" and 26
  auto-classified across cycling / automotive / furniture / vacuums-cleaning / cameras-photo etc.
- Scraper card shows a category chip (`[data-testid=scraped-card-category]`). Item modal
  shows both the detected slug and the full eBay breadcrumb path.

### Scraper
- eBay AU scraper with curl_cffi Chrome TLS impersonation, warm-up cookies, rotating UAs,
  retry+jitter. Description iframe fetch, up to 20 images, item specifics parsing.
- Extracts postage_display, postage_fee, delivery_estimate, collection, returns_policy,
  payment_methods.
- Sold detection: `is_sold` flag grays out card and auto-deactivates linked product; fires
  toast via `/api/sold-events`.
- Nightly asyncio auto-refresh of every item + `POST /api/items/refresh-all` button.
- **Search & filter on the Scraper page**: search box, status filter (Live/Sold),
  sort dropdown (Newest / Oldest / Price ↓ / Price ↑ / Title A→Z). Backend `GET /api/items`
  now accepts `status=live|sold` and multiple sort keys.
- Per-item `feature_flags` toggled inline in modal.

### Admin Dashboard
- Sidebar shell with grouped sections + slide-in secondary sidebars for Store Management,
  Products, Suppliers, Customers, Orders, Payments.
- Dashboard KPIs, 30-day revenue+profit chart, category donut, top products, recent orders.
- Products: CRUD, category filter, sort by price/stock/best sellers; nav trimmed to
  **All Products / Low Stock / Out of Stock / Price Alerts**.
- **Price Alerts (2026-02-19)** — real backend data. Every item.price_history change is
  captured on refresh; the Price Alerts view lists top movers with drop/rise chips.
- **Price History chart in ItemModal (2026-02-19)** — Recharts line chart over the full
  price_history; single-point items show a helpful placeholder.
- **Suppliers module refactored to eBay AU Sellers (2026-02-19)** — auto-populated from
  scraped items. Table columns are exactly: Seller Name / Total Products / Total Orders /
  Revenue Generated / Last Active / Status. Sub-nav trimmed to 5 links:
  All / Top / Products / Orders / Activity. Backend endpoints `POST/PATCH/DELETE/import`
  removed; only `GET /api/suppliers`, `GET /api/suppliers/summary`, `GET /api/suppliers/{id}`
  remain (all derived on-the-fly from `db.items`).
- Categories: auto-seeded 29 categories with icon/colour + CRUD.
- Customers: 18 sub-links, 177 auto-derived from orders on first startup.
- Orders: All (with 7 status tabs + inline edit), Returns & Refunds, Abandoned Carts.
- Payments: All Transactions (with 3 status tabs), Refunds & Chargebacks.
- Store Management: 15 sub-links across 5 groups.
- Analytics: all-time KPIs + daily bar chart.
- Settings: store settings + scraper API keys (localStorage) + default method.

## Backlog / roadmap
### P1
- Bulk import (paste multiple eBay URLs)
- CSV/JSON export for products & orders
- Watchlist tag/toggle explicit (watchlist column already in schema, not yet exposed
  in UI beyond the general items list)

### P2
- Real customer accounts (currently derived from orders)
- Public storefront reading /api/products
- Admin authentication
- Product ↔ supplier linking (kept minimal after suppliers refactor)
- Refactor `App.js` (2600+ lines) into per-module files: `Suppliers.jsx`,
  `ScraperPage.jsx`, `ProductsPage.jsx`, `PriceHistoryChart.jsx`, `nav.js`.
- Replace N+1 pattern in `_build_sellers()` with a single `$lookup` aggregation
  when seller count grows beyond ~500.

## Test coverage
- `/app/backend/tests/test_suppliers_and_items.py` — 12 pytest cases (all pass).
- Latest iteration report: `/app/test_reports/iteration_1.json` (100% backend & frontend).
