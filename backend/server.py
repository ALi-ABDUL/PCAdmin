"""FastAPI endpoints for the Admin Dashboard API.
Deps: app/router/db/logger from deps.py — Pydantic models from models.py — helpers from helpers.py.
Refactored Feb 2026."""
from fastapi import HTTPException, Query, Depends, Header, Body, Request
from fastapi.responses import Response, JSONResponse, RedirectResponse
from starlette.middleware.cors import CORSMiddleware
import os
import re
import random
import secrets
import asyncio
import httpx
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Any

import resend
import bcrypt
import jwt

from deps import app, api_router, db, client, logger
from scraper import (
    ScrapeError, NotEbayAUError, BlockedError,
    validate_ebay_au_url, fetch_html, parse_and_enrich,
)
from models import (
    CATEGORIES, SEED_CATEGORIES, ScrapeRequest, ScrapedItem, WatchlistToggle, ProductCreate, 
    Product, ProductUpdate, ShippingAddress, _AU_SUBURBS, _STREET_NAMES, _STREET_TYPES, 
    OrderCreate, Settings, _DAY_LETTERS, Category, CategoryCreate, CategoryUpdate, ItemBulkAction, 
    RefreshAllRequest, SCRAPER_SCHEDULE_DEFAULTS, RETRY_DELAY_SECONDS, RUN_HISTORY_LIMIT, 
    FREQ_INTERVAL_SECONDS, _SYDNEY, ScraperScheduleUpdate, ORDER_STATUSES, ReturnRequest, 
    AbandonedCart, Transaction, CustomerBase, Customer, CustomerUpdate,
    CouponBase, Coupon, ReviewBase, Review, JWT_ALGO, JWT_ACCESS_TTL, PortalRegisterBody, 
    PortalLoginBody, PortalReviewBody, PortalReviewVoteBody, MessageBase, Message, StockMove, 
    _CATEGORY_RULES, _EBAY_BREADCRUMB_MAP, Notification, PUSH_SETTINGS_DEFAULTS, 
    PUSH_CRITICAL_TYPES, PushSettingsUpdate, PricingRuleBase, PricingRule, PricingRuleUpdate, 
    _DEFAULT_PRICING_RULES, BulkProductIds,
    PostagePresetBase, PostagePreset, PostagePresetUpdate, POSTAGE_PRESET_KINDS,
    DeliverySettingsUpdate,
    ADMIN_ROLES, AdminAccountCreate, AdminAccountUpdate, AdminAccount,
    CountryAccessUpdate, BYPASS_SESSION_TTL_SECONDS,
    CountdownStart, BrandingUpdate,
)
from countries import COUNTRIES, COUNTRY_CODES
from helpers import (
    _rand_au_address, _slug, _product_code_base, _generate_unique_product_code, 
    _ensure_product_codes_backfilled, _ensure_order_references_backfilled, _refresh_all_items, 
    _get_scraper_schedule, _compute_next_run, _classify_run, _push_run_history, 
    _refresh_all_and_record, _scheduler_loop, _ensure_categories_seeded, _ensure_ebay_category, _now_iso, 
    _seed_transactions_and_returns, _rebuild_customers_from_orders, _shape_review, _jwt_secret, 
    _hash_password, _verify_password, _issue_token, get_current_customer, _has_purchased, 
    _seller_id, _build_sellers, _match_rules, _guess_category, _get_push_settings, _mask, 
    _get_credential, _push_channel_status, _notif_is_critical, _send_email, _send_telegram, 
    _format_notification_html, _push_notification, _emit_notification, 
    _emit_price_change_notifications, _auto_archive_if_out_of_stock, calc_pricing, _ensure_pricing_rules_seeded, 
    _load_pricing_rules, _ensure_postage_presets_seeded, _get_delivery_settings, _delete_categories_if_empty,
    _ensure_main_admin_seeded, _default_seo,
    send_customer_email, send_customer_order_confirmation, send_customer_order_status_update,
    send_customer_order_cancellation, send_customer_welcome_email, CUSTOMER_EMAIL_KINDS,
    _customer_email_html,
    _ensure_country_access_seeded, _get_country_access, _client_country, _client_ip,
    _bypass_active_for_ip, _grant_bypass, _purge_expired_bypasses,
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


# --- Product code generator -------------------------------------------------
# Format: [First letter of product name][First letter of day][Day number]-PC[Month][Year]
# Example: "Keyboard" on Friday 21 Aug 2026 → "KF21-PC0826". Collisions get a "-N" suffix.


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@api_router.get("/")
async def root():
    return {"status": "ok", "service": "Admin Dashboard API", "region": "AU"}


# ---------------------------------------------------------------------------
# Scraper
# ---------------------------------------------------------------------------

@api_router.post("/scrape")
async def scrape(req: ScrapeRequest) -> dict:
    try:
        url = validate_ebay_au_url(req.url)
    except NotEbayAUError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        html, method_used = await fetch_html(
            url,
            method=req.method,
            scrapingbee_key=req.scrapingbee_key or None,
            scraperapi_key=req.scraperapi_key or None,
        )
    except BlockedError as e:
        # Failed / blocked scrapes are silent — no admin notification.
        raise HTTPException(status_code=502, detail=f"Scrape blocked or failed: {e}")
    except ScrapeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("scrape failure")
        raise HTTPException(status_code=500, detail=f"Unexpected scrape error: {e}")

    try:
        data = await parse_and_enrich(html, url, fetch_desc=True)
    except BlockedError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("parse failure")
        raise HTTPException(status_code=422, detail=f"Failed to parse eBay page: {e}")

    if not data.get("title"):
        raise HTTPException(status_code=422, detail="Could not extract item details. eBay may have blocked or changed layout.")

    now_iso = datetime.now(timezone.utc).isoformat()
    history_point = {"at": now_iso, "value": data.get("price_value"), "display": data.get("price_display")}
    if data.get("delivery_estimate"):
        data["delivery_estimate_updated_at"] = now_iso
    if data.get("is_sold"):
        data["sold_detected_at"] = now_iso
    # Auto-detect store category: prefer the eBay breadcrumb (creates the
    # Category record on the fly if it doesn't exist yet) and fall back to
    # the internal heuristic when eBay didn't give us a usable path.
    ebay_cat_slug = await _ensure_ebay_category(data.get("ebay_category_path") or [])
    data["category"] = ebay_cat_slug or _guess_category(
        title=data.get("title") or "",
        breadcrumbs=data.get("ebay_category_path") or [],
        specifics=data.get("specifics") or {},
    )

    if req.save:
        query = {"item_id": data["item_id"]} if data.get("item_id") else {"url": url}
        existing = await db.items.find_one(query, {"_id": 0})
        if existing:
            update_fields = {**data, "method_used": method_used, "updated_at": now_iso}
            # Preserve user's feature_flags
            if "feature_flags" in existing:
                update_fields["feature_flags"] = existing["feature_flags"]
            # Only overwrite sold_detected_at if it's a new sold/ended/OOS event
            new_status = data.get("stock_status") or ("sold" if data.get("is_sold") else "live")
            prev_status = existing.get("stock_status") or ("sold" if existing.get("is_sold") else "live")
            status_changed_to_dead = (new_status != "live") and (prev_status == "live")
            if status_changed_to_dead:
                update_fields["sold_detected_at"] = now_iso
                # Record an event for the frontend toast feed
                await db.sold_events.insert_one({
                    "id": str(uuid.uuid4()),
                    "item_id": existing.get("id"),
                    "ebay_item_id": data.get("item_id"),
                    "title": data.get("title") or existing.get("title"),
                    "url": existing.get("url"),
                    "image": (data.get("images") or existing.get("images") or [None])[0],
                    "last_price": data.get("price_value") or existing.get("price_value"),
                    "stock_status": new_status,
                    "detected_at": now_iso,
                    "notified": False,
                })
                # Mirror to product if linked. In addition to archiving, we
                # force `stock: 0` when the listing goes out of stock so the
                # product surfaces in the Products › Out of Stock tab (which
                # filters on `archived: True` or `stock == 0`).
                await db.products.update_many(
                    {"source_item_id": data.get("item_id")},
                    {"$set": {"active": False, "is_sold": True, "archived": True, "stock": 0, "stock_status": new_status, "updated_at": now_iso}},
                )
                # Human-readable notification per status
                status_titles = {"sold": "Sold on eBay", "ended": "Listing ended on eBay", "out_of_stock": "Out of stock on eBay"}
                status_bodies = {"sold": "sold — no longer available", "ended": "the seller ended the listing", "out_of_stock": "out of stock — no more units"}
                notif_title = status_titles.get(new_status, "No longer live on eBay")
                notif_reason = status_bodies.get(new_status, "no longer available")
                linked = await db.products.find({"source_item_id": data.get("item_id")}, {"_id": 0, "id": 1, "title": 1, "images": 1}).to_list(20)
                targets = linked or [{"id": None, "title": data.get("title") or existing.get("title"), "images": data.get("images") or existing.get("images") or []}]
                for lp in targets:
                    await _emit_notification(
                        type="out_of_stock",
                        title=notif_title,
                        body=f"{lp.get('title') or 'Item'} · {notif_reason}",
                        product_id=lp.get("id"),
                        item_id=data.get("item_id"),
                        ebay_url=existing.get("url"),
                        product_title=lp.get("title"),
                        image=(lp.get("images") or [None])[0],
                    )

            # RESTOCK — listing went dead→live. Notify but do NOT auto-activate; admin decides.
            status_changed_to_live = (new_status == "live") and (prev_status != "live")
            if status_changed_to_live:
                update_fields["restock_detected_at"] = now_iso
                linked = await db.products.find({"source_item_id": data.get("item_id")}, {"_id": 0, "id": 1, "title": 1, "images": 1}).to_list(20)
                targets = linked or [{"id": None, "title": data.get("title") or existing.get("title"), "images": data.get("images") or existing.get("images") or []}]
                for lp in targets:
                    await _emit_notification(
                        type="restock",
                        title="Back in stock on eBay",
                        body=f"{lp.get('title') or 'Item'} · previously {prev_status} — now live",
                        product_id=lp.get("id"),
                        item_id=data.get("item_id"),
                        ebay_url=existing.get("url"),
                        product_title=lp.get("title"),
                        image=(lp.get("images") or [None])[0],
                    )

            # Mirror variants (if scraper found any) onto every linked product so the admin sees them.
            if data.get("variants"):
                await db.products.update_many(
                    {"source_item_id": data.get("item_id")},
                    {"$set": {"variants": data["variants"], "updated_at": now_iso}},
                )
            history = existing.get("price_history", [])
            last_val = history[-1]["value"] if history else None
            new_val = data.get("price_value")
            if new_val is not None and new_val != last_val:
                history.append(history_point)
                # Emit a price-change notification for every linked product
                if last_val is not None:
                    await _emit_price_change_notifications(
                        item=existing,
                        new_image=(data.get("images") or existing.get("images") or [None])[0],
                        new_title=(data.get("title") or existing.get("title") or ""),
                        old_price=last_val,
                        new_price=new_val,
                        now_iso=now_iso,
                    )
            elif not history:
                history.append(history_point)
            update_fields["price_history"] = history
            await db.items.update_one(query, {"$set": update_fields})
            merged = {**existing, **update_fields}
            return {"item": merged, "method_used": method_used, "saved": True, "updated": True}
        else:
            item = ScrapedItem(**data, method_used=method_used, price_history=[history_point])
            doc = item.model_dump()
            await db.items.insert_one(doc)
            doc.pop("_id", None)
            return {"item": doc, "method_used": method_used, "saved": True, "updated": False}
    else:
        return {"item": {**data, "method_used": method_used}, "method_used": method_used, "saved": False}


@api_router.get("/items")
async def list_items(
    q: Optional[str] = None,
    watchlisted: Optional[bool] = None,
    status: Optional[str] = None,     # all | active | out_of_stock | price_changed | live | sold
    category: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    sort: str = "created_at_desc",
    limit: int = Query(200, le=500),
    skip: int = Query(0, ge=0),
):
    query: dict[str, Any] = {}
    if watchlisted is not None:
        query["watchlisted"] = watchlisted
    # Status filters
    if status in ("sold", "out_of_stock"):
        query["is_sold"] = True
    elif status in ("live", "active"):
        query["is_sold"] = {"$ne": True}
        query["active"] = {"$ne": False}
    elif status == "inactive":
        query["active"] = False
    elif status == "price_changed":
        # At least 2 price_history points AND first differs from last
        query["$expr"] = {
            "$and": [
                {"$gte": [{"$size": {"$ifNull": ["$price_history", []]}}, 2]},
                {"$ne": [
                    {"$arrayElemAt": ["$price_history.value", 0]},
                    {"$arrayElemAt": ["$price_history.value", -1]},
                ]},
            ]
        }
    if category:
        query["category"] = category
    if min_price is not None or max_price is not None:
        rng: dict = {}
        if min_price is not None: rng["$gte"] = min_price
        if max_price is not None: rng["$lte"] = max_price
        query["price_value"] = rng
    if q:
        query["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"seller": {"$regex": q, "$options": "i"}},
            {"location": {"$regex": q, "$options": "i"}},
        ]
    sort_map = {
        "created_at_desc": [("created_at", -1)],
        "created_at_asc":  [("created_at", 1)],
        "price_desc":      [("price_value", -1)],
        "price_asc":       [("price_value", 1)],
        "title_asc":       [("title", 1)],
    }
    total = await db.items.count_documents(query)
    # "margin_desc" is computed server-side using active pricing rules.
    if sort == "margin_desc":
        # Full-set sort in Python — margin needs pricing-rule evaluation per row.
        all_items = await db.items.find(query, {"_id": 0}).to_list(length=None)
        rules = await _load_pricing_rules()
        def margin(it: dict) -> float:
            ebay = float(it.get("price_value") or 0)
            if ebay <= 0: return -1.0
            c = calc_pricing(ebay, rules=rules)
            sell = c["sell_price"]
            return ((sell - ebay) / sell) if sell > 0 else -1.0
        all_items.sort(key=margin, reverse=True)
        items = all_items[skip: skip + limit]
    else:
        cursor = db.items.find(query, {"_id": 0}).sort(sort_map.get(sort, [("created_at", -1)])).skip(skip).limit(limit)
        items = await cursor.to_list(length=limit)
    # Attach `linked_product_id` (if this scraped item was Added-To-Products
    # earlier) so the UI can deep-link straight to that product's detail page.
    ebay_ids = [it.get("item_id") for it in items if it.get("item_id")]
    if ebay_ids:
        linked = await db.products.find(
            {"source_item_id": {"$in": ebay_ids}, "archived": {"$ne": True}},
            {"_id": 0, "id": 1, "source_item_id": 1},
        ).to_list(length=len(ebay_ids))
        by_src = {p["source_item_id"]: p["id"] for p in linked if p.get("source_item_id")}
        for it in items:
            it["linked_product_id"] = by_src.get(it.get("item_id"))
    return {"items": items, "total": total}


@api_router.post("/items/bulk")
async def items_bulk_action(body: ItemBulkAction):
    if not body.ids:
        raise HTTPException(status_code=400, detail="No item ids")
    if body.action == "delete":
        r = await db.items.delete_many({"id": {"$in": body.ids}})
        return {"deleted": r.deleted_count}
    if body.action in ("deactivate", "activate"):
        active = body.action == "activate"
        r = await db.items.update_many(
            {"id": {"$in": body.ids}},
            {"$set": {"active": active, "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        return {"updated": r.modified_count, "active": active}
    if body.action == "add_to_products":
        created = 0
        skipped = 0
        errors: list[str] = []
        rules = await _load_pricing_rules()
        for iid in body.ids:
            it = await db.items.find_one({"id": iid}, {"_id": 0})
            if not it:
                errors.append(f"{iid[:8]} not found")
                continue
            if it.get("added_to_products"):
                skipped += 1
                continue
            try:
                cost = it.get("price_value") or 0.0
                pricing = calc_pricing(cost, rules=rules)
                ebay_cat_slug = await _ensure_ebay_category(it.get("ebay_category_path") or [])
                prod = Product(
                    title=it.get("title") or "Untitled",
                    price=pricing["sell_price"],
                    cost=cost,
                    stock=10,
                    category=ebay_cat_slug or it.get("category") or _guess_category(
                        title=it.get("title") or "",
                        breadcrumbs=it.get("ebay_category_path") or [],
                        specifics=it.get("specifics") or {},
                    ),
                    description=it.get("description") or "",
                    images=it.get("images") or [],
                    source_url=it.get("url"),
                    source_item_id=it.get("item_id") or it.get("id"),
                    variants=it.get("variants") or [],
                    specifics=it.get("specifics") or {},
                    postage=it.get("postage_display") or None,
                    delivery_speed=it.get("delivery_speed") or None,
                    delivery_date_range=it.get("delivery_date_range") or None,
                )
                prod.product_code = await _generate_unique_product_code(prod.title)
                await db.products.insert_one(prod.model_dump())
                await db.items.update_one({"id": iid}, {"$set": {"added_to_products": True}})
                created += 1
            except Exception as e:
                errors.append(f"{iid[:8]}: {str(e)[:60]}")
        return {"created": created, "skipped": skipped, "errors": errors}
    raise HTTPException(status_code=400, detail="Unknown action")


@api_router.get("/items/refresh-status")
async def refresh_status():
    doc = await db.system.find_one({"_id": "nightly"}, {"_id": 0})
    return doc or {"last_run": None}


@api_router.get("/sold-events")
async def list_sold_events(unread_only: bool = True, mark_seen: bool = True, limit: int = 50):
    q = {"notified": False} if unread_only else {}
    events = await db.sold_events.find(q, {"_id": 0}).sort("detected_at", -1).limit(limit).to_list(limit)
    if mark_seen and events:
        ids = [e["id"] for e in events]
        await db.sold_events.update_many({"id": {"$in": ids}}, {"$set": {"notified": True}})
    return {"events": events}


@api_router.get("/items/{item_id}")
async def get_item(item_id: str):
    item = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@api_router.delete("/items/{item_id}")
async def delete_item(item_id: str):
    result = await db.items.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"deleted": True}


@api_router.post("/items/{item_id}/watchlist")
async def toggle_watchlist(item_id: str, body: WatchlistToggle):
    result = await db.items.update_one(
        {"id": item_id},
        {"$set": {"watchlisted": body.watchlisted, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    item = await db.items.find_one({"id": item_id}, {"_id": 0})
    return item


@api_router.post("/items/{item_id}/refresh")
async def refresh_item(item_id: str, req: ScrapeRequest):
    existing = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Item not found")
    req.url = existing["url"]
    req.save = True
    return await scrape(req)


@api_router.patch("/items/{item_id}/features")
async def update_item_features(item_id: str, features: dict):
    r = await db.items.update_one({"id": item_id}, {"$set": {"feature_flags": features, "updated_at": datetime.now(timezone.utc).isoformat()}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return await db.items.find_one({"id": item_id}, {"_id": 0})


@api_router.post("/items/refresh-all")
async def refresh_all_items(body: RefreshAllRequest):
    return await _refresh_all_items(body.method, body.scrapingbee_key, body.scraperapi_key)


@api_router.get("/scraper/schedule")
async def get_scraper_schedule():
    sched = await _get_scraper_schedule()
    # Always refresh next_run_at on read so the UI shows an accurate value
    next_run = _compute_next_run(sched)
    if next_run != sched.get("next_run_at"):
        await db.scraper_schedule.update_one({"id": "singleton"}, {"$set": {"next_run_at": next_run}}, upsert=True)
        sched["next_run_at"] = next_run
    return sched


@api_router.patch("/scraper/schedule")
async def update_scraper_schedule(body: ScraperScheduleUpdate):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if body.frequency is not None and body.frequency not in FREQ_INTERVAL_SECONDS:
        raise HTTPException(status_code=400, detail=f"frequency must be one of {list(FREQ_INTERVAL_SECONDS)}")
    if body.start_time_hhmm is not None and not re.match(r"^\d{2}:\d{2}$", body.start_time_hhmm):
        raise HTTPException(status_code=400, detail="start_time_hhmm must be HH:MM")
    if body.stop_date == "":
        fields["stop_date"] = None
    if fields:
        await db.scraper_schedule.update_one({"id": "singleton"}, {"$set": fields}, upsert=True)
    # Recompute next run after any change
    sched = await _get_scraper_schedule()
    next_run = _compute_next_run(sched)
    await db.scraper_schedule.update_one({"id": "singleton"}, {"$set": {"next_run_at": next_run}}, upsert=True)
    return await get_scraper_schedule()


@api_router.post("/scraper/schedule/run-now")
async def scraper_schedule_run_now():
    summary = await _refresh_all_and_record(method="auto", trigger="manual", attempt=1)
    return {"ok": True, "summary": summary, "schedule": await get_scraper_schedule()}


@api_router.post("/scraper/schedule/clear-history")
async def clear_scraper_history():
    await db.scraper_schedule.update_one(
        {"id": "singleton"},
        {"$set": {"run_history": [], "retry_pending": None}},
        upsert=True,
    )
    return await get_scraper_schedule()


@app.on_event("startup")
async def _start_scheduler():
    await _ensure_categories_seeded()
    await _ensure_pricing_rules_seeded()
    await _ensure_postage_presets_seeded()
    await _ensure_main_admin_seeded()
    await _ensure_country_access_seeded()
    if await db.customers.count_documents({}) == 0:
        await _rebuild_customers_from_orders()
    # One-shot migration: the customer-group feature was removed — strip legacy
    # `group` field from any existing customer docs so it no longer surfaces
    # in list/summary responses.
    try:
        await db.customers.update_many({"group": {"$exists": True}}, {"$unset": {"group": ""}})
    except Exception as e:
        logger.warning(f"group unset migration: {e}")
    await _seed_transactions_and_returns()
    await _ensure_product_codes_backfilled()
    await _ensure_order_references_backfilled()
    try:
        await db.customer_accounts.create_index("email", unique=True)
        await db.reviews.create_index([("product_id", 1), ("customer_email", 1)])
        await db.products.create_index("product_code", unique=True, sparse=True)
    except Exception as e:
        logger.warning(f"index setup: {e}")
    asyncio.create_task(_scheduler_loop())
    asyncio.create_task(_countdown_sweep_loop())


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


@api_router.get("/categories")
async def list_categories(active: Optional[bool] = None, group: Optional[str] = None):
    q: dict[str, Any] = {}
    if active is not None: q["active"] = active
    if group: q["group"] = group
    cats = await db.categories.find(q, {"_id": 0}).sort([("sort_order", 1), ("name", 1)]).to_list(500)
    # Attach product counts
    pipeline = [{"$group": {"_id": "$category", "count": {"$sum": 1}}}]
    counts = {c["_id"]: c["count"] for c in await db.products.aggregate(pipeline).to_list(500)}
    for c in cats:
        c["product_count"] = counts.get(c["slug"], 0)
    groups = sorted({c["group"] for c in cats})
    return {"categories": cats, "groups": groups, "total": len(cats)}


@api_router.post("/categories", response_model=Category)
async def create_category(body: CategoryCreate):
    slug = _slug(body.name)
    if await db.categories.find_one({"slug": slug}):
        raise HTTPException(status_code=409, detail="A category with that name/slug already exists")
    n = await db.categories.count_documents({})
    cat = Category(**body.model_dump(), slug=slug, sort_order=n)
    await db.categories.insert_one(cat.model_dump())
    return cat


@api_router.patch("/categories/{cid}")
async def update_category(cid: str, body: CategoryUpdate):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if "name" in fields:
        fields["slug"] = _slug(fields["name"])
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    r = await db.categories.update_one({"id": cid}, {"$set": fields})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    return await db.categories.find_one({"id": cid}, {"_id": 0})


@api_router.delete("/categories/{cid}")
async def delete_category(cid: str):
    cat = await db.categories.find_one({"id": cid}, {"_id": 0})
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    in_use = await db.products.count_documents({"category": cat["slug"]})
    if in_use > 0:
        raise HTTPException(status_code=409, detail=f"Cannot delete: {in_use} product(s) still use this category.")
    await db.categories.delete_one({"id": cid})
    return {"deleted": True}


@api_router.post("/categories/reseed")
async def reseed_categories(force: bool = False):
    if force:
        await db.categories.delete_many({})
    await _ensure_categories_seeded()
    return await list_categories()


# ---------------------------------------------------------------------------
# Returns, Abandoned Carts, Transactions
# ---------------------------------------------------------------------------


@api_router.get("/orders/status-counts")
async def order_status_counts():
    pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
    rows = await db.orders.aggregate(pipeline).to_list(50)
    counts = {r["_id"]: r["count"] for r in rows}
    total = sum(counts.values())
    return {"total": total, "counts": counts}


@api_router.get("/orders/stuck")
async def stuck_orders():
    """Orders whose time in the CURRENT status exceeds the SLA thresholds.

    SLA (days):
      new/pending → 1 / 2   processing → 3   ready_to_ship → 1   shipped → 7

    An order is "current" in a status either since its most recent status_history
    entry, or since created_at if history is empty. Terminal statuses
    (delivered / cancelled / refunded) are always excluded.
    """
    SLA_DAYS = {
        "new": 1,
        "pending": 2,
        "processing": 3,
        "ready_to_ship": 1,
        "ready to ship": 1,
        "shipped": 7,
    }
    TERMINAL = {"delivered", "cancelled", "refunded"}
    now = datetime.now(timezone.utc)
    stuck: list[dict] = []
    async for o in db.orders.find(
        {"status": {"$nin": list(TERMINAL)}},
        {"_id": 0, "id": 1, "reference": 1, "status": 1, "created_at": 1,
         "total": 1, "product_title": 1, "product_id": 1, "customer_name": 1,
         "customer_email": 1, "status_history": 1},
    ):
        status_key = (o.get("status") or "").lower()
        sla = SLA_DAYS.get(status_key)
        if sla is None:
            continue
        history = o.get("status_history") or []
        since_iso = (history[-1].get("changed_at") if history else o.get("created_at")) or ""
        try:
            since = datetime.fromisoformat(since_iso.replace("Z", "+00:00"))
            if since.tzinfo is None:
                since = since.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError, AttributeError):
            continue
        days = (now - since).days
        if days > sla:
            stuck.append({
                "id": o.get("id"),
                "reference": o.get("reference"),
                "status": o.get("status"),
                "product_title": o.get("product_title"),
                "product_id": o.get("product_id"),
                "customer_name": o.get("customer_name"),
                "days_stuck": days,
                "sla_days": sla,
                "since": since_iso,
                "total": o.get("total"),
            })
    # Most-stuck first — helps admins triage.
    stuck.sort(key=lambda r: r["days_stuck"], reverse=True)
    return {"stuck": stuck, "total": len(stuck), "sla": SLA_DAYS}


@api_router.get("/orders/{oid}")
async def get_order(oid: str):
    o = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="Not found")
    return o


@api_router.patch("/orders/{oid}")
async def update_order(oid: str, body: dict):
    prev = await db.orders.find_one({"id": oid}, {"_id": 0})
    if not prev:
        raise HTTPException(status_code=404, detail="Not found")
    new_status = body.get("status")
    old_status = prev.get("status")
    update_doc = {"$set": body}
    # Append to the order's status_history when the status actually changes so
    # the customer profile can render a full audit trail on the timeline.
    if new_status and new_status != old_status:
        update_doc["$push"] = {"status_history": {
            "from": old_status,
            "to": new_status,
            "changed_at": datetime.now(timezone.utc).isoformat(),
        }}
    r = await db.orders.update_one({"id": oid}, update_doc)
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    updated = await db.orders.find_one({"id": oid}, {"_id": 0})
    # NOTE: order status updates are an internal admin action and do NOT
    # emit an admin notification. Notifications should only fire for external
    # events that need the admin's attention.
    #
    # But CUSTOMER-facing emails DO fire on the status transitions the customer
    # cares about (processing / shipped / delivered / cancelled) — gated by the
    # per-kind toggles in push_settings.
    if new_status and new_status != old_status:
        if new_status in ("processing", "shipped", "delivered"):
            await send_customer_order_status_update(updated, old_status, new_status)
        elif new_status == "cancelled":
            await send_customer_order_cancellation(updated)
    return updated


@api_router.get("/returns")
async def list_returns(status: Optional[str] = None):
    q = {"status": status} if status else {}
    items = await db.returns.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    total = await db.returns.count_documents(q)
    return {"returns": items, "total": total}


@api_router.post("/returns", response_model=ReturnRequest)
async def create_return(body: ReturnRequest):
    doc = body.model_dump(); doc["id"] = str(uuid.uuid4()); doc["created_at"] = _now_iso()
    await db.returns.insert_one(doc)
    # Notification: order cancellation / refund request (external customer action)
    await _emit_notification(
        type="cancellation_request",
        title="Order cancellation request",
        body=f"{doc['customer_name']} · {doc['product_title'] or 'Order'} · {doc['reason']}",
        order_id=doc.get("order_id"),
        product_id=doc.get("product_id"),
        product_title=doc.get("product_title"),
        data={"amount": doc.get("amount"), "reason": doc.get("reason"),
              "customer_name": doc.get("customer_name")},
    )
    doc.pop("_id", None); return doc


@api_router.patch("/returns/{rid}")
async def update_return(rid: str, body: dict):
    r = await db.returns.update_one({"id": rid}, {"$set": body})
    if r.matched_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return await db.returns.find_one({"id": rid}, {"_id": 0})


@api_router.get("/abandoned-carts")
async def list_abandoned_carts(recovered: Optional[bool] = None):
    q: dict[str, Any] = {}
    if recovered is not None: q["recovered"] = recovered
    items = await db.abandoned_carts.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    total = await db.abandoned_carts.count_documents(q)
    total_value = sum(c.get("subtotal", 0) for c in items)
    return {"carts": items, "total": total, "total_value": round(total_value, 2)}


@api_router.patch("/abandoned-carts/{cid}")
async def update_abandoned_cart(cid: str, body: dict):
    r = await db.abandoned_carts.update_one({"id": cid}, {"$set": body})
    if r.matched_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return await db.abandoned_carts.find_one({"id": cid}, {"_id": 0})


@api_router.get("/transactions")
async def list_transactions(
    status: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = Query(500, le=2000),
    skip: int = Query(0, ge=0),
    sort: str = "created_at_desc",
):
    q: dict[str, Any] = {}
    if status: q["status"] = status
    if kind:   q["kind"] = kind
    _TX_SORT_FIELDS = {"reference", "customer_name", "method", "amount", "status", "created_at"}
    field, _, dir_ = sort.rpartition("_")
    if field in _TX_SORT_FIELDS and dir_ in ("asc", "desc"):
        sort_spec = [(field, 1 if dir_ == "asc" else -1)]
    else:
        sort_spec = [("created_at", -1)]
    items = await db.transactions.find(q, {"_id": 0}).sort(sort_spec).skip(skip).limit(limit).to_list(limit)
    total = await db.transactions.count_documents(q)
    # Counts aggregate is calculated over the WHOLE filtered set (not just the
    # current page) so the summary chips stay accurate regardless of pagination.
    counts_pipeline = [{"$match": q}, {"$group": {"_id": "$status", "count": {"$sum": 1}, "amount": {"$sum": "$amount"}}}] if q else [{"$group": {"_id": "$status", "count": {"$sum": 1}, "amount": {"$sum": "$amount"}}}]
    counts_rows = await db.transactions.aggregate(counts_pipeline).to_list(20)
    counts = {r["_id"]: {"count": r["count"], "amount": round(r["amount"], 2)} for r in counts_rows}
    return {"transactions": items, "total": total, "counts": counts}


@api_router.post("/transactions", response_model=Transaction)
async def create_transaction(body: Transaction):
    doc = body.model_dump(); doc["id"] = str(uuid.uuid4()); doc["created_at"] = _now_iso()
    await db.transactions.insert_one(doc)
    # Notification: only for successful CHARGE (payment received). Refunds and
    # chargebacks are handled through the returns flow; failed charges are noise.
    if doc.get("kind") == "charge" and doc.get("status") == "successful":
        await _emit_notification(
            type="new_payment",
            title="New payment received",
            body=f"{doc['customer_name']} · ${doc['amount']:.2f} · {doc['method']}",
            order_id=doc.get("order_id"),
            data={"amount": doc["amount"], "method": doc["method"],
                  "customer_name": doc["customer_name"], "reference": doc.get("reference")},
        )
    doc.pop("_id", None); return doc


# ---------------------------------------------------------------------------
# Customers (persistent) - complement to derived-from-orders
# ---------------------------------------------------------------------------


@api_router.get("/customers")
async def list_customers(
    q: Optional[str] = None,
    status: Optional[str] = None,
    type: Optional[str] = None,
    sort: str = "created_at_desc",
    limit: int = Query(500, le=2000),
    skip: int = Query(0, ge=0),
):
    query: dict[str, Any] = {}
    if status: query["status"] = status
    if type:   query["type"] = type
    if q:
        query["$or"] = [
            {"name":  {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
            {"code":  {"$regex": q, "$options": "i"}},
        ]
    sort_map = {
        "created_at_desc": [("created_at", -1)],
        "created_at_asc":  [("created_at", 1)],
        "name_asc":        [("name", 1)],
        "name_desc":       [("name", -1)],
        "code_asc":        [("code", 1)],
        "code_desc":       [("code", -1)],
        "type_asc":        [("type", 1)],
        "type_desc":       [("type", -1)],
        "status_asc":      [("status", 1)],
        "status_desc":     [("status", -1)],
        "spend_desc":      [("total_spend", -1)],
        "spend_asc":       [("total_spend", 1)],
        "total_spend_desc": [("total_spend", -1)],
        "total_spend_asc":  [("total_spend", 1)],
        "orders_desc":      [("orders_count", -1)],
        "orders_asc":       [("orders_count", 1)],
        "orders_count_desc": [("orders_count", -1)],
        "orders_count_asc":  [("orders_count", 1)],
    }
    cursor = db.customers.find(query, {"_id": 0}).sort(sort_map.get(sort, [("created_at", -1)])).skip(skip).limit(limit)
    customers = await cursor.to_list(length=limit)
    # For every customer with an email in this page, work out whether their
    # most-recent INBOUND message is newer than any outbound reply — if so we
    # surface a red "unread reply" dot in the UI. We do the calculation in a
    # single aggregation and stitch results back into the list to keep the
    # main list query fast.
    emails = list({(c.get("email") or "").strip().lower() for c in customers if c.get("email")})
    unread: set[str] = set()
    if emails:
        pipeline = [
            {"$match": {"customer_email": {"$in": emails}}},
            {"$group": {
                "_id": {"email": "$customer_email", "direction": "$direction"},
                "last_ts": {"$max": "$created_at"},
            }},
        ]
        rows = await db.messages.aggregate(pipeline).to_list(length=None)
        per_email: dict[str, dict[str, str]] = {}
        for r in rows:
            key = (r["_id"].get("email") or "").strip().lower()
            direction = r["_id"].get("direction") or "inbound"
            per_email.setdefault(key, {})[direction] = r.get("last_ts") or ""
        for k, v in per_email.items():
            if (v.get("inbound") or "") > (v.get("outbound") or ""):
                unread.add(k)
    for c in customers:
        c["has_unread_reply"] = (c.get("email") or "").strip().lower() in unread
    total = await db.customers.count_documents(query)
    return {"customers": customers, "total": total}


@api_router.get("/customers/summary")
async def customers_summary():
    total = await db.customers.count_documents({})
    active = await db.customers.count_documents({"status": "active"})
    pending = await db.customers.count_documents({"status": "pending"})
    blocked = await db.customers.count_documents({"status": "blocked"})
    guest = await db.customers.count_documents({"type": "guest"})
    registered = await db.customers.count_documents({"type": "registered"})
    top = await db.customers.find({}, {"_id": 0}).sort("total_spend", -1).limit(10).to_list(10)
    return {"total": total, "active": active, "pending": pending, "blocked": blocked, "guest": guest, "registered": registered, "top": top}


@api_router.get("/customers/unread-count")
async def customers_unread_count():
    """How many distinct customers have sent an inbound message the admin has
    not yet seen?

    A single watermark ``messages_last_seen_at`` is stored in ``db.admin_meta``.
    Every inbound message with ``created_at > watermark`` counts, grouped by
    email so ten messages from the same customer still show as one badge unit.
    Visiting the Messages inbox (or clicking the sidebar badge) POSTs to
    ``/customers/messages/mark-seen`` which advances the watermark to now,
    zeroing the badge until a truly new message arrives.
    """
    meta = await db.admin_meta.find_one({"_id": "main"}, {"_id": 0}) or {}
    watermark = meta.get("messages_last_seen_at") or ""
    pipeline = [
        {"$match": {"direction": "inbound", "created_at": {"$gt": watermark}}},
        {"$group": {"_id": "$customer_email"}},
    ]
    rows = await db.messages.aggregate(pipeline).to_list(length=None)
    count = sum(1 for r in rows if (r.get("_id") or "").strip())
    return {"count": count}


@api_router.post("/customers/messages/mark-seen")
async def customers_messages_mark_seen():
    """Advance the admin's "last seen" watermark on the customer messages
    inbox to *now*. Called when the admin opens the Messages section or
    clicks the sidebar unread badge — clears the badge until a new inbound
    message arrives afterwards."""
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.admin_meta.update_one(
        {"_id": "main"},
        {"$set": {"messages_last_seen_at": now_iso}},
        upsert=True,
    )
    return {"ok": True, "messages_last_seen_at": now_iso}


@api_router.get("/customers/{cid}")
async def get_customer(cid: str):
    """Full profile for a single customer plus their recent orders (last 25),
    the full message thread (inbound + outbound, chronological), and a flat
    timeline of order lifecycle events (created + every status change) so the
    admin detail page can render everything in one round-trip."""
    c = await db.customers.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Not found")
    orders: list[dict] = []
    thread: list[dict] = []
    timeline: list[dict] = []
    email = (c.get("email") or "").strip().lower()
    if email:
        orders_full = await db.orders.find(
            {"customer_email": email}, {"_id": 0},
        ).sort("created_at", -1).limit(25).to_list(25)
        # Batch-fetch product thumbnails so the timeline & orders table can
        # show a small image next to each row without N+1 lookups.
        product_ids = list({o.get("product_id") for o in orders_full if o.get("product_id")})
        product_images: dict[str, str] = {}
        if product_ids:
            prods = await db.products.find(
                {"id": {"$in": product_ids}}, {"_id": 0, "id": 1, "images": 1},
            ).to_list(length=None)
            for p in prods:
                imgs = p.get("images") or []
                if imgs:
                    product_images[p["id"]] = imgs[0]
        # Keep the compact shape for the Recent orders table.
        orders = [
            {
                **{k: o.get(k) for k in ("id", "reference", "status", "total", "created_at", "items", "customer_name", "product_id", "product_title")},
                "product_image": product_images.get(o.get("product_id")),
            }
            for o in orders_full
        ]
        thread = await db.messages.find(
            {"customer_email": email}, {"_id": 0},
        ).sort("created_at", 1).to_list(500)
        for m in thread:
            if not m.get("direction"):
                m["direction"] = "inbound"
        # Build the flat timeline: one "order_created" event per order + one
        # "status_change" event for every entry in status_history.
        for o in orders_full:
            _img = product_images.get(o.get("product_id"))
            _base = {
                "order_id": o.get("id"),
                "order_reference": o.get("reference"),
                "product_id": o.get("product_id"),
                "product_title": o.get("product_title"),
                "product_image": _img,
            }
            timeline.append({
                **_base,
                "type": "order_created",
                "ts": o.get("created_at"),
                "status": o.get("status"),
                "total": o.get("total"),
            })
            for h in (o.get("status_history") or []):
                timeline.append({
                    **_base,
                    "type": "status_change",
                    "ts": h.get("changed_at"),
                    "from": h.get("from"),
                    "to": h.get("to"),
                })
        # Newest first — most useful for admins scanning "what happened last".
        timeline.sort(key=lambda e: e.get("ts") or "", reverse=True)
        # Tag the LATEST event per order with `days_in_status` when the order
        # is still "open" (i.e. not in a terminal state). This is what powers
        # the "N days" chip in the UI so stuck orders leap off the page.
        _CLOSED = {"delivered", "cancelled", "refunded"}
        now = datetime.now(timezone.utc)
        seen_order_ids: set[str] = set()
        for e in timeline:
            oid = e.get("order_id")
            if not oid or oid in seen_order_ids:
                continue
            seen_order_ids.add(oid)
            current_status = (e.get("to") if e.get("type") == "status_change" else e.get("status")) or ""
            if current_status.lower() in _CLOSED:
                continue
            try:
                since = datetime.fromisoformat((e.get("ts") or "").replace("Z", "+00:00"))
                if since.tzinfo is None:
                    since = since.replace(tzinfo=timezone.utc)
                delta = now - since
                # Round up so anything past 24h shows "1 day"; under 24h → 0.
                e["days_in_status"] = max(0, delta.days)
                e["hours_in_status"] = max(0, int(delta.total_seconds() // 3600))
                e["is_current_status"] = True
            except (ValueError, TypeError):
                pass
        # Compute unread-reply flag the same way the list endpoint does.
        last_in  = max((m.get("created_at", "") for m in thread if m.get("direction") == "inbound"), default="")
        last_out = max((m.get("created_at", "") for m in thread if m.get("direction") == "outbound"), default="")
        c["has_unread_reply"] = bool(last_in and last_in > last_out)
    return {"customer": c, "orders": orders, "thread": thread, "timeline": timeline}


@api_router.post("/customers/{cid}/message")
async def message_customer(cid: str, body: dict):
    """Admin composes and sends a direct email to a customer via Resend.

    Bypasses the transactional email toggle system (this is an explicit admin action).
    Uses the store's configured `resend_api_key` / `resend_from_email`. The outbound
    copy is also logged into `db.messages` (direction=outbound) so it appears in
    the Customer Messages inbox.
    """
    c = await db.customers.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    to_email = (c.get("email") or "").strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="Customer has no email on file")

    subject = (body or {}).get("subject", "").strip()
    message = (body or {}).get("body", "").strip()
    if not subject or not message:
        raise HTTPException(status_code=400, detail="Both subject and body are required")

    settings = await _get_push_settings()
    key = settings.get("resend_api_key")
    if not key:
        raise HTTPException(status_code=400, detail="Resend API key is not configured. Add it in Store Management › Email & Notifications.")
    frm = settings.get("resend_from_email") or "onboarding@resend.dev"

    # Reuse the store's card template so the email looks on-brand.
    html = _customer_email_html(
        title=subject,
        intro=f"Hi {c.get('name') or 'there'},",
        rows=[("Message", message.replace('\n', '<br/>'))],
        footer="Reply to this email to reach us directly.",
    )

    resend.api_key = key
    try:
        await asyncio.to_thread(resend.Emails.send, {
            "from": frm, "to": [to_email], "subject": subject, "html": html,
        })
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Send failed: {e}")

    # Log outbound copy in the Messages inbox for a full audit trail.
    m = Message(
        customer_name=c.get("name") or "",
        customer_email=to_email.lower(),
        subject=subject,
        body=message,
        status="archived",  # outbound messages don't need admin action
    )
    doc = m.model_dump()
    doc["direction"] = "outbound"
    await db.messages.insert_one(doc)

    return {"sent": True, "to": to_email, "message_id": m.id}




@api_router.post("/customers", response_model=Customer)
async def create_customer(body: CustomerBase):
    c = Customer(**body.model_dump())
    await db.customers.insert_one(c.model_dump())
    # Notification: new customer registered
    await _emit_notification(
        type="new_customer",
        title="New customer registered",
        body=f"{c.name} · {c.email or 'no email'}",
        customer_id=c.id,
        data={"name": c.name, "email": c.email},
    )
    return c


@api_router.patch("/customers/{cid}")
async def update_customer(cid: str, body: CustomerUpdate):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields: raise HTTPException(status_code=400, detail="No fields")
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.customers.update_one({"id": cid}, {"$set": fields})
    if r.matched_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return await db.customers.find_one({"id": cid}, {"_id": 0})


@api_router.delete("/customers/{cid}")
async def delete_customer(cid: str):
    r = await db.customers.delete_one({"id": cid})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": True}


@api_router.post("/customers/import")
async def import_customers(payload: dict):
    arr = payload.get("customers") or []
    docs = [Customer(**c).model_dump() for c in arr]
    if docs: await db.customers.insert_many(docs)
    return {"imported": len(docs)}


@api_router.post("/customers/rebuild-from-orders")
async def rebuild_from_orders():
    n = await _rebuild_customers_from_orders()
    return {"created": n}


# ---------------------------------------------------------------------------
# Coupons + Reviews + Customer messages (light collections)
# ---------------------------------------------------------------------------


@api_router.get("/coupons")
async def list_coupons():
    items = await db.coupons.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"coupons": items, "total": len(items)}


@api_router.post("/coupons", response_model=Coupon)
async def create_coupon(body: CouponBase):
    c = Coupon(**body.model_dump())
    await db.coupons.insert_one(c.model_dump())
    return c


@api_router.delete("/coupons/{cid}")
async def delete_coupon(cid: str):
    r = await db.coupons.delete_one({"id": cid})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": True}


@api_router.get("/reviews")
async def list_reviews(product_id: Optional[str] = None, status: Optional[str] = None):
    q: dict[str, Any] = {}
    if product_id: q["product_id"] = product_id
    if status:     q["status"] = status
    items = await db.reviews.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"reviews": [_shape_review(r) for r in items], "total": len(items)}


@api_router.get("/products/{product_id}/reviews")
async def product_reviews(product_id: str):
    """Public review feed for a product page: approved reviews + aggregate stats."""
    items = await db.reviews.find(
        {"product_id": product_id, "status": "approved"}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    ratings = [int(r.get("rating") or 0) for r in items if r.get("rating")]
    dist = {str(i): 0 for i in range(1, 6)}
    for r in ratings:
        if 1 <= r <= 5:
            dist[str(r)] += 1
    avg = round(sum(ratings) / len(ratings), 2) if ratings else 0.0
    return {
        "reviews": [_shape_review(r) for r in items],
        "total": len(items),
        "average_rating": avg,
        "rating_distribution": dist,
    }


@api_router.post("/reviews", response_model=Review)
async def create_review(body: ReviewBase):
    r = Review(**body.model_dump())
    await db.reviews.insert_one(r.model_dump())
    return r


@api_router.patch("/reviews/{rid}")
async def update_review(rid: str, body: dict):
    body.pop("helpful_votes", None); body.pop("not_helpful_votes", None)
    r = await db.reviews.update_one({"id": rid}, {"$set": body})
    if r.matched_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return _shape_review(await db.reviews.find_one({"id": rid}, {"_id": 0}))


@api_router.delete("/reviews/{rid}")
async def delete_review(rid: str):
    r = await db.reviews.delete_one({"id": rid})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": True}


# --- Customer Portal (JWT auth + verified-purchase reviews) ---------------


@api_router.post("/portal/register")
async def portal_register(body: PortalRegisterBody):
    email = (body.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Please enter a valid email address")
    if len(body.password or "") < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    existing = await db.customer_accounts.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists — please sign in")
    order = await db.orders.find_one({"customer_email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
    if not order:
        raise HTTPException(
            status_code=403,
            detail="We couldn't find any orders for this email. Only customers with existing orders can register.",
        )
    display_name = (body.name or order.get("customer_name") or email.split("@")[0]).strip()
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": display_name,
        "password_hash": _hash_password(body.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.customer_accounts.insert_one(doc)
    # Customer email: welcome (gated by customer_welcome_email toggle)
    await send_customer_welcome_email(doc)
    token = _issue_token(email)
    return {"token": token, "customer": {"id": doc["id"], "email": email, "name": display_name}}


@api_router.post("/portal/login")
async def portal_login(body: PortalLoginBody):
    email = (body.email or "").strip().lower()
    acct = await db.customer_accounts.find_one({"email": email})
    if not acct or not _verify_password(body.password or "", acct.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Wrong email or password")
    token = _issue_token(email)
    return {"token": token, "customer": {"id": acct["id"], "email": email, "name": acct.get("name", "")}}


@api_router.get("/portal/me")
async def portal_me(current: dict = Depends(get_current_customer)):
    return {"customer": current}


@api_router.get("/portal/orders")
async def portal_orders(current: dict = Depends(get_current_customer)):
    """Return every order for the logged-in customer, tagged with review status."""
    email = current["email"]
    cursor = db.orders.find(
        {"customer_email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}},
        {"_id": 0},
    ).sort("created_at", -1).limit(500)
    orders = await cursor.to_list(500)
    reviewed_ids: set = set()
    async for r in db.reviews.find({"customer_email": email}, {"_id": 0, "product_id": 1}):
        reviewed_ids.add(r.get("product_id"))
    for o in orders:
        pid = o.get("product_id")
        o["already_reviewed"] = bool(pid and pid in reviewed_ids)
        o["can_review"] = bool(pid) and (o.get("status") in {"paid", "processing", "shipped", "delivered", "completed"})
    return {"orders": orders, "total": len(orders)}


@api_router.post("/portal/reviews")
async def portal_create_review(body: PortalReviewBody, current: dict = Depends(get_current_customer)):
    if not (1 <= int(body.rating) <= 5):
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
    email = current["email"]
    order = await _has_purchased(email, body.product_id)
    if not order:
        raise HTTPException(
            status_code=403,
            detail="You can only review products you've purchased. No matching order found for this item.",
        )
    prior = await db.reviews.find_one({"product_id": body.product_id, "customer_email": email})
    if prior:
        raise HTTPException(status_code=409, detail="You've already reviewed this product — edit your existing review instead")
    r = Review(
        product_id=body.product_id,
        customer_name=current.get("name") or email.split("@")[0],
        customer_email=email,
        rating=int(body.rating),
        title=(body.title or "").strip()[:120],
        body=(body.body or "").strip()[:4000],
        status="approved",
        order_id=order.get("id"),
        verified_purchase=True,
    )
    await db.reviews.insert_one(r.model_dump())
    return _shape_review(r.model_dump())


@api_router.get("/portal/my-reviews")
async def portal_my_reviews(current: dict = Depends(get_current_customer)):
    email = current["email"]
    items = await db.reviews.find({"customer_email": email}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"reviews": [_shape_review(r) for r in items], "total": len(items)}


@api_router.post("/reviews/{rid}/vote")
async def review_vote(rid: str, body: PortalReviewVoteBody, current: dict = Depends(get_current_customer)):
    """Signed-in customers can mark a review as helpful / not-helpful / clear their vote."""
    email = current["email"]
    r = await db.reviews.find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Review not found")
    if r.get("customer_email") == email:
        raise HTTPException(status_code=400, detail="You can't vote on your own review")
    hv = [e for e in (r.get("helpful_votes") or []) if e != email]
    nv = [e for e in (r.get("not_helpful_votes") or []) if e != email]
    if body.vote == "helpful":
        hv.append(email)
    elif body.vote == "not_helpful":
        nv.append(email)
    elif body.vote == "clear":
        pass
    else:
        raise HTTPException(status_code=400, detail="vote must be 'helpful', 'not_helpful' or 'clear'")
    await db.reviews.update_one({"id": rid}, {"$set": {"helpful_votes": hv, "not_helpful_votes": nv}})
    updated = await db.reviews.find_one({"id": rid}, {"_id": 0})
    result = _shape_review(updated)
    result["my_vote"] = "helpful" if email in hv else ("not_helpful" if email in nv else None)
    return result


@api_router.get("/messages")
async def list_messages(status: Optional[str] = None):
    q = {"status": status} if status else {}
    items = await db.messages.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"messages": items, "total": len(items)}


@api_router.post("/messages", response_model=Message)
async def create_message(body: MessageBase):
    payload = body.model_dump()
    # Normalise email so the customer-profile thread lookup finds it.
    if payload.get("customer_email"):
        payload["customer_email"] = payload["customer_email"].strip().lower()
    m = Message(**payload)
    doc = m.model_dump()
    doc["direction"] = "inbound"
    await db.messages.insert_one(doc)
    return m


# ---------------------------------------------------------------------------
# Stock movements & product inventory helpers
# ---------------------------------------------------------------------------


@api_router.get("/stock/moves")
async def list_stock_moves(product_id: Optional[str] = None, limit: int = 200):
    q = {"product_id": product_id} if product_id else {}
    items = await db.stock_moves.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"moves": items, "total": len(items)}


@api_router.post("/stock/moves")
async def create_stock_move(body: StockMove):
    p = await db.products.find_one({"id": body.product_id}, {"_id": 0})
    if not p: raise HTTPException(status_code=404, detail="Product not found")
    move = body.model_dump()
    move["id"] = str(uuid.uuid4())
    move["created_at"] = datetime.now(timezone.utc).isoformat()
    move["stock_before"] = p.get("stock", 0)
    move["stock_after"] = p.get("stock", 0) + body.delta
    await db.stock_moves.insert_one(move)
    await db.products.update_one({"id": body.product_id}, {"$inc": {"stock": body.delta}, "$set": {"updated_at": move["created_at"]}})
    # If this adjustment brought stock to zero, quietly move the product to Archived.
    await _auto_archive_if_out_of_stock(body.product_id)
    move.pop("_id", None)
    return move


@api_router.get("/products/inventory-summary")
async def inventory_summary():
    total = await db.products.count_documents({})
    low = await db.products.count_documents({"stock": {"$gt": 0, "$lte": 3}})
    out = await db.products.count_documents({"stock": {"$lte": 0}})
    active = await db.products.count_documents({"active": True})
    total_stock = 0
    async for p in db.products.find({}, {"stock": 1}):
        total_stock += p.get("stock", 0)
    return {"total_products": total, "active": active, "low_stock": low, "out_of_stock": out, "total_units": total_stock}


# ---------------------------------------------------------------------------
# Suppliers (auto-derived eBay AU sellers)
# ---------------------------------------------------------------------------
# A "supplier" here is an eBay AU seller whose listing has been imported.
# The list is computed on-the-fly from the `items` collection (each scraped
# item's `seller` field), enriched with product & order counts and revenue.


@api_router.get("/suppliers")
async def list_suppliers(
    q: Optional[str] = None,
    status: Optional[str] = None,
    sort: str = "revenue_desc",
    limit: int = Query(500, le=1000),
    skip: int = Query(0, ge=0),
):
    sellers = await _build_sellers()
    if q:
        needle = q.lower()
        sellers = [s for s in sellers if needle in s["name"].lower() or needle in s["location"].lower()]
    if status in {"active", "inactive"}:
        sellers = [s for s in sellers if s["status"] == status]

    _SUP_SORT_FIELDS = {
        "name":              lambda s: (s.get("name") or "").lower(),
        "total_products":    lambda s: s.get("total_products") or 0,
        "total_orders":      lambda s: s.get("total_orders") or 0,
        "revenue_generated": lambda s: s.get("revenue_generated") or 0,
        "last_active":       lambda s: s.get("last_active") or "",
        "status":            lambda s: s.get("status") or "",
    }
    # Legacy compact keys used by the old dropdown still work.
    _LEGACY_SORT = {
        "revenue_desc":     ("revenue_generated", "desc"),
        "orders_desc":      ("total_orders", "desc"),
        "products_desc":    ("total_products", "desc"),
        "name_asc":         ("name", "asc"),
        "last_active_desc": ("last_active", "desc"),
    }
    if sort in _LEGACY_SORT:
        field, dir_ = _LEGACY_SORT[sort]
    else:
        field, _, dir_ = sort.rpartition("_")
        if field not in _SUP_SORT_FIELDS or dir_ not in ("asc", "desc"):
            field, dir_ = "revenue_generated", "desc"
    sellers.sort(key=_SUP_SORT_FIELDS[field], reverse=(dir_ == "desc"))

    total = len(sellers)
    sellers = sellers[skip: skip + limit]
    return {"suppliers": sellers, "total": total, "tags": []}


@api_router.get("/suppliers/summary")
async def suppliers_summary():
    sellers = await _build_sellers()
    active = sum(1 for s in sellers if s["status"] == "active")
    total_revenue = round(sum(s["revenue_generated"] for s in sellers), 2)
    total_orders = sum(s["total_orders"] for s in sellers)
    total_products = sum(s["total_products"] for s in sellers)
    top = sorted(sellers, key=lambda s: -s["revenue_generated"])[:5]
    return {
        "total": len(sellers),
        "active": active,
        "top_suppliers": top,
        "aggregate": {
            "total_revenue": total_revenue,
            "total_orders": total_orders,
            "total_products": total_products,
        },
    }


@api_router.get("/suppliers/{sid}")
async def get_supplier(sid: str):
    """Detail view for one supplier: seller stats + every product ever
    sourced from that seller.

    Products are matched by `products.source_item_id == items.item_id` (the
    eBay listing id), so we re-fetch items by seller name to collect their
    eBay ids instead of relying on the item uuids stored in `_build_sellers`.
    """
    sellers = await _build_sellers()
    seller = next((s for s in sellers if s["id"] == sid), None)
    if not seller:
        raise HTTPException(status_code=404, detail="Supplier not found")
    ebay_ids = await db.items.distinct("item_id", {"seller": seller["name"]})
    ebay_ids = [x for x in ebay_ids if x]
    products = []
    if ebay_ids:
        products = await db.products.find(
            {"source_item_id": {"$in": ebay_ids}, "archived": {"$ne": True}},
            {"_id": 0},
        ).sort("created_at", -1).to_list(length=1000)
    return {"supplier": seller, "products": products, "product_count": len(products)}


@api_router.delete("/suppliers/{sid}")
async def delete_supplier(sid: str):
    """Remove a supplier by wiping all scraped items with that seller name.

    Store products keep their rows (with the now-dangling `source_item_id`)
    so nothing on the storefront disappears without the admin's say-so —
    the front-end shows a warning with the linked-product count so they can
    confirm before pulling the trigger.
    """
    sellers = await _build_sellers()
    seller = next((s for s in sellers if s["id"] == sid), None)
    if not seller:
        raise HTTPException(status_code=404, detail="Supplier not found")
    res = await db.items.delete_many({"seller": seller["name"]})
    return {
        "ok": True,
        "deleted_items": int(res.deleted_count or 0),
        "linked_product_count": seller.get("linked_product_count", 0),
    }



# ---------------------------------------------------------------------------
# Notifications (price-change alerts)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Push channels (Email via Resend + Telegram)
# ---------------------------------------------------------------------------


@api_router.get("/push/settings")
async def get_push_settings():
    s = await _get_push_settings()
    channels = await _push_channel_status()
    # Mask secrets — never return raw keys to the client.
    return {
        "id": s["id"],
        "email_enabled": s["email_enabled"],
        "telegram_enabled": s["telegram_enabled"],
        "critical_only": s["critical_only"],
        "margin_drop_threshold_pp": s["margin_drop_threshold_pp"],
        # Non-secret fields returned as-is:
        "resend_to_email": s.get("resend_to_email") or "",
        "resend_from_email": s.get("resend_from_email") or "",
        "telegram_chat_id": s.get("telegram_chat_id") or "",
        # Secrets: mask + presence flags
        "resend_api_key_masked": _mask(s.get("resend_api_key") or ""),
        "resend_api_key_set": bool(s.get("resend_api_key")),
        "telegram_bot_token_masked": _mask(s.get("telegram_bot_token") or ""),
        "telegram_bot_token_set": bool(s.get("telegram_bot_token")),
        # Customer-facing transactional email toggles
        "customer_email_enabled": s.get("customer_email_enabled", True),
        "customer_order_confirmation": s.get("customer_order_confirmation", True),
        "customer_order_status_update": s.get("customer_order_status_update", True),
        "customer_order_cancellation": s.get("customer_order_cancellation", True),
        "customer_welcome_email": s.get("customer_welcome_email", True),
        "channels": channels,
    }


@api_router.patch("/push/settings")
async def update_push_settings(body: PushSettingsUpdate):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    # Empty string on a secret field means "keep existing value" (avoid accidental wipe).
    for secret in ("resend_api_key", "telegram_bot_token"):
        if secret in fields and fields[secret] == "":
            del fields[secret]
    if not fields:
        raise HTTPException(status_code=400, detail="No fields")
    await db.push_settings.update_one({"id": "singleton"}, {"$set": fields}, upsert=True)
    return await get_push_settings()


@api_router.post("/push/settings/clear-secret")
async def clear_push_secret(field: str):
    """Explicitly clear a stored secret from the database."""
    if field not in {"resend_api_key", "telegram_bot_token"}:
        raise HTTPException(status_code=400, detail="Unknown field")
    await db.push_settings.update_one({"id": "singleton"}, {"$set": {field: ""}}, upsert=True)
    return await get_push_settings()


@api_router.post("/push/test")
async def push_test():
    """Send a test push through configured channels."""
    n = {
        "type": "new_order",
        "title": "Test push",
        "body": "This is a test push from your PCAdmin dashboard.",
        "product_title": "Test Product",
        "data": {"customer_name": "Test Buyer", "total": 99.99, "quantity": 1},
        "at": datetime.now(timezone.utc).isoformat(),
    }
    subject, html, plain = _format_notification_html(n)
    ch = await _push_channel_status()
    results = {"email": None, "telegram": None, **ch}
    if ch["email_configured"]:
        await _send_email(subject, html); results["email"] = "sent"
    if ch["telegram_configured"]:
        await _send_telegram(plain); results["telegram"] = "sent"
    return results


@api_router.get("/notifications")
async def list_notifications(unread_only: bool = False, limit: int = Query(50, le=200)):
    q: dict = {}
    if unread_only:
        q["read"] = False
    cursor = db.notifications.find(q, {"_id": 0}).sort("at", -1).limit(limit)
    rows = await cursor.to_list(length=limit)
    unread = await db.notifications.count_documents({"read": False})
    return {"notifications": rows, "unread_count": unread, "total": await db.notifications.count_documents({})}


@api_router.post("/notifications/{nid}/read")
async def mark_notification_read(nid: str):
    r = await db.notifications.update_one({"id": nid}, {"$set": {"read": True}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@api_router.post("/notifications/mark-all-read")
async def mark_all_notifications_read():
    r = await db.notifications.update_many({"read": False}, {"$set": {"read": True}})
    return {"marked": r.modified_count}


# ---------------------------------------------------------------------------
# Pricing (rules-aware sell/profit + tier CRUD)
# ---------------------------------------------------------------------------


@api_router.get("/pricing-rules")
async def list_pricing_rules():
    cursor = db.pricing_rules.find({}, {"_id": 0}).sort("sort_order", 1)
    return {"rules": await cursor.to_list(500)}


@api_router.post("/pricing-rules")
async def create_pricing_rule(body: PricingRuleBase):
    if body.kind not in {"flat", "percent"}:
        raise HTTPException(status_code=400, detail="kind must be 'flat' or 'percent'")
    if body.max_price is not None and body.max_price <= body.min_price:
        raise HTTPException(status_code=400, detail="max_price must be greater than min_price (or empty for no upper bound)")
    rule = PricingRule(**body.model_dump())
    await db.pricing_rules.insert_one(rule.model_dump())
    return rule.model_dump()


@api_router.patch("/pricing-rules/{rid}")
async def update_pricing_rule(rid: str, body: PricingRuleUpdate):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if body.kind is not None and body.kind not in {"flat", "percent"}:
        raise HTTPException(status_code=400, detail="kind must be 'flat' or 'percent'")
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.pricing_rules.update_one({"id": rid}, {"$set": fields})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pricing rule not found")
    return await db.pricing_rules.find_one({"id": rid}, {"_id": 0})


@api_router.delete("/pricing-rules/{rid}")
async def delete_pricing_rule(rid: str):
    r = await db.pricing_rules.delete_one({"id": rid})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Pricing rule not found")
    return {"deleted": True}


@api_router.get("/pricing/calc")
async def pricing_calc(ebay_price: float):
    """Manual profit calculator: uses active pricing rules; falls back to 20% + $20."""
    rules = await _load_pricing_rules()
    return calc_pricing(ebay_price, rules=rules)


# ---------------------------------------------------------------------------
# Postage Presets (admin-managed shipping presets used on the Product page)
# ---------------------------------------------------------------------------


def _validate_postage_preset(kind: str, postage_amount: float, insurance_amount: float) -> None:
    if kind not in POSTAGE_PRESET_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {sorted(POSTAGE_PRESET_KINDS)}")
    if kind == "free" and postage_amount not in (0, 0.0):
        raise HTTPException(status_code=400, detail="'free' presets must have postage_amount = 0")
    if kind != "large_item" and insurance_amount not in (0, 0.0):
        raise HTTPException(status_code=400, detail="insurance_amount is only allowed on 'large_item' presets")
    if postage_amount < 0 or insurance_amount < 0:
        raise HTTPException(status_code=400, detail="Amounts must be zero or positive")


@api_router.get("/postage-presets")
async def list_postage_presets():
    cursor = db.postage_presets.find({}, {"_id": 0}).sort("sort_order", 1)
    return {"presets": await cursor.to_list(500)}


@api_router.post("/postage-presets")
async def create_postage_preset(body: PostagePresetBase):
    _validate_postage_preset(body.kind, body.postage_amount, body.insurance_amount)
    preset = PostagePreset(**body.model_dump())
    await db.postage_presets.insert_one(preset.model_dump())
    return preset.model_dump()


@api_router.patch("/postage-presets/{pid}")
async def update_postage_preset(pid: str, body: PostagePresetUpdate):
    existing = await db.postage_presets.find_one({"id": pid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Postage preset not found")
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    merged = {**existing, **fields}
    kind = merged.get("kind")
    # Auto-zero irrelevant amounts before validation so a caller can PATCH
    # just `kind` without also having to clear the old amounts by hand.
    if kind == "free":
        fields["postage_amount"] = 0.0
        fields["insurance_amount"] = 0.0
    elif kind != "large_item":
        fields["insurance_amount"] = 0.0
    merged = {**existing, **fields}
    _validate_postage_preset(
        merged.get("kind"),
        float(merged.get("postage_amount") or 0),
        float(merged.get("insurance_amount") or 0),
    )
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.postage_presets.update_one({"id": pid}, {"$set": fields})
    return await db.postage_presets.find_one({"id": pid}, {"_id": 0})


@api_router.delete("/postage-presets/{pid}")
async def delete_postage_preset(pid: str):
    r = await db.postage_presets.delete_one({"id": pid})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Postage preset not found")
    # Detach the deleted preset from any products that referenced it so the
    # dropdown falls back to "Not selected" instead of showing a dangling id.
    await db.products.update_many(
        {"postage_preset_id": pid},
        {"$set": {"postage_preset_id": None}},
    )
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Delivery Settings (store-wide default estimate window)
# The frontend computes the actual estimated date range each render so it
# auto-updates every day without any background job. Both values are in
# *business days* (weekends skipped).
# ---------------------------------------------------------------------------


def _validate_delivery_window(min_days: int, max_days: int) -> None:
    if min_days < 0 or max_days < 0:
        raise HTTPException(status_code=400, detail="Days must be zero or positive")
    if min_days > 365 or max_days > 365:
        raise HTTPException(status_code=400, detail="Days must be 365 or fewer")
    if max_days < min_days:
        raise HTTPException(status_code=400, detail="Max days must be greater than or equal to min days")


def _validate_cutoff_hhmm(hhmm: str) -> None:
    """Accepts "HH:MM" (24-hour). Empty / None allowed only when disabling."""
    import re as _re
    if not _re.match(r"^([01]?\d|2[0-3]):[0-5]\d$", hhmm or ""):
        raise HTTPException(status_code=400, detail="cutoff_hhmm must be 24-hour HH:MM (e.g. 14:00)")


@api_router.get("/delivery-settings")
async def get_delivery_settings():
    return await _get_delivery_settings()


@api_router.patch("/delivery-settings")
async def update_delivery_settings(body: DeliverySettingsUpdate):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    existing = await _get_delivery_settings()
    merged = {**existing, **fields}
    _validate_delivery_window(int(merged["default_min_days"]), int(merged["default_max_days"]))
    if "cutoff_hhmm" in fields:
        _validate_cutoff_hhmm(fields["cutoff_hhmm"])
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.delivery_settings.update_one({"id": "singleton"}, {"$set": fields}, upsert=True)
    return await _get_delivery_settings()


# ---------------------------------------------------------------------------
# Admin Accounts (Admin Settings › Accounts)
# ---------------------------------------------------------------------------


def _admin_row(doc: dict) -> dict:
    """Strip the password hash before shipping a row to the frontend."""
    return {k: v for k, v in (doc or {}).items() if k not in ("password_hash",)}


def _validate_admin_payload(email: str | None, role: str | None, password: str | None, *, require_password: bool) -> None:
    if email is not None:
        e = (email or "").strip().lower()
        if not e or "@" not in e or "." not in e.split("@", 1)[-1]:
            raise HTTPException(status_code=400, detail="Enter a valid email address")
    if role is not None and role not in ADMIN_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {list(ADMIN_ROLES)}")
    if require_password and not password:
        raise HTTPException(status_code=400, detail="Password is required")
    if password is not None and password != "" and len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")


@api_router.get("/admin-accounts")
async def list_admin_accounts():
    cursor = db.admin_accounts.find({}, {"_id": 0}).sort("is_main", -1)
    accounts = [_admin_row(d) async for d in cursor]
    return {"accounts": accounts}


@api_router.post("/admin-accounts")
async def create_admin_account(body: AdminAccountCreate):
    from helpers import _hash_password as hash_pw
    _validate_admin_payload(body.email, body.role, body.password, require_password=True)
    email = body.email.strip().lower()
    if await db.admin_accounts.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="An account with this email already exists")
    acct = AdminAccount(
        name=body.name.strip(),
        email=email,
        role=body.role,
        password_hash=hash_pw(body.password),
        is_main=False,
    )
    await db.admin_accounts.insert_one(acct.model_dump())
    return _admin_row(acct.model_dump())


@api_router.patch("/admin-accounts/{aid}")
async def update_admin_account(aid: str, body: AdminAccountUpdate):
    from helpers import _hash_password as hash_pw
    existing = await db.admin_accounts.find_one({"id": aid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Account not found")
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    _validate_admin_payload(fields.get("email"), fields.get("role"), fields.get("password"), require_password=False)
    # Protect the main admin: role can't be demoted to manager, otherwise the
    # dashboard could end up with zero admins.
    if existing.get("is_main") and fields.get("role") not in (None, "admin"):
        raise HTTPException(status_code=400, detail="The main admin must keep the admin role")
    if fields.get("email"):
        fields["email"] = fields["email"].strip().lower()
        clash = await db.admin_accounts.find_one({"email": fields["email"], "id": {"$ne": aid}})
        if clash:
            raise HTTPException(status_code=400, detail="Another account already uses this email")
    if fields.get("password"):
        fields["password_hash"] = hash_pw(fields["password"])
    fields.pop("password", None)
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.admin_accounts.update_one({"id": aid}, {"$set": fields})
    doc = await db.admin_accounts.find_one({"id": aid}, {"_id": 0})
    return _admin_row(doc)


@api_router.delete("/admin-accounts/{aid}")
async def delete_admin_account(aid: str):
    existing = await db.admin_accounts.find_one({"id": aid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Account not found")
    if existing.get("is_main"):
        raise HTTPException(status_code=400, detail="The main admin account cannot be deleted")
    await db.admin_accounts.delete_one({"id": aid})
    return {"deleted": True}


@api_router.post("/admin-accounts/login")
async def login_admin_account(body: dict = Body(...)):
    """Verify email + password against the admin_accounts collection.

    Returns the account row (no hash) on success so the frontend can drop it
    into its localStorage-based session. The old localStorage-only flow
    continues to work — this endpoint just gives us a proper password check
    for the new login screen.
    """
    from helpers import _verify_password
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required")
    doc = await db.admin_accounts.find_one({"email": email}, {"_id": 0})
    if not doc or not _verify_password(password, doc.get("password_hash", "")):
        # Same message either way so we don't leak whether the email exists.
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return _admin_row(doc)


# ---------------------------------------------------------------------------
# Backup — export/import full JSON dumps of the primary collections.
# Admin Settings › Backup uses these to let the store owner download a
# point-in-time snapshot or restore a previous one.
# ---------------------------------------------------------------------------
# Collections included in a backup. `admin_accounts` is intentionally
# excluded because it carries password hashes we don't want to move around
# in plain files; the frontend surfaces that in the UI.
BACKUP_COLLECTIONS = [
    "products", "orders", "customers", "customer_accounts",
    "categories", "suppliers", "reviews", "messages",
    "pricing_rules", "postage_presets", "delivery_settings",
    "settings", "coupons", "notifications", "transactions",
    "returns", "abandoned_carts",
]


@api_router.get("/backup/export")
async def backup_export():
    """Return a JSON snapshot of every collection the admin cares about."""
    data: dict = {}
    for name in BACKUP_COLLECTIONS:
        cursor = getattr(db, name).find({}, {"_id": 0})
        data[name] = await cursor.to_list(100000)
    return {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "collections": data,
        "counts": {k: len(v) for k, v in data.items()},
    }


@api_router.post("/backup/import")
async def backup_import(payload: dict = Body(...)):
    """Restore collections from a backup payload.

    The payload must match the shape returned by `/backup/export`. Each
    listed collection is fully replaced (delete + insert) — a partial
    import is intentionally not supported, so the admin gets a predictable
    all-or-nothing result. Unknown collections in the payload are ignored.
    """
    collections = payload.get("collections") or {}
    if not isinstance(collections, dict) or not collections:
        raise HTTPException(status_code=400, detail="Backup payload missing 'collections' object")
    restored: dict = {}
    for name, rows in collections.items():
        if name not in BACKUP_COLLECTIONS:
            continue
        if not isinstance(rows, list):
            raise HTTPException(status_code=400, detail=f"Collection '{name}' must be a list")
        coll = getattr(db, name)
        await coll.delete_many({})
        if rows:
            await coll.insert_many(rows)
        restored[name] = len(rows)
    return {"restored": restored, "restored_at": datetime.now(timezone.utc).isoformat()}



@api_router.post("/products/from-item/{item_id}")
async def create_product_from_item(item_id: str):
    it = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not it:
        raise HTTPException(status_code=404, detail="Scraped item not found")
    cost = it.get("price_value") or 0.0
    rules = await _load_pricing_rules()
    pricing = calc_pricing(cost, rules=rules)
    ebay_cat_slug = await _ensure_ebay_category(it.get("ebay_category_path") or [])
    prod = Product(
        title=it.get("title") or "Untitled",
        price=pricing["sell_price"],
        cost=cost,
        stock=10,
        category=ebay_cat_slug or it.get("category") or _guess_category(
            title=it.get("title") or "",
            breadcrumbs=it.get("ebay_category_path") or [],
            specifics=it.get("specifics") or {},
        ),
        description=it.get("description") or "",
        images=it.get("images") or [],
        source_url=it.get("url"),
        source_item_id=it.get("item_id"),
        sku=f"SKU-{(it.get('item_id') or uuid.uuid4().hex[:8])[-6:]}",
        variants=it.get("variants") or [],
        specifics=it.get("specifics") or {},
        postage=it.get("postage_display") or None,
        delivery_speed=it.get("delivery_speed") or None,
        delivery_date_range=it.get("delivery_date_range") or None,
    )
    prod.product_code = await _generate_unique_product_code(prod.title)
    # Auto-fill SEO fields from title/description; admin can edit later.
    for k, v in _default_seo(prod.title, prod.description or "", prod.category).items():
        setattr(prod, k, v)
    await db.products.insert_one(prod.model_dump())
    await db.items.update_one({"id": item_id}, {"$set": {"added_to_products": True}})
    return prod.model_dump()


@api_router.post("/products", response_model=Product)
async def create_product(body: ProductCreate):
    prod = Product(**body.model_dump())
    if not prod.product_code:
        prod.product_code = await _generate_unique_product_code(prod.title)
    # Auto-fill SEO fields when the caller hasn't supplied them.
    defaults = _default_seo(prod.title, prod.description or "", prod.category)
    for k, v in defaults.items():
        if not getattr(prod, k, None):
            setattr(prod, k, v)
    await db.products.insert_one(prod.model_dump())
    return prod


@api_router.get("/products")
async def list_products(
    q: Optional[str] = None,
    category: Optional[str] = None,
    active: Optional[bool] = None,
    archived: Optional[bool] = None,     # None → exclude archived; True → only archived; False → only unarchived
    stock: Optional[str] = None,         # None → any; "low" → 1..3; "out" → <=0
    countdown_status: Optional[str] = None,  # None → hide expired; "active" → running; "expired" → in Countdown section; "any" → include all
    sort: str = "created_at_desc",
    limit: int = Query(200, le=1000),
    skip: int = Query(0, ge=0),
):
    query: dict[str, Any] = {}
    if q:
        query["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"sku": {"$regex": q, "$options": "i"}},
            {"product_code": {"$regex": q, "$options": "i"}},
        ]
    if category:
        query["category"] = category
    if active is not None:
        query["active"] = active
    if archived is True:
        query["archived"] = True
    else:
        # Default (None) or False → hide archived from the main list
        query["archived"] = {"$ne": True}
    if stock == "low":
        query["stock"] = {"$gt": 0, "$lte": 3}
    elif stock == "out":
        query["stock"] = {"$lte": 0}
    # Countdown filter — default hides expired-countdown products from the
    # main Products list. The "Product Countdown" sidebar page passes
    # `countdown_status=expired`. Pass `any` to include everything.
    if countdown_status == "expired":
        query["countdown_expired"] = True
    elif countdown_status == "active":
        query["countdown_enabled"] = True
        query["countdown_expired"] = {"$ne": True}
    elif countdown_status == "any":
        pass  # no filter
    else:
        # Default: keep expired-countdown products out of the main list.
        query["countdown_expired"] = {"$ne": True}
    sort_map = {
        "created_at_desc": [("created_at", -1)],
        "created_at_asc": [("created_at", 1)],
        "price_desc": [("price", -1)],
        "price_asc": [("price", 1)],
        "stock_asc": [("stock", 1)],
        "sold_desc": [("sold_count", -1)],
    }
    cursor = db.products.find(query, {"_id": 0}).sort(sort_map.get(sort, [("created_at", -1)])).skip(skip).limit(limit)
    products = await cursor.to_list(length=limit)
    total = await db.products.count_documents(query)
    # Attach reviews aggregate (one aggregation, then join in Python — cheap for O(200) products).
    ids = [p["id"] for p in products]
    if ids:
        pipeline = [
            {"$match": {"product_id": {"$in": ids}, "status": "approved"}},
            {"$group": {"_id": "$product_id", "count": {"$sum": 1}, "avg": {"$avg": "$rating"}}},
        ]
        agg = await db.reviews.aggregate(pipeline).to_list(length=len(ids))
        by_id = {r["_id"]: r for r in agg}
        for p in products:
            row = by_id.get(p["id"])
            p["review_count"] = int(row["count"]) if row else 0
            p["average_rating"] = round(float(row["avg"]), 2) if row and row.get("avg") is not None else 0.0
    return {"products": products, "total": total}


@api_router.get("/search")
async def global_search(q: str = Query(..., min_length=1), limit: int = Query(15, le=50)):
    """Universal product-code / SKU / title / order-reference / order-id search."""
    q = q.strip()
    if not q:
        return {"products": [], "orders": []}
    prod_query = {"$or": [
        {"product_code": {"$regex": q, "$options": "i"}},
        {"sku": {"$regex": q, "$options": "i"}},
        {"title": {"$regex": q, "$options": "i"}},
    ]}
    products = await db.products.find(prod_query, {"_id": 0, "id": 1, "title": 1, "product_code": 1, "images": 1, "price": 1, "stock_status": 1, "archived": 1}).limit(limit).to_list(limit)
    ord_query = {"$or": [
        {"reference": {"$regex": q, "$options": "i"}},
        {"id": {"$regex": q, "$options": "i"}},
        {"customer_email": {"$regex": q, "$options": "i"}},
    ]}
    orders = await db.orders.find(ord_query, {"_id": 0, "id": 1, "reference": 1, "product_title": 1, "customer_name": 1, "total": 1, "status": 1, "created_at": 1}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"products": products, "orders": orders}


@api_router.post("/products/{pid}/archive")
async def archive_product(pid: str):
    now = datetime.now(timezone.utc).isoformat()
    r = await db.products.update_one(
        {"id": pid},
        {"$set": {"archived": True, "archived_at": now, "active": False, "updated_at": now}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return await db.products.find_one({"id": pid}, {"_id": 0})


@api_router.post("/products/{pid}/restore")
async def restore_product(pid: str):
    """Restore an archived product. Marks active=True only if the eBay listing is still live."""
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    now = datetime.now(timezone.utc).isoformat()
    still_live = (p.get("stock_status") or "live") == "live" and not p.get("is_sold")
    await db.products.update_one(
        {"id": pid},
        {"$set": {"archived": False, "archived_at": None, "active": bool(still_live), "updated_at": now}},
    )
    return await db.products.find_one({"id": pid}, {"_id": 0})


@api_router.post("/products/{pid}/refresh")
async def refresh_product_from_ebay(pid: str):
    """Re-scrape the linked eBay listing and mirror title / price / images / variants /
    stock_status onto this product. Requires source_url on the product."""
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    url = p.get("source_url")
    if not url:
        raise HTTPException(status_code=400, detail="This product isn't linked to an eBay URL — nothing to refresh.")
    try:
        validate_ebay_au_url(url)
        html = await fetch_html(url)
        data = await parse_and_enrich(html, url)
    except NotEbayAUError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except BlockedError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except ScrapeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    new_status = data.get("stock_status") or ("sold" if data.get("is_sold") else "live")
    now = datetime.now(timezone.utc).isoformat()
    is_dead = new_status != "live"
    update = {
        "title": data.get("title") or p.get("title"),
        "images": data.get("images") or p.get("images") or [],
        "variants": data.get("variants") or [],
        "cost": data.get("price_value") if data.get("price_value") is not None else p.get("cost"),
        "stock_status": new_status,
        "is_sold": is_dead,
        "active": p.get("active") if not is_dead else False,
        "description": data.get("description") or p.get("description"),
        "updated_at": now,
    }
    # When the listing has gone sold / ended / out-of-stock, force `stock: 0`
    # and archive the product so it lands in Products › Out of Stock.
    if is_dead:
        update["stock"] = 0
        update["archived"] = True
        update["archived_at"] = now
    await db.products.update_one({"id": pid}, {"$set": update})
    return await db.products.find_one({"id": pid}, {"_id": 0})


@api_router.post("/products/bulk-archive")
async def bulk_archive_products(body: BulkProductIds):
    if not body.product_ids:
        return {"archived": 0}
    now = datetime.now(timezone.utc).isoformat()
    r = await db.products.update_many(
        {"id": {"$in": body.product_ids}},
        {"$set": {"archived": True, "archived_at": now, "active": False, "updated_at": now}},
    )
    return {"archived": r.modified_count}


@api_router.post("/products/bulk-delete")
async def bulk_delete_products(body: BulkProductIds):
    if not body.product_ids:
        return {"deleted": 0, "removed_categories": []}
    # Capture the set of affected categories BEFORE the delete so we can
    # prune the ones that end up empty.
    affected = await db.products.find(
        {"id": {"$in": body.product_ids}},
        {"_id": 0, "category": 1},
    ).to_list(len(body.product_ids))
    slugs = list({(p or {}).get("category") for p in affected if (p or {}).get("category")})
    r = await db.products.delete_many({"id": {"$in": body.product_ids}})
    removed_categories = await _delete_categories_if_empty(slugs)
    return {"deleted": r.deleted_count, "removed_categories": removed_categories}


@api_router.post("/products/bulk-restore")
async def bulk_restore_products(body: BulkProductIds):
    """Move a set of archived products back to the active catalogue."""
    if not body.product_ids:
        return {"restored": 0}
    now = datetime.now(timezone.utc).isoformat()
    r = await db.products.update_many(
        {"id": {"$in": body.product_ids}},
        {"$set": {"archived": False, "active": True, "updated_at": now}, "$unset": {"archived_at": ""}},
    )
    return {"restored": r.modified_count}




@api_router.get("/products/{pid}")
async def get_product(pid: str):
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    # Attach live reviews aggregate for the product detail page.
    reviews = await db.reviews.find({"product_id": pid, "status": "approved"}, {"_id": 0}).sort("created_at", -1).to_list(200)
    ratings = [int(r.get("rating") or 0) for r in reviews if r.get("rating")]
    p["review_count"] = len(reviews)
    p["average_rating"] = round(sum(ratings) / len(ratings), 2) if ratings else 0.0
    return p


@api_router.patch("/products/{pid}")
async def update_product(pid: str, body: ProductUpdate):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    # Per-product custom delivery window: only validate when both bounds are
    # being set (or already set on the product), so partial patches don't
    # spuriously fail.
    if fields.get("custom_delivery_window") is True or "delivery_min_days" in fields or "delivery_max_days" in fields:
        existing = await db.products.find_one({"id": pid}, {"_id": 0, "delivery_min_days": 1, "delivery_max_days": 1}) or {}
        mn = fields.get("delivery_min_days", existing.get("delivery_min_days"))
        mx = fields.get("delivery_max_days", existing.get("delivery_max_days"))
        if mn is not None and mx is not None:
            _validate_delivery_window(int(mn), int(mx))
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.products.update_one({"id": pid}, {"$set": fields})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    # Admin may have just edited stock directly — auto-archive if it hit 0.
    if "stock" in fields:
        await _auto_archive_if_out_of_stock(pid)
    # Cap meta_description on write so no client can persist an over-long
    # value. Silent trim (frontend already exposes a counter) matches how
    # we handle URL slugs — never fail a save on cosmetic fields.
    if "meta_description" in fields and isinstance(fields["meta_description"], str) and len(fields["meta_description"]) > 160:
        await db.products.update_one({"id": pid}, {"$set": {"meta_description": fields["meta_description"][:160]}})
    # Normalise tags: lowercase, trim, drop blanks, dedupe (preserve order).
    # Written back only if the input was actually a list so PATCHes that don't
    # touch tags leave the stored value untouched.
    if "tags" in fields and isinstance(fields["tags"], list):
        seen: set = set()
        cleaned: list = []
        for t in fields["tags"]:
            s = str(t or "").strip().lower()
            if s and s not in seen:
                seen.add(s)
                cleaned.append(s)
        if cleaned != fields["tags"]:
            await db.products.update_one({"id": pid}, {"$set": {"tags": cleaned}})
    return await db.products.find_one({"id": pid}, {"_id": 0})


@api_router.delete("/products/{pid}")
async def delete_product(pid: str):
    # Capture the category slug before deletion so we can prune the
    # category record when this was the last product in it.
    existing = await db.products.find_one({"id": pid}, {"_id": 0, "category": 1})
    r = await db.products.delete_one({"id": pid})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    removed_categories = await _delete_categories_if_empty([(existing or {}).get("category")])
    return {"deleted": True, "removed_categories": removed_categories}


# ---------------------------------------------------------------------------
# Countdown sale — optional, per-product limited-time sale.
# ---------------------------------------------------------------------------
# Start:   POST /api/products/{pid}/countdown/start  {duration_days, sale_price}
# Stop:    POST /api/products/{pid}/countdown/stop   (admin cancellation)
# Expire:  automatic — the periodic sweep in `_expire_countdowns()` runs
#          every 60s and flips `countdown_expired=True` + `active=False`
#          on any product whose `countdown_ends_at <= now`.
# Restore: POST /api/products/{pid}/countdown/restore
#          clears every countdown field + re-activates the product so it
#          reappears in the main Products list.

@api_router.post("/products/{pid}/countdown/start")
async def countdown_start(pid: str, body: CountdownStart):
    """Kick off a limited-time sale. Overwrites any existing countdown
    (starting a new one on the same product is idempotent)."""
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    now = datetime.now(timezone.utc)
    ends = now + timedelta(days=body.duration_days)
    patch = {
        "countdown_enabled": True,
        "countdown_sale_price": round(float(body.sale_price), 2),
        "countdown_duration_days": int(body.duration_days),
        "countdown_started_at": now.isoformat(),
        "countdown_ends_at": ends.isoformat(),
        "countdown_expired": False,
        # If the product was previously auto-inactivated by an earlier
        # countdown, re-activate it now so the sale is actually visible.
        "active": True,
        "updated_at": now.isoformat(),
    }
    await db.products.update_one({"id": pid}, {"$set": patch})
    fresh = await db.products.find_one({"id": pid}, {"_id": 0})
    return fresh


@api_router.post("/products/{pid}/countdown/stop")
async def countdown_stop(pid: str):
    """Admin-initiated cancellation. Clears the countdown but keeps the
    product active — the "sale price" was never a persisted price."""
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    patch = {
        "countdown_enabled": False,
        "countdown_sale_price": None,
        "countdown_duration_days": None,
        "countdown_started_at": None,
        "countdown_ends_at": None,
        "countdown_expired": False,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.products.update_one({"id": pid}, {"$set": patch})
    fresh = await db.products.find_one({"id": pid}, {"_id": 0})
    return fresh


@api_router.post("/products/{pid}/countdown/restore")
async def countdown_restore(pid: str):
    """Move an expired-countdown product back into the main Products list.
    Clears every countdown field + sets `active=True` so it reappears
    everywhere. Idempotent: calling on a non-expired product simply resets
    the fields with no other side effect."""
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    patch = {
        "countdown_enabled": False,
        "countdown_sale_price": None,
        "countdown_duration_days": None,
        "countdown_started_at": None,
        "countdown_ends_at": None,
        "countdown_expired": False,
        "active": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.products.update_one({"id": pid}, {"$set": patch})
    fresh = await db.products.find_one({"id": pid}, {"_id": 0})
    return fresh


async def _expire_countdowns() -> int:
    """Move every product whose countdown has elapsed into the expired
    state (auto-inactivate + flag). Returns the number of products
    updated. Called from the scheduler + opportunistically from
    `list_products` so admins never see stale timers.

    Emits a `countdown_expired` notification per product so admins get an
    email / Telegram alert the moment a sale ends. `_push_notification`
    respects the admin's `push_settings` (channels + critical-only filter).
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    query = {
        "countdown_enabled": True,
        "countdown_expired": {"$ne": True},
        "countdown_ends_at": {"$lte": now_iso},
    }
    # Snapshot the docs BEFORE the update so we can build the notifications
    # without another round-trip. Cheap because the sweep only ever hits
    # products that just expired — usually a handful at most.
    to_expire = await db.products.find(
        query,
        {"_id": 0, "id": 1, "title": 1, "images": 1,
         "price": 1, "countdown_sale_price": 1, "countdown_ends_at": 1},
    ).to_list(500)
    if not to_expire:
        return 0
    r = await db.products.update_many(
        query,
        {"$set": {
            "countdown_expired": True,
            "active": False,
            "updated_at": now_iso,
        }},
    )
    if r.modified_count:
        logger.info("Expired %d countdown product(s)", r.modified_count)
    # Fire-and-forget notification per product. `_emit_notification`
    # persists to the notifications collection + pushes via email /
    # Telegram based on the admin's push_settings.
    for p in to_expire:
        title = p.get("title") or "Untitled product"
        sale = p.get("countdown_sale_price")
        original = p.get("price")
        body = f"{title} — countdown ended and it has been auto-inactivated."
        if sale is not None and original:
            body += f" Sale price was ${sale:.2f} (was ${original:.2f})."
        body += " Visit Products › Countdown to restore or delete it."
        await _emit_notification(
            type="countdown_expired",
            title="Countdown sale ended",
            body=body,
            product_id=p.get("id"),
            product_title=title,
            image=(p.get("images") or [None])[0],
            data={
                "sale_price": sale,
                "original_price": original,
                "ended_at": p.get("countdown_ends_at"),
                "auto_inactivated": True,
            },
        )
    return r.modified_count or 0


async def _countdown_sweep_loop():
    """Sixty-second background sweep that expires elapsed countdowns.
    Runs alongside the existing scraper scheduler. Kept simple — no
    exponential backoff or crash recovery because a missed sweep just
    means the expiry lands on the next cycle."""
    while True:
        try:
            await _expire_countdowns()
        except Exception:
            logger.exception("countdown sweep failed")
        await asyncio.sleep(60)


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------

@api_router.post("/orders")
async def create_order(body: OrderCreate):
    p = await db.products.find_one({"id": body.product_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    total = round((p.get("price") or 0) * body.quantity, 2)
    cost_total = round((p.get("cost") or 0) * body.quantity, 2)
    order = {
        "id": str(uuid.uuid4()),
        "reference": p.get("product_code"),
        "product_id": p["id"],
        "product_title": p.get("title"),
        "quantity": body.quantity,
        "unit_price": p.get("price"),
        "unit_cost": p.get("cost"),
        "total": total,
        "cost_total": cost_total,
        "profit": round(total - cost_total, 2),
        "customer_name": body.customer_name or "Guest",
        "customer_email": (body.customer_email or "").strip().lower() or None,
        "shipping_address": (body.shipping_address.model_dump() if body.shipping_address else None),
        "status": body.status,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.orders.insert_one(order)
    await db.products.update_one(
        {"id": p["id"]},
        {"$inc": {"sold_count": body.quantity, "stock": -body.quantity}},
    )
    # Notification: new order received
    await _emit_notification(
        type="new_order",
        title="New order received",
        body=f"{order['customer_name']} · ${total:.2f} · {order['product_title']}",
        order_id=order["id"],
        product_id=p["id"],
        product_title=order["product_title"],
        image=(p.get("images") or [None])[0],
        data={"customer_name": order["customer_name"], "total": total, "quantity": body.quantity},
    )
    # Low-stock check after decrement
    updated = await db.products.find_one({"id": p["id"]}, {"_id": 0, "stock": 1, "title": 1, "images": 1})
    if updated and (updated.get("stock") or 0) <= 3 and (updated.get("stock") or 0) > 0:
        await _emit_notification(
            type="low_stock",
            title="Product low on stock",
            body=f"{updated.get('title')} · {updated.get('stock')} left",
            product_id=p["id"],
            product_title=updated.get("title"),
            image=(updated.get("images") or [None])[0],
            data={"stock": updated.get("stock")},
        )
    # Auto-archive if this purchase pushed the product to zero stock.
    await _auto_archive_if_out_of_stock(p["id"])
    order.pop("_id", None)
    # Customer email: order confirmation (gated by customer_order_confirmation toggle)
    await send_customer_order_confirmation(order)
    return order


@api_router.get("/orders")
async def list_orders(
    limit: int = Query(200, le=1000),
    skip: int = Query(0, ge=0),
    status: Optional[str] = None,
    sort: str = "created_at_desc",
):
    q: dict[str, Any] = {}
    if status:
        q["status"] = status
    # Column-header sort keys: <field>_asc|<field>_desc. Whitelisted fields
    # match the visible Orders table columns.
    _ORDER_SORT_FIELDS = {"reference", "product_title", "customer_name", "quantity", "total", "status", "created_at"}
    field, _, dir_ = sort.rpartition("_")
    if field in _ORDER_SORT_FIELDS and dir_ in ("asc", "desc"):
        sort_spec = [(field, 1 if dir_ == "asc" else -1)]
    else:
        sort_spec = [("created_at", -1)]
    cursor = db.orders.find(q, {"_id": 0}).sort(sort_spec).skip(skip).limit(limit)
    orders = await cursor.to_list(length=limit)
    total = await db.orders.count_documents(q)
    return {"orders": orders, "total": total}


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------

@api_router.get("/analytics/overview")
async def analytics_overview():
    now = datetime.now(timezone.utc)
    year_start = datetime(now.year, 1, 1, tzinfo=timezone.utc).isoformat()
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc).isoformat()
    d7 = (now - timedelta(days=7)).isoformat()
    d30 = (now - timedelta(days=30)).isoformat()

    async def sum_range(since: Optional[str] = None) -> dict:
        match: dict[str, Any] = {"status": {"$ne": "cancelled"}}
        if since:
            match["created_at"] = {"$gte": since}
        pipeline = [
            {"$match": match},
            {"$group": {
                "_id": None,
                "revenue": {"$sum": "$total"},
                "cost": {"$sum": "$cost_total"},
                "profit": {"$sum": "$profit"},
                "units": {"$sum": "$quantity"},
                "orders": {"$sum": 1},
            }},
        ]
        res = await db.orders.aggregate(pipeline).to_list(1)
        if not res:
            return {"revenue": 0, "cost": 0, "profit": 0, "units": 0, "orders": 0}
        r = res[0]; r.pop("_id", None); return r

    all_time = await sum_range(None)
    ytd = await sum_range(year_start)
    mtd = await sum_range(month_start)
    last7 = await sum_range(d7)
    last30 = await sum_range(d30)

    total_products = await db.products.count_documents({})
    active_products = await db.products.count_documents({"active": True})
    low_stock = await db.products.count_documents({"stock": {"$lte": 3}})
    scraped_items = await db.items.count_documents({})

    # Sales by day for last 30 days
    daily_pipeline = [
        {"$match": {"status": {"$ne": "cancelled"}, "created_at": {"$gte": d30}}},
        {"$addFields": {"day": {"$substr": ["$created_at", 0, 10]}}},
        {"$group": {"_id": "$day", "revenue": {"$sum": "$total"}, "profit": {"$sum": "$profit"}, "orders": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    daily_raw = await db.orders.aggregate(daily_pipeline).to_list(100)
    # Fill missing days
    days_map = {d["_id"]: d for d in daily_raw}
    series = []
    for i in range(29, -1, -1):
        day = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        d = days_map.get(day, {"revenue": 0, "profit": 0, "orders": 0})
        series.append({"day": day, "revenue": round(d.get("revenue", 0), 2), "profit": round(d.get("profit", 0), 2), "orders": d.get("orders", 0)})

    # Category breakdown
    cat_pipeline = [
        {"$lookup": {"from": "products", "localField": "product_id", "foreignField": "id", "as": "p"}},
        {"$unwind": "$p"},
        {"$match": {"status": {"$ne": "cancelled"}}},
        {"$group": {"_id": "$p.category", "revenue": {"$sum": "$total"}, "units": {"$sum": "$quantity"}}},
        {"$sort": {"revenue": -1}},
    ]
    by_category = await db.orders.aggregate(cat_pipeline).to_list(20)
    by_category = [{"category": (c["_id"] or "other"), "revenue": round(c["revenue"], 2), "units": c["units"]} for c in by_category]

    # Top products
    top_pipeline = [
        {"$match": {"status": {"$ne": "cancelled"}}},
        {"$group": {"_id": "$product_id", "title": {"$first": "$product_title"}, "revenue": {"$sum": "$total"}, "units": {"$sum": "$quantity"}}},
        {"$sort": {"revenue": -1}},
        {"$limit": 5},
    ]
    top_products = await db.orders.aggregate(top_pipeline).to_list(5)
    top_products = [{"product_id": t["_id"], "title": t["title"], "revenue": round(t["revenue"], 2), "units": t["units"]} for t in top_products]

    recent = await db.orders.find({}, {"_id": 0}).sort("created_at", -1).limit(8).to_list(8)

    return {
        "all_time": all_time,
        "ytd": ytd,
        "mtd": mtd,
        "last7": last7,
        "last30": last30,
        "totals": {
            "products": total_products,
            "active_products": active_products,
            "low_stock": low_stock,
            "scraped_items": scraped_items,
        },
        "daily": series,
        "by_category": by_category,
        "top_products": top_products,
        "recent_orders": recent,
    }


@api_router.get("/analytics/revenue-detail")
async def analytics_revenue_detail():
    """Powers the Revenue YTD expand modal on the dashboard.

    Returns a bundle of "everything the admin needs to reason about their
    YTD revenue" in a single round-trip:
      • `monthly`             — revenue + orders for each month of the
        current calendar year (Jan → current month, zero-filled).
      • `top_products`        — up to 5 best sellers YTD, with title,
        image (first product image), units + revenue.
      • `orders_by_status`    — count of orders per status (all statuses
        represented, even zero-count ones).
      • `avg_order_value`     — YTD (excludes cancelled orders).
      • `total_revenue`       — YTD (matches the KPI card).
      • `total_orders`        — YTD (excludes cancelled).
      • `best_month`          — {month, revenue} — highest month so far,
        or None when there are no sales.
      • `last_year_comparison`— {revenue, orders, delta_pct} comparing the
        same Jan-1 → today-of-last-year window. `null` when no prior-year
        orders exist so the frontend can hide the panel gracefully.
    """
    now = datetime.now(timezone.utc)
    year = now.year
    year_start = datetime(year, 1, 1, tzinfo=timezone.utc).isoformat()
    now_iso = now.isoformat()

    # --- Monthly bar chart (Jan → current month, zero-filled) ------------
    monthly_pipeline = [
        {"$match": {
            "status": {"$ne": "cancelled"},
            "created_at": {"$gte": year_start, "$lte": now_iso},
        }},
        {"$addFields": {"month": {"$substr": ["$created_at", 0, 7]}}},  # "YYYY-MM"
        {"$group": {
            "_id": "$month",
            "revenue": {"$sum": "$total"},
            "orders":  {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]
    raw = await db.orders.aggregate(monthly_pipeline).to_list(24)
    monthly_map = {r["_id"]: r for r in raw}
    month_labels = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    monthly = []
    for m in range(1, now.month + 1):
        key = f"{year:04d}-{m:02d}"
        row = monthly_map.get(key, {"revenue": 0, "orders": 0})
        monthly.append({
            "month": month_labels[m - 1],
            "month_key": key,
            "revenue": round(row.get("revenue", 0) or 0, 2),
            "orders": row.get("orders", 0),
        })

    # --- Best month so far -------------------------------------------------
    best_month = None
    if monthly:
        top = max(monthly, key=lambda r: r["revenue"])
        if top["revenue"] > 0:
            best_month = {"month": top["month"], "month_key": top["month_key"], "revenue": top["revenue"]}

    # --- Top 5 products YTD (join for image) -------------------------------
    top_pipeline = [
        {"$match": {"status": {"$ne": "cancelled"}, "created_at": {"$gte": year_start}}},
        {"$group": {
            "_id": "$product_id",
            "title":   {"$first": "$product_title"},
            "revenue": {"$sum": "$total"},
            "units":   {"$sum": "$quantity"},
        }},
        {"$sort": {"revenue": -1}},
        {"$limit": 5},
        {"$lookup": {"from": "products", "localField": "_id",
                     "foreignField": "id", "as": "p"}},
    ]
    top_products = []
    for t in await db.orders.aggregate(top_pipeline).to_list(5):
        prod = (t.get("p") or [{}])[0]
        images = prod.get("images") or []
        top_products.append({
            "product_id": t["_id"],
            "title": t.get("title") or prod.get("title") or "Untitled",
            "image": images[0] if images else None,
            "revenue": round(t.get("revenue", 0) or 0, 2),
            "units": t.get("units", 0),
        })

    # --- Orders by status (YTD, includes cancelled so admin sees the churn) -
    status_pipeline = [
        {"$match": {"created_at": {"$gte": year_start}}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}, "revenue": {"$sum": "$total"}}},
    ]
    status_raw = await db.orders.aggregate(status_pipeline).to_list(20)
    status_map = {s["_id"]: s for s in status_raw}
    orders_by_status = []
    for st in ORDER_STATUSES:
        row = status_map.get(st, {"count": 0, "revenue": 0})
        orders_by_status.append({
            "status": st,
            "count": row.get("count", 0),
            "revenue": round(row.get("revenue", 0) or 0, 2),
        })

    # --- YTD totals for AOV + banner -------------------------------------
    ytd_totals = await db.orders.aggregate([
        {"$match": {"status": {"$ne": "cancelled"}, "created_at": {"$gte": year_start}}},
        {"$group": {"_id": None,
                    "revenue": {"$sum": "$total"},
                    "orders":  {"$sum": 1}}},
    ]).to_list(1)
    if ytd_totals:
        total_revenue = round(ytd_totals[0].get("revenue", 0) or 0, 2)
        total_orders  = ytd_totals[0].get("orders", 0)
    else:
        total_revenue = 0.0
        total_orders  = 0
    avg_order_value = round(total_revenue / total_orders, 2) if total_orders else 0.0

    # --- Same-period last year comparison --------------------------------
    ly_start = datetime(year - 1, 1, 1, tzinfo=timezone.utc).isoformat()
    ly_now = datetime(year - 1, now.month, now.day,
                      now.hour, now.minute, now.second,
                      tzinfo=timezone.utc).isoformat()
    ly_totals = await db.orders.aggregate([
        {"$match": {
            "status": {"$ne": "cancelled"},
            "created_at": {"$gte": ly_start, "$lte": ly_now},
        }},
        {"$group": {"_id": None,
                    "revenue": {"$sum": "$total"},
                    "orders":  {"$sum": 1}}},
    ]).to_list(1)
    last_year_comparison = None
    if ly_totals and (ly_totals[0].get("orders") or 0) > 0:
        ly_rev = round(ly_totals[0].get("revenue", 0) or 0, 2)
        ly_ord = ly_totals[0].get("orders", 0)
        delta_pct = round(((total_revenue - ly_rev) / ly_rev) * 100, 1) if ly_rev > 0 else 0.0
        last_year_comparison = {
            "revenue": ly_rev,
            "orders": ly_ord,
            "delta_pct": delta_pct,
        }

    return {
        "year": year,
        "as_of": now_iso,
        "total_revenue": total_revenue,
        "total_orders": total_orders,
        "avg_order_value": avg_order_value,
        "monthly": monthly,
        "top_products": top_products,
        "orders_by_status": orders_by_status,
        "best_month": best_month,
        "last_year_comparison": last_year_comparison,
    }


@api_router.get("/analytics/profit-detail")
async def analytics_profit_detail():
    """Powers the Profit YTD expand modal on the dashboard.

    Returns everything the profit deep-dive needs in a single round-trip:
      • `monthly[]`            — revenue + cost + profit + margin_pct per
        month (Jan → current month, zero-filled) for the bar chart and
        the line chart.
      • `top_products[]`       — top 5 YTD by margin_pct with product
        image, title, revenue, profit and margin_pct. Requires at least
        1 unit sold + revenue > 0 so we don't surface a "100% margin on
        $0 sold" row.
      • `category_margins[]`   — avg margin per category YTD (revenue /
        profit rolled up + margin_pct computed server-side).
      • `totals`               — {revenue, cost, profit, margin_pct} for
        the side-by-side summary panel.
      • `best_month` / `worst_month` — highest / lowest margin_pct month
        so far this year (only among months that actually had sales).
        `null` when there are no sales yet.
    """
    now = datetime.now(timezone.utc)
    year = now.year
    year_start = datetime(year, 1, 1, tzinfo=timezone.utc).isoformat()
    now_iso = now.isoformat()

    # --- Monthly revenue / cost / profit / margin ------------------------
    monthly_pipeline = [
        {"$match": {
            "status": {"$ne": "cancelled"},
            "created_at": {"$gte": year_start, "$lte": now_iso},
        }},
        {"$addFields": {"month": {"$substr": ["$created_at", 0, 7]}}},
        {"$group": {
            "_id": "$month",
            "revenue": {"$sum": "$total"},
            "cost":    {"$sum": "$cost_total"},
            "profit":  {"$sum": "$profit"},
            "orders":  {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]
    raw = await db.orders.aggregate(monthly_pipeline).to_list(24)
    monthly_map = {r["_id"]: r for r in raw}
    month_labels = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    monthly = []
    for m in range(1, now.month + 1):
        key = f"{year:04d}-{m:02d}"
        row = monthly_map.get(key, {"revenue": 0, "cost": 0, "profit": 0, "orders": 0})
        rev = row.get("revenue", 0) or 0
        prof = row.get("profit", 0) or 0
        margin_pct = round((prof / rev) * 100, 2) if rev > 0 else 0.0
        monthly.append({
            "month": month_labels[m - 1],
            "month_key": key,
            "revenue": round(rev, 2),
            "cost":    round(row.get("cost", 0) or 0, 2),
            "profit":  round(prof, 2),
            "orders":  row.get("orders", 0),
            "margin_pct": margin_pct,
        })

    # --- Best / worst margin month (only months with sales) --------------
    with_sales = [m for m in monthly if m["orders"] > 0]
    best_month = worst_month = None
    if with_sales:
        best = max(with_sales, key=lambda m: m["margin_pct"])
        worst = min(with_sales, key=lambda m: m["margin_pct"])
        best_month = {"month": best["month"], "month_key": best["month_key"],
                      "margin_pct": best["margin_pct"], "profit": best["profit"]}
        worst_month = {"month": worst["month"], "month_key": worst["month_key"],
                       "margin_pct": worst["margin_pct"], "profit": worst["profit"]}

    # --- Top 5 products by margin_pct YTD --------------------------------
    top_pipeline = [
        {"$match": {"status": {"$ne": "cancelled"}, "created_at": {"$gte": year_start}}},
        {"$group": {
            "_id": "$product_id",
            "title":   {"$first": "$product_title"},
            "revenue": {"$sum": "$total"},
            "profit":  {"$sum": "$profit"},
            "units":   {"$sum": "$quantity"},
        }},
        # Require real sales so a $0 revenue row doesn't slip in.
        {"$match": {"revenue": {"$gt": 0}, "units": {"$gt": 0}}},
        {"$addFields": {"margin_pct": {"$multiply": [{"$divide": ["$profit", "$revenue"]}, 100]}}},
        {"$sort": {"margin_pct": -1}},
        {"$limit": 5},
        {"$lookup": {"from": "products", "localField": "_id",
                     "foreignField": "id", "as": "p"}},
    ]
    top_products = []
    for t in await db.orders.aggregate(top_pipeline).to_list(5):
        prod = (t.get("p") or [{}])[0]
        images = prod.get("images") or []
        top_products.append({
            "product_id": t["_id"],
            "title": t.get("title") or prod.get("title") or "Untitled",
            "image": images[0] if images else None,
            "revenue": round(t.get("revenue", 0) or 0, 2),
            "profit":  round(t.get("profit", 0) or 0, 2),
            "units":   t.get("units", 0),
            "margin_pct": round(t.get("margin_pct", 0) or 0, 2),
        })

    # --- Category margins YTD --------------------------------------------
    cat_pipeline = [
        {"$lookup": {"from": "products", "localField": "product_id",
                     "foreignField": "id", "as": "p"}},
        {"$unwind": "$p"},
        {"$match": {"status": {"$ne": "cancelled"}, "created_at": {"$gte": year_start}}},
        {"$group": {
            "_id": "$p.category",
            "revenue": {"$sum": "$total"},
            "profit":  {"$sum": "$profit"},
            "units":   {"$sum": "$quantity"},
        }},
        {"$match": {"revenue": {"$gt": 0}}},
        {"$sort": {"profit": -1}},
    ]
    category_margins = []
    for c in await db.orders.aggregate(cat_pipeline).to_list(50):
        rev = c.get("revenue", 0) or 0
        prof = c.get("profit", 0) or 0
        category_margins.append({
            "category": c["_id"] or "other",
            "revenue": round(rev, 2),
            "profit":  round(prof, 2),
            "units":   c.get("units", 0),
            "margin_pct": round((prof / rev) * 100, 2) if rev > 0 else 0.0,
        })

    # --- Totals for side-by-side summary panel ---------------------------
    ytd_totals = await db.orders.aggregate([
        {"$match": {"status": {"$ne": "cancelled"}, "created_at": {"$gte": year_start}}},
        {"$group": {"_id": None,
                    "revenue": {"$sum": "$total"},
                    "cost":    {"$sum": "$cost_total"},
                    "profit":  {"$sum": "$profit"}}},
    ]).to_list(1)
    if ytd_totals:
        totals = {
            "revenue": round(ytd_totals[0].get("revenue", 0) or 0, 2),
            "cost":    round(ytd_totals[0].get("cost", 0) or 0, 2),
            "profit":  round(ytd_totals[0].get("profit", 0) or 0, 2),
        }
    else:
        totals = {"revenue": 0.0, "cost": 0.0, "profit": 0.0}
    totals["margin_pct"] = (
        round((totals["profit"] / totals["revenue"]) * 100, 2)
        if totals["revenue"] > 0 else 0.0
    )

    return {
        "year": year,
        "as_of": now_iso,
        "totals": totals,
        "monthly": monthly,
        "top_products": top_products,
        "category_margins": category_margins,
        "best_month": best_month,
        "worst_month": worst_month,
    }


@api_router.get("/analytics/units-detail")
async def analytics_units_detail():
    """Powers the Units Sold expand modal on the dashboard.

    Returns everything the units deep-dive needs in one round-trip:
      • `total_units`, `total_orders`, `avg_per_order`
      • `avg_per_day`, `avg_per_month` — YTD averages (days elapsed +
        months elapsed calculated from `now`)
      • `monthly[]`             — units + orders per month (Jan → current
        month, zero-filled) for the bar chart
      • `top_products[]`        — top 5 YTD by units with image / title /
        units / revenue
      • `by_category[]`         — units per category (sorted desc) for
        the horizontal-bar visualisation
      • `best_month`            — highest-units month so far (or null
        when no sales)
      • `last_year_comparison`  — same-period-last-year `{units, orders,
        delta_pct}` or null when no prior-year sales
    """
    now = datetime.now(timezone.utc)
    year = now.year
    year_start = datetime(year, 1, 1, tzinfo=timezone.utc).isoformat()
    now_iso = now.isoformat()

    # --- Monthly units series --------------------------------------------
    monthly_pipeline = [
        {"$match": {
            "status": {"$ne": "cancelled"},
            "created_at": {"$gte": year_start, "$lte": now_iso},
        }},
        {"$addFields": {"month": {"$substr": ["$created_at", 0, 7]}}},
        {"$group": {
            "_id": "$month",
            "units":  {"$sum": "$quantity"},
            "orders": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]
    raw = await db.orders.aggregate(monthly_pipeline).to_list(24)
    monthly_map = {r["_id"]: r for r in raw}
    month_labels = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    monthly = []
    for m in range(1, now.month + 1):
        key = f"{year:04d}-{m:02d}"
        row = monthly_map.get(key, {"units": 0, "orders": 0})
        monthly.append({
            "month": month_labels[m - 1],
            "month_key": key,
            "units": row.get("units", 0) or 0,
            "orders": row.get("orders", 0) or 0,
        })

    # --- Best month by units ---------------------------------------------
    best_month = None
    with_sales = [m for m in monthly if m["units"] > 0]
    if with_sales:
        b = max(with_sales, key=lambda m: m["units"])
        best_month = {"month": b["month"], "month_key": b["month_key"],
                      "units": b["units"], "orders": b["orders"]}

    # --- Top 5 products by units ------------------------------------------
    top_pipeline = [
        {"$match": {"status": {"$ne": "cancelled"}, "created_at": {"$gte": year_start}}},
        {"$group": {
            "_id": "$product_id",
            "title":   {"$first": "$product_title"},
            "units":   {"$sum": "$quantity"},
            "revenue": {"$sum": "$total"},
        }},
        {"$match": {"units": {"$gt": 0}}},
        {"$sort": {"units": -1}},
        {"$limit": 5},
        {"$lookup": {"from": "products", "localField": "_id",
                     "foreignField": "id", "as": "p"}},
    ]
    top_products = []
    for t in await db.orders.aggregate(top_pipeline).to_list(5):
        prod = (t.get("p") or [{}])[0]
        images = prod.get("images") or []
        top_products.append({
            "product_id": t["_id"],
            "title": t.get("title") or prod.get("title") or "Untitled",
            "image": images[0] if images else None,
            "units":   t.get("units", 0),
            "revenue": round(t.get("revenue", 0) or 0, 2),
        })

    # --- Units by category -----------------------------------------------
    cat_pipeline = [
        {"$lookup": {"from": "products", "localField": "product_id",
                     "foreignField": "id", "as": "p"}},
        {"$unwind": "$p"},
        {"$match": {"status": {"$ne": "cancelled"}, "created_at": {"$gte": year_start}}},
        {"$group": {
            "_id": "$p.category",
            "units":   {"$sum": "$quantity"},
            "revenue": {"$sum": "$total"},
            "orders":  {"$sum": 1},
        }},
        {"$match": {"units": {"$gt": 0}}},
        {"$sort": {"units": -1}},
    ]
    by_category = []
    for c in await db.orders.aggregate(cat_pipeline).to_list(50):
        by_category.append({
            "category": c["_id"] or "other",
            "units":   c.get("units", 0),
            "orders":  c.get("orders", 0),
            "revenue": round(c.get("revenue", 0) or 0, 2),
        })

    # --- YTD totals + per-day / per-month averages -----------------------
    ytd_totals = await db.orders.aggregate([
        {"$match": {"status": {"$ne": "cancelled"}, "created_at": {"$gte": year_start}}},
        {"$group": {"_id": None,
                    "units":  {"$sum": "$quantity"},
                    "orders": {"$sum": 1}}},
    ]).to_list(1)
    total_units = ytd_totals[0].get("units", 0) if ytd_totals else 0
    total_orders = ytd_totals[0].get("orders", 0) if ytd_totals else 0
    avg_per_order = round(total_units / total_orders, 2) if total_orders else 0.0
    # Days elapsed = full days since Jan 1 UTC (min 1 so we never divide
    # by zero on Jan 1 itself). Months elapsed = current month number (Jan=1).
    year_start_dt = datetime(year, 1, 1, tzinfo=timezone.utc)
    days_elapsed = max(1, (now - year_start_dt).days + 1)
    months_elapsed = max(1, now.month)
    avg_per_day = round(total_units / days_elapsed, 2) if total_units else 0.0
    avg_per_month = round(total_units / months_elapsed, 2) if total_units else 0.0

    # --- Same-period last year comparison --------------------------------
    ly_start = datetime(year - 1, 1, 1, tzinfo=timezone.utc).isoformat()
    ly_now = datetime(year - 1, now.month, now.day,
                      now.hour, now.minute, now.second,
                      tzinfo=timezone.utc).isoformat()
    ly_totals = await db.orders.aggregate([
        {"$match": {
            "status": {"$ne": "cancelled"},
            "created_at": {"$gte": ly_start, "$lte": ly_now},
        }},
        {"$group": {"_id": None,
                    "units":  {"$sum": "$quantity"},
                    "orders": {"$sum": 1}}},
    ]).to_list(1)
    last_year_comparison = None
    if ly_totals and (ly_totals[0].get("units") or 0) > 0:
        ly_units = ly_totals[0].get("units", 0) or 0
        ly_orders = ly_totals[0].get("orders", 0) or 0
        delta_pct = round(((total_units - ly_units) / ly_units) * 100, 1) if ly_units > 0 else 0.0
        last_year_comparison = {
            "units": ly_units,
            "orders": ly_orders,
            "delta_pct": delta_pct,
        }

    return {
        "year": year,
        "as_of": now_iso,
        "total_units": total_units,
        "total_orders": total_orders,
        "avg_per_order": avg_per_order,
        "avg_per_day": avg_per_day,
        "avg_per_month": avg_per_month,
        "monthly": monthly,
        "top_products": top_products,
        "by_category": by_category,
        "best_month": best_month,
        "last_year_comparison": last_year_comparison,
    }


@api_router.get("/analytics/aov-detail")
async def analytics_aov_detail():
    """Powers the Avg Order Value expand modal on the dashboard.

    Returns everything the AOV deep-dive needs in one round-trip:
      • `total_revenue`, `total_orders`, `avg_order_value`
      • `monthly[]`             — AOV + revenue + orders per month (Jan
        → current, zero-filled). Margin math for the line chart is done
        server-side (`revenue / orders`).
      • `distribution[]`        — buckets `$0–50 / $50–100 / $100–250 /
        $250–500 / $500+` with count + revenue per bucket.
      • `top_orders[]`          — top 5 highest-total orders YTD with
        `id`, `product_title`, `customer_name`, `total`, `created_at`.
      • `by_category[]`         — AOV per category (revenue / orders),
        sorted by AOV desc.
      • `best_month` / `worst_month` — highest / lowest AOV month (only
        months with orders). `null` when there are no sales yet.
    """
    now = datetime.now(timezone.utc)
    year = now.year
    year_start = datetime(year, 1, 1, tzinfo=timezone.utc).isoformat()
    now_iso = now.isoformat()

    # --- Monthly AOV series ----------------------------------------------
    monthly_pipeline = [
        {"$match": {
            "status": {"$ne": "cancelled"},
            "created_at": {"$gte": year_start, "$lte": now_iso},
        }},
        {"$addFields": {"month": {"$substr": ["$created_at", 0, 7]}}},
        {"$group": {
            "_id": "$month",
            "revenue": {"$sum": "$total"},
            "orders":  {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]
    raw = await db.orders.aggregate(monthly_pipeline).to_list(24)
    monthly_map = {r["_id"]: r for r in raw}
    month_labels = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    monthly = []
    for m in range(1, now.month + 1):
        key = f"{year:04d}-{m:02d}"
        row = monthly_map.get(key, {"revenue": 0, "orders": 0})
        orders = row.get("orders", 0) or 0
        revenue = row.get("revenue", 0) or 0
        aov = round(revenue / orders, 2) if orders > 0 else 0.0
        monthly.append({
            "month": month_labels[m - 1],
            "month_key": key,
            "revenue": round(revenue, 2),
            "orders": orders,
            "aov": aov,
        })

    # --- Best / worst AOV month (only months with orders) ----------------
    best_month = worst_month = None
    with_sales = [m for m in monthly if m["orders"] > 0]
    if with_sales:
        b = max(with_sales, key=lambda m: m["aov"])
        w = min(with_sales, key=lambda m: m["aov"])
        best_month = {"month": b["month"], "month_key": b["month_key"], "aov": b["aov"], "orders": b["orders"]}
        worst_month = {"month": w["month"], "month_key": w["month_key"], "aov": w["aov"], "orders": w["orders"]}

    # --- Order-size distribution -----------------------------------------
    # Buckets are inclusive of the lower bound, exclusive of the upper.
    # The $500+ bucket is open-ended.
    BUCKETS = [
        ("$0 – $50",     0,   50),
        ("$50 – $100",   50,  100),
        ("$100 – $250",  100, 250),
        ("$250 – $500",  250, 500),
        ("$500+",        500, None),
    ]
    distribution = []
    for label, lo, hi in BUCKETS:
        rng = {"$gte": lo}
        if hi is not None:
            rng["$lt"] = hi
        agg = await db.orders.aggregate([
            {"$match": {
                "status": {"$ne": "cancelled"},
                "created_at": {"$gte": year_start},
                "total": rng,
            }},
            {"$group": {"_id": None, "count": {"$sum": 1},
                        "revenue": {"$sum": "$total"}}},
        ]).to_list(1)
        row = agg[0] if agg else {"count": 0, "revenue": 0}
        distribution.append({
            "label": label,
            "min": lo,
            "max": hi,
            "count": row.get("count", 0),
            "revenue": round(row.get("revenue", 0) or 0, 2),
        })

    # --- Top 5 highest-total orders --------------------------------------
    top_orders_raw = await db.orders.find(
        {"status": {"$ne": "cancelled"}, "created_at": {"$gte": year_start}},
        {"_id": 0, "id": 1, "product_title": 1, "customer_name": 1,
         "total": 1, "created_at": 1, "product_id": 1},
    ).sort("total", -1).limit(5).to_list(5)
    top_orders = [
        {
            "id": o.get("id"),
            "product_id": o.get("product_id"),
            "product_title": o.get("product_title") or "Untitled",
            "customer_name": o.get("customer_name") or "—",
            "total": round(o.get("total", 0) or 0, 2),
            "created_at": o.get("created_at"),
        }
        for o in top_orders_raw
    ]

    # --- AOV per category ------------------------------------------------
    cat_pipeline = [
        {"$lookup": {"from": "products", "localField": "product_id",
                     "foreignField": "id", "as": "p"}},
        {"$unwind": "$p"},
        {"$match": {"status": {"$ne": "cancelled"}, "created_at": {"$gte": year_start}}},
        {"$group": {
            "_id": "$p.category",
            "revenue": {"$sum": "$total"},
            "orders":  {"$sum": 1},
        }},
        {"$match": {"orders": {"$gt": 0}}},
        {"$addFields": {"aov": {"$divide": ["$revenue", "$orders"]}}},
        {"$sort": {"aov": -1}},
    ]
    by_category = []
    for c in await db.orders.aggregate(cat_pipeline).to_list(50):
        by_category.append({
            "category": c["_id"] or "other",
            "revenue": round(c.get("revenue", 0) or 0, 2),
            "orders":  c.get("orders", 0),
            "aov": round(c.get("aov", 0) or 0, 2),
        })

    # --- YTD totals -------------------------------------------------------
    ytd_totals = await db.orders.aggregate([
        {"$match": {"status": {"$ne": "cancelled"}, "created_at": {"$gte": year_start}}},
        {"$group": {"_id": None,
                    "revenue": {"$sum": "$total"},
                    "orders":  {"$sum": 1}}},
    ]).to_list(1)
    total_revenue = round(ytd_totals[0].get("revenue", 0) or 0, 2) if ytd_totals else 0.0
    total_orders  = ytd_totals[0].get("orders", 0) if ytd_totals else 0
    avg_order_value = round(total_revenue / total_orders, 2) if total_orders else 0.0

    return {
        "year": year,
        "as_of": now_iso,
        "total_revenue": total_revenue,
        "total_orders": total_orders,
        "avg_order_value": avg_order_value,
        "monthly": monthly,
        "distribution": distribution,
        "top_orders": top_orders,
        "by_category": by_category,
        "best_month": best_month,
        "worst_month": worst_month,
    }


@api_router.get("/analytics/report")
async def analytics_report():
    """Deeper reporting: top sellers, margin trend, category perf, best margin products."""
    now = datetime.now(timezone.utc)
    d30 = (now - timedelta(days=30)).isoformat()

    # --- Top 5 suppliers by revenue_generated (reuses seller derivation)
    sellers = await _build_sellers()
    top_suppliers = sorted(sellers, key=lambda s: -s["revenue_generated"])[:5]

    # --- Margin trend over last 30 days (per-day margin %)
    daily_pipeline = [
        {"$match": {"status": {"$ne": "cancelled"}, "created_at": {"$gte": d30}}},
        {"$addFields": {"day": {"$substr": ["$created_at", 0, 10]}}},
        {"$group": {"_id": "$day",
                    "revenue": {"$sum": "$total"},
                    "profit":  {"$sum": "$profit"},
                    "orders":  {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    daily_raw = await db.orders.aggregate(daily_pipeline).to_list(100)
    day_map = {d["_id"]: d for d in daily_raw}
    margin_trend = []
    for i in range(29, -1, -1):
        day = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        d = day_map.get(day, {"revenue": 0, "profit": 0, "orders": 0})
        rev = d.get("revenue", 0) or 0
        prof = d.get("profit", 0) or 0
        margin_pct = round((prof / rev) * 100, 2) if rev > 0 else 0.0
        margin_trend.append({
            "day": day,
            "margin_pct": margin_pct,
            "revenue": round(rev, 2),
            "profit": round(prof, 2),
        })

    # --- Category performance: revenue + profit per category
    cat_pipeline = [
        {"$lookup": {"from": "products", "localField": "product_id",
                     "foreignField": "id", "as": "p"}},
        {"$unwind": "$p"},
        {"$match": {"status": {"$ne": "cancelled"}}},
        {"$group": {"_id": "$p.category",
                    "revenue": {"$sum": "$total"},
                    "profit":  {"$sum": "$profit"},
                    "units":   {"$sum": "$quantity"}}},
        {"$sort": {"revenue": -1}},
    ]
    cat_raw = await db.orders.aggregate(cat_pipeline).to_list(50)
    category_performance = []
    for c in cat_raw:
        rev = c.get("revenue", 0) or 0
        prof = c.get("profit", 0) or 0
        category_performance.append({
            "category": c["_id"] or "other",
            "revenue": round(rev, 2),
            "profit": round(prof, 2),
            "margin_pct": round((prof / rev) * 100, 2) if rev > 0 else 0.0,
            "units": c.get("units", 0),
        })

    # --- Best margin products (need sold_count > 0 and price > 0)
    products = await db.products.find(
        {"sold_count": {"$gt": 0}, "price": {"$gt": 0}}, {"_id": 0}
    ).to_list(1000)
    best_margin = []
    for p in products:
        price = float(p.get("price") or 0)
        cost = float(p.get("cost") or 0)
        if price <= 0:
            continue
        margin_pct = round(((price - cost) / price) * 100, 2)
        best_margin.append({
            "product_id": p.get("id"),
            "title": p.get("title"),
            "buy_price": round(cost, 2),
            "sell_price": round(price, 2),
            "margin_pct": margin_pct,
            "units_sold": int(p.get("sold_count") or 0),
        })
    best_margin.sort(key=lambda x: -x["margin_pct"])
    best_margin = best_margin[:20]

    return {
        "top_suppliers": top_suppliers,
        "margin_trend": margin_trend,
        "category_performance": category_performance,
        "best_margin_products": best_margin,
    }


# ---------------------------------------------------------------------------
# Demo seed - creates realistic-looking orders for products so analytics is populated
# ---------------------------------------------------------------------------

@api_router.post("/demo/seed")
async def demo_seed(reset: bool = False):
    if reset:
        await db.orders.delete_many({})
        await db.products.update_many({}, {"$set": {"sold_count": 0}})

    products = await db.products.find({}, {"_id": 0}).to_list(500)
    if not products:
        # Create some seed products so the dashboard isn't empty
        seed = [
            {"title": "AU Wireless Noise-Cancelling Headphones", "price": 249.0, "cost": 132.0, "stock": 42, "category": "electronics"},
            {"title": "4K Smart TV 55\" — Aussie Edition",       "price": 899.0, "cost": 610.0, "stock": 12, "category": "electronics"},
            {"title": "Cordless Impact Drill 18V Kit",           "price": 189.0, "cost": 92.0,  "stock": 26, "category": "tools"},
            {"title": "Robot Vacuum Cleaner Home Pro",           "price": 429.0, "cost": 210.0, "stock": 8,  "category": "home"},
            {"title": "Espresso Coffee Machine Barista",         "price": 549.0, "cost": 320.0, "stock": 3,  "category": "home"},
            {"title": "Mechanical Keyboard RGB Hot-Swap",        "price": 159.0, "cost": 72.0,  "stock": 55, "category": "electronics"},
            {"title": "Angle Grinder 125mm 900W",                "price": 89.0,  "cost": 41.0,  "stock": 34, "category": "tools"},
            {"title": "Ergonomic Office Chair Mesh",             "price": 319.0, "cost": 180.0, "stock": 15, "category": "home"},
        ]
        placeholder_img = "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?crop=entropy&cs=srgb&fm=jpg&w=800&q=75"
        for i, s in enumerate(seed):
            prod = Product(
                **s,
                description=f"Seeded demo product for the admin dashboard: {s['title']}.",
                images=[placeholder_img],
                sku=f"SEED-{1000+i}",
            )
            await db.products.insert_one(prod.model_dump())
        products = await db.products.find({}, {"_id": 0}).to_list(500)

    # Reset sold counts to be recomputed
    now = datetime.now(timezone.utc)
    rng = random.Random(42)
    order_docs = []
    for days_back in range(120, -1, -1):
        day = now - timedelta(days=days_back)
        # Ramp up recent activity
        base = 1 + (120 - days_back) // 20
        n_orders = rng.randint(base, base + 6)
        for _ in range(n_orders):
            p = rng.choice(products)
            qty = rng.choices([1, 1, 1, 2, 3], weights=[6, 4, 3, 2, 1])[0]
            hour = rng.randint(8, 22)
            minute = rng.randint(0, 59)
            created = day.replace(hour=hour, minute=minute, second=rng.randint(0, 59), microsecond=0)
            total = round((p.get("price") or 0) * qty, 2)
            cost_total = round((p.get("cost") or 0) * qty, 2)
            first_names = ["Liam", "Noah", "Olivia", "Emma", "Chloe", "Jack", "Ava", "Charlie", "Mia", "Ethan", "Zoe", "Lucas", "Amelia", "Oliver", "Isla"]
            last_names = ["Nguyen", "Smith", "Wilson", "Brown", "Taylor", "Anderson", "Thomas", "Walker", "White", "Harris", "Martin", "Thompson"]
            name = f"{rng.choice(first_names)} {rng.choice(last_names)}"
            status = rng.choices(["new", "pending", "processing", "ready_to_ship", "shipped", "delivered", "cancelled"], weights=[2, 2, 3, 2, 4, 8, 1])[0]
            order = {
                "id": str(uuid.uuid4()),
                "product_id": p["id"],
                "product_title": p.get("title"),
                "quantity": qty,
                "unit_price": p.get("price"),
                "unit_cost": p.get("cost"),
                "total": total,
                "cost_total": cost_total,
                "profit": round(total - cost_total, 2),
                "customer_name": name,
                "customer_email": f"{name.split()[0].lower()}.{name.split()[1].lower()}@example.com",
                "shipping_address": _rand_au_address(rng, name),
                "status": status,
                "created_at": created.replace(tzinfo=timezone.utc).isoformat(),
            }
            order_docs.append(order)

    if order_docs:
        await db.orders.insert_many(order_docs)

    # Recompute sold_count per product
    counts_pipeline = [
        {"$match": {"status": {"$ne": "cancelled"}}},
        {"$group": {"_id": "$product_id", "sold": {"$sum": "$quantity"}}},
    ]
    counts = await db.orders.aggregate(counts_pipeline).to_list(1000)
    for c in counts:
        await db.products.update_one({"id": c["_id"]}, {"$set": {"sold_count": c["sold"]}})

    return {"inserted_orders": len(order_docs), "products": len(products)}


# ---------------------------------------------------------------------------
# Settings (single doc)
# ---------------------------------------------------------------------------

@api_router.get("/settings")
async def get_settings():
    doc = await db.settings.find_one({"_id": "main"}, {"_id": 0}) or {}
    # Merge with defaults so newly-added fields (e.g. `theme`) surface even
    # when the persisted doc pre-dates the schema change.
    return {**Settings().model_dump(), **doc}


@api_router.put("/settings")
async def update_settings(body: Settings):
    await db.settings.update_one({"_id": "main"}, {"$set": body.model_dump()}, upsert=True)
    return body.model_dump()


# ---------------------------------------------------------------------------
# Image proxy
# ---------------------------------------------------------------------------

@api_router.get("/image-proxy")
async def image_proxy(url: str):
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid image URL")
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as c:
            r = await c.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
                "Referer": "https://www.ebay.com.au/",
            })
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail="Image fetch failed")
    return Response(content=r.content, media_type=r.headers.get("content-type", "image/jpeg"))


# ---------------------------------------------------------------------------
# Country Access Control (IP → country gating)
# ---------------------------------------------------------------------------
# Uses Cloudflare's `CF-IPCountry` header as the source of truth. When the
# header is missing (e.g. hitting the origin directly during local dev)
# we treat the request as allowed so the platform stays usable.
# The middleware runs on every request; a small allow-list of paths is
# always exempt so the frontend can render the 403 page and the emergency
# bypass URL can grant access even when the caller's country is blocked.

# Paths (relative to the app root) that the country middleware NEVER blocks.
# Anything starting with these prefixes is passed through untouched.
COUNTRY_MIDDLEWARE_EXEMPT_PREFIXES = (
    "/api/security/bypass/",     # emergency bypass URL — must always be reachable
    "/api/security/status",      # public status endpoint feeding the 403 page
    "/api/image-proxy",          # eBay CDN pass-through (used from customer emails)
    "/docs", "/openapi.json", "/redoc",  # framework internals
)


def _public_base_url(request: Request) -> str:
    """Compose the public https://host base URL from forwarded headers.

    Behind Kubernetes + Cloudflare the FastAPI `request.base_url` reports
    the internal cluster hostname (`ebay-au-harvester.cluster-7…`) which is
    not what an admin should copy into their browser. We prefer the
    `X-Forwarded-Proto` + `X-Forwarded-Host` headers set by the ingress
    (or `Host` as a last resort) so the URL always resolves publicly.
    """
    proto = (request.headers.get("x-forwarded-proto") or "https").split(",")[0].strip()
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.hostname
        or ""
    ).split(",")[0].strip()
    return f"{proto}://{host}"


@app.middleware("http")
async def country_access_middleware(request: Request, call_next):
    # OPTIONS preflights must never be blocked or CORS breaks completely.
    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path or ""
    if any(path.startswith(p) for p in COUNTRY_MIDDLEWARE_EXEMPT_PREFIXES):
        return await call_next(request)

    # Only guard /api/*. Static frontend assets live outside this app.
    if not path.startswith("/api"):
        return await call_next(request)

    country = _client_country(request)
    # No Cloudflare header → assume local dev / direct origin hit → allow.
    # Production Cloudflare deployment always sets this header.
    if country is None:
        return await call_next(request)

    ip = _client_ip(request)

    # Bypass session check (fast path — one indexed query).
    if await _bypass_active_for_ip(ip):
        return await call_next(request)

    settings = await _get_country_access()
    allowed = set(settings.get("allowed_country_codes") or [])
    if country in allowed:
        return await call_next(request)

    # Blocked. Return a minimal JSON response so the frontend can render the
    # plain 403 page without leaking dashboard details.
    return JSONResponse(
        status_code=403,
        content={
            "code": "country_blocked",
            "detail": "Access Denied",
            "country": country,
            "ip": ip,
        },
    )


# --- Security endpoints ------------------------------------------------------

@api_router.get("/security/status")
async def security_status(request: Request):
    """Public — reachable even when the caller's country is blocked so the
    frontend can render the 403 page with a friendly country label.
    Returns `{allowed, country, ip, bypass_active, bypass_expires_at}`."""
    country = _client_country(request)
    ip = _client_ip(request)
    settings = await _get_country_access()
    allowed_codes = set(settings.get("allowed_country_codes") or [])
    bypass = await _bypass_active_for_ip(ip)
    allowed = (
        country is None                 # local dev — always allowed
        or (bypass is not None)
        or (country in allowed_codes)
    )
    return {
        "allowed": allowed,
        "country": country,
        "ip": ip,
        "bypass_active": bypass is not None,
        "bypass_expires_at": (bypass or {}).get("expires_at"),
        "cloudflare_detected": country is not None,
    }


@api_router.get("/security/countries")
async def list_countries():
    """The full ISO 3166-1 alpha-2 list shipped by the backend. Frontend uses
    this to render the toggle list so the two sides never drift."""
    return {"countries": [{"code": c, "name": n} for c, n in COUNTRIES]}


@api_router.get("/security/country-access")
async def get_country_access(request: Request):
    """Admin-view: full settings including the bypass URL and the list of
    currently-active bypass sessions."""
    await _purge_expired_bypasses()
    settings = await _get_country_access()
    sessions = await db.bypass_sessions.find({}, {"_id": 0}).sort("granted_at", -1).to_list(100)
    # Compose the full URL from forwarded headers (Cloudflare + ingress set
    # `X-Forwarded-Proto` / `X-Forwarded-Host`) so the admin can copy-paste
    # a URL that actually resolves publicly — `request.base_url` sees the
    # internal proxy address behind Kubernetes.
    bypass_url = f"{_public_base_url(request)}/api/security/bypass/{settings.get('bypass_token', '')}"
    return {
        "allowed_country_codes": settings.get("allowed_country_codes") or [],
        "bypass_token": settings.get("bypass_token", ""),
        "bypass_url": bypass_url,
        "bypass_session_ttl_seconds": BYPASS_SESSION_TTL_SECONDS,
        "updated_at": settings.get("updated_at"),
        "active_bypass_sessions": sessions,
    }


@api_router.patch("/security/country-access")
async def patch_country_access(body: CountryAccessUpdate):
    """Replace the allow-list. Codes not present in the ISO list are
    silently dropped; codes are upper-cased and de-duplicated."""
    cleaned: list = []
    seen: set = set()
    for raw in body.allowed_country_codes:
        code = str(raw or "").strip().upper()
        if not code or code in seen:
            continue
        if code not in COUNTRY_CODES:
            continue
        seen.add(code)
        cleaned.append(code)
    now = datetime.now(timezone.utc).isoformat()
    await db.country_access_settings.update_one(
        {"_id": "singleton"},
        {"$set": {"allowed_country_codes": cleaned, "updated_at": now}},
        upsert=True,
    )
    return {"allowed_country_codes": cleaned, "updated_at": now}


@api_router.post("/security/country-access/regenerate-token")
async def regenerate_bypass_token(request: Request):
    """Rotate the bypass token. The previous URL stops working immediately."""
    from helpers import _generate_bypass_token
    token = _generate_bypass_token()
    now = datetime.now(timezone.utc).isoformat()
    await db.country_access_settings.update_one(
        {"_id": "singleton"},
        {"$set": {"bypass_token": token, "updated_at": now}},
        upsert=True,
    )
    base = _public_base_url(request)
    return {
        "bypass_token": token,
        "bypass_url": f"{base}/api/security/bypass/{token}",
        "updated_at": now,
    }


@api_router.delete("/security/bypass-sessions/{ip}")
async def revoke_bypass_session(ip: str):
    """Revoke an individual bypass session (e.g. accidentally-granted IP)."""
    r = await db.bypass_sessions.delete_one({"ip": ip})
    return {"deleted": r.deleted_count}


@api_router.get("/security/bypass/{token}")
async def use_bypass_token(token: str, request: Request):
    """Emergency access. Visiting this URL from any IP in any country
    grants that IP 24 hours of unrestricted access. Redirects the browser
    to the dashboard root so the admin doesn't stare at a JSON blob."""
    settings = await _get_country_access()
    expected = settings.get("bypass_token") or ""
    if not expected or not token or not secrets.compare_digest(token, expected):
        # Deliberately vague — don't confirm or deny the token exists.
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    ip = _client_ip(request)
    country = _client_country(request)
    session = await _grant_bypass(ip, country)
    # Redirect to the SPA root. `303 See Other` guarantees the browser
    # switches to GET even if the caller used another verb.
    frontend_url = os.environ.get("FRONTEND_URL")
    if frontend_url:
        target = frontend_url.rstrip("/") + "/"
    else:
        # Best effort — use the forwarded-header base URL so the browser
        # lands on the same public host it was already visiting.
        target = _public_base_url(request).rstrip("/") + "/"
    resp = RedirectResponse(url=target, status_code=303)
    resp.headers["X-Bypass-Granted"] = "1"
    resp.headers["X-Bypass-Expires"] = session["expires_at"]
    return resp


# --- End security endpoints --------------------------------------------------


# ---------------------------------------------------------------------------
# Branding — dashboard name + logo shown in the sidebar header.
# ---------------------------------------------------------------------------
# Singleton doc under `branding` (id="singleton"). Read is unauthenticated
# because the sidebar header needs to render before the login screen paints
# — otherwise the admin sees a "PCAdmin" flash before their custom
# label loads.
_BRANDING_DEFAULTS = {
    "name": "PCAdmin",
    "subtitle": "v1.1 · AU",
    "logo": None,   # None → fall back to the built-in gradient monogram
}


async def _get_branding() -> dict:
    """Fetch the singleton, seeding it lazily on first read."""
    doc = await db.branding.find_one({"_id": "singleton"}, {"_id": 0})
    if not doc:
        seed = {**_BRANDING_DEFAULTS, "_id": "singleton",
                "updated_at": _now_iso()}
        await db.branding.insert_one(seed)
        return {k: v for k, v in seed.items() if k != "_id"}
    return {**_BRANDING_DEFAULTS, **doc}


@api_router.get("/branding")
async def get_branding():
    """Public — every page fetches this on mount to render the sidebar."""
    return await _get_branding()


@api_router.put("/branding")
async def put_branding(body: BrandingUpdate):
    """Overwrite the branding singleton. Logo is validated to be a
    data-URL when present so we don't store arbitrary strings."""
    logo = (body.logo or "").strip() or None
    if logo and not logo.startswith("data:image/"):
        raise HTTPException(status_code=422, detail="logo must be a data:image/… URL")
    patch = {
        "name": body.name.strip(),
        "subtitle": (body.subtitle or "").strip(),
        "logo": logo,
        "updated_at": _now_iso(),
    }
    await db.branding.update_one(
        {"_id": "singleton"}, {"$set": patch}, upsert=True,
    )
    return await _get_branding()


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
