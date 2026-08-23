"""FastAPI endpoints for the Admin Dashboard API.
Deps: app/router/db/logger from deps.py — Pydantic models from models.py — helpers from helpers.py.
Refactored Feb 2026."""
from fastapi import HTTPException, Query, Depends, Header
from fastapi.responses import Response
from starlette.middleware.cors import CORSMiddleware
import os
import re
import random
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
    AbandonedCart, Transaction, CustomerBase, Customer, CustomerUpdate, CUSTOMER_GROUPS, 
    CouponBase, Coupon, ReviewBase, Review, JWT_ALGO, JWT_ACCESS_TTL, PortalRegisterBody, 
    PortalLoginBody, PortalReviewBody, PortalReviewVoteBody, MessageBase, Message, StockMove, 
    _CATEGORY_RULES, _EBAY_BREADCRUMB_MAP, Notification, PUSH_SETTINGS_DEFAULTS, 
    PUSH_CRITICAL_TYPES, PushSettingsUpdate, PricingRuleBase, PricingRule, PricingRuleUpdate, 
    _DEFAULT_PRICING_RULES, BulkProductIds,
)
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
    _emit_price_change_notifications, calc_pricing, _ensure_pricing_rules_seeded, 
    _load_pricing_rules,
    send_customer_email, send_customer_order_confirmation, send_customer_order_status_update,
    send_customer_order_cancellation, send_customer_welcome_email, CUSTOMER_EMAIL_KINDS,
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
                # Mirror to product if linked (also stamp stock_status so the UI can show the right badge)
                await db.products.update_many(
                    {"source_item_id": data.get("item_id")},
                    {"$set": {"active": False, "is_sold": True, "stock_status": new_status, "updated_at": now_iso}},
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
    # "margin_desc" is computed server-side using active pricing rules.
    if sort == "margin_desc":
        cursor = db.items.find(query, {"_id": 0}).limit(limit)
        items = await cursor.to_list(length=limit)
        rules = await _load_pricing_rules()
        def margin(it: dict) -> float:
            ebay = float(it.get("price_value") or 0)
            if ebay <= 0: return -1.0
            c = calc_pricing(ebay, rules=rules)
            sell = c["sell_price"]
            return ((sell - ebay) / sell) if sell > 0 else -1.0
        items.sort(key=margin, reverse=True)
    else:
        cursor = db.items.find(query, {"_id": 0}).sort(sort_map.get(sort, [("created_at", -1)])).limit(limit)
        items = await cursor.to_list(length=limit)
    total = await db.items.count_documents(query)
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
    if await db.customers.count_documents({}) == 0:
        await _rebuild_customers_from_orders()
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
    r = await db.orders.update_one({"id": oid}, {"$set": body})
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
    new_status = body.get("status")
    old_status = prev.get("status")
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
async def list_transactions(status: Optional[str] = None, kind: Optional[str] = None):
    q: dict[str, Any] = {}
    if status: q["status"] = status
    if kind:   q["kind"] = kind
    items = await db.transactions.find(q, {"_id": 0}).sort("created_at", -1).limit(500).to_list(500)
    total = await db.transactions.count_documents(q)
    counts_pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}, "amount": {"$sum": "$amount"}}}]
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
    group: Optional[str] = None,
    sort: str = "created_at_desc",
    limit: int = Query(500, le=2000),
):
    query: dict[str, Any] = {}
    if status: query["status"] = status
    if type:   query["type"] = type
    if group:  query["group"] = group
    if q:
        query["$or"] = [
            {"name":  {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
            {"code":  {"$regex": q, "$options": "i"}},
        ]
    sort_map = {
        "created_at_desc": [("created_at", -1)],
        "name_asc": [("name", 1)],
        "spend_desc": [("total_spend", -1)],
        "orders_desc": [("orders_count", -1)],
    }
    cursor = db.customers.find(query, {"_id": 0}).sort(sort_map.get(sort, [("created_at", -1)])).limit(limit)
    customers = await cursor.to_list(length=limit)
    total = await db.customers.count_documents(query)
    return {"customers": customers, "total": total, "groups": CUSTOMER_GROUPS}


@api_router.get("/customers/summary")
async def customers_summary():
    total = await db.customers.count_documents({})
    active = await db.customers.count_documents({"status": "active"})
    pending = await db.customers.count_documents({"status": "pending"})
    blocked = await db.customers.count_documents({"status": "blocked"})
    guest = await db.customers.count_documents({"type": "guest"})
    registered = await db.customers.count_documents({"type": "registered"})
    top = await db.customers.find({}, {"_id": 0}).sort("total_spend", -1).limit(10).to_list(10)
    by_group = await db.customers.aggregate([{"$group": {"_id": "$group", "count": {"$sum": 1}, "spend": {"$sum": "$total_spend"}}}]).to_list(50)
    by_group = [{"group": g["_id"] or "Retail", "count": g["count"], "spend": round(g["spend"], 2)} for g in by_group]
    return {"total": total, "active": active, "pending": pending, "blocked": blocked, "guest": guest, "registered": registered, "top": top, "by_group": by_group}


@api_router.get("/customers/{cid}")
async def get_customer(cid: str):
    """Full profile for a single customer, plus their recent orders (last 25)
    so the admin detail page can render everything in one round-trip."""
    c = await db.customers.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Not found")
    orders = []
    email = (c.get("email") or "").strip().lower()
    if email:
        orders = await db.orders.find(
            {"customer_email": email},
            {"_id": 0, "id": 1, "reference": 1, "status": 1, "total": 1, "created_at": 1, "items": 1, "customer_name": 1},
        ).sort("created_at", -1).limit(25).to_list(25)
    return {"customer": c, "orders": orders}




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
        data={"name": c.name, "email": c.email, "group": c.group},
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
    m = Message(**body.model_dump())
    await db.messages.insert_one(m.model_dump())
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
):
    sellers = await _build_sellers()
    if q:
        needle = q.lower()
        sellers = [s for s in sellers if needle in s["name"].lower() or needle in s["location"].lower()]
    if status in {"active", "inactive"}:
        sellers = [s for s in sellers if s["status"] == status]

    reverse_sort = sort in {"last_active_desc"}
    sort_key = {
        "revenue_desc":     lambda s: -s["revenue_generated"],
        "orders_desc":      lambda s: -s["total_orders"],
        "products_desc":    lambda s: -s["total_products"],
        "name_asc":         lambda s: s["name"].lower(),
        "last_active_desc": lambda s: s["last_active"] or "",
    }.get(sort, lambda s: -s["revenue_generated"])
    sellers.sort(key=sort_key, reverse=reverse_sort)

    total = len(sellers)
    sellers = sellers[:limit]
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
    sellers = await _build_sellers()
    for s in sellers:
        if s["id"] == sid:
            return s
    raise HTTPException(status_code=404, detail="Seller not found")



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
        "body": "This is a test push from your Aussie Admin dashboard.",
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
    )
    prod.product_code = await _generate_unique_product_code(prod.title)
    await db.products.insert_one(prod.model_dump())
    await db.items.update_one({"id": item_id}, {"$set": {"added_to_products": True}})
    return prod.model_dump()


