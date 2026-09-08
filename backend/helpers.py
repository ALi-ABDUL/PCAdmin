"""Non-endpoint helper functions for the Admin Dashboard API.
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

__all__ = ['_rand_au_address', '_slug', '_default_seo', '_suggest_tags', '_product_code_base', '_generate_unique_product_code', '_ensure_product_codes_backfilled', '_ensure_order_references_backfilled', '_refresh_all_items', '_get_scraper_schedule', '_compute_next_run', '_compute_next_run_for', '_classify_run', '_push_run_history', '_refresh_all_and_record', '_update_schedule_entry', '_scheduler_loop', '_ensure_categories_seeded', '_ensure_ebay_category', '_now_iso', '_seed_transactions_and_returns', '_rebuild_customers_from_orders', '_shape_review', '_jwt_secret', '_hash_password', '_verify_password', '_issue_token', 'get_current_customer', '_has_purchased', '_seller_id', '_build_sellers', '_match_rules', '_guess_category', '_get_push_settings', '_mask', '_get_credential', '_push_channel_status', '_notif_is_critical', '_send_email', '_send_telegram', '_format_notification_html', '_push_notification', '_emit_notification', '_emit_price_change_notifications', '_auto_archive_if_out_of_stock', 'calc_pricing', '_ensure_pricing_rules_seeded', '_load_pricing_rules', 'send_customer_email', 'send_customer_order_confirmation', 'send_customer_order_status_update', 'send_customer_order_cancellation', 'send_customer_welcome_email', 'CUSTOMER_EMAIL_KINDS', '_customer_email_html', '_ensure_postage_presets_seeded', '_get_delivery_settings', '_delete_categories_if_empty', '_ensure_main_admin_seeded', '_ensure_country_access_seeded', '_get_country_access', '_client_country', '_client_ip', '_bypass_active_for_ip', '_grant_bypass', '_purge_expired_bypasses', '_ensure_disposable_domains_seeded', '_get_disposable_domains', '_is_disposable_email', '_normalise_domain']


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
    PostagePreset, _DEFAULT_POSTAGE_PRESETS, DELIVERY_SETTINGS_DEFAULTS,
    AdminAccount, _DEFAULT_MAIN_ADMIN,
)
import httpx


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

def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-") or "cat"


def _default_seo(title: str, description: str, category: Optional[str] = None) -> dict:
    """Compute default SEO field values from a product's title + description.

    Every value is safe to overwrite — the frontend loads them straight
    into editable inputs. Meta description is stripped of HTML and hard-
    capped at 160 chars (Google's typical SERP snippet length).
    `tags` are seeded from the title + category so the admin has a starting
    point they can extend, edit, or clear.
    """
    t = (title or "").strip() or "Untitled product"
    meta_title = t if len(t) <= 60 else t[:57].rstrip() + "…"
    # Remove HTML tags / repeated whitespace from description, then trim.
    plain = re.sub(r"<[^>]+>", " ", (description or ""))
    plain = re.sub(r"\s+", " ", plain).strip()
    if not plain:
        plain = t
    meta_desc = plain[:160] if len(plain) <= 160 else plain[:157].rstrip() + "…"
    return {
        "meta_title": meta_title,
        "meta_description": meta_desc,
        "url_slug": _slug(t),
        "image_alt_text": t,
        "tags": _suggest_tags(t, category),
    }


# Very small English stop-word list. eBay titles are keyword-heavy already so
# we only strip the truly noisy connectors — anything specific (brand names,
# model numbers, materials) stays as a candidate tag.
_TAG_STOPWORDS = {
    "the", "a", "an", "and", "or", "for", "with", "of", "in", "on", "by",
    "to", "at", "from", "is", "be", "as", "it", "this", "that", "these",
    "those", "new", "&", "-", "vs",
}


def _suggest_tags(title: str, category: Optional[str] = None, limit: int = 8) -> list:
    """Return a small ordered list of tag suggestions derived from title +
    category. Tokens are lower-cased, de-duplicated, stripped of stop-words,
    and capped at `limit`. Category slug is added as-is (space-separated) so
    "vacuums-cleaning" becomes "vacuums cleaning".

    Callers are always free to overwrite the result — this is only a
    starting point for the SEO card.
    """
    out: list = []
    seen: set = set()

    def _push(tok: str) -> None:
        s = (tok or "").strip().lower()
        if not s or s in _TAG_STOPWORDS or len(s) < 2 or s in seen:
            return
        seen.add(s)
        out.append(s)

    # Category first so the most descriptive tag lands at the front. Slugs
    # like "vacuums-cleaning" become two tokens.
    if category and category != "other":
        for tok in re.split(r"[-_/\s]+", str(category)):
            _push(tok)

    # Title tokens — keep alphanumerics of length >= 2. Drops punctuation
    # noise ("(new)", "-", ",", etc.) but retains model numbers and sizes.
    for tok in re.findall(r"[A-Za-z0-9]+", title or ""):
        _push(tok)
        if len(out) >= limit:
            break

    return out[:limit]

def _product_code_base(title: str, dt: Optional[datetime] = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    first = next((ch for ch in (title or "") if ch.isalnum()), "X").upper()[:1]
    day_letter = _DAY_LETTERS[dt.weekday()]
    return f"{first}{day_letter}{dt.day:02d}-PC{dt.month:02d}{dt.year % 100:02d}"

async def _generate_unique_product_code(title: str, dt: Optional[datetime] = None) -> str:
    """Return a product_code guaranteed unique in db.products."""
    base = _product_code_base(title, dt)
    if not await db.products.find_one({"product_code": base}, {"_id": 1}):
        return base
    n = 2
    while True:
        candidate = f"{base}-{n}"
        if not await db.products.find_one({"product_code": candidate}, {"_id": 1}):
            return candidate
        n += 1

async def _ensure_product_codes_backfilled() -> None:
    """One-shot backfill: assign product_code to any product missing one.
    Uses the product's created_at (falls back to now) so codes reflect the real scrape day."""
    cursor = db.products.find({"$or": [{"product_code": {"$exists": False}}, {"product_code": None}, {"product_code": ""}]}, {"_id": 0, "id": 1, "title": 1, "created_at": 1})
    count = 0
    async for p in cursor:
        try:
            dt = datetime.fromisoformat(p.get("created_at") or "") if p.get("created_at") else None
        except Exception:
            dt = None
        code = await _generate_unique_product_code(p.get("title") or "Product", dt)
        await db.products.update_one({"id": p["id"]}, {"$set": {"product_code": code}})
        count += 1
    if count:
        logger.info(f"backfilled product_code on {count} products")

async def _ensure_order_references_backfilled() -> None:
    """Backfill reference on existing orders using their linked product's product_code."""
    cursor = db.orders.find({"$or": [{"reference": {"$exists": False}}, {"reference": None}, {"reference": ""}]}, {"_id": 0, "id": 1, "product_id": 1})
    count = 0
    async for o in cursor:
        pid = o.get("product_id")
        if not pid:
            continue
        p = await db.products.find_one({"id": pid}, {"_id": 0, "product_code": 1})
        if p and p.get("product_code"):
            await db.orders.update_one({"id": o["id"]}, {"$set": {"reference": p["product_code"]}})
            count += 1
    if count:
        logger.info(f"backfilled reference on {count} orders")

async def _refresh_all_items(method: str = "auto", scrapingbee_key: Optional[str] = None, scraperapi_key: Optional[str] = None) -> dict:
    """Re-scrape every stored item; detects sold status + updates delivery estimate."""
    from server import scrape  # late import to avoid circular dependency
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

async def _get_scraper_schedule() -> dict:
    doc = await db.scraper_schedule.find_one({"id": "singleton"}, {"_id": 0})
    if not doc:
        await db.scraper_schedule.insert_one({**SCRAPER_SCHEDULE_DEFAULTS})
        doc = {**SCRAPER_SCHEDULE_DEFAULTS}
    merged = {**SCRAPER_SCHEDULE_DEFAULTS, **doc}
    # Auto-migrate: legacy singletons only carry the scalar fields — seed a
    # `schedules[0]` mirror the first time we read them so the multi-schedule
    # UI has something to render.
    if not merged.get("schedules"):
        merged["schedules"] = [{
            "id": uuid.uuid4().hex,
            "enabled": bool(merged.get("enabled", True)),
            "start_time_hhmm": merged.get("start_time_hhmm") or "02:00",
            "frequency": merged.get("frequency") or "daily",
            "stop_date": merged.get("stop_date"),
            "next_run_at": merged.get("next_run_at"),
            "last_run_at": merged.get("last_run_at"),
            "last_run_stats": merged.get("last_run_stats"),
        }]
        await db.scraper_schedule.update_one(
            {"id": "singleton"}, {"$set": {"schedules": merged["schedules"]}}, upsert=True,
        )
    return merged


def _compute_next_run_for(entry: dict) -> Optional[str]:
    """Next fire time (UTC ISO) for ONE schedule entry."""
    if not entry.get("enabled"):
        return None
    now = datetime.now(timezone.utc)
    hh, mm = (entry.get("start_time_hhmm") or "02:00").split(":")
    try:
        anchor = now.astimezone(_SYDNEY).replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
    except Exception:
        anchor = now.astimezone(_SYDNEY).replace(hour=2, minute=0, second=0, microsecond=0)
    anchor_utc = anchor.astimezone(timezone.utc)
    interval = timedelta(seconds=FREQ_INTERVAL_SECONDS.get(entry.get("frequency", "daily"), 86400))
    while anchor_utc <= now:
        anchor_utc = anchor_utc + interval
    stop = entry.get("stop_date")
    if stop:
        try:
            stop_dt = datetime.fromisoformat(stop).replace(tzinfo=timezone.utc)
            if anchor_utc >= stop_dt:
                return None
        except Exception:
            pass
    return anchor_utc.isoformat()


def _compute_next_run(sched: dict) -> Optional[str]:
    """Doc-level convenience: earliest next run across all enabled schedules,
    or across the legacy scalar fields when no `schedules` list is present.
    Kept for backwards compatibility with the singleton API."""
    entries = sched.get("schedules") or []
    if not entries:
        # Legacy single-schedule path.
        return _compute_next_run_for({
            "enabled": sched.get("enabled"),
            "start_time_hhmm": sched.get("start_time_hhmm"),
            "frequency": sched.get("frequency"),
            "stop_date": sched.get("stop_date"),
        })
    nexts = [n for n in (_compute_next_run_for(e) for e in entries) if n]
    return min(nexts) if nexts else None

def _classify_run(summary: Optional[dict], error: Optional[str]) -> str:
    """success | failed — 'failed' triggers a retry when the run came from the scheduler."""
    if error:
        return "failed"
    if not summary:
        return "failed"
    total = int(summary.get("total") or 0)
    refreshed = int(summary.get("refreshed") or 0)
    # If there were items to refresh but none succeeded, treat as failure (likely bot-blocked/network).
    if total > 0 and refreshed == 0:
        return "failed"
    return "success"


async def _push_run_history(entry: dict) -> None:
    """Prepend an entry into scraper_schedule.run_history and cap at RUN_HISTORY_LIMIT."""
    sched = await _get_scraper_schedule()
    history = list(sched.get("run_history") or [])
    history.insert(0, entry)
    history = history[:RUN_HISTORY_LIMIT]
    await db.scraper_schedule.update_one(
        {"id": "singleton"}, {"$set": {"run_history": history}}, upsert=True,
    )

async def _refresh_all_and_record(method: str = "auto", trigger: str = "scheduled", attempt: int = 1, original_run_id: Optional[str] = None, schedule_id: Optional[str] = None) -> dict:
    """Run a full refresh and record the outcome in run_history. On failure of a scheduled run, queue a 15-min retry.

    `schedule_id` names which schedule entry fired this run (multi-schedule
    support). Manual runs pass `None` — they're not attached to any entry."""
    run_id = original_run_id or uuid.uuid4().hex
    started = datetime.now(timezone.utc)
    logger.info(f"scraper schedule: run starting · trigger={trigger} attempt={attempt} id={run_id} sched={schedule_id}")
    summary: Optional[dict] = None
    error: Optional[str] = None
    try:
        summary = await _refresh_all_items(method=method)
    except Exception as e:
        error = f"{type(e).__name__}: {e}"[:400]
        logger.exception(f"scraper schedule: run crashed · {error}")
    finished = datetime.now(timezone.utc)
    duration = (finished - started).total_seconds()
    status = _classify_run(summary, error)
    # If this is a retry that also failed, mark it 'dead' so the UI can highlight the give-up.
    if status == "failed" and attempt >= 2:
        status = "dead"

    entry = {
        "id": run_id,
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        "duration_seconds": round(duration, 2),
        "status": status,
        "attempt": attempt,
        "trigger": trigger,
        "stats": summary,
        "error": error,
        "schedule_id": schedule_id,
    }
    await _push_run_history(entry)

    # NOTE: failed / blocked scrapes are silent — no admin notification. Admins
    # can still inspect run history via GET /api/scraper/schedule.

    # Update last_run_at / last_run_stats on any completed attempt (doc-level
    # mirror for backwards compat + per-entry stamp).
    await db.scraper_schedule.update_one(
        {"id": "singleton"},
        {"$set": {"last_run_at": finished.isoformat(), "last_run_stats": summary}},
        upsert=True,
    )
    if schedule_id:
        await _update_schedule_entry(schedule_id, {
            "last_run_at": finished.isoformat(),
            "last_run_stats": summary,
        })

    # Retry orchestration: only for scheduled runs, only on first-attempt failure.
    retry_pending: Optional[dict] = None
    if trigger == "scheduled" and status == "failed" and attempt == 1:
        retry_at = (finished + timedelta(seconds=RETRY_DELAY_SECONDS)).isoformat()
        retry_pending = {"retry_at": retry_at, "original_run_id": run_id, "trigger": "scheduled", "schedule_id": schedule_id}
        logger.info(f"scraper schedule: queued retry at {retry_at} for run {run_id}")
    # Clear retry_pending after a retry attempt (success or dead).
    await db.scraper_schedule.update_one(
        {"id": "singleton"}, {"$set": {"retry_pending": retry_pending}}, upsert=True,
    )

    # Recompute next run (skip on retry — the primary schedule anchor is unchanged).
    if attempt == 1:
        sched = await _get_scraper_schedule()
        # Refresh next_run_at on every enabled entry AND the doc-level mirror.
        entries = sched.get("schedules") or []
        for e in entries:
            e["next_run_at"] = _compute_next_run_for(e)
        next_run_doc = min([e["next_run_at"] for e in entries if e.get("next_run_at")], default=None)
        await db.scraper_schedule.update_one(
            {"id": "singleton"},
            {"$set": {"schedules": entries, "next_run_at": next_run_doc}},
        )
        logger.info(f"scraper schedule: run done · status={status} · next {next_run_doc}")
    else:
        logger.info(f"scraper schedule: retry finished · status={status}")
    return summary or {"refreshed": 0, "sold_found": 0, "failed": 0, "total": 0, "error": error}


async def _update_schedule_entry(schedule_id: str, fields: dict) -> None:
    """Patch a single schedule entry inside the `schedules` list."""
    sched = await _get_scraper_schedule()
    entries = list(sched.get("schedules") or [])
    changed = False
    for e in entries:
        if e.get("id") == schedule_id:
            e.update(fields)
            changed = True
            break
    if changed:
        await db.scraper_schedule.update_one(
            {"id": "singleton"}, {"$set": {"schedules": entries}}, upsert=True,
        )


async def _scheduler_loop():
    """Poll the schedule config every minute and fire refresh-all when due (or retry when queued).

    Iterates every entry in `schedules` — each has its own start time,
    frequency and stop date so multiple can be active simultaneously.
    Only one refresh actually runs per tick (they're serialised so the
    scraper doesn't hammer eBay), but every due entry gets its own
    history row and per-entry `next_run_at` bookkeeping.
    """
    await asyncio.sleep(30)  # small boot delay
    while True:
        try:
            sched = await _get_scraper_schedule()
            now = datetime.now(timezone.utc)

            # 1) Retry orchestration (unchanged) — fires regardless of schedule enable flag.
            retry_pending = sched.get("retry_pending")
            if retry_pending and retry_pending.get("retry_at"):
                try:
                    retry_due = datetime.fromisoformat(retry_pending["retry_at"]) <= now
                except Exception:
                    retry_due = False
                if retry_due:
                    await _refresh_all_and_record(
                        method="auto",
                        trigger="retry",
                        attempt=2,
                        original_run_id=retry_pending.get("original_run_id"),
                        schedule_id=retry_pending.get("schedule_id"),
                    )
                    sched = await _get_scraper_schedule()

            # 2) Scheduled runs — walk each entry independently.
            entries = list(sched.get("schedules") or [])
            entries_changed = False
            for entry in entries:
                if not entry.get("enabled"):
                    continue
                stop = entry.get("stop_date")
                if stop:
                    try:
                        stop_dt = datetime.fromisoformat(stop).replace(tzinfo=timezone.utc)
                        if datetime.now(timezone.utc) >= stop_dt:
                            continue
                    except Exception:
                        pass
                next_run = entry.get("next_run_at") or _compute_next_run_for(entry)
                if not next_run:
                    continue
                try:
                    due = datetime.fromisoformat(next_run) <= datetime.now(timezone.utc)
                except Exception:
                    due = False
                if due:
                    await _refresh_all_and_record(
                        method="auto", trigger="scheduled", attempt=1, schedule_id=entry.get("id"),
                    )
                    # `_refresh_all_and_record` already recomputed the array in
                    # DB — break the tick so we don't run a second entry in
                    # the same minute.
                    entries_changed = True
                    break
                elif entry.get("next_run_at") != next_run:
                    entry["next_run_at"] = next_run
                    entries_changed = True
            # Persist any recomputed next_run_at values that didn't trigger a run.
            if entries_changed:
                await db.scraper_schedule.update_one(
                    {"id": "singleton"}, {"$set": {"schedules": entries}}, upsert=True,
                )
        except Exception as e:
            logger.exception(f"scheduler loop error: {e}")
        await asyncio.sleep(60)

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


# Palette used for auto-created categories so new imports get a stable, distinct colour.
_EBAY_AUTO_COLORS = ["#4F46E5", "#059669", "#DC2626", "#D97706", "#7C3AED",
                     "#2563EB", "#EA580C", "#DB2777", "#0891B2", "#65A30D"]


# Tokens that eBay sometimes emits as breadcrumb entries but which are NOT
# actual category names. We strip them before picking the leaf.
_BREADCRUMB_NOISE_EXACT = {
    "ebay", "home", "back", "back to home page", "back to previous page",
    "see more", "see all", "show more", "view all", "browse all",
    "shop by category", "categories", "all categories", "…", "...",
}
_BREADCRUMB_NOISE_PATTERNS = (
    re.compile(r"^see\s+more(\s+.*)?$", re.I),
    re.compile(r"^see\s+all(\s+.*)?$", re.I),
    re.compile(r"^view\s+all(\s+.*)?$", re.I),
    re.compile(r"^shop\s+all(\s+.*)?$", re.I),
    re.compile(r"^more\s+in\b.*$", re.I),
    # eBay's site-header store prefixes ("eBay Motors", "eBay Stores", etc.).
    # Always stripped so they never leak into Category names or descriptions.
    re.compile(r"^ebay(\s+.*)?$", re.I),
)


def _clean_breadcrumb_trail(breadcrumbs: list) -> list:
    """Normalize + de-noise a raw eBay breadcrumb list.

    Rules:
      - Drop empty / None entries.
      - Drop the leading store prefix ("eBay", "Home").
      - Drop UI-only rows like "See more", "See all", "View all", "…", etc.
      - Collapse consecutive duplicates ("Car Audio > Car Audio" -> "Car Audio").
      - Strip trailing punctuation and normalise whitespace.
    """
    cleaned: list = []
    for raw in breadcrumbs or []:
        s = str(raw or "").strip()
        # Collapse internal whitespace
        s = re.sub(r"\s+", " ", s)
        # Strip trailing punctuation (arrows, ellipses, colons)
        s = s.rstrip("›»→⟩>.:; \t\u00a0")
        if not s:
            continue
        low = s.lower()
        if low in _BREADCRUMB_NOISE_EXACT:
            continue
        if any(p.match(s) for p in _BREADCRUMB_NOISE_PATTERNS):
            continue
        # Skip duplicate of previous entry (case-insensitive)
        if cleaned and cleaned[-1].lower() == low:
            continue
        cleaned.append(s)
    return cleaned


def _pick_meaningful_leaf(trail: list) -> Optional[str]:
    """Pick the LAST meaningful breadcrumb from the cleaned trail.

    Falls back to the second-to-last when the leaf looks too specific or
    redundant. "Too specific" heuristics:
      - > 60 chars (usually a description, not a category name)
      - contains parenthesised qualifier like "(New)" or "(2-Pack)"
      - starts with a number+"x " (SKU-style)
      - contains "&" or "/" chained more than once (e.g. "Radios & Tuners & Amps")
        chained descriptors are typically inventory-listing filters, not the
        canonical eBay category
      - identical (case-insensitive) to its parent
    """
    if not trail:
        return None

    def _looks_too_specific(name: str, parent: Optional[str]) -> bool:
        if not name:
            return True
        if len(name) > 60:
            return True
        if re.search(r"\([^)]+\)", name):
            return True
        if re.match(r"^\d+\s*x\s+", name, flags=re.I):
            return True
        if name.count("&") + name.count("/") >= 2:
            return True
        if parent and parent.lower() == name.lower():
            return True
        return False

    leaf = trail[-1]
    parent = trail[-2] if len(trail) >= 2 else None
    if _looks_too_specific(leaf, parent) and parent:
        return parent
    return leaf


async def _ensure_ebay_category(breadcrumbs: Optional[list]) -> Optional[str]:
    """Ensure a Category exists that matches the scraped eBay listing's category
    path. Returns the canonical slug (which is what Product.category stores and
    what the Categories browser filters on).

    Rules:
      - De-noise the breadcrumb list (drop "See more", store prefixes, dupes).
      - Pick the LAST MEANINGFUL level as the category name. If that level
        looks too specific (long, parenthesised qualifier, chained "&/") or
        is redundant with its parent, fall back to the second-to-last level.
      - Case-insensitive existence check by both slug and name.
      - When a new record is inserted, `group` is the top-most breadcrumb so
        the sidebar/browser can still group intelligently.
      - Returns None if breadcrumbs is empty / unusable so callers can fall
        back to the internal heuristic (`_guess_category`).
    """
    if not breadcrumbs or not isinstance(breadcrumbs, list):
        return None
    trail = _clean_breadcrumb_trail(breadcrumbs)
    if not trail:
        return None
    name = _pick_meaningful_leaf(trail)
    if not name:
        return None
    group = trail[0] if len(trail) >= 2 and trail[0].lower() != name.lower() else "Imported"
    slug = _slug(name)
    if not slug:
        return None
    # Case-insensitive lookup by slug OR name.
    existing = await db.categories.find_one(
        {"$or": [
            {"slug": slug},
            {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}},
        ]},
        {"_id": 0, "slug": 1},
    )
    if existing:
        return existing.get("slug") or slug
    # Insert a new Category. Pick a stable colour from the palette based on
    # slug hash so re-imports of the same category always render identically.
    sort_order = await db.categories.count_documents({})
    color = _EBAY_AUTO_COLORS[hash(slug) % len(_EBAY_AUTO_COLORS)]
    cat = Category(
        name=name,
        slug=slug,
        group=group,
        icon="tag",
        color=color,
        description=" > ".join(trail),
        sort_order=sort_order,
    )
    await db.categories.insert_one(cat.model_dump())
    logger.info(f"Auto-created category from eBay import: {name} ({slug}) · group={group}")
    return slug

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
            c = Customer(
                name=agg["name"], email=agg["email"],
                status="active", type="registered",
                orders_count=agg["orders_count"], total_spend=round(agg["total_spend"], 2),
            )
            await db.customers.insert_one(c.model_dump())
            n += 1
        else:
            await db.customers.update_one({"id": existing["id"]}, {"$set": {"orders_count": agg["orders_count"], "total_spend": round(agg["total_spend"], 2), "updated_at": datetime.now(timezone.utc).isoformat()}})
    return n

