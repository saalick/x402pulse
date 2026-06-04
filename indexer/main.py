"""
x402pulse indexer — watches USDC Transfer events on Base mainnet and
records the ones where the recipient is a known x402 facilitator.

Design:
  * Multi-RPC pool with priority-ordered fallback. Different pools for
    backfill (public RPCs first; Alchemy as a last-resort fallback) vs
    tail-follow (Alchemy first; public as fallback).
  * Each RPC endpoint declares its own `chunk_blocks` — the max range it
    accepts per `eth_getLogs` call. Alchemy free tier caps at 10 blocks;
    the public RPCs (mainnet.base.org, llamarpc, publicnode) accept 2000.
  * Filter happens server-side via the Transfer event's indexed `to`
    topic, batched in groups of MAX_TOPICS_PER_FILTER facilitator
    addresses per request (RPC providers cap the topic-OR list).
  * SQLite is used as the single store, shared with the API service.
    INSERT OR IGNORE on tx_hash + log_index handles re-orgs / overlap.

Run:
  BACKFILL_HOURS=720 \\
  ALCHEMY_BASE_URL=https://base-mainnet.g.alchemy.com/v2/<key> \\
  python indexer/main.py
"""

from __future__ import annotations

import logging
import os
import signal
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests as _requests
from dotenv import load_dotenv
from requests.exceptions import HTTPError
from web3 import Web3
from web3._utils.events import get_event_data
from web3.types import LogReceipt

# Support both `python indexer/main.py` (script-mode, runs with indexer/ on
# sys.path) and `from indexer.main import ...` (package-mode from project root).
try:
    from facilitators import ADDRESS_TO_FACILITATOR, FACILITATOR_ADDRESSES
except ImportError:  # pragma: no cover
    from indexer.facilitators import ADDRESS_TO_FACILITATOR, FACILITATOR_ADDRESSES

# ------------------------------------------------------------------ config

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "x402pulse.db")

# Base mainnet USDC (native, Circle-issued).
USDC_ADDRESS = Web3.to_checksum_address("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")
USDC_DECIMALS = 6

# ERC-20 Transfer(address indexed from, address indexed to, uint256 value)
TRANSFER_EVENT_ABI = {
    "anonymous": False,
    "inputs": [
        {"indexed": True, "name": "from", "type": "address"},
        {"indexed": True, "name": "to", "type": "address"},
        {"indexed": False, "name": "value", "type": "uint256"},
    ],
    "name": "Transfer",
    "type": "event",
}
TRANSFER_TOPIC = Web3.keccak(text="Transfer(address,address,uint256)").to_0x_hex()

# USDC EIP-3009 AuthorizationUsed(authorizer, nonce). Emitted by
# transferWithAuthorization / receiveWithAuthorization — the pass-through
# pattern used by Coinbase's CDP x402 facilitator. The relayer (facilitator)
# is the tx.from of the outer transaction, NOT a participant in the Transfer
# event, so we have to fetch tx.from per-tx to attribute the payment.
AUTH_USED_EVENT_ABI = {
    "anonymous": False,
    "inputs": [
        {"indexed": True, "name": "authorizer", "type": "address"},
        {"indexed": True, "name": "nonce", "type": "bytes32"},
    ],
    "name": "AuthorizationUsed",
    "type": "event",
}
AUTH_USED_TOPIC = Web3.keccak(text="AuthorizationUsed(address,bytes32)").to_0x_hex()

# Base mainnet produces a block roughly every 2 seconds.
BLOCKS_PER_HOUR = 1_800
BLOCKS_PER_DAY = 43_200

# Backfill window. Default 365 days — covers full x402 history (the protocol
# started mid-2025). Overridable via env (Railway/Fly/local) to test smaller
# runs. The backward-extension logic in main() will extend an existing
# smaller window up to whatever this is set to on the next restart.
BACKFILL_HOURS = float(os.getenv("BACKFILL_HOURS", str(365 * 24)))
BACKFILL_BLOCKS = int(BACKFILL_HOURS * BLOCKS_PER_HOUR)

# Most RPC providers cap the topic-OR list at ~50–100. 40 is comfortably
# inside every provider we use.
MAX_TOPICS_PER_FILTER = 40

# Tiny pacing delay between RPC calls during backfill so we don't get
# rate-limited by the public providers.
RPC_PACING_SECONDS = float(os.getenv("RPC_PACING_SECONDS", "0.05"))

POLL_INTERVAL = int(os.getenv("POLL_INTERVAL_SECONDS", "12"))

# Forward backfill is what makes the site "alive" — set BACKFILL_HOURS
# to whatever you want covered before the tail starts. With both event
# paths enabled, ~10h of compute per 30 days of blocks is typical.
#
# Backward extension runs LATER, in a background thread, so the
# real-time tail keeps running while older history fills in silently.
# Toggle with EXTEND_BACKWARD; set the target depth with
# EXTEND_BACKWARD_HOURS (defaults to BACKFILL_HOURS — set it higher to
# extend beyond the initial window).
EXTEND_BACKWARD = os.getenv("EXTEND_BACKWARD", "false").lower() == "true"
EXTEND_BACKWARD_HOURS = float(os.getenv("EXTEND_BACKWARD_HOURS", str(BACKFILL_HOURS)))
EXTEND_BACKWARD_BLOCKS = int(EXTEND_BACKWARD_HOURS * BLOCKS_PER_HOUR)

CHAIN_NAME = "base"
CHAIN_ID = 8453

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("indexer")

# ------------------------------------------------------------------ RPC pool

@dataclass(frozen=True)
class RpcEndpoint:
    """One reachable Base mainnet RPC, with its per-request block cap."""
    name: str
    url: str
    chunk_blocks: int


