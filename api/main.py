"""
x402pulse API — read-only FastAPI service over the indexer's SQLite file.

The indexer is the only writer. We open the database in URI read-only mode
(`mode=ro`) so a misconfigured query can never corrupt or lock writes,
and we rely on the indexer's WAL journal for clean concurrent reads.

Endpoints (all JSON, CORS open):
  GET /health                      → { ok, db_rows, last_indexed_block }
  GET /stats                       → 24h KPIs + all-time totals
  GET /volume?period=1h|24h|7d     → bucketed volume series
  GET /agents/leaderboard?limit=N  → top payers (from_address)
  GET /sellers/leaderboard?limit=N → top recipients (to_address)
  GET /feed?limit=N                → most recent transfers, newest first
  GET /alerts                      → addresses spiking >3x their hourly avg
  GET /agent/{address}             → full profile for a single payer
"""

from __future__ import annotations

import os
import re
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Literal, Optional

import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Path as PathParam, Query
from fastapi.middleware.cors import CORSMiddleware

# Static facilitator catalog — used to label seller addresses in /search
# and /seller responses without round-tripping back through SQLite.
from indexer.facilitators import ADDRESS_TO_FACILITATOR

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "x402pulse.db")
DB_PATH = Path(DATABASE_URL).resolve()

# Alert tuning. Both gates must be passed to surface an alert, to avoid
# "they did $0.10 last hour vs $0.02/h average → 5x ALERT" noise.
ALERT_MIN_LAST_HOUR_USDC = 1.0
ALERT_MIN_PRIOR_TXNS = 3
ALERT_MULTIPLIER = 3.0

# Behavior tag thresholds for /agent/{address}.
TAG_MICRO_AVG_USDC = 1.0
TAG_POWER_TOTAL_USDC = 500.0
TAG_BATCH_TXNS_IN_HOUR = 10

ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")

app = FastAPI(
    title="x402pulse",
    description="The pulse of the agent economy — real-time x402 analytics on Base.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------ db

@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    """Per-request read-only connection. SQLite is cheap to open; no pool needed.

    `check_same_thread=False` is REQUIRED because FastAPI resolves the
    dependency on one thread and runs sync handlers in a threadpool that
    may pick a different thread. SQLite connections are thread-affine by
    default and refuse to cross thread boundaries. We never share a single
    connection across requests, so disabling the check is safe.
    """
    if not DB_PATH.exists():
        raise HTTPException(
            status_code=503,
            detail=f"Database not found at {DB_PATH}. Is the indexer running?",
        )
    uri = f"file:{DB_PATH}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def get_db() -> Iterator[sqlite3.Connection]:
    with db() as conn:
        yield conn


def now_ts() -> int:
    return int(time.time())

# ------------------------------------------------------------------ /health

@app.get("/health")
def health(conn: sqlite3.Connection = Depends(get_db)) -> dict:
    rows = conn.execute("SELECT COUNT(*) FROM transfers").fetchone()[0]
    state = conn.execute(
        "SELECT value FROM indexer_state WHERE key='last_indexed_block'"
    ).fetchone()
    return {
        "ok": True,
        "db_rows": rows,
        "last_indexed_block": int(state[0]) if state else None,
    }

# Per-request cache for the global MIN(timestamp) — used by the bounded-flag
# check on /agent and /seller, and by /stats' data_window. Cheap query but no
# point doing it twice per request.
def _db_min_timestamp(conn: sqlite3.Connection) -> Optional[int]:
    row = conn.execute("SELECT MIN(timestamp) FROM transfers").fetchone()
    return int(row[0]) if row and row[0] is not None else None


def _data_window(conn: sqlite3.Connection) -> dict:
    """The actual time span of indexed data — what we ACTUALLY have."""
    row = conn.execute(
        "SELECT MIN(timestamp), MAX(timestamp), COUNT(*) FROM transfers"
    ).fetchone()
    if not row or row[0] is None:
        return {"since": None, "until": None, "days": 0.0, "rows": 0}
    return {
        "since": int(row[0]),
        "until": int(row[1]),
        "days":  round((int(row[1]) - int(row[0])) / 86_400, 1),
        "rows":  int(row[2]),
    }


# How close to the global MIN(timestamp) does an agent's first_seen need to
# be for us to flag it as "bounded by our coverage"? Use 1 hour to allow for
# blocks indexed in the same chunk as the earliest tx.
BOUNDED_TOLERANCE_SECONDS = 3_600


# ------------------------------------------------------------------ on-chain first-seen

# Looking up "actual first USDC transfer from this address on Base" requires
# walking the whole chain — pointless to do in the indexer for every agent
# when Alchemy can answer it in one call via alchemy_getAssetTransfers.
# Cache in-process: each address is immutable, so we never need to re-look-up.
ALCHEMY_BASE_URL = os.getenv("ALCHEMY_BASE_URL")
USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
_first_seen_cache: dict[str, Optional[int]] = {}


@app.get("/agent/{address}/first-seen")
def agent_first_seen(
    address: str = PathParam(..., pattern=ADDRESS_RE.pattern),
) -> dict:
    """On-chain first USDC transfer FROM this address on Base mainnet.

    Goes straight to Alchemy via alchemy_getAssetTransfers — independent of
    how far back our index reaches. Used to show the true onboarding date
    for an agent even when our backfill window is shorter.

    Returns {"address": ..., "first_seen": unix_ts_or_null, "source": "alchemy"|"cache"|"none"}.
    """
    if not ALCHEMY_BASE_URL:
        raise HTTPException(503, "on-chain lookup unavailable: ALCHEMY_BASE_URL not configured")

    addr = address.lower()
    if addr in _first_seen_cache:
        return {"address": addr, "first_seen": _first_seen_cache[addr], "source": "cache"}

    # Step 1: ask Alchemy for the earliest ERC-20 USDC transfer from this address.
    transfer_payload = {
        "jsonrpc": "2.0", "id": 1,
        "method": "alchemy_getAssetTransfers",
        "params": [{
            "fromAddress": address,
            "contractAddresses": [USDC_BASE_MAINNET],
            "category": ["erc20"],
            "order": "asc",
            "maxCount": "0x1",
        }],
    }
    try:
        r = requests.post(ALCHEMY_BASE_URL, json=transfer_payload, timeout=10)
        r.raise_for_status()
        transfers = r.json().get("result", {}).get("transfers", [])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"alchemy lookup failed: {exc}") from exc

    if not transfers:
        _first_seen_cache[addr] = None
        return {"address": addr, "first_seen": None, "source": "none"}

    # Step 2: turn that block number into a timestamp.
    block_hex = transfers[0]["blockNum"]
    block_payload = {
        "jsonrpc": "2.0", "id": 2,
        "method": "eth_getBlockByNumber",
        "params": [block_hex, False],
    }
    try:
        r2 = requests.post(ALCHEMY_BASE_URL, json=block_payload, timeout=10)
        r2.raise_for_status()
        block = r2.json().get("result")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"alchemy block lookup failed: {exc}") from exc

    if not block or "timestamp" not in block:
        return {"address": addr, "first_seen": None, "source": "none"}

    ts = int(block["timestamp"], 16)
    _first_seen_cache[addr] = ts
    return {"address": addr, "first_seen": ts, "source": "alchemy"}


# ------------------------------------------------------------------ /stats

@app.get("/stats")
def stats(conn: sqlite3.Connection = Depends(get_db)) -> dict:
    now = now_ts()
    day_ago = now - 86_400

    total = conn.execute(
        "SELECT COALESCE(SUM(amount_usdc), 0), COUNT(*) FROM transfers"
    ).fetchone()

    day = conn.execute(
        "SELECT COALESCE(SUM(amount_usdc), 0), COUNT(*), "
        "       COUNT(DISTINCT from_address), COUNT(DISTINCT to_address) "
        "FROM transfers WHERE timestamp >= ?",
        (day_ago,),
    ).fetchone()

    return {
        # NOTE: "total_*" here means "within data_window" — the indexer only
        # has a bounded backfill, not all of x402 history. UIs should display
        # data_window prominently so users know what's covered.
        "total_volume_usdc": float(total[0]),
        "total_transactions": int(total[1]),
        "volume_24h_usdc": float(day[0]),
        "transactions_24h": int(day[1]),
        "active_agents_24h": int(day[2]),
        "active_sellers_24h": int(day[3]),
        "data_window": _data_window(conn),
    }

