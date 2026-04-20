"""
NEXUS OPS - Backend Entry Point
FastAPI app with REST endpoints + WebSocket for real-time updates
"""

import os
import sys
import builtins
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from backend/.env and optional project-root .env
_BACKEND_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _BACKEND_DIR.parent
load_dotenv(_BACKEND_DIR / ".env", override=False)
load_dotenv(_PROJECT_ROOT / ".env", override=True)

# Make console logging safe on Windows when agents print emoji-rich status text.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

_original_print = builtins.print


def _safe_print(*args, **kwargs):
    try:
        _original_print(*args, **kwargs)
    except UnicodeEncodeError:
        safe_args = [str(arg).encode("ascii", "replace").decode("ascii") for arg in args]
        _original_print(*safe_args, **kwargs)


builtins.print = _safe_print

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.genomes import router as genome_router
from routes.tickets import router as ticket_router
from routes.websocket import router as ws_router
from tools.cloud_tools import get_aws_status
from utils.runtime import (
    get_effective_execution_mode,
    get_requested_execution_mode,
    has_ai_provider_keys,
    is_service_online,
)
from utils.state import init_redis
from utils.validator import validate_ticket

USE_LLM = has_ai_provider_keys()
REQUESTED_EXECUTION_MODE = get_requested_execution_mode()
EXECUTION_MODE = get_effective_execution_mode()
SERVICE_STATUS = "online" if is_service_online() else "offline"

app = FastAPI(
    title="NEXUS OPS API",
    description="Autonomous IT Operations Orchestrator",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ticket_router, prefix="/api")
app.include_router(genome_router, prefix="/api")
app.include_router(ws_router)


@app.on_event("startup")
async def startup():
    await init_redis()
    print("🧠 AI SYSTEM INITIALIZING...")
    if os.getenv("GROQ_API_KEY"):
        print("✅ GROQ CONNECTED → Planner Agent")
    else:
        print("⚠️ AI PROVIDER NOT CONFIGURED: GROQ")
    if os.getenv("OPENAI_API_KEY"):
        print("✅ OPENAI CONNECTED → Verification Agent")
    else:
        print("⚠️ AI PROVIDER NOT CONFIGURED: OPENAI")
    if os.getenv("OPENROUTER_API_KEY"):
        print("✅ OPENROUTER CONNECTED → Orchestrator")
    else:
        print("⚠️ AI PROVIDER NOT CONFIGURED: OPENROUTER")
    print("===================================")
    print("NEXUS OPS STARTING")
    print("Service Status:", SERVICE_STATUS.upper())
    print("Requested Execution Mode:", REQUESTED_EXECUTION_MODE)
    print("Effective Execution Mode:", EXECUTION_MODE)
    print("LLM Providers:", "ENABLED" if USE_LLM else "MISSING -> MOCK")
    print("GROQ:", "YES" if os.getenv("GROQ_API_KEY") else "NO")
    print("OPENAI:", "YES" if os.getenv("OPENAI_API_KEY") else "NO")
    print("OPENROUTER:", "YES" if os.getenv("OPENROUTER_API_KEY") else "NO")
    print("===================================")
    print("BACKEND READY ON 8000")
    print("NEXUS OPS backend started")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "nexus-ops"}


@app.get("/api/health")
async def api_health():
    return {"status": "ok"}


@app.get("/api/config")
async def get_config():
    return {
        "service_status": SERVICE_STATUS,
        "requested_execution_mode": REQUESTED_EXECUTION_MODE,
        "execution_mode": EXECUTION_MODE,
        "runtime_mode": EXECUTION_MODE,
        "llm_enabled": USE_LLM,
        "llm_providers": {
            "groq": bool(os.getenv("GROQ_API_KEY")),
            "openai": bool(os.getenv("OPENAI_API_KEY")),
            "openrouter": bool(os.getenv("OPENROUTER_API_KEY")),
        },
    }


@app.get("/api/aws/status")
async def aws_status():
    return await get_aws_status()


@app.get("/api/health/validate")
async def health_validate(ticket: str):
    result = validate_ticket(ticket)
    return {
        "status": result.status,
        "valid": result.status == "VALID",
        "confidence": round(result.confidence, 2),
        "error": result.error,
        "rejection_reason": result.error,
        "suggestion": result.suggestion,
        "extracted": result.extracted,
    }


@app.get("/api/debug/logs")
async def debug_logs():
    return {"message": "Check EC2 /home/ec2-user/output.log"}
