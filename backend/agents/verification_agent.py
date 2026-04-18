"""
Verification Agent
──────────────────
After every execution step:
1. Check output for success/failure
2. On failure: diagnose → patch params → retry with exponential backoff
3. After MAX_RETRIES: mark failed, report reason, stop (no infinite loops)
"""

import asyncio
import copy
import re
from datetime import datetime
from typing import Callable

MAX_RETRIES = 3
BASE_BACKOFF = 1.5   # seconds — doubles each retry: 1.5, 3.0, 6.0


async def verify(step: dict, execution_output: dict, retry_fn: Callable, on_update: Callable) -> dict:
    tool     = step["tool"]
    step_id  = step["step_id"]

    print(f"🔍 Verifying step {step_id}")

    if execution_output.get("status") == "success":
        await on_update(f"✅ Step {step_id} ({tool}) verified successfully", "verified")
        return {**execution_output, "verified": True, "retries": 0}

    last_error = execution_output.get("error", "unknown error")
    await on_update(f"⚠️ Step {step_id} failed: {last_error}. Starting self-heal...", "retrying")

    for attempt in range(1, MAX_RETRIES + 1):
        print(f"🔁 Retrying step {step_id} ({attempt}/{MAX_RETRIES})")

        # Exponential backoff: 1.5s, 3.0s, 6.0s
        backoff = BASE_BACKOFF * (2 ** (attempt - 1))
        await asyncio.sleep(backoff)

        patched = _diagnose_and_patch(step, last_error, attempt)
        fix_desc = _describe_fix(tool, last_error, attempt)

        await on_update(
            f"🔄 Retry {attempt}/{MAX_RETRIES}: {fix_desc} (backoff: {backoff:.1f}s)",
            "retrying"
        )

        retry_output = await retry_fn(patched)

        if retry_output.get("status") == "success":
            await on_update(f"✅ Step {step_id} self-healed on retry {attempt}!", "verified")
            return {**retry_output, "verified": True, "retries": attempt}

        last_error = retry_output.get("error", "unknown error")

    # All retries exhausted — report clearly
    await on_update(
        f"❌ Step {step_id} failed after {MAX_RETRIES} retries. Final error: {last_error}",
        "failed"
    )
    return {
        "status": "failed",
        "error": f"Max retries ({MAX_RETRIES}) exhausted. Last error: {last_error}",
        "verified": False,
        "retries": MAX_RETRIES
    }


def _diagnose_and_patch(step: dict, error: str, attempt: int) -> dict:
    """Patch step params based on the specific error type."""
    patched = copy.deepcopy(step)
    params  = patched["params"]
    err     = error.lower()

    if step["tool"] == "create_storage":
        if "already exists" in err or "conflict" in err or "bucketexists" in err:
            # Unique bucket name with attempt suffix + timestamp fragment
            original = params.get("bucket_name", "bucket")
            base = re.sub(r'-r\d+$', '', original)   # strip previous suffix
            params["bucket_name"] = f"{base}-r{attempt}"

    elif step["tool"] == "allocate_compute":
        if "capacity" in err or "limit" in err or "insufficient" in err:
            # Downgrade instance type
            fallbacks = {
                "t2.xlarge":"t2.large","t2.large":"t2.medium",
                "t2.medium":"t2.small","t2.small":"t2.micro","t2.micro":"t2.nano",
                "t3.large":"t3.medium","t3.medium":"t2.medium"
            }
            current = params.get("instance_type","t2.medium")
            params["instance_type"] = fallbacks.get(current, "t2.micro")
        elif "region" in err:
            # Try alternate region
            alt_regions = ["us-west-2","eu-west-1","ap-southeast-1"]
            params["region"] = alt_regions[attempt % len(alt_regions)]

    elif step["tool"] == "deploy_service":
        if "port" in err or "already in use" in err or "address in use" in err:
            base_port = params.get("port", 8080)
            params["port"] = base_port + (attempt * 10)
        elif "image" in err or "not found" in err:
            # Try plain image name without tag
            img = params.get("image","service:latest").split(":")[0]
            params["image"] = f"{img}:latest"

    return patched


def _describe_fix(tool: str, error: str, attempt: int) -> str:
    err = error.lower()
    if tool == "create_storage":
        return f"Retrying with new bucket name suffix (-r{attempt})"
    elif tool == "allocate_compute":
        if "capacity" in err or "limit" in err:
            return "Downgrading instance type to reduce capacity requirements"
        elif "region" in err:
            return "Trying alternate AWS region"
        return "Adjusting compute parameters"
    elif tool == "deploy_service":
        if "port" in err:
            return f"Changing container port to avoid conflict"
        return "Retrying deployment with adjusted configuration"
    return f"Retrying with corrected parameters (attempt {attempt})"