def _shape_review(r: dict) -> dict:
    """Attach counts, strip private lists before returning to public consumers."""
    hv = r.get("helpful_votes") or []
    nv = r.get("not_helpful_votes") or []
    return {
        **{k: v for k, v in r.items() if k not in ("helpful_votes", "not_helpful_votes")},
        "helpful_count": len(hv),
        "not_helpful_count": len(nv),
    }

def _jwt_secret() -> str:
    s = os.environ.get("JWT_SECRET")
    if not s:
        raise RuntimeError("JWT_SECRET missing from backend/.env")
    return s


def _hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _issue_token(customer_email: str) -> str:
    payload = {
        "sub": customer_email,
        "type": "access",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + JWT_ACCESS_TTL,
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGO)


async def get_current_customer(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired — please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session token")
    email = (payload.get("sub") or "").lower()
    if not email:
        raise HTTPException(status_code=401, detail="Invalid session token")
    acct = await db.customer_accounts.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    if not acct:
        raise HTTPException(status_code=401, detail="Account not found")
    return acct


async def _has_purchased(email: str, product_id: str) -> Optional[dict]:
    """Return the first matching order (paid or later) for this customer+product, else None."""
    valid = ["paid", "processing", "shipped", "delivered", "completed"]
    o = await db.orders.find_one(
        {"customer_email": {"$regex": f"^{re.escape(email)}$", "$options": "i"},
         "product_id": product_id,
         "status": {"$in": valid}},
        {"_id": 0},
    )
    return o

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
        b = buckets.setdefault(name, {"item_ids": [], "ebay_ids": [], "locations": set(), "last": "", "any_live": False})
        b["item_ids"].append(it["id"])
        if it.get("item_id"):
            b["ebay_ids"].append(it["item_id"])
        if it.get("location"):
            b["locations"].add(it["location"])
        upd = it.get("updated_at") or it.get("created_at") or ""
        if upd > b["last"]:
            b["last"] = upd
        if not it.get("is_sold"):
            b["any_live"] = True

    sellers: List[dict] = []
    for name, b in buckets.items():
        # Products in the store sourced from this seller (join on the eBay
        # item_id, which is what `products.source_item_id` stores).
        linked_products = await db.products.find(
            {"source_item_id": {"$in": b["ebay_ids"]}, "archived": {"$ne": True}},
            {"_id": 0, "id": 1},
        ).to_list(1000) if b["ebay_ids"] else []
        product_ids = [p["id"] for p in linked_products]

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
            "linked_product_count": len(product_ids),
            "total_orders": orders_count,
            "revenue_generated": round(revenue, 2),
            "last_active": b["last"],
            "status": "active" if b["any_live"] else "inactive",
            "item_ids": b["item_ids"],
        })
    return sellers

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

