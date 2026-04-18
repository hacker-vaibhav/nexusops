"""
Priority Queue & Task Cancellation
────────────────────────────────────
Replaces the simple _running_count counter with a proper queue.

Priority levels (lower number = higher priority):
  1 = critical   (production deployments)
  2 = high       (staging deployments)
  3 = normal     (default)
  4 = low        (development / background)

Redis sorted set: queue:pending
  score = priority * 1e12 + submitted_epoch_ms   (lower score = dequeued first)

Task cancellation:
  - Sets cancel flag in Redis
  - Orchestrator checks this flag between steps and aborts cleanly
  - Rollback is triggered automatically on cancellation
"""

import asyncio
import json
import os
import time
from datetime import datetime
from typing import Optional

from utils.state import get_redis, update_task

QUEUE_KEY        = "queue:pending"
CANCEL_KEY_TPL   = "cancel:{task_id}"
TIMEOUT_SECONDS  = int(os.getenv("TASK_TIMEOUT_SECONDS", "1800"))   # 30 min hard timeout


# ── Enqueue ───────────────────────────────────────────────────────────────

async def enqueue_task(task_id: str, priority: int = 3):
    """Add task to the priority queue."""
    r = await get_redis()
    score = priority * 1_000_000_000_000 + int(time.time() * 1000)
    await r.zadd(QUEUE_KEY, {task_id: score})
    await update_task(task_id, {
        "queue_priority": priority,
        "queued_at": datetime.utcnow().isoformat(),
        "status": "queued",
    })


async def dequeue_next() -> Optional[str]:
    """Pop the highest-priority task from the queue (blocking, 5s timeout)."""
    r = await get_redis()
    # BZPOPMIN: block up to 5s, returns (key, member, score)
    result = await r.bzpopmin(QUEUE_KEY, timeout=5)
    if result:
        return result[1]  # task_id
    return None


async def queue_length() -> int:
    r = await get_redis()
    return await r.zcard(QUEUE_KEY)


async def queue_position(task_id: str) -> Optional[int]:
    """Return 0-based position in queue (0 = next to run)."""
    r = await get_redis()
    rank = await r.zrank(QUEUE_KEY, task_id)
    return rank  # None if not in queue


# ── Cancellation ──────────────────────────────────────────────────────────

async def request_cancellation(task_id: str, reason: str = "User requested"):
    """
    Signal that a task should be cancelled.
    The orchestrator polls this between steps.
    """
    r = await get_redis()
    await r.set(
        CANCEL_KEY_TPL.format(task_id=task_id),
        json.dumps({"reason": reason, "requested_at": datetime.utcnow().isoformat()}),
        ex=86400  # expire after 24h
    )
    # Also remove from queue if it hasn't started yet
    await r.zrem(QUEUE_KEY, task_id)
    await update_task(task_id, {"status": "cancelling", "cancel_reason": reason})


async def is_cancelled(task_id: str) -> Optional[dict]:
    """
    Returns cancellation info if the task was cancelled, else None.
    Called by the orchestrator between steps.
    """
    r = await get_redis()
    raw = await r.get(CANCEL_KEY_TPL.format(task_id=task_id))
    return json.loads(raw) if raw else None


async def clear_cancellation(task_id: str):
    r = await get_redis()
    await r.delete(CANCEL_KEY_TPL.format(task_id=task_id))


# ── Timeout ───────────────────────────────────────────────────────────────

async def check_timeout(task_id: str, started_at: float) -> bool:
    """Returns True if the task has exceeded TASK_TIMEOUT_SECONDS."""
    return (time.time() - started_at) > TIMEOUT_SECONDS
