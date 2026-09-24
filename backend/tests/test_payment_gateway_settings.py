"""Payment gateway settings remain masked in API responses and persist provider fields."""
import os
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient


for line in Path("/app/frontend/.env").read_text().splitlines():
    if line.startswith("REACT_APP_BACKEND_URL="):
        API = f"{line.split('=', 1)[1].strip().rstrip('/')}/api"
        break
else:
    raise RuntimeError("REACT_APP_BACKEND_URL is not configured")


@pytest.fixture
def restore_gateway_settings():
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    database = client[os.environ["DB_NAME"]]
    original = database.payment_gateway_settings.find_one({"id": "singleton"})
    try:
        yield database
    finally:
        if original is None:
            database.payment_gateway_settings.delete_one({"id": "singleton"})
        else:
            database.payment_gateway_settings.replace_one({"id": "singleton"}, original, upsert=True)
        client.close()


@pytest.fixture
def restore_country_access_settings():
    """Restore country access singleton after payment-gateway exemption checks."""
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    database = client[os.environ["DB_NAME"]]
    original = database.country_access_settings.find_one({"_id": "singleton"})
    try:
        yield database
    finally:
        if original is None:
            database.country_access_settings.delete_one({"_id": "singleton"})
        else:
            database.country_access_settings.replace_one({"_id": "singleton"}, original, upsert=True)
        client.close()


