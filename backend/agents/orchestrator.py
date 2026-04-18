"""
Orchestrator
────────────
Full pipeline: plan → parallel execution → verify → rollback on failure

V2 additions:
  - Resource conflict resolution (port + service-name registry)
  - Cancellation polling between waves
  - Task timeout enforcement
  - Observability traces (per-step timing)
"""

import asyncio
import time
from datetime import datetime
from typing import Callable

from agents.master_agent import plan as master_plan
from agents.verification_agent import verify
from tools.cloud_tools import create_storage, allocate_compute, deploy_service
from utils.state import create_task, update_task, add_step
from utils.rollback import RollbackEngine, estimate_cost_before_execution
from utils.resource_registry import claim_service_name, find_free_port, release_all_for_task
from utils.queue_manager import is_cancelled, clear_cancellation, check_timeout
from utils.genome_registry import capture_genome
from utils.observability import (
    TaskTracer, on_task_start, on_task_complete, on_task_failed,
    on_task_cancelled, on_step_complete
)

TOOL_MAP = {
    "create_storage":   create_storage,
    "allocate_compute": allocate_compute,
    "deploy_service":   deploy_service,
}


async def run_task(ticket_text: str, task_id: str, broadcast: Callable):
    start = time.time()
    rollback_engine = None
    tracer = TaskTracer(task_id)
    claimed_ports = []
    claimed_services = []

    async def notify(msg: str, level: str = "info"):
        await broadcast(task_id, msg, level)

    await on_task_start(task_id)

    try:
        # Phase 1: Planning
        await update_task(task_id, {"status": "planning"})
        await notify("🧠 Master Agent parsing ticket...", "planning")

        plan = await master_plan(ticket_text)
        planner_used = plan.get("_planner", "groq")
        steps = plan.get("steps", [])
        service_name = plan.get("service_name", "service")
        environment  = plan.get("environment", "unknown")

        if _has_dependency_cycle(steps):
            await notify(
                "❌ Invalid plan rejected: Kahn's algorithm detected a dependency cycle before execution.",
                "failed"
            )
            await update_task(task_id, {
                "status": "failed",
                "error": "Dependency cycle detected by Kahn's algorithm.",
                "plan": plan,
            })
            await on_task_failed(task_id)
            await tracer.flush()
            return

        # Resource conflict resolution
        if not await claim_service_name(service_name, task_id):
            await notify(
                f"⚠️ Service '{service_name}' already being deployed — appending task suffix.", "info"
            )
            service_name = f"{service_name}-{task_id[-4:].lower()}"
            plan["service_name"] = service_name
            await claim_service_name(service_name, task_id)
        claimed_services.append(service_name)

        deploy_step = next((s for s in steps if s["tool"] == "deploy_service"), None)
        if deploy_step:
            preferred_port = deploy_step["params"].get("port", 8080)
            free_port = await find_free_port(preferred_port, task_id)
            if free_port != preferred_port:
                await notify(f"🔀 Port {preferred_port} in use — reassigned to {free_port}", "info")
                deploy_step["params"]["port"] = free_port
            claimed_ports.append(free_port)

        cost_preview = estimate_cost_before_execution(plan)
        await notify(
            f"💰 Cost preview: ~${cost_preview['total_monthly']:.2f}/month "
            f"(${cost_preview['total_hourly']:.4f}/hr) — proceeding",
            "planning"
        )
        await update_task(task_id, {"status": "planned", "plan": plan, "cost_preview": cost_preview})

        planner_label = " (rule-based)" if planner_used == "rule-based" else ""
        await notify(
            f"📋 Plan created{planner_label}: {len(steps)} steps for {service_name} ({environment})",
            "planning"
        )

        for s in steps:
            await add_step(task_id, {
                "step_id": s["step_id"], "tool": s["tool"],
                "description": s.get("description", ""), "status": "pending",
                "depends_on": s.get("depends_on", []), "output": None,
                "started_at": None, "completed_at": None, "retries": 0,
            })

        # Phase 2: Execution
        await update_task(task_id, {"status": "executing"})
        rollback_engine = RollbackEngine(task_id, notify)
        outputs = {}
        waves = _build_waves(steps)
        await notify(
            f"⚡ Executing {len(waves)} wave(s) — "
            f"{sum(len(w) for w in waves if len(w) > 1)} steps in parallel",
            "info"
        )

        for wave_idx, wave in enumerate(waves):
            # Cancellation check between waves
            cancel_info = await is_cancelled(task_id)
            if cancel_info:
                await notify(
                    f"🛑 Cancelled: {cancel_info.get('reason', 'user request')} — rolling back...", "error"
                )
                if rollback_engine and rollback_engine.resources:
                    await rollback_engine.rollback()
                await release_all_for_task(task_id, claimed_ports, claimed_services)
                await update_task(task_id, {
                    "status": "cancelled",
                    "cancel_reason": cancel_info.get("reason"),
                    "rollback_performed": bool(rollback_engine and rollback_engine.resources),
                })
                await on_task_cancelled(task_id)
                await clear_cancellation(task_id)
                await tracer.flush()
                return

            # Timeout check
            if await check_timeout(task_id, start):
                await notify("⏰ Task exceeded maximum run time. Aborting.", "error")
                if rollback_engine and rollback_engine.resources:
                    await rollback_engine.rollback()
                await release_all_for_task(task_id, claimed_ports, claimed_services)
                await update_task(task_id, {"status": "failed", "error": "Task timed out",
                    "rollback_performed": True})
                await on_task_failed(task_id)
                await tracer.flush()
                return

            names = " + ".join(s["tool"] for s in wave)
            if len(wave) > 1:
                await notify(f"🔀 Wave {wave_idx+1}: [{names}] in PARALLEL", "info")
            else:
                await notify(f"▶ Wave {wave_idx+1}: [{names}]", "info")

            wave_outputs = await asyncio.gather(*[
                _execute_step(s, outputs, task_id, notify, rollback_engine, tracer)
                for s in wave
            ])

            for s, out in zip(wave, wave_outputs):
                outputs[s["step_id"]] = out
                if out.get("status") == "failed" and not out.get("verified"):
                    await update_task(task_id, {"status": "rolling_back", "error": out.get("error")})
                    await notify(
                        f"💥 Step {s['step_id']} failed permanently. Initiating rollback...", "error"
                    )
                    await rollback_engine.rollback()
                    await release_all_for_task(task_id, claimed_ports, claimed_services)
                    await update_task(task_id, {
                        "status": "failed", "error": out.get("error"),
                        "rollback_performed": True,
                        "rollback_resources": rollback_engine.resources,
                    })
                    await notify("❌ Task failed. All resources rolled back. Environment is clean.", "error")
                    await on_task_failed(task_id)
                    await tracer.flush()
                    return

        # Phase 3: Final report
        duration_ms = int((time.time() - start) * 1000)
        genome = await capture_genome(plan, {
            "task_id": task_id,
            "status": "completed",
            "cost_preview": cost_preview,
            "steps": await _task_steps_snapshot(task_id),
        }, outputs, duration_ms)
        report = _build_report(plan, outputs, duration_ms)
        report["infra_genome"] = genome["bundle"]
        report["infra_genome_match"] = genome["match"]
        await update_task(task_id, {
            "status": "completed", "final_report": report, "total_duration_ms": duration_ms,
            "infra_genome": genome["bundle"],
            "infra_genome_match": genome["match"],
        })
        await notify(f"🧬 InfraGenome captured: {genome['bundle']['genome_id']} ({round(genome['match']['similarity'] * 100)}% match)", "info")
        await notify(f"🎉 All done! {service_name} is live in {duration_ms}ms", "success")
        await on_task_complete(task_id, duration_ms)
        await tracer.flush()

    except Exception as e:
        if rollback_engine and rollback_engine.resources:
            await notify(f"🔴 Unexpected error. Running rollback...", "error")
            await rollback_engine.rollback()
        await release_all_for_task(task_id, claimed_ports, claimed_services)
        await update_task(task_id, {"status": "failed", "error": str(e)})
        await notify(f"💥 Unexpected error: {e}", "error")
        await on_task_failed(task_id)
        await tracer.flush()
        raise


