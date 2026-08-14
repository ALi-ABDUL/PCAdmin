from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import random
import logging
import httpx
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Any
import uuid
from datetime import datetime, timezone, timedelta

import asyncio
from scraper import (
    ScrapeError,
    NotEbayAUError,
    BlockedError,
    validate_ebay_au_url,
    fetch_html,
    parse_and_enrich,
)


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Admin Dashboard API — eBay AU Scraper")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

CATEGORIES = ["electronics", "home", "tools", "apparel", "other"]

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ScrapeRequest(BaseModel):
    url: str
    method: str = "auto"
    scrapingbee_key: Optional[str] = None
    scraperapi_key: Optional[str] = None
    save: bool = True


class ScrapedItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    url: str
    item_id: Optional[str] = None
    title: Optional[str] = None
    price_display: Optional[str] = None
    price_value: Optional[float] = None
    currency: str = "AUD"
    condition: Optional[str] = None
    seller: Optional[str] = None
    location: Optional[str] = None
    shipping: Optional[str] = None
    availability: Optional[str] = None
    description: Optional[str] = None
    description_iframe_url: Optional[str] = None
    postage_display: Optional[str] = None
    postage_fee: Optional[float] = None
    delivery_estimate: Optional[str] = None
    delivery_estimate_updated_at: Optional[str] = None
    collection: Optional[str] = None
    returns_policy: Optional[str] = None
    payment_methods: Optional[str] = None
    is_sold: bool = False
    sold_detected_at: Optional[str] = None
    feature_flags: dict = Field(default_factory=lambda: {
        "show_postage": True, "show_delivery": True, "show_collection": True,
        "show_returns": True, "show_payments": True, "show_seller": True,
        "show_description": True, "show_specifics": True, "visible": True,
    })
    images: List[str] = Field(default_factory=list)
    specifics: dict = Field(default_factory=dict)
    method_used: Optional[str] = None
    watchlisted: bool = False
    price_history: List[dict] = Field(default_factory=list)
    added_to_products: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class WatchlistToggle(BaseModel):
    watchlisted: bool


class ProductCreate(BaseModel):
    title: str
    price: float
    cost: Optional[float] = 0.0
    stock: int = 10
    category: str = "other"
    description: Optional[str] = ""
    images: List[str] = Field(default_factory=list)
    source_url: Optional[str] = None
    source_item_id: Optional[str] = None
    active: bool = True
    sku: Optional[str] = None


class Product(ProductCreate):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sold_count: int = 0
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ProductUpdate(BaseModel):
    title: Optional[str] = None
    price: Optional[float] = None
    cost: Optional[float] = None
    stock: Optional[int] = None
    category: Optional[str] = None
    description: Optional[str] = None
    images: Optional[List[str]] = None
    active: Optional[bool] = None
    sku: Optional[str] = None


class OrderCreate(BaseModel):
    product_id: str
    quantity: int = 1
    customer_name: Optional[str] = "Guest"
    customer_email: Optional[str] = None
    status: str = "paid"


class Settings(BaseModel):
    store_name: str = "AU Electronics Co."
    store_email: str = "admin@example.com"
    currency: str = "AUD"
    country: str = "Australia"
    tax_rate: float = 10.0
    accent_color: str = "indigo"


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

    if req.save:
        query = {"item_id": data["item_id"]} if data.get("item_id") else {"url": url}
        existing = await db.items.find_one(query, {"_id": 0})
        if existing:
            update_fields = {**data, "method_used": method_used, "updated_at": now_iso}
            # Preserve user's feature_flags
            if "feature_flags" in existing:
                update_fields["feature_flags"] = existing["feature_flags"]
            # Only overwrite sold_detected_at if it's a new sold event
            if data.get("is_sold") and not existing.get("is_sold"):
                update_fields["sold_detected_at"] = now_iso
                # Mirror to product if linked
                await db.products.update_many({"source_item_id": data.get("item_id")}, {"$set": {"active": False, "is_sold": True, "updated_at": now_iso}})
            history = existing.get("price_history", [])
            last_val = history[-1]["value"] if history else None
            if data.get("price_value") is not None and data.get("price_value") != last_val:
                history.append(history_point)
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
    sort: str = "created_at_desc",
    limit: int = Query(100, le=500),
):
    query: dict[str, Any] = {}
    if watchlisted is not None:
        query["watchlisted"] = watchlisted
    if q:
        query["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"seller": {"$regex": q, "$options": "i"}},
            {"location": {"$regex": q, "$options": "i"}},
        ]
    sort_map = {
        "created_at_desc": [("created_at", -1)],
        "created_at_asc": [("created_at", 1)],
        "price_desc": [("price_value", -1)],
        "price_asc": [("price_value", 1)],
        "title_asc": [("title", 1)],
    }
    cursor = db.items.find(query, {"_id": 0}).sort(sort_map.get(sort, [("created_at", -1)])).limit(limit)
    items = await cursor.to_list(length=limit)
    total = await db.items.count_documents(query)
    return {"items": items, "total": total}


@api_router.get("/items/refresh-status")
async def refresh_status():
    doc = await db.system.find_one({"_id": "nightly"}, {"_id": 0})
    return doc or {"last_run": None}


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


