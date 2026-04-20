"""
Master Agent (Planner)

Priority chain:
  1. Groq API
  2. Rule-based NLP parser
  3. Safe default

After planning:
  - JSON schema validation
  - Dependency cycle detection
  - Parameter sanitization
"""

import json
import os
import re
from typing import Optional

from utils.runtime import has_ai_provider_keys

# Define execution mode
USE_LLM = has_ai_provider_keys()

PLAN_SCHEMA_REQUIRED_TOOLS = {"create_storage", "allocate_compute", "deploy_service"}
SERVICE_SUFFIXES = {"api", "service", "app", "backend", "frontend", "worker", "pipeline"}

GROQ_SYSTEM_PROMPT = """You are NEXUS OPS Master Agent, an expert cloud infrastructure planner.

Parse the natural language infrastructure request and return ONLY a valid JSON execution plan.
No markdown, no explanation text, no code fences - raw JSON only.

AVAILABLE TOOLS:
- create_storage    -> Creates S3 bucket
- allocate_compute  -> Provisions EC2 instance
- deploy_service    -> Deploys Docker container

STRICT RULES:
1. Each step maps to exactly ONE tool
2. deploy_service ALWAYS depends on BOTH create_storage AND allocate_compute
3. create_storage and allocate_compute have NO dependencies (run in parallel)
4. Return ONLY raw JSON - no text before or after
"""


async def plan(ticket_text: str) -> dict:
    """Parse ticket and return a validated execution plan dict."""
    if USE_LLM:
        print("🧠 [MASTER AGENT] Using LLM planner")
        try:
            print("📡 Calling LLM API...")
            result = await _plan_with_llm(ticket_text)
            if result:
                validated = _validate_and_sanitise(result)
                if validated:
                    print("✅ LLM response received")
                    return validated
        except Exception as e:
            print("❌ LLM FAILED:", e)
            print("🔁 Falling back to rule-based planner")
    else:
        print("⚙️ [MASTER AGENT] Using rule-based planner")

    return _rule_based_plan(ticket_text)


def _normalize_service_name(raw: str) -> str:
    name = re.sub(r"[^a-z0-9\-]+", "-", str(raw or "").lower().replace(" ", "-")).strip("-")
    return re.sub(r"-{2,}", "-", name)


def _extract_service_name(ticket_text: str) -> str:
    text = ticket_text.lower()
    patterns = [
        r"\b(?:for|of|on)\s+(?:the\s+|our\s+|my\s+)?([a-z][a-z0-9]*(?:[-\s][a-z0-9]+)*?)\s+(api|service|app|backend|frontend|worker|pipeline)\b",
        r"\b(?:deploy|set up|setup|provision|create|build|launch|host|run)\s+(?:the\s+|our\s+|my\s+)?([a-z][a-z0-9]*(?:[-\s][a-z0-9]+)*?)\s+(api|service|app|backend|frontend|worker|pipeline)\b",
        r"\b([a-z][a-z0-9]*(?:[-\s][a-z0-9]+)*?)\s+(api|service|app|backend|frontend|worker|pipeline)\b",
        r"\b(?:deploy|set up|setup|provision|create|build|launch|host|run)\s+([a-z][a-z0-9\-_]+(?:[-\s]?(?:api|service|app|backend|frontend|worker|pipeline))?)\b",
    ]

    for pat in patterns:
        m = re.search(pat, text)
        if not m:
            continue
        raw = m.group(1).strip()
        suffix = m.group(2).strip() if m.lastindex and m.lastindex >= 2 else ""
        candidate = f"{raw}-{suffix}" if suffix and suffix not in SERVICE_SUFFIXES else raw
        candidate = _normalize_service_name(candidate)
        if candidate and candidate not in {"a", "an", "the", "our", "my", "new"}:
            return candidate

    fallback = re.search(r"\b([a-z][a-z0-9\-_]{2,})\b", text)
    return _normalize_service_name(fallback.group(1)) if fallback else "nexus-service"


async def _plan_with_llm(ticket_text: str) -> Optional[dict]:
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()

    if groq_key and not groq_key.startswith("gsk_your"):
        print("🧠 Using GROQ API")
        return await _call_llm_api(ticket_text, "groq", groq_key)
    elif openrouter_key:
        print("🧠 Using OPENROUTER API")
        return await _call_llm_api(ticket_text, "openrouter", openrouter_key)
    elif openai_key:
        print("🧠 Using OPENAI API")
        return await _call_llm_api(ticket_text, "openai", openai_key)
    else:
        return None


async def _call_llm_api(ticket_text: str, provider: str, api_key: str) -> Optional[dict]:
    try:
        import httpx

        if provider == "groq":
            url = "https://api.groq.com/openai/v1/chat/completions"
            model = "llama-3.1-8b-instant"
        elif provider == "openrouter":
            url = "https://openrouter.ai/api/v1/chat/completions"
            model = "anthropic/claude-3-haiku"
        elif provider == "openai":
            url = "https://api.openai.com/v1/chat/completions"
            model = "gpt-4o-mini"
        else:
            return None

        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": GROQ_SYSTEM_PROMPT},
                        {"role": "user", "content": f"Create execution plan for: {ticket_text}"},
                    ],
                    "temperature": 0.1,
                    "max_tokens": 900,
                },
            )
            if resp.status_code != 200:
                print(f"[{provider.upper()}] HTTP {resp.status_code}")
                return None
            raw = resp.json()["choices"][0]["message"]["content"].strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
            raw = re.sub(r"\s*```\s*$", "", raw, flags=re.MULTILINE)
            return json.loads(raw.strip())
    except Exception as e:
        print(f"[{provider.upper()}] Failed: {e}")
        return None


