"""Pydantic models + module-level data constants for the Admin Dashboard API.
Extracted from server.py during modular refactor (Feb 2026)."""
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import uuid


__all__ = ['CATEGORIES', 'SEED_CATEGORIES', 'ScrapeRequest', 'ScrapedItem', 'WatchlistToggle', 'ProductCreate', 'Product', 'ProductUpdate', 'ShippingAddress', '_AU_SUBURBS', '_STREET_NAMES', '_STREET_TYPES', 'OrderCreate', 'Settings', '_DAY_LETTERS', 'Category', 'CategoryCreate', 'CategoryUpdate', 'ItemBulkAction', 'RefreshAllRequest', 'SCRAPER_SCHEDULE_DEFAULTS', 'RETRY_DELAY_SECONDS', 'RUN_HISTORY_LIMIT', 'FREQ_INTERVAL_SECONDS', '_SYDNEY', 'ScraperScheduleUpdate', 'ORDER_STATUSES', 'ReturnRequest', 'AbandonedCart', 'Transaction', 'CustomerBase', 'Customer', 'CustomerUpdate', 'CouponBase', 'Coupon', 'ReviewBase', 'Review', 'JWT_ALGO', 'JWT_ACCESS_TTL', 'PortalRegisterBody', 'PortalLoginBody', 'PortalReviewBody', 'PortalReviewVoteBody', 'MessageBase', 'Message', 'StockMove', '_CATEGORY_RULES', '_EBAY_BREADCRUMB_MAP', 'Notification', 'PUSH_SETTINGS_DEFAULTS', 'PUSH_CRITICAL_TYPES', 'PushSettingsUpdate', 'PricingRuleBase', 'PricingRule', 'PricingRuleUpdate', '_DEFAULT_PRICING_RULES', 'BulkProductIds']


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
    variants: List[dict] = Field(default_factory=list)
    category: Optional[str] = None
    method_used: Optional[str] = None
    watchlisted: bool = False
    active: bool = True
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
    stock_status: str = "live"          # live | sold | ended | out_of_stock
    is_sold: bool = False               # kept for backward compat (True iff stock_status != "live")
    archived: bool = False
    archived_at: Optional[str] = None
    product_code: Optional[str] = None  # public reference — e.g. KF21-PC0826 (auto-generated on create)
    variants: List[dict] = Field(default_factory=list)  # [{type, option, price, currency, stock_status, sku?}]
    specifics: dict = Field(default_factory=dict)   # scraped eBay item specifics (label → value)


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
    stock_status: Optional[str] = None
    archived: Optional[bool] = None


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

_DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"]  # Mon..Sun (matches user spec: first letter of day)

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

class ItemBulkAction(BaseModel):
    ids: List[str]
    action: str   # "delete" | "deactivate" | "activate"

class RefreshAllRequest(BaseModel):
    method: str = "auto"
    scrapingbee_key: Optional[str] = None
    scraperapi_key: Optional[str] = None

SCRAPER_SCHEDULE_DEFAULTS: dict = {
    "id": "singleton",
    "enabled": True,
    "start_time_hhmm": "02:00",       # local time (Australia/Sydney)
    "frequency": "daily",              # hourly | every_6h | every_12h | daily | weekly
    "stop_date": None,                 # ISO date (YYYY-MM-DD) — schedule pauses on or after this
    "last_run_at": None,
    "last_run_stats": None,
    "next_run_at": None,
    # Run history: newest first, capped at 20 entries.
    # Each entry: {id, started_at, finished_at, duration_seconds, status, attempt, trigger, stats, error}
    "run_history": [],
    # Set when a scheduled run fails and a retry is queued for 15 min later.
    # Shape: {"retry_at": iso, "original_run_id": id, "trigger": "scheduled"|"manual"}
    "retry_pending": None,
}
RETRY_DELAY_SECONDS = 15 * 60  # 15 minutes
RUN_HISTORY_LIMIT = 20
FREQ_INTERVAL_SECONDS = {
    "hourly":    60 * 60,
    "every_6h":  6 * 60 * 60,
    "every_12h": 12 * 60 * 60,
    "daily":     24 * 60 * 60,
    "weekly":    7 * 24 * 60 * 60,
}

_SYDNEY = timezone(timedelta(hours=10))  # rough AEST; the UI only uses this for display anchoring

