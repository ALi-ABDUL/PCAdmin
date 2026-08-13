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
