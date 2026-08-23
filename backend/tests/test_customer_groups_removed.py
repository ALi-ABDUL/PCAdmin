"""Verify Customer Groups feature has been removed end-to-end.

Covers:
- GET /api/customers has no top-level `groups`; customer objects have no `group` field
- GET /api/customers/summary has no `by_group`
- POST /api/customers strips extra `group` from body (Pydantic model dropped)
- GET /api/customers?group=Retail (unknown query param) still returns 200 with no crash
- PATCH /api/customers/{id} with `group` does not persist it
- POST /api/customers/rebuild-from-orders creates customers with no `group`
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestCustomerGroupsRemoved:
    def test_list_customers_no_groups_key_and_no_group_field(self, api_client):
        r = api_client.get(f"{API}/customers?limit=25")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "groups" not in data, f"top-level 'groups' key still present: {list(data.keys())}"
        assert "customers" in data
        for c in data["customers"]:
            assert "group" not in c, f"Customer {c.get('id')} still has 'group' field: {c.get('group')}"

    def test_customers_summary_no_by_group(self, api_client):
        r = api_client.get(f"{API}/customers/summary")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "by_group" not in data, f"'by_group' key still present in summary: {list(data.keys())}"
        for k in ("total", "active", "pending", "blocked", "guest", "registered", "top"):
            assert k in data, f"expected key '{k}' missing from summary"

    def test_create_customer_drops_group_in_body(self, api_client):
        payload = {"name": "TEST_no_group_body", "email": "TEST_nogroupbody@example.com", "group": "VIP"}
        r = api_client.post(f"{API}/customers", json=payload)
        assert r.status_code in (200, 201), r.text
        created = r.json()
        assert "group" not in created, f"POST response contains 'group': {created}"
        cid = created["id"]
        # verify persistence via GET
        g = api_client.get(f"{API}/customers/{cid}")
        assert g.status_code == 200
        assert "group" not in g.json()["customer"], "persisted customer has 'group' field"

    def test_list_customers_with_group_query_param_ignored(self, api_client):
        r = api_client.get(f"{API}/customers?group=Retail&limit=5")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "customers" in data
        for c in data["customers"]:
            assert "group" not in c

    def test_patch_customer_group_not_persisted(self, api_client):
        # create a customer first
        r = api_client.post(f"{API}/customers", json={"name": "TEST_patch_group", "email": "TEST_patchgroup@example.com"})
        assert r.status_code in (200, 201), r.text
        cid = r.json()["id"]
        # patch with group
        p = api_client.patch(f"{API}/customers/{cid}", json={"group": "VIP", "name": "TEST_patch_group_v2"})
        assert p.status_code in (200, 204), p.text
        g = api_client.get(f"{API}/customers/{cid}")
        assert g.status_code == 200
        cust = g.json()["customer"]
        assert "group" not in cust, f"PATCH persisted 'group': {cust}"
        assert cust["name"] == "TEST_patch_group_v2"

    def test_rebuild_from_orders_no_group(self, api_client):
        r = api_client.post(f"{API}/customers/rebuild-from-orders")
        assert r.status_code == 200, r.text
        # list all customers and check none have group
        lst = api_client.get(f"{API}/customers?limit=500")
        assert lst.status_code == 200
        for c in lst.json()["customers"]:
            assert "group" not in c, f"After rebuild, customer {c.get('id')} has 'group'"