# Public RPCs in our preferred order. All three accept large (2000-block)
# eth_getLogs ranges and require no API key.
PUBLIC_RPCS: list[RpcEndpoint] = [
    RpcEndpoint("base-public", "https://mainnet.base.org",         2000),
    RpcEndpoint("llamarpc",    "https://base.llamarpc.com",        2000),
    RpcEndpoint("publicnode",  "https://base-rpc.publicnode.com",  2000),
]


def _alchemy_endpoint() -> Optional[RpcEndpoint]:
    """Build the Alchemy endpoint from env, or return None if unconfigured."""
    url = os.getenv("ALCHEMY_BASE_URL")
    if not url:
        return None
    # Alchemy's free tier caps eth_getLogs at 10 blocks. PAYG users can
    # bump this via ALCHEMY_CHUNK_BLOCKS.
    chunk = int(os.getenv("ALCHEMY_CHUNK_BLOCKS", "10"))
    return RpcEndpoint("alchemy", url, chunk)


def backfill_endpoints() -> list[RpcEndpoint]:
    """Public RPCs first (big chunks, no rate limits); Alchemy as last-resort."""
    pool = list(PUBLIC_RPCS)
    alc = _alchemy_endpoint()
    if alc:
        pool.append(alc)
    return pool


def tail_endpoints() -> list[RpcEndpoint]:
    """Alchemy first (low latency for small requests); public as fallback."""
    alc = _alchemy_endpoint()
    return ([alc] if alc else []) + list(PUBLIC_RPCS)


W3Pool = list[tuple[RpcEndpoint, Web3]]


def make_web3(ep: RpcEndpoint) -> Web3:
    return Web3(Web3.HTTPProvider(ep.url, request_kwargs={"timeout": 30}))


