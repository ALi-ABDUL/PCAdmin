"""Tests for the disposable / temporary email blocklist.

Covers:
  1. `GET /api/security/disposable-domains` — returns the seeded default list
  2. `POST /api/portal/register` blocks every disposable domain with the exact
     user-facing error message
  3. Sub-domain enforcement (blocking `mail.tm` also blocks `sub.mail.tm`)
  4. `PATCH /api/security/disposable-domains` — normalises, de-dupes, sorts,
     and allows admins to add or remove domains
  5. Admin can add a NEW domain and immediately register from it is blocked
  6. Admin can REMOVE a seeded domain and register with it (falls through
     to the standard "no prior order" gate — proving the disposable check
     no longer triggers)

All tests live in one class so pytest-xdist's `loadscope` runs them in a
single worker — they all mutate the same shared blocklist singleton, so
parallel execution across the class would race.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"

DISPOSABLE_ERROR = "Please use a valid email address. Temporary or disposable emails are not accepted."

SEEDED_DOMAINS = {
    "yopmail.com", "10minutemail.com", "temp-mail.org", "tempmail.com",
    "mail.tm", "emailnator.com", "guerrillamail.com", "getnada.com",
    "throwawaymail.com", "maildrop.cc", "burnermail.io", "sharklasers.com",
    "fakeinbox.com", "tempinbox.com", "mail2world.com", "inboxes.com",
    "dispostable.com", "tempmailaddress.com", "trashmail.com", "mytemp.email",
    "tempr.email", "temp-emails.com", "mailexpire.com", "dropmail.me",
    "mailinator.com", "10minemail.net", "temp-mail.io", "spambox.us",
    "tempmail.plus", "anonaddy.com", "mailnesia.com", "discard.email",
    "simplelogin.io", "mailnull.com", "tempinbox.net",
}


class TestDisposableDomains:
    """Every case runs in the same worker (pytest-xdist loadscope) — see
    module docstring for the rationale."""

    @classmethod
    @pytest.fixture(autouse=True, scope="class")
    def snapshot(cls):
        """Capture the current blocklist so the class can restore it at the
        end even if a test adds/removes entries mid-run."""
        r = requests.get(f"{API}/security/disposable-domains", timeout=15)
        assert r.status_code == 200, r.text
        original = list(r.json()["domains"])
        yield original
        # Always restore the exact original list.
        requests.patch(f"{API}/security/disposable-domains", json={"domains": original}, timeout=15)

    # --- Seeded list --------------------------------------------------------

    def test_get_returns_seeded_list(self, snapshot):
        current = set(snapshot)
        missing = SEEDED_DOMAINS - current
        assert not missing, f"seeded domains missing from blocklist: {missing}"

    def test_response_shape(self):
        r = requests.get(f"{API}/security/disposable-domains", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "domains" in body and isinstance(body["domains"], list)
        assert "total" in body and body["total"] == len(body["domains"])
        assert body["domains"] == sorted(body["domains"])

    # --- Register blocked ---------------------------------------------------

    @pytest.mark.parametrize("domain", sorted(SEEDED_DOMAINS))
    def test_register_blocks_every_seeded_domain(self, snapshot, domain):
        _ = snapshot
        email = f"disp-{uuid.uuid4().hex[:8]}@{domain}"
        r = requests.post(f"{API}/portal/register",
                          json={"email": email, "password": "secret123"}, timeout=15)
        assert r.status_code == 400, f"{domain}: expected 400, got {r.status_code} {r.text}"
        assert r.json()["detail"] == DISPOSABLE_ERROR

    def test_register_blocks_subdomain(self, snapshot):
        _ = snapshot
        email = f"disp-{uuid.uuid4().hex[:8]}@sub.mail.tm"
        r = requests.post(f"{API}/portal/register",
                          json={"email": email, "password": "secret123"}, timeout=15)
        assert r.status_code == 400
        assert r.json()["detail"] == DISPOSABLE_ERROR

    def test_similar_but_not_matching_domain_not_blocked(self, snapshot):
        """`notyopmail.com` must NOT be caught by the `yopmail.com` rule —
        the suffix check requires a real dot boundary."""
        _ = snapshot
        email = f"safe-{uuid.uuid4().hex[:8]}@notyopmail.com"
        r = requests.post(f"{API}/portal/register",
                          json={"email": email, "password": "secret123"}, timeout=15)
        assert r.status_code != 400 or r.json()["detail"] != DISPOSABLE_ERROR

    # --- Precedence ---------------------------------------------------------

    def test_bad_email_format_error_wins_over_disposable(self, snapshot):
        _ = snapshot
        r = requests.post(f"{API}/portal/register",
                          json={"email": "no-at-sign", "password": "secret123"}, timeout=15)
        assert r.status_code == 400
        assert "valid email address" in r.json()["detail"].lower()
        assert "disposable" not in r.json()["detail"].lower()

    def test_short_password_still_blocked_but_disposable_wins(self, snapshot):
        """When both password length and disposable domain are wrong, the
        disposable error must surface first — it's the clearer signal for
        the user."""
        _ = snapshot
        r = requests.post(f"{API}/portal/register",
                          json={"email": "a@yopmail.com", "password": "x"}, timeout=15)
        assert r.status_code == 400
        assert r.json()["detail"] == DISPOSABLE_ERROR

    # --- Admin edits --------------------------------------------------------
    # These mutate the blocklist. Each test snapshots the CURRENT list before
    # its changes and always restores it in `finally` so subsequent tests see
    # a clean state.

    def test_add_new_domain_and_register_gets_blocked(self):
        r = requests.get(f"{API}/security/disposable-domains", timeout=15)
        current = list(r.json()["domains"])
        new_domain = f"custom-block-{uuid.uuid4().hex[:6]}.test"
        try:
            r = requests.patch(f"{API}/security/disposable-domains",
                               json={"domains": current + [new_domain]}, timeout=15)
            assert r.status_code == 200
            assert new_domain in r.json()["domains"]
            reg = requests.post(f"{API}/portal/register",
                                json={"email": f"foo@{new_domain}", "password": "secret123"}, timeout=15)
            assert reg.status_code == 400
            assert reg.json()["detail"] == DISPOSABLE_ERROR
        finally:
            requests.patch(f"{API}/security/disposable-domains",
                           json={"domains": current}, timeout=15)

    def test_remove_domain_makes_it_allowed_again(self):
        r = requests.get(f"{API}/security/disposable-domains", timeout=15)
        current = list(r.json()["domains"])
        assert "yopmail.com" in current
        reduced = [d for d in current if d != "yopmail.com"]
        try:
            r = requests.patch(f"{API}/security/disposable-domains",
                               json={"domains": reduced}, timeout=15)
            assert r.status_code == 200
            assert "yopmail.com" not in r.json()["domains"]
            reg = requests.post(f"{API}/portal/register",
                                json={"email": f"foo-{uuid.uuid4().hex[:6]}@yopmail.com",
                                      "password": "secret123"}, timeout=15)
            assert reg.status_code != 400 or reg.json()["detail"] != DISPOSABLE_ERROR
        finally:
            requests.patch(f"{API}/security/disposable-domains",
                           json={"domains": current}, timeout=15)

    def test_patch_normalises_and_dedupes(self):
        r = requests.get(f"{API}/security/disposable-domains", timeout=15)
        current = list(r.json()["domains"])
        try:
            # Mixed case, whitespace, duplicates, `@` prefix — should collapse.
            r = requests.patch(f"{API}/security/disposable-domains",
                               json={"domains": ["  Yopmail.COM ", "yopmail.com", "@mailinator.com", "mailinator.com"]},
                               timeout=15)
            assert r.status_code == 200
            got = r.json()["domains"]
            assert got == sorted(set(got))
            assert "yopmail.com" in got
            assert "mailinator.com" in got
            assert len(got) == 2
        finally:
            requests.patch(f"{API}/security/disposable-domains",
                           json={"domains": current}, timeout=15)

    def test_empty_list_disables_check(self):
        r = requests.get(f"{API}/security/disposable-domains", timeout=15)
        current = list(r.json()["domains"])
        try:
            r = requests.patch(f"{API}/security/disposable-domains",
                               json={"domains": []}, timeout=15)
            assert r.status_code == 200
            assert r.json()["domains"] == []
            reg = requests.post(f"{API}/portal/register",
                                json={"email": f"anyone-{uuid.uuid4().hex[:6]}@yopmail.com",
                                      "password": "secret123"}, timeout=15)
            assert reg.status_code != 400 or reg.json()["detail"] != DISPOSABLE_ERROR
        finally:
            requests.patch(f"{API}/security/disposable-domains",
                           json={"domains": current}, timeout=15)
