from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
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

app = FastAPI(title="Admin Dashboard API — Product Sourcing")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

CATEGORIES = ["electronics", "home", "tools", "apparel", "other"]

# Seed categories for ecommerce store (auto-populated on first startup)
SEED_CATEGORIES = [
    # Electronics
    {"name": "Phones & Tablets",       "group": "Electronics", "icon": "smartphone",   "color": "#4F46E5", "description": "Mobile phones, tablets and accessories."},
    {"name": "Laptops & Computers",    "group": "Electronics", "icon": "laptop",       "color": "#4338CA", "description": "Laptops, desktops, monitors and peripherals."},
    {"name": "TVs & Home Theatre",     "group": "Electronics", "icon": "tv",           "color": "#6366F1", "description": "Televisions, projectors and sound bars."},
    {"name": "Audio & Headphones",     "group": "Electronics", "icon": "headphones",   "color": "#7C3AED", "description": "Headphones, earbuds, speakers and hi-fi."},
    {"name": "Cameras & Photo",        "group": "Electronics", "icon": "camera",       "color": "#8B5CF6", "description": "Digital cameras, lenses, drones and gear."},
    {"name": "Gaming",                 "group": "Electronics", "icon": "gamepad-2",    "color": "#A855F7", "description": "Consoles, games, controllers and gaming PCs."},
    {"name": "Wearables & Smart Home", "group": "Electronics", "icon": "watch",        "color": "#EC4899", "description": "Smart watches, trackers and connected home."},
    # Home
    {"name": "Kitchen & Dining",       "group": "Home",        "icon": "utensils",     "color": "#F59E0B", "description": "Cookware, appliances and dining."},
    {"name": "Furniture",              "group": "Home",        "icon": "armchair",     "color": "#D97706", "description": "Living, bedroom and office furniture."},
    {"name": "Home Décor & Lighting",  "group": "Home",        "icon": "lamp",         "color": "#EA580C", "description": "Rugs, wall art, mirrors and lighting."},
    {"name": "Bedroom & Bath",         "group": "Home",        "icon": "bed",          "color": "#F97316", "description": "Linen, bedding, towels and bathware."},
    {"name": "Vacuums & Cleaning",     "group": "Home",        "icon": "spray-can",    "color": "#FB923C", "description": "Vacuums, mops and cleaning supplies."},
    {"name": "Garden & Outdoor",       "group": "Home",        "icon": "flower-2",     "color": "#65A30D", "description": "BBQs, garden tools and outdoor living."},
    # Tools
    {"name": "Power Tools",            "group": "Tools",       "icon": "drill",        "color": "#0EA5E9", "description": "Cordless drills, saws, grinders and impact drivers."},
    {"name": "Hand Tools",             "group": "Tools",       "icon": "wrench",       "color": "#0284C7", "description": "Hammers, spanners, screwdrivers and pliers."},
    {"name": "Automotive",             "group": "Tools",       "icon": "car",          "color": "#0369A1", "description": "Car care, tyres, dash cams and workshop gear."},
    {"name": "Workshop & Storage",     "group": "Tools",       "icon": "hammer",       "color": "#075985", "description": "Workbenches, tool cabinets and hardware."},
    {"name": "Safety & Workwear",      "group": "Tools",       "icon": "shield",       "color": "#0891B2", "description": "PPE, hi-vis, boots and safety gear."},
    # Apparel
    {"name": "Men's Clothing",         "group": "Apparel",     "icon": "shirt",        "color": "#059669", "description": "Men's shirts, jeans, jackets and more."},
    {"name": "Women's Clothing",       "group": "Apparel",     "icon": "shirt",        "color": "#10B981", "description": "Women's dresses, tops, activewear and more."},
    {"name": "Shoes & Sneakers",       "group": "Apparel",     "icon": "footprints",   "color": "#14B8A6", "description": "Sneakers, boots, sandals and formal shoes."},
    {"name": "Watches & Jewellery",    "group": "Apparel",     "icon": "watch",        "color": "#06B6D4", "description": "Watches, rings, necklaces and accessories."},
    # Sports
    {"name": "Fitness & Gym",          "group": "Sports",      "icon": "dumbbell",     "color": "#DC2626", "description": "Dumbbells, benches, treadmills and yoga."},
    {"name": "Outdoor & Camping",      "group": "Sports",      "icon": "tent",         "color": "#B91C1C", "description": "Tents, sleeping bags, hiking and camping."},
    {"name": "Cycling",                "group": "Sports",      "icon": "bike",         "color": "#EF4444", "description": "Bikes, helmets, cycling apparel and parts."},
    # Toys / Collectibles
    {"name": "Lego & Building",        "group": "Toys",        "icon": "blocks",       "color": "#F43F5E", "description": "LEGO sets, blocks and building toys."},
    {"name": "Board Games & Puzzles",  "group": "Toys",        "icon": "puzzle",       "color": "#E11D48", "description": "Board games, card games and puzzles."},
    {"name": "Collectibles & Trading Cards", "group": "Toys",  "icon": "star",         "color": "#BE185D", "description": "Pokémon, sports cards, figures and collectibles."},
    # Fallback
    {"name": "Other",                  "group": "General",     "icon": "package",      "color": "#6B7280", "description": "Uncategorised or miscellaneous items."},
]

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
    ebay_category_path: List[str] = Field(default_factory=list)
    category: Optional[str] = None
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


