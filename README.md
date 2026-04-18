# NEXUS OPS — Autonomous IT Operations Orchestrator
### Innovitus 1.0 · Track 2 (Web Dev / SaaS) · AWS Problem Statement

> **"You describe the infrastructure. NEXUS OPS builds it."**

An agentic AI system that converts natural language cloud requests into
fully executed, verified infrastructure — with zero manual intervention.

---

## Architecture

```
User Ticket (Natural Language)
        │
        ▼
┌─────────────────────────────┐
│      MASTER AGENT           │  ← Claude API + ReAct prompting
│  Parses ticket → JSON plan  │    Dependency-aware step ordering
└────────┬────────────────────┘
         │ dispatches waves
    ┌────┴────┐
    │         │  ← Runs in PARALLEL (no dependencies)
    ▼         ▼
┌────────┐ ┌──────────┐
│Storage │ │ Compute  │   ← Real LocalStack / AWS SDK calls
│ Agent  │ │  Agent   │
└────┬───┘ └─────┬────┘
     └─────┬─────┘
           ▼
    ┌──────────────┐
    │ Deploy Agent │   ← Waits for both above to finish
    └──────┬───────┘
           ▼
    ┌──────────────────┐
    │ Verification     │   ← Checks every output
    │ Agent            │     Self-heals failures (up to 3 retries)
    └──────────────────┘
           │
           ▼
    Live Dashboard (React + WebSocket)
```

---

## Quick Start

### Prerequisites
- **Docker Desktop** installed and running
- **Anthropic API key** (free tier works — get one at https://console.anthropic.com)

### 1. Clone / copy the project
```bash
# If using git
git clone <your-repo>
cd nexus-ops

# Or just cd into the project folder
cd nexus-ops
```

### 2. Set your API key
```bash
cp .env.example .env
# Edit .env and paste your Anthropic API key:
# ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```

### 3. Start everything
```bash
docker-compose up --build
```

This starts:
- **LocalStack** on port 4566 (fake AWS)
- **Redis** on port 6379
- **FastAPI backend** on port 8000
- **React frontend** on port 3000

### 4. Open the app
```
http://localhost:3000
```

---

## Running Without Docker (Development)

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Set env vars
export ANTHROPIC_API_KEY=sk-ant-your-key
export EXECUTION_MODE=mock
export REDIS_URL=redis://localhost:6379

uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Opens on http://localhost:5173
```

### Redis (required for backend)
```bash
# Mac
brew install redis && redis-server

# Linux
sudo apt install redis-server && redis-server

# Docker (easiest)
docker run -p 6379:6379 redis:alpine
```

---

## Execution Modes

| Mode | What happens | When to use |
|------|-------------|-------------|
| `mock` (default) | Fast simulated API responses, ~2-4s per step | Demo, development, hackathon |
| `real` | Hits LocalStack (real AWS-compatible APIs) | Integration testing |
| `real` + real AWS keys | Actual AWS provisioning | Production |

To switch modes, change `EXECUTION_MODE` in `.env`:
```
EXECUTION_MODE=mock    # fast demo
EXECUTION_MODE=real    # LocalStack / AWS
```

---

## Project Structure

```
nexus-ops/
├── docker-compose.yml          ← One command to run everything
├── .env.example                ← Copy to .env, add API key
│
├── backend/
│   ├── main.py                 ← FastAPI entry point
│   ├── requirements.txt
│   ├── Dockerfile
│   │
│   ├── agents/
│   │   ├── master_agent.py     ← Claude API + ReAct planner
│   │   ├── verification_agent.py ← Self-healing checker
│   │   └── orchestrator.py     ← Full pipeline coordinator
│   │
│   ├── tools/
│   │   └── cloud_tools.py      ← create_storage / allocate_compute / deploy_service
│   │
│   ├── routes/
│   │   ├── tickets.py          ← POST /api/tickets, GET /api/tickets
│   │   └── websocket.py        ← WS /ws/{task_id}
│   │
│   └── utils/
│       └── state.py            ← Redis task state + pub/sub
│
└── frontend/
    ├── src/
    │   ├── App.jsx             ← Main dashboard layout
    │   ├── main.jsx            ← React entry
    │   ├── index.css           ← Global styles + Tailwind
    │   │
    │   ├── components/
    │   │   ├── TicketInput.jsx  ← Ticket form + demo presets
    │   │   ├── ExecutionTree.jsx ← Live step visualization
    │   │   ├── LiveLog.jsx      ← Scrolling event log
    │   │   └── ReportCard.jsx   ← Final report on completion
    │   │
    │   ├── hooks/
    │   │   └── useTask.js       ← WebSocket + state hook
    │   │
    │   └── utils/
    │       └── api.js           ← REST + WebSocket helpers
    │
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── tailwind.config.js
```

---

## API Reference

### POST /api/tickets
Submit a new infrastructure ticket.
```json
// Request
{ "ticket": "Set up a production environment for payments-api..." }

// Response
{ "task_id": "TK-AB12CD34", "status": "accepted", "message": "..." }
```

### GET /api/tickets
List recent tasks (last 20).

### GET /api/tickets/{task_id}
Get full task state including all step outputs.

### WS /ws/{task_id}
WebSocket endpoint. Receives:
```json
{ "type": "state",  "data": { /* full task object */ } }
{ "type": "update", "data": { /* full task object */ } }
{ "type": "log",    "data": { "message": "...", "level": "info" } }
```

---

## Demo Flow (for judges)

1. Open `http://localhost:3000`
2. Click **"Payments"** quick demo button
3. Click **"Execute Infrastructure Request"**
4. Watch the live execution tree — Steps 1 & 2 run in parallel
5. Both complete → Step 3 (Deploy) fires automatically
6. Verification Agent confirms everything
7. Final report card shows live endpoint + ARNs

**To demo self-healing:**
- In `backend/tools/cloud_tools.py`, change line:
  ```python
  if random.random() < 0.10:   # change to 0.99 for guaranteed failure
  ```
- Resubmit a ticket — watch the Verification Agent catch and retry

---

## Tech Stack

| Layer | Tech |
|-------|------|
| LLM | Claude API (claude-sonnet-4-20250514) |
| Backend | FastAPI + Python 3.11 |
| Agent framework | Custom (no LangChain) |
| State + realtime | Redis + WebSocket pub/sub |
| Cloud APIs | LocalStack (AWS-compatible) |
| Frontend | React 18 + Vite + Tailwind CSS |
| Containers | Docker Compose |

---

## Troubleshooting

**Backend can't connect to Redis:**
```bash
docker-compose logs redis   # check Redis is healthy
```

**LocalStack not responding:**
```bash
curl http://localhost:4566/_localstack/health
```

**Frontend blank page:**
```bash
cd frontend && npm install && npm run dev
```

**API key errors:**
- Make sure `.env` has `ANTHROPIC_API_KEY=sk-ant-...`
- Without a key, the app runs in demo mode with pre-built plans

---

## Hackathon Notes

- The app works **without a real API key** — a demo plan is used automatically
- `EXECUTION_MODE=mock` gives instant responses perfect for live demos
- All components are decoupled — swap LocalStack for real AWS in one line
- Self-healing is demonstrated live if you force a failure (see above)

**Good luck! 🚀**
