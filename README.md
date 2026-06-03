# x402pulse ⚡
**The pulse of the agent economy**

Real-time analytics dashboard for the x402 payment protocol on Base. Every USDC payment from an AI agent to an x402 facilitator, indexed live.

🌐 Live at: x402pulse.app

## What it does
- Live volume tracking across all x402 facilitators
- Agent spending leaderboards
- Seller revenue leaderboards
- Agent Trust Score (FICO-style 0-850)
- Ecosystem Map (D3 force graph)
- Spike/anomaly detection
- Daily report with PNG export
- Wallet watchlist
- Public API (no key required)

## Architecture
```
Base Mainnet RPC
      ↓
Python Indexer (web3.py)
      ↓
SQLite Database
      ↓
FastAPI Backend (:8000)
      ↓
Next.js Frontend (:3000)
```

## Tech Stack
- **Indexer:** Python 3.12, web3.py
- **API:** FastAPI, SQLite
- **Frontend:** Next.js 14, TypeScript, Tailwind, Recharts, D3
- **Chain:** Base mainnet
- **Token:** USDC

## Quick Start
```bash
# Backend
cd indexer && pip install -r requirements.txt
python main.py

# API
cd api && pip install -r requirements.txt
uvicorn main:app --port 8000

# Frontend
cd frontend && npm install
npm run dev
```

## Environment Variables
Copy `.env.example` and fill in your values.

## API
Free public API at api.x402pulse.app
Full docs at x402pulse.app/api-docs

## License
MIT

Built by @saalick | x402pulse.app
