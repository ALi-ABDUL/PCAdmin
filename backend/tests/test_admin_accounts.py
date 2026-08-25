"""Admin Accounts CRUD tests.

Covers:
  - Main admin is seeded on first startup and cannot be deleted.
  - Password hashing (verified indirectly — the row response never leaks
    the hash back to callers).
  - Password + email + role validation on create + update.
  - Duplicate-email guard.
  - Main admin can be edited (name change) but cannot be demoted to manager.
"""
import uuid
from pathlib import Path

import requests

BASE_URL = ""
for line in Path("/app/frontend/.env").read_text().splitlines():
    if line.startswith("REACT_APP_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


def _list():
    return requests.get(f"{API}/admin-accounts", timeout=15).json()["accounts"]


def _main():
    return next(a for a in _list() if a.get("is_main"))


def _new(role="manager"):
    email = f"t-{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/admin-accounts",
                      json={"name": "Tempy", "email": email, "password": "passw0rd!", "role": role},
                      timeout=15)
    r.raise_for_status()
    return r.json()


class TestAdminSeeding:
    def test_main_admin_is_seeded(self):
        m = _main()
        assert m["role"] == "admin"
        assert m["is_main"] is True

    def test_password_hash_never_leaks(self):
        for a in _list():
            assert "password_hash" not in a
            assert "password" not in a


class TestAdminCRUD:
    def test_create_and_delete_manager(self):
        a = _new("manager")
        assert a["role"] == "manager"
        assert a["is_main"] is False
        r = requests.delete(f"{API}/admin-accounts/{a['id']}", timeout=15)
        assert r.status_code == 200

    def test_reject_short_password(self):
        r = requests.post(f"{API}/admin-accounts",
                          json={"name": "T", "email": "t@t.com", "password": "abc", "role": "manager"},
                          timeout=15)
        assert r.status_code == 400

    def test_reject_bad_role(self):
        r = requests.post(f"{API}/admin-accounts",
                          json={"name": "T", "email": "t2@t.com", "password": "12345678", "role": "superuser"},
                          timeout=15)
        assert r.status_code == 400

    def test_reject_bad_email(self):
        r = requests.post(f"{API}/admin-accounts",
                          json={"name": "T", "email": "not-an-email", "password": "12345678", "role": "manager"},
                          timeout=15)
        assert r.status_code == 400

    def test_reject_duplicate_email(self):
        a = _new("manager")
        try:
            r = requests.post(f"{API}/admin-accounts",
                              json={"name": "Dup", "email": a["email"], "password": "12345678", "role": "manager"},
                              timeout=15)
            assert r.status_code == 400
        finally:
            requests.delete(f"{API}/admin-accounts/{a['id']}", timeout=15)

    def test_patch_updates_name_and_role(self):
        a = _new("manager")
        try:
            r = requests.patch(f"{API}/admin-accounts/{a['id']}",
                               json={"name": "Elevated", "role": "admin"}, timeout=15)
            assert r.status_code == 200
            body = r.json()
            assert body["name"] == "Elevated"
            assert body["role"] == "admin"
        finally:
            requests.delete(f"{API}/admin-accounts/{a['id']}", timeout=15)

    def test_patch_password_when_provided(self):
        # Just verify the endpoint accepts a password change and returns 200
        # (the hash update is exercised end-to-end via the sign-in flow later).
        a = _new("manager")
        try:
            r = requests.patch(f"{API}/admin-accounts/{a['id']}",
                               json={"password": "brand-new-pw"}, timeout=15)
            assert r.status_code == 200
        finally:
            requests.delete(f"{API}/admin-accounts/{a['id']}", timeout=15)

    def test_patch_rejects_short_password(self):
        a = _new("manager")
        try:
            r = requests.patch(f"{API}/admin-accounts/{a['id']}",
                               json={"password": "short"}, timeout=15)
            assert r.status_code == 400
        finally:
            requests.delete(f"{API}/admin-accounts/{a['id']}", timeout=15)


class TestMainAdminProtection:
    def test_cannot_delete_main_admin(self):
        m = _main()
        r = requests.delete(f"{API}/admin-accounts/{m['id']}", timeout=15)
        assert r.status_code == 400
        # Still present after the failed delete
        assert any(a["id"] == m["id"] for a in _list())

    def test_cannot_demote_main_admin_to_manager(self):
        m = _main()
        r = requests.patch(f"{API}/admin-accounts/{m['id']}",
                           json={"role": "manager"}, timeout=15)
        assert r.status_code == 400
        # Sanity: still an admin
        again = _main()
        assert again["role"] == "admin"

    def test_can_rename_main_admin(self):
        m = _main()
        original = m["name"]
        try:
            r = requests.patch(f"{API}/admin-accounts/{m['id']}",
                               json={"name": "Renamed Admin"}, timeout=15)
            assert r.status_code == 200
            assert r.json()["name"] == "Renamed Admin"
        finally:
            requests.patch(f"{API}/admin-accounts/{m['id']}",
                           json={"name": original}, timeout=15)