async def _get_push_settings() -> dict:
    doc = await db.push_settings.find_one({"id": "singleton"}, {"_id": 0})
    if not doc:
        await db.push_settings.insert_one({**PUSH_SETTINGS_DEFAULTS})
        return {**PUSH_SETTINGS_DEFAULTS}
    return {**PUSH_SETTINGS_DEFAULTS, **doc}


def _mask(s: Optional[str]) -> str:
    if not s: return ""
    if len(s) <= 6: return "•" * len(s)
    return f"{s[:3]}••••{s[-3:]}"


async def _get_credential(field: str) -> str:
    """Read a stored credential from the singleton settings doc."""
    settings = await _get_push_settings()
    return settings.get(field) or ""


async def _push_channel_status() -> dict:
    settings = await _get_push_settings()
    email_key = settings.get("resend_api_key") or ""
    email_to  = settings.get("resend_to_email") or ""
    tg_tok    = settings.get("telegram_bot_token") or ""
    tg_chat   = settings.get("telegram_chat_id") or ""
    return {
        "email_configured": bool(email_key and email_to),
        "telegram_configured": bool(tg_tok and tg_chat),
    }


def _notif_is_critical(n: dict, settings: dict) -> bool:
    """Decide if a notification should push based on user settings."""
    if not settings.get("critical_only"):
        return True
    if n.get("type") not in PUSH_CRITICAL_TYPES:
        return False
    if n.get("type") == "price_change":
        threshold = float(settings.get("margin_drop_threshold_pp") or 0)
        delta = float(n.get("delta_margin") or 0)
        return delta <= -threshold  # margin drop of at least `threshold` pp
    return True


