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
import time
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
    payload = [
        {
            "jsonrpc": "2.0",
            "id": idx,
            "method": "eth_getBlockByNumber",
            "params": [hex(b), False],
        }
        for idx, b in enumerate(blocks)
    ]
    last_exc: Optional[Exception] = None
    for ep, _ in pool:
        try:
            r = _requests.post(ep.url, json=payload, timeout=30)
            r.raise_for_status()
            arr = r.json()
            if not isinstance(arr, list) or len(arr) != len(blocks):
                raise RuntimeError(f"unexpected batch response shape from {ep.name}")
            result: dict[int, int] = {}
            for resp in arr:
                idx = resp.get("id")
                if "result" not in resp or resp["result"] is None:
                    raise RuntimeError(
                        f"missing result in {ep.name} response: {resp.get('error')}"
                    )
                ts_hex = resp["result"]["timestamp"]
                result[blocks[idx]] = int(ts_hex, 16)
            return result
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            log.warning(
                "Batch block lookup via %s failed (%d blocks): %s",
                ep.name, len(blocks), exc,
            )
            continue

    # If every RPC failed the batched path, fall back to one-block-at-a-time.
    log.warning("Falling back to per-block lookups for %d blocks", len(blocks))
    result = {}
    for b in blocks:
        result[b] = get_block_timestamp(pool, b)
    return result

# ------------------------------------------------------------------ getLogs

def _do_get_logs(
    w3: Web3, from_block: int, to_block: int, topic_batch: list[str],
) -> list[LogReceipt]:
    params = {
        "fromBlock": from_block,
        "toBlock":   to_block,
        "address":   USDC_ADDRESS,
        "topics":    [TRANSFER_TOPIC, None, topic_batch],
    }
    return w3.eth.get_logs(params)


def _fetch_batch_with_fallback(
    pool: W3Pool, from_block: int, to_block: int, topic_batch: list[str],
) -> list[LogReceipt]:
    """One eth_getLogs request for one topic batch, with multi-RPC fallback.

    If the requested range exceeds an endpoint's chunk cap, we transparently
    sub-chunk for that endpoint before declaring it failed.
    """
    last_exc: Optional[Exception] = None
    range_size = to_block - from_block + 1

    for ep, w3 in pool:
        try:
            if range_size > ep.chunk_blocks:
                results: list[LogReceipt] = []
                cur = from_block
                while cur <= to_block:
                    end = min(cur + ep.chunk_blocks - 1, to_block)
                    results.extend(_do_get_logs(w3, cur, end, topic_batch))
                    cur = end + 1
                    if RPC_PACING_SECONDS:
                        time.sleep(RPC_PACING_SECONDS)
                return results
            return _do_get_logs(w3, from_block, to_block, topic_batch)
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


def fetch_logs(pool: W3Pool, from_block: int, to_block: int) -> list[LogReceipt]:
    """All facilitator-targeted USDC Transfer logs in [from_block, to_block]."""
    to_topics = [address_to_topic(a) for a in sorted(FACILITATOR_ADDRESSES)]
    results: list[LogReceipt] = []
    for topic_batch in chunked(to_topics, MAX_TOPICS_PER_FILTER):
        results.extend(_fetch_batch_with_fallback(pool, from_block, to_block, topic_batch))
    return results

# ------------------------------------------------------------------ decode + insert

