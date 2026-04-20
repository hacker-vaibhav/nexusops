"""
State management using Redis.
Every task is a JSON blob keyed by task_id.
WebSocket subscribers get pushed updates in real-time via pub/sub.
"""

import asyncio
import fnmatch
import json
import time
import uuid
from datetime import datetime
from typing import Optional
import redis.asyncio as aioredis
import os

_redis: Optional[aioredis.Redis] = None


def _safe_json_loads(raw):
    try:
        return json.loads(raw)
    except Exception:
        return None


class _MemoryRedis:
    """Small async Redis-like fallback for local development."""

    def __init__(self):
        self._kv: dict[str, tuple[str, float | None]] = {}
        self._lists: dict[str, list[str]] = {}
        self._zsets: dict[str, dict[str, float]] = {}
        self._lock = asyncio.Lock()

    def _now(self) -> float:
        return time.time()

    def _purge_expired(self):
        now = self._now()
        expired = [k for k, (_, exp) in self._kv.items() if exp is not None and exp <= now]
        for key in expired:
            self._kv.pop(key, None)

    async def ping(self):
        return True

    async def set(self, key, value, ex=None, nx=False):
        async with self._lock:
            self._purge_expired()
            if nx and key in self._kv:
                return False
            expires_at = self._now() + ex if ex else None
            self._kv[key] = (str(value), expires_at)
            return True

    async def get(self, key):
        async with self._lock:
            self._purge_expired()
            item = self._kv.get(key)
            return item[0] if item else None

    async def delete(self, key):
        async with self._lock:
            removed = 0
            if key in self._kv:
                self._kv.pop(key, None)
                removed += 1
            if key in self._lists:
                self._lists.pop(key, None)
                removed += 1
            if key in self._zsets:
                self._zsets.pop(key, None)
                removed += 1
            return removed

    async def publish(self, channel, message):
        return 0

    async def keys(self, pattern):
        async with self._lock:
            self._purge_expired()
            all_keys = set(self._kv) | set(self._lists) | set(self._zsets)
            return [key for key in sorted(all_keys) if fnmatch.fnmatch(key, pattern)]

    async def incrbyfloat(self, key, value):
        async with self._lock:
            self._purge_expired()
            current = float(self._kv.get(key, ("0", None))[0] or 0.0)
            new_value = current + float(value)
            self._kv[key] = (str(new_value), None)
            return new_value

    async def lpush(self, key, value):
        async with self._lock:
            self._lists.setdefault(key, []).insert(0, str(value))
            return len(self._lists[key])

    async def rpush(self, key, value):
        async with self._lock:
            self._lists.setdefault(key, []).append(str(value))
            return len(self._lists[key])

    async def ltrim(self, key, start, stop):
        async with self._lock:
            items = self._lists.get(key, [])
            if stop < 0:
                stop = len(items) + stop
            self._lists[key] = items[start:stop + 1]
            return True

    async def lrange(self, key, start, stop):
        async with self._lock:
            items = list(self._lists.get(key, []))
            if stop == -1:
                stop = len(items) - 1
            return items[start:stop + 1]

    async def expire(self, key, ttl):
        async with self._lock:
            self._purge_expired()
            if key in self._kv:
                value, _ = self._kv[key]
                self._kv[key] = (value, self._now() + ttl)
            return True

    async def zadd(self, key, mapping):
        async with self._lock:
            zset = self._zsets.setdefault(key, {})
            for member, score in mapping.items():
                zset[str(member)] = float(score)
            return len(mapping)

    async def bzpopmin(self, key, timeout=5):
        deadline = self._now() + timeout
        while True:
            async with self._lock:
                zset = self._zsets.get(key, {})
                if zset:
                    member = min(zset, key=zset.get)
                    score = zset.pop(member)
                    return (key, member, score)
            if self._now() >= deadline:
                return None
            await asyncio.sleep(0.1)

    async def zcard(self, key):
        async with self._lock:
            return len(self._zsets.get(key, {}))

    async def zrank(self, key, member):
        async with self._lock:
            zset = self._zsets.get(key, {})
            ordered = sorted(zset.items(), key=lambda item: item[1])
            for idx, (item_member, _) in enumerate(ordered):
                if item_member == member:
                    return idx
            return None

    async def zrem(self, key, member):
        async with self._lock:
            zset = self._zsets.get(key, {})
            if member in zset:
                del zset[member]
                return 1
            return 0

    async def close(self):
        return None


