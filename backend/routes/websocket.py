"""
WebSocket Route  –  /ws/{task_id}
─────────────────────────────────
Each frontend tab connects here.
We subscribe to Redis pub/sub channel task_updates:{task_id}
and forward every update as a JSON message.
"""

import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from utils.state import get_redis, get_task, list_logs, append_log
from routes.tickets import set_broadcaster

router = APIRouter()

# In-memory registry of active WebSocket connections per task_id
_connections: dict[str, list[WebSocket]] = {}


@router.on_event("startup")
async def register_broadcaster():
    """Register the broadcast function with the ticket router."""
    set_broadcaster(_broadcast_to_ws)


@router.websocket("/ws/{task_id}")
async def websocket_endpoint(websocket: WebSocket, task_id: str):
    await websocket.accept()

    # Send current state immediately on connect
    task = await get_task(task_id)
    if task:
        await websocket.send_json({"type": "state", "data": task})
    for log in await list_logs(task_id):
        await websocket.send_json({"type": "log", "data": log})

    # Register connection
    _connections.setdefault(task_id, []).append(websocket)

    # Subscribe to Redis pub/sub for this task
    r = await get_redis()
    pubsub = None
    if hasattr(r, "pubsub"):
        try:
            pubsub = r.pubsub()
            await pubsub.subscribe(f"task_updates:{task_id}")
        except Exception:
            pubsub = None

    try:
        if pubsub is not None:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    data = json.loads(message["data"])
                    await websocket.send_json({"type": "update", "data": data})

                    # Auto-close when task reaches terminal state
                    if data.get("status") in ("completed", "failed"):
                        await asyncio.sleep(1)
                        break
        else:
            last_state = task
            last_logs = len(await list_logs(task_id))
            while True:
                await asyncio.sleep(0.5)
                current = await get_task(task_id)
                if current and current != last_state:
                    await websocket.send_json({"type": "update", "data": current})
                    last_state = current
                    if current.get("status") in ("completed", "failed"):
                        break

                logs = await list_logs(task_id)
                if len(logs) > last_logs:
                    for log in logs[last_logs:]:
                        await websocket.send_json({"type": "log", "data": log})
                    last_logs = len(logs)

    except (WebSocketDisconnect, Exception):
        pass
    finally:
        if pubsub is not None:
            await pubsub.unsubscribe(f"task_updates:{task_id}")
        if task_id in _connections:
            _connections[task_id] = [
                c for c in _connections[task_id] if c != websocket
            ]
        try:
            await websocket.close()
        except Exception:
            pass


async def _broadcast_to_ws(task_id: str, message: str, level: str):
    """
    Broadcast a log message to all connected WebSocket clients for this task.
    Also publishes to Redis so any server instance picks it up.
    """
    payload = {
        "type": "log",
        "data": {
            "task_id": task_id,
            "message": message,
            "level": level,
        }
    }
    await append_log(task_id, message, level)
    # Direct push to connected sockets on this process
    dead = []
    for ws in _connections.get(task_id, []):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    # Remove dead sockets
    if dead and task_id in _connections:
        _connections[task_id] = [c for c in _connections[task_id] if c not in dead]
