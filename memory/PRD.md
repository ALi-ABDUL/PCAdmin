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


## Product Edit Page Layout Fix (2026-02-23)
**Bug**: The Product Edit page (`ProductDetail.jsx`) was stretching edge-to-edge and pushing action
buttons off-screen. Root cause: the container used `display: grid` with a 20-image
horizontal scroll strip child; the grid track auto-expanded to intrinsic child size
(~3470 px), so `max-w-4xl` capped visible width but children escaped horizontally —
Save/Refresh/Delete buttons ended up at x=4164 (off-screen).

**Fix** (`/app/frontend/src/pages/ProductDetail.jsx` line 108):
- `grid gap-4 max-w-4xl mx-auto w-full` → `flex flex-col gap-4 max-w-5xl mx-auto w-full min-w-0 px-1 sm:px-2`
- Flexbox column doesn't auto-size tracks to intrinsic content, so `overflow-x-auto`
  on the images strip now scrolls inside the card instead of blowing out the container.
- `max-w-5xl` (~1024 px) balances form density with readability per user preference.

**Verified** (iter 16, frontend 100%):
- No horizontal overflow at 1920 / 1440 / 1280 / 1024 px viewports.
- All 5 header buttons (Back, Refresh, Change category, Delete, Save) fully visible.
- 3-column product-details grid renders correctly on md+ (SKU 314 px per column).
- Edit + Save round-trip works; Back returns to product grid.


### Backend endpoints
- `GET /api/analytics/report` (2026-02-19) — supplies the new Reporting page:
  `top_suppliers` (top 5 by revenue), `margin_trend` (30 days with margin %),
  `category_performance` (revenue+profit+margin per category), `best_margin_products`
  (top 20 by margin %). `/api/analytics/overview` still powers the main Dashboard.

### Scraper Schedule under Store Management (2026-02-20)
- **Backend**: singleton `db.scraper_schedule` document with `enabled,
  start_time_hhmm, frequency, stop_date, last_run_at, last_run_stats, next_run_at,
  run_history, retry_pending`.
  Frequencies supported: `hourly / every_6h / every_12h / daily / weekly`.
- `_scheduler_loop()` polls every 60 s, computes `next_run_at` anchored on
  Australia/Sydney start time + frequency interval, and triggers
  `_refresh_all_and_record()` when due. `stop_date` (optional) pauses execution
  when the date is reached. The old `_nightly_refresh_loop` was retired.
- Endpoints: `GET /api/scraper/schedule`, `PATCH /api/scraper/schedule` (returns
  refreshed `next_run_at`), `POST /api/scraper/schedule/run-now` (triggers a
  full refresh immediately and updates last-run stats),
  `POST /api/scraper/schedule/clear-history` (wipes the audit log).
- **Frontend** page `Store Management → Scraper Schedule` shows:
  - Status strip: Active / Disabled / Stopped-past-stop-date, last-run relative
    time with stats, next-run in bold indigo.
  - Config card: enable toggle, HH:MM time picker, frequency dropdown, optional
    date picker with clear X, and a **Run now** button that surfaces the summary
    toast when done.
- Verified: PATCH frequency=weekly bumped next run 7 days out; PATCH back to
  daily anchored on 02:00 recomputed to today 16:00 UTC (02:00 AEST).

### Run History Log + Retry-on-Failure (2026-02-21)
- **Run History Log**: every completed run (scheduled, manual, or retry) is
  prepended to `scraper_schedule.run_history`, capped at 20 entries. Each entry:
  `{id, started_at, finished_at, duration_seconds, status, attempt, trigger,
  stats, error}`. Status is `success | failed | dead`.
- **Retry-on-Failure**: when a *scheduled* run fails (throws OR reports
  `refreshed==0 && total>0`), `retry_pending` is set to
  `{retry_at: now+15min, original_run_id, trigger: "scheduled"}`. The scheduler
  loop fires the retry when due (attempt=2). On retry success → cleared; on
  retry failure → marked `dead` and cleared. Manual runs never queue retries.
- **Frontend**:
  - Amber "Retry queued" banner with spinning refresh icon + retry ETA.
  - "Run history" card with clear-history button and a table showing when,
    trigger, status chip, duration, refreshed/total, sold, failed, and error
    text (truncated with tooltip).
- Tests: `/app/backend/tests/test_scheduler_history_and_retry.py` — 9 pytest
  cases (all pass) covering success append, 20-entry cap, newest-first order,
  scheduled+exception failure queues retry, retry success clears pending,
  retry failure marks dead, manual failure does not queue retry, clear-history.

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

### Customer Portal + Verified-Purchase Reviews (2026-02-21)
- **JWT auth (Bearer token, 7-day TTL)** — new collection `customer_accounts`
  `{id, email, password_hash, name, created_at}`. bcrypt password hashing,
  unique index on `email`. Env var `JWT_SECRET` in `backend/.env`.
- **Registration is gated** — the submitted email must already have at least one
  order in `db.orders`, blocking fake reviews from non-buyers.
- **New backend endpoints**:
  - `POST /api/portal/register` — 403 if email has no order, 409 on duplicate
    account, else creates account and returns `{token, customer}`.
  - `POST /api/portal/login` — returns `{token, customer}`.
  - `GET  /api/portal/me` — current customer from bearer token.
  - `GET  /api/portal/orders` — customer's orders + `can_review` (only paid
    or later) + `already_reviewed` flags.
  - `POST /api/portal/reviews` — verified-purchase review with dedupe (409 if
    already reviewed) and rating range 1–5 (400 otherwise). Reviews are
    auto-approved and stamped `verified_purchase: True`.
  - `GET  /api/portal/my-reviews` — customer's own reviews.
  - `POST /api/reviews/{rid}/vote` — `helpful | not_helpful | clear`; one vote
    per customer, can't vote on your own review. Response includes
    `my_vote` marker.
  - `GET  /api/products/{product_id}/reviews` — public aggregate feed:
    `{reviews, total, average_rating, rating_distribution}`.
- **Enhanced Review model** — adds `customer_email, order_id,
  verified_purchase, helpful_votes[], not_helpful_votes[]`. Public shape exposes
  `helpful_count`/`not_helpful_count` (raw email lists stripped).
- **Frontend — new "My Orders Portal" under Customers group** (`cus-portal`):
  - Login / register tabbed card with the "existing purchaser" hint.
  - Signed-in dashboard: header with Order count / Total spend / Awaiting-review
    count / Sign-out. Order cards show status chip, price, and either
    "You've reviewed this" chip, "Write a review" primary button, or
    "Review available once processed" chip.
  - Inline review composer with 1-5 star picker, optional title, body,
    Post/Cancel actions.
  - Under each order, an inline aggregate + up-to-3 reviews list with average
    stars, verified badge, and 👍/👎 vote buttons (auth-gated).
- **Enhanced admin Reviews page** — average rating card, star distribution bar
  chart, verified-purchase chip, helpful counts. Delete now confirms.
- Tests: `/app/backend/tests/test_customer_portal.py` — 13 pytest cases
  (all pass) covering register gates, login, review verification/dedup,
  public aggregate endpoint, and vote endpoint auth/validation.

### Auto-inactivation on eBay status change + Archive lifecycle (2026-02-22)
- **Scraper** (`scraper.py`): now classifies eBay listing state into
  `stock_status` ∈ `{live | sold | ended | out_of_stock}`. Priority:
  ended > sold > out_of_stock. `is_sold` is `True` for any non-live.
- **Product model** (`server.py`): adds `stock_status: str = "live"`,
  `archived: bool = False`, `archived_at: Optional[str]`. `ProductUpdate`
  accepts both new fields.
- **Scrape/refresh flow** (`scrape` handler): on any live→dead transition
  mirrors the status to every linked product (`{active: False, is_sold: True,
  stock_status, updated_at}`), inserts a `sold_events` doc stamped with
  `stock_status`, and fires a status-aware notification
  (`Listing ended on eBay` / `Sold on eBay` / `Out of stock on eBay`).
