# PCStore ↔ PCAdmin API Integration Guide

**Audience:** the developer of the **PCStore** public storefront.  
**Goal:** point PCStore at this PCAdmin backend and consume its REST API so
both apps share the same product catalogue, orders, and customer accounts.

---

## 1. Base URL

Put this in PCStore's `.env` (do **not** hard-code it):

```env
REACT_APP_BACKEND_URL=https://ebay-au-harvester.preview.emergentagent.com
```

Every API call is prefixed with `/api`, so a full URL looks like:

```
https://ebay-au-harvester.preview.emergentagent.com/api/store/products
```

If you later deploy PCAdmin to a different host, change `REACT_APP_BACKEND_URL`
in PCStore's `.env` — no code changes needed.

CORS is already open (`allow_origins=*`), so PCStore can call this API from
any domain in development or production without extra config.

---

## 2. Sanity-check connectivity

```bash
curl "$REACT_APP_BACKEND_URL/api/store/health"
# → { "ok": true, "service": "PCAdmin storefront API", "version": 1 }
```

If you see this JSON, PCStore is wired up correctly. If you get a 403 with
`{"code": "country_blocked"}`, you're calling an admin route by mistake —
switch to `/api/store/*` or `/api/portal/*` (both are country-exempt).

---

## 3. Public storefront endpoints (no auth)

These are the endpoints PCStore should call to render the catalogue,
product pages, and category navigation. All are **read-only, unauthenticated,
worldwide-accessible**, and only return products that are active,
non-archived, and not countdown-expired.

### `GET /api/store/products`

List products for a catalogue grid.

**Query parameters:**

| param           | type       | default       | description                                                  |
| --------------- | ---------- | ------------- | ------------------------------------------------------------ |
| `q`             | string     | —             | full-text search across title / description / tags           |
| `category`      | string     | —             | filter to one category slug (e.g. `mobile-phones`)           |
| `tag`           | string     | —             | filter to one tag (exact match)                              |
| `on_sale`       | bool       | —             | only products with an active countdown sale                  |
| `in_stock_only` | bool       | `true`        | drop out-of-stock products; pass `false` to include them     |
| `sort`          | string     | `created_at_desc` | `created_at_desc`, `created_at_asc`, `price_asc`, `price_desc`, `sold_desc`, `title_asc` |
| `limit`         | int (1–100) | `50`         | page size                                                    |
| `offset`        | int        | `0`           | pagination offset                                            |

**Response:**

```json
{
  "products": [
    {
      "id": "9c937958-...",
      "product_code": "LC21-PC0826",
      "title": "Lavazza Desea Capsule Coffee Machine",
      "description": "…",
      "category": "espresso-cappuccino-machines",
      "price": 320.0,
      "original_price": 399.0,   // when set and higher than the effective price — render struck-through; `null` otherwise
      "discount_percent": 20,    // rounded % off vs `original_price` (e.g. render as `-20%` badge); `null` when no strikethrough
      // Note: admins can set a minimum-percent threshold under Settings → Storefront.
      // Discounts below the threshold return `original_price: null` + `discount_percent: null`
      // so tiny 1–2% savings never clutter the storefront.
      "sale_price": null,
      "on_sale": false,
      "sale_ends_at": null,
      "images": ["https://…/a.jpg", "https://…/b.jpg"],
      "primary_image": "https://…/a.jpg",
      "stock": 10,
      "in_stock": true,
      "stock_status": "live",
      "tags": ["kitchen", "coffee"],
      "specifics": { "Brand": "Lavazza", "Type": "Capsule" },
      "postage": "Free Postage",
      "postage_amount": null,
      "delivery_speed": "Free delivery in 2–4 days",
      "delivery_date_range": "Get it between …",
      "meta_title": "…",
      "meta_description": "…",
      "url_slug": "lavazza-desea-capsule",
      "image_alt_text": "…",
      "review_count": 4,
      "average_rating": 4.75,
      "created_at": "2026-08-27T…Z"
    }
  ],
  "total": 57,
  "limit": 50,
  "offset": 0
}
```