async def _send_email(subject: str, html: str) -> None:
    settings = await _get_push_settings()
    key = settings.get("resend_api_key")
    to  = settings.get("resend_to_email")
    frm = settings.get("resend_from_email") or "onboarding@resend.dev"
    if not key or not to:
        return
    resend.api_key = key
    try:
        await asyncio.to_thread(resend.Emails.send, {
            "from": frm, "to": [to], "subject": subject, "html": html,
        })
    except Exception as e:
        logger.warning(f"[push] Resend send failed: {e}")


# --- Customer-facing transactional emails ---------------------------------
# These go to end-users. Each is gated by:
#   1) `customer_email_enabled` (master switch)
#   2) `customer_<kind>` toggle for the specific email type
# When either is False, the email is silently skipped.
# We reuse the Resend API key/from-address configured for admin notifications
# so no extra credentials are needed.

CUSTOMER_EMAIL_KINDS = {
    "order_confirmation":    "customer_order_confirmation",
    "order_status_update":   "customer_order_status_update",
    "order_cancellation":    "customer_order_cancellation",
    "welcome":               "customer_welcome_email",
}


def _customer_email_html(title: str, intro: str, rows: list, footer: str = "") -> str:
    row_html = "".join(
        f'<tr><td style="padding:6px 12px;color:#64748B;font-size:12px;">{k}</td>'
        f'<td style="padding:6px 12px;color:#0F172A;font-size:13px;">{v}</td></tr>'
        for k, v in rows
    )
    return f"""<!doctype html>
<html><body style="font-family:Arial,sans-serif;background:#F7F7FB;padding:32px;color:#0F172A;">
  <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #EAEAF0;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:20px 24px;background:linear-gradient(135deg,#4F46E5,#EC4899);color:#fff;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85;">PCAdmin</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px;">{title}</div>
    </td></tr>
    <tr><td style="padding:16px 24px;color:#334155;font-size:14px;">{intro}</td></tr>
    <tr><td style="padding:0 12px 12px 12px;"><table cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;">{row_html}</table></td></tr>
    {f'<tr><td style="padding:12px 24px 20px 24px;color:#64748B;font-size:12px;">{footer}</td></tr>' if footer else ''}
  </table>
</body></html>"""


