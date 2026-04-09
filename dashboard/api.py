"""
FitTrack AI – FastAPI Backend
------------------------------
Serves session JSON data for the React SPA dashboard.
Receives live state and completed sessions from the browser-side tracker.

Storage
-------
If DATABASE_URL is set (PostgreSQL), sessions are persisted there and survive
Railway redeployments. Otherwise sessions fall back to local JSON files.

Endpoints
---------
GET    /api/sessions              – list all sessions (metadata only)
GET    /api/sessions/{id}         – full session payload including frames
GET    /api/sessions/{id}/summary – summary only
DELETE /api/sessions/{id}         – permanently delete a session
GET    /api/live                  – current live session state (polling)
GET    /api/live/stream           – SSE stream of live state
POST   /api/live                  – browser tracker pushes live snapshots
POST   /api/sessions              – browser tracker saves completed session
GET    /api/classify-bpm          – predict fatigue zone from BPM
GET    /api/sessions/{id}/insight – AI coaching insight (OpenRouter)

Run with:
    uvicorn dashboard.api:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Generator

import httpx
import uvicorn
from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

# ── Paths ──────────────────────────────────────────────────────────────────
_HERE         = Path(__file__).resolve().parent
_ROOT         = _HERE.parent
SESSIONS_DIR  = _ROOT / "data" / "sessions"
LIVE_FILE     = _ROOT / "data" / "live.json"
FRONTEND_DIST = _HERE / "frontend" / "dist"

# Add project root to sys.path so tracker.hr_classifier can be imported
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

# ── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

# ── PostgreSQL ─────────────────────────────────────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# psycopg2 is only required when DATABASE_URL is configured
_psycopg2: Any = None
if DATABASE_URL:
    try:
        import psycopg2
        import psycopg2.extras
        _psycopg2 = psycopg2
        logger.info("psycopg2 loaded — PostgreSQL storage enabled.")
    except ImportError:
        logger.error("psycopg2 not installed but DATABASE_URL is set. Sessions will fall back to files.")
        DATABASE_URL = ""


def _db_enabled() -> bool:
    return bool(DATABASE_URL and _psycopg2)


@contextmanager
def _db_conn() -> Generator:
    """Yield a psycopg2 connection; commits on clean exit, rolls back on error."""
    conn = _psycopg2.connect(DATABASE_URL)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _init_db() -> None:
    """Create the sessions table if it doesn't exist."""
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id  TEXT PRIMARY KEY,
                    data        JSONB NOT NULL,
                    created_at  TIMESTAMPTZ DEFAULT NOW()
                )
            """)
    logger.info("PostgreSQL sessions table ready.")


# ── App ────────────────────────────────────────────────────────────────────
app = FastAPI(title="FitTrack AI", version="2.0.0", docs_url="/api/docs")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    if _db_enabled():
        try:
            _init_db()
        except Exception as exc:
            logger.error("DB init failed: %s — falling back to file storage.", exc)
            global DATABASE_URL
            DATABASE_URL = ""
    else:
        logger.info("DATABASE_URL not set — using file-based session storage.")
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


# ── HR Classifier (lazy, optional) ────────────────────────────────────────

class _FallbackClassifier:
    """Rule-based zone predictor used when the ML model is unavailable."""
    def predict(self, bpm: float) -> str:
        if bpm <= 90:  return "Recovery"
        if bpm <= 109: return "Normal"
        if bpm <= 129: return "Aerobic"
        if bpm <= 149: return "Anaerobic"
        return "Maximum"


_classifier_cache: Any = None


def _get_classifier() -> Any:
    global _classifier_cache
    if _classifier_cache is not None:
        return _classifier_cache
    try:
        from tracker.hr_classifier import HRClassifier  # type: ignore
        clf = HRClassifier()
        if not clf.is_loaded():
            clf.train()
        _classifier_cache = clf
        logger.info("HR classifier loaded.")
    except Exception as exc:
        logger.warning("HR classifier unavailable (%s) — using rule-based fallback.", exc)
        _classifier_cache = _FallbackClassifier()
    return _classifier_cache


# ── Storage helpers ────────────────────────────────────────────────────────

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


def _meta(session_id: str, data: dict[str, Any]) -> dict[str, Any]:
    summary = data.get("summary", {})
    return {
        "id":               session_id,
        "start_time":       data.get("start_time", ""),
        "end_time":         data.get("end_time", ""),
        "duration_seconds": data.get("duration_seconds", 0),
        "total_frames":     summary.get("total_frames", 0),
        "avg_bpm":          summary.get("avg_bpm", 0),
        "exercises":        summary.get("exercises_detected", []),
        "max_reps":         summary.get("max_reps_per_exercise", {}),
    }


# ── DB-backed session ops ──────────────────────────────────────────────────

def _db_list_sessions() -> list[dict[str, Any]]:
    with _db_conn() as conn:
        with conn.cursor(_psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT session_id, data FROM sessions ORDER BY created_at DESC")
            rows = cur.fetchall()
    return [_meta(row["session_id"], row["data"]) for row in rows]


def _db_get_session(session_id: str) -> dict[str, Any] | None:
    with _db_conn() as conn:
        with conn.cursor(_psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT data FROM sessions WHERE session_id = %s", (session_id,))
            row = cur.fetchone()
    return dict(row["data"]) if row else None


def _db_save_session(session_id: str, data: dict[str, Any]) -> None:
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sessions (session_id, data)
                VALUES (%s, %s)
                ON CONFLICT (session_id) DO UPDATE SET data = EXCLUDED.data
                """,
                (session_id, _psycopg2.extras.Json(data)),
            )