# AU address generator used by the demo seed + backfill for existing orders without addresses.
class ShippingAddress(BaseModel):
    full_name: Optional[str] = ""
    street: Optional[str] = ""
    suburb: Optional[str] = ""
    state: Optional[str] = ""
    postcode: Optional[str] = ""
    country: str = "Australia"


_AU_SUBURBS = [
    ("Bondi",         "NSW", "2026"), ("Surry Hills",     "NSW", "2010"), ("Parramatta",   "NSW", "2150"),
    ("Newtown",       "NSW", "2042"), ("Chatswood",       "NSW", "2067"), ("Manly",        "NSW", "2095"),
    ("Fitzroy",       "VIC", "3065"), ("St Kilda",        "VIC", "3182"), ("Brunswick",    "VIC", "3056"),
    ("Southbank",     "VIC", "3006"), ("Richmond",        "VIC", "3121"), ("Docklands",    "VIC", "3008"),
    ("Fortitude Valley","QLD","4006"), ("Kangaroo Point", "QLD", "4169"), ("South Brisbane","QLD","4101"),
    ("New Farm",      "QLD", "4005"), ("Surfers Paradise","QLD", "4217"), ("Bulimba",     "QLD", "4171"),
    ("Fremantle",     "WA",  "6160"), ("Subiaco",         "WA",  "6008"), ("Cottesloe",    "WA",  "6011"),
    ("North Adelaide","SA",  "5006"), ("Glenelg",         "SA",  "5045"), ("Norwood",      "SA",  "5067"),
    ("Battery Point", "TAS", "7004"), ("Sandy Bay",       "TAS", "7005"),
    ("Braddon",       "ACT", "2612"), ("Kingston",        "ACT", "2604"),
    ("Nightcliff",    "NT",  "0810"), ("Fannie Bay",      "NT",  "0820"),
]
_STREET_NAMES = ["George", "King", "Queen", "Church", "Elizabeth", "Bourke", "Collins", "Swanston",
                 "Adelaide", "Ann", "Wickham", "Hay", "Rundle", "Murray", "Northbourne", "Beach", "Ocean",
                 "Palm", "Coogee", "Bondi", "Chapel", "Brunswick", "Latrobe", "Flinders", "Sturt"]
_STREET_TYPES = ["St", "Rd", "Ave", "Dr", "Pde", "Lane", "Cres", "Way", "Terrace", "Blvd"]


def _rand_au_address(rng: random.Random, full_name: str) -> dict:
    suburb, state, postcode = rng.choice(_AU_SUBURBS)
    unit = f"{rng.randint(1, 25)}/" if rng.random() < 0.35 else ""
    number = rng.randint(1, 480)
    street = f"{rng.choice(_STREET_NAMES)} {rng.choice(_STREET_TYPES)}"
    return {
        "full_name": full_name,
        "street": f"{unit}{number} {street}",
        "suburb": suburb,
        "state": state,
        "postcode": postcode,
        "country": "Australia",
    }


class OrderCreate(BaseModel):
    product_id: str
    quantity: int = 1
    customer_name: Optional[str] = "Guest"
    customer_email: Optional[str] = None
    status: str = "paid"
    shipping_address: Optional[ShippingAddress] = None


class Settings(BaseModel):
    store_name: str = "AU Electronics Co."
    store_email: str = "admin@example.com"
    currency: str = "AUD"
    country: str = "Australia"
    tax_rate: float = 10.0
    accent_color: str = "indigo"


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-") or "cat"


