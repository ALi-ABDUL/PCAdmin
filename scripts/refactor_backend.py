#!/usr/bin/env python3
"""Split server.py into deps.py + models.py + helpers.py + slim server.py"""
import re
from pathlib import Path

BACK = Path('/app/backend')
SERVER = BACK / 'server.py'
lines = SERVER.read_text().splitlines(keepends=True)

def slc(s, e):  # 1-indexed inclusive
    return ''.join(lines[s-1:e])

# ---------------------------------------------------------------------------
# MODELS.PY blocks
# ---------------------------------------------------------------------------
MODELS_BLOCKS = [
    (45, 85),      # CATEGORIES + SEED_CATEGORIES
    (91, 145),     # ScrapeRequest + ScrapedItem + WatchlistToggle
    (147, 195),    # ProductCreate + Product + ProductUpdate + ShippingAddress
    (198, 214),    # _AU_SUBURBS + _STREET_NAMES + _STREET_TYPES
    (232, 248),    # OrderCreate + Settings
    (257, 257),    # _DAY_LETTERS
    (313, 342),    # Category models
    (582, 585),    # ItemBulkAction
    (705, 708),    # RefreshAllRequest
    (734, 758),    # Scraper schedule constants (SCRAPER_SCHEDULE_DEFAULTS + timing constants)
    (759, 759),    # _SYDNEY
    (938, 942),    # ScraperScheduleUpdate
    (1088, 1088),  # ORDER_STATUSES
    (1091, 1117),  # ReturnRequest + AbandonedCart + Transaction
    (1298, 1342),  # Customer models
    (1471, 1487),  # Coupon models
    (1509, 1526),  # Review models
    (1592, 1593),  # JWT_ALGO + JWT_ACCESS_TTL
    (1643, 1663),  # Portal body models
    (1803, 1814),  # Message models
    (1834, 1839),  # StockMove
    (2001, 2067),  # _CATEGORY_RULES + _EBAY_BREADCRUMB_MAP
    (2117, 2146),  # Notification
    (2151, 2164),  # PUSH_SETTINGS_DEFAULTS + PUSH_CRITICAL_TYPES
    (2327, 2337),  # PushSettingsUpdate
    (2540, 2573),  # Pricing models + _DEFAULT_PRICING_RULES
    (2813, 2815),  # BulkProductIds
]

# helpers.py blocks
HELPERS_BLOCKS = [
    (217, 230),    # _rand_au_address
    (250, 251),    # _slug
    (260, 265),    # _product_code_base
    (267, 277),    # _generate_unique_product_code
    (280, 294),    # _ensure_product_codes_backfilled
    (297, 310),    # _ensure_order_references_backfilled
    (711, 727),    # _refresh_all_items
    (762, 796),    # _get_scraper_schedule + _compute_next_run
    (798, 821),    # _classify_run + _push_run_history
    (823, 936),    # _refresh_all_and_record + _scheduler_loop
    (1012, 1023),  # _ensure_categories_seeded
    (1120, 1191),  # _now_iso + _seed_transactions_and_returns
    (1343, 1373),  # _rebuild_customers_from_orders
    (1528, 1537),  # _shape_review
    (1596, 1642),  # portal helpers (part 1: _jwt_secret ... get_current_customer)
    (1665, 1675),  # portal helpers (part 2: _has_purchased) — skip 1643-1663 which are Pydantic models
    (1882, 1937),  # supplier helpers
    (2069, 2111),  # category classification
    (2166, 2325),  # push notification helpers
    (2406, 2463),  # _emit_notification + _emit_price_change_notifications
    (2494, 2538),  # calc_pricing
    (2575, 2587),  # pricing rules helpers
]

def ranges_to_set(blocks):
    return set(i for (s, e) in blocks for i in range(s, e+1))

MODELS_LINES = ranges_to_set(MODELS_BLOCKS)
HELPERS_LINES = ranges_to_set(HELPERS_BLOCKS)

# Ranges to strip from server.py (kept: everything else except old imports)
STRIP_LINES = MODELS_LINES | HELPERS_LINES
# Also strip the top-of-file setup that moves to deps.py: lines 1-43
STRIP_LINES.update(range(1, 44))
# Strip section header comments that are now empty (86-89, 254-256, 345-347 etc.) — leave for now

