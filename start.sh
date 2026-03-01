#!/usr/bin/env bash
# start.sh — launch the API server and the workout tracker together
# Usage:  bash start.sh
#
# Ctrl+C stops both processes.

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Use pyenv Python if available (project requires 3.11 + dependencies)
PYTHON="${PYENV_ROOT:-$HOME/.pyenv}/shims/python"
if [ ! -x "$PYTHON" ]; then
  PYTHON="python"
fi

echo "[start.sh] Using Python: $($PYTHON --version)"
echo "[start.sh] Starting API server (dashboard/api.py) ..."
"$PYTHON" dashboard/api.py &
API_PID=$!

# Give the API a moment to bind to the port
sleep 1

echo "[start.sh] Starting workout tracker (src/main.py) ..."
"$PYTHON" src/main.py &
MAIN_PID=$!

# Gracefully stop both on Ctrl+C / SIGTERM
trap "echo; echo '[start.sh] Stopping...'; kill $API_PID $MAIN_PID 2>/dev/null; wait" INT TERM

echo "[start.sh] Both processes running."
echo "  API   → http://localhost:8000"
echo "  Press Ctrl+C to stop."

wait