- **New endpoints**:
  - `GET /api/products` now defaults to `archived: {$ne: True}` (archived rows
    hidden from main list). `?archived=true` returns only archived products.
  - `POST /api/products/{pid}/archive` — sets archived+active=False+timestamp.
  - `POST /api/products/{pid}/restore` — clears archived; only re-activates if
    the eBay listing is still live (sold products stay inactive).
- **Frontend**:
  - New `Products → Archived` tab (`prd-archived`) with Restore + Delete.
  - `Products → All Products` grays out inactive rows and shows red status
    badges (`SOLD` / `ENDED` / `OUT OF STOCK`) via `statusBadge()` +
    `[data-testid=product-badge-<id>]`. Inactive rows get an additional
    `Archive` button next to Edit / Delete.
  - `Price Alerts` filters out `!is_sold && stock_status === "live"` and
    surfaces a `N sold / ended / out-of-stock listing(s) excluded` strip
    (`[data-testid=price-alerts-excluded]`).
- Tests: `/app/backend/tests/test_stock_status_and_archive.py` — 9 pytest
  cases (all pass) covering scraper classifier for the 4 states and the
  archive/restore lifecycle including "restore doesn't reactivate sold".
- Testing-agent iteration_3.json: 100% pass, no defects.

### Product codes, order refs, notification deep-links, category browser (2026-02-22b)
- **Product code generator** — every product now gets a `product_code` in the
  format `[first alnum of title][first-letter of weekday][2-digit day]-PC[2-digit month][2-digit year]`
  (e.g. `KF21-PC0826` for a Keyboard on Friday 21 Aug 2026). Duplicates receive
  a `-N` suffix (`KF21-PC0826-2`). Helpers: `_product_code_base`,
  `_generate_unique_product_code`. Backfill on startup wrote codes to 29
  existing products; unique sparse index enforces uniqueness.
- **Order references** — `Order.reference` is populated from the linked
  product's `product_code` at creation. Backfill wrote references to 787 existing
  orders. Frontend Orders table now uses **Reference** as the first column.
- **Notification deep-links** — clicking a notification with `order_id` or
  `product_id` navigates to Orders/Products AND opens the specific detail
  modal via a new `deepLink` state passed to the module. New backend endpoint
  `GET /api/orders/{oid}` for fetch-on-demand when the item isn't in the
  current filter.
- **Categories → click-to-browse** — clicking a category card opens
  `CategoryProductBrowser` (grid view) with each product showing image, status
  badge, `product_code` chip, eBay/Sell/Margin/Stock stats, and inline
  Edit / Update Price / Refresh from eBay / Delete buttons. `cat-back` returns
  to the categories grid.
- **Removed** — `Returns & Refunds` from Store Management sidebar and
  `settingsMeta.returns-refunds`. (The Orders → Returns page is untouched.)
- Tests: `/app/backend/tests/test_product_code.py` — 9 pytest cases (format +
  dedup) + `/app/backend/tests/test_product_code_orders_api.py` — 6 pytest
  cases (API-level product_code / order.reference / new /orders/{oid}
  endpoint / regression of /orders/status-counts).
- Testing agent iteration_4.json: 100% pass (15/15 backend, 8/8 frontend), no
  defects.

### Variants + Bulk Archive + Product Reviews + Global Search + Restock Alerts (2026-02-23)
- **Variant scraper** — `_extract_variants()` in `scraper.py` parses JSON-LD
  `hasVariant` (priority) then falls back to eBay's DOM variation select boxes.
  Returns `[{type, option, price, currency, stock_status, sku?}]` on every
  scrape. `ScrapedItem` and `Product` models gained `variants: List[dict]`.
  Variants mirror to linked products on every scrape/refresh.
- **Bulk archive/delete endpoints** — `POST /api/products/bulk-archive` and
  `POST /api/products/bulk-delete` accept `{product_ids: [...]}` and act in one
  call. Frontend All Products has checkbox column + master toggle + indigo
  action bar showing "N selected", "Select all inactive", "Clear",
  "Archive N products" primary CTA.
- **Reviews aggregate on Products** — `GET /api/products` and
  `GET /api/products/{id}` now include `review_count` and `average_rating`
  (computed via a single Mongo $group over reviews). Rendered as a new "Rating"
  column on All Products, under the title on Category browser cards, and in
  the ProductEditModal header. The modal also embeds a "Reviews · N" section
  with up to 5 latest verified reviews.
- **Global (top-bar) search** — new `GET /api/search?q=` returns matching
  products (by product_code, sku, title) and orders (by reference, id,
  customer_email). Frontend `GlobalSearch` component debounces input,
  shows up to 8 products + 8 orders in a dropdown, and click-through
  uses the deep-link mechanism to open the exact product/order modal.
- **Restock alerts** — scrape flow detects `dead→live` transition and emits a
  `restock` notification (title "Back in stock on eBay"). Does NOT auto-activate;
  admin restores from the Archived tab. NOTIF_META entry + green icon added.
  Restock notifications deep-link to the product modal like OOS ones.
- Tests: `/app/backend/tests/test_variants_and_search.py` — 10 pytest cases
  (all pass) covering variants scraper, review aggregates on products list +
  single, bulk archive/delete, search by code/reference/validation, and the
  restock code-path presence.
- Testing agent iteration_5.json: 100% pass (backend + frontend), no defects.

## Backlog / roadmap
### P1
- Bulk import (paste multiple eBay URLs)
- CSV/JSON export for products & orders
- Watchlist tag/toggle explicit (watchlist column already in schema, not yet exposed
  in UI beyond the general items list)

### P2
- Public storefront reading /api/products (would consume `GET /api/products/{id}/reviews` already implemented)
- Admin authentication
- Product ↔ supplier linking (kept minimal after suppliers refactor)
- Replace N+1 pattern in `_build_sellers()` with a single `$lookup` aggregation
  when seller count grows beyond ~500.

## Modular refactor (2026-02-21) ✅
Split both monolithic files into cohesive modules while preserving 100% behavior.

**Backend** (server.py 3272 → 1862 lines, +3 new modules):
- `deps.py` (22 lines) — `app`, `api_router`, `db`, `client`, `logger` + env load
- `models.py` (580 lines) — All 58 Pydantic classes + data constants (CATEGORIES,
  SEED_CATEGORIES, PUSH_SETTINGS_DEFAULTS, SCRAPER_SCHEDULE_DEFAULTS, JWT config,
  category rules, AU address suburbs, etc.)
- `helpers.py` (851 lines) — All 42 helper functions: pricing, JWT/auth,
  scheduler, notifications (email/telegram), category classifier, seller
  aggregator, seeders, backfills
- `server.py` — endpoints only + startup + shutdown + CORS + image proxy

**Frontend** (App.js 5197 → 167 lines, +30 new modules):
- `lib/api.js` — API base, KEYS, proxyImg, loadKeys
- `lib/format.js` — money, fmtDate, humaniseStatus
- `lib/pricing.js` — usePricingRules hook + calcPricing cache
- `lib/nav.js` — all sidebar NAV constants + ORDER_STATUSES + ORDER_STATUS_STYLE
- `lib/portal-auth.js` — usePortalAuth hook + PORTAL_TOKEN_KEY
- `components/icons.jsx` — ICON_MAP + CatIcon
- `components/layout.jsx` — Sidebar + SubSideNav + SubMobileNav
- `components/header.jsx` — TopHeader + GlobalSearch + NotificationBell
- `components/atoms.jsx` — StatusChip, statusBadge, StatBox, InfoBox, KpiCard,
  SubHero, ScaffoldList, Field
- `components/modals/{ItemModal,ProductEditModal,CategoryEditModal,OrderDetailsModal}.jsx`
- `pages/{Dashboard,Suppliers,Customers,CustomerPortal,Products,ProductsList,ArchivedProducts,ProductDetail,Orders,OrderDetail,Payments,Store,Categories,Scraper,Analytics,Settings}.jsx`

