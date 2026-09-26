"""Narrow server-verified session support for sensitive PCAdmin actions."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Cookie, Header, HTTPException

from deps import db
from helpers import _jwt_secret
from models import JWT_ALGO


ADMIN_SESSION_TTL = timedelta(hours=8)


def issue_admin_session(account: dict) -> str:
    return jwt.encode({
        "sub": account["id"], "email": account["email"], "type": "admin_access",
        "exp": datetime.now(timezone.utc) + ADMIN_SESSION_TTL,
    }, _jwt_secret(), algorithm=JWT_ALGO)


async def get_current_admin(
    admin_access_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None),
) -> dict:
    token = admin_access_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Sign in again to send a test email")
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Your admin session expired. Sign in again to continue.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid admin session")
    if payload.get("type") != "admin_access" or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid admin session")
    account = await db.admin_accounts.find_one(
        {"id": payload["sub"], "email": (payload.get("email") or "").lower()},
        {"_id": 0, "password_hash": 0},
    )
    if not account or account.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can send test emails")
    return account