class ScraperScheduleUpdate(BaseModel):
    enabled: Optional[bool] = None
    start_time_hhmm: Optional[str] = None    # "HH:MM"
    frequency: Optional[str] = None          # keys of FREQ_INTERVAL_SECONDS
    stop_date: Optional[str] = None          # "YYYY-MM-DD" or "" to clear

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
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postcode: Optional[str] = None


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

class ReviewBase(BaseModel):
    product_id: str
    customer_name: str = "Anonymous"
    customer_email: Optional[str] = ""
    rating: int = 5
    title: Optional[str] = ""
    body: Optional[str] = ""
    status: str = "approved"     # pending | approved | rejected — portal reviews are auto-approved (verified)
    order_id: Optional[str] = ""
    verified_purchase: bool = False


class Review(ReviewBase):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    helpful_votes: List[str] = Field(default_factory=list)      # customer emails that voted helpful
    not_helpful_votes: List[str] = Field(default_factory=list)  # customer emails that voted not-helpful

JWT_ALGO = "HS256"
JWT_ACCESS_TTL = timedelta(days=7)  # portal sessions last a week

class PortalRegisterBody(BaseModel):
    email: str
    password: str
    name: Optional[str] = ""


class PortalLoginBody(BaseModel):
    email: str
    password: str


class PortalReviewBody(BaseModel):
    product_id: str
    rating: int
    title: Optional[str] = ""
    body: Optional[str] = ""


class PortalReviewVoteBody(BaseModel):
    vote: str  # "helpful" | "not_helpful" | "clear"

class MessageBase(BaseModel):
    customer_name: str
    customer_email: Optional[str] = ""
    subject: str = ""
    body: str = ""
    status: str = "new"  # new | read | archived


class Message(MessageBase):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class StockMove(BaseModel):
    product_id: str
    delta: int
    kind: str = "adjustment"  # opening | count | adjustment | receive | sale | return
    reason: Optional[str] = ""

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

class Notification(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    # type ∈ price_change | new_order | out_of_stock | low_stock | order_status | new_customer
    type: str = "price_change"
    title: Optional[str] = None
    body: Optional[str] = None
    # Deep-link target: any of these tells the frontend where to route on click.
    product_id: Optional[str] = None
    order_id: Optional[str] = None
    customer_id: Optional[str] = None
    item_id: Optional[str] = None
    ebay_url: Optional[str] = None
    # Visuals
    product_title: Optional[str] = None
    image: Optional[str] = None
    # Price-change specifics (retained for existing rows)
    old_price: Optional[float] = None
    new_price: Optional[float] = None
    old_sell: Optional[float] = None
    new_sell: Optional[float] = None
    old_profit: Optional[float] = None
    new_profit: Optional[float] = None
    old_margin_pct: Optional[float] = None
    new_margin_pct: Optional[float] = None
    delta_margin: Optional[float] = None
    # Generic payload for the newer types (kept flexible)
    data: dict = Field(default_factory=dict)
    at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    read: bool = False

PUSH_SETTINGS_DEFAULTS: dict = {
    "id": "singleton",
    "email_enabled": True,
    "telegram_enabled": True,
    "critical_only": True,           # if True, only pushes critical types (see PUSH_CRITICAL_TYPES)
    "margin_drop_threshold_pp": 3.0, # for price_change: skip unless margin drops by ≥ this many percentage points
    "resend_api_key": "",
    "resend_to_email": "",
    "resend_from_email": "",
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    # Customer-facing transactional emails (sent to end-users via Resend). All ON by default.
    "customer_email_enabled": True,               # master switch
    "customer_order_confirmation": True,           # new order → confirm email to buyer
    "customer_order_status_update": True,          # status → processing / shipped / delivered
    "customer_order_cancellation": True,           # status → cancelled
    "customer_welcome_email": True,                # portal register → welcome email
}
PUSH_CRITICAL_TYPES = {"new_order", "out_of_stock", "price_change", "new_payment", "cancellation_request", "low_stock"}

class PushSettingsUpdate(BaseModel):
    email_enabled: Optional[bool] = None
    telegram_enabled: Optional[bool] = None
    critical_only: Optional[bool] = None
    margin_drop_threshold_pp: Optional[float] = None
    resend_api_key: Optional[str] = None
    resend_to_email: Optional[str] = None
    resend_from_email: Optional[str] = None
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    customer_email_enabled: Optional[bool] = None
    customer_order_confirmation: Optional[bool] = None
    customer_order_status_update: Optional[bool] = None
    customer_order_cancellation: Optional[bool] = None
    customer_welcome_email: Optional[bool] = None

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

class BulkProductIds(BaseModel):
    product_ids: List[str]

