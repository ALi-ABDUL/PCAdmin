"""Seed scraper schedule with mock failed rows for UI retry-control testing.

This does not trigger any scraper provider/eBay requests.
"""

import asyncio
import sys

sys.path.insert(0, "/app/backend")
import server  # noqa: E402


async def main():
    failed_1 = "ui-mock-failed-1"
    failed_2 = "ui-mock-failed-2"
    ok_1 = "ui-mock-ok-1"
    await server.db.scraper_schedule.update_one(
        {"id": "singleton"},
        {
            "$set": {
                **server.SCRAPER_SCHEDULE_DEFAULTS,
                "last_run_results": [
                    {
                        "id": failed_1,
                        "item_id": failed_1,
                        "title": "Mock failed item 1",
                        "url": "https://example.com/mock-failed-1",
                        "image": None,
                        "ok": False,
                        "sold": False,
                        "error": "MOCKED timeout",
                        "at": "2026-02-01T00:00:00+00:00",
                    },
                    {
                        "id": failed_2,
                        "item_id": failed_2,
                        "title": "Mock failed item 2",
                        "url": "https://example.com/mock-failed-2",
                        "image": None,
                        "ok": False,
                        "sold": False,
                        "error": "MOCKED provider unavailable",
                        "at": "2026-02-01T00:00:00+00:00",
                    },
                    {
                        "id": ok_1,
                        "item_id": ok_1,
                        "title": "Mock ok item",
                        "url": "https://example.com/mock-ok-1",
                        "image": None,
                        "ok": True,
                        "sold": False,
                        "error": None,
                        "at": "2026-02-01T00:00:00+00:00",
                    },
                ],
                "last_run_stats": {"refreshed": 1, "sold_found": 0, "failed": 2, "total": 3},
            }
        },
        upsert=True,
    )
    print("Seeded mock scraper schedule state for UI retry-controls testing.")


if __name__ == "__main__":
    asyncio.run(main())