# ------------------------------------------------------------------ /volume

# Per-period config: (lookback_seconds, bucket_seconds, label)
_VOLUME_PERIODS: dict[str, tuple[int, int]] = {
    "1h": (3_600,    60),       # 60 points, 1-minute buckets
    "24h": (86_400,  3_600),    # 24 points, 1-hour buckets
    "7d":  (604_800, 3_600),    # 168 points, 1-hour buckets
}


@app.get("/volume")
def volume(
    period: Literal["1h", "24h", "7d"] = Query("24h"),
    conn: sqlite3.Connection = Depends(get_db),
) -> list[dict]:
    lookback, bucket = _VOLUME_PERIODS[period]
    cutoff = now_ts() - lookback
    rows = conn.execute(
        "SELECT (timestamp / ?) * ? AS bucket, "
        "       SUM(amount_usdc) AS volume, "
        "       COUNT(*) AS txns "
        "FROM transfers "
        "WHERE timestamp >= ? "
        "GROUP BY bucket "
        "ORDER BY bucket ASC",
        (bucket, bucket, cutoff),
    ).fetchall()
    return [
        {"timestamp": int(r["bucket"]), "volume": float(r["volume"]), "txns": int(r["txns"])}
        for r in rows
    ]

# ------------------------------------------------------------------ leaderboards

@app.get("/agents/leaderboard")
def agents_leaderboard(
    limit: int = Query(20, ge=1, le=200),
    conn: sqlite3.Connection = Depends(get_db),
) -> list[dict]:
    rows = conn.execute(
        "SELECT from_address AS address, "
        "       COUNT(*)              AS transactions, "
        "       SUM(amount_usdc)      AS volume_usdc, "
        "       MAX(timestamp)        AS last_seen "
        "FROM transfers "
        "GROUP BY from_address "
        "ORDER BY volume_usdc DESC "
        "LIMIT ?",
        (limit,),
    ).fetchall()
    return [
        {
            "address": r["address"],
            "transactions": int(r["transactions"]),
            "volume_usdc": float(r["volume_usdc"]),
            "last_seen": int(r["last_seen"]),
        }
        for r in rows
    ]


@app.get("/sellers/leaderboard")
def sellers_leaderboard(
    limit: int = Query(20, ge=1, le=200),
    conn: sqlite3.Connection = Depends(get_db),
) -> list[dict]:
    rows = conn.execute(
        "SELECT to_address AS address, "
        "       facilitator, "
        "       COUNT(*)              AS transactions, "
        "       SUM(amount_usdc)      AS volume_usdc, "
        "       MAX(timestamp)        AS last_seen "
        "FROM transfers "
        "GROUP BY to_address "
        "ORDER BY volume_usdc DESC "
        "LIMIT ?",
        (limit,),
    ).fetchall()
    return [
        {
            "address": r["address"],
            "facilitator": r["facilitator"],
            "transactions": int(r["transactions"]),
            "volume_usdc": float(r["volume_usdc"]),
            "last_seen": int(r["last_seen"]),
        }
        for r in rows
    ]

# ------------------------------------------------------------------ /feed

@app.get("/feed")
def feed(
    limit: int = Query(50, ge=1, le=500),
    conn: sqlite3.Connection = Depends(get_db),
) -> list[dict]:
    rows = conn.execute(
        "SELECT tx_hash, block_number, timestamp, from_address, to_address, "
        "       amount_usdc, facilitator "
        "FROM transfers "
        "ORDER BY timestamp DESC, log_index DESC "
        "LIMIT ?",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]

# ------------------------------------------------------------------ /alerts

@app.get("/alerts")
def alerts(conn: sqlite3.Connection = Depends(get_db)) -> list[dict]:
    """
    Flag any from_address whose last-hour volume exceeds 3x its hourly
    average over the previous 23 hours, with floor gates to avoid noise.
    """
    now = now_ts()
    hour_ago = now - 3_600
    day_ago = now - 86_400

    rows = conn.execute(
        """
        WITH last_hour AS (
            SELECT from_address,
                   COUNT(*)         AS txns_1h,
                   SUM(amount_usdc) AS vol_1h
            FROM transfers
            WHERE timestamp >= ?
            GROUP BY from_address
        ),
        prior AS (
            SELECT from_address,
                   COUNT(*)         AS txns_prior,
                   SUM(amount_usdc) AS vol_prior
            FROM transfers
            WHERE timestamp >= ? AND timestamp < ?
            GROUP BY from_address
        )
        SELECT l.from_address                       AS address,
               l.vol_1h                             AS last_hour_volume,
               l.txns_1h                            AS last_hour_txns,
               COALESCE(p.vol_prior, 0) / 23.0      AS prior_hourly_avg,
               COALESCE(p.txns_prior, 0)            AS prior_txns
        FROM last_hour l
        LEFT JOIN prior p USING (from_address)
        """,
        (hour_ago, day_ago, hour_ago),
    ).fetchall()

    alerts_out: list[dict] = []
    for r in rows:
        last_hour_vol = float(r["last_hour_volume"] or 0)
        avg = float(r["prior_hourly_avg"] or 0)
        prior_txns = int(r["prior_txns"] or 0)

        if last_hour_vol < ALERT_MIN_LAST_HOUR_USDC:
            continue
        if prior_txns < ALERT_MIN_PRIOR_TXNS:
            # No real baseline yet — skip rather than flag every new payer.
            continue
        if avg <= 0 or last_hour_vol <= ALERT_MULTIPLIER * avg:
            continue

        alerts_out.append({
            "address": r["address"],
            "last_hour_volume_usdc": last_hour_vol,
            "last_hour_transactions": int(r["last_hour_txns"]),
            "prior_hourly_avg_usdc": avg,
            "multiplier": round(last_hour_vol / avg, 2),
        })

    alerts_out.sort(key=lambda a: a["multiplier"], reverse=True)
    return alerts_out

# ------------------------------------------------------------------ /health-score

# Composite health-score weights — must sum to 1.0.
HEALTH_WEIGHTS = {
    "velocity":  0.30,
    "agents":    0.25,
    "volume":    0.25,
    "diversity": 0.20,
}


def _ratio_to_score(ratio: float) -> float:
    """Map a "now / baseline" ratio to a 0-100 sub-score.

    Calibration points:
      ratio 0.0 → 10   (basically no activity vs baseline)
      ratio 0.5 → 42   (halved)
      ratio 1.0 → 75   (steady = healthy)
      ratio ≥1.4 → 100 (40%+ growth = ceiling)
    """
    return max(0.0, min(100.0, ratio * 65.0 + 10.0))


