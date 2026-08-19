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

## Features implemented (through 2026-02-19)
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