async def init_redis():
    global _redis
    url = os.getenv("REDIS_URL", "redis://localhost:6379")
    if url.startswith("memory://"):
        _redis = _MemoryRedis()
        return

    client = aioredis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
        health_check_interval=30,
    )
    try:
        await asyncio.wait_for(client.ping(), timeout=2)
        _redis = client
    except Exception:
        try:
            await client.close()
        except Exception:
            pass
        _redis = _MemoryRedis()


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        await init_redis()
    return _redis


def new_task_id() -> str:
    return f"TK-{str(uuid.uuid4())[:8].upper()}"


async def create_task(ticket_text: str) -> dict:
    task_id = new_task_id()
    task = {
        "task_id": task_id,
        "ticket": ticket_text,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat(),
        "steps": [],
        "final_report": None,
        "error": None,
        "total_duration_ms": None,
    }
    r = await get_redis()
    await r.set(f"task:{task_id}", json.dumps(task))
    return task


async def get_task(task_id: str) -> Optional[dict]:
    r = await get_redis()
    raw = await r.get(f"task:{task_id}")
    return _safe_json_loads(raw) if raw else None


async def update_task(task_id: str, updates: dict):
    """Merge updates into task and broadcast via pub/sub."""
    r = await get_redis()
    raw = await r.get(f"task:{task_id}")
    if not raw:
        return
    task = json.loads(raw)
    task.update(updates)
    await r.set(f"task:{task_id}", json.dumps(task))
    await r.publish(f"task_updates:{task_id}", json.dumps(task))


async def add_step(task_id: str, step: dict):
    """Add or update a step in the task's step list, then broadcast."""
    r = await get_redis()
    raw = await r.get(f"task:{task_id}")
    if not raw:
        return
    task = json.loads(raw)
    steps = task.get("steps", [])
    idx = next((i for i, s in enumerate(steps) if s["step_id"] == step["step_id"]), None)
    if idx is not None:
        steps[idx] = step
    else:
        steps.append(step)
    task["steps"] = steps
    await r.set(f"task:{task_id}", json.dumps(task))
    await r.publish(f"task_updates:{task_id}", json.dumps(task))


async def list_tasks() -> list:
    r = await get_redis()
    keys = await r.keys("task:*")
    tasks = []
    for k in sorted(keys, reverse=True)[:20]:
        raw = await r.get(k)
        item = _safe_json_loads(raw) if raw else None
        if item:
            tasks.append(item)
    return tasks


async def append_history(entry: dict):
    """Persist a deployment history entry for the UI."""
    r = await get_redis()
    payload = json.dumps(entry)
    if hasattr(r, "lpush"):
        await r.lpush("history", payload)
        await r.ltrim("history", 0, 19)


async def list_history(limit: int = 20, user_id: str | None = None, is_admin: bool = False) -> list[dict]:
    """Return the most recent deployment history entries."""
    r = await get_redis()
    raw = await r.lrange("history", 0, -1)
    items = []
    for item in raw:
        parsed = _safe_json_loads(item)
        if not parsed:
            continue
        if not is_admin and user_id and parsed.get("user_id") not in {None, user_id}:
            continue
        items.append(parsed)
    return items[:limit]


async def append_log(task_id: str, message: str, level: str):
    """Persist a task log entry for replay in the UI."""
    r = await get_redis()
    entry = {
        "task_id": task_id,
        "message": message,
        "level": level,
        "ts": datetime.utcnow().isoformat(),
    }
    key = f"logs:{task_id}"
    if hasattr(r, "rpush"):
        await r.rpush(key, json.dumps(entry))
        await r.ltrim(key, -200, -1)


async def list_logs(task_id: str, limit: int = 200) -> list[dict]:
    """Return the most recent logs for a task, oldest first."""
    r = await get_redis()
    raw = await r.lrange(f"logs:{task_id}", 0, -1)
    logs = [json.loads(item) for item in raw if item]
    return logs[-limit:]
