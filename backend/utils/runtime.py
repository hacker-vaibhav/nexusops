"""Shared runtime helpers for execution and AI provider availability."""

from __future__ import annotations

from functools import lru_cache
import os


def has_ai_provider_keys() -> bool:
    """Return True when at least one AI provider key is configured."""
    return any(
        [
            os.getenv("GROQ_API_KEY", "").strip(),
            os.getenv("OPENAI_API_KEY", "").strip(),
            os.getenv("OPENROUTER_API_KEY", "").strip(),
        ]
    )


def get_requested_execution_mode(default: str = "local") -> str:
    return os.getenv("EXECUTION_MODE", default).strip().lower() or default


def get_effective_execution_mode(default: str = "mock") -> str:
    """
    Return the execution mode the backend should actually use.

    If AI provider keys are missing, we force mock execution even when the
    environment asks for real infrastructure. We also fall back to mock if the
    configured AWS target is not reachable from this machine.
    """
    requested = get_requested_execution_mode(default)
    if requested != "real":
        return default
    if not has_ai_provider_keys():
        return default
    return "real" if _aws_is_reachable() else default


def is_service_online() -> bool:
    return True


@lru_cache(maxsize=1)
def _aws_is_reachable() -> bool:
    """Probe AWS or the configured endpoint quickly enough for startup gating."""
    endpoint_url = os.getenv("AWS_ENDPOINT_URL", "").strip() or None
    region = os.getenv("AWS_DEFAULT_REGION", "us-east-1").strip() or "us-east-1"
    access_key = os.getenv("AWS_ACCESS_KEY_ID", "").strip() or "test"
    secret_key = os.getenv("AWS_SECRET_ACCESS_KEY", "").strip() or "test"

    try:
        import boto3
        from botocore.config import Config

        client_kwargs = {
            "region_name": region,
            "aws_access_key_id": access_key,
            "aws_secret_access_key": secret_key,
            "config": Config(connect_timeout=1, read_timeout=2, retries={"max_attempts": 1, "mode": "standard"}),
        }
        if endpoint_url:
            client_kwargs["endpoint_url"] = endpoint_url

        boto3.client("sts", **client_kwargs).get_caller_identity()
        return True
    except Exception:
        return False