async def send_customer_email(kind: str, to_email: str, subject: str, html: str) -> str:
    """Send a transactional email to a customer, respecting per-kind toggles.

    Returns one of: 'sent', 'skipped_disabled', 'skipped_master_off',
    'skipped_no_key', 'skipped_no_recipient', 'failed'.
    """
    if not to_email:
        return "skipped_no_recipient"
    if kind not in CUSTOMER_EMAIL_KINDS:
        logger.warning(f"[customer email] unknown kind: {kind}")
        return "skipped_disabled"
    settings = await _get_push_settings()
    if not settings.get("customer_email_enabled"):
        return "skipped_master_off"
    toggle_field = CUSTOMER_EMAIL_KINDS[kind]
    if not settings.get(toggle_field):
        return "skipped_disabled"
    key = settings.get("resend_api_key")
    frm = settings.get("resend_from_email") or "onboarding@resend.dev"
    if not key:
        return "skipped_no_key"
    resend.api_key = key
    try:
        await asyncio.to_thread(resend.Emails.send, {
            "from": frm, "to": [to_email], "subject": subject, "html": html,
        })
        logger.info(f"[customer email] sent · kind={kind} · to={to_email} · subject={subject!r}")
        return "sent"
    except Exception as e:
        logger.warning(f"[customer email] send failed · kind={kind} · to={to_email} · {e}")
        return "failed"


