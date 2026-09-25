"""Dynamic storefront tag settings and product-tag calculation."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import ceil

from deps import db
from models import TAG_SETTINGS_DEFAULTS


TAG_IDS = ("new", "hot", "bestseller", "deal", "top", "limited")


def _iso_after(value: object, threshold: datetime) -> bool:
    if not value:
        return False
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed > threshold
    except (TypeError, ValueError):
        return False


def _settings_shape(raw: dict | None) -> dict:
    defaults = TAG_SETTINGS_DEFAULTS["tags"]
    saved = (raw or {}).get("tags") or {}
    tags = {}
    for tag_id in TAG_IDS:
        base = defaults[tag_id]
        current = saved.get(tag_id) or {}
        label = str(current.get("label", base["label"]) or "").strip()[:40]
        tags[tag_id] = {
            "enabled": bool(current.get("enabled", base["enabled"])),
            "label": label or base["label"],
        }
    return {"id": "singleton", "tags": tags}


async def get_tag_settings() -> dict:
    """Return the singleton, backfilling every default rule on legacy docs."""
    raw = await db.tag_settings.find_one({"id": "singleton"}, {"_id": 0})
    shaped = _settings_shape(raw)
    if raw != shaped:
        await db.tag_settings.update_one({"id": "singleton"}, {"$set": shaped}, upsert=True)
    return shaped


def _top_ids(rows: list[tuple[str, float]], fraction: float, cap: int | None = None) -> set[str]:
    ranked = [(pid, score) for pid, score in rows if pid and score > 0]
    ranked.sort(key=lambda row: (-row[1], row[0]))
    if cap is not None:
        size = min(cap, len(ranked))
    else:
        size = min(len(ranked), max(1, ceil(len(ranked) * fraction))) if ranked else 0
    return {pid for pid, _ in ranked[:size]}


async def attach_smart_tags(products: list[dict], settings: dict | None = None) -> None:
    """Attach rule-driven display labels in ``smart_tags`` beside SEO keywords.

    Smart rankings intentionally use the whole catalogue rather than just the
    current page, so pagination never changes which products qualify.
    """
    if not products:
        return
    settings = settings or await get_tag_settings()
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=30)

    all_products = await db.products.find({}, {"_id": 0, "id": 1, "sold_count": 1, "view_count_30d": 1}).to_list(5000)
    view_pipeline = [
        {"$match": {"viewed_at": {"$gte": cutoff.isoformat()}}},
        {"$group": {"_id": "$product_id", "count": {"$sum": 1}}},
    ]
    view_rows = await db.product_views.aggregate(view_pipeline).to_list(5000)
    view_counts = {row["_id"]: float(row.get("count") or 0) for row in view_rows if row.get("_id")}
    for product in all_products:
        pid = product.get("id")
        if pid:
            view_counts[pid] = view_counts.get(pid, 0) + float(product.get("view_count_30d") or 0)

    rating_pipeline = [
        {"$match": {"status": "approved"}},
        {"$group": {"_id": "$product_id", "average": {"$avg": "$rating"}}},
    ]
    rating_rows = await db.reviews.aggregate(rating_pipeline).to_list(5000)
    hot_ids = _top_ids(list(view_counts.items()), 0.10)
    bestseller_ids = _top_ids([(p.get("id"), float(p.get("sold_count") or 0)) for p in all_products], 0.05)
    top_ids = _top_ids([(row.get("_id"), float(row.get("average") or 0)) for row in rating_rows], 1, cap=3)

    for product in products:
        # Existing product.tags are editable SEO keywords. Keep that API
        # contract intact and add smart_tags beside it for admin consumers.
        product["seo_tags"] = list(product.get("tags") or [])
        tag_ids: list[str] = []
        pid = product.get("id")
        if _iso_after(product.get("created_at"), now - timedelta(hours=48)):
            tag_ids.append("new")
        if pid in hot_ids:
            tag_ids.append("hot")
        if pid in bestseller_ids:
            tag_ids.append("bestseller")
        if product.get("deal_enabled") and (not product.get("deal_ends_at") or _iso_after(product.get("deal_ends_at"), now)):
            tag_ids.append("deal")
        if pid in top_ids:
            tag_ids.append("top")
        if int(product.get("stock") or 0) <= 5:
            tag_ids.append("limited")

        enabled = settings["tags"]
        product["smart_tag_ids"] = [tag_id for tag_id in tag_ids if enabled[tag_id]["enabled"]]
        product["smart_tags"] = [enabled[tag_id]["label"] for tag_id in product["smart_tag_ids"]]