### `GET /api/store/products/{id}`

Single-product view. `{id}` accepts three forms so PCStore can build
SEO-friendly URLs:

- The product `id` (UUID, e.g. `9c937958-1075-4fb5-a112-bb67cb711592`)
- The `product_code` (e.g. `LC21-PC0826`)
- The `url_slug` (e.g. `lavazza-desea-capsule`)

Same shape as one row in the list response.

### `GET /api/store/products/{id}/related?limit=6`

"You might also like" — returns up to 20 (default 6) products from the
same category as `{id}`, newest first, excluding the current product.

### `GET /api/store/categories`

Returns every category that has at least one visible product — safe to
render as a nav menu without empty sections.

```json
{
  "categories": [
    { "id": "…", "name": "Headphones", "slug": "headphones", "group": "Electronics", "icon": "headphones", "color": "#0EA5E9", "description": "…", "active": true, "sort_order": 3, "product_count": 6 }
  ],
  "total": 42
}
```

### `GET /api/store/health`

Cheap liveness check for CI / uptime probes. Doesn't touch the DB.

### `GET /api/store/config`

Storefront branding, editable from **PCAdmin → Store Management → Store Settings →
Store name**. Fetch this once on app load and hydrate your header/`<title>`/favicon
from it so brand changes in PCAdmin reflect on PCStore with **no code change**.

```json
{
  "store_name": "PrettyCheap",
  "tagline": "Pretty Prices · Cheap Deals · Every Day",
  "logo": "data:image/png;base64,…",        // or null → render text logo
  "favicon": "data:image/x-icon;base64,…",  // or null
  "tab_title": "PrettyCheap",                // use for document.title
  "discount_badge_min_percent": 0
}
```

Suggested PCStore usage:
```js
const cfg = await fetch(`${API}/api/store/config`).then(r => r.json());
document.title = cfg.tab_title || cfg.store_name;
if (cfg.favicon) document.querySelector("link[rel=icon]")?.setAttribute("href", cfg.favicon);
// render cfg.store_name as the bold header, cfg.tagline as the subtitle,
// cfg.logo (when present) as the header logo image.
```


### `GET /api/products/{id}/reviews`

Public reviews for a product (already exists in the admin API but is
safe to expose). Returns `{reviews, total, average_rating, rating_distribution}`.

---

## 4. Customer accounts + orders — `/api/portal/*`

For sign-up, sign-in, and personal order history, PCStore uses the
**customer portal API** (JWT bearer).

### Registration gate

Only emails that appear on an existing order can register — this is the
"verified purchaser" gate. So the sign-up flow is:

1. Guest **places an order** (see §5) with their real email.
2. Same email can now `POST /api/portal/register` and set a password.

Also: emails from **disposable / temporary providers** (`yopmail.com`,
`mailinator.com`, `mail.tm`, and 30+ others — full list is admin-editable
via `PATCH /api/security/disposable-domains`) return
`400 {"detail": "Please use a valid email address. Temporary or disposable emails are not accepted."}`.

### Endpoints

| method | path                        | body / auth                          | returns                                         |
| ------ | --------------------------- | ------------------------------------ | ----------------------------------------------- |
| `POST` | `/api/portal/register`      | `{ email, password, name?, first_name?, last_name? }` | `{ token, customer }`              |
| `POST` | `/api/portal/login`         | `{ email, password, session_id? }`   | `{ token, customer, cart }`                     |
| `GET`  | `/api/portal/me`            | Bearer token                          | `{ customer }`                                  |
| `PATCH`| `/api/portal/me`            | Bearer token, `{ first_name?, last_name?, name?, phone? }` | `{ customer }`             |
| `GET`  | `/api/portal/orders`        | Bearer token                          | `{ orders: [...], total }` (each row tagged with `can_review` + `already_reviewed`) |

### Per-item fulfilment tracking