def _db_delete_session(session_id: str) -> bool:
    """Returns True if a row was deleted."""
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE session_id = %s", (session_id,))
            return cur.rowcount > 0


# ── Live session helpers ───────────────────────────────────────────────────

def _read_live() -> dict[str, Any]:
    if not LIVE_FILE.exists():
        return {"status": "idle"}
    try:
        return _load_json(LIVE_FILE)
    except Exception:
        return {"status": "idle"}


# ── Session read endpoints ─────────────────────────────────────────────────

@app.get("/api/sessions", summary="List all sessions")
def list_sessions() -> list[dict[str, Any]]:
    if _db_enabled():
        try:
            return _db_list_sessions()
        except Exception as exc:
            logger.error("DB list_sessions failed: %s", exc)
            raise HTTPException(500, "Database error")

    result = []
    for path in _session_files():
        try:
            data = _load_json(path)
            result.append(_meta(path.stem, data))
        except Exception as exc:
            logger.warning("Could not read %s: %s", path.name, exc)
    return result


@app.get("/api/sessions/{session_id}", summary="Get full session")
def get_session(session_id: str) -> dict[str, Any]:
    if _db_enabled():
        try:
            data = _db_get_session(session_id)
        except Exception as exc:
            logger.error("DB get_session failed: %s", exc)
            raise HTTPException(500, "Database error")
        if data is None:
            raise HTTPException(404, f"Session '{session_id}' not found")
        return data

    path = SESSIONS_DIR / f"{session_id}.json"
    if not path.exists():
        raise HTTPException(404, f"Session '{session_id}' not found")
    try:
        return _load_json(path)
    except Exception as exc:
        raise HTTPException(500, str(exc))


@app.get("/api/sessions/{session_id}/summary", summary="Get session summary")
def get_session_summary(session_id: str) -> dict[str, Any]:
    return get_session(session_id).get("summary", {})


@app.delete("/api/sessions/{session_id}", summary="Delete a session")
def delete_session(session_id: str) -> dict[str, Any]:
    if _db_enabled():
        try:
            deleted = _db_delete_session(session_id)
        except Exception as exc:
            logger.error("DB delete_session failed: %s", exc)
            raise HTTPException(500, "Database error")
        if not deleted:
            raise HTTPException(404, f"Session '{session_id}' not found")
        _insight_cache.pop(session_id, None)
        logger.info("Session deleted from DB: %s", session_id)
        return {"ok": True, "id": session_id}

    path = SESSIONS_DIR / f"{session_id}.json"
    if not path.exists():
        raise HTTPException(404, f"Session '{session_id}' not found")
    path.unlink()
    _insight_cache.pop(session_id, None)
    logger.info("Session deleted from disk: %s", session_id)
    return {"ok": True, "id": session_id}


# ── Live session endpoints ─────────────────────────────────────────────────

@app.get("/api/live", summary="Current live session state")
def get_live() -> dict[str, Any]:
    return _read_live()


