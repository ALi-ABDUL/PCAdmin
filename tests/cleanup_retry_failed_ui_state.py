"""Remove mock retry-control rows seeded for UI testing."""

import asyncio
import sys

sys.path.insert(0, "/app/backend")
import server  # noqa: E402


def _summarise(rows):
    refreshed = sum(1 for row in rows if row.get("ok"))
    failed = sum(1 for row in rows if not row.get("ok"))
    sold_found = sum(1 for row in rows if row.get("sold"))
    return {"refreshed": refreshed, "sold_found": sold_found, "failed": failed, "total": len(rows)}


async def main():
    sched = await server.db.scraper_schedule.find_one({"id": "singleton"}, {"_id": 0}) or {**server.SCRAPER_SCHEDULE_DEFAULTS}
    rows = list(sched.get("last_run_results") or [])
    kept = [r for r in rows if not str(r.get("id") or "").startswith("ui-mock-")]
    stats = _summarise(kept)
    await server.db.scraper_schedule.update_one(
        {"id": "singleton"},
        {"$set": {"last_run_results": kept, "last_run_stats": stats}},
        upsert=True,
    )
    print(f"Removed {len(rows) - len(kept)} mock rows.")


if __name__ == "__main__":
    asyncio.run(main())