async def _execute_step(step, outputs, task_id, notify, rollback_engine, tracer):
    step_id   = step["step_id"]
    tool_name = step["tool"]
    params    = step.get("params", {})
    step_start = time.time()

    print(f"🚀 Executing Step {step_id}: {tool_name}")

    await add_step(task_id, {**_base(step), "status": "running",
        "started_at": datetime.utcnow().isoformat()})
    await notify(f"🔧 [{tool_name}] Starting...", "executing")

    context = {}
    for dep in step.get("depends_on", []):
        dep_out = outputs.get(dep, {})
        context.update({k: v for k, v in dep_out.items()
            if k in ("instance_id", "bucket_arn", "public_ip", "bucket_name")})

    tool_fn = TOOL_MAP[tool_name]
    raw = await tool_fn(params, context) if tool_name == "deploy_service" else await tool_fn(params)

    async def on_update(msg, status):
        await add_step(task_id, {**_base(step), "status": status})
        await notify(msg, status)

    async def retry_fn(patched):
        p = patched.get("params", params)
        return await tool_fn(p, context) if tool_name == "deploy_service" else await tool_fn(p)

    verified = await verify(step, raw, retry_fn, on_update)

    if verified.get("verified"):
        print(f"✅ Step {step_id} completed")
    else:
        print(f"❌ Step {step_id} failed")

    duration_ms = (time.time() - step_start) * 1000
    final_status = "completed" if verified.get("verified") else "failed"

    await add_step(task_id, {
        **_base(step), "status": final_status, "output": verified,
        "completed_at": datetime.utcnow().isoformat(),
        "retries": verified.get("retries", 0),
        "duration_ms": round(duration_ms, 1),
    })

    tracer.record_span(
        tool=tool_name, step_id=step_id, duration_ms=duration_ms,
        status=final_status, retries=verified.get("retries", 0),
        error=verified.get("error") if not verified.get("verified") else None,
    )
    await on_step_complete(tool_name, duration_ms, verified.get("retries", 0))

    if verified.get("verified"):
        await notify(f"✅ [{tool_name}] Done ({round(duration_ms)}ms)", "completed")
        if tool_name == "create_storage":
            rollback_engine.register("s3_bucket",    verified.get("bucket_name", ""))
        elif tool_name == "allocate_compute":
            rollback_engine.register("ec2_instance", verified.get("instance_id", ""))
        elif tool_name == "deploy_service":
            rollback_engine.register("container",    verified.get("container_id", ""))

    return verified


