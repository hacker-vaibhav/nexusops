"""
Observability
─────────────
Metrics, latency tracking, and step-level tracing.

Stored in Redis as time-series counters and JSON trace objects.
Exposed via GET /api/metrics endpoint.

Metrics tracked:
  - Task counts (total, success, failed, cancelled)
  - Step latencies (per tool, p50/p95/p99)
  - Retry counts (per tool)
  - Validation outcomes (VALID/INVALID/INCOMPLETE counts)
  - Queue depth over time

Traces:
  - Per-task step-by-step timing log
  - Stored for 24h (configurable)
"""

import json
import time
from datetime import datetime
from typing import Optional
from utils.state import get_redis

TRACE_TTL = 86400       # 24h
METRICS_TTL = 604800    # 7 days


# ── Metrics ───────────────────────────────────────────────────────────────

async def inc_metric(name: str, value: float = 1.0):
    """Increment a simple counter."""
    r = await get_redis()
    await r.incrbyfloat(f"metrics:{name}", value)


async def record_latency(tool_name: str, duration_ms: float):
    """
    Push a latency sample into a Redis list (capped at 1000 samples).
    Used to compute percentiles on demand.
    """
    r = await get_redis()
    key = f"metrics:latency:{tool_name}"
    await r.lpush(key, duration_ms)
    await r.ltrim(key, 0, 999)
    await r.expire(key, METRICS_TTL)


async def get_latency_stats(tool_name: str) -> dict:
    """Return p50/p95/p99 for a tool."""
    r = await get_redis()
    raw = await r.lrange(f"metrics:latency:{tool_name}", 0, -1)
    if not raw:
        return {"p50": None, "p95": None, "p99": None, "samples": 0}
    samples = sorted(float(v) for v in raw)
    n = len(samples)
    def pct(p):
        idx = max(0, int(n * p / 100) - 1)
        return round(samples[idx], 1)
    return {
        "p50": pct(50),
        "p95": pct(95),
        "p99": pct(99),
        "samples": n,
        "mean": round(sum(samples) / n, 1),
    }


async def get_all_metrics() -> dict:
    """Aggregate all counters + latency stats into one response."""
    r = await get_redis()
    # Fetch all metric keys
    keys = await r.keys("metrics:*")
    counters = {}
    for key in keys:
        if b"latency" in key if isinstance(key, bytes) else "latency" in key:
            continue
        val = await r.get(key)
        short_key = key.replace("metrics:", "") if isinstance(key, str) else key.decode().replace("metrics:", "")
        try:
            counters[short_key] = float(val) if val else 0
        except Exception:
            pass

    # Latency stats for each tool
    tools = ["create_storage", "allocate_compute", "deploy_service"]
    latency = {}
    for tool in tools:
        latency[tool] = await get_latency_stats(tool)

    return {
        "counters": counters,
        "latency": latency,
        "collected_at": datetime.utcnow().isoformat(),
    }


# ── Traces ────────────────────────────────────────────────────────────────

class TaskTracer:
    """
    Attached to a task. Records step-level timing and events.
    Usage:
        tracer = TaskTracer(task_id)
        async with tracer.span("create_storage") as span:
            result = await create_storage(params)
            span["output_size"] = len(str(result))
    """

    def __init__(self, task_id: str):
        self.task_id  = task_id
        self.spans: list = []
        self.task_start = time.time()

    def record_span(self, tool: str, step_id: int, duration_ms: float,
                    status: str, retries: int = 0, error: str = None):
        self.spans.append({
            "tool":        tool,
            "step_id":     step_id,
            "duration_ms": round(duration_ms, 1),
            "status":      status,
            "retries":     retries,
            "error":       error,
            "offset_ms":   round((time.time() - self.task_start) * 1000, 1),
            "timestamp":   datetime.utcnow().isoformat(),
        })

    async def flush(self):
        """Persist trace to Redis with TTL."""
        r = await get_redis()
        trace = {
            "task_id":      self.task_id,
            "total_ms":     round((time.time() - self.task_start) * 1000, 1),
            "spans":        self.spans,
            "span_count":   len(self.spans),
            "flushed_at":   datetime.utcnow().isoformat(),
        }
        await r.set(f"trace:{self.task_id}", json.dumps(trace), ex=TRACE_TTL)

    @staticmethod
    async def get(task_id: str) -> Optional[dict]:
        r = await get_redis()
        raw = await r.get(f"trace:{task_id}")
        return json.loads(raw) if raw else None


# ── Convenience wrappers called by orchestrator ───────────────────────────

async def on_task_start(task_id: str):
    await inc_metric("tasks.total")
    await inc_metric("tasks.running")


async def on_task_complete(task_id: str, duration_ms: float):
    await inc_metric("tasks.running", -1)
    await inc_metric("tasks.completed")
    await record_latency("task_total", duration_ms)


async def on_task_failed(task_id: str):
    await inc_metric("tasks.running", -1)
    await inc_metric("tasks.failed")


async def on_task_cancelled(task_id: str):
    await inc_metric("tasks.running", -1)
    await inc_metric("tasks.cancelled")


async def on_step_complete(tool: str, duration_ms: float, retries: int):
    await record_latency(tool, duration_ms)
    if retries > 0:
        await inc_metric(f"retries.{tool}", retries)


async def on_validation(status: str):
    await inc_metric(f"validation.{status.lower()}")
