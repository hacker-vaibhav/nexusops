"""
Auth Middleware
───────────────
Lightweight API-key authentication.

Every request must include:
  X-API-Key: <key>

Keys are stored in Redis as:
  auth:key:{hashed_key}  →  JSON user object

For the hackathon, keys are auto-provisioned on first use (easy demo).
In production, replace _auto_provision with a real key management flow.

User isolation: every task is tagged with user_id.
GET /api/tickets only returns tasks belonging to the requesting user.
"""

import hashlib
import json
import os
import uuid
from datetime import datetime
from typing import Optional

from fastapi import Header, HTTPException, Request
from utils.state import get_redis

# Set REQUIRE_AUTH=false in .env to disable for local dev
REQUIRE_AUTH = os.getenv("REQUIRE_AUTH", "true").lower() not in ("false", "0", "no")

# Master admin key bypasses isolation (useful for judges/demo)
ADMIN_KEY = os.getenv("ADMIN_API_KEY", "nexus-admin-key")


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


async def get_or_create_user(raw_key: str) -> dict:
    """
    Look up user by API key. Auto-creates on first use (demo-friendly).
    """
    r = await get_redis()
    hashed = _hash_key(raw_key)
    data = await r.get(f"auth:key:{hashed}")
    if data:
        return json.loads(data)

    # Auto-provision new user on first use
    user = {
        "user_id":    f"usr-{uuid.uuid4().hex[:8]}",
        "api_key":    hashed,
        "created_at": datetime.utcnow().isoformat(),
        "is_admin":   raw_key == ADMIN_KEY,
    }
    await r.set(f"auth:key:{hashed}", json.dumps(user))
    return user


async def require_user(x_api_key: str = Header(default=None)) -> dict:
    """
    FastAPI dependency. Inject into any route that needs auth.

    Usage:
        @router.post("/tickets")
        async def submit(body: ..., user: dict = Depends(require_user)):
            user["user_id"]  # scoped to this user
    """
    if not REQUIRE_AUTH:
        # Auth disabled — return a consistent anonymous user
        return {"user_id": "anon", "is_admin": True}

    if not x_api_key:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "missing_api_key",
                "reason": "Include your API key in the X-API-Key header.",
                "hint":   "For demo: use any string as your key — it will be auto-registered.",
            }
        )

    user = await get_or_create_user(x_api_key)
    return user


async def get_user_tasks(user_id: str, is_admin: bool = False) -> list:
    """
    Return tasks visible to this user.
    Admins see all tasks. Regular users see only their own.
    """
    from utils.state import list_tasks
    all_tasks = await list_tasks()
    if is_admin:
        return all_tasks
    return [t for t in all_tasks if t.get("user_id") == user_id]
