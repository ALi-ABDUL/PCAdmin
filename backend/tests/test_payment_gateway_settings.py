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


class TestPaymentGatewaySettings:
    def test_saves_provider_settings_and_masks_secrets(self, restore_gateway_settings):
        stripe_update = requests.patch(f"{API}/payment-gateway/settings", json={
            "stripe": {
                "publishable_key": "pk_test_qa_publishable",
                "secret_key": "sk_test_qa_secret",
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
            "paypal": {"client_id": "paypal-qa-client", "client_secret": "paypal-qa-secret"},
        }, timeout=20)
        assert paypal_update.status_code == 200, paypal_update.text
        public = paypal_update.json()
        assert public["paypal"]["client_id"] == "paypal-qa-client"
        assert public["paypal"]["client_secret_configured"] is True
        assert "client_secret" not in public["paypal"]
        assert public["stripe"]["payment_methods"]["apple_pay"] is True

        stored = restore_gateway_settings.payment_gateway_settings.find_one({"id": "singleton"}, {"_id": 0})
        assert stored["stripe"]["secret_key"] == "sk_test_qa_secret"
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