**Testing**: iteration_7.json — all 84 pytest tests PASS + 14 new refactor
smoke tests PASS + full frontend regression (Dashboard, Products, Orders,
Analytics, Categories, Scraper, Customer Portal login as aliko, Global Search,
Notification Bell deep-links) — zero regressions detected.

**Test-suite update**: `tests/test_scheduler_history_and_retry.py`
`monkeypatch.setattr(server, "_refresh_all_items", …)` was changed to
`monkeypatch.setattr(helpers, …)` to reflect the new module boundary.

## Test coverage
- `/app/backend/tests/test_suppliers_and_items.py` — 12 pytest cases (all pass).
- `/app/backend/tests/test_scheduler_history_and_retry.py` — 9 pytest cases
  (all pass) covering run history + retry-on-failure orchestration.
- `/app/backend/tests/test_customer_portal.py` — 13 pytest cases (all pass)
  covering portal auth, verified-purchase reviews, and helpful voting.
- `/app/backend/tests/test_aliko_portal_flow.py` — 6 pytest cases (all pass)
  targeting the aliko@yopmail.com fresh-account regression.
- `/app/backend/tests/test_stock_status_and_archive.py` — 9 pytest cases
  (all pass) covering the scraper stock_status classifier + product
  archive/restore lifecycle.
- `/app/backend/tests/test_product_code.py` — 9 pytest cases (all pass)
  covering product_code format and dedup.
- `/app/backend/tests/test_product_code_orders_api.py` — 6 pytest cases
  (all pass) covering API-level product_code + order.reference behavior.
- `/app/backend/tests/test_variants_and_search.py` — 10 pytest cases (all pass)
  covering variant scraper, review aggregates, bulk archive/delete, global
  search, and restock code-path presence.
- Latest iteration report: `/app/test_reports/iteration_7.json` (100% backend & frontend
  post-refactor).

## Feb 24, 2026 — Customers list pagination
- Backend `GET /api/customers` now accepts `skip` (default 0) alongside
  existing `limit`, enabling proper page-based navigation.
- Frontend `CustomersModule` tracks `page` + `pageSize` (default 50, options
  50/100/150/200) and resets to page 1 when section/search/sort/pageSize
  change.
- `CustomerTable` renders a footer with "Showing X–Y of TOTAL", a page-size
  dropdown, Prev/Next buttons, and windowed numeric page buttons (first,
  last, current ±1) with ellipses for large ranges.
- Smoke-tested end-to-end with 238 seeded customers: page 1 shows 1–50,
  page 2 shows 51–100, page-size switches correctly, URL query passes
  `limit`/`skip`.


## Feb 24, 2026 — Sidebar unread badge is "seen"-based
- Backend: `GET /api/customers/unread-count` now counts distinct inbound
  customer emails whose `created_at > messages_last_seen_at` watermark
  (stored in `db.admin_meta._id = "main"`). New endpoint
  `POST /api/customers/messages/mark-seen` advances that watermark to now.
- Frontend: `App.js` calls `mark-seen` (a) when the admin opens the
  Customer Messages section, and (b) when the admin clicks the sidebar
  Customers unread badge. The client also zeroes the count optimistically
  so the badge disappears the instant it is clicked, then re-appears only
  when a genuinely new inbound message arrives.
- Verified end-to-end with curl (7→8→0→1 across post/seen/post cycle) and
  a Playwright screenshot confirming the sidebar badge is gone after the
  admin lands on the Messages inbox.


## Feb 24, 2026 — Inline Reply from Inbox
- `CustomerMessages` (Customer messages inbox) now renders a Reply button
  on every inbound message that has an email on file. Clicking it looks
  the customer up via `GET /customers?q=<email>` and opens the existing
  `MessageCustomerDialog` prefilled with `Re: <subject>` and a quoted
  original — same Resend send-path used from the customer profile.
- Also added an "In/Out" direction chip on each message card so the admin
  can tell inbound messages from logged outbound ones at a glance.
- Verified end-to-end via Playwright: reply button visible on inbound msg,
  dialog opens with correct customer, prefilled subject "Re: …" and quoted
  body.


## Feb 24, 2026 — Global list pagination
- New shared `Pagination` component + `usePagePref(key, default)` hook in
  `frontend/src/components/Pagination.jsx`. Persists the chosen page size in
  `localStorage` under `pref.pageSize.<section>` (per-list keys) and renders
  "Showing X–Y of TOTAL", a page-size dropdown (50/100/150/200, default 50),
  Prev / Next, and windowed numeric page buttons with ellipses.
- Backend: added `skip` (with `ge=0`) to `/orders`, `/products` (also new
  `stock=low|out` filter), `/suppliers`, `/transactions` (also new `limit`),
  and `/items` (paginates both the standard sort and the Python-side
  `margin_desc` sort branch).
- Frontend wired up:
  - Orders → All Orders (`pref.pageSize.orders`)
  - Products list — All (`products-all`), Low Stock (`products-low`),
    Out of Stock (`products-out`), Archived (`products-archived`).
    Low/Out sections were refactored to reuse the paginated `Products`
    component with a `stock` prop instead of a client-side filter, so
    every page fetches the correct slice from the server.
  - Suppliers list (`suppliers`)
  - Payments transactions (`payments-transactions`)
  - Product Sourcing / Scraper items (`scraper-items`)
- Verified end-to-end via Playwright: changing to 100/page loaded 100 rows,
  page-2 loaded the next 100, and after a reload the orders selector still
  showed 100 (localStorage key `pref.pageSize.orders` persisted). Backend
  smoke-tested with curl on all endpoints (`orders`, `products`, `suppliers`,
  `transactions`, `items`) — totals stayed constant while `skip` returned
  fresh rows.


## Feb 24, 2026 — Sortable column headers
- New shared `SortableTh` component + `useSortPref(key, defaultField,
  defaultDir)` hook in `frontend/src/components/SortableTh.jsx`. Persists
  the active sort per section in localStorage under `pref.sort.<key>` in
  the form `"field:asc|desc"`. First click on a new column → ascending,
  second click → descending; a small arrow indicator (`ChevronsUpDown`
  when inactive, `ArrowUp`/`ArrowDown` when active) shows the direction.
- Backend: extended `/orders`, `/transactions`, `/suppliers`, and
  `/customers` to accept `<field>_asc` / `<field>_desc` sort keys with
  per-endpoint whitelists (`reference`, `product_title`, `customer_name`,
  `quantity`, `total`, `status`, `created_at` etc.). Legacy compact keys
  (`revenue_desc`, `name_asc`, …) still work for backwards compatibility.
- Frontend wired: **Orders**, **Customers**, **Payments transactions**,
  **Suppliers** tables now render `SortableTh` in every header. The old
  standalone sort `<select>` was removed on Customers and Suppliers.
  **Products** stays a card grid but its existing sort dropdown now uses
  `useSortPref` so the chosen sort persists per section
  (`products-all-sort`, `products-low-sort`, `products-out-sort`,
  `products-archived-sort`).
- Verified end-to-end with Playwright: clicking Total on Orders sorted
  asc ($2.92 first) → clicking again sorted desc ($7,312.47 first). Full
  page reload retained `pref.sort.orders=total:desc` in localStorage and
  the Total column re-rendered with descending arrow, first row still
  $7,312.47 (aria-sort="descending").


## Feb 24, 2026 — Price Alerts clickable + 5-day TTL
- `GET /items` now attaches `linked_product_id` per row via a single
  `products.find({source_item_id: {$in: […]}})` lookup, so the UI can
  deep-link straight to a product's detail page without an extra fetch.
- `PriceAlertsView` filters out any alert whose most recent
  `price_history` entry is older than 5 days and shows a small
  "N alerts auto-cleared after 5 days" chip next to the sold/OOS excluded
  chip so the admin knows nothing was silently swallowed.
- Each alert `<tr>` is now clickable — clicking anywhere except the
  eBay "View" button (which `stopPropagation`s) navigates to the linked
  product's detail page via `openProductDetail(linked_product_id)`. Rows
  without a linked product stay non-clickable with a tooltip explaining
  why.
