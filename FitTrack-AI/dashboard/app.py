"""
FitTrack AI – Streamlit Dashboard
----------------------------------
Visualises saved session JSON files from data/sessions/.

Features
--------
• Session selector dropdown
• Key metrics cards (total workout time, avg BPM, total reps)
• Exercise frame-count bar chart
• Fatigue zone pie chart
• BPM over time line chart
• Rep count per exercise table
• CSV export button for session summary
• Auto-refresh every 5 seconds while a session is active

Run with:
    streamlit run dashboard/app.py
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

# ── Path setup ────────────────────────────────────────────────────────────
_DASH_DIR  = Path(__file__).resolve().parent
_ROOT_DIR  = _DASH_DIR.parent
_SESS_DIR  = _ROOT_DIR / "data" / "sessions"

if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

# ── Zone colour palette (hex for Plotly) ──────────────────────────────────
ZONE_COLORS_HEX: dict[str, str] = {
    "Normal":    "#00c800",
    "Aerobic":   "#00c8ff",
    "Anaerobic": "#ff8c00",
    "Maximum":   "#ff2020",
    "Recovery":  "#a0a0ff",
    "Unknown":   "#808080",
}

# ── Streamlit page config ─────────────────────────────────────────────────
st.set_page_config(
    page_title="FitTrack AI Dashboard",
    page_icon="💪",
    layout="wide",
    initial_sidebar_state="expanded",
)


# ── Helper functions ──────────────────────────────────────────────────────

def _load_session(path: Path) -> dict[str, Any]:
    """Load and parse a session JSON file."""
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _list_sessions(sessions_dir: Path = _SESS_DIR) -> list[Path]:
    """Return all session JSON files sorted newest-first."""
    if not sessions_dir.exists():
        return []
    return sorted(sessions_dir.glob("session_*.json"),
                  key=lambda p: p.stat().st_mtime, reverse=True)


def _fmt_duration(seconds: float) -> str:
    """Convert seconds to 'Xm Ys' string."""
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}h {m}m {s}s"
    return f"{m}m {s}s"


def _frames_to_df(frames: list[dict]) -> pd.DataFrame:
    """Convert the frames list to a tidy DataFrame."""
    if not frames:
        return pd.DataFrame()
    df = pd.DataFrame(frames)
    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    if "duration_seconds" in df.columns:
        df["duration_seconds"] = pd.to_numeric(df["duration_seconds"], errors="coerce")
    return df


def _summary_to_csv(summary: dict[str, Any]) -> str:
    """Flatten a summary dict to a simple two-column CSV string."""
    rows = []
    for key, value in summary.items():
        if isinstance(value, dict):
            for sub_key, sub_val in value.items():
                rows.append({"field": f"{key}.{sub_key}", "value": sub_val})
        elif isinstance(value, list):
            rows.append({"field": key, "value": ", ".join(map(str, value))})
        else:
            rows.append({"field": key, "value": value})
    return pd.DataFrame(rows).to_csv(index=False)


# ── Sidebar ───────────────────────────────────────────────────────────────

def _sidebar() -> tuple[Path | None, bool]:
    """Render sidebar controls; return (selected_path, auto_refresh)."""
    st.sidebar.title("FitTrack AI 💪")
    st.sidebar.markdown("---")

    session_files = _list_sessions()
    if not session_files:
        st.sidebar.warning("No sessions found in `data/sessions/`.\nRun the main app to record one.")
        return None, False

    options = {p.stem: p for p in session_files}
    selected_name = st.sidebar.selectbox(
        "Select session",
        list(options.keys()),
        help="Sessions are listed newest-first.",
    )
    selected_path = options[selected_name]

    auto_refresh = st.sidebar.checkbox(
        "Auto-refresh (5 s)",
        value=False,
        help="Enable when a session is actively being recorded.",
    )

    st.sidebar.markdown("---")
    st.sidebar.caption(f"Sessions directory:\n`{_SESS_DIR}`")

    return selected_path, auto_refresh


# ── Metric cards ──────────────────────────────────────────────────────────

def _render_metrics(summary: dict[str, Any]) -> None:
    """Top row of KPI cards."""
    col1, col2, col3, col4, col5 = st.columns(5)

    with col1:
        st.metric(
            "⏱ Duration",
            _fmt_duration(summary.get("total_duration_seconds", 0)),
        )
    with col2:
        st.metric(
            "❤️ Avg BPM",
            f"{summary.get('avg_bpm', 0):.0f}",
        )
    with col3:
        st.metric(
            "📈 Max BPM",
            f"{summary.get('max_bpm', 0)}",
        )
    with col4:
        total_reps = sum(summary.get("max_reps_per_exercise", {}).values())
        st.metric("🔁 Total Reps", total_reps)
    with col5:
        st.metric(
            "🎞 Frames",
            f"{summary.get('total_frames', 0):,}",
        )


# ── Charts ────────────────────────────────────────────────────────────────

def _exercise_bar(summary: dict[str, Any]) -> None:
    """Horizontal bar chart: frames per exercise type."""
    frame_counts = summary.get("exercise_frame_counts", {})
    if not frame_counts:
        st.info("No exercise data recorded.")
        return

    df = pd.DataFrame(
        {"Exercise": list(frame_counts.keys()),
         "Frames":   list(frame_counts.values())}
    ).sort_values("Frames", ascending=True)

    fig = px.bar(
        df, x="Frames", y="Exercise", orientation="h",
        title="Exercise Duration (frames)",
        color="Frames",
        color_continuous_scale="viridis",
        labels={"Frames": "Frame Count"},
    )
    fig.update_layout(showlegend=False, height=300, margin=dict(t=40, b=20))
    st.plotly_chart(fig, use_container_width=True)


def _fatigue_pie(summary: dict[str, Any]) -> None:
    """Pie chart: fatigue zone distribution."""
    dist = summary.get("fatigue_zone_distribution", {})
    if not dist:
        st.info("No fatigue zone data.")
        return

    zones  = list(dist.keys())
    counts = list(dist.values())
    colors = [ZONE_COLORS_HEX.get(z, "#808080") for z in zones]

    fig = go.Figure(go.Pie(
        labels=zones,
        values=counts,
        marker_colors=colors,
        hole=0.4,
        textinfo="label+percent",
    ))
    fig.update_layout(title="Fatigue Zone Distribution", height=320, margin=dict(t=50, b=10))
    st.plotly_chart(fig, use_container_width=True)


def _bpm_timeline(df: pd.DataFrame) -> None:
    """Line chart: BPM over session time."""
    if df.empty or "bpm" not in df.columns:
        st.info("No BPM data in this session.")
        return

    plot_df = df[["duration_seconds", "bpm", "fatigue_zone"]].dropna()
    if plot_df.empty:
        return

    fig = px.line(
        plot_df, x="duration_seconds", y="bpm",
        color="fatigue_zone",
        color_discrete_map=ZONE_COLORS_HEX,
        title="Heart Rate Over Time",
        labels={"duration_seconds": "Time (s)", "bpm": "BPM", "fatigue_zone": "Zone"},
    )
    fig.update_layout(height=320, margin=dict(t=50, b=20))
    st.plotly_chart(fig, use_container_width=True)


def _reps_table(summary: dict[str, Any]) -> None:
    """Table: max reps per exercise."""
    reps = summary.get("max_reps_per_exercise", {})
    if not reps:
        st.info("No rep data.")
        return

    df = pd.DataFrame(
        {"Exercise": list(reps.keys()), "Max Reps": list(reps.values())}
    ).sort_values("Max Reps", ascending=False).reset_index(drop=True)

    st.dataframe(df, use_container_width=True, hide_index=True)


# ── Export ────────────────────────────────────────────────────────────────

def _export_button(summary: dict[str, Any], session_name: str) -> None:
    """CSV download button for session summary."""
    csv_data = _summary_to_csv(summary)
    st.download_button(
        label="⬇ Export Summary as CSV",
        data=csv_data,
        file_name=f"{session_name}_summary.csv",
        mime="text/csv",
    )


# ── Main dashboard ────────────────────────────────────────────────────────

def main() -> None:
    """Entry point for the Streamlit dashboard."""

    selected_path, auto_refresh = _sidebar()

    st.title("🏋️ FitTrack AI – Session Dashboard")

    if selected_path is None:
        st.info("👈  Select or record a session to get started.")
        return

    # Load data
    try:
        session_data = _load_session(selected_path)
    except Exception as exc:
        st.error(f"Failed to load session: {exc}")
        return

    summary = session_data.get("summary", {})
    frames  = session_data.get("frames", [])
    df      = _frames_to_df(frames)

    # Session header
    session_id = session_data.get("session_id", selected_path.stem)
    start_raw  = session_data.get("start_time", "")
    try:
        start_dt = datetime.fromisoformat(start_raw).strftime("%Y-%m-%d  %H:%M:%S")
    except (ValueError, TypeError):
        start_dt = start_raw

    st.subheader(f"Session: `{session_id}`")
    st.caption(f"Recorded: {start_dt}")

    st.markdown("---")

    # ── KPI cards ──────────────────────────────────────────────────────────
    _render_metrics(summary)

    st.markdown("---")

    # ── Charts row 1 ──────────────────────────────────────────────────────
    col_left, col_right = st.columns(2)
    with col_left:
        _exercise_bar(summary)
    with col_right:
        _fatigue_pie(summary)

    st.markdown("---")

    # ── BPM timeline (full width) ──────────────────────────────────────────
    _bpm_timeline(df)

    st.markdown("---")

    # ── Reps table + export ────────────────────────────────────────────────
    col_t, col_e = st.columns([2, 1])
    with col_t:
        st.subheader("Reps per Exercise")
        _reps_table(summary)
    with col_e:
        st.subheader("Export")
        _export_button(summary, selected_path.stem)

        # Raw JSON expander
        with st.expander("Raw session summary JSON"):
            st.json(summary)

    # ── Auto-refresh ───────────────────────────────────────────────────────
    if auto_refresh:
        time.sleep(5)
        st.rerun()


if __name__ == "__main__":
    main()