class TestPaymentGatewaySettings:
    # Module coverage: payment gateway public/secrets/settings endpoint behavior and security regressions.
    def test_saves_provider_settings_and_masks_secrets(self, restore_gateway_settings):
        stripe_update = requests.patch(f"{API}/payment-gateway/settings", json={
            "stripe": {
                "publishable_key": "pk_test_qa_publishable",
                "secret_key": "sk_test_qa_secret",
                "webhook_secret": "whsec_test_qa_webhook",
                "payment_methods": {"apple_pay": True, "google_pay": True, "afterpay": False},
            },
        }, timeout=20)
        assert stripe_update.status_code == 200, stripe_update.text
        public = stripe_update.json()
        assert public["stripe"]["publishable_key"] == "pk_test_qa_publishable"
        assert public["stripe"]["secret_key_configured"] is True
        assert public["stripe"]["payment_methods"] == {"apple_pay": True, "google_pay": True, "afterpay": False}
        assert "secret_key" not in public["stripe"]

        paypal_update = requests.patch(f"{API}/payment-gateway/settings", json={
            "paypal": {"client_id": "paypal-qa-client", "client_secret": "paypal-qa-secret", "mode": "sandbox"},
        }, timeout=20)
        assert paypal_update.status_code == 200, paypal_update.text
        public = paypal_update.json()
        assert public["paypal"]["client_id"] == "paypal-qa-client"
        assert public["paypal"]["client_secret_configured"] is True
        assert public["paypal"]["mode"] == "sandbox"
        assert "client_secret" not in public["paypal"]
        assert public["stripe"]["payment_methods"]["apple_pay"] is True

        stored = restore_gateway_settings.payment_gateway_settings.find_one({"id": "singleton"}, {"_id": 0})
        assert stored["stripe"]["secret_key"] == "sk_test_qa_secret"
        assert stored["stripe"]["webhook_secret"] == "whsec_test_qa_webhook"
        assert stored["paypal"]["client_secret"] == "paypal-qa-secret"

        blank_secret = requests.patch(f"{API}/payment-gateway/settings", json={"stripe": {"secret_key": ""}}, timeout=20)
        assert blank_secret.status_code == 400
        stored_after = restore_gateway_settings.payment_gateway_settings.find_one({"id": "singleton"}, {"_id": 0})
        assert stored_after["stripe"]["secret_key"] == "sk_test_qa_secret"

    def test_get_has_safe_default_shape(self):
        response = requests.get(f"{API}/payment-gateway/settings", timeout=20)
        assert response.status_code == 200, response.text
        body = response.json()
        assert set(body["stripe"]["payment_methods"]) == {"apple_pay", "google_pay", "afterpay"}
        assert "secret_key" not in body["stripe"]
        assert "client_secret" not in body["paypal"]

    def test_pcstore_endpoints_mask_public_data_and_require_shared_secret(self, restore_gateway_settings):
        internal_secret = "qa-pcstore-internal-secret-0123456789abcdef"
        restore_gateway_settings.payment_gateway_settings.update_one({"id": "singleton"}, {"$set": {
            "id": "singleton", "currency": "AUD", "pcstore_internal_secret": internal_secret,
            "stripe": {"publishable_key": "pk_test_public", "secret_key": "sk_test_private", "webhook_secret": "whsec_private", "payment_methods": {"apple_pay": True, "google_pay": True, "afterpay": False}},
            "paypal": {"client_id": "paypal-public", "client_secret": "paypal-private", "mode": "live"},
        }}, upsert=True)

        public = requests.get(f"{API}/payment-gateway", timeout=20)
        assert public.status_code == 200, public.text
        origin_public = requests.get("http://127.0.0.1:8001/api/payment-gateway", timeout=20)
        assert origin_public.headers["Cache-Control"] == "public, max-age=60"
        assert public.json() == {
            "currency": "AUD",
            "stripe": {"enabled": True, "publishable_key": "pk_test_public"},
            "paypal": {"enabled": True, "client_id": "paypal-public", "mode": "live"},
            "apple_pay": {"enabled": True}, "google_pay": {"enabled": True}, "afterpay": {"enabled": False},
        }
        assert "sk_test_private" not in public.text and "paypal-private" not in public.text

        # A legacy secret accidentally pasted into the publishable slot is
        # suppressed from all public/browser responses.
        restore_gateway_settings.payment_gateway_settings.update_one(
            {"id": "singleton"}, {"$set": {"stripe.publishable_key": "sk_test_misplaced_secret"}},
        )
        protected = requests.get(f"{API}/payment-gateway", timeout=20)
        assert protected.json()["stripe"] == {"enabled": False, "publishable_key": ""}

        # Legacy sk_ value is also suppressed on /settings payload.
        settings_public = requests.get(f"{API}/payment-gateway/settings", timeout=20)
        assert settings_public.status_code == 200, settings_public.text
        assert settings_public.json()["stripe"]["publishable_key"] == ""

        missing = requests.get(f"{API}/payment-gateway/secrets", timeout=20)
        wrong = requests.get(f"{API}/payment-gateway/secrets", headers={"X-PCStore-Secret": "wrong"}, timeout=20)
        assert missing.status_code == 401 and wrong.status_code == 401

        secured = requests.get(f"{API}/payment-gateway/secrets", headers={"X-PCStore-Secret": internal_secret}, timeout=20)
        assert secured.status_code == 200, secured.text
        assert secured.json() == {
            "stripe": {"secret_key": "sk_test_private", "webhook_secret": "whsec_private"},
            "paypal": {"client_id": "paypal-public", "secret": "paypal-private", "mode": "live"},
        }

        # Defensive assertion: sensitive settings must never leak from public endpoint payload.
        pub_text = public.text
        assert "pcstore_internal_secret" not in pub_text
        assert "webhook_secret" not in pub_text
        assert "client_secret" not in pub_text

    def test_patch_rejects_invalid_stripe_prefixes(self):
        bad_publishable = requests.patch(
            f"{API}/payment-gateway/settings",
            json={"stripe": {"publishable_key": "sk_test_not_publishable"}},
            timeout=20,
        )
        assert bad_publishable.status_code == 422, bad_publishable.text
        assert "pk_" in bad_publishable.text

        bad_secret = requests.patch(
            f"{API}/payment-gateway/settings",
            json={"stripe": {"secret_key": "pk_test_not_secret"}},
            timeout=20,
        )
        assert bad_secret.status_code == 422, bad_secret.text
        assert "sk_" in bad_secret.text

        bad_webhook = requests.patch(
            f"{API}/payment-gateway/settings",
            json={"stripe": {"webhook_secret": "sk_test_not_webhook"}},
            timeout=20,
        )
        assert bad_webhook.status_code == 422, bad_webhook.text
        assert "whsec_" in bad_webhook.text

    def test_payment_gateway_public_endpoint_is_exempt_from_country_lock(self, restore_country_access_settings):
        # Force-block all countries: non-exempt API routes should now 403 with CF-IPCountry set.
        restore_country_access_settings.country_access_settings.update_one(
            {"_id": "singleton"},
            {"$set": {"_id": "singleton", "allowed_country_codes": [], "updated_at": "qa-test"}},
            upsert=True,
        )

        blocked = requests.get("http://127.0.0.1:8001/api/settings", headers={"CF-IPCountry": "US"}, timeout=20)
        assert blocked.status_code == 403, blocked.text

        # /api/payment-gateway must remain callable even when country lock blocks other APIs.
        public = requests.get("http://127.0.0.1:8001/api/payment-gateway", headers={"CF-IPCountry": "US"}, timeout=20)
        assert public.status_code == 200, public.text
        data = public.json()
        assert set(data.keys()) == {"currency", "stripe", "paypal", "apple_pay", "google_pay", "afterpay"}

    def test_paypal_blank_secret_is_ignored_and_keeps_other_provider_state(self, restore_gateway_settings):
        stripe_seed = requests.patch(f"{API}/payment-gateway/settings", json={
            "stripe": {
                "publishable_key": "pk_test_seed_for_paypal_blank_secret",
                "secret_key": "sk_test_seed_for_paypal_blank_secret",
                "payment_methods": {"apple_pay": True, "google_pay": False, "afterpay": True},
            }
        }, timeout=20)
        assert stripe_seed.status_code == 200, stripe_seed.text

        paypal_seed = requests.patch(f"{API}/payment-gateway/settings", json={
            "paypal": {"client_id": "paypal-seeded-client", "client_secret": "paypal-seeded-secret"}
        }, timeout=20)
        assert paypal_seed.status_code == 200, paypal_seed.text

        paypal_blank_secret = requests.patch(f"{API}/payment-gateway/settings", json={
            "paypal": {"client_id": "paypal-client-updated", "client_secret": ""}
        }, timeout=20)
        assert paypal_blank_secret.status_code == 200, paypal_blank_secret.text

        public = paypal_blank_secret.json()
        assert public["paypal"]["client_id"] == "paypal-client-updated"
        assert public["paypal"]["client_secret_configured"] is True
        assert "client_secret" not in public["paypal"]

        stored = restore_gateway_settings.payment_gateway_settings.find_one({"id": "singleton"}, {"_id": 0})
        assert stored["paypal"]["client_secret"] == "paypal-seeded-secret"
        assert stored["stripe"]["publishable_key"] == "pk_test_seed_for_paypal_blank_secret"
        assert stored["stripe"]["secret_key"] == "sk_test_seed_for_paypal_blank_secret"
        assert stored["stripe"]["payment_methods"] == {"apple_pay": True, "google_pay": False, "afterpay": True}