def build_pool(endpoints: list[RpcEndpoint]) -> W3Pool:
    """Connect to each endpoint; keep the ones on Base mainnet."""
    pool: W3Pool = []
    for ep in endpoints:
        try:
            w3 = make_web3(ep)
            if not w3.is_connected():
                raise RuntimeError("not connected")
            cid = w3.eth.chain_id
            if cid != CHAIN_ID:
                raise RuntimeError(f"wrong chain id {cid}")
            pool.append((ep, w3))
            log.info(
                "  ✓ RPC %-12s chunk=%d  url=%s",
                ep.name, ep.chunk_blocks, _redact(ep.url),
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("  ✗ RPC %-12s unreachable: %s", ep.name, exc)
    if not pool:
        log.error("No working RPC endpoints. Configure ALCHEMY_BASE_URL "
                  "or make sure the public RPCs are reachable.")
        sys.exit(1)
    return pool


def _redact(url: str) -> str:
    """Strip the secret tail of an Alchemy URL so it stays out of logs."""
    if "/v2/" in url:
        head, _, _ = url.partition("/v2/")
        return head + "/v2/<redacted>"
    return url

# ------------------------------------------------------------------ db

SCHEMA = """
CREATE TABLE IF NOT EXISTS transfers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash       TEXT    NOT NULL,
    log_index     INTEGER NOT NULL,
    block_number  INTEGER NOT NULL,
    timestamp     INTEGER NOT NULL,           -- unix seconds
    from_address  TEXT    NOT NULL,
    to_address    TEXT    NOT NULL,
    amount_usdc   REAL    NOT NULL,           -- human units, 6dp precision
    chain         TEXT    NOT NULL DEFAULT 'base',
    facilitator   TEXT    NOT NULL,
    UNIQUE (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_transfers_ts          ON transfers(timestamp);
CREATE INDEX IF NOT EXISTS idx_transfers_from        ON transfers(from_address);
CREATE INDEX IF NOT EXISTS idx_transfers_to          ON transfers(to_address);
CREATE INDEX IF NOT EXISTS idx_transfers_block       ON transfers(block_number);
CREATE INDEX IF NOT EXISTS idx_transfers_facilitator ON transfers(facilitator);

CREATE TABLE IF NOT EXISTS indexer_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DATABASE_URL, isolation_level=None)  # autocommit
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


SCHEMA_VERSION = "2"  # bump → run migrate()


def migrate(conn: sqlite3.Connection) -> None:
    """One-time upgrades that need to run before the indexer starts.

    v1 → v2: AuthorizationUsed (EIP-3009 pass-through) path is now active.
      - Deletes existing self-transfer rows (Polymer-style $0.10 noise where
        from == to) — the new insert path filters these out at write time,
        this cleans what already landed.

      State checkpoints are intentionally NOT reset:
        * Forward catchup continues from current last_indexed_block with the
          combined process_chunk, so new pass-through txns flow immediately.
        * Backward extension is opt-in via EXTEND_BACKWARD — historical
          pass-through fills lazily, behind the real-time tail.
    """
    current = get_state(conn, "schema_version") or "1"
    if current == SCHEMA_VERSION:
        return

    log.info("Migrating indexer state %s → %s …", current, SCHEMA_VERSION)
    if current == "1":
        deleted = conn.execute(
            "DELETE FROM transfers WHERE from_address = to_address"
        ).rowcount
        log.info("  cleaned %s self-transfer rows", deleted)

    set_state(conn, "schema_version", SCHEMA_VERSION)
    log.info("Migration to v%s complete.", SCHEMA_VERSION)


def get_state(conn: sqlite3.Connection, key: str) -> Optional[str]:
    row = conn.execute("SELECT value FROM indexer_state WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def set_state(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO indexer_state(key, value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )

# ------------------------------------------------------------------ chain helpers

def address_to_topic(addr: str) -> str:
    """Left-pad an address to 32 bytes for use as an indexed log topic."""
    return "0x" + addr.lower().replace("0x", "").rjust(64, "0")


def chunked(seq: list, size: int):
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def _extract_http_body(exc: BaseException) -> str:
    """Pull the JSON-RPC error body out of an HTTPError if present."""
    if isinstance(exc, HTTPError) and exc.response is not None:
        try:
            return exc.response.text or ""
        except Exception:  # noqa: BLE001
            return ""
    return ""


def get_head_block(pool: W3Pool) -> int:
    """Highest block number, with RPC fallback."""
    last_exc: Optional[Exception] = None
    for ep, w3 in pool:
        try:
            return w3.eth.block_number
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            log.warning("head-block via %s failed: %s", ep.name, exc)
    raise last_exc or RuntimeError("no RPC could return head block")


def get_block_timestamp(pool: W3Pool, block_number: int) -> int:
    """Block timestamp, with RPC fallback. Used as fallback when batching fails."""
    last_exc: Optional[Exception] = None
    for ep, w3 in pool:
        try:
            return int(w3.eth.get_block(block_number)["timestamp"])
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
    raise last_exc or RuntimeError(f"no RPC could return block {block_number}")


# Max blocks per JSON-RPC batch. mainnet.base.org accepts very large batches;
# we cap at 100 to keep response sizes small and avoid hitting other RPCs'
# batch-size limits on fallback.
BATCH_BLOCKS_LIMIT = 100


def get_block_timestamps_batch(
    pool: W3Pool, block_numbers: list[int],
) -> dict[int, int]:
    """Fetch many block timestamps in one batched JSON-RPC request.

    This is the single biggest backfill speedup — instead of one HTTP round-
    trip per unique block, we batch up to BATCH_BLOCKS_LIMIT lookups into a
    single request. Each RPC in the pool gets a chance before we fall back
    to per-block lookups.
    """
    if not block_numbers:
        return {}
    uniq = sorted(set(block_numbers))

    # Split into batches of BATCH_BLOCKS_LIMIT.
    out: dict[int, int] = {}
    for i in range(0, len(uniq), BATCH_BLOCKS_LIMIT):
        chunk = uniq[i : i + BATCH_BLOCKS_LIMIT]
        out.update(_batch_block_ts_one(pool, chunk))
    return out


def _batch_block_ts_one(pool: W3Pool, blocks: list[int]) -> dict[int, int]:
    """Batch eth_getBlockByNumber via the shared _batched_jsonrpc path."""
    params_list = [[hex(b), False] for b in blocks]
    try:
        results = _batched_jsonrpc(pool, "eth_getBlockByNumber", params_list,
                                   batch_size=len(blocks) + 1)  # one batch
    except Exception as exc:  # noqa: BLE001
        log.warning("Batch block lookup failed (%d blocks): %s — falling back to per-block",
                    len(blocks), exc)
        return {b: get_block_timestamp(pool, b) for b in blocks}

    out: dict[int, int] = {}
    for b, r in zip(blocks, results):
        if not r or "timestamp" not in r:
            out[b] = get_block_timestamp(pool, b)  # defensive fallback
        else:
            out[b] = int(r["timestamp"], 16)
    return out

# ------------------------------------------------------------------ getLogs

def _do_get_logs(
    w3: Web3, from_block: int, to_block: int, topics: list,
) -> list[LogReceipt]:
    """Raw eth_getLogs against the USDC contract with caller-supplied topics."""
    params = {
        "fromBlock": from_block,
        "toBlock":   to_block,
        "address":   USDC_ADDRESS,
        "topics":    topics,
    }
    return w3.eth.get_logs(params)


def _fetch_logs_with_fallback(
    pool: W3Pool, from_block: int, to_block: int, topics: list,
) -> list[LogReceipt]:
    """eth_getLogs across the pool with per-endpoint sub-chunking on range overflow."""
    last_exc: Optional[Exception] = None
    range_size = to_block - from_block + 1

    for ep, w3 in pool:
        try:
            if range_size > ep.chunk_blocks:
                results: list[LogReceipt] = []
                cur = from_block
                while cur <= to_block:
                    end = min(cur + ep.chunk_blocks - 1, to_block)
                    results.extend(_do_get_logs(w3, cur, end, topics))
                    cur = end + 1
                    if RPC_PACING_SECONDS:
                        time.sleep(RPC_PACING_SECONDS)
                return results
            return _do_get_logs(w3, from_block, to_block, topics)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            body = _extract_http_body(exc)
            log.warning(
                "RPC %s failed for blocks %s-%s (%s): %s",
                ep.name, from_block, to_block, exc.__class__.__name__,
                (body[:200] if body else str(exc))[:200],
            )
            continue

    raise last_exc or RuntimeError(
        f"all RPC endpoints failed for blocks {from_block}-{to_block}"
    )


def fetch_transfer_logs(pool: W3Pool, from_block: int, to_block: int) -> list[LogReceipt]:
    """USDC Transfer logs whose `to` is a tracked facilitator (custodial pattern)."""
    to_topics = [address_to_topic(a) for a in sorted(FACILITATOR_ADDRESSES)]
    results: list[LogReceipt] = []
    for topic_batch in chunked(to_topics, MAX_TOPICS_PER_FILTER):
        results.extend(_fetch_logs_with_fallback(
            pool, from_block, to_block,
            topics=[TRANSFER_TOPIC, None, topic_batch],
        ))
    return results


def fetch_authused_logs(pool: W3Pool, from_block: int, to_block: int) -> list[LogReceipt]:
    """All USDC AuthorizationUsed events in [from_block, to_block].

    These fire on every transferWithAuthorization / receiveWithAuthorization
    call (EIP-3009). We can't pre-filter to facilitators because the
    relayer/facilitator isn't a participant in the event — they're tx.from
    of the outer transaction. The post-filter happens via a follow-up
    eth_getTransactionByHash batch.
    """
    return _fetch_logs_with_fallback(
        pool, from_block, to_block,
        topics=[AUTH_USED_TOPIC],
    )


# ------------------------------------------------------------------ batched JSON-RPC

# Per-method tuning. Slow methods (getTx, getReceipt) go straight to
# Alchemy — publicnode rate-limits these (429s) so falling back wastes a
# roundtrip. getBlockByNumber stays on the default fallback chain.
#
# Empirical Alchemy free-tier limits (probed Jun 2026):
#   batch_size 100  ✓  no errors
#   batch_size 200  ✓  no errors (when sent serially)
#   batch_size 500  ✗  ~76% of entries return CUPS errors
# Concurrency × batch_size is the multiplier. With free tier's ~330 CUPS,
# even concurrency=2 × 100 overruns when retries pile up. Sequential
# (concurrency=1) gives predictable throughput without 429-thrash.
# On Alchemy Growth or Scale, bump ALCHEMY_BATCH_SIZE=500 and
# RPC_BATCH_CONCURRENCY=4 for ~5-10× more throughput.
RPC_CONCURRENCY = int(os.getenv("RPC_BATCH_CONCURRENCY", "1"))

METHOD_HINTS: dict[str, dict] = {
    "eth_getTransactionByHash": {
        "batch_size": int(os.getenv("ALCHEMY_BATCH_SIZE", "100")),
        "preferred_endpoints": ("alchemy",),
    },
    "eth_getTransactionReceipt": {
        "batch_size": int(os.getenv("ALCHEMY_BATCH_SIZE", "100")),
        "preferred_endpoints": ("alchemy",),
    },
    "eth_getBlockByNumber": {
        "batch_size": BATCH_BLOCKS_LIMIT,
        "preferred_endpoints": None,
    },
}


def _select_pool_for_method(pool: W3Pool, method: str) -> W3Pool:
    """Return pool members preferred for this method, falling back to the
    whole pool if no preferred endpoints are reachable."""
    preferred = METHOD_HINTS.get(method, {}).get("preferred_endpoints")
    if not preferred:
        return pool
    filtered = [(ep, w3) for ep, w3 in pool if ep.name in preferred]
    return filtered or pool


def _batched_jsonrpc(
    pool: W3Pool, method: str, params_list: list[list], batch_size: Optional[int] = None,
) -> list:
    """Batched JSON-RPC with per-method tuning and within-chunk parallelism.

    Returns results in the same order as `params_list`. Chunks at the
    method's `batch_size` (defaults to METHOD_HINTS), then fires up to
    RPC_CONCURRENCY batches concurrently over a ThreadPoolExecutor.
    Each batch goes to the method's preferred endpoint first.
    """
    if not params_list:
        return []

    hint = METHOD_HINTS.get(method, {})
    if batch_size is None:
        batch_size = hint.get("batch_size", BATCH_BLOCKS_LIMIT)
    use_pool = _select_pool_for_method(pool, method)

    chunks = [params_list[i : i + batch_size] for i in range(0, len(params_list), batch_size)]
    if len(chunks) == 1:
        return _batched_jsonrpc_one(use_pool, method, chunks[0])

    # Fire chunks in parallel; preserve input order in the output.
    workers = min(RPC_CONCURRENCY, len(chunks))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        results = list(ex.map(lambda c: _batched_jsonrpc_one(use_pool, method, c), chunks))
    return [item for sublist in results for item in sublist]


# Cache of (endpoint_name, method) pairs that have responded with an
# unsupported-batch shape. mainnet.base.org, for instance, doesn't honour
# batched eth_getTransactionByHash / eth_getTransactionReceipt — we discover
# this once per session, then skip those endpoints for those methods so we
# don't spam the logs every chunk.
_BAD_BATCH_PAIRS: set[tuple[str, str]] = set()


class _TokenBucket:
    """Simple per-second token bucket. Used to throttle Alchemy calls to
    stay under its CUPS ceiling. consume(n) blocks until n tokens are
    available, then deducts them. Refills smoothly at `rate` tokens/sec.
    Thread-safe — the lock protects refill + decrement against the
    backward-extension thread firing in parallel with tail follow.
    """

    def __init__(self, rate_per_sec: float, burst: Optional[float] = None) -> None:
        self.rate = rate_per_sec
        self.cap = burst if burst is not None else rate_per_sec
        self.tokens = self.cap
        self.last = time.time()
        self.lock = threading.Lock()

    def consume(self, n: float) -> None:
        with self.lock:
            now = time.time()
            elapsed = now - self.last
            self.tokens = min(self.cap, self.tokens + elapsed * self.rate)
            self.last = now
            if self.tokens >= n:
                self.tokens -= n
                return
            need = n - self.tokens
            self.tokens = 0
            wait = need / self.rate
        time.sleep(wait)


# Throttle Alchemy calls to stay under its CUPS / monthly-CU ceiling.
# Free tier: ~330 CUPS sustained + 100M CU/mo total. getTx=17 CU, getReceipt=15 CU.
# Default 8 calls/sec ≈ 130 CUPS sustained ≈ ~330M CU/mo (under cap if not 24/7).
# On Growth/Scale, bump ALCHEMY_CALL_RATE to 50+ for ~6× throughput.
_ALCHEMY_CALL_RATE = float(os.getenv("ALCHEMY_CALL_RATE", "8"))
_alchemy_bucket = _TokenBucket(_ALCHEMY_CALL_RATE, burst=_ALCHEMY_CALL_RATE * 2)


def _batched_jsonrpc_one(pool: W3Pool, method: str, params_list: list[list]) -> list:
    """Send one HTTP batch. Auto-retries per-entry errors (rate limits) up
    to 3 times with backoff before returning Nones.

    Free-tier RPCs sometimes return per-entry errors inside an otherwise-
    healthy batch when CU/sec is exceeded — Alchemy is the main offender.
    We collect the failed entries and retry just those, halving batch
    size each round so the retry fits under the throttle.
    """
    return _batched_jsonrpc_with_retry(pool, method, params_list, attempt=0)


def _batched_jsonrpc_with_retry(
    pool: W3Pool, method: str, params_list: list[list],
    attempt: int, max_attempts: int = 3,
) -> list:
    payload = [
        {"jsonrpc": "2.0", "id": idx, "method": method, "params": params}
        for idx, params in enumerate(params_list)
    ]
    last_exc: Optional[Exception] = None
    for ep, _ in pool:
        if (ep.name, method) in _BAD_BATCH_PAIRS:
            continue
        try:
            # Throttle Alchemy specifically — its CUPS ceiling is what
            # rate-limits us, the other RPCs use rougher per-second caps
            # that publicnode already handles via 429 fallback.
            if ep.name == "alchemy":
                _alchemy_bucket.consume(len(params_list))
            r = _requests.post(ep.url, json=payload, timeout=60)
            r.raise_for_status()
            arr = r.json()
            if not isinstance(arr, list) or len(arr) != len(params_list):
                _BAD_BATCH_PAIRS.add((ep.name, method))
                log.info(
                    "RPC %s doesn't honour batched %s — skipping for the rest of session",
                    ep.name, method,
                )
                continue
            # Sort responses by id so they align with input order.
            arr.sort(key=lambda x: x.get("id", 0))

            results: list = [None] * len(params_list)
            failed_indices: list[int] = []
            for i, resp in enumerate(arr):
                if "error" in resp and resp["error"]:
                    failed_indices.append(i)
                else:
                    results[i] = resp.get("result")

            if failed_indices and attempt < max_attempts:
                # Back off, halve batch size, and retry just the failed entries.
                # The halving is critical: most per-entry errors are Alchemy
                # CUPS overrun, which clears when we throw a smaller batch.
                backoff = 1.0 * (2 ** attempt)  # 1s, 2s, 4s
                time.sleep(backoff)
                log.debug(
                    "JSON-RPC %s via %s: %d/%d entries errored — retry %d "
                    "with halved batch (sleep %.1fs)",
                    method, ep.name, len(failed_indices), len(params_list),
                    attempt + 1, backoff,
                )
                retry_params = [params_list[i] for i in failed_indices]
                # Halve batch — split into two sequential calls if needed.
                half = max(1, len(retry_params) // 2)
                retry_results: list = []
                for j in range(0, len(retry_params), half):
                    retry_results.extend(_batched_jsonrpc_with_retry(
                        pool, method, retry_params[j : j + half],
                        attempt + 1, max_attempts,
                    ))
                for i, rr in zip(failed_indices, retry_results):
                    results[i] = rr
            elif failed_indices:
                # Out of retries — log once at warning level.
                log.warning(
                    "JSON-RPC %s: %d/%d entries unresolved after %d retries",
                    method, len(failed_indices), len(params_list), max_attempts,
                )

            return results
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            log.warning(
                "JSON-RPC batch %s via %s failed (%d items): %s",
                method, ep.name, len(params_list), exc,
            )
            continue
    raise last_exc or RuntimeError(
        f"all RPC endpoints failed for {method} batch of {len(params_list)}"
    )


def get_tx_senders_batch(pool: W3Pool, tx_hashes: list[str]) -> dict[str, Optional[str]]:
    """tx_hash → lowercase tx.from. Missing entries indicate the lookup failed."""
    if not tx_hashes:
        return {}
    uniq = list({h for h in tx_hashes})
    params_list = [[h] for h in uniq]
    results = _batched_jsonrpc(pool, "eth_getTransactionByHash", params_list)
    out: dict[str, Optional[str]] = {}
    for h, r in zip(uniq, results):
        if r and isinstance(r, dict) and r.get("from"):
            out[h] = r["from"].lower()
        else:
            out[h] = None
    return out


def get_tx_receipts_batch(pool: W3Pool, tx_hashes: list[str]) -> dict[str, Optional[dict]]:
    """tx_hash → receipt dict (with .logs)."""
    if not tx_hashes:
        return {}
    uniq = list({h for h in tx_hashes})
    params_list = [[h] for h in uniq]
    results = _batched_jsonrpc(pool, "eth_getTransactionReceipt", params_list)
    return {h: (r if isinstance(r, dict) else None) for h, r in zip(uniq, results)}

# ------------------------------------------------------------------ decode + insert

def _insert_row(
    conn: sqlite3.Connection,
    *,
    tx_hash: str, log_index: int, block: int, ts: int,
    from_addr: str, to_addr: str, amount: float, facilitator: str,
) -> int:
    """Insert one transfer row, returning 1 if it was new, 0 if a duplicate."""
    cur = conn.execute(
        "INSERT OR IGNORE INTO transfers "
        "(tx_hash, log_index, block_number, timestamp, from_address, "
        " to_address, amount_usdc, chain, facilitator) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (tx_hash, log_index, block, ts, from_addr, to_addr, amount,
         CHAIN_NAME, facilitator),
    )
    return cur.rowcount or 0


def decode_and_insert_transfers(
    conn: sqlite3.Connection,
    pool: W3Pool,
    logs: list[LogReceipt],
) -> int:
    """Custodial-facilitator path: Transfer(buyer → facilitator).

    Skips self-transfers (from == to) — facilitators paying themselves are
    bookkeeping noise (e.g. Polymer's $0.10 heartbeat) and not real x402
    payments.
    """
    if not logs:
        return 0

    codec = pool[0][1].codec
    decoded_rows: list[dict] = []
    needed_blocks: set[int] = set()
    skipped_self = 0

    for raw in logs:
        decoded = get_event_data(codec, TRANSFER_EVENT_ABI, raw)
        to_addr = decoded["args"]["to"].lower()
        if to_addr not in FACILITATOR_ADDRESSES:
            continue  # Defensive: topic batching should already filter.
        from_addr = decoded["args"]["from"].lower()
        if from_addr == to_addr:
            skipped_self += 1
            continue
        decoded_rows.append({
            "tx_hash":   decoded["transactionHash"].to_0x_hex(),
            "log_index": decoded["logIndex"],
            "block":     decoded["blockNumber"],
            "from_addr": from_addr,
            "to_addr":   to_addr,
            "amount":    decoded["args"]["value"] / (10**USDC_DECIMALS),
        })
        needed_blocks.add(decoded["blockNumber"])

    if not decoded_rows:
        return 0

    block_ts = get_block_timestamps_batch(pool, list(needed_blocks))
    inserted = 0
    for r in decoded_rows:
        ts = block_ts.get(r["block"]) or get_block_timestamp(pool, r["block"])
        facilitator = ADDRESS_TO_FACILITATOR.get(r["to_addr"], "unknown")
        inserted += _insert_row(
            conn, tx_hash=r["tx_hash"], log_index=r["log_index"], block=r["block"],
            ts=ts, from_addr=r["from_addr"], to_addr=r["to_addr"],
            amount=r["amount"], facilitator=facilitator,
        )
    return inserted


def _hex_to_int(v) -> int:
    """Coerce a JSON-RPC numeric field (may be hex string or int) to int."""
    if isinstance(v, int):
        return v
    if isinstance(v, str):
        return int(v, 16)
    raise TypeError(f"can't coerce {type(v).__name__} to int")


def _topic_to_address(topic: str) -> str:
    """Decode a 32-byte indexed-address topic to a 0x… lowercase address."""
    return "0x" + topic.lower().lstrip("0x").rjust(64, "0")[-40:]


def decode_and_insert_authused(
    conn: sqlite3.Connection,
    pool: W3Pool,
    auth_logs: list[LogReceipt],
) -> int:
    """EIP-3009 pass-through path.

    For each AuthorizationUsed event:
      1. Look up tx.from (the relayer/facilitator) via batched
         eth_getTransactionByHash.
      2. Keep only txs whose sender is in our facilitator set.
      3. Fetch each such tx's receipt to find the paired Transfer log
         (transferWithAuthorization always emits exactly one).
      4. Insert the Transfer with facilitator = ADDRESS_TO_FACILITATOR[tx.from].

    Skips self-transfers as in the custodial path.
    """
    if not auth_logs:
        return 0

    # Step 1: unique tx_hashes that had an AuthorizationUsed event.
    tx_hashes: set[str] = set()
    for raw in auth_logs:
        h = raw["transactionHash"]
        if hasattr(h, "to_0x_hex"):
            h = h.to_0x_hex()
        elif isinstance(h, (bytes, bytearray)):
            h = "0x" + h.hex()
        tx_hashes.add(h)

    if not tx_hashes:
        return 0

    # Step 2: batched tx.from lookups.
    senders = get_tx_senders_batch(pool, list(tx_hashes))
    facilitator_tx_hashes = [
        h for h, sender in senders.items()
        if sender and sender in FACILITATOR_ADDRESSES
    ]
    if not facilitator_tx_hashes:
        return 0

    # Step 3: batched receipt lookups for those facilitator-originated txs.
    receipts = get_tx_receipts_batch(pool, facilitator_tx_hashes)

    # Step 4: extract Transfer logs from each receipt and queue rows.
    decoded_rows: list[dict] = []
    needed_blocks: set[int] = set()
    transfer_topic_lower = TRANSFER_TOPIC.lower()
    usdc_addr_lower = USDC_ADDRESS.lower()

    for tx_hash in facilitator_tx_hashes:
        receipt = receipts.get(tx_hash)
        if not receipt:
            continue
        facilitator = ADDRESS_TO_FACILITATOR.get(senders[tx_hash], "unknown")
        for entry in receipt.get("logs", []):
            try:
                if entry["address"].lower() != usdc_addr_lower:
                    continue
                topics = entry.get("topics") or []
                if len(topics) < 3 or topics[0].lower() != transfer_topic_lower:
                    continue
                from_addr = _topic_to_address(topics[1])
                to_addr   = _topic_to_address(topics[2])
                if from_addr == to_addr:
                    continue
                value = int(entry["data"], 16) / (10**USDC_DECIMALS)
                log_index = _hex_to_int(entry["logIndex"])
                block_num = _hex_to_int(entry["blockNumber"])
            except Exception as exc:  # noqa: BLE001
                log.warning("AuthUsed: failed to decode log in %s: %s", tx_hash, exc)
                continue

            decoded_rows.append({
                "tx_hash":     tx_hash,
                "log_index":   log_index,
                "block":       block_num,
                "from_addr":   from_addr,
                "to_addr":     to_addr,
                "amount":      value,
                "facilitator": facilitator,
            })
            needed_blocks.add(block_num)

    if not decoded_rows:
        return 0

    block_ts = get_block_timestamps_batch(pool, list(needed_blocks))
    inserted = 0
    for r in decoded_rows:
        ts = block_ts.get(r["block"]) or get_block_timestamp(pool, r["block"])
        inserted += _insert_row(
            conn, tx_hash=r["tx_hash"], log_index=r["log_index"], block=r["block"],
            ts=ts, from_addr=r["from_addr"], to_addr=r["to_addr"],
            amount=r["amount"], facilitator=r["facilitator"],
        )
    return inserted


def process_chunk(
    conn: sqlite3.Connection, pool: W3Pool, from_block: int, to_block: int,
) -> tuple[int, int]:
    """Run both indexing paths over one [from_block, to_block] chunk.

    The custodial Transfer path is mandatory; the AuthUsed pass-through
    path is isolated in a try/except so an RPC rate-limit storm can't
    block forward progress. Skipped pass-through coverage gets picked up
    again when the tail re-processes incoming blocks (and is not lost
    permanently — the UNIQUE constraint dedupes against any later refill).

    Returns (transfers_inserted, authused_inserted).
    """
    transfer_logs = fetch_transfer_logs(pool, from_block, to_block)
    n_t = decode_and_insert_transfers(conn, pool, transfer_logs)

    n_a = 0
    try:
        auth_logs = fetch_authused_logs(pool, from_block, to_block)
        n_a = decode_and_insert_authused(conn, pool, auth_logs)
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "[pass-through] chunk %s-%s skipped (%s): %s",
            from_block, to_block, exc.__class__.__name__, str(exc)[:120],
        )

    return n_t, n_a

# ------------------------------------------------------------------ runtime

_stop = False


def _handle_signal(signum, _frame):
    global _stop
    log.info("Received signal %s — shutting down after current cycle.", signum)
    _stop = True


def backfill(pool: W3Pool, conn: sqlite3.Connection, start_block: int, head: int) -> None:
    chunk = pool[0][0].chunk_blocks
    log.info(
        "Backfilling %s → %s (%s blocks, chunk=%s via %s)",
        start_block, head, head - start_block, chunk, pool[0][0].name,
    )
    cursor = start_block
    total_t = 0
    total_a = 0
    last_progress_log = time.time()

    while cursor <= head and not _stop:
        chunk_end = min(cursor + chunk - 1, head)
        n_t, n_a = process_chunk(conn, pool, cursor, chunk_end)
        total_t += n_t
        total_a += n_a
        if n_t or n_a:
            log.info(
                "  blocks %s-%s: +%s custodial, +%s pass-through (total: %s+%s)",
                cursor, chunk_end, n_t, n_a, total_t, total_a,
            )
        set_state(conn, "last_indexed_block", str(chunk_end))
        cursor = chunk_end + 1

        now = time.time()
        if now - last_progress_log > 15:
            done = cursor - start_block
            need = head - start_block
            pct = done * 100 / max(need, 1)
            log.info(
                "  ... progress %s/%s (%.1f%%), inserted %s custodial + %s pass-through",
                done, need, pct, total_t, total_a,
            )
            last_progress_log = now

    log.info("Backfill complete. %s custodial + %s pass-through transfers.", total_t, total_a)


def backfill_extend_backward(
    pool: W3Pool,
    conn: sqlite3.Connection,
    desired_low: int,
    current_low: int,
) -> None:
    """Extend the indexed window BACKWARDS from current_low down to desired_low.

    Resumable: state key `backward_extended_to_block` stores the lowest block
    we've reached. On restart, the loop picks up from there instead of redoing
    work. INSERT OR IGNORE on the schema also guarantees idempotency.
    """
    chunk = pool[0][0].chunk_blocks

    # Resume point: prefer the existing state value if it's already lower
    # than current_low (we've made some progress in a previous run).
    resumed = get_state(conn, "backward_extended_to_block")
    if resumed:
        resumed_int = int(resumed)
        if resumed_int < current_low:
            current_low = resumed_int

    if desired_low >= current_low:
        log.info("Backward extension: already at desired low %s.", desired_low)
        return

    span = current_low - desired_low
    log.info(
        "Backward extension: %s ← %s (%s blocks, chunk=%s via %s)",
        desired_low, current_low - 1, span, chunk, pool[0][0].name,
    )

    # Iterate OLDEST → newest in chunk-sized steps. After each chunk, update
    # state so a kill mid-extension resumes correctly.
    cursor = desired_low
    total_t = 0
    total_a = 0
    last_progress_log = time.time()
    upper = current_low - 1   # inclusive

    while cursor <= upper and not _stop:
        chunk_end = min(cursor + chunk - 1, upper)
        n_t, n_a = process_chunk(conn, pool, cursor, chunk_end)
        total_t += n_t
        total_a += n_a
        if n_t or n_a:
            log.info(
                "  ← blocks %s-%s: +%s custodial, +%s pass-through (total: %s+%s)",
                cursor, chunk_end, n_t, n_a, total_t, total_a,
            )
        # Track the LOWEST block we've covered so far.
        set_state(conn, "backward_extended_to_block", str(cursor))
        cursor = chunk_end + 1

        now = time.time()
        if now - last_progress_log > 15:
            done = cursor - desired_low
            pct = done * 100 / max(span, 1)
            log.info(
                "  ← progress %s/%s (%.1f%%), inserted %s custodial + %s pass-through",
                done, span, pct, total_t, total_a,
            )
            last_progress_log = now

    log.info("Backward extension complete. %s custodial + %s pass-through transfers.", total_t, total_a)


def _open_thread_conn() -> sqlite3.Connection:
    """Open a fresh SQLite connection for use on a background thread.

    SQLite in WAL mode allows multiple connections from different threads
    to read and write concurrently — writes are serialized internally —
    so the backward extension thread and the foreground tail loop don't
    fight, they just both insert into the same table.
    """
    conn = sqlite3.connect(DATABASE_URL, isolation_level=None, check_same_thread=False)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    return conn


def _backward_thread_target(desired_low: int, current_low: int) -> None:
    """Background entry point for the silent backward-extension pass.

    Builds its own RPC pool + DB connection so it never touches the
    foreground tail's state. Logs prefix with [backward] so the two
    loops are distinguishable in the merged log stream.
    """
    log.info("[backward] thread starting — target %s ← %s (%s blocks)",
             desired_low, current_low, current_low - desired_low)
    conn: Optional[sqlite3.Connection] = None
    try:
        conn = _open_thread_conn()
        bw_pool = build_pool(backfill_endpoints())
        backfill_extend_backward(bw_pool, conn, desired_low, current_low)
    except Exception as exc:  # noqa: BLE001
        log.exception("[backward] thread failed: %s", exc)
    finally:
        if conn is not None:
            conn.close()
    log.info("[backward] thread done")


def follow(pool: W3Pool, conn: sqlite3.Connection) -> None:
    chunk = pool[0][0].chunk_blocks
    log.info("Tailing new blocks every %ss (chunk=%s via %s).",
             POLL_INTERVAL, chunk, pool[0][0].name)
    while not _stop:
        try:
            last_indexed = int(get_state(conn, "last_indexed_block") or 0)
            head = get_head_block(pool)
            if head > last_indexed:
                cursor = last_indexed + 1
                while cursor <= head and not _stop:
                    chunk_end = min(cursor + chunk - 1, head)
                    n_t, n_a = process_chunk(conn, pool, cursor, chunk_end)
                    set_state(conn, "last_indexed_block", str(chunk_end))
                    if n_t or n_a:
                        log.info(
                            "blocks %s-%s: +%s custodial, +%s pass-through",
                            cursor, chunk_end, n_t, n_a,
                        )
                    cursor = chunk_end + 1
        except Exception as exc:  # noqa: BLE001
            log.exception("Polling cycle failed: %s", exc)
        for _ in range(POLL_INTERVAL):
            if _stop:
                break
            time.sleep(1)


def main() -> None:
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    db_path = Path(DATABASE_URL).resolve()
    log.info("SQLite at %s", db_path)
    log.info("Tracking %s facilitator addresses across Base mainnet.",
             len(FACILITATOR_ADDRESSES))

    # Backfill pool: public RPCs first (big chunks, no rate limits).
    log.info("Building backfill RPC pool…")
    bf_pool = build_pool(backfill_endpoints())
    head = get_head_block(bf_pool)
    log.info("Connected. Head block = %s", head)

    with closing(db_connect()) as conn:
        init_db(conn)
        migrate(conn)
        last_indexed = int(get_state(conn, "last_indexed_block") or 0)

        # FORWARD pass — index from where we left off up to current head.
        # For a fresh DB (or post-migration reset) this kicks off the
        # initial backfill window starting at head - BACKFILL_BLOCKS.
        #
        # If the operator shrinks BACKFILL_HOURS between runs, a stale
        # checkpoint can sit far below the new window — without this
        # reset we'd waste hours re-scanning blocks that fall outside it.
        forward_start_default = max(head - BACKFILL_BLOCKS, 1)
        if last_indexed and last_indexed < forward_start_default:
            log.warning(
                "Forward checkpoint %s is below BACKFILL_BLOCKS window (%s). "
                "Resetting so forward catchup starts at the new window edge.",
                last_indexed, forward_start_default,
            )
            set_state(conn, "last_indexed_block", "0")
            last_indexed = 0

        forward_start = (last_indexed + 1) if last_indexed else forward_start_default
        if forward_start <= head:
            backfill(bf_pool, conn, forward_start, head)
        else:
            log.info("Already caught up to head — skipping forward backfill.")

        # BACKWARD pass — spawned as a daemonless background thread so the
        # foreground tail can start IMMEDIATELY. The thread opens its own
        # SQLite connection and RPC pool; SQLite's WAL mode serializes
        # writes from both threads safely.
        backward_thread: Optional[threading.Thread] = None
        if EXTEND_BACKWARD and not _stop:
            extend_low = max(1, head - EXTEND_BACKWARD_BLOCKS)
            db_min = conn.execute(
                "SELECT MIN(block_number) FROM transfers"
            ).fetchone()[0]
            if db_min and db_min > extend_low:
                log.info(
                    "Spawning background backward extension: %s ← %s "
                    "(target depth %.1f days)",
                    extend_low, db_min, EXTEND_BACKWARD_HOURS / 24,
                )
                backward_thread = threading.Thread(
                    target=_backward_thread_target,
                    args=(extend_low, db_min),
                    name="backward-extend",
                    daemon=False,
                )
                backward_thread.start()
            elif db_min:
                log.info(
                    "[backward] indexed window already reaches block %s "
                    "(≤ desired %s) — nothing to extend.",
                    db_min, extend_low,
                )
        else:
            log.info(
                "Backward extension disabled (EXTEND_BACKWARD=false). "
                "Set true + EXTEND_BACKWARD_HOURS to silently fill history.",
            )

        # Tail pool: Alchemy first (low latency for small requests).
        # Runs in the foreground so this process is the one that receives
        # signals and drives shutdown for both itself and the backward thread.
        log.info("Building tail RPC pool…")
        tail_pool = build_pool(tail_endpoints())
        follow(tail_pool, conn)

        # Shutdown — wait briefly for the backward thread to settle its
        # current chunk so we don't leave the DB in an inconsistent state.
        if backward_thread and backward_thread.is_alive():
            log.info("Waiting up to 60s for backward thread to finish current chunk…")
            backward_thread.join(timeout=60)
            if backward_thread.is_alive():
                log.warning("Backward thread still running at shutdown — DB will resume next start.")

    log.info("Indexer stopped.")


if __name__ == "__main__":
    main()