class Category(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    slug: str
    group: str = "General"
    icon: str = "package"
    color: str = "#6B7280"
    description: str = ""
    active: bool = True
    sort_order: int = 0
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CategoryCreate(BaseModel):
    name: str
    group: str = "General"
    icon: str = "package"
    color: str = "#6B7280"
    description: str = ""
    active: bool = True


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    group: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    active: Optional[bool] = None
    sort_order: Optional[int] = None


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
    # Auto-detect store category from breadcrumbs > specifics > title
    data["category"] = _guess_category(
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
            # Only overwrite sold_detected_at if it's a new sold event
            if data.get("is_sold") and not existing.get("is_sold"):
                update_fields["sold_detected_at"] = now_iso
                # Record a sold-event for the frontend toast feed
                await db.sold_events.insert_one({
                    "id": str(uuid.uuid4()),
                    "item_id": existing.get("id"),
                    "ebay_item_id": data.get("item_id"),
                    "title": data.get("title") or existing.get("title"),
                    "url": existing.get("url"),
                    "image": (data.get("images") or existing.get("images") or [None])[0],
                    "last_price": data.get("price_value") or existing.get("price_value"),
                    "detected_at": now_iso,
                    "notified": False,
                })
                # Mirror to product if linked
                await db.products.update_many({"source_item_id": data.get("item_id")}, {"$set": {"active": False, "is_sold": True, "updated_at": now_iso}})
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
    status: Optional[str] = None,
    sort: str = "created_at_desc",
    limit: int = Query(100, le=500),
):
    query: dict[str, Any] = {}
    if watchlisted is not None:
        query["watchlisted"] = watchlisted
    if status == "sold":
        query["is_sold"] = True
    elif status == "live":
        query["is_sold"] = {"$ne": True}
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
    await _ensure_categories_seeded()
    await _ensure_pricing_rules_seeded()
    if await db.customers.count_documents({}) == 0:
        await _rebuild_customers_from_orders()
    await _seed_transactions_and_returns()
    asyncio.create_task(_nightly_refresh_loop())


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

async def _ensure_categories_seeded() -> None:
    count = await db.categories.count_documents({})
    if count > 0:
        return
    for i, s in enumerate(SEED_CATEGORIES):
        cat = Category(
            name=s["name"], slug=_slug(s["name"]), group=s["group"],
            icon=s["icon"], color=s["color"], description=s["description"], sort_order=i,
        )
        await db.categories.insert_one(cat.model_dump())
    logger.info(f"Seeded {len(SEED_CATEGORIES)} categories")


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

ORDER_STATUSES = ["new", "pending", "processing", "ready_to_ship", "shipped", "delivered", "cancelled"]


class ReturnRequest(BaseModel):
    order_id: Optional[str] = None
    product_id: Optional[str] = None
    product_title: str = ""
    customer_name: str = "Customer"
    reason: str = "Not as described"
    amount: float = 0.0
    status: str = "pending"  # pending | approved | rejected | refunded


class AbandonedCart(BaseModel):
    customer_name: str = "Guest"
    customer_email: Optional[str] = ""
    items: int = 1
    subtotal: float = 0.0
    step: str = "cart"  # cart | shipping | payment
    recovered: bool = False


class Transaction(BaseModel):
    order_id: Optional[str] = None
    customer_name: str = "Customer"
    amount: float = 0.0
    method: str = "card"  # card | paypal | applepay | afterpay | bank
    status: str = "successful"  # successful | pending | failed
    kind: str = "charge"  # charge | refund | chargeback
    reference: Optional[str] = None


def _now_iso() -> str: return datetime.now(timezone.utc).isoformat()


async def _seed_transactions_and_returns():
    if await db.transactions.count_documents({}) > 0:
        return
    orders = await db.orders.find({}, {"_id": 0}).sort("created_at", -1).limit(200).to_list(200)
    rng = random.Random(7)
    tx_docs = []
    for o in orders:
        status = rng.choices(["successful", "pending", "failed"], weights=[85, 8, 7])[0]
        tx_docs.append({
            "id": str(uuid.uuid4()),
            "order_id": o["id"],
            "customer_name": o.get("customer_name") or "Customer",
            "amount": o.get("total") or 0,
            "method": rng.choice(["card", "paypal", "applepay", "afterpay", "bank"]),
            "status": status,
            "kind": "charge",
            "reference": f"txn_{uuid.uuid4().hex[:10]}",
            "created_at": o.get("created_at") or _now_iso(),
        })
    # Refunds & chargebacks
    for o in rng.sample(orders, min(12, len(orders))):
        tx_docs.append({
            "id": str(uuid.uuid4()),
            "order_id": o["id"],
            "customer_name": o.get("customer_name") or "Customer",
            "amount": round((o.get("total") or 0) * rng.uniform(0.25, 1.0), 2),
            "method": rng.choice(["card", "paypal"]),
            "status": "successful",
            "kind": rng.choices(["refund", "chargeback"], weights=[4, 1])[0],
            "reference": f"txn_{uuid.uuid4().hex[:10]}",
            "created_at": _now_iso(),
        })
    if tx_docs:
        await db.transactions.insert_many(tx_docs)

    # Returns
    ret_docs = []
    for o in rng.sample(orders, min(10, len(orders))):
        ret_docs.append({
            "id": str(uuid.uuid4()),
            "order_id": o["id"],
            "product_id": o.get("product_id"),
            "product_title": o.get("product_title") or "",
            "customer_name": o.get("customer_name") or "Customer",
            "reason": rng.choice(["Not as described", "Faulty on arrival", "Changed mind", "Wrong size", "Damaged in transit"]),
            "amount": o.get("total") or 0,
            "status": rng.choice(["pending", "pending", "approved", "refunded", "rejected"]),
            "created_at": _now_iso(),
        })
    if ret_docs:
        await db.returns.insert_many(ret_docs)

    # Abandoned carts
    cart_docs = []
    names = ["Amelia Wilson", "Jack Harris", "Olivia Nguyen", "Liam Brown", "Ava Smith", "Noah Taylor", "Emma Anderson", "Charlie Wilson", "Isla Walker", "Ethan Nguyen"]
    for i in range(24):
        cart_docs.append({
            "id": str(uuid.uuid4()),
            "customer_name": rng.choice(names),
            "customer_email": f"cart{i}@example.com",
            "items": rng.randint(1, 5),
            "subtotal": round(rng.uniform(29, 899), 2),
            "step": rng.choice(["cart", "shipping", "payment"]),
            "recovered": rng.random() < 0.15,
            "created_at": (datetime.now(timezone.utc) - timedelta(hours=rng.randint(1, 240))).isoformat(),
        })
    if cart_docs:
        await db.abandoned_carts.insert_many(cart_docs)


@api_router.patch("/orders/{oid}")
async def update_order(oid: str, body: dict):
    r = await db.orders.update_one({"id": oid}, {"$set": body})
    if r.matched_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return await db.orders.find_one({"id": oid}, {"_id": 0})


@api_router.get("/orders/status-counts")
async def order_status_counts():
    pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
    rows = await db.orders.aggregate(pipeline).to_list(50)
    counts = {r["_id"]: r["count"] for r in rows}
    total = sum(counts.values())
    return {"total": total, "counts": counts}


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
    doc.pop("_id", None); return doc


# ---------------------------------------------------------------------------
# Customers (persistent) - complement to derived-from-orders
# ---------------------------------------------------------------------------

class CustomerBase(BaseModel):
    name: str
    email: Optional[str] = ""
    phone: Optional[str] = ""
    country: str = "Australia"
    state: Optional[str] = ""
    city: Optional[str] = ""
    address: Optional[str] = ""
    postcode: Optional[str] = ""
    status: str = "pending"           # pending | active | blocked
    type: str = "registered"          # registered | guest
    group: str = "Retail"             # Retail | VIP | Wholesale | Trade
    tags: List[str] = Field(default_factory=list)
    notes: Optional[str] = ""


class Customer(CustomerBase):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    code: str = Field(default_factory=lambda: f"CUS-{uuid.uuid4().hex[:6].upper()}")
    orders_count: int = 0
    total_spend: float = 0.0
    wishlist: List[str] = Field(default_factory=list)  # product_ids
    addresses: List[dict] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    status: Optional[str] = None
    type: Optional[str] = None
    group: Optional[str] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postcode: Optional[str] = None


CUSTOMER_GROUPS = ["Retail", "VIP", "Wholesale", "Trade"]


async def _rebuild_customers_from_orders():
    """Materialise customer records from orders and merge stats."""
    orders = await db.orders.find({}, {"_id": 0}).to_list(5000)
    if not orders: return 0
    by_email: dict[str, dict] = {}
    for o in orders:
        key = (o.get("customer_email") or o.get("customer_name") or "").lower().strip()
        if not key: continue
        e = by_email.setdefault(key, {
            "name": o.get("customer_name") or "Guest",
            "email": o.get("customer_email") or "",
            "orders_count": 0, "total_spend": 0.0,
        })
        e["orders_count"] += 1
        e["total_spend"] += float(o.get("total") or 0)
    n = 0
    for key, agg in by_email.items():
        existing = await db.customers.find_one({"email": agg["email"]}, {"_id": 0}) if agg["email"] else None
        if not existing:
            group = "VIP" if agg["total_spend"] > 500 else "Retail"
            c = Customer(
                name=agg["name"], email=agg["email"], group=group,
                status="active", type="registered",
                orders_count=agg["orders_count"], total_spend=round(agg["total_spend"], 2),
            )
            await db.customers.insert_one(c.model_dump())
            n += 1
        else:
            await db.customers.update_one({"id": existing["id"]}, {"$set": {"orders_count": agg["orders_count"], "total_spend": round(agg["total_spend"], 2), "updated_at": datetime.now(timezone.utc).isoformat()}})
    return n


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


@api_router.post("/customers", response_model=Customer)
async def create_customer(body: CustomerBase):
    c = Customer(**body.model_dump())
    await db.customers.insert_one(c.model_dump())
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

class CouponBase(BaseModel):
    code: str
    type: str = "percent"        # percent | fixed
    value: float = 10.0
    min_spend: float = 0.0
    max_uses: int = 100
    used: int = 0
    active: bool = True
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None
    description: Optional[str] = ""


class Coupon(CouponBase):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


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


class ReviewBase(BaseModel):
    product_id: str
    customer_name: str = "Anonymous"
    rating: int = 5
    title: Optional[str] = ""
    body: Optional[str] = ""
    status: str = "pending"  # pending | approved | rejected


class Review(ReviewBase):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@api_router.get("/reviews")
async def list_reviews(product_id: Optional[str] = None, status: Optional[str] = None):
    q: dict[str, Any] = {}
    if product_id: q["product_id"] = product_id
    if status:     q["status"] = status
    items = await db.reviews.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"reviews": items, "total": len(items)}