Each `order.items[]` entry contains a `fulfillment_status` that PCStore should
render beside that product for split-shipment tracking. Valid values are:

| Status | Shopper-facing meaning |
| --- | --- |
| `pending` | Awaiting fulfilment |
| `processing` | Being prepared |
| `shipped` | On its way |
| `delivered` | Delivered |

PCAdmin updates items independently. The aggregate order status becomes
`processing` once every item is at least processing, `shipped` once every item
is shipped or delivered, and `delivered` once every item is delivered.
| `POST` | `/api/portal/reviews`       | Bearer token, `{ product_id, rating, title, body }` | verified review                    |
| `GET`  | `/api/portal/my-reviews`    | Bearer token                          | reviews written by this customer                 |
| `POST` | `/api/reviews/{rid}/vote`   | Bearer token, `{ vote: "helpful"\|"not_helpful"\|"clear" }` | vote counts |

Password minimum length is 6 characters.

### Merge a guest cart on sign-in

When a shopper signs in, include the same anonymous `session_id` used for
their guest cart in the login body. The API moves that guest cart into the
customer's account cart, combines lines with the same product, variant, and
saved variant price, then removes the guest cart so another login cannot add
the same items twice. The merged account cart is returned as `cart`.

```js
const sessionId = localStorage.getItem("guest_cart_session_id"); // stable UUID created for guest carts
const { token, customer, cart } = await apiPost("/portal/login", {
  email,
  password,
  ...(sessionId ? { session_id: sessionId } : {}),
});
localStorage.removeItem("guest_cart_session_id");
// Replace local cart state with cart.items / cart.subtotal.
```

Use an unguessable UUID for each guest `session_id`; do not send it if the
shopper did not have a guest cart.

**Customer name fields:** the profile stores `first_name` and `last_name`
separately (plus a derived `name`). PCStore should split the shopper's full
name and send `first_name` / `last_name` to `PATCH /api/portal/me`; the
backend keeps `name` in sync automatically. `GET /api/portal/me` returns all
three.

---

## 5. Cart & placing orders

### Cart (variant-aware)

The cart is keyed by the logged-in customer when a Bearer token is sent,
otherwise by a guest `session_id` you generate. `PATCH /api/cart` **replaces
the whole cart** with the `items` you send; each line carries the chosen
variant so the cart charges the variant price, not the base price.

```
PATCH /api/cart            (Bearer token optional)
{
  "session_id": "guest-abc",           // required for guests; omit when logged in
  "items": [
    { "product_id": "9c937958-…", "quantity": 2,
      "variant_type": "Colour", "variant_option": "Black", "variant_price": 49.5 }
  ]
}
→ { key, session_id, customer_email, items: [ { …, unit_price, line_total } ], subtotal }

GET /api/cart?session_id=guest-abc      (or send the Bearer token, no session_id)
```

`variant_price` overrides the base product price for that line. Omit the
variant fields for products without variants.

### Placing orders

`POST /api/orders` — single product **or** a whole cart in one call. Variant
fields are recorded on every order line item so the correct amount is charged
and shown in order history.

```json
// single product with a chosen variant
{ "customer_name": "Ada", "customer_email": "ada@example.com",
  "product_id": "9c937958-…", "quantity": 1,
  "variant_type": "Colour", "variant_option": "Black", "variant_price": 49.5,
  "status": "paid" }

// OR a multi-line cart checkout
{ "customer_name": "Ada", "customer_email": "ada@example.com", "status": "paid",
  "items": [
    { "product_id": "9c937958-…", "quantity": 1, "variant_type": "Size",
      "variant_option": "L", "variant_price": 59.0 },
    { "product_id": "aa11bb22-…", "quantity": 3 }
  ] }
```

The server computes `total` from the (variant) line prices — don't rely on a
client-sent total. Each `order.items[]` entry includes `variant_type`,
`variant_option`, `variant_price`, `unit_price` and `line_total`. Server
assigns `id`, `reference` (like `AB12-CD34`), and `created_at`. Orders are
discoverable via `GET /api/portal/orders` for the same customer email.