async def send_customer_order_confirmation(order: dict) -> str:
    to = order.get("customer_email") or ""
    subject = f"Order confirmed · #{(order.get('reference') or order.get('id') or '')[:16]}"
    html = _customer_email_html(
        title="Thanks — we've received your order",
        intro=f"Hi {order.get('customer_name') or 'there'}, thank you for shopping with us. "
              "We'll email you again as soon as it ships.",
        rows=[
            ("Order",     order.get("reference") or (order.get("id") or "")[:8]),
            ("Item",      order.get("product_title") or "—"),
            ("Quantity",  str(order.get("quantity") or 1)),
            ("Total",     f"${float(order.get('total') or 0):.2f}"),
        ],
        footer="Reply to this email if anything looks off.",
    )
    return await send_customer_email("order_confirmation", to, subject, html)


async def send_customer_order_status_update(order: dict, old_status: str, new_status: str) -> str:
    to = order.get("customer_email") or ""
    friendly = {
        "processing": "is being prepared for shipping",
        "shipped":    "has shipped",
        "delivered":  "has been delivered",
    }.get(new_status, f"status is now {new_status}")
    subject = f"Your order {friendly} · #{(order.get('reference') or order.get('id') or '')[:16]}"
    html = _customer_email_html(
        title=f"Your order {friendly}",
        intro=f"Hi {order.get('customer_name') or 'there'}, an update on your recent order.",
        rows=[
            ("Order",     order.get("reference") or (order.get("id") or "")[:8]),
            ("Item",      order.get("product_title") or "—"),
            ("Status",    new_status.replace("_", " ").title()),
            ("Total",     f"${float(order.get('total') or 0):.2f}"),
        ],
    )
    return await send_customer_email("order_status_update", to, subject, html)


async def send_customer_order_cancellation(order: dict) -> str:
    to = order.get("customer_email") or ""
    subject = f"Order cancelled · #{(order.get('reference') or order.get('id') or '')[:16]}"
    html = _customer_email_html(
        title="Your order has been cancelled",
        intro=f"Hi {order.get('customer_name') or 'there'}, we've cancelled your recent order. "
              "Any charge will be refunded to your original payment method within a few business days.",
        rows=[
            ("Order",     order.get("reference") or (order.get("id") or "")[:8]),
            ("Item",      order.get("product_title") or "—"),
            ("Refund",    f"${float(order.get('total') or 0):.2f}"),
        ],
        footer="Reply to this email if you have any questions.",
    )
    return await send_customer_email("order_cancellation", to, subject, html)


async def send_customer_welcome_email(customer: dict) -> str:
    to = customer.get("email") or ""
    name = customer.get("name") or customer.get("full_name") or "there"
    subject = "Welcome to PCAdmin 🎉"
    html = _customer_email_html(
        title=f"Welcome, {name}!",
        intro="Your account is ready to go. You can now track your orders, "
              "leave verified reviews, and grab exclusive coupons — all from one place.",
        rows=[
            ("Email",  customer.get("email") or "—"),
            ("Joined", (customer.get("created_at") or "")[:10] or "today"),
        ],
        footer="Happy shopping. Reply to this email if you ever need a hand.",
    )
    return await send_customer_email("welcome", to, subject, html)



async def _send_telegram(text: str) -> None:
    settings = await _get_push_settings()
    token = settings.get("telegram_bot_token")
    chat_id = settings.get("telegram_chat_id")
    if not token or not chat_id:
        return
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "HTML",
                      "disable_web_page_preview": True},
            )
    except Exception as e:
        logger.warning(f"[push] Telegram send failed: {e}")


def _format_notification_html(n: dict) -> tuple[str, str, str]:
    """Return (subject, html_body, plain_text_for_telegram) for a notification."""
    t = n.get("type")
    title = n.get("title") or "Notification"
    body = n.get("body") or ""
    at = n.get("at") or ""

    # Type-specific rows
    rows: list[tuple[str, str]] = []
    if t == "price_change":
        rows += [
            ("Product",  n.get("product_title") or "—"),
            ("Old eBay price", f"${(n.get('old_price') or 0):.2f}"),
            ("New eBay price", f"${(n.get('new_price') or 0):.2f}"),
            ("Old margin", f"{(n.get('old_margin_pct') or 0):.1f}%"),
            ("New margin", f"{(n.get('new_margin_pct') or 0):.1f}%"),
            ("Change",   f"{(n.get('delta_margin') or 0):+.1f} pp"),
        ]
    elif t == "new_order":
        d = n.get("data") or {}
        rows += [
            ("Customer", d.get("customer_name") or "—"),
            ("Product",  n.get("product_title") or "—"),
            ("Total",    f"${float(d.get('total') or 0):.2f}"),
            ("Quantity", str(d.get("quantity") or 1)),
        ]
    elif t == "out_of_stock":
        rows += [("Product", n.get("product_title") or "—"),
                 ("eBay listing", n.get("ebay_url") or "—")]
    elif t == "countdown_expired":
        # Rows for the auto-inactivation email/Telegram. Prices + end
        # timestamp let the admin decide whether to restore straight
        # away or move on. Uses the same `.data` bag pattern as
        # `new_order`.
        d = n.get("data") or {}
        rows += [
            ("Product", n.get("product_title") or "—"),
        ]
        if d.get("sale_price") is not None:
            rows.append(("Sale price", f"${float(d.get('sale_price') or 0):.2f}"))
        if d.get("original_price") is not None:
            rows.append(("Original price", f"${float(d.get('original_price') or 0):.2f}"))
        if d.get("ended_at"):
            rows.append(("Ended at", str(d.get("ended_at"))))
        rows.append(("Status", "Auto-inactivated · moved to Products › Countdown"))
    elif t == "low_stock":
        d = n.get("data") or {}
        rows += [("Product", n.get("product_title") or "—"),
                 ("Stock left", str(d.get("stock")))]
    elif t == "order_status":
        d = n.get("data") or {}
        rows += [("Order", (n.get('order_id') or '')[:8]),
                 ("Change", f"{d.get('old_status')} → {d.get('new_status')}"),
                 ("Customer", d.get("customer_name") or "—")]
    elif t == "new_customer":
        d = n.get("data") or {}
        rows += [("Name", d.get("name") or "—"),
                 ("Email", d.get("email") or "—"),
                 ("Group", d.get("group") or "—")]
    elif t == "new_payment":
        d = n.get("data") or {}
        rows += [("Amount", f"${d.get('amount', 0):.2f}"),
                 ("Method", d.get("method") or "—"),
                 ("Customer", d.get("customer_name") or "—"),
                 ("Reference", d.get("reference") or "—")]
    elif t == "cancellation_request":
        d = n.get("data") or {}
        rows += [("Reason", d.get("reason") or "—"),
                 ("Amount", f"${d.get('amount', 0):.2f}"),
                 ("Customer", d.get("customer_name") or "—"),
                 ("Order", (n.get('order_id') or '')[:8])]

    row_html = "".join(
        f'<tr><td style="padding:6px 12px;color:#64748B;font-size:12px;">{k}</td>'
        f'<td style="padding:6px 12px;color:#0F172A;font-size:13px;">{v}</td></tr>'
        for k, v in rows
    )
    html = f"""<!doctype html>
<html><body style="font-family:Arial,sans-serif;background:#F7F7FB;padding:32px;color:#0F172A;">
  <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #EAEAF0;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:20px 24px;background:linear-gradient(135deg,#4F46E5,#EC4899);color:#fff;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:0.85;">{t.upper()}</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px;">{title}</div>
    </td></tr>
    <tr><td style="padding:16px 24px;color:#334155;font-size:14px;">{body}</td></tr>
    <tr><td style="padding:0 12px 12px 12px;"><table cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;">{row_html}</table></td></tr>
    <tr><td style="padding:12px 24px 20px 24px;color:#94A3B8;font-size:11px;">Sent {at}</td></tr>
  </table>
</body></html>"""
    plain_lines = [f"<b>{title}</b>", body] + [f"{k}: {v}" for k, v in rows]
    return f"[{t}] {title}", html, "\n".join(plain_lines)