class RefreshAllRequest(BaseModel):
    method: str = "auto"
    scrapingbee_key: Optional[str] = None
    scraperapi_key: Optional[str] = None


async def _refresh_all_items(method: str = "auto", scrapingbee_key: Optional[str] = None, scraperapi_key: Optional[str] = None) -> dict:
    """Re-scrape every stored item; detects sold status + updates delivery estimate."""
    items = await db.items.find({}, {"_id": 0, "id": 1, "url": 1, "item_id": 1}).to_list(1000)
    ok = 0; sold = 0; failed = 0
    for it in items:
        try:
            r = ScrapeRequest(url=it["url"], method=method, scrapingbee_key=scrapingbee_key, scraperapi_key=scraperapi_key, save=True)
            res = await scrape(r)
            if res.get("item", {}).get("is_sold"):
                sold += 1
            ok += 1
        except Exception as e:
            failed += 1
            logger.info(f"refresh-all: {it.get('item_id')} failed: {e}")
        await asyncio.sleep(1.2)  # be gentle to eBay
    return {"refreshed": ok, "sold_found": sold, "failed": failed, "total": len(items)}


@api_router.post("/items/refresh-all")
async def refresh_all_items(body: RefreshAllRequest):
    return await _refresh_all_items(body.method, body.scrapingbee_key, body.scraperapi_key)


async def _nightly_refresh_loop():
    """Fire-and-forget background task: re-scrape all items every 24h."""
    # Wait until app fully starts + first-day delay so we don't hammer on boot
    await asyncio.sleep(60)
    while True:
        try:
            logger.info("nightly refresh: starting")
            summary = await _refresh_all_items(method="auto")
            await db.system.update_one({"_id": "nightly"}, {"$set": {"last_run": datetime.now(timezone.utc).isoformat(), **summary}}, upsert=True)
            logger.info(f"nightly refresh done: {summary}")
        except Exception as e:
            logger.exception(f"nightly refresh error: {e}")
        await asyncio.sleep(24 * 60 * 60)


@app.on_event("startup")
async def _start_scheduler():
    asyncio.create_task(_nightly_refresh_loop())


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

def _guess_category(title: str) -> str:
    t = (title or "").lower()
    if any(k in t for k in ["iphone", "samsung", "laptop", "camera", "tv", "playstation", "xbox", "headphone", "airpods", "monitor", "gpu", "ssd", "drone"]):
        return "electronics"
    if any(k in t for k in ["drill", "saw", "wrench", "spanner", "hammer", "screwdriver", "grinder", "sander", "tool"]):
        return "tools"
    if any(k in t for k in ["kitchen", "vacuum", "sofa", "chair", "lamp", "candle", "cushion", "mattress", "linen", "curtain"]):
        return "home"
    if any(k in t for k in ["shirt", "jeans", "jacket", "hoodie", "shoes", "sneaker", "dress"]):
        return "apparel"
    return "other"


@api_router.post("/products/from-item/{item_id}")
async def create_product_from_item(item_id: str, markup_pct: float = 25.0):
    it = await db.items.find_one({"id": item_id}, {"_id": 0})
    if not it:
        raise HTTPException(status_code=404, detail="Scraped item not found")
    cost = it.get("price_value") or 0.0
    price = round(cost * (1 + markup_pct / 100.0), 2) if cost else 0.0
    prod = Product(
        title=it.get("title") or "Untitled",
        price=price,
        cost=cost,
        stock=10,
        category=_guess_category(it.get("title") or ""),
        description=it.get("description") or "",
        images=it.get("images") or [],
        source_url=it.get("url"),
        source_item_id=it.get("item_id"),
        sku=f"SKU-{(it.get('item_id') or uuid.uuid4().hex[:8])[-6:]}",
    )
    await db.products.insert_one(prod.model_dump())
    await db.items.update_one({"id": item_id}, {"$set": {"added_to_products": True}})
    return prod.model_dump()


@api_router.post("/products", response_model=Product)
async def create_product(body: ProductCreate):
    prod = Product(**body.model_dump())
    await db.products.insert_one(prod.model_dump())
    return prod


@api_router.get("/products")
async def list_products(
    q: Optional[str] = None,
    category: Optional[str] = None,
    active: Optional[bool] = None,
    sort: str = "created_at_desc",
    limit: int = Query(200, le=1000),
):
    query: dict[str, Any] = {}
    if q:
        query["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"sku": {"$regex": q, "$options": "i"}},
        ]
    if category:
        query["category"] = category
    if active is not None:
        query["active"] = active
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
    return {"products": products, "total": total}


@api_router.get("/products/{pid}")
async def get_product(pid: str):
    p = await db.products.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
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
        "status": body.status,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.orders.insert_one(order)
    await db.products.update_one(
        {"id": p["id"]},
        {"$inc": {"sold_count": body.quantity, "stock": -body.quantity}},
    )
    order.pop("_id", None)
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
            status = rng.choices(["paid", "shipped", "delivered", "refunded", "cancelled"], weights=[3, 3, 8, 1, 1])[0]
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