@app.post("/api/live", summary="Browser tracker pushes live snapshot")
def post_live(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Receive live state from the browser tracker and persist to live.json."""
    LIVE_FILE.parent.mkdir(parents=True, exist_ok=True)
    LIVE_FILE.write_text(json.dumps(data), encoding="utf-8")
    return {"ok": True}


@app.get("/api/live/stream", summary="SSE stream of live session state")
async def live_stream() -> StreamingResponse:
    async def generator():
        while True:
            data = _read_live()
            yield f"data: {json.dumps(data)}\n\n"
            await asyncio.sleep(1.0)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Session save endpoint ──────────────────────────────────────────────────

@app.post("/api/sessions", summary="Browser tracker saves completed session")
def save_session(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Receive and persist a completed session from the browser tracker."""
    session_id = data.get(
        "session_id",
        f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
    )

    if _db_enabled():
        try:
            _db_save_session(session_id, data)
            logger.info("Session saved to DB: %s (%d frames)", session_id, len(data.get("frames", [])))
            return {"ok": True, "id": session_id}
        except Exception as exc:
            logger.error("DB save_session failed: %s", exc)
            raise HTTPException(500, "Database error")

    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    path = SESSIONS_DIR / f"{session_id}.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    logger.info("Session saved to disk: %s (%d frames)", session_id, len(data.get("frames", [])))
    return {"ok": True, "id": session_id}


# ── AI Insight endpoint ────────────────────────────────────────────────────

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL   = os.environ.get("OPENROUTER_MODEL", "google/gemini-2.0-flash-001")
OPENROUTER_URL     = "https://openrouter.ai/api/v1/chat/completions"

# Simple in-memory cache so the same session isn't re-analyzed on every page load
_insight_cache: dict[str, str] = {}


def _build_prompt(summary: dict[str, Any]) -> str:
    duration_min = round(summary.get("total_duration_seconds", 0) / 60, 1)
    exercises    = summary.get("exercises_detected", [])
    max_reps     = summary.get("max_reps_per_exercise", {})
    zones        = summary.get("fatigue_zone_distribution", {})
    zone_pct     = summary.get("fatigue_zone_pct", {})
    avg_bpm      = summary.get("avg_bpm", 0)
    max_bpm      = summary.get("max_bpm", 0)
    min_bpm      = summary.get("min_bpm", 0)
    total_frames = summary.get("total_frames", 0)

    reps_lines = "\n".join(f"  - {ex}: {r} reps" for ex, r in max_reps.items() if r > 0)
    zone_lines = "\n".join(
        f"  - {z}: {zones[z]} frames ({zone_pct.get(z, 0):.1f}%)"
        for z in zones
    )

    return f"""You are a personal fitness coach AI. Analyze this workout session and give friendly, specific coaching feedback.

SESSION SUMMARY:
- Duration: {duration_min} minutes
- Exercises: {', '.join(exercises) if exercises else 'Not detected'}
- Total frames analyzed: {total_frames}

REPETITIONS:
{reps_lines if reps_lines else '  - No reps recorded'}

HEART RATE:
- Average: {avg_bpm} BPM
- Peak: {max_bpm} BPM
- Minimum: {min_bpm} BPM

FATIGUE ZONES (time spent):
{zone_lines if zone_lines else '  - No zone data'}

Zone guide: Recovery (<90 BPM), Normal (91-109), Aerobic (110-129), Anaerobic (130-149), Maximum (150+)

Give a concise coaching insight in 3-4 sentences. Cover: (1) overall performance, (2) one specific strength from the data, (3) one actionable improvement tip. Be encouraging and specific — reference the actual numbers."""


@app.get("/api/sessions/{session_id}/insight", summary="AI coaching insight for a session")
async def get_session_insight(session_id: str) -> dict[str, str]:
    """Generate an AI coaching insight for the session using OpenRouter."""
    if not OPENROUTER_API_KEY:
        raise HTTPException(503, "OPENROUTER_API_KEY not configured")

    if session_id in _insight_cache:
        return {"insight": _insight_cache[session_id], "model": OPENROUTER_MODEL, "cached": "true"}  # type: ignore[return-value]

    # Fetch summary from whichever storage is active
    session_data = get_session(session_id)  # raises 404 if missing
    summary = session_data.get("summary", {})
    prompt  = _build_prompt(summary)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "HTTP-Referer": "https://fittrack-ai.app",
                    "X-Title":      "FitTrack AI",
                    "Content-Type": "application/json",
                },
                json={
                    "model":       OPENROUTER_MODEL,
                    "messages":    [{"role": "user", "content": prompt}],
                    "max_tokens":  300,
                    "temperature": 0.7,
                },
            )
            resp.raise_for_status()
            data    = resp.json()
            insight = data["choices"][0]["message"]["content"].strip()
    except httpx.HTTPStatusError as exc:
        logger.error("OpenRouter error %s: %s", exc.response.status_code, exc.response.text)
        raise HTTPException(502, f"OpenRouter returned {exc.response.status_code}")
    except Exception as exc:
        logger.error("OpenRouter request failed: %s", exc)
        raise HTTPException(502, "AI service unavailable")

    _insight_cache[session_id] = insight
    return {"insight": insight, "model": OPENROUTER_MODEL}  # type: ignore[return-value]


# ── HR classification endpoint ─────────────────────────────────────────────

@app.get("/api/classify-bpm", summary="Predict fatigue zone from BPM")
def classify_bpm(bpm: float) -> dict[str, str]:
    zone = _get_classifier().predict(bpm)
    return {"zone": zone}


# ── Static file serving (production) ──────────────────────────────────────

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> FileResponse:
        return FileResponse(FRONTEND_DIST / "index.html")
else:
    logger.warning(
        "Frontend dist not found at %s. Run: cd dashboard/frontend && npm run build",
        FRONTEND_DIST,
    )


# ── Entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