def _rule_based_plan(ticket_text: str) -> dict:
    text = ticket_text.lower()

    service_name = _extract_service_name(text)

    env = (
        "production"
        if any(w in text for w in ["production", " prod "])
        else "staging"
        if "staging" in text
        else "development"
    )

    port = 8080
    pm = re.search(r"\bport\s+(\d{2,5})\b", text) or re.search(r"\b(\d{4,5})\b", text)
    if pm:
        pv = int(pm.group(1))
        if 80 <= pv <= 65535:
            port = pv

    instance_type = "t2.medium"
    im = re.search(r"\b(t[23]\.(nano|micro|small|medium|large|xlarge))\b", text)
    if im:
        instance_type = im.group(1)
    elif any(w in text for w in ["large", "heavy", "high"]):
        instance_type = "t2.large"
    elif any(w in text for w in ["small", "light", "mini"]):
        instance_type = "t2.small"

    cpu_m = re.search(r"(\d+)\s*v?cpu", text)
    mem_m = re.search(r"(\d+)\s*gb", text)
    cpu = min(int(cpu_m.group(1)), 16) if cpu_m else 2
    memory_gb = min(int(mem_m.group(1)), 64) if mem_m else 4

    region = "us-east-1"
    rm = re.search(r"\b(us-east-[12]|us-west-[12]|eu-west-[123]|ap-south-1)\b", text)
    if rm:
        region = rm.group(1)

    image = f"{service_name}:latest"
    img_m = re.search(r"\b([a-z][a-z0-9\-_]+:[a-z0-9][a-z0-9\.\-]*)\b", text)
    if img_m and len(img_m.group(1)) <= 60:
        image = img_m.group(1)

    env_short = {"production": "prod", "staging": "stg", "development": "dev"}.get(env, "dev")
    bucket = f"{service_name}-{env_short}-bucket"

    return {
        "service_name": service_name,
        "environment": env,
        "_planner": "rule-based",
        "steps": [
            {
                "step_id": 1,
                "tool": "create_storage",
                "description": f"Create S3 bucket for {service_name} {env}",
                "params": {"bucket_name": bucket, "region": region, "access_level": "private"},
                "depends_on": [],
            },
            {
                "step_id": 2,
                "tool": "allocate_compute",
                "description": f"Provision {instance_type} for {service_name}",
                "params": {"instance_type": instance_type, "cpu": cpu, "memory_gb": memory_gb, "region": region},
                "depends_on": [],
            },
            {
                "step_id": 3,
                "tool": "deploy_service",
                "description": f"Deploy {service_name} on port {port}",
                "params": {"service_name": service_name, "image": image, "port": port, "env_vars": {"ENV": env}},
                "depends_on": [1, 2],
            },
        ],
    }


def _validate_and_sanitise(plan_data: dict) -> Optional[dict]:
    """Schema check + cycle detection + param sanitisation."""
    if not isinstance(plan_data, dict):
        return None
    if "steps" not in plan_data or not isinstance(plan_data["steps"], list):
        return None
    if len(plan_data["steps"]) < 1 or len(plan_data["steps"]) > 10:
        return None

    steps = plan_data["steps"]
    step_ids = set()

    for s in steps:
        if not isinstance(s, dict):
            return None
        if s.get("tool") not in PLAN_SCHEMA_REQUIRED_TOOLS:
            return None
        sid = s.get("step_id")
        if not isinstance(sid, int) or sid < 1:
            return None
        if sid in step_ids:
            return None
        step_ids.add(sid)

    for s in steps:
        for dep in s.get("depends_on", []):
            if dep not in step_ids:
                return None
            if dep == s["step_id"]:
                return None

    in_deg = {s["step_id"]: 0 for s in steps}
    adj = {s["step_id"]: [] for s in steps}
    for s in steps:
        for dep in s.get("depends_on", []):
            adj[dep].append(s["step_id"])
            in_deg[s["step_id"]] += 1

    queue = [k for k, v in in_deg.items() if v == 0]
    visited = 0
    while queue:
        node = queue.pop(0)
        visited += 1
        for nb in adj.get(node, []):
            in_deg[nb] -= 1
            if in_deg[nb] == 0:
                queue.append(nb)

    if visited != len(steps):
        return None

    strip_pattern = re.compile(r"""[<>;|&`$'\"\\]""")
    for s in steps:
        for k, v in list(s.get("params", {}).items()):
            if isinstance(v, str):
                s["params"][k] = strip_pattern.sub("", v).strip()[:128]

    env_map = {"prod": "production", "dev": "development", "stg": "staging"}
    raw_env = plan_data.get("environment", "development")
    plan_data["environment"] = env_map.get(raw_env, raw_env)
    return plan_data