- Verified via Playwright: 5 fresh alerts rendered, banner read "2 alerts
  auto-cleared after 5 days", clicking the row for eBay item 284291994972
  opened the "Scanpan Classic Steel 8 Piece Eclipse Knife Block Set 18382"
  product detail page with its Save button visible.


## Feb 24, 2026 — Supplier detail page
- Backend: replaced the thin `GET /suppliers/{sid}` with a richer version
  that returns `{supplier, products, product_count}`. Products are matched
  by re-querying `items.item_id` for the seller's name (fixes a
  pre-existing mismatch between item uuids in `_build_sellers.item_ids`
  and `products.source_item_id` which uses the eBay listing id).
- Frontend: new `SupplierDetailPage` component in `Suppliers.jsx`.
  Suppliers list rows are now clickable and route to the detail page via
  a new `supplierDetailId` state in `App.js` (parallels the existing
  product / order / customer detail patterns). Header shows the supplier
  avatar, name, location, active chip, scraped-listing count and
  last-active date. Below that, a "Products in your store" section shows
  the exact count on the right and renders a responsive
  1/2/3/4-col grid of product cards (image, title, product code, price,
  stock chip — Out of stock / Low · N / N in stock). Each card is a
  button that opens the product detail page.
- Wiring in `App.js`: added `supplierDetailId` state, cleared it via
  `changeTab` and by a new `changeSupplierSection` setter + a
  `useEffect(tab !== "suppliers")` safety net. `openProductDetail` from
  the supplier detail sets `tab=products` FIRST and then the product id
  (order matters — `changeTab` would clear the pid otherwise).
- Verified end-to-end via Playwright: clicking the "HomeFashion AU
  (144001)" row opens the detail page showing the "Akitas C5 Parquet
  2000W Bagged Vacuum Cleaner" card with $149.49 / 10 in stock; clicking
  the card lands on the full product detail page with Save button.


## Feb 24, 2026 — Delete supplier
- Backend: `_build_sellers` now tracks both item uuids and eBay item_ids
  per bucket and computes a proper `linked_product_count` (matches
  `products.source_item_id ∈ ebay_ids`). New `DELETE /suppliers/{sid}`
  wipes `items.delete_many({seller: name})` and returns
  `{deleted_items, linked_product_count}`. Store products keep their
  rows so nothing disappears from the storefront without admin consent.
- Frontend: `Suppliers` owns a shared `deleteSupplier` callback used by
  both the row-level `Trash2` button (new column on the All Suppliers
  table with `data-testid="sup-delete-<sid>"`) and the "Delete supplier"
  button at the top of the Supplier detail page (`sup-detail-delete`).
  If `linked_product_count > 0` the callback fires a `window.confirm`
  that spells out how many products are linked and warns that they'll
  stay in the store but lose their supplier tie; if `linked_product_count
  === 0` the deletion happens immediately without a prompt.
- Verified end-to-end via Playwright:
  * "Elite Electronics Store (84516)" (1 linked product) → clicking
    Delete showed the confirm dialog reading "Elite Electronics Store
    (84516) has 1 product linked to it in your store. …";
  * "CoastalPhones (2022)" (0 linked products) → deletion happened
    silently with a "CoastalPhones (2022) deleted — Cleared 1 scraped
    item." toast, and the supplier disappeared from the list on next
    fetch.


## Feb 24, 2026 — Auto-archive on zero stock
- New helper `_auto_archive_if_out_of_stock(pid)` in `helpers.py`. When
  a product's `stock <= 0` and it isn't already archived, it flips
  `archived: True` and `active: False`, stamps `updated_at`, and fires an
  `out_of_stock` notification tagged `auto_archived: True` so the admin
  sees the change in the bell.
- Called from every stock-mutation path:
  * Order placement (`POST /orders`, after the `$inc` decrement)
  * Manual stock adjust (`POST /stock/moves`)
  * Admin edit (`PATCH /products/{pid}`, only when `stock` is in the
    body)
  * Scraper "sold / ended / OOS on eBay" sweep — the linked-product
    `update_many` now also sets `archived: True`
- Since `GET /products` already filters `archived: {$ne: True}` by
  default, auto-archived items drop off the active list immediately and
  show up on the Archived tab where the admin can restore them if the
  stock decision was accidental.
- Regression suite: new `backend/tests/test_auto_archive_on_zero_stock.py`
  with 5 tests (order-to-zero, PATCH-to-zero, stock-move-to-zero,
  partial-decrement stays active, list endpoint excludes auto-archived).
  Runs green.


## Feb 24, 2026 — Structured specifications + cleaned descriptions
- Backend `scraper.py`: new `clean_description(raw)` cuts eBay
  descriptions at the first Payment / Shipping / Postage / Delivery /
  Returns / Warranty / Feedback / About Us / Contact Us / Terms /
  Store Policies / etc header (whole-line, case-insensitive), strips
  one-off promo lines (buy-it-now, free-shipping shout-outs, feedback
  bragging, "powered by inkFrog" footers, thank-you-for-shopping,
  happy-bidding), deduplicates consecutive identical lines, collapses
  blank runs, and truncates to ≤1200 chars at the nearest sentence
  boundary. Called from `fetch_description_iframe` so every scrape
  (initial or refresh) applies the cleanup.
- `Product` model now stores `specifics: dict = {}`. The two paths that
  create a Product from a scraped item (`bulk add_to_products` and
  `POST /items/{iid}/add-to-products`) pass `specifics=it.get(...)`.
- Frontend: new `ProductSpecsCard` in `pages/ProductDetail.jsx` rendered
  below the Description textarea. Groups scraped specifics into
  DIMENSIONS (length, width, height, depth, diameter, size),
  MATERIALS (material, fabric, composition), COLOURS (colour/color,
  finish), WEIGHT (weight, gross/net weight), and everything else under
  OTHER SPECIFICATIONS. Each row is a `label : value` grid line with
  its own `data-testid="product-spec-row"`. Section is hidden entirely
  when the product has no specifics.
- Regression suite: `backend/tests/test_clean_description.py` — 8
  pytest cases (cuts at shipping / payment / about-us, strips promo
  lines, dedupes repeated lines, truncates verbose descriptions, empty
  string safe, preserves bullet points). All green.
- Verified end-to-end via Playwright: seeded a "TEST Ceramic Dining
  Table" product with 11 specifics → Product detail page rendered
  DIMENSIONS (Length 180 cm, Width 90 cm, Height 75 cm), MATERIALS
  (Table Material: Ceramic, Frame Material: Powder-coated steel),
  COLOURS (Colour: Matte Black), WEIGHT (52 kg), and OTHER
  SPECIFICATIONS (Brand IKEA, MPN IKEA-DT-180, Warranty 2 Years,
  Assembly Required Yes).


## Feb 24, 2026 — Clean product image scraping
- New helpers in `scraper.py`:
  * `_looks_like_chrome(url)` — flags anything whose URL contains a
    logo/banner/store-logo/badge/sprite/icon/avatar/promo/header/footer/
    sizechart/size-guide/sizing/measurement/diagram/chart/watermark/
    shipping/return/feedback/about-us token, and any URL served from
    `pics.ebaystatic.com` / `ir.ebaystatic.com`.
  * `_image_signature(url)` — normalises an eBay image URL down to its
    identity (strips `s-l<digits>` size token, file extension, query
    string, scheme) so `/s-l500.jpg` and `/s-l1600.webp` of the same
    image collapse into one row.
  * `_filter_product_images(urls, limit=8)` — drops non-http URLs,
    drops chrome via `_looks_like_chrome`, dedupes by signature, and
    hard-caps at 8. Called at the end of `_extract_images`, replacing
    the naive `urls[:20]` slice.
- Because the upstream regex already upgrades `/s-l<n>.` → `/s-l1600.`,
  the biggest available version of each unique photo is what survives
  the signature dedup (first occurrence wins).
- Regression suite: `backend/tests/test_image_filters.py` — 14 pytest
  cases (chrome detection, signature collapsing, hard cap at 8, dedup
  same-image-different-sizes, skip chrome mixed with valid URLs, drops
  non-http, preserves order). All green. Combined scraper test suite
  (title cleaner + description cleaner + image filters) — 35 passing.