---

## 6. Customer Support "Get Help" link

The storefront customer-account dropdown shows a "Get Help" link. Admins
configure it under **Store Management → Site Menus → Customer Support**.

```
GET /api/site-menus
→ { get_help: { enabled, label, link_type:"url"|"page", url, page },
    faq_items: [ { id, question, answer }, … ],
    contact_form: { enabled, title },
    footer: { enabled, links: [ { id, label, link_type:"url"|"page", url, page }, … ], custom_text },
    pages: [ { slug, label }, … ] }
```

- If `get_help.enabled` is `false`, hide the link.
- Render `get_help.label` (defaults to "Get Help").
- If `link_type === "url"`, point the link at `get_help.url` (external).
- If `link_type === "page"`, point it at the store page whose slug is
  `get_help.page` (match against the `pages` list — e.g. `/faq`, `/contact`).
- Render the FAQ page directly from `faq_items`, preserving the returned order.
- Render the contact form only when `contact_form.enabled` is true, using
  `contact_form.title` as its heading.
- Render the entire footer only when `footer.enabled` is true. For each footer
  link, resolve `link_type:"page"` through its `page` slug or use `url` for
  `link_type:"url"`. Render `footer.custom_text` as plain text (for copyright,
  a tagline, ABN, or similar store details).

To submit the configured contact form, send only the shopper's own details:

```
POST /api/support/contact
{ "name": "Ada", "email": "ada@example.com", "message": "I need help with my order." }
→ { "sent": true, "message": "Your support request has been sent." }
```

The API delivers support requests to the store email recipient set in
**Store Management → Email & Notifications**. If the form is disabled it returns
`403`; if the Resend key or support recipient is missing it returns `503` with a
configuration-specific message. Do not send a recipient address, subject, or HTML
from PCStore — those are deliberately server-controlled.

---

## 7. Images

Product images come straight from eBay's CDN
(`https://i.ebayimg.com/…`) and are safe to embed directly in `<img>`
tags — no proxying needed for storefront use.

If eBay ever blocks hotlinking, you can route through the built-in
`/api/image-proxy?url=<encoded>` endpoint (already CORS-exempt).

---

## 8. Sample React fetch hook

Drop this into PCStore for a copy-paste starting point:

```js
// src/lib/api.js
const API = process.env.REACT_APP_BACKEND_URL + "/api";

export async function apiGet(path, params = {}) {
  const url = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  const r = await fetch(url, { credentials: "omit" });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export async function apiPost(path, body, token) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// Example usage in a component:
// const { products, total } = await apiGet("/store/products", { limit: 24 });
// const product = await apiGet(`/store/products/${slug}`);
// const { token } = await apiPost("/portal/login", { email, password });
```

---

## 9. Things NOT to call from PCStore

These are admin-only routes protected by the Country Access middleware
and (in most cases) the RBAC session. Calling them from a public
storefront will either 403 or leak internal data:

- Everything under `/api/security/*` (except `/api/security/status`)
- `/api/scraper/*` — scraper controls
- `/api/analytics/*` — dashboard KPIs
- `/api/orders` (list) — admin order dashboard
- `/api/customers`, `/api/customers/*` — admin CRM
- `/api/suppliers/*`, `/api/coupons/*`, `/api/push/*`, `/api/notifications/*`
- Any `PATCH` / `DELETE` on `/api/products/*` — admin catalog edits

If PCStore needs something new that isn't in `/api/store/*`, ping the
PCAdmin owner to add it — don't reach for admin routes.

---

## 10. Environment variables cheat-sheet

| Var                     | Set in                | Purpose                                              |
| ----------------------- | --------------------- | ---------------------------------------------------- |
| `REACT_APP_BACKEND_URL` | PCStore `.env`        | Base URL of the PCAdmin backend                      |
| (nothing else)          | —                     | PCStore doesn't need the DB URL, Mongo creds, or JWT secret. Never share those with a frontend. |

---

Last updated: 2026-06.
