"""
NEXUS OPS - Backend Entry Point
FastAPI app with REST endpoints + WebSocket for real-time updates
"""

import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.tickets import router as ticket_router
from routes.genomes import router as genome_router
from routes.websocket import router as ws_router
from utils.state import init_redis
from utils.validator import validate_ticket

# Load environment variables
load_dotenv()

# Define execution mode
USE_LLM = any([
    os.getenv("GROQ_API_KEY"),
    os.getenv("OPENAI_API_KEY"),
    os.getenv("OPENROUTER_API_KEY")
])

# Set execution mode based on LLM availability
if USE_LLM:
    os.environ["EXECUTION_MODE"] = "local"  # Use LocalStack when LLM is enabled
else:
    os.environ["EXECUTION_MODE"] = "mock"   # Use mock when no LLM

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
    print("===================================")
    print("🚀 NEXUS OPS STARTING")
    print("Mode:", "REAL (LLM ENABLED)" if USE_LLM else "MOCK (NO LLM)")
    print("GROQ:", "YES" if os.getenv("GROQ_API_KEY") else "NO")
    print("OPENAI:", "YES" if os.getenv("OPENAI_API_KEY") else "NO")
    print("OPENROUTER:", "YES" if os.getenv("OPENROUTER_API_KEY") else "NO")
    print("===================================")
    print("NEXUS OPS backend started")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "nexus-ops"}


@app.get("/api/config")
async def get_config():
    return {
        "mode": "REAL (LLM ENABLED)" if USE_LLM else "MOCK (NO LLM)",
        "execution_mode": os.getenv("EXECUTION_MODE", "mock"),
        "llm_providers": {
            "groq": bool(os.getenv("GROQ_API_KEY")),
            "openai": bool(os.getenv("OPENAI_API_KEY")),
            "openrouter": bool(os.getenv("OPENROUTER_API_KEY"))
        }
    }


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