async def _push_notification(n: dict) -> None:
    """Fire push channels for a notification if it qualifies."""
    try:
        settings = await _get_push_settings()
        if not _notif_is_critical(n, settings):
            return
        subject, html, plain = _format_notification_html(n)
        tasks = []
        if settings.get("email_enabled", True):
            tasks.append(_send_email(subject, html))
        if settings.get("telegram_enabled", True):
            tasks.append(_send_telegram(plain))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
    except Exception as e:
        logger.warning(f"[push] pipeline failed: {e}")

async def _emit_notification(**kwargs) -> dict:
    """Insert a notification document and return it (minus _id)."""
    n = Notification(**kwargs)
    doc = n.model_dump()
    await db.notifications.insert_one(doc)
    doc.pop("_id", None)
    # Fire push channels in the background — don't block the request
    try:
        asyncio.create_task(_push_notification(doc))
    except Exception as e:
        logger.warning(f"[push] scheduling failed: {e}")
    return doc


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


async def _auto_archive_if_out_of_stock(pid: str) -> bool:
    """Auto-archive a product when its stock has just dropped to (or below) 0.

    Called from every write-path that mutates stock (order placement, manual
    stock adjust, PATCH /products, scraper "sold" sweep). Idempotent: skips
    products that are already archived so it can be called freely without
    worrying about repeat notifications. Returns True if it archived.
    """
    if not pid:
        return False
    p = await db.products.find_one(
        {"id": pid},
        {"_id": 0, "id": 1, "stock": 1, "archived": 1, "active": 1, "title": 1, "images": 1},
    )
    if not p or p.get("archived") is True:
        return False
    if (p.get("stock") or 0) > 0:
        return False
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.products.update_one(
        {"id": pid},
        {"$set": {"archived": True, "active": False, "updated_at": now_iso}},
    )
    # Surface it in the notification bell so admins notice the auto-move.
    await _emit_notification(
        type="out_of_stock",
        title="Product auto-archived (out of stock)",
        body=f"{p.get('title')} · moved to Archived",
        product_id=pid,
        product_title=p.get("title"),
        image=(p.get("images") or [None])[0],
        data={"stock": p.get("stock") or 0, "auto_archived": True},
    )
    return True


async def _delete_categories_if_empty(slugs) -> list:
    """Auto-delete any category in `slugs` that has zero remaining products.

    Called from every product delete path (single + bulk) so admins never
    have to hand-prune empty categories after clearing out a range. Returns
    the list of slugs that were actually deleted so callers can log / return
    them.

    Notes:
      * Comparison is by `slug` — that's what `products.category` stores.
      * Empty/null slugs are ignored (some legacy products carry no category).
      * We don't guard against seeded categories here — if the admin has
        deleted every product in a seed category (e.g. "Phones & Tablets"),
        removing the empty row keeps the sidebar tidy. New scrapes that
        would hit that slug via `_ensure_ebay_category` will just re-create
        the record.
    """
    deleted: list = []
    for slug in {s for s in (slugs or []) if s}:
        remaining = await db.products.count_documents({"category": slug})
        if remaining > 0:
            continue
        r = await db.categories.delete_one({"slug": slug})
        if r.deleted_count:
            deleted.append(slug)
    if deleted:
        logger.info(f"auto-deleted empty categories: {deleted}")
    return deleted



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

async def _ensure_pricing_rules_seeded() -> None:
    if await db.pricing_rules.count_documents({}) > 0:
        return
    for r in _DEFAULT_PRICING_RULES:
        rule = PricingRule(**r)
        await db.pricing_rules.insert_one(rule.model_dump())
    logger.info(f"Seeded {len(_DEFAULT_PRICING_RULES)} pricing rules")


async def _ensure_postage_presets_seeded() -> None:
    if await db.postage_presets.count_documents({}) > 0:
        return
    for r in _DEFAULT_POSTAGE_PRESETS:
        preset = PostagePreset(**r)
        await db.postage_presets.insert_one(preset.model_dump())
    logger.info(f"Seeded {len(_DEFAULT_POSTAGE_PRESETS)} postage presets")


async def _get_delivery_settings() -> dict:
    """Return the singleton delivery-estimate settings, seeding on first read."""
    doc = await db.delivery_settings.find_one({"id": "singleton"}, {"_id": 0})
    if not doc:
        await db.delivery_settings.insert_one({**DELIVERY_SETTINGS_DEFAULTS})
        return {**DELIVERY_SETTINGS_DEFAULTS}
    return {**DELIVERY_SETTINGS_DEFAULTS, **doc}


async def _ensure_main_admin_seeded() -> None:
    """Seed the single main-admin account if the admin_accounts collection is empty.

    Password lives in `test_credentials.md` for the QA agent. The main admin
    is hard-flagged with `is_main=True` and cannot be deleted through the
    Admin Settings › Accounts UI.
    """
    if await db.admin_accounts.count_documents({}) > 0:
        return
    acct = AdminAccount(
        **_DEFAULT_MAIN_ADMIN,
        password_hash=_hash_password("admin123"),
    )
    await db.admin_accounts.insert_one(acct.model_dump())
    logger.info("Seeded main admin account (admin@example.com / admin123)")


async def _load_pricing_rules() -> list[dict]:
    cursor = db.pricing_rules.find({"active": True}, {"_id": 0}).sort("sort_order", 1)
    return await cursor.to_list(500)



# ---------------------------------------------------------------------------
# Country access control
# ---------------------------------------------------------------------------

import secrets  # noqa: E402  – kept next to the helpers that use it

