"""
Ticket Routes  —  /api/tickets

V2 additions:
  - User auth (X-API-Key header, auto-provisioned)
  - User-scoped task isolation
  - Priority queue (1=critical → 4=low)
  - Task cancellation endpoint
  - Metrics + trace endpoints
"""

import asyncio
import os
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from utils.state import create_task, get_task, list_tasks, update_task
from utils.validator import validate_ticket
from utils.auth import require_user, get_user_tasks
from utils.queue_manager import enqueue_task, request_cancellation, queue_length, queue_position
from utils.observability import get_all_metrics, TaskTracer
from agents.orchestrator import run_task

router = APIRouter()
_broadcast = None

def set_broadcaster(fn):
    global _broadcast
    _broadcast = fn

MAX_CONCURRENT  = int(os.getenv("MAX_CONCURRENT_TASKS", "10"))
MAX_INSTANCES   = int(os.getenv("MAX_INSTANCES_PER_USER", "20"))
MAX_BUDGET      = float(os.getenv("MAX_MONTHLY_BUDGET_USD", "500"))

_running_count = 0


class TicketRequest(BaseModel):
    ticket:   str = Field(..., min_length=1, max_length=2000)
    priority: int = Field(default=3, ge=1, le=4,
        description="1=critical, 2=high, 3=normal (default), 4=low")


class TicketResponse(BaseModel):
    task_id:  str
    status:   str
    message:  str
    warning:  str | None = None
    priority: int = 3
    queue_position: int | None = None


@router.post("/tickets", response_model=TicketResponse)
async def submit_ticket(
    body: TicketRequest,
    background: BackgroundTasks,
    user: dict = Depends(require_user),
):
    global _running_count

    ticket_text = body.ticket.strip()

    # Step 1: Input validation
    validation = validate_ticket(ticket_text)
    if not validation.valid:
        raise HTTPException(status_code=422, detail={
            "error": "invalid_ticket",
            "reason": validation.rejection_reason,
            "suggestion": validation.suggestion,
        })

    # Step 2: Concurrency limit
    if _running_count >= MAX_CONCURRENT:
        raise HTTPException(status_code=429, detail={
            "error": "too_many_tasks",
            "reason": f"Maximum {MAX_CONCURRENT} concurrent tasks. Please wait.",
        })

    # Step 3: Budget guard (per user)
    user_tasks = await get_user_tasks(user["user_id"], user.get("is_admin", False))
    live_count = sum(1 for t in user_tasks if t.get("status") == "completed")
    if live_count >= MAX_INSTANCES:
        raise HTTPException(status_code=402, detail={
            "error": "budget_limit",
            "reason": f"Maximum {MAX_INSTANCES} live services reached.",
        })

    # Step 4: Create task with user_id
    task = await create_task(ticket_text)
    task_id = task["task_id"]
    await update_task(task_id, {"user_id": user["user_id"], "priority": body.priority})

    _running_count += 1

    # Enqueue with priority
    await enqueue_task(task_id, priority=body.priority)
    pos = await queue_position(task_id)

    background.add_task(_run_with_cleanup, task_id, ticket_text)

    return TicketResponse(
        task_id=task_id,
        status="accepted",
        message=f"Task {task_id} queued. Connect to /ws/{task_id} for live updates.",
        warning=validation.suggestion or None,
        priority=body.priority,
        queue_position=pos,
    )


@router.get("/tickets")
async def get_tickets(user: dict = Depends(require_user)):
    return await get_user_tasks(user["user_id"], user.get("is_admin", False))


@router.get("/tickets/{task_id}")
async def get_ticket_by_id(task_id: str, user: dict = Depends(require_user)):
    task = await get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    # Non-admins can only see their own tasks
    if not user.get("is_admin") and task.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorised to view this task")
    return task


@router.delete("/tickets/{task_id}")
async def cancel_ticket(task_id: str, user: dict = Depends(require_user)):
    """Cancel a running or queued task. Triggers rollback of any created resources."""
    task = await get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    if not user.get("is_admin") and task.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorised to cancel this task")

    terminal = {"completed", "failed", "cancelled"}
    if task.get("status") in terminal:
        raise HTTPException(status_code=409, detail={
            "error": "already_terminal",
            "reason": f"Task is already in terminal state: {task.get('status')}",
        })

    await request_cancellation(task_id, reason="User cancelled via API")
    return {"task_id": task_id, "status": "cancellation_requested",
            "message": "Task will be cancelled between steps. Rollback will run automatically."}


@router.get("/health/validate")
async def validate_endpoint(ticket: str):
    result = validate_ticket(ticket)
    return {
        "status":     result.status,
        "valid":      result.status == "VALID",
        "confidence": round(result.confidence, 2),
        "error":      result.error,
        "rejection_reason": result.error,
        "suggestion": result.suggestion,
        "extracted":  result.extracted,
    }


@router.post("/tickets/preview-cost")
async def preview_cost(body: TicketRequest, user: dict = Depends(require_user)):
    ticket_text = body.ticket.strip()
    validation = validate_ticket(ticket_text)
    if not validation.valid:
        raise HTTPException(status_code=422, detail={
            "error": "invalid_ticket",
            "reason": validation.rejection_reason,
            "suggestion": validation.suggestion,
        })
    from agents.master_agent import plan as master_plan
    from utils.rollback import estimate_cost_before_execution
    plan_data = await master_plan(ticket_text)
    cost      = estimate_cost_before_execution(plan_data)
    return {
        "task_preview": {
            "service_name": plan_data.get("service_name"),
            "environment":  plan_data.get("environment"),
            "steps":        len(plan_data.get("steps", [])),
        },
        "cost_estimate": cost,
    }


@router.get("/metrics")
async def get_metrics(user: dict = Depends(require_user)):
    """Live system metrics — latency percentiles, retry counts, task outcomes."""
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    metrics = await get_all_metrics()
    metrics["queue_depth"] = await queue_length()
    return metrics


@router.get("/tickets/{task_id}/trace")
async def get_trace(task_id: str, user: dict = Depends(require_user)):
    """Per-task execution trace with step-level timing."""
    task = await get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    if not user.get("is_admin") and task.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorised")
    trace = await TaskTracer.get(task_id)
    if not trace:
        raise HTTPException(status_code=404, detail="No trace found for this task yet")
    return trace


async def _run_with_cleanup(task_id: str, ticket_text: str):
    global _running_count
    try:
        async def broadcast(tid, msg, level):
            if _broadcast:
                await _broadcast(tid, msg, level)
        await run_task(ticket_text, task_id, broadcast)
    finally:
        _running_count = max(0, _running_count - 1)
