# Aussie Admin Dashboard - PRD

## Problem statement
Build an eBay Australia scraper (ebay.com.au only) with manual + auto (ScrapingBee/ScraperAPI) methods, anti-bot tactics, item detail import, and a full-featured admin dashboard for an ecommerce store (electronics, home, tools). Products imported from eBay flow into the catalog. Light, fancy, modern theme.

## Architecture
- Backend: FastAPI + MongoDB (motor). curl_cffi for browser TLS impersonation (Chrome131 etc.) to defeat eBay anti-bot. httpx + BeautifulSoup fallback. ScrapingBee & ScraperAPI as external fallbacks.
- Frontend: React 19 + Tailwind + Framer Motion + Recharts + Sonner. Light theme (#F7F7FB background, indigo/pink accents, Outfit/Inter/JetBrains Mono fonts).

## Features implemented (2026-01-13)
- Sidebar-based admin dashboard shell (Dashboard/Products/eBay Scraper/Orders/Customers/Analytics/Settings)
- Dashboard KPIs: YTD/MTD/7d revenue, profit, units, AOV, low stock, product counts. Revenue+profit area chart (30d), category donut, top products, recent orders
- Products: full CRUD, category filter, sort by price/stock/best sellers, edit modal
- eBay AU scraper: paste URL → import, method selector (auto/manual/scrapingbee/scraperapi), rotating UAs + Chrome TLS impersonation, warm-up cookies, retry with jitter, description iframe fetching (real seller description), image extraction (up to 20 images), item specifics parsing
- One-click "Add to products" from any scraped item (auto-categorises, 25% markup, generates SKU)
- Orders: list, filter by status. Customers: derived from orders with LTV
- Analytics: all-time revenue/profit/orders/margin + daily bar chart
- Settings: store settings (name, email, currency, country, tax rate) + scraper API keys (localStorage) + default method
- Demo seed endpoint (/api/demo/seed) creates realistic 4-month order history against seeded products so dashboard is populated

## Backlog
- Bulk import (paste multiple URLs)
- CSV/JSON export
- Watchlist price tracking with cron auto-refresh
- Authentication for admin
- Real customer accounts (currently derived)
- Public storefront that reads /api/products

## Update (2026-01-14)
- Extracts postage_display, postage_fee, delivery_estimate, collection, returns_policy, payment_methods (with regex fallbacks — visibility depends on eBay's page for that listing/user location)
- Sold detection: is_sold flag set when eBay page shows "listing ended" / "sold" markers; grays out card in scraper AND auto-deactivates linked product
- Per-item feature_flags: show_postage, show_delivery, show_collection, show_returns, show_payments, show_seller, show_description, show_specifics, visible — toggled inline in the item modal
- Manual "Refresh all now" button in eBay AU Scraper header
- Background asyncio task (_nightly_refresh_loop) re-scrapes every item every 24h + writes summary to db.system.nightly
- New endpoints: PATCH /api/items/{id}/features, POST /api/items/refresh-all, GET /api/items/refresh-status