from models import _DEFAULT_COUNTRY_ACCESS, BYPASS_SESSION_TTL_SECONDS  # noqa: E402


def _generate_bypass_token(nbytes: int = 32) -> str:
    """Cryptographically-random URL-safe token used as the emergency bypass URL segment."""
    return secrets.token_urlsafe(nbytes)


async def _ensure_country_access_seeded() -> None:
    """Seed the singleton `country_access_settings` document with AU + MA
    allowed and a fresh bypass token. No-op after the first run."""
    if await db.country_access_settings.count_documents({}) > 0:
        return
    doc = {
        **_DEFAULT_COUNTRY_ACCESS,
        "bypass_token": _generate_bypass_token(),
        "updated_at": _now_iso(),
    }
    await db.country_access_settings.insert_one(doc)
    logger.info("Seeded country_access_settings (allowed=%s)", doc["allowed_country_codes"])


async def _get_country_access() -> dict:
    """Fetch the singleton, seeding it lazily if the startup task hasn't run
    yet (defensive — matters mostly during unit tests)."""
    doc = await db.country_access_settings.find_one({"_id": "singleton"}, {"_id": 0})
    if not doc:
        await _ensure_country_access_seeded()
        doc = await db.country_access_settings.find_one({"_id": "singleton"}, {"_id": 0})
    return doc or {"allowed_country_codes": [], "bypass_token": ""}


def _client_country(request) -> Optional[str]:
    """Return the ISO alpha-2 country code that Cloudflare tagged on the
    request. Falls back to `None` when the header is missing (e.g. direct
    origin hit during local dev)."""
    v = request.headers.get("CF-IPCountry") or request.headers.get("cf-ipcountry")
    if not v:
        return None
    v = v.strip().upper()
    # Cloudflare uses "XX" for anonymised requests and "T1" for Tor exit
    # nodes — we treat both as "unknown" so the admin can decide whether to
    # allow them via the toggle list.
    if v in ("", "XX", "T1"):
        return None
    return v


def _client_ip(request) -> str:
    """Best-effort client IP resolution. Cloudflare sets `CF-Connecting-IP`;
    generic proxies use `X-Forwarded-For` (first hop wins). Falls back to
    the socket peer."""
    cf = request.headers.get("CF-Connecting-IP") or request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    xff = request.headers.get("X-Forwarded-For") or request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    client = getattr(request, "client", None)
    return getattr(client, "host", None) or ""


async def _bypass_active_for_ip(ip: str) -> Optional[dict]:
    """Return the active bypass session for the given IP, or None."""
    if not ip:
        return None
    now = datetime.now(timezone.utc).isoformat()
    return await db.bypass_sessions.find_one(
        {"ip": ip, "expires_at": {"$gt": now}}, {"_id": 0}
    )


async def _grant_bypass(ip: str, country: Optional[str]) -> dict:
    """Create (or refresh) a 24-hour bypass session for `ip`. Idempotent —
    calling twice within the same day just refreshes `expires_at`."""
    now = datetime.now(timezone.utc)
    session = {
        "ip": ip,
        "country": country or "",
        "granted_at": now.isoformat(),
        "expires_at": (now + timedelta(seconds=BYPASS_SESSION_TTL_SECONDS)).isoformat(),
    }
    await db.bypass_sessions.update_one(
        {"ip": ip}, {"$set": session}, upsert=True
    )
    return session


async def _purge_expired_bypasses() -> int:
    """Delete every expired bypass session and return the count removed.
    Called opportunistically from the country-access GET endpoint so the
    admin's Security tab always shows a clean list."""
    now = datetime.now(timezone.utc).isoformat()
    r = await db.bypass_sessions.delete_many({"expires_at": {"$lte": now}})
    return r.deleted_count or 0



# --- Disposable / temporary email blocklist ---------------------------------
#
# Singleton document `disposable_email_domains` (id `singleton`) with:
#   { "domains": ["yopmail.com", "10minutemail.com", ...], "updated_at": iso }
#
# Seeded from `_DEFAULT_DISPOSABLE_DOMAINS`. The `_is_disposable_email` helper
# is cheap enough to call on every registration attempt (one indexed find on a
# tiny singleton doc).

from models import _DEFAULT_DISPOSABLE_DOMAINS  # noqa: E402


def _normalise_domain(raw: str) -> str:
    """Return the lower-cased, `@`-stripped, whitespace-trimmed domain.
    Returns an empty string for unusable input so callers can just skip."""
    if not raw:
        return ""
    v = str(raw).strip().lower()
    if not v:
        return ""
    # Accept full addresses ("user@host") too and pluck the domain.
    if "@" in v:
        v = v.rsplit("@", 1)[-1].strip()
    return v


async def _ensure_disposable_domains_seeded() -> None:
    """Seed the singleton `disposable_email_domains` document. No-op after
    the first run — admins can freely edit the list without it being
    re-seeded on restart."""
    if await db.disposable_email_domains.count_documents({}) > 0:
        return
    doc = {
        "_id": "singleton",
        "domains": sorted({_normalise_domain(d) for d in _DEFAULT_DISPOSABLE_DOMAINS if _normalise_domain(d)}),
        "updated_at": _now_iso(),
    }
    await db.disposable_email_domains.insert_one(doc)
    logger.info("Seeded disposable_email_domains (%d entries)", len(doc["domains"]))


async def _get_disposable_domains() -> list[str]:
    """Fetch the current blocklist, seeding lazily if the startup task
    hasn't run yet. Returns an empty list on a bare install so we never
    accidentally block legitimate sign-ups."""
    doc = await db.disposable_email_domains.find_one({"_id": "singleton"}, {"_id": 0})
    if not doc:
        await _ensure_disposable_domains_seeded()
        doc = await db.disposable_email_domains.find_one({"_id": "singleton"}, {"_id": 0})
    return list((doc or {}).get("domains") or [])


async def _is_disposable_email(email: str) -> bool:
    """True if the email's domain (or any parent domain — e.g. blocking
    `mail.tm` also blocks `foo.mail.tm`) matches the current blocklist."""
    domain = _normalise_domain(email)
    if not domain:
        return False
    blocked = await _get_disposable_domains()
    if not blocked:
        return False
    blocked_set = {d for d in blocked if d}
    # Exact match first (fast path).
    if domain in blocked_set:
        return True
    # Suffix match — protects against sub-domain workarounds like
    # `foo.yopmail.com`. Only trigger on a real dot boundary so
    # `notyopmail.com` doesn't get caught by `yopmail.com`.
    for b in blocked_set:
        if domain.endswith("." + b):
            return True
    return False