## Feb 24, 2026 — Thumbnails + full-size lightbox
- New helpers in `frontend/src/lib/api.js`:
  * `imgAtSize(url, n)` — rewrites the `/s-l<digits>.` token in any eBay
    CDN URL to `/s-l<n>.`. Non-eBay URLs are returned untouched so we
    don't accidentally break seller-hosted images.
  * `imgThumb(url)` and `imgFull(url)` — 300px and 1600px shortcuts.
- `ProductDetail`'s image strip now renders each thumbnail with
  `proxyImg(imgThumb(src))` so the browser only fetches ~15KB per tile
  instead of pulling the ~300KB `s-l1600` variants.
- New `ProductImageLightbox` (bottom of `ProductDetail.jsx`) opens on
  thumbnail click, renders `proxyImg(imgFull(src))` for the full-size
  view, supports ←/→ nav, keyboard shortcuts (Arrow keys and Escape),
  and a bottom "N / M" counter. The Replace / Delete buttons on each
  thumbnail keep working via `stopPropagation` so hovering doesn't
  fight with the click-to-zoom.
- Database stays lean — only the `s-l1600` URLs are persisted; the
  thumbnail size is derived dynamically at render time.
- Verified via Playwright: 3 eBay thumbnails all requesting `s-l300`,
  clicking one opens the lightbox with a `s-l1600` URL, ArrowRight
  advances (image src changes), Close button and Escape both dismiss.


## Feb 24, 2026 — Stricter eBay CDN image scraping
- `scraper._extract_images` now runs every candidate URL through a
  `_remember` helper that drops anything containing `/s-l64.` (seller-
  logo/icon thumbnails) BEFORE the size-token upgrade, so those URLs
  can never sneak in via a canonicalisation pass.
- `_filter_product_images` gained two new rules:
  * Drop any URL still containing `/s-l64.` (defense in depth).
  * For `i.ebayimg.com` URLs, require `/s-l1600.` in the path. Any other
    format (`/00/s/…/$_1.JPG`, `s-l800`, `s-l64` variants) is rejected.
  * Non-eBay URLs (seller-hosted images on external CDNs) still bypass
    this rule so legitimate product photos aren't lost.
- Regression suite: `test_image_filters.py` grew 3 new cases
  (`test_drops_s_l64_seller_logos`, `test_requires_s_l1600_for_ebay_cdn`,
  `test_non_ebay_urls_bypass_s_l1600_rule`). Combined scraper suite
  (title + description + images) — **38 passing**.


## Feb 24, 2026 — Verbatim eBay Postage
- New `scraper._normalize_postage(display, fee)` returns exactly two
  canonical forms:
  * "Free Postage" — when text contains "Free" or "$0.00", or the
    numeric fee is 0.
  * "$X.XX" — the exact dollar amount otherwise (parsed from the
    display string when the seller only provided text).
  * `(None, None)` when nothing was scraped so the UI never fabricates
    a value.