def _compute_health(conn: sqlite3.Connection, now: int) -> dict:
    """Calculate the weighted composite score at a given reference moment."""
    h1   = now - 3_600
    h2   = now - 7_200
    d1   = now - 86_400
    d2   = now - 172_800
    w1   = now - 604_800

    # --- velocity: txns last hour vs prior hour
    (txns_1h,) = conn.execute(
        "SELECT COUNT(*) FROM transfers WHERE timestamp >= ? AND timestamp < ?",
        (h1, now),
    ).fetchone()
    (txns_prev_1h,) = conn.execute(
        "SELECT COUNT(*) FROM transfers WHERE timestamp >= ? AND timestamp < ?",
        (h2, h1),
    ).fetchone()
    velocity_ratio = (txns_1h / txns_prev_1h) if txns_prev_1h else (1.0 if txns_1h else 0.0)
    velocity_score = _ratio_to_score(velocity_ratio)

    # --- agents: unique active agents last 24h vs 7d daily-avg
    (agents_24h,) = conn.execute(
        "SELECT COUNT(DISTINCT from_address) FROM transfers WHERE timestamp >= ? AND timestamp < ?",
        (d1, now),
    ).fetchone()
    # 7d "daily average" computed by bucketing distinct-agents per day, then mean
    week_rows = conn.execute(
        "SELECT (timestamp / 86400) AS d, COUNT(DISTINCT from_address) AS n "
        "FROM transfers WHERE timestamp >= ? AND timestamp < ? "
        "GROUP BY d",
        (w1, now),
    ).fetchall()
    daily_avg = sum(r["n"] for r in week_rows) / 7.0 if week_rows else 0.0
    agents_ratio = (agents_24h / daily_avg) if daily_avg else (1.0 if agents_24h else 0.0)
    agents_score = _ratio_to_score(agents_ratio)

    # --- volume: last 24h vs prior 24h
    (vol_24h,) = conn.execute(
        "SELECT COALESCE(SUM(amount_usdc), 0) FROM transfers WHERE timestamp >= ? AND timestamp < ?",
        (d1, now),
    ).fetchone()
    (vol_prev_24h,) = conn.execute(
        "SELECT COALESCE(SUM(amount_usdc), 0) FROM transfers WHERE timestamp >= ? AND timestamp < ?",
        (d2, d1),
    ).fetchone()
    volume_ratio = (vol_24h / vol_prev_24h) if vol_prev_24h else (1.0 if vol_24h else 0.0)
    volume_score = _ratio_to_score(volume_ratio)

    # --- diversity: number of distinct facilitators active in last 24h.
    # 5+ active facilitators is the visual ceiling.
    (active_facilitators,) = conn.execute(
        "SELECT COUNT(DISTINCT facilitator) FROM transfers WHERE timestamp >= ? AND timestamp < ?",
        (d1, now),
    ).fetchone()
    diversity_score = min(100.0, active_facilitators * 20.0)

    components = {
        "velocity":  velocity_score,
        "agents":    agents_score,
        "volume":    volume_score,
        "diversity": diversity_score,
    }
    score = sum(components[k] * w for k, w in HEALTH_WEIGHTS.items())
    return {
        "score": max(0.0, min(100.0, score)),
        "components": {
            "velocity":  {"score": velocity_score, "txns_1h": int(txns_1h), "txns_prev_1h": int(txns_prev_1h)},
            "agents":    {"score": agents_score, "agents_24h": int(agents_24h), "daily_avg_7d": daily_avg},
            "volume":    {"score": volume_score, "volume_24h": float(vol_24h), "volume_prev_24h": float(vol_prev_24h)},
            "diversity": {"score": diversity_score, "active_facilitators_24h": int(active_facilitators)},
        },
    }


def _label_for(score: float) -> str:
    if score < 40:  return "Critical"
    if score < 60:  return "Fair"
    if score < 80:  return "Good"
    if score < 90:  return "Strong"
    return "Excellent"


# ------------------------------------------------------------------ /stats/distribution

