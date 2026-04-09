#!/usr/bin/env bash
# start.sh — launch the API server + Vite dev server for local development
# Usage:  bash start.sh
#
# The webcam tracker now runs in the browser (no Python tracker process needed).
# Ctrl+C stops both processes.

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PYTHON="${PYENV_ROOT:-$HOME/.pyenv}/shims/python"
if [ ! -x "$PYTHON" ]; then
  PYTHON="python"
fi

echo "[start.sh] Using Python: $($PYTHON --version)"
echo "[start.sh] Starting API server (dashboard/api.py) ..."
"$PYTHON" dashboard/api.py &
API_PID=$!

sleep 1

echo "[start.sh] Starting Vite dev server ..."
cd dashboard/frontend && npm run dev &
VITE_PID=$!

trap "echo; echo '[start.sh] Stopping...'; kill $API_PID $VITE_PID 2>/dev/null; wait" INT TERM

echo "[start.sh] Running."
echo "  API   → http://localhost:8000"
echo "  UI    → http://localhost:5173"
echo "  Press Ctrl+C to stop."

wait
