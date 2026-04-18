"""
Resource Registry
─────────────────
Prevents two concurrent tasks from claiming the same port or service name.

Backed by Redis so it works across multiple backend processes.
All locks are TTL-based (auto-expire after 2h) to avoid stale entries
if a task crashes before releasing.
"""

import os
from typing import Optional
from utils.state import get_redis

TTL_SECONDS = 7200  # 2 hours — max task lifetime


async def claim_port(port: int, task_id: str) -> bool:
    """
    Try to claim a port for a task.
    Returns True if claimed successfully, False if already in use.
    """
    r = await get_redis()
    key = f"port_lock:{port}"
    # SET NX = only set if key doesn't exist (atomic claim)
    result = await r.set(key, task_id, ex=TTL_SECONDS, nx=True)
    return result is True


async def release_port(port: int, task_id: str):
    """Release a port lock — only if this task owns it."""
    r = await get_redis()
    key = f"port_lock:{port}"
    current = await r.get(key)
    if current == task_id:
        await r.delete(key)


async def claim_service_name(service_name: str, task_id: str) -> bool:
    """
    Try to claim a service name.
    Returns True if claimed, False if another active task owns it.
    """
    r = await get_redis()
    key = f"service_lock:{service_name}"
    result = await r.set(key, task_id, ex=TTL_SECONDS, nx=True)
    return result is True


async def release_service_name(service_name: str, task_id: str):
    """Release a service name lock."""
    r = await get_redis()
    key = f"service_lock:{service_name}"
    current = await r.get(key)
    if current == task_id:
        await r.delete(key)


async def find_free_port(preferred_port: int, task_id: str) -> int:
    """
    Attempt to claim preferred_port.
    If taken, increment by 1 up to 20 times to find a free slot.
    Returns the claimed port.
    """
    port = preferred_port
    for _ in range(20):
        if await claim_port(port, task_id):
            return port
        port += 1
    # Last resort: claim whatever we landed on (very unlikely to still be taken)
    await claim_port(port, task_id)
    return port


async def get_port_owner(port: int) -> Optional[str]:
    r = await get_redis()
    return await r.get(f"port_lock:{port}")


async def get_service_owner(service_name: str) -> Optional[str]:
    r = await get_redis()
    return await r.get(f"service_lock:{service_name}")


async def release_all_for_task(task_id: str, ports: list[int], service_names: list[str]):
    """Bulk-release all resources held by a task (called on completion or rollback)."""
    for port in ports:
        await release_port(port, task_id)
    for name in service_names:
        await release_service_name(name, task_id)
