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