@app.get("/stats/distribution")
def stats_distribution(conn: sqlite3.Connection = Depends(get_db)) -> dict:
    """All-time payment-size buckets + median + most-common bucket."""
    rows = conn.execute(
        "SELECT amount_usdc FROM transfers"
    ).fetchall()
    if not rows:
        empty = [
            {"label": f"{name.capitalize()} ({_bucket_label(name)})",
             "count": 0, "volume_usdc": 0.0, "pct": 0.0}
            for name, _, _ in _BUCKETS
        ]
        return {"buckets": empty, "median_payment_usdc": 0.0, "mode_bucket": empty[0]["label"]}

    amounts = sorted(float(r["amount_usdc"]) for r in rows)

    counts = {name: 0 for name, _, _ in _BUCKETS}
    volumes = {name: 0.0 for name, _, _ in _BUCKETS}
    for a in amounts:
        b = _bucket_of(a)
        counts[b] += 1
        volumes[b] += a

    total = len(amounts)
    median = amounts[total // 2] if total % 2 else (amounts[total // 2 - 1] + amounts[total // 2]) / 2

    buckets = []
    for name, lo, hi in _BUCKETS:
        buckets.append({
            "label":       f"{name.capitalize()} ({_bucket_label(name)})",
            "count":       counts[name],
            "volume_usdc": round(volumes[name], 6),
            "pct":         round(counts[name] / total * 100, 2),
        })
    mode_bucket = max(buckets, key=lambda b: b["count"])

    return {
        "buckets": buckets,
        "median_payment_usdc": median,
        "mode_bucket": mode_bucket["label"],
    }


def _bucket_label(name: str) -> str:
    return {
        "micro":  "<$0.01",
        "small":  "$0.01–$1",
        "medium": "$1–$10",
        "large":  "$10–$100",
        "whale":  ">$100",
    }[name]


# ------------------------------------------------------------------ /report/daily

# Boundaries between size buckets, in USDC. Boundary belongs to the lower
# bucket (i.e. exactly $0.01 → "small").
_BUCKETS = [
    ("micro",  0.0,    0.01),    # < $0.01
    ("small",  0.01,   1.0),     # $0.01 – $1
    ("medium", 1.0,    10.0),    # $1 – $10
    ("large",  10.0,   100.0),   # $10 – $100
    ("whale",  100.0,  float("inf")),  # > $100
]


def _bucket_of(amount: float) -> str:
    for name, lo, hi in _BUCKETS:
        if lo <= amount < hi:
            return name
    return "whale"


@app.get("/report/daily")
def daily_report(conn: sqlite3.Connection = Depends(get_db)) -> dict:
    """A complete 'last 24 hours in x402' snapshot — one query-light call."""
    now = now_ts()
    d1 = now - 86_400
    d2 = now - 172_800

    headline = conn.execute(
        "SELECT COUNT(*)                 AS txns, "
        "       COALESCE(SUM(amount_usdc), 0) AS volume, "
        "       COALESCE(AVG(amount_usdc), 0) AS avg, "
        "       COUNT(DISTINCT from_address)  AS agents, "
        "       COUNT(DISTINCT to_address)    AS sellers "
        "FROM transfers WHERE timestamp >= ?",
        (d1,),
    ).fetchone()
    txns_24h   = int(headline["txns"])
    volume_24h = float(headline["volume"])
    avg_24h    = float(headline["avg"])
    agents_24h = int(headline["agents"])
    sellers_24h = int(headline["sellers"])

    # Previous day volume → % change.
    prev_vol = conn.execute(
        "SELECT COALESCE(SUM(amount_usdc), 0) FROM transfers "
        "WHERE timestamp >= ? AND timestamp < ?",
        (d2, d1),
    ).fetchone()[0]
    prev_vol = float(prev_vol)
    if prev_vol > 0:
        volume_change_pct = (volume_24h - prev_vol) / prev_vol * 100.0
    elif volume_24h > 0:
        volume_change_pct = 100.0
    else:
        volume_change_pct = 0.0

    top_agent = conn.execute(
        "SELECT from_address AS address, COUNT(*) AS txns, "
        "       SUM(amount_usdc) AS volume "
        "FROM transfers WHERE timestamp >= ? "
        "GROUP BY from_address ORDER BY volume DESC LIMIT 1",
        (d1,),
    ).fetchone()
    top_seller = conn.execute(
        "SELECT to_address AS address, COUNT(*) AS txns, "
        "       SUM(amount_usdc) AS volume, facilitator "
        "FROM transfers WHERE timestamp >= ? "
        "GROUP BY to_address ORDER BY volume DESC LIMIT 1",
        (d1,),
    ).fetchone()
    top_facilitator = conn.execute(
        "SELECT facilitator AS name, COUNT(*) AS txns, "
        "       SUM(amount_usdc) AS volume "
        "FROM transfers WHERE timestamp >= ? "
        "GROUP BY facilitator ORDER BY volume DESC LIMIT 1",
        (d1,),
    ).fetchone()
    fac_market_share = (
        (float(top_facilitator["volume"]) / volume_24h * 100.0)
        if top_facilitator and volume_24h else 0.0
    )

    biggest_tx = conn.execute(
        "SELECT amount_usdc, from_address, to_address, facilitator, "
        "       tx_hash, timestamp "
        "FROM transfers WHERE timestamp >= ? "
        "ORDER BY amount_usdc DESC LIMIT 1",
        (d1,),
    ).fetchone()

    busiest = conn.execute(
        "SELECT (timestamp / 3600) * 3600 AS hour, COUNT(*) AS c "
        "FROM transfers WHERE timestamp >= ? "
        "GROUP BY hour ORDER BY c DESC LIMIT 1",
        (d1,),
    ).fetchone()

    new_agents_count = conn.execute(
        "SELECT COUNT(*) FROM ("
        "  SELECT from_address FROM transfers "
        "  GROUP BY from_address HAVING MIN(timestamp) >= ?"
        ")",
        (d1,),
    ).fetchone()[0] or 0

    # Payment-size breakdown for last-24h transfers (count).
    rows_24h = conn.execute(
        "SELECT amount_usdc FROM transfers WHERE timestamp >= ?",
        (d1,),
    ).fetchall()
    breakdown = {name: 0 for name, _, _ in _BUCKETS}
    for r in rows_24h:
        breakdown[_bucket_of(float(r["amount_usdc"]))] += 1

    return {
        "period":              "last 24 hours",
        "generated_at":        now,
        "total_volume_usdc":   volume_24h,
        "total_transactions":  txns_24h,
        "unique_agents":       agents_24h,
        "unique_sellers":      sellers_24h,
        "avg_payment_usdc":    avg_24h,
        "volume_change_pct":   round(volume_change_pct, 1),
        "new_agents_count":    int(new_agents_count),
        "top_agent": (
            None if not top_agent
            else {
                "address": top_agent["address"],
                "volume":  float(top_agent["volume"]),
                "txns":    int(top_agent["txns"]),
            }
        ),
        "top_seller": (
            None if not top_seller
            else {
                "address":     top_seller["address"],
                "volume":      float(top_seller["volume"]),
                "txns":        int(top_seller["txns"]),
                "facilitator": top_seller["facilitator"],
            }
        ),
        "top_facilitator": (
            None if not top_facilitator
            else {
                "name":              top_facilitator["name"],
                "volume":            float(top_facilitator["volume"]),
                "market_share_pct":  round(fac_market_share, 1),
            }
        ),
        "biggest_single_tx": (
            None if not biggest_tx
            else {
                "amount":      float(biggest_tx["amount_usdc"]),
                "from":        biggest_tx["from_address"],
                "to":          biggest_tx["to_address"],
                "facilitator": biggest_tx["facilitator"],
                "tx_hash":     biggest_tx["tx_hash"],
                "timestamp":   int(biggest_tx["timestamp"]),
            }
        ),
        "busiest_hour": (
            None if not busiest
            else {"hour": int(busiest["hour"]), "tx_count": int(busiest["c"])}
        ),
        "payment_size_breakdown": breakdown,
    }

# ------------------------------------------------------------------ /map/data

# Threshold for inclusion — drops the long tail of one-off transfers so the
# graph stays readable. Bumped via env var if the dashboard ever wants a
# denser view.
MAP_MIN_TXNS = int(os.getenv("MAP_MIN_TXNS", "3"))


@app.get("/map/data")
def map_data(conn: sqlite3.Connection = Depends(get_db)) -> dict:
    """
    Force-graph payload for the /map page.

    Nodes are agents (payers), facilitators (logical groups), and sellers
    (recipient addresses). Edges go agent → facilitator → seller and carry
    a `weight` (transaction count) used for line thickness on the client.
    Only addresses with > MAP_MIN_TXNS transactions are included so the
    graph stays legible.
    """
    # --- agent nodes (from_address) above the txn floor
    agent_rows = conn.execute(
        "SELECT from_address AS address, COUNT(*) AS c, "
        "       SUM(amount_usdc) AS v "
        "FROM transfers GROUP BY from_address HAVING c > ?",
        (MAP_MIN_TXNS,),
    ).fetchall()
    agents = {r["address"]: {"c": int(r["c"]), "v": float(r["v"])} for r in agent_rows}

    # --- seller nodes (to_address) above the txn floor
    seller_rows = conn.execute(
        "SELECT to_address AS address, COUNT(*) AS c, "
        "       SUM(amount_usdc) AS v, facilitator "
        "FROM transfers GROUP BY to_address HAVING c > ?",
        (MAP_MIN_TXNS,),
    ).fetchall()
    sellers = {
        r["address"]: {"c": int(r["c"]), "v": float(r["v"]), "facilitator": r["facilitator"]}
        for r in seller_rows
    }

    # --- facilitator-level totals (one node per facilitator)
    fac_rows = conn.execute(
        "SELECT facilitator, COUNT(*) AS c, SUM(amount_usdc) AS v "
        "FROM transfers GROUP BY facilitator"
    ).fetchall()
    facilitators = {r["facilitator"]: {"c": int(r["c"]), "v": float(r["v"])} for r in fac_rows}

    # --- edges (only between included nodes)
    a2f = conn.execute(
        "SELECT from_address, facilitator, COUNT(*) AS c "
        "FROM transfers "
        "WHERE from_address IN (SELECT from_address FROM transfers GROUP BY from_address HAVING COUNT(*) > ?) "
        "GROUP BY from_address, facilitator",
        (MAP_MIN_TXNS,),
    ).fetchall()
    f2s = conn.execute(
        "SELECT facilitator, to_address, COUNT(*) AS c "
        "FROM transfers "
        "WHERE to_address IN (SELECT to_address FROM transfers GROUP BY to_address HAVING COUNT(*) > ?) "
        "GROUP BY facilitator, to_address",
        (MAP_MIN_TXNS,),
    ).fetchall()

    nodes: list[dict] = []
    for addr, d in agents.items():
        nodes.append({
            "id": addr, "type": "agent",
            "label": f"{addr[:6]}…{addr[-4:]}",
            "volume": d["v"], "tx_count": d["c"],
        })
    for name, d in facilitators.items():
        nodes.append({
            "id": f"fac:{name}", "type": "facilitator",
            "label": name,
            "volume": d["v"], "tx_count": d["c"],
        })
    for addr, d in sellers.items():
        nodes.append({
            "id": addr, "type": "seller",
            "label": f"{addr[:6]}…{addr[-4:]}",
            "volume": d["v"], "tx_count": d["c"],
            "facilitator": d["facilitator"],
        })

    edges: list[dict] = []
    for r in a2f:
        if r["from_address"] not in agents:
            continue
        edges.append({
            "source": r["from_address"],
            "target": f"fac:{r['facilitator']}",
            "weight": int(r["c"]),
        })
    for r in f2s:
        if r["to_address"] not in sellers:
            continue
        edges.append({
            "source": f"fac:{r['facilitator']}",
            "target": r["to_address"],
            "weight": int(r["c"]),
        })

    return {"nodes": nodes, "edges": edges, "min_txns": MAP_MIN_TXNS}

# ------------------------------------------------------------------ /agents/batch

BATCH_MAX_ADDRESSES = 10

@app.get("/agents/batch")
def agents_batch(
    addresses: str = Query(..., description="Comma-separated 0x… addresses, max 10"),
    conn: sqlite3.Connection = Depends(get_db),
) -> list[dict]:
    """
    Compact summary for up to 10 wallets in a single round-trip.

    Each entry has both directions (sent + received) and the per-hour
    sparkline so the watchlist page can render every card from one call.
    """
    addr_list = [a.strip().lower() for a in addresses.split(",") if a.strip()]
    if not addr_list:
        raise HTTPException(status_code=400, detail="no addresses supplied")
    if len(addr_list) > BATCH_MAX_ADDRESSES:
        raise HTTPException(status_code=400,
                            detail=f"max {BATCH_MAX_ADDRESSES} addresses per call")
    for a in addr_list:
        if not ADDRESS_RE.match(a):
            raise HTTPException(status_code=400, detail=f"bad address: {a}")

    now = now_ts()
    day_ago = now - 86_400

    out = []
    for addr in addr_list:
        sent = conn.execute(
            "SELECT COUNT(*) AS c, COALESCE(SUM(amount_usdc),0) AS v, "
            "       MAX(timestamp) AS t "
            "FROM transfers WHERE from_address = ?",
            (addr,),
        ).fetchone()
        recv = conn.execute(
            "SELECT COUNT(*) AS c, COALESCE(SUM(amount_usdc),0) AS v, "
            "       MAX(timestamp) AS t "
            "FROM transfers WHERE to_address = ?",
            (addr,),
        ).fetchone()
        sent_c, sent_v, sent_t = int(sent["c"]), float(sent["v"]), int(sent["t"] or 0)
        recv_c, recv_v, recv_t = int(recv["c"]), float(recv["v"]), int(recv["t"] or 0)

        if not sent_c and not recv_c:
            out.append({
                "address":             addr,
                "kind":                "unknown",
                "total_sent_usdc":     0.0,
                "total_received_usdc": 0.0,
                "total_transactions":  0,
                "last_active":         None,
                "facilitator":         ADDRESS_TO_FACILITATOR.get(addr),
                "last_6":              [],
                "sparkline_24h":       [{"hour": (now // 3600 - 23 + i) * 3600,
                                          "volume": 0.0} for i in range(24)],
            })
            continue

        kind = "both" if sent_c and recv_c else ("agent" if sent_c else "seller")
        last_active = max(sent_t, recv_t)

        last6 = conn.execute(
            "SELECT tx_hash, timestamp, amount_usdc, facilitator, "
            "       CASE WHEN from_address = ? THEN 'sent' ELSE 'received' END AS direction "
            "FROM transfers "
            "WHERE from_address = ? OR to_address = ? "
            "ORDER BY timestamp DESC, log_index DESC LIMIT 6",
            (addr, addr, addr),
        ).fetchall()

        hourly = conn.execute(
            "SELECT (timestamp/3600)*3600 AS h, SUM(amount_usdc) AS v "
            "FROM transfers "
            "WHERE (from_address = ? OR to_address = ?) AND timestamp >= ? "
            "GROUP BY h ORDER BY h",
            (addr, addr, day_ago),
        ).fetchall()
        by_hour = {int(r["h"]): float(r["v"]) for r in hourly}
        first_bucket = (now // 3600 - 23) * 3600
        sparkline = [
            {"hour": first_bucket + i * 3600,
             "volume": by_hour.get(first_bucket + i * 3600, 0.0)}
            for i in range(24)
        ]

        out.append({
            "address":             addr,
            "kind":                kind,
            "total_sent_usdc":     sent_v,
            "total_received_usdc": recv_v,
            "total_transactions":  sent_c + recv_c,
            "last_active":         last_active,
            "facilitator":         ADDRESS_TO_FACILITATOR.get(addr),
            "last_6": [
                {
                    "tx_hash":     r["tx_hash"],
                    "timestamp":   int(r["timestamp"]),
                    "amount_usdc": float(r["amount_usdc"]),
                    "direction":   r["direction"],
                    "facilitator": r["facilitator"],
                }
                for r in last6
            ],
            "sparkline_24h": sparkline,
        })
    return out

# ------------------------------------------------------------------ /agent/{address}/fingerprint

def _longest_day_streak(days: list[int]) -> int:
    """Longest consecutive-day streak from a sorted list of day-bucket ints."""
    if not days:
        return 0
    longest = current = 1
    for prev, cur in zip(days, days[1:]):
        if cur == prev + 1:
            current += 1
            longest = max(longest, current)
        elif cur != prev:
            current = 1
    return longest


@app.get("/agent/{address}/fingerprint")
def agent_fingerprint(
    address: str = PathParam(...),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Five 0-100 fingerprint axes for an agent, each normalized against the DB."""
    if not ADDRESS_RE.match(address):
        raise HTTPException(status_code=400, detail="invalid address format")
    addr = address.lower()

    # Bail early if we've never seen this address as a payer.
    base = conn.execute(
        "SELECT COUNT(*) AS txns, COALESCE(SUM(amount_usdc),0) AS volume "
        "FROM transfers WHERE from_address = ?",
        (addr,),
    ).fetchone()
    if not base or not base["txns"]:
        raise HTTPException(status_code=404, detail="agent not found")
    txns = int(base["txns"])
    volume = float(base["volume"])

    diversity_count = conn.execute(
        "SELECT COUNT(DISTINCT facilitator) FROM transfers WHERE from_address = ?",
        (addr,),
    ).fetchone()[0] or 0

    max_hourly = conn.execute(
        "SELECT MAX(c) FROM ("
        "  SELECT COUNT(*) AS c FROM transfers "
        "  WHERE from_address = ? GROUP BY timestamp/3600"
        ")",
        (addr,),
    ).fetchone()[0] or 0

    now = now_ts()
    day_ago = now - 86_400
    txns_24h = conn.execute(
        "SELECT COUNT(*) FROM transfers WHERE from_address = ? AND timestamp >= ?",
        (addr, day_ago),
    ).fetchone()[0] or 0

    days = [int(r[0]) for r in conn.execute(
        "SELECT DISTINCT CAST(timestamp / 86400 AS INTEGER) "
        "FROM transfers WHERE from_address = ? ORDER BY 1",
        (addr,),
    )]
    streak = _longest_day_streak(days)
    active_days = max(1, len(days))
    daily_avg = txns / active_days

    # DB-wide normalizers — fine to recompute per request at this scale.
    db_max_hourly = conn.execute(
        "SELECT MAX(c) FROM ("
        "  SELECT COUNT(*) AS c FROM transfers "
        "  GROUP BY from_address, timestamp/3600"
        ")"
    ).fetchone()[0] or 1
    db_max_volume = conn.execute(
        "SELECT MAX(v) FROM ("
        "  SELECT SUM(amount_usdc) AS v FROM transfers GROUP BY from_address"
        ")"
    ).fetchone()[0] or 1.0

    speed_score       = min(100.0, (max_hourly / db_max_hourly) * 100)
    volume_score      = min(100.0, (volume     / db_max_volume) * 100)
    diversity_score   = min(100.0, (diversity_count / 3.0)      * 100)
    consistency_score = min(100.0, (streak     / 7.0)           * 100)
    activity_score    = min(100.0, (txns_24h   / daily_avg)     * 100) if daily_avg else 0.0

    return {
        "address": addr,
        "axes": [
            {"label": "Speed",       "score": round(speed_score, 1),
             "detail": f"{max_hourly} txns / hour peak"},
            {"label": "Volume",      "score": round(volume_score, 1),
             "detail": f"${volume:,.2f} total spent"},
            {"label": "Diversity",   "score": round(diversity_score, 1),
             "detail": f"{diversity_count} facilitators used"},
            {"label": "Consistency", "score": round(consistency_score, 1),
             "detail": f"{streak}-day streak"},
            {"label": "Activity",    "score": round(activity_score, 1),
             "detail": f"{txns_24h} txns in 24h (avg {daily_avg:.1f}/day)"},
        ],
    }

# ------------------------------------------------------------------ /score

# Tiered FICO-style trust score. Max total = 850 across 5 dimensions.
SCORE_MAX = 850

def _payment_history_score(txns: int) -> tuple[int, str]:
    if txns >= 20: return 147, "20+ payments recorded"
    if txns >= 5:  return 100, "5+ payments recorded"
    if txns >= 1:  return 50,  "first payment recorded"
    return 0, "no payments yet"


def _wallet_age_score(age_days: float) -> tuple[int, str]:
    if age_days >= 30: return 127, "first seen 30+ days ago"
    if age_days >= 14: return 90,  "first seen 14+ days ago"
    if age_days >= 7:  return 50,  "first seen 7+ days ago"
    return 0, f"first seen {age_days:.1f} day(s) ago"


def _volume_score(vol: float) -> tuple[int, str]:
    if vol >  1000: return 170, "$1,000+ total spent"
    if vol >  100:  return 130, "$100+ total spent"
    if vol >  10:   return 80,  "$10+ total spent"
    if vol >  1:    return 40,  "$1+ total spent"
    return 0, f"only ${vol:.4f} spent"


def _consistency_score(days_active: int) -> tuple[int, str]:
    if days_active >= 10: return 127, "active on 10+ different days"
    if days_active >= 5:  return 80,  "active on 5+ different days"
    if days_active >= 2:  return 40,  "active on 2+ different days"
    return 0, "active on a single day"


def _diversity_score(n_facilitators: int) -> tuple[int, str]:
    if n_facilitators >= 3: return 127, "used 3+ facilitators"
    if n_facilitators == 2: return 85,  "used 2 facilitators"
    if n_facilitators == 1: return 40,  "used 1 facilitator"
    return 0, "no facilitator activity"


def _label_and_grade(score: int) -> tuple[str, str]:
    if score == 0:    return "No x402 Activity", "F"
    if score <= 299:  return "New Agent",        "D"
    if score <= 499:  return "Developing",       "C"
    if score <= 649:  return "Established",      "B"
    if score <= 749:  return "Trusted",          "A"
    return "Elite Agent", "A"


def _compute_score_for_stats(stats: dict, now: int) -> dict:
    """Build the full score response from one agent's aggregate stats."""
    txns         = int(stats.get("txns") or 0)
    volume       = float(stats.get("volume") or 0)
    first_seen   = int(stats.get("first_seen") or 0)
    last_seen    = int(stats.get("last_seen") or 0)
    days_active  = int(stats.get("days_active") or 0)
    facilitators = stats.get("facilitators") or []

    age_days = (now - first_seen) / 86_400 if first_seen else 0.0

    ph_s,  ph_d  = _payment_history_score(txns)
    age_s, age_d = _wallet_age_score(age_days)
    vol_s, vol_d = _volume_score(volume)
    con_s, con_d = _consistency_score(days_active)
    div_s, div_d = _diversity_score(len(facilitators))

    score = ph_s + age_s + vol_s + con_s + div_s
    label, grade = _label_and_grade(score)

    return {
        "score": score,
        "label": label,
        "grade": grade,
        "dimensions": {
            "payment_history": {"score": ph_s,  "max": 147, "detail": ph_d},
            "wallet_age":      {"score": age_s, "max": 127, "detail": age_d},
            "volume":          {"score": vol_s, "max": 170, "detail": vol_d},
            "consistency":     {"score": con_s, "max": 127, "detail": con_d},
            "diversity":       {"score": div_s, "max": 127, "detail": div_d},
        },
        "stats": {
            "total_transactions":  txns,
            "total_volume_usdc":   volume,
            "first_seen":          first_seen,
            "last_seen":           last_seen,
            "days_active":         days_active,
            "facilitators_used":   facilitators,
        },
    }


def _agent_stats(conn: sqlite3.Connection, addr: str) -> Optional[dict]:
    """Pull one agent's aggregate stats in a single round-trip."""
    row = conn.execute(
        "SELECT COUNT(*)                                       AS txns, "
        "       COALESCE(SUM(amount_usdc), 0)                  AS volume, "
        "       MIN(timestamp)                                 AS first_seen, "
        "       MAX(timestamp)                                 AS last_seen, "
        "       COUNT(DISTINCT CAST(timestamp/86400 AS INTEGER)) AS days_active "
        "FROM transfers WHERE from_address = ?",
        (addr,),
    ).fetchone()
    if not row or not row["txns"]:
        return None
    facilitators = [
        r[0] for r in conn.execute(
            "SELECT DISTINCT facilitator FROM transfers "
            "WHERE from_address = ? ORDER BY 1",
            (addr,),
        )
    ]
    return {
        "txns":         int(row["txns"]),
        "volume":       float(row["volume"]),
        "first_seen":   int(row["first_seen"]),
        "last_seen":    int(row["last_seen"]),
        "days_active":  int(row["days_active"]),
        "facilitators": facilitators,
    }


def _all_agent_scores(conn: sqlite3.Connection) -> list[dict]:
    """Compute scores for every agent in one pass — used by percentile + leaderboard."""
    now = now_ts()
    rows = conn.execute(
        "SELECT from_address AS address, "
        "       COUNT(*) AS txns, "
        "       SUM(amount_usdc) AS volume, "
        "       MIN(timestamp) AS first_seen, "
        "       MAX(timestamp) AS last_seen, "
        "       COUNT(DISTINCT CAST(timestamp/86400 AS INTEGER)) AS days_active "
        "FROM transfers GROUP BY from_address"
    ).fetchall()
    # Pull facilitators per agent in one extra query.
    fac_map: dict[str, list[str]] = {}
    for fr in conn.execute(
        "SELECT from_address, facilitator FROM transfers "
        "GROUP BY from_address, facilitator ORDER BY from_address, facilitator"
    ):
        fac_map.setdefault(fr[0], []).append(fr[1])

    out = []
    for r in rows:
        stats = {
            "txns":         int(r["txns"]),
            "volume":       float(r["volume"]),
            "first_seen":   int(r["first_seen"]),
            "last_seen":    int(r["last_seen"]),
            "days_active":  int(r["days_active"]),
            "facilitators": fac_map.get(r["address"], []),
        }
        s = _compute_score_for_stats(stats, now)
        s["address"] = r["address"]
        out.append(s)
    return out


# IMPORTANT: declare the literal "/score/leaderboard" route BEFORE the
# parametric "/score/{address}" route — FastAPI dispatches in declaration
# order, and {address} would otherwise swallow "leaderboard" as a (bad)
# address and 400 every request.

@app.get("/score/leaderboard")
def score_leaderboard(
    limit: int = Query(20, ge=1, le=200),
    conn: sqlite3.Connection = Depends(get_db),
) -> list[dict]:
    """Top-scored agents, descending."""
    scores = _all_agent_scores(conn)
    scores.sort(key=lambda s: (s["score"], s["stats"]["total_volume_usdc"]), reverse=True)
    return scores[:limit]


@app.get("/score/{address}")
def agent_score(
    address: str = PathParam(..., description="Lowercase 0x-prefixed EVM address"),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict:
    """FICO-style 0-850 trust score for an agent."""
    if not ADDRESS_RE.match(address):
        raise HTTPException(status_code=400, detail="invalid address format")
    addr = address.lower()
    now = now_ts()

    stats = _agent_stats(conn, addr)
    if not stats:
        # Inactive agent — return a zero-score response rather than 404 so the
        # /score page can show a clean "no activity" state.
        return {
            "address":    addr,
            **_compute_score_for_stats({}, now),
            "percentile": 0.0,
        }

    body = _compute_score_for_stats(stats, now)
    body["address"] = addr

    # Percentile across the universe of active agents.
    all_scores = [s["score"] for s in _all_agent_scores(conn)]
    if all_scores:
        below = sum(1 for s in all_scores if s < body["score"])
        body["percentile"] = round(below / len(all_scores) * 100, 1)
    else:
        body["percentile"] = 0.0
    return body


# ------------------------------------------------------------------ /search

# Minimum query length. We allow shorter prefixes like the trailing 4 chars
# of an address, so 3 chars is the floor that still produces useful results.
SEARCH_MIN_LEN = 3
SEARCH_LIMIT = 20

# Reject anything that isn't a valid hex fragment (with optional 0x prefix)
# to keep the LIKE pattern clean. Parameter binding handles SQL safety.
SEARCH_RE = re.compile(r"^(?:0x)?[0-9a-fA-F]+$")


@app.get("/search")
def search(
    q: str = Query(..., min_length=1, max_length=42, description="Address fragment, 3+ chars"),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict:
    """
    Resolve a (full or partial) address against our DB.

    Returns the matching addresses, each classified as `agent` (appears as
    from_address), `seller` (appears as to_address), or `both`.
    """
    needle = q.strip().lower()
    if needle.startswith("0x"):
        needle = needle[2:]
    if len(needle) < SEARCH_MIN_LEN:
        return {"query": q, "matches": []}
    if not SEARCH_RE.match(needle):
        return {"query": q, "matches": []}

    like = f"%{needle}%"
    rows = conn.execute(
        """
        SELECT
            address,
            SUM(as_agent)  AS agent_txns,
            SUM(as_seller) AS seller_txns,
            SUM(agent_vol) AS agent_volume,
            SUM(seller_vol) AS seller_volume,
            MAX(last_seen) AS last_seen
        FROM (
            SELECT from_address AS address,
                   1 AS as_agent, 0 AS as_seller,
                   amount_usdc AS agent_vol, 0 AS seller_vol,
                   timestamp AS last_seen
            FROM transfers
            UNION ALL
            SELECT to_address   AS address,
                   0 AS as_agent, 1 AS as_seller,
                   0 AS agent_vol, amount_usdc AS seller_vol,
                   timestamp AS last_seen
            FROM transfers
        )
        WHERE address LIKE ?
        GROUP BY address
        ORDER BY (COALESCE(agent_txns,0) + COALESCE(seller_txns,0)) DESC
        LIMIT ?
        """,
        (like, SEARCH_LIMIT),
    ).fetchall()

    matches = []
    for r in rows:
        a = int(r["agent_txns"] or 0)
        s = int(r["seller_txns"] or 0)
        kind = "both" if a and s else ("agent" if a else "seller")
        matches.append({
            "address":       r["address"],
            "kind":          kind,
            "agent_txns":    a,
            "seller_txns":   s,
            "agent_volume":  float(r["agent_volume"] or 0),
            "seller_volume": float(r["seller_volume"] or 0),
            "last_seen":     int(r["last_seen"] or 0),
            "facilitator":   ADDRESS_TO_FACILITATOR.get(r["address"]),
        })
    return {"query": q, "matches": matches}

# ------------------------------------------------------------------ /seller/{address}

@app.get("/seller/{address}")
def seller_profile(
    address: str = PathParam(..., description="Lowercase 0x-prefixed EVM address"),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Mirror of /agent/{address} but for a facilitator-recipient address."""
    if not ADDRESS_RE.match(address):
        raise HTTPException(status_code=400, detail="invalid address format")
    addr = address.lower()

    summary = conn.execute(
        "SELECT COUNT(*) AS txns, "
        "       COALESCE(SUM(amount_usdc), 0) AS total, "
        "       MIN(timestamp) AS first_seen, "
        "       MAX(timestamp) AS last_seen "
        "FROM transfers WHERE to_address = ?",
        (addr,),
    ).fetchone()

    if not summary or not summary["txns"]:
        raise HTTPException(status_code=404, detail="seller not found")

    total = float(summary["total"])
    txns = int(summary["txns"])
    avg = total / txns if txns else 0.0

    # Hourly 24h (zero-filled), matches the agent endpoint shape.
    now = now_ts()
    day_ago = now - 86_400
    hour_rows = conn.execute(
        "SELECT (timestamp / 3600) * 3600 AS hour_ts, "
        "       SUM(amount_usdc) AS volume, COUNT(*) AS txns "
        "FROM transfers "
        "WHERE to_address = ? AND timestamp >= ? "
        "GROUP BY hour_ts",
        (addr, day_ago),
    ).fetchall()
    by_hour = {int(r["hour_ts"]): r for r in hour_rows}
    first_bucket = (now // 3600 - 23) * 3600
    hourly = []
    for i in range(24):
        ts = first_bucket + i * 3600
        r = by_hour.get(ts)
        hourly.append({
            "hour": ts,
            "volume": float(r["volume"]) if r else 0.0,
            "txns": int(r["txns"]) if r else 0,
        })

    # Top 5 payers all-time.
    top_payers = [
        {
            "address":      r["from_address"],
            "transactions": int(r["c"]),
            "volume_usdc":  float(r["v"]),
            "last_seen":    int(r["last_seen"]),
        }
        for r in conn.execute(
            "SELECT from_address, COUNT(*) AS c, SUM(amount_usdc) AS v, "
            "       MAX(timestamp) AS last_seen "
            "FROM transfers WHERE to_address = ? "
            "GROUP BY from_address ORDER BY v DESC LIMIT 5",
            (addr,),
        ).fetchall()
    ]

    # Last 10 incoming transactions.
    recent = [dict(r) for r in conn.execute(
        "SELECT tx_hash, block_number, timestamp, from_address, to_address, "
        "       amount_usdc, facilitator "
        "FROM transfers WHERE to_address = ? "
        "ORDER BY timestamp DESC, log_index DESC LIMIT 10",
        (addr,),
    ).fetchall()]

    first_seen_ts = int(summary["first_seen"])
    db_min = _db_min_timestamp(conn) or first_seen_ts
    first_seen_bounded = (first_seen_ts - db_min) <= BOUNDED_TOLERANCE_SECONDS

    return {
        "address":            addr,
        "facilitator":        ADDRESS_TO_FACILITATOR.get(addr),
        "total_earned_usdc":  total,
        "total_transactions": txns,
        "avg_payment_usdc":   avg,
        "first_seen":         first_seen_ts,
        "first_seen_bounded": first_seen_bounded,
        "last_seen":          int(summary["last_seen"]),
        "unique_payers":      len(top_payers),  # at least; capped by LIMIT
        "top_payers":         top_payers,
        "hourly_24h":         hourly,
        "recent_transactions": recent,
    }

# ------------------------------------------------------------------ /agents/new

@app.get("/agents/new")
def new_agents(conn: sqlite3.Connection = Depends(get_db)) -> list[dict]:
    """
    Agents whose first ever indexed payment landed in the last 24 hours,
    enriched with their first-tx details and what they've spent since.

    A "new agent" here means: across all of our history, the earliest
    timestamp for from_address falls inside [now - 24h, now].
    """
    now = now_ts()
    day_ago = now - 86_400

    # First, find agents whose MIN(timestamp) is within the last 24h.
    rows = conn.execute(
        """
        WITH per_agent AS (
            SELECT from_address,
                   MIN(timestamp)         AS first_seen,
                   COUNT(*)               AS tx_count_since,
                   SUM(amount_usdc)       AS total_spent_since
            FROM transfers
            GROUP BY from_address
            HAVING MIN(timestamp) >= ?
        )
        SELECT pa.from_address                          AS address,
               pa.first_seen,
               pa.tx_count_since,
               pa.total_spent_since,
               first_tx.amount_usdc                     AS first_amount_usdc,
               first_tx.facilitator                     AS first_facilitator
        FROM per_agent pa
        JOIN transfers first_tx
          ON first_tx.from_address = pa.from_address
         AND first_tx.timestamp    = pa.first_seen
        GROUP BY pa.from_address         -- collapse rare ties on same block
        ORDER BY pa.first_seen DESC
        """,
        (day_ago,),
    ).fetchall()
    return [
        {
            "address":           r["address"],
            "first_seen":        int(r["first_seen"]),
            "first_amount_usdc": float(r["first_amount_usdc"]),
            "first_facilitator": r["first_facilitator"],
            "total_spent_since": float(r["total_spent_since"]),
            "tx_count_since":    int(r["tx_count_since"]),
        }
        for r in rows
    ]

# ------------------------------------------------------------------ /facilitators/stats

@app.get("/facilitators/stats")
def facilitators_stats(conn: sqlite3.Connection = Depends(get_db)) -> list[dict]:
    """Per-facilitator KPIs: all-time totals, 24h volume + change, market share, active agents."""
    now = now_ts()
    d1 = now - 86_400
    d2 = now - 172_800

    rows = conn.execute(
        """
        SELECT
            facilitator,
            COUNT(*)                                           AS total_transactions,
            COALESCE(SUM(amount_usdc), 0)                      AS total_volume_usdc,
            COALESCE(AVG(amount_usdc), 0)                      AS avg_payment_usdc,
            COALESCE(SUM(CASE WHEN timestamp >= ? THEN amount_usdc END), 0)
                                                               AS volume_24h,
            COALESCE(SUM(CASE WHEN timestamp >= ? AND timestamp < ? THEN amount_usdc END), 0)
                                                               AS volume_prev_24h,
            COUNT(DISTINCT CASE WHEN timestamp >= ? THEN from_address END)
                                                               AS active_agents_24h
        FROM transfers
        GROUP BY facilitator
        """,
        (d1, d2, d1, d1),
    ).fetchall()

    total_volume_alltime = sum(r["total_volume_usdc"] for r in rows) or 1.0
    out = []
    for r in rows:
        vol_now = float(r["volume_24h"])
        vol_prev = float(r["volume_prev_24h"])
        if vol_prev > 0:
            change_pct = (vol_now - vol_prev) / vol_prev * 100.0
        elif vol_now > 0:
            change_pct = 100.0   # net-new activity, label as +100%
        else:
            change_pct = 0.0
        out.append({
            "name":               r["facilitator"],
            "total_volume_usdc":  float(r["total_volume_usdc"]),
            "total_transactions": int(r["total_transactions"]),
            "avg_payment_usdc":   float(r["avg_payment_usdc"]),
            "volume_24h":         vol_now,
            "volume_change_pct":  round(change_pct, 1),
            "market_share_pct":   round(r["total_volume_usdc"] / total_volume_alltime * 100, 2),
            "active_agents_24h":  int(r["active_agents_24h"]),
        })
    out.sort(key=lambda f: f["total_volume_usdc"], reverse=True)
    return out

# ------------------------------------------------------------------ /health-score

@app.get("/health-score")
def health_score(conn: sqlite3.Connection = Depends(get_db)) -> dict:
    now = now_ts()
    cur = _compute_health(conn, now)
    prev = _compute_health(conn, now - 86_400)
    return {
        "score":      round(cur["score"], 1),
        "label":      _label_for(cur["score"]),
        "change_24h": round(cur["score"] - prev["score"], 1),
        "components": cur["components"],
        "weights":    HEALTH_WEIGHTS,
        "as_of":      now,
    }

# ------------------------------------------------------------------ /agent/{address}

@app.get("/agent/{address}")
def agent_profile(
    address: str = PathParam(..., description="Lowercase 0x-prefixed EVM address"),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Full profile for a single payer: totals, 24h hourly series, facilitators, recent txns, tags."""
    if not ADDRESS_RE.match(address):
        raise HTTPException(status_code=400, detail="invalid address format")
    addr = address.lower()

    summary = conn.execute(
        "SELECT COUNT(*)              AS txns, "
        "       SUM(amount_usdc)      AS total, "
        "       MIN(timestamp)        AS first_seen, "
        "       MAX(timestamp)        AS last_seen "
        "FROM transfers WHERE from_address = ?",
        (addr,),
    ).fetchone()

    if not summary or not summary["txns"]:
        raise HTTPException(status_code=404, detail="agent not found")

    total = float(summary["total"] or 0)
    txns = int(summary["txns"])
    avg = total / txns if txns else 0.0

    # Facilitator breakdown.
    fac_rows = conn.execute(
        "SELECT facilitator, COUNT(*) AS txns, SUM(amount_usdc) AS volume "
        "FROM transfers WHERE from_address = ? "
        "GROUP BY facilitator ORDER BY volume DESC",
        (addr,),
    ).fetchall()
    facilitators = [
        {
            "name": r["facilitator"],
            "transactions": int(r["txns"]),
            "volume_usdc": float(r["volume"] or 0),
        }
        for r in fac_rows
    ]

    # Last-24h hourly buckets, zero-filled.
    now = now_ts()
    day_ago = now - 86_400
    hour_rows = conn.execute(
        "SELECT (timestamp / 3600) * 3600 AS hour_ts, "
        "       SUM(amount_usdc)          AS volume, "
        "       COUNT(*)                  AS txns "
        "FROM transfers "
        "WHERE from_address = ? AND timestamp >= ? "
        "GROUP BY hour_ts",
        (addr, day_ago),
    ).fetchall()
    by_hour = {int(r["hour_ts"]): r for r in hour_rows}

    first_bucket = (now // 3600 - 23) * 3600
    hourly = []
    for i in range(24):
        ts = first_bucket + i * 3600
        r = by_hour.get(ts)
        hourly.append({
            "hour": ts,
            "volume": float(r["volume"]) if r else 0.0,
            "txns": int(r["txns"]) if r else 0,
        })

    # Last 10 transactions (chronological newest-first).
    tx_rows = conn.execute(
        "SELECT tx_hash, block_number, timestamp, from_address, to_address, "
        "       amount_usdc, facilitator "
        "FROM transfers WHERE from_address = ? "
        "ORDER BY timestamp DESC, log_index DESC LIMIT 10",
        (addr,),
    ).fetchall()
    recent = [dict(r) for r in tx_rows]

    # Behavior tags — non-exclusive.
    max_txns_hour = conn.execute(
        "SELECT MAX(c) FROM ("
        "  SELECT COUNT(*) AS c FROM transfers "
        "  WHERE from_address = ? GROUP BY timestamp / 3600"
        ")",
        (addr,),
    ).fetchone()[0] or 0

    tags: list[str] = []
    if avg < TAG_MICRO_AVG_USDC:
        tags.append("Micro-payer")
    if total > TAG_POWER_TOTAL_USDC:
        tags.append("Power user")
    if int(max_txns_hour) > TAG_BATCH_TXNS_IN_HOUR:
        tags.append("Batch buyer")

    # Single primary tag per spec: take the most distinctive,
    # falling back to "Regular" when no rule fires. Priority order
    # is the same as the rule order (most-specific to least-specific).
    behavior_tag = tags[0] if tags else "Regular"

    favorite_facilitator = facilitators[0]["name"] if facilitators else None
    is_new = (int(summary["first_seen"]) >= now_ts() - 86_400)

    # Is this agent's first_seen pinned to the edge of our coverage window?
    # If so, they probably existed before we started indexing — the UI should
    # render the timestamp as "≥Nd ago" rather than implying it's accurate.
    first_seen_ts = int(summary["first_seen"])
    db_min = _db_min_timestamp(conn) or first_seen_ts
    first_seen_bounded = (first_seen_ts - db_min) <= BOUNDED_TOLERANCE_SECONDS

    return {
        "address": addr,
        # primary names per Feature 2 spec
        "total_spent_usdc": total,
        "total_transactions": txns,
        "first_seen": first_seen_ts,
        "first_seen_bounded": first_seen_bounded,
        "last_seen": int(summary["last_seen"]),
        "avg_payment_usdc": avg,
        "favorite_facilitator": favorite_facilitator,
        "behavior_tag": behavior_tag,
        "is_new": is_new,
        "hourly_24h": hourly,
        "facilitators": facilitators,
        "recent_transactions": recent,
        # legacy aliases kept so existing dashboard code keeps rendering
        "total_volume_usdc": total,
        "avg_transaction_usdc": avg,
        "max_txns_in_any_hour": int(max_txns_hour),
        "tags": tags,
    }