def _build_waves(steps):
    completed, remaining, waves = set(), list(steps), []
    while remaining:
        wave = [s for s in remaining if all(d in completed for d in s.get("depends_on", []))]
        if not wave:
            wave = remaining[:]
        for s in wave:
            remaining.remove(s)
            completed.add(s["step_id"])
        waves.append(wave)
    return waves


def _has_dependency_cycle(steps):
    step_ids = {s["step_id"] for s in steps if isinstance(s, dict) and isinstance(s.get("step_id"), int)}
    in_deg = {sid: 0 for sid in step_ids}
    adj = {sid: [] for sid in step_ids}

    for s in steps:
        sid = s.get("step_id")
        if sid not in step_ids:
            continue
        for dep in s.get("depends_on", []):
            if dep in step_ids:
                adj[dep].append(sid)
                in_deg[sid] += 1

    queue = [sid for sid, deg in in_deg.items() if deg == 0]
    visited = 0
    while queue:
        node = queue.pop(0)
        visited += 1
        for nb in adj.get(node, []):
            in_deg[nb] -= 1
            if in_deg[nb] == 0:
                queue.append(nb)

    return visited != len(step_ids)


def _base(step):
    return {
        "step_id": step["step_id"], "tool": step["tool"],
        "description": step.get("description", ""), "depends_on": step.get("depends_on", []),
    }


def _build_report(plan, outputs, duration_ms):
    resources = []
    for step_id, out in outputs.items():
        if out.get("status") == "success":
            t = out.get("tool", "")
            if t == "create_storage":
                resources.append({"type": "S3 Bucket", "name": out.get("bucket_name"),
                    "arn": out.get("bucket_arn"), "endpoint": out.get("endpoint")})
            elif t == "allocate_compute":
                resources.append({"type": "EC2 Instance", "id": out.get("instance_id"),
                    "type_detail": out.get("instance_type"), "ip": out.get("public_ip"),
                    "state": out.get("state")})
            elif t == "deploy_service":
                resources.append({"type": "Service", "name": out.get("service_name"),
                    "endpoint": out.get("endpoint"), "health": out.get("health_check"),
                    "container_id": out.get("container_id")})
    return {
        "service_name": plan.get("service_name"), "environment": plan.get("environment"),
        "resources": resources, "duration_ms": duration_ms,
        "total_steps": len(outputs),
        "total_retries": sum(o.get("retries", 0) for o in outputs.values()),
        "completed_at": datetime.utcnow().isoformat(),
    }


async def _task_steps_snapshot(task_id: str):
    """Return the latest persisted step list for genome extraction."""
    from utils.state import get_task

    task = await get_task(task_id)
    return task.get("steps", []) if task else []
