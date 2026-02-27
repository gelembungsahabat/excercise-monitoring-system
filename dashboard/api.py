"""
FitTrack AI – FastAPI Backend
------------------------------
Serves session JSON data for the React SPA dashboard.

Endpoints
---------
GET  /api/sessions            – list all sessions (metadata only, no frames)
GET  /api/sessions/{id}       – full session payload including frames
GET  /api/sessions/{id}/live  – summary only (for auto-refresh polling)

In production the built React app is served as static files from
dashboard/frontend/dist/.

Run with:
    python dashboard/api.py
    # or
    uvicorn dashboard.api:app --reload --port 8000
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# ── Paths ──────────────────────────────────────────────────────────────────
_HERE         = Path(__file__).resolve().parent
_ROOT         = _HERE.parent
SESSIONS_DIR  = _ROOT / "data" / "sessions"
FRONTEND_DIST = _HERE / "frontend" / "dist"

# ── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

# ── App ────────────────────────────────────────────────────────────────────
app = FastAPI(title="FitTrack AI", version="1.0.0", docs_url="/api/docs")

# Allow Vite dev server (port 5173) during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ── Helpers ────────────────────────────────────────────────────────────────

def _load_json(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _session_files() -> list[Path]:
    """Return session JSON files sorted newest-first."""
    if not SESSIONS_DIR.exists():
        return []
    return sorted(
        SESSIONS_DIR.glob("session_*.json"),
        key=os.path.getmtime,
        reverse=True,
    )


def _meta(path: Path, data: dict[str, Any]) -> dict[str, Any]:
    """Extract lightweight metadata from a session payload."""
    summary = data.get("summary", {})
    return {
        "id":                path.stem,
        "start_time":        data.get("start_time", ""),
        "end_time":          data.get("end_time", ""),
        "duration_seconds":  data.get("duration_seconds", 0),
        "total_frames":      summary.get("total_frames", 0),
        "avg_bpm":           summary.get("avg_bpm", 0),
        "exercises":         summary.get("exercises_detected", []),
        "max_reps":          summary.get("max_reps_per_exercise", {}),
    }


# ── Routes ─────────────────────────────────────────────────────────────────

@app.get("/api/sessions", summary="List all sessions")
def list_sessions() -> list[dict[str, Any]]:
    """Return metadata for all saved sessions, newest-first."""
    result = []
    for path in _session_files():
        try:
            data = _load_json(path)
            result.append(_meta(path, data))
        except Exception as exc:
            logger.warning("Could not read %s: %s", path.name, exc)
    return result


@app.get("/api/sessions/{session_id}", summary="Get full session")
def get_session(session_id: str) -> dict[str, Any]:
    """Return the complete session JSON including all frames."""
    path = SESSIONS_DIR / f"{session_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    try:
        return _load_json(path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/sessions/{session_id}/summary", summary="Get session summary only")
def get_session_summary(session_id: str) -> dict[str, Any]:
    """Return only the summary dict (no frames) — used for live polling."""
    path = SESSIONS_DIR / f"{session_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    data = _load_json(path)
    return data.get("summary", {})


# ── Static file serving (production) ──────────────────────────────────────

if FRONTEND_DIST.exists():
    # Serve the React SPA; all unknown paths fall through to index.html
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> FileResponse:
        return FileResponse(FRONTEND_DIST / "index.html")
else:
    logger.warning(
        "Frontend dist not found at %s. "
        "Run: cd dashboard/frontend && npm run build",
        FRONTEND_DIST,
    )


# ── Entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Pass the app object directly so this works when run from any directory:
    #   python dashboard/api.py
    # For hot-reload during development, use uvicorn CLI from the project root:
    #   uvicorn dashboard.api:app --reload --port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
