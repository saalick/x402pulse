#!/usr/bin/env bash
# Production entrypoint for the single-container deployment (Railway / Fly / docker-compose).
#
# Runs the indexer in the background and the FastAPI service in the
# foreground. Both processes share the same /data volume so the API
# reads what the indexer writes.
#
# Binds uvicorn to ${PORT:-8000} — Railway injects PORT at runtime;
# locally and on Fly it falls through to 8000.
#
# If either process dies, the wrapper exits non-zero and the host
# (Railway / Fly / docker --restart=always) restarts the container.
set -euo pipefail

# Best-effort: ensure /data exists when a volume is mounted there.
mkdir -p /data 2>/dev/null || true

PORT="${PORT:-8000}"
echo "[start.sh] starting — API will bind 0.0.0.0:${PORT}"

# Indexer first, in background. -u → unbuffered stdout so logs flush
# promptly. Tag each line with [indexer] for clarity in the merged log.
python -u indexer/main.py 2>&1 | sed -u 's/^/[indexer] /' &
INDEXER_PID=$!

# API in background too, so we can wait on either child.
uvicorn api.main:app \
    --host 0.0.0.0 \
    --port "${PORT}" \
    --log-level info 2>&1 | sed -u 's/^/[api]     /' &
UVICORN_PID=$!

# Forward signals so the platform's graceful-stop shuts both down cleanly.
trap 'kill -TERM $INDEXER_PID $UVICORN_PID 2>/dev/null || true; wait; exit 0' \
    SIGINT SIGTERM

# Wait for the first child to exit, then take everything down.
wait -n
EXIT=$?
echo "[start.sh] a child exited (status $EXIT) — shutting down both"
kill -TERM $INDEXER_PID $UVICORN_PID 2>/dev/null || true
wait || true
exit $EXIT