@api_router.post("/reviews", response_model=Review)
async def create_review(body: ReviewBase):
    r = Review(**body.model_dump())
    await db.reviews.insert_one(r.model_dump())
    return r


@api_router.patch("/reviews/{rid}")
async def update_review(rid: str, body: dict):
    r = await db.reviews.update_one({"id": rid}, {"$set": body})
    if r.matched_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return await db.reviews.find_one({"id": rid}, {"_id": 0})


@api_router.delete("/reviews/{rid}")
async def delete_review(rid: str):
    r = await db.reviews.delete_one({"id": rid})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": True}


class MessageBase(BaseModel):
    customer_name: str
    customer_email: Optional[str] = ""
    subject: str = ""
    body: str = ""
    status: str = "new"  # new | read | archived


class Message(MessageBase):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


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

class StockMove(BaseModel):
    product_id: str
    delta: int
    kind: str = "adjustment"  # opening | count | adjustment | receive | sale | return
    reason: Optional[str] = ""


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

def _seller_id(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-") or "unknown"


async def _build_sellers() -> List[dict]:
    """Aggregate items -> sellers, then enrich with product and order stats."""
    items = await db.items.find({"seller": {"$nin": [None, ""]}}, {"_id": 0}).to_list(5000)
    if not items:
        return []

    buckets: dict = {}
    for it in items:
        name = (it.get("seller") or "").strip()
        if not name:
            continue
        b = buckets.setdefault(name, {"item_ids": [], "locations": set(), "last": "", "any_live": False})
        b["item_ids"].append(it["id"])
        if it.get("location"):
            b["locations"].add(it["location"])
        upd = it.get("updated_at") or it.get("created_at") or ""
        if upd > b["last"]:
            b["last"] = upd
        if not it.get("is_sold"):
            b["any_live"] = True

    sellers: List[dict] = []
    for name, b in buckets.items():
        products = await db.products.find(
            {"source_item_id": {"$in": b["item_ids"]}}, {"_id": 0, "id": 1}
        ).to_list(1000)
        product_ids = [p["id"] for p in products]

        orders_count = 0
        revenue = 0.0
        if product_ids:
            agg = await db.orders.aggregate([
                {"$match": {"product_id": {"$in": product_ids}}},
                {"$group": {"_id": None, "n": {"$sum": 1}, "rev": {"$sum": "$total"}}},
            ]).to_list(1)
            if agg:
                orders_count = int(agg[0].get("n") or 0)
                revenue = float(agg[0].get("rev") or 0.0)

        sellers.append({
            "id": _seller_id(name),
            "name": name,
            "location": ", ".join(sorted(b["locations"])) or "—",
            "total_products": len(b["item_ids"]),
            "total_orders": orders_count,
            "revenue_generated": round(revenue, 2),
            "last_active": b["last"],
            "status": "active" if b["any_live"] else "inactive",
            "item_ids": b["item_ids"],
        })
    return sellers


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
# Products
# ---------------------------------------------------------------------------

_CATEGORY_RULES: list[tuple[list[str], str]] = [
    (["iphone", "samsung galaxy", "pixel", "smartphone", "mobile phone", "ipad", "tablet"], "phones-tablets"),
    (["laptop", "macbook", "notebook", "monitor", "keyboard", "mouse", "ssd", "gpu", "desktop", "pc "], "laptops-computers"),
    (["tv", "television", "projector", "soundbar", "home theatre", "home theater"], "tvs-home-theatre"),
    (["headphone", "earbud", "airpods", "speaker", "hi-fi", "hifi", " amp "], "audio-headphones"),
    (["camera", "lens", "gopro", "drone"], "cameras-photo"),
    (["playstation", "ps5", "xbox", "nintendo", "switch", "controller", "gaming"], "gaming"),
    (["smart watch", "smartwatch", "fitbit", "garmin", "smart home", "echo", "alexa"], "wearables-smart-home"),
    (["kitchen", "cookware", "coffee", "espresso", "kettle", "toaster", "microwave", "blender"], "kitchen-dining"),
    (["sofa", "couch", "chair", "desk", "table", "wardrobe"], "furniture"),
    (["rug", "wall art", "mirror", "lamp", "candle", "vase"], "home-decor-lighting"),
    (["mattress", "linen", "towel", "quilt", "duvet", "pillow"], "bedroom-bath"),
    (["vacuum", "robot vac", "mop", "cleaner"], "vacuums-cleaning"),
    (["bbq", "garden", "outdoor", "lawn", "mower", "shed"], "garden-outdoor"),
    (["drill", "impact driver", "grinder", "sander", "circular saw", "power tool"], "power-tools"),
    (["hammer", "spanner", "wrench", "screwdriver", "plier", "tape measure"], "hand-tools"),
    (["dash cam", "car ", "auto ", "tyre", "engine oil", "towbar"], "automotive"),
    (["workbench", "tool cabinet", "tool box", "workshop"], "workshop-storage"),
    (["hi-vis", "safety boot", "ppe", "helmet", "gloves"], "safety-workwear"),
    (["men's ", "mens shirt", "mens jeans", "mens jacket", "mens hoodie"], "mens-clothing"),
    (["women's ", "womens dress", "womens top", "womens jeans"], "womens-clothing"),
    (["shoe", "sneaker", "boot", "sandal"], "shoes-sneakers"),
    (["watch", "ring ", "necklace", "bracelet", "earring"], "watches-jewellery"),
    (["dumbbell", "bench press", "treadmill", "yoga", "gym", "exercise bike"], "fitness-gym"),
    (["tent", "sleeping bag", "hiking", "camping"], "outdoor-camping"),
    (["bike", "bicycle", "cycling", "mtb"], "cycling"),
    (["lego", "building block", "brick"], "lego-building"),
    (["board game", "card game", "puzzle"], "board-games-puzzles"),
    (["pokemon", "trading card", "figurine", "funko", "collectible"], "collectibles-trading-cards"),
]

# Map eBay's own top-level breadcrumb crumbs to the closest store slug.
_EBAY_BREADCRUMB_MAP: dict[str, str] = {
    "cell phones & accessories": "phones-tablets",
    "mobile phones & communication": "phones-tablets",
    "computers/tablets & networking": "laptops-computers",
    "computers, tablets & network hardware": "laptops-computers",
    "tv, video & home audio": "tvs-home-theatre",
    "sound & vision": "tvs-home-theatre",
    "cameras & photo": "cameras-photo",
    "video games & consoles": "gaming",
    "smart home": "wearables-smart-home",
    "jewellery & watches": "watches-jewellery",
    "jewelry & watches": "watches-jewellery",
    "home & garden": "home-decor-lighting",
    "kitchen, dining & bar": "kitchen-dining",
    "small kitchen appliances": "kitchen-dining",
    "furniture": "furniture",
    "bedding": "bedroom-bath",
    "vehicle parts & accessories": "automotive",
    "auto parts & accessories": "automotive",
    "business & industrial": "workshop-storage",
    "power tools": "power-tools",
    "hand tools": "hand-tools",
    "clothing, shoes & accessories": "shoes-sneakers",
    "men's clothing": "mens-clothing",
    "women's clothing": "womens-clothing",
    "sporting goods": "fitness-gym",
    "cycling": "cycling",
    "outdoor sports": "outdoor-camping",
    "toys & hobbies": "lego-building",
    "toys, hobbies": "lego-building",
    "collectables": "collectibles-trading-cards",
    "collectibles": "collectibles-trading-cards",
    "trading card games": "collectibles-trading-cards",
}


def _match_rules(text: str) -> Optional[str]:
    t = (text or "").lower()
    if not t:
        return None
    for keywords, slug in _CATEGORY_RULES:
        if any(k in t for k in keywords):
            return slug
    return None


def _guess_category(
    title: Optional[str] = None,
    breadcrumbs: Optional[list[str]] = None,
    specifics: Optional[dict] = None,
) -> str:
    """Guess a store category slug from (in priority): breadcrumbs, specifics, title."""
    # 1. eBay breadcrumb — walk from leaf → root, prefer more specific matches
    for crumb in reversed(breadcrumbs or []):
        c = crumb.lower().strip()
        if c in _EBAY_BREADCRUMB_MAP:
            return _EBAY_BREADCRUMB_MAP[c]
        # Try partial match against the map keys
        for key, slug in _EBAY_BREADCRUMB_MAP.items():
            if key in c or c in key:
                return slug
        # Fall back to keyword rules on the crumb text
        hit = _match_rules(c)
        if hit:
            return hit

    # 2. Item specifics — Brand / Type / Category / Model / Sub-Type
    if specifics:
        for key in ("Category", "Sub-Type", "Type", "Product Type", "Model", "Brand"):
            v = specifics.get(key)
            if v:
                hit = _match_rules(str(v))
                if hit:
                    return hit

    # 3. Title
    hit = _match_rules(title or "")
    return hit or "other"


# ---------------------------------------------------------------------------
# Notifications (price-change alerts)
# ---------------------------------------------------------------------------

class Notification(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str = "price_change"
    product_id: Optional[str] = None
    product_title: Optional[str] = None
    image: Optional[str] = None
    ebay_url: Optional[str] = None
    item_id: Optional[str] = None
    old_price: Optional[float] = None
    new_price: Optional[float] = None
    old_sell: Optional[float] = None
    new_sell: Optional[float] = None
    old_profit: Optional[float] = None
    new_profit: Optional[float] = None
    old_margin_pct: Optional[float] = None
    new_margin_pct: Optional[float] = None
    delta_margin: Optional[float] = None
    at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    read: bool = False


async def _emit_price_change_notifications(item: dict, new_image: Optional[str], new_title: str,
                                           old_price: float, new_price: float, now_iso: str) -> None:
    """Create a notification for each product linked to this scraped item."""
    ebay_item_id = item.get("item_id") or item.get("id")
    if not ebay_item_id:
        return
    rules = await _load_pricing_rules()
    old_calc = calc_pricing(old_price, rules=rules)
    new_calc = calc_pricing(new_price, rules=rules)

    def margin_pct(sell: float, cost: float) -> float:
        return round(((sell - cost) / sell) * 100, 2) if sell > 0 else 0.0

    old_margin = margin_pct(old_calc["sell_price"], old_price)
    new_margin = margin_pct(new_calc["sell_price"], new_price)

    products = await db.products.find(
        {"source_item_id": ebay_item_id}, {"_id": 0, "id": 1, "title": 1, "images": 1}
    ).to_list(50)

    # No linked products yet — still emit one notification tied to the scraped item so
    # the user sees eBay-side price movement in their bell drop-down.
    targets = products or [{"id": None, "title": new_title, "images": item.get("images") or []}]

    for p in targets:
        n = Notification(
            product_id=p.get("id"),
            product_title=p.get("title") or new_title,
            image=(p.get("images") or [None])[0] or new_image,
            ebay_url=item.get("url"),
            item_id=ebay_item_id,
            old_price=round(float(old_price), 2),
            new_price=round(float(new_price), 2),
            old_sell=old_calc["sell_price"],
            new_sell=new_calc["sell_price"],
            old_profit=old_calc["profit"],
            new_profit=new_calc["profit"],
            old_margin_pct=old_margin,
            new_margin_pct=new_margin,
            delta_margin=round(new_margin - old_margin, 2),
            at=now_iso,
        )
        await db.notifications.insert_one(n.model_dump())


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

def calc_pricing(ebay_price: float, rules: Optional[list[dict]] = None,
                 margin_pct: float = 20.0, min_profit: float = 20.0) -> dict:
    """Compute sell + profit from an eBay price.

    - If `rules` are provided, walk them in `sort_order` and pick the first active rule
      whose min_price <= ebay < max_price (max_price=None means +inf). Apply either
      `flat` ($) or `percent` (%).
    - If no rule matches (or `rules` is None/empty), fall back to `sell = ebay * (1 +
      margin_pct/100) + min_profit`.
    """
    ebay = round(float(ebay_price or 0), 2)
    if ebay <= 0:
        return {"ebay_price": 0.0, "sell_price": 0.0, "profit": 0.0, "matched_rule": None}

    matched = None
    if rules:
        for r in rules:
            if not r.get("active", True):
                continue
            min_p = float(r.get("min_price") or 0)
            max_p = r.get("max_price")
            max_ok = (max_p is None) or (ebay < float(max_p))
            if ebay >= min_p and max_ok:
                matched = r
                break

    if matched:
        if matched["kind"] == "percent":
            sell = ebay * (1 + float(matched["value"]) / 100.0)
        else:  # flat
            sell = ebay + float(matched["value"])
    else:
        sell = ebay * (1 + margin_pct / 100.0) + min_profit

    sell = round(sell, 2)
    return {
        "ebay_price": ebay,
        "sell_price": sell,
        "profit": round(sell - ebay, 2),
        "matched_rule": (
            {k: matched[k] for k in ("id", "label", "min_price", "max_price", "kind", "value")}
            if matched else None
        ),
    }


class PricingRuleBase(BaseModel):
    label: Optional[str] = ""
    min_price: float = 0.0
    max_price: Optional[float] = None  # None = infinity
    kind: str = "flat"  # "flat" | "percent"
    value: float = 0.0
    active: bool = True
    sort_order: int = 0


class PricingRule(PricingRuleBase):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class PricingRuleUpdate(BaseModel):
    label: Optional[str] = None
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    kind: Optional[str] = None
    value: Optional[float] = None
    active: Optional[bool] = None
    sort_order: Optional[int] = None


_DEFAULT_PRICING_RULES = [
    {"label": "Tiny items",  "min_price": 1,   "max_price": 5,    "kind": "flat",    "value": 2,  "sort_order": 10},
    {"label": "Cheap",       "min_price": 5,   "max_price": 20,   "kind": "flat",    "value": 5,  "sort_order": 20},
    {"label": "Mid",         "min_price": 20,  "max_price": 50,   "kind": "flat",    "value": 15, "sort_order": 30},
    {"label": "Premium",     "min_price": 50,  "max_price": 100,  "kind": "percent", "value": 20, "sort_order": 40},
    {"label": "High-ticket", "min_price": 100, "max_price": None, "kind": "percent", "value": 15, "sort_order": 50},
]


async def _ensure_pricing_rules_seeded() -> None:
    if await db.pricing_rules.count_documents({}) > 0:
        return
    for r in _DEFAULT_PRICING_RULES:
        rule = PricingRule(**r)
        await db.pricing_rules.insert_one(rule.model_dump())
    logger.info(f"Seeded {len(_DEFAULT_PRICING_RULES)} pricing rules")


async def _load_pricing_rules() -> list[dict]:
    cursor = db.pricing_rules.find({"active": True}, {"_id": 0}).sort("sort_order", 1)
    return await cursor.to_list(500)


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
    prod = Product(
        title=it.get("title") or "Untitled",
        price=pricing["sell_price"],
        cost=cost,
        stock=10,
        category=it.get("category") or _guess_category(
            title=it.get("title") or "",
            breadcrumbs=it.get("ebay_category_path") or [],
            specifics=it.get("specifics") or {},
        ),
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
        "shipping_address": (body.shipping_address.model_dump() if body.shipping_address else None),
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