def decode_and_insert(
    conn: sqlite3.Connection,
    pool: W3Pool,
    logs: list[LogReceipt],
) -> int:
    """Decode Transfer logs and insert any new rows. Returns inserted count.

    Two passes: (1) decode all logs and collect unique block numbers, then
    (2) fetch every block timestamp in a SINGLE batched JSON-RPC call. This
    is the critical perf path during backfill — chunks rich in logs used to
    bottleneck on N per-block HTTP round-trips.
    """
    if not logs:
        return 0

    # The codec is identical across RPCs — any pool member works for decoding.
    codec = pool[0][1].codec

    # Pass 1: decode logs, dedupe block numbers.
    decoded_rows: list[dict] = []
    needed_blocks: set[int] = set()
    for raw in logs:
        decoded = get_event_data(codec, TRANSFER_EVENT_ABI, raw)
        to_addr = decoded["args"]["to"].lower()
        if to_addr not in FACILITATOR_ADDRESSES:
            # Defensive: topic batching should already guarantee this.
            continue
        decoded_rows.append({
            "tx_hash":     decoded["transactionHash"].to_0x_hex(),
            "log_index":   decoded["logIndex"],
            "block":       decoded["blockNumber"],
            "from_addr":   decoded["args"]["from"].lower(),
            "to_addr":     to_addr,
            "amount":      decoded["args"]["value"] / (10**USDC_DECIMALS),
        })
        needed_blocks.add(decoded["blockNumber"])

    if not decoded_rows:
        return 0

    # Pass 2: one batched RPC for every unique block in this chunk.
    block_ts = get_block_timestamps_batch(pool, list(needed_blocks))

    inserted = 0
    for r in decoded_rows:
        ts = block_ts.get(r["block"])
        if ts is None:
            # Should not happen — defensive fallback.
            ts = get_block_timestamp(pool, r["block"])
        facilitator = ADDRESS_TO_FACILITATOR.get(r["to_addr"], "unknown")
        cur = conn.execute(
            "INSERT OR IGNORE INTO transfers "
            "(tx_hash, log_index, block_number, timestamp, from_address, "
            " to_address, amount_usdc, chain, facilitator) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (
                r["tx_hash"], r["log_index"], r["block"], ts,
                r["from_addr"], r["to_addr"], r["amount"],
                CHAIN_NAME, facilitator,
            ),
        )
        if cur.rowcount:
            inserted += 1
    return inserted

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
    total = 0
    last_progress_log = time.time()

    while cursor <= head and not _stop:
        chunk_end = min(cursor + chunk - 1, head)
        logs = fetch_logs(pool, cursor, chunk_end)
        added = decode_and_insert(conn, pool, logs)
        total += added
        if added:
            log.info(
                "  blocks %s-%s: +%s rows (running total %s)",
                cursor, chunk_end, added, total,
            )
        set_state(conn, "last_indexed_block", str(chunk_end))
        cursor = chunk_end + 1

        now = time.time()
        if now - last_progress_log > 15:
            done = cursor - start_block
            need = head - start_block
            pct = done * 100 / max(need, 1)
            log.info("  ... progress %s/%s (%.1f%%), inserted %s", done, need, pct, total)
            last_progress_log = now

    log.info("Backfill complete. Inserted %s transfers.", total)


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
    total = 0
    last_progress_log = time.time()
    upper = current_low - 1   # inclusive

    while cursor <= upper and not _stop:
        chunk_end = min(cursor + chunk - 1, upper)
        logs = fetch_logs(pool, cursor, chunk_end)
        added = decode_and_insert(conn, pool, logs)
        total += added
        if added:
            log.info(
                "  ← blocks %s-%s: +%s rows (backward total %s)",
                cursor, chunk_end, added, total,
            )
        # Track the LOWEST block we've covered so far.
        set_state(conn, "backward_extended_to_block", str(cursor))
        cursor = chunk_end + 1

        now = time.time()
        if now - last_progress_log > 15:
            done = cursor - desired_low
            pct = done * 100 / max(span, 1)
            log.info(
                "  ← progress %s/%s (%.1f%%), inserted %s",
                done, span, pct, total,
            )
            last_progress_log = now

    log.info("Backward extension complete. Inserted %s transfers.", total)


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
                    logs = fetch_logs(pool, cursor, chunk_end)
                    added = decode_and_insert(conn, pool, logs)
                    set_state(conn, "last_indexed_block", str(chunk_end))
                    if added:
                        log.info("blocks %s-%s: +%s transfers", cursor, chunk_end, added)
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
        last_indexed = int(get_state(conn, "last_indexed_block") or 0)

        # FORWARD pass — index from where we left off up to current head.
        # For a fresh DB this also kicks off the initial backfill window.
        forward_start = (last_indexed + 1) if last_indexed else max(head - BACKFILL_BLOCKS, 1)
        if forward_start <= head:
            backfill(bf_pool, conn, forward_start, head)
        else:
            log.info("Already caught up to head — skipping forward backfill.")

        # BACKWARD pass — if the configured BACKFILL_HOURS is larger than
        # what we currently have indexed, extend the window backwards.
        desired_low = max(1, head - BACKFILL_BLOCKS)
        db_min = conn.execute(
            "SELECT MIN(block_number) FROM transfers"
        ).fetchone()[0]
        if db_min and db_min > desired_low and not _stop:
            log.info(
                "Indexed window currently starts at block %s; BACKFILL_BLOCKS "
                "wants %s. Extending backwards…",
                db_min, desired_low,
            )
            backfill_extend_backward(bf_pool, conn, desired_low, db_min)
        elif db_min:
            log.info(
                "Indexed window already reaches block %s (≤ desired %s). "
                "Skipping backward extension.",
                db_min, desired_low,
            )

        # Tail pool: Alchemy first (low latency for small requests).
        log.info("Building tail RPC pool…")
        tail_pool = build_pool(tail_endpoints())
        follow(tail_pool, conn)

    log.info("Indexer stopped.")


if __name__ == "__main__":
    main()