- Called at the tail of the eBay listing parser so both the JSON-LD
  "shippingDetails" branch and the free-text fallback (e.g. "AU $9.95
  postage") produce the same canonical output.
- `Product` model gained `postage: Optional[str]`. Both add-to-product
  paths (`POST /items/{iid}/add-to-products` bulk + single) now copy
  `item.postage_display` to `product.postage`.
- Frontend Product Detail page shows a new read-only **Postage** field
  next to Margin (with `data-testid="product-postage-display"`). "Free
  Postage" renders in bold emerald, real dollar amounts in slate, and
  missing values as italic "Not specified" so admins can spot a
  listing whose postage failed to scrape.
- Regression suite: `backend/tests/test_postage_normalize.py` — 13
  pytest cases (free-word, $0.00, $0, numeric-0, dollar amount + fee,
  extract-from-text-only, formatting decimals, larger fee, both none,
  empty string, junk text). Combined scraper suite → **51 passing**.


## Feb 24, 2026 — Editable Specifications
- `ProductUpdate` model gained `specifics: Optional[dict]` so the
  existing `PATCH /products/{pid}` route accepts spec changes with
  zero new endpoints.
- `ProductSpecsCard` rewritten to be editable in place:
  * Read-only mode renders the same grouped DIMENSIONS / MATERIALS /
    COLOURS / WEIGHT / OTHER layout as before, with an "Edit" button
    top-right.
  * Empty state prompts "Add specs" so products with no scraped
    specifics still get the UI (previously the section was hidden).
  * Edit mode shows a flat two-column table of `<input>` label /
    `<input>` value pairs plus a red Trash button on every row, an
    "Add spec" button under the list, and Save / Cancel buttons top-
    right. Blank labels or values are dropped on save; duplicate
    labels merge (last write wins).
  * Optimistic UI: save PATCHes the backend, toasts on success, and
    calls `onUpdated(fresh)` so the display mode reflects the exact
    server state (no client-vs-server drift).
- Verified end-to-end via Playwright: seeded a product with
  `{Colour: Blue, Weight: 1 kg}`, entered edit mode, changed
  Colour → Red, deleted the Weight row, added `Length: 30 cm`, saved
  → toast fired, backend `GET /products/{pid}` returned
  `{Colour: Red, Length: 30 cm}` and the card re-grouped rows into
  DIMENSIONS (Length) and COLOURS (Colour) sections.


## Feb 24, 2026 — Clean Postage / Delivery card
- Scraper now extracts two new positive-signal fields:
  * `delivery_speed` — from
    `span.ux-textspans--POSITIVE.ux-textspans--BOLD`, filtered to spans
    whose text mentions delivery/post/ship (avoids grabbing "In stock"
    style positive-bold blurbs). Regex fallback matches
    `Free delivery in N days` when the class names change.
  * `delivery_date_range` — from the first `<span>` whose text starts
    with "Get it between …". Regex fallback matches the same phrase in
    raw HTML.
- Fields carry through: `EbayItem` model → `_scrape_item` return dict
  → both add-to-product paths (`bulk` + single) → new `Product` fields
  → `ProductUpdate` so admins can edit later.
- Frontend Postage field replaced with a `<PostageCard product={p}/>`
  component that renders **only** the two clean lines when they exist:
  * Green bold text with a CheckCircle icon (delivery speed)
  * Smaller grey text with a Calendar icon (ETA)
  * Falls back to `p.postage` ("Free Postage" / "$X.XX") when the
    positive-bold spans weren't scraped.
  * `cleanPostageText` defensively strips legacy junk phrases
    ("Doesn't post to United States", "See details for delivery",
    "Located in:", "International shipment") at render time so old
    records also render clean.
- Verified via Playwright: seeded product with
  `delivery_speed="Free delivery in 2-4 days"` and
  `delivery_date_range="Get it between Wed, 26 Aug and Fri, 28 Aug"`
  → both lines render with the right icons and colors inside the
  emerald-tinted card.



## Feb 24, 2026 — Postage Presets (Store Management + Product Detail)
- **Backend** — new `PostagePreset` model (`name`, `kind` ∈ {free, standard, large_item}, `postage_amount`, `insurance_amount`, `active`, `sort_order`) plus CRUD endpoints:
  * `GET /api/postage-presets`, `POST /api/postage-presets`,
    `PATCH /api/postage-presets/{id}`, `DELETE /api/postage-presets/{id}`.
  * Validation: `free` must be $0, `insurance_amount` only allowed on `large_item`, no negative amounts.
  * PATCH auto-zeros irrelevant amounts when switching kind (free / non-large_item).
  * On preset delete, any product referencing it is auto-cleared
    (`postage_preset_id → None`).
- Seeded three defaults on startup: Free Postage ($0), Standard Postage ($9.95), Large Item ($29.95 postage + $12 insurance).
- `Product` / `ProductUpdate` gained three new fields:
  `postage_preset_id`, `postage_amount`, `postage_insurance_amount`
  (per-product overrides pre-filled from the preset but editable).
- **Frontend**
  * New Store Management section "Postage Presets" (`postage-presets` nav id, `PackageSearch` icon) with a full CRUD editor mirroring the Pricing Rules editor (add / edit / delete / toggle active). Type-aware modal hides irrelevant fields per kind.
  * Product Detail: read-only Postage `Field` replaced with a new
    `PostagePresetField` — dropdown of active presets. On selection:
      - `free` → no editable fields, saves $0
      - `standard` → single "Postage amount" input pre-filled from preset
      - `large_item` → two inputs (Postage + Insurance) pre-filled from preset
    Amounts save alongside `postage_preset_id` on Save changes.
    Scraped delivery-speed / ETA card still shown underneath for reference.
- **Tests**: `/app/backend/tests/test_postage_presets.py` — 11 cases covering seeding, validation, PATCH auto-zero behaviour, product wiring, and delete-cascade to products. All pass.


## Feb 24, 2026 — Dynamic Delivery Estimate (Store default + per-product override)
- **Backend** — new `delivery_settings` singleton (defaults `{min: 3, max: 7}` business days) with `GET/PATCH /api/delivery-settings` and validation: non-negative, `max >= min`, upper bound 365.
- Extended `Product`/`ProductUpdate` with `custom_delivery_window: bool`, `delivery_min_days`, `delivery_max_days`. `PATCH /products/{pid}` validates the pair when either bound is touched.
- **Frontend**
  * New shared helper `frontend/src/lib/delivery.js` — `addBusinessDays` (skips Sat/Sun) + `computeDeliveryEstimate(min, max, today=new Date())` which returns `{fromDate, toDate, label}`.
    Estimate is computed at render time in the browser, so the range rolls forward every day with zero server/cron work — the "auto-updates daily" property.
  * Store Management → new **Delivery Estimate** section (`delivery-estimate` nav id, `Truck` icon) with a two-field editor (min/max business days) plus a live "Estimated delivery between [date] and [date]" preview + inline validation.
  * Product Detail → new **Custom delivery window** toggle. OFF (default) shows the store-wide preview line. ON reveals two min/max inputs pre-filled from the current defaults and swaps the preview to the custom window. Toggle chip reads "Default" / "Custom".
  * Both previews use the friendly AU date format ("Mon, 3 Mar") and clearly label weekends as skipped.
- **Tests**: `/app/backend/tests/test_delivery_settings.py` — 8 cases covering seeding, validation, per-product save/read, and toggle-off. All 19 delivery+postage tests green.


## Feb 24, 2026 — Same-day ship Cutoff
- Extended `delivery_settings` singleton with `cutoff_enabled: bool` (default True) and `cutoff_hhmm: str` (default "14:00"). PATCH validates HH:MM (24-hour) format.
- **Frontend helper** `lib/delivery.js` — new `resolveShipDate(now, cutoff)` that returns `{shipDate, shifted, reason}`:
  * `shifted=true, reason='cutoff'` when the current time is past the store cutoff.
  * `shifted=true, reason='weekend'` when today is Sat/Sun (regardless of cutoff).
  * `shifted=false` when we're within the same-day window.
  `computeDeliveryEstimate` uses the resolved ship date as the base for both bounds, so an order after 2 PM automatically counts from tomorrow.
- **UI**
  * Store Management → Delivery Estimate: added toggle + 24-hour time input for the cutoff. The live preview now surfaces an amber "After 2:00 PM cutoff · shipping next business day" chip whenever the shift is active.
  * Product Detail: the delivery-window field's preview shows the same chip so admins see instantly why the estimate has moved a day.
- Backend tests: added 5 cutoff cases (defaults, patch persist, disable, malformed HH:MM rejection, edge times). 24 delivery + postage tests green.


## Feb 24, 2026 — Auto-delete Empty Categories
- New helper `helpers._delete_categories_if_empty(slugs)` — for each unique
  slug in the input, deletes the matching `categories` row iff no products
  still carry that `category` value. Returns the list of slugs removed so
  callers can log / echo.
- Wired into both product-delete paths:
  * `DELETE /api/products/{pid}` — captures `existing.category` before the
    delete, then calls the helper. Response now includes
    `removed_categories: [slug]`.
  * `POST /api/products/bulk-delete` — collects the affected slugs
    up-front so a bulk delete that empties multiple categories cleans
    them all in one hop. Response includes `deleted` + `removed_categories`.
- Behaviour intentionally applies to seeded categories too — empty rows
  clutter the sidebar and `_ensure_ebay_category` will re-create the record
  the next time a scrape hits that slug.
- Tests: `/app/backend/tests/test_category_auto_delete.py` — 5 cases
  covering single-delete, partial-delete (category kept), bulk-delete
  emptying, bulk-delete partial, and bulk-delete emptying multiple
  categories in one call.


## Feb 25, 2026 — Admin Accounts (Settings › Accounts) + RBAC nav filter
- **Backend** — new `admin_accounts` collection with bcrypt-hashed passwords.
  * `AdminAccount` model: id, name, email, password_hash, role, is_main, timestamps.
  * Roles: `admin` (full access) and `manager` (Orders / Customers / Products only).
  * CRUD endpoints: `GET/POST/PATCH/DELETE /api/admin-accounts`. Password hash is stripped from every response.
  * Validation: email format, role ∈ {admin, manager}, min 8-char password, no duplicate emails.
  * Main admin: seeded on first startup (`admin@example.com` / `admin123`), flagged `is_main=True`. Cannot be deleted or demoted from admin role. Name is still editable.
- **Frontend**
  * New `AccountsCard` in Admin Settings — full list with Name / Email / Role chip / Session / Actions columns and a "+ Add account" modal (name, email, password, role dropdown).
  * Main admin row shows a green `Main` badge and a `Protected` chip instead of a Delete button.
  * "Sign in as this account" action on non-active rows swaps the localStorage-based admin session (`admin_current_id` + `admin_current_role`). A `Signed in` chip highlights the active row.
  * Nav filter: `lib/adminSession.js` centralises `canAccess(role, tabId)`. Sidebar and App.js both listen for the `adminsessionchange` event and either hide or redirect from disallowed tabs — when the session flips to Manager, the sidebar shrinks to just Products / Orders / Customers and the bottom Admin Settings CTA disappears. App.js auto-redirects to Orders.
- **Tests**: `/app/backend/tests/test_admin_accounts.py` — 13 cases covering seeding, hash-non-leak, CRUD, validation, duplicate-email, and main-admin protection.
- **Docs**: `test_credentials.md` now lists the main admin creds so QA can log in against future auth.


## Feb 25, 2026 — SEO Card + Product Tags (Product Detail)
- **Missing SEO card fixed** — `ProductDetail.jsx` referenced a `<SeoCard/>`
  that was never defined. The card is now implemented with the full field
  set from the earlier spec: **Meta Title**, **Meta Description** (with a
  live 160-char counter that turns amber past 140 and red past 160), **URL
  Slug** (lowercase-only auto-normaliser), and **Image Alt Text**.
- **Tags field** — new chip-based editor sits inside the SEO card.
  * Type → press Enter or comma to add · Backspace on the empty input
    removes the last chip · click × on any chip to delete.
  * Comma-separated bulk paste is split and de-duplicated.
  * Persisted on Save alongside the other SEO fields.
- **Auto-suggestion** — `helpers._suggest_tags(title, category)` seeds tags
  from the category slug (split on hyphens) + title tokens. Stop-words
  (`the`, `a`, `and`, `for`, …) and single-character tokens are dropped,
  duplicates removed, cap = 8. Called from `_default_seo` so both product
  create paths (`POST /products` and `add-to-products` from a scraped item)
  auto-populate tags.
- **Backend model** — `Product.tags: List[str] = []`, `ProductUpdate.tags:
  Optional[List[str]] = None`. PATCH handler normalises incoming tags
  (lowercase, strip, dedup) before persisting so the storage shape stays
  predictable regardless of client input.
- **Tests**: `/app/backend/tests/test_seo_tags.py` — 11 pytest cases
  (all pass) covering `_suggest_tags` behaviour, `_default_seo` inclusion,
  API round-trip auto-seed on create, PATCH normalisation, empty-list
  clearing, and confirming other SEO fields aren't touched by tag PATCHes.




## Feb 25, 2026 — Robots policy (no-index everywhere)
- **`/app/frontend/public/robots.txt`** created with `Disallow: /` for
  the `*` wildcard plus explicit rules for every mainstream crawler
  (Googlebot, Bingbot, DuckDuckBot, Slurp, Baiduspider, YandexBot,
  Applebot, facebookexternalhit, Twitterbot, LinkedInBot) and the LLM
  scrapers (GPTBot, ClaudeBot, PerplexityBot, CCBot, Google-Extended).
- **`/app/frontend/public/index.html`** — added
  `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet,
  noimageindex, notranslate">` plus per-crawler meta tags for Googlebot,
  Bingbot, DuckDuckBot, etc, and `<meta name="referrer"
  content="no-referrer">`. Because the app is a single-page React shell,
  every admin route now inherits these headers.
- Verified live: origin `/robots.txt` serves the full disallow ruleset
  and the SPA shell HTML contains all 10 meta robots directives.


## Feb 25, 2026 — IP-based Country Access Control + Emergency Bypass
- **Middleware** (`server.py`, `country_access_middleware`) reads
  Cloudflare's `CF-IPCountry` header on every `/api/*` request. Requests
  from countries NOT in the allow-list get a plain
  `403 {"code":"country_blocked","detail":"Access Denied"}` response.
  Fails-open when the header is missing (local dev / direct-origin hits)
  so admins can't lock themselves out during a Cloudflare misconfig.
- **Exempt paths** (never blocked): `/api/security/bypass/{token}`,
  `/api/security/status`, `/api/image-proxy`, `/docs`, `/openapi.json`,
  `/redoc`, and every OPTIONS preflight.
- **Singleton doc** `country_access_settings` (`_ensure_country_access_seeded`)
  seeded with `["AU", "MA"]` + a fresh `secrets.token_urlsafe(32)` bypass
  token.
- **Bypass URL** — visiting `GET /api/security/bypass/{token}` from any
  IP grants that IP 24 hours of unrestricted access (stored in a new
  `bypass_sessions` collection keyed by IP). Redirects the browser back
  to the dashboard root with `X-Bypass-Granted: 1`. Token rotation via
  `POST /api/security/country-access/regenerate-token`.
- **Endpoints**:
  - `GET  /api/security/status` — public: `{allowed, country, ip, bypass_active, bypass_expires_at, cloudflare_detected}`
  - `GET  /api/security/countries` — full ISO 3166-1 alpha-2 list
  - `GET  /api/security/country-access` — settings + bypass URL + active sessions
  - `PATCH /api/security/country-access` — replace allow-list
  - `POST /api/security/country-access/regenerate-token` — rotate bypass token
  - `DELETE /api/security/bypass-sessions/{ip}` — revoke a session
- **`_public_base_url()`** — builds the copy-paste-able bypass URL from
  `X-Forwarded-Proto` / `X-Forwarded-Host` so admins get the public HTTPS
  host instead of the internal cluster address.
- **Frontend — Access Denied page**
  (`/app/frontend/src/pages/AccessDenied.jsx`): plain "403 · Access
  Denied" with zero dashboard chrome. Wired via a global axios response
  interceptor in `App.js` — any 403 with `code:"country_blocked"` swaps
  the entire shell for `<AccessDenied/>`.
- **Frontend — Security tab** (`SettingsPage` → new tab beside Accounts):
  - **Status strip**: your detected country + IP + Cloudflare presence
  - **Emergency bypass card**: masked URL with reveal/copy/regenerate
    buttons + table of active bypass sessions with per-row Revoke.
  - **Countries card**: searchable list of every ISO country with an
    Allow / Block toggle per row. Filter chip "Only allowed".
    Toggling PATCHes instantly (optimistic UI) and toasts on save.
- **Tests**: `/app/backend/tests/test_country_access.py` — 14 pytest
  cases (all pass): fail-open, plain-403 shape, allowed passes, OPTIONS
  never blocked, exempt paths, PATCH normalisation, empty allow-list,
  token rotation invalidates old URL, bypass grants correct IP, other IPs
  still blocked, revoke, status reflects bypass, ISO list contains ≥ 240
  entries. Runs serialised via `pytestmark = xdist_group("country_access")`
  because tests mutate the shared singleton.



## Feb 25, 2026 — Revenue YTD deep-dive modal
- **Backend**: new `GET /api/analytics/revenue-detail` returns everything
  the Revenue YTD expand modal needs in one round-trip:
  - `year`, `total_revenue`, `total_orders`, `avg_order_value`
  - `monthly[]` — revenue + orders per month for the current year,
    Jan → current month, zero-filled so the bar chart never has gaps
  - `top_products[]` — top 5 YTD sellers with `product_id`, `title`,
    `image` (first product image, may be null), `revenue`, `units`,
    resolved via a `$lookup` on the products collection
  - `orders_by_status[]` — every `ORDER_STATUSES` bucket represented
    (including 0-count) with `{status, count, revenue}`
  - `best_month` — the highest-revenue month so far (or null when no
    sales)
  - `last_year_comparison` — same-period-last-year `{revenue, orders,
    delta_pct}` or null when no prior-year orders exist
  - Cancelled orders excluded from every non-status total.
- **Frontend — KpiCard** (`components/atoms.jsx`) now accepts an optional
  `onExpand` callback. When set, the previously-decorative
  `ArrowUpRight` in the top-right corner becomes a real button with
  hover + `data-testid={testId}-expand`.
- **Dashboard** wires `onExpand` on the Revenue YTD card to open
  `<RevenueDetailModal/>` (defined in `pages/Dashboard.jsx`):
  - Full-screen backdrop with `Escape` + click-outside + explicit Close
  - `RevenueHighlightsRow` — Best month YTD (green trophy card), Avg
    order value, vs same-period-last-year (indigo up-arrow / amber
    down-arrow chip + prior-year revenue/orders footnote, or "No
    prior-year data" when null)
  - `RevenueMonthlyChart` — Recharts bar chart with rounded top
    corners and $k tick formatter
  - `RevenueTopProducts` — top-5 list with numbered rank badge, 44×44
    product thumbnail served through `proxyImg(imgThumb(image))`,
    title, units, revenue
  - `RevenueStatusBreakdown` — non-zero statuses only, each with a
    gradient progress bar showing the share of total non-cancelled
    orders and a count + % tabular readout. Uses shared `StatusChip`
    so styling stays in sync with the Orders table.
  - Fully responsive: single-column stack on mobile, 2-column top
    products + status split on `lg:` and up.
- **Tests**: `/app/backend/tests/test_revenue_detail.py` — 7 pytest
  cases (all pass) covering shape, monthly zero-fill/current-month
  cap, every ORDER_STATUS present, top-5 cap + fields,
  `avg_order_value` math, best_month = max(monthly), cancelled
  exclusion.



## Feb 25, 2026 — Profit YTD deep-dive modal
- **Backend**: new `GET /api/analytics/profit-detail` returns everything
  the Profit expand modal needs in one round-trip:
  - `totals` — `{revenue, cost, profit, margin_pct}` for the side-by-side
    summary panel
  - `monthly[]` — revenue + cost + profit + margin_pct + orders per
    month (Jan → current month, zero-filled) — drives both the bar chart
    and the margin-trend line chart
  - `top_products[]` — up to 5 YTD by margin_pct with image/title/units/
    revenue/profit; requires units > 0 AND revenue > 0 so a bogus "100%
    margin on $0 sold" row can't sneak in
  - `category_margins[]` — avg margin per category (only categories with
    revenue > 0), sorted by profit desc
  - `best_month` / `worst_month` — pulled from months with orders > 0 so
    zero-sale months don't inflate the "worst" bucket
  - Cancelled orders excluded from every non-status aggregation.
- **Frontend — ProfitDetailModal** (`pages/Dashboard.jsx`):
  - Wired to the Profit YTD KpiCard via `onExpand` (same UX pattern as
    the Revenue modal). `data-testid="kpi-profit-ytd-expand"` for the
    trigger and `profit-detail-modal` for the dialog.
  - **ProfitTotalsPanel** — three side-by-side cards (Revenue / Cost /
    Profit + margin %) with slate / amber / emerald tones so the eye
    sorts them without reading.
  - **ProfitMonthHighlights** — Best margin month (emerald trophy) +
    Worst margin month (amber trending-down) chip cards.
  - **ProfitMonthlyBars** — Recharts BarChart with emerald bars ($k tick
    formatter).
  - **ProfitMarginTrend** — Recharts LineChart of margin_pct with
    indigo stroke + dots + custom tooltip.
  - **ProfitTopProducts** — top-5 list with numbered rank chip, 44px
    product image via `proxyImg(imgThumb(image))`, units + profit
    subtitle, right-aligned margin % badge in emerald.
  - **ProfitCategoryMargins** — horizontal-bar visualisation of margin
    per category (max-normalised width, capped at 288px scroll
    container) with a Layers icon header.
  - Fully responsive: single-column stack on mobile, 2-column top
    products + category split from `lg:` and up. `Escape` +
    click-outside + explicit Close button + Close footer button.
- **Tests**: `/app/backend/tests/test_profit_detail.py` — 7 pytest cases
  (all pass) covering shape, totals.margin_pct math, monthly zero-fill
  + per-month margin math, best/worst month selection from months with
  sales, top-5 cap + revenue>0 requirement + margin desc sort,
  category_margins revenue>0 filter + margin math, and
  monthly-sum-equals-totals verification (cancelled excluded).



## Feb 25, 2026 — Fix: KPI expand arrows not clickable
- **Bug**: The KPI card's decorative gradient blur circle
  (`<div className="absolute -right-6 -top-6 w-24 h-24 rounded-full opacity-20 blur-2xl bg-gradient-to-br">`)
  was sitting on top of the top-right corner of every card and, because
  it lacked `pointer-events-none`, was intercepting clicks meant for the
  new expand `<button>`. Result: users saw the arrow, hovered it, but
  couldn't actually click through — both the Revenue and Profit modals
  never opened.
- **Fix**: Added `pointer-events-none` to the decoration in
  `components/atoms.jsx` (one-word CSS change). Because the blur is a
  strictly decorative visual, blocking pointer events on it has no other
  side effects.
- **Verified**: Playwright smoke-test on the live preview URL — login →
  click Revenue expand → modal renders → close → click Profit expand →
  modal renders. Both `[data-testid=revenue-detail-modal]` and
  `[data-testid=profit-detail-modal]` visible with full data (bar chart,
  top products, status/category breakdowns, best/worst month cards).



## Feb 25, 2026 — Units Sold deep-dive modal
- **Backend**: new `GET /api/analytics/units-detail` returns:
  - `total_units`, `total_orders`, `avg_per_order`
  - `avg_per_day`, `avg_per_month` (days elapsed + months elapsed
    computed from `now` so Jan 1 doesn't divide by zero)
  - `monthly[]` — units + orders per month (Jan → current, zero-filled)
  - `top_products[]` — up to 5 YTD by units with image / title / units /
    revenue (units > 0 required)
  - `by_category[]` — units + orders + revenue per category (units > 0
    filter, sorted desc)
  - `best_month` — highest-units month so far, or null
  - `last_year_comparison` — same-period-last-year `{units, orders,
    delta_pct}` or null when no prior-year sales
  - Cancelled orders excluded from every aggregation.
- **Frontend — UnitsDetailModal** (`pages/Dashboard.jsx`):
  - Wired to the Units Sold KpiCard via `onExpand`.
    `data-testid="kpi-units-ytd-expand"` on the trigger,
    `units-detail-modal` on the dialog.
  - **UnitsHighlightsRow** — 4-card grid (Best month · trophy violet /
    Avg per day / Avg per month / vs last year up/down chip).
  - **UnitsMonthlyBars** — Recharts BarChart with violet bars,
    en-AU-formatted units in the tooltip.
  - **UnitsTopProducts** — top-5 list with numbered rank chip, 44px
    thumbnail, title + revenue subtitle, right-aligned units badge.
  - **UnitsByCategory** — horizontal-bar visualisation (max-normalised
    width) with violet-to-pink gradient bars, scrollable max-h-72.
  - Responsive: 2-col highlights on mobile → 4-col on lg; single-column
    stack for the split cards → 2-col lg. Escape / click-outside /
    Close button / Close footer.
- **Tests**: `/app/backend/tests/test_units_detail.py` — 8 pytest cases
  (all pass) covering shape, monthly zero-fill, `avg_per_order` math,
  positive avg_per_day/month when sales exist, best_month = max(monthly),
  top-5 cap + units > 0 + sort, by_category filters + sort, monthly.units
  sum equals total_units (cancelled excluded).



## Feb 25, 2026 — Countdown Sale (limited-time product timer)
- **Model** (`models.py` `ProductCreate`): six new fields —
  `countdown_enabled: bool`, `countdown_sale_price`,
  `countdown_duration_days`, `countdown_started_at`,
  `countdown_ends_at`, `countdown_expired: bool`. Backwards-compatible
  because everything defaults to False/None.
- **`CountdownStart`** — POST body model with `duration_days: int` in
  `[1, 365]` and `sale_price: float > 0`, validated by pydantic.
- **Endpoints**
  - `POST /api/products/{pid}/countdown/start` — sets every field,
    computes `ends_at = now + days`, and flips `active=True` (so a
    previously-expired product can be re-run immediately).
  - `POST /api/products/{pid}/countdown/stop` — admin cancel: clears
    every field, keeps `active=True`.
  - `POST /api/products/{pid}/countdown/restore` — moves an expired
    product back to the main list: clears every field + sets
    `active=True`.
  - `GET /api/products?countdown_status=(active|expired|any)` — new
    filter param. Default hides expired products from the main list.
- **Auto-expire sweep** — `_countdown_sweep_loop()` runs every 60 s
  alongside the scraper scheduler. Any product whose `countdown_ends_at
  <= now` gets `countdown_expired=True` + `active=False` set
  atomically via `update_many`.
- **Frontend — `CountdownSaleCard`** (in `ProductDetail.jsx`) — three
  render states:
  - **Off** — Duration + Sale price inputs with live discount %
    preview and a "Start countdown" button. Sale price defaults to
    20 % below current price for a nudge.
  - **Running** — Big D · H · M · S live ticker (updates every 1 s
    via `setInterval`) inside a rose-gradient card. Shows original
    price (strikethrough) + sale price + discount % chip + "Cancel
    countdown" button.
  - **Expired** — Red banner with the end date and a "Restore
    product" button.
- **Frontend — `<CountdownChip/>`** in `ProductGrid.jsx` — small
  rose chip embedded in each product card while its countdown is
  running. Shows compact `Dd HHh MMm` (or `HH:MM:SS` when < 1 day
  remains). Product card now shows sale price + strikethrough original
  when running. Expired products get a small "Countdown expired" chip.
- **Frontend — Sidebar** — added `Product Countdown` entry to
  `PRODUCT_NAV` (Catalog group, Timer icon).
  `pages/CountdownProducts.jsx` fetches
  `GET /api/products?countdown_status=expired` and reuses
  `<ProductGrid/>`. Per-row `Restore` + `Delete` buttons plumb into
  the countdown/restore + delete endpoints.
- **Tests** — `/app/backend/tests/test_countdown_sale.py` — 10 pytest
  cases (all pass): default fields, start sets all fields + end_date
  math, input validation (422 on invalid days / price), stop clears +
  keeps active, start on expired reactivates, restore clears + reactivates,
  auto-expire sweep flags past-due products, `countdown_status=active`
  filter, `countdown_status=expired` filter excludes running products,
  default list hides expired products. Playwright smoke test on the
  deployed preview confirmed the full flow — off → start → live timer
  → cancel — plus the sidebar entry appears.