@api_router.post("/products", response_model=Product)
async def create_product(body: ProductCreate):
    prod = Product(**body.model_dump())
    if not prod.product_code:
        prod.product_code = await _generate_unique_product_code(prod.title)
    await db.products.insert_one(prod.model_dump())
    return prod


@api_router.get("/products")
async def list_products(
    q: Optional[str] = None,
    category: Optional[str] = None,
    active: Optional[bool] = None,
    archived: Optional[bool] = None,     # None → exclude archived; True → only archived; False → only unarchived
    sort: str = "created_at_desc",
    limit: int = Query(200, le=1000),
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
    sort_map = {
        "created_at_desc": [("created_at", -1)],
        "created_at_asc": [("created_at", 1)],
        "price_desc": [("price", -1)],
        "price_asc": [("price", 1)],
        "stock_asc": [("stock", 1)],
        "sold_desc": [("sold_count", -1)],
    }
    cursor = db.products.find(query, {"_id": 0}).sort(sort_map.get(sort, [("created_at", -1)])).limit(limit)
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
    update = {
        "title": data.get("title") or p.get("title"),
        "images": data.get("images") or p.get("images") or [],
        "variants": data.get("variants") or [],
        "cost": data.get("price_value") if data.get("price_value") is not None else p.get("cost"),
        "stock_status": new_status,
        "is_sold": new_status != "live",
        "active": p.get("active") if new_status == "live" else False,
        "description": data.get("description") or p.get("description"),
        "updated_at": now,
    }
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
        return {"deleted": 0}
    r = await db.products.delete_many({"id": {"$in": body.product_ids}})
    return {"deleted": r.deleted_count}


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
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.products.update_one({"id": pid}, {"$set": fields})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return await db.products.find_one({"id": pid}, {"_id": 0})


@api_router.delete("/products/{pid}")
async def delete_product(pid: str):
    r = await db.products.delete_one({"id": pid})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"deleted": True}


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
        "customer_email": body.customer_email,
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
    order.pop("_id", None)
    # Customer email: order confirmation (gated by customer_order_confirmation toggle)
    await send_customer_order_confirmation(order)
    return order


@api_router.get("/orders")
async def list_orders(limit: int = Query(200, le=1000), status: Optional[str] = None):
    q: dict[str, Any] = {}
    if status:
        q["status"] = status
    cursor = db.orders.find(q, {"_id": 0}).sort("created_at", -1).limit(limit)
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
    doc = await db.settings.find_one({"_id": "main"}, {"_id": 0})
    return doc or Settings().model_dump()


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
