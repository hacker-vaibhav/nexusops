"""
InfraGenome registry.

Builds a stable infrastructure-pattern fingerprint from a completed task,
clusters similar deployments together, and persists versioned genome bundles.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from typing import Any, Optional

from utils.state import get_redis

REGISTRY_INDEX_KEY = "genome:index"
IDENTITY_STOPWORDS = {
    "service", "services", "api", "apis", "app", "apps", "application", "applications",
    "backend", "frontend", "worker", "pipeline", "microservice", "microservices",
    "container", "containers", "deploy", "deployment", "prod", "production", "staging",
    "dev", "development", "test", "tests", "bucket", "storage", "latest",
}


def _now() -> str:
    return datetime.utcnow().isoformat()


def _safe_load(raw: Any, default: Any):
    if raw is None:
        return default
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return default


def _tool_hints(step: dict) -> list[str]:
    params = step.get("params") or {}
    hints: list[str] = []

    if step.get("tool") == "create_storage":
        hints.append("storage")
        region = str(params.get("region") or "").lower()
        if region:
            hints.append(f"region:{region}")
    elif step.get("tool") == "allocate_compute":
        hints.append("compute")
        instance_type = str(params.get("instance_type") or "").lower()
        if instance_type:
            hints.append(f"instance:{instance_type}")
        cpu = params.get("cpu")
        memory = params.get("memory_gb")
        if cpu is not None:
            hints.append(f"cpu:{cpu}")
        if memory is not None:
            hints.append(f"memory:{memory}")
    elif step.get("tool") == "deploy_service":
        hints.append("deploy")
        port = params.get("port")
        if port is not None:
            try:
                port_num = int(port)
                hints.append(f"port:{(port_num // 10) * 10}")
            except Exception:
                hints.append("port:unknown")
        image = str(params.get("image") or "").lower()
        if image:
            suffix = image.split(":")[-1]
            hints.append(f"image:{suffix}")

    return hints


def _identifier_signature(value: Any) -> dict:
    raw = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    tokens = [
        token for token in raw.split("-")
        if token and token not in IDENTITY_STOPWORDS and not re.fullmatch(r"v?\d+", token)
    ]
    root = tokens[0] if tokens else ""
    return {
        "raw": raw,
        "tokens": tokens,
        "root": root,
    }


def _signature_similarity(a: dict, b: dict) -> float:
    if not a or not b:
        return 0.0
    if a.get("raw") and a.get("raw") == b.get("raw"):
        return 1.0

    a_tokens = set(a.get("tokens") or [])
    b_tokens = set(b.get("tokens") or [])
    if not a_tokens or not b_tokens:
        return 0.0

    overlap = len(a_tokens & b_tokens)
    if not overlap:
        return 0.0

    union = len(a_tokens | b_tokens) or 1
    root_bonus = 0.35 if a.get("root") and a.get("root") == b.get("root") else 0.0
    return min(root_bonus + ((overlap / union) * 0.65), 1.0)


def _find_step_params(plan: dict, tool_name: str) -> dict:
    for step in plan.get("steps", []):
        if step.get("tool") == tool_name:
            return step.get("params") or {}
    return {}


def _extract_identity(plan: dict) -> dict:
    service_name = plan.get("service_name") or "service"
    deploy_params = _find_step_params(plan, "deploy_service")
    storage_params = _find_step_params(plan, "create_storage")
    compute_params = _find_step_params(plan, "allocate_compute")

    image_name = str(deploy_params.get("image") or service_name).split(":", 1)[0]
    bucket_name = str(storage_params.get("bucket_name") or "")
    region = str(
        deploy_params.get("region")
        or storage_params.get("region")
        or compute_params.get("region")
        or plan.get("region")
        or "unknown"
    ).lower()
    instance_type = str(compute_params.get("instance_type") or plan.get("instance_type") or "unknown").lower()
    port = deploy_params.get("port")
    try:
        port_bucket = str((int(port) // 10) * 10) if port is not None else "unknown"
    except Exception:
        port_bucket = "unknown"

    return {
        "service": _identifier_signature(service_name),
        "image": _identifier_signature(image_name),
        "bucket": _identifier_signature(bucket_name),
        "region": region,
        "instance_type": instance_type,
        "port_bucket": port_bucket,
    }


def _upgrade_bundle(bundle: dict) -> dict:
    upgraded = dict(bundle)
    if not upgraded.get("identity"):
        upgraded["identity"] = _extract_identity(upgraded)
    return upgraded


def _extract_shape(plan: dict, task: Optional[dict] = None, outputs: Optional[dict] = None) -> dict:
    steps = sorted(plan.get("steps", []), key=lambda s: int(s.get("step_id", 0) or 0))
    normalized_steps = []
    parallel_waves = []

    completed = set()
    remaining = [s for s in steps]
    while remaining:
        wave = [s for s in remaining if all(dep in completed for dep in s.get("depends_on", []))]
        if not wave:
            wave = remaining[:]
        parallel_waves.append([s.get("tool") for s in wave])
        for s in wave:
            remaining.remove(s)
            completed.add(s.get("step_id"))

    for step in steps:
        normalized_steps.append({
            "tool": step.get("tool"),
            "depends_on": sorted(int(d) for d in step.get("depends_on", []) if isinstance(d, int)),
            "hints": sorted(_tool_hints(step)),
        })

    return {
        "environment": str(plan.get("environment") or "unknown").lower(),
        "step_count": len(steps),
        "steps": normalized_steps,
        "parallel_waves": parallel_waves,
        "task_status": str((task or {}).get("status") or "unknown"),
        "retries": sum(int(step.get("retries") or 0) for step in (task or {}).get("steps", [])),
        "cost_bucket": round(float((task or {}).get("cost_preview", {}).get("total_monthly") or 0) / 10) * 10,
    }


def _fingerprint(shape: dict) -> str:
    raw = json.dumps(shape, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _bundle_id(fingerprint: str) -> str:
    return f"GNM-{fingerprint[:10].upper()}"


def _semantic_description(bundle: dict) -> str:
    tools = " -> ".join(bundle["structure"]["tools"])
    env = bundle.get("environment", "unknown")
    rate = round(bundle.get("success_rate", 0) * 100)
    monthly = bundle.get("cost_profile", {}).get("p50_monthly")
    return (
        f"{bundle.get('title')} is a {env} pattern built from {tools}. "
        f"It has {bundle.get('success_count', 0)} successful deployment(s), "
        f"{rate}% success rate, and an estimated monthly cost of ${monthly:.2f}."
    )


def _make_bundle(plan: dict, task: Optional[dict] = None, outputs: Optional[dict] = None, duration_ms: Optional[int] = None) -> dict:
    shape = _extract_shape(plan, task, outputs)
    identity = _extract_identity(plan)
    fingerprint = _fingerprint(shape)
    service_name = plan.get("service_name") or "service"
    environment = plan.get("environment") or "unknown"
    step_tools = [s.get("tool") for s in sorted(plan.get("steps", []), key=lambda s: int(s.get("step_id", 0) or 0))]
    retries = sum(int(step.get("retries") or 0) for step in (task or {}).get("steps", []))
    total_monthly = float((task or {}).get("cost_preview", {}).get("total_monthly") or 0.0)
    total_hourly = float((task or {}).get("cost_preview", {}).get("total_hourly") or 0.0)
    p50 = round(total_monthly or max(12.0, len(step_tools) * 8.5), 2)
    p95 = round(p50 * 1.18, 2)

    bundle = {
        "genome_id": _bundle_id(fingerprint),
        "version": 1,
        "title": f"{service_name}-{environment}",
        "fingerprint": fingerprint,
        "shape": shape,
        "identity": identity,
        "structure": {
            "tools": step_tools,
            "parallel_waves": shape["parallel_waves"],
            "dependency_graph": [
                {
                    "step_id": step.get("step_id"),
                    "tool": step.get("tool"),
                    "depends_on": step.get("depends_on", []),
                }
                for step in sorted(plan.get("steps", []), key=lambda s: int(s.get("step_id", 0) or 0))
            ],
        },
        "constraints": {
            "region": next(
                (hint.split(":", 1)[1] for step in shape["steps"] for hint in step["hints"] if hint.startswith("region:")),
                "us-east-1",
            ),
            "instance_type": next(
                (hint.split(":", 1)[1] for step in shape["steps"] for hint in step["hints"] if hint.startswith("instance:")),
                "t2.medium",
            ),
            "port_bucket": next(
                (hint.split(":", 1)[1] for step in shape["steps"] for hint in step["hints"] if hint.startswith("port:")),
                "8080",
            ),
        },
        "cost_profile": {
            "p50_monthly": p50,
            "p95_monthly": p95,
            "hourly": round(total_hourly or (p50 / 730), 4),
        },
        "viability_score": 100.0,
        "success_count": 1,
        "failure_count": 0,
        "success_rate": 1.0,
        "average_duration_ms": duration_ms or 0,
        "latest_duration_ms": duration_ms or 0,
        "first_seen_at": _now(),
        "last_seen_at": _now(),
        "related_tasks": [task.get("task_id")] if task and task.get("task_id") else [],
        "environment": environment,
        "service_name": service_name,
        "retries_observed": retries,
    }
    bundle["semantic_description"] = _semantic_description(bundle)
    return bundle


def _score_similarity(a: dict, b: dict) -> float:
    if a.get("fingerprint") == b.get("fingerprint"):
        return 1.0

    score = 0.0
    a_id = a.get("identity", {})
    b_id = b.get("identity", {})

    if a.get("environment") == b.get("environment"):
        score += 0.18
    service_similarity = _signature_similarity(a_id.get("service", {}), b_id.get("service", {}))
    if service_similarity:
        score += 0.30 * service_similarity

    image_similarity = _signature_similarity(a_id.get("image", {}), b_id.get("image", {}))
    if image_similarity:
        score += 0.08 * image_similarity

    bucket_similarity = _signature_similarity(a_id.get("bucket", {}), b_id.get("bucket", {}))
    if bucket_similarity:
        score += 0.08 * bucket_similarity

    if a["structure"].get("tools") == b["structure"].get("tools"):
        score += 0.36
    elif set(a["structure"].get("tools", [])) == set(b["structure"].get("tools", [])):
        score += 0.22

    a_waves = a["shape"].get("parallel_waves", [])
    b_waves = b["shape"].get("parallel_waves", [])
    if a_waves == b_waves:
        score += 0.18

    if a_id.get("region") == b_id.get("region"):
        score += 0.10
    if a_id.get("instance_type") == b_id.get("instance_type"):
        score += 0.12
    if a_id.get("port_bucket") == b_id.get("port_bucket"):
        score += 0.08

    if a.get("cost_profile", {}).get("p50_monthly") and b.get("cost_profile", {}).get("p50_monthly"):
        delta = abs(float(a["cost_profile"]["p50_monthly"]) - float(b["cost_profile"]["p50_monthly"]))
        score += max(0.0, 0.12 - min(delta / 200.0, 0.12))

    return round(min(score, 0.99), 3)


async def _load_registry() -> list[dict]:
    r = await get_redis()
    raw = await r.get(REGISTRY_INDEX_KEY)
    index = _safe_load(raw, [])
    bundles = []
    for genome_id in index:
        raw_bundle = await r.get(f"genome:{genome_id}")
        bundle = _safe_load(raw_bundle, None)
        if bundle:
            bundles.append(_upgrade_bundle(bundle))
    return bundles


async def list_genomes(limit: int = 20) -> list[dict]:
    bundles = await _load_registry()
    bundles.sort(key=lambda b: (float(b.get("success_rate", 0)), int(b.get("success_count", 0)), b.get("last_seen_at", "")), reverse=True)
    return bundles[:limit]


async def get_genome(genome_id: str) -> Optional[dict]:
    r = await get_redis()
    raw = await r.get(f"genome:{genome_id}")
    bundle = _safe_load(raw, None)
    return _upgrade_bundle(bundle) if bundle else None


async def find_best_match(plan: dict, task: Optional[dict] = None, outputs: Optional[dict] = None, duration_ms: Optional[int] = None) -> dict:
    candidate = _make_bundle(plan, task, outputs, duration_ms)
    registry = await _load_registry()
    best = None
    best_score = 0.0

    for bundle in registry:
        score = _score_similarity(candidate, bundle)
        if score > best_score:
            best_score = score
            best = bundle

    return {
        "candidate": candidate,
        "best_match": best,
        "similarity": best_score,
    }


async def capture_genome(plan: dict, task: Optional[dict] = None, outputs: Optional[dict] = None, duration_ms: Optional[int] = None) -> dict:
    r = await get_redis()
    candidate = _make_bundle(plan, task, outputs, duration_ms)
    registry = await _load_registry()
    best = None
    best_score = 0.0

    for bundle in registry:
        score = _score_similarity(candidate, bundle)
        if score > best_score:
            best_score = score
            best = bundle

    if best and best_score >= 0.7:
        bundle = dict(best)
        bundle["version"] = int(bundle.get("version", 1)) + 1
        bundle["success_count"] = int(bundle.get("success_count", 0)) + 1
        bundle["success_rate"] = round(
            bundle["success_count"] / max(bundle["success_count"] + int(bundle.get("failure_count", 0)), 1),
            3,
        )
        bundle["viability_score"] = round(
            max(0.0, bundle["success_rate"] * 100 - min(bundle.get("retries_observed", 0) * 4, 20)),
            1,
        )
        if duration_ms is not None:
            prev = float(bundle.get("average_duration_ms") or duration_ms)
            bundle["average_duration_ms"] = round((prev + duration_ms) / 2, 1)
            bundle["latest_duration_ms"] = duration_ms
        bundle["last_seen_at"] = _now()
        if task and task.get("task_id") and task.get("task_id") not in bundle.get("related_tasks", []):
            bundle.setdefault("related_tasks", []).append(task["task_id"])
            bundle["related_tasks"] = bundle["related_tasks"][-20:]
        bundle["semantic_description"] = _semantic_description(bundle)
        genome_id = bundle["genome_id"]
    else:
        bundle = candidate
        genome_id = bundle["genome_id"]
        index = _safe_load(await r.get(REGISTRY_INDEX_KEY), [])
        if genome_id not in index:
            index.append(genome_id)
            await r.set(REGISTRY_INDEX_KEY, json.dumps(index))

    await r.set(f"genome:{genome_id}", json.dumps(bundle))
    index = _safe_load(await r.get(REGISTRY_INDEX_KEY), [])
    if genome_id not in index:
        index.append(genome_id)
        await r.set(REGISTRY_INDEX_KEY, json.dumps(index))

    return {
        "bundle": bundle,
        "match": {
            "genome_id": best.get("genome_id") if best else None,
            "title": best.get("title") if best else None,
            "similarity": best_score,
            "semantic_description": best.get("semantic_description") if best else None,
        },
    }


async def match_ticket(ticket_text: str) -> dict:
    from agents.master_agent import plan as master_plan

    plan = await master_plan(ticket_text)
    result = await find_best_match(plan)
    candidate = result["candidate"]
    best = result["best_match"]

    return {
        "ticket": ticket_text,
        "candidate": candidate,
        "match": {
            "genome_id": best.get("genome_id") if best else None,
            "title": best.get("title") if best else None,
            "similarity": result["similarity"],
            "semantic_description": best.get("semantic_description") if best else candidate["semantic_description"],
        },
    }