# ---------------------------------------------------------------------------
# Build models.py
# ---------------------------------------------------------------------------
MODELS_HEADER = '''"""Pydantic models + module-level data constants for the Admin Dashboard API.
Extracted from server.py during modular refactor (Feb 2026)."""
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import uuid


'''
models_body = ''
for (s, e) in MODELS_BLOCKS:
    models_body += slc(s, e)
    if not models_body.endswith('\n\n'):
        models_body += '\n'

(BACK / 'models.py').write_text(MODELS_HEADER + models_body)
print(f"WROTE models.py  ({(BACK/'models.py').stat().st_size} bytes)")

# ---------------------------------------------------------------------------
# Build deps.py
# ---------------------------------------------------------------------------
DEPS_TEXT = '''"""Shared app-level dependencies (app, router, db, logger).
Imported by server.py, helpers.py, and (via server.py) all endpoints.
Extracted from server.py during modular refactor (Feb 2026)."""
from fastapi import FastAPI, APIRouter
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path
import os
import logging

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Admin Dashboard API — Product Sourcing")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
'''
(BACK / 'deps.py').write_text(DEPS_TEXT)
print(f"WROTE deps.py")

# ---------------------------------------------------------------------------
# Build helpers.py
# ---------------------------------------------------------------------------
HELPERS_HEADER = '''"""Non-endpoint helper functions for the Admin Dashboard API.
These are called by endpoints in server.py and by the scheduler startup task.
Extracted from server.py during modular refactor (Feb 2026)."""
import asyncio
import re
import os
import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import Header, HTTPException

import bcrypt
import jwt
import resend

from deps import db, logger
from scraper import (
    ScrapeError, NotEbayAUError, BlockedError,
    validate_ebay_au_url, fetch_html, parse_and_enrich,
)
from models import (
    CATEGORIES, SEED_CATEGORIES,
    _AU_SUBURBS, _STREET_NAMES, _STREET_TYPES, _DAY_LETTERS,
    _SYDNEY, ORDER_STATUSES, _CATEGORY_RULES, _EBAY_BREADCRUMB_MAP,
    PUSH_SETTINGS_DEFAULTS, PUSH_CRITICAL_TYPES, _DEFAULT_PRICING_RULES,
    SCRAPER_SCHEDULE_DEFAULTS, RETRY_DELAY_SECONDS, RUN_HISTORY_LIMIT, FREQ_INTERVAL_SECONDS,
    JWT_ALGO, JWT_ACCESS_TTL,
    Category, Customer, Notification, PricingRule, ScrapeRequest,
)
import httpx


'''
helpers_body = ''
for (s, e) in HELPERS_BLOCKS:
    helpers_body += slc(s, e)
    if not helpers_body.endswith('\n\n'):
        helpers_body += '\n'

(BACK / 'helpers.py').write_text(HELPERS_HEADER + helpers_body)
print(f"WROTE helpers.py  ({(BACK/'helpers.py').stat().st_size} bytes)")

# ---------------------------------------------------------------------------
# Rebuild server.py: strip extracted lines, add new top imports
# ---------------------------------------------------------------------------
SERVER_NEW_HEAD = '''"""FastAPI endpoints for the Admin Dashboard API.
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
from typing import Optional, List

import resend
import bcrypt
import jwt

from deps import app, api_router, db, client, logger
from scraper import (
    ScrapeError, NotEbayAUError, BlockedError,
    validate_ebay_au_url, fetch_html, parse_and_enrich,
)
from models import *  # noqa: F401,F403 — Pydantic models + data constants
from helpers import *  # noqa: F401,F403 — Non-endpoint helpers


'''

kept_lines = []
for i, ln in enumerate(lines, start=1):
    if i in STRIP_LINES:
        continue
    kept_lines.append(ln)

server_new = SERVER_NEW_HEAD + ''.join(kept_lines)
SERVER.write_text(server_new)
print(f"WROTE server.py  ({SERVER.stat().st_size} bytes, {server_new.count(chr(10))} lines)")
