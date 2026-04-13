# FitTrack AI

Real-time exercise tracking and heart-rate zone classification. Track workouts **directly from your browser** using MediaPipe Pose WASM — no Python or webcam driver needed on the server. A Python + BLE desktop mode is also available for local use.

Built with **MediaPipe Pose** (browser WASM + Python), **scikit-learn**, **React + TypeScript**, **FastAPI**, and **OpenRouter AI coaching**.

---

## What This Project Does

FitTrack AI watches you exercise through your webcam and simultaneously:

1. **Identifies which exercise you are doing** (Squat, Push-Up, Bicep Curl, Shoulder Press, Jumping Jack, Running, or Standing) by analysing joint angles in real time.
2. **Counts your repetitions** automatically using a per-exercise up/down state machine.
3. **Reads or accepts your heart rate** — enter it manually in the browser, or stream it live from a Polar H10 via Bluetooth LE in the desktop Python mode.
4. **Predicts your fatigue zone** (Normal / Aerobic / Anaerobic / Maximum / Recovery) from the live BPM using a Random Forest classifier.
5. **Records every session** and saves it as structured JSON to disk or a PostgreSQL database.
6. **Visualises sessions** in a React + TypeScript SPA with charts for exercise distribution, fatigue zones, heart rate over time, and rep counts.
7. **Generates AI coaching feedback** for completed sessions via OpenRouter (optional — requires an API key).

---

## Two Tracking Modes

| Mode | How it works | Use case |
|---|---|---|
| **Browser tracker** | MediaPipe WASM runs entirely in the browser. Webcam access via `getUserMedia`. No Python required for tracking. | Primary recommended mode — works from any device with a webcam and browser |
| **Python desktop tracker** | OpenCV captures the webcam server-side. Optional BLE connection to Polar H10. | Local development, research, or when you need hardware BLE integration |

---

## Architecture: How It Works (MediaPipe to Server)

**MediaPipe does NOT run on the server.** It runs entirely in the user's browser. Here is the full pipeline:

### 1. Browser — MediaPipe Pose (WASM)

**File:** `dashboard/frontend/src/hooks/useBrowserTracker.ts`

When you click "Start Tracker":
1. The browser loads `@mediapipe/tasks-vision` from a **CDN** (jsDelivr + Google Storage) — this downloads a `.task` model file and WASM binary into the browser.
2. `navigator.mediaDevices.getUserMedia()` opens your webcam.
3. A `requestAnimationFrame` loop runs continuously, feeding each video frame into `PoseLandmarker.detectForVideo()`.
4. MediaPipe returns **33 pose landmarks** (x, y, z coordinates) for the body.

```
Webcam → <video> element → MediaPipe WASM (in browser) → 33 landmarks
```

### 2. Browser — Exercise Detection & Rep Counting

**File:** `dashboard/frontend/src/hooks/useExerciseDetector.ts`

This is a **TypeScript port** of the Python `tracker/exercise_detector.py`. Runs 100% in the browser:

1. `computeAngles(landmarks)` — calculates 8 joint angles (knee, hip, elbow, shoulder — left/right)
2. `classifyExercise(angles)` — rule-based scoring to determine: Squat / Push-Up / Bicep Curl / etc.
3. `updateRep(state, exercise, angle)` — up/down state machine to count reps

```
Landmarks → Joint Angles → Exercise Classification → Rep Count
```

### 3. Browser → Server: Live Sync (every 1 second)

**File:** `dashboard/frontend/src/hooks/useBrowserTracker.ts` — `onSecondTick()`

Every second, the browser **POSTs a snapshot** to the server:

```
POST /api/live  ← browser sends { bpm, zone, exercise, reps, summary, ... }
```

The server writes this to `data/live.json` (or PostgreSQL) and acts as a **shared state bus** between the tracker and its readers:

- The **chart components** in the same browser (`BpmChart`, `ExerciseChart`, `ZonePieChart`, `RepsTable`) poll `/api/live` via `useLiveSession` to get the accumulated summary (`bpm_history`, `exercise_frame_counts`, `fatigue_zone_distribution`). The tracker itself only maintains O(1) running aggregates in refs — it does not build chart-ready data structures directly.
- **Other tabs or devices** can open the dashboard and observe the session in progress by polling the same endpoint.

This is why the Live Monitoring page shows "Charts loading… First sync in ~1 s." on start — the metric cards update from the tracker's in-memory refs immediately, but the charts wait for the first server response.

Also every second: the browser calls `GET /api/classify-bpm?bpm=X` to get the fatigue zone from the server's ML classifier. If that fails, it falls back to a simple rule-based threshold in the browser.

### 4. Server — FastAPI Backend

**File:** `dashboard/api.py`

The server's responsibilities are minimal:

| Endpoint | What it does |
|---|---|
| `POST /api/live` | Receives live snapshot from browser, saves to `live.json` |
| `GET /api/live` | Returns current `live.json` (polled by other viewers) |
| `GET /api/classify-bpm` | Uses the Python ML model (`HRClassifier`) to predict fatigue zone |
| `POST /api/sessions` | Receives completed session from browser, saves to DB/file |
| `GET /api/sessions` | Lists saved sessions |
| `GET /api/sessions/{id}/insight` | Calls OpenRouter (Gemini) to generate AI coaching feedback |

### 5. Browser → Server: Session Save (on Stop)

When you click "Stop", the browser:
1. Cancels the RAF loop and closes the webcam.
2. Builds a compact session object (aggregates + ~1 BPM sample/second).
3. POSTs it to `POST /api/sessions` — saved to PostgreSQL or `data/sessions/session_*.json`.

### 6. React Dashboard Polling

**File:** `dashboard/frontend/src/hooks/useLiveSession.ts`

The `LivePage` polls `GET /api/live` every second to display live charts. When the browser tracker is running and you are on another tab or device, you still see live data because the browser pushes it to the server.

### Full Data Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    USER'S BROWSER                        │
│                                                          │
│  Webcam                                                  │
│    │                                                     │
│    ▼                                                     │
│  MediaPipe WASM (loaded from CDN)                        │
│    │  33 pose landmarks                                  │
│    ▼                                                     │
│  useExerciseDetector.ts                                  │
│    │  joint angles → exercise → reps                     │
│    ▼                                                     │
│  useBrowserTracker.ts  ─── every 1s ──▶  POST /api/live  │
│                         ─── on stop ──▶  POST /api/sessions
│                         ─── BPM zone ──▶ GET /api/classify-bpm
└─────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────┐
│                  FASTAPI SERVER (Python)                  │
│                                                          │
│  /api/live         → read/write live.json                │
│  /api/sessions     → read/write PostgreSQL or JSON files │
│  /api/classify-bpm → HR classifier (Random Forest ML)   │
│  /api/.../insight  → OpenRouter (Gemini AI)              │
└─────────────────────────────────────────────────────────┘
```

> **Note:** The Python `tracker/` folder (`exercise_detector.py`, `main.py`, etc.) is the **original standalone desktop app**. The web app completely reimplements that detection logic in TypeScript and runs it in the browser. The server only handles storage and the ML classification endpoint.

---

## Project Structure

```
excercise-monitoring-system/
├── tracker/
│   ├── main.py               ← Python desktop tracker (webcam + BLE)
│   ├── exercise_detector.py  ← MediaPipe Pose + joint angles + rep counter
│   ├── hr_classifier.py      ← Random Forest: BPM → fatigue zone
│   ├── session_recorder.py   ← Frame logger + JSON export
│   └── ble_hr_monitor.py     ← Bluetooth LE heart rate monitor (Polar H10)
├── dashboard/
│   ├── api.py                ← FastAPI backend
│   └── frontend/             ← React + TypeScript + Vite SPA
│       └── src/
│           ├── App.tsx            ← Root component + session state
│           ├── LivePage.tsx       ← Browser tracker UI + live charts
│           ├── SessionsPage.tsx   ← Historical session viewer
│           ├── api.ts             ← Typed API client
│           ├── types.ts           ← TypeScript interfaces
│           ├── styles/main.css    ← Full CSS design system
│           ├── components/
│           │   ├── AiInsightCard.tsx   ← AI coaching feedback card
│           │   ├── BpmChart.tsx        ← Heart rate area chart
│           │   ├── ExerciseChart.tsx   ← Exercise bar chart
│           │   ├── Header.tsx          ← Session header + export button
│           │   ├── LiveBanner.tsx      ← Live status bar with BPM sparkline
│           │   ├── MetricCards.tsx     ← 5 KPI metric cards
│           │   ├── RepsTable.tsx       ← Reps per exercise table
│           │   ├── Sidebar.tsx         ← Navigation + session list
│           │   └── ZonePieChart.tsx    ← Fatigue zone donut chart
│           └── hooks/
│               ├── useBrowserTracker.ts   ← Browser-side MediaPipe + session save
│               ├── useExerciseDetector.ts ← Angle computation + rep state machine
│               ├── useLiveSession.ts      ← Poll /api/live every second
│               └── useAutoRefresh.ts      ← Generic polling hook
├── training/
│   └── train_model.py        ← Retrain the HR classifier
├── data/
│   ├── dataset_training_withclass_edited.csv   ← Training dataset
│   └── sessions/             ← Saved session JSON files (auto-created)
├── models/                   ← Serialised model files (auto-created)
├── Dockerfile                ← Multi-stage build (Node frontend + Python backend)
├── railway.json              ← Railway deployment config
├── .env.example              ← Environment variable reference
├── start.sh                  ← Launch API + Python tracker together
└── requirements.txt
```

---

## How Each Part Works

### 1. Browser Tracker (`dashboard/frontend/src/hooks/useBrowserTracker.ts`)

Runs the full tracking pipeline inside the browser — no server-side webcam needed:

- Loads **MediaPipe Pose Lite** WASM from jsDelivr CDN on first start (cached after that).
- Runs pose inference on each animation frame via `PoseLandmarker.detectForVideo`.
- Draws skeleton overlays onto a `<canvas>` (body connectors + landmark dots, face excluded).
- Classifies exercise and updates rep counts every frame using the same angle thresholds as the Python detector.
- **Memory-efficient storage**: runs O(1) aggregate updates per frame (no array growth). One lightweight BPM sample is stored per second (~144 KB/hour vs ~21 MB/hour with per-frame storage).
- Every second: posts a live snapshot to `POST /api/live` for the sidebar and charts.
- On stop: builds a compact session payload from aggregates + per-second samples and saves it via `POST /api/sessions`.
- BPM is entered manually by clicking the BPM field in the camera card header. Zone is fetched from `GET /api/classify-bpm` and falls back to threshold rules if the API is unreachable.

### 2. Heart Rate Zone Classifier (`tracker/hr_classifier.py`)

The classifier is trained on `data/dataset_training_withclass_edited.csv`:

| Column | Description |
|---|---|
| `Average BPM` | Heart rate in beats per minute |
| `Time` | Elapsed seconds in the session |
| `Date` | Date of the workout |
| `fatigue` | Target label: Normal / Aerobic / Anaerobic / Maximum / Recovery |

Four features are engineered from the raw BPM:

| Feature | Formula | Why |
|---|---|---|
| `bpm` | raw value | direct predictor |
| `bpm²` | BPM × BPM | non-linear boundary |
| `log(BPM+1)` | logarithm | compresses high range |
| `bpm/220` | normalised | scale-invariant |

A **Random Forest** with 200 trees and balanced class weights is fitted on an 80/20 train/test split. Model and label encoder are saved to `models/` with `joblib`. If the model file is absent, a rule-based threshold fallback is used automatically (both in the API and in the browser hook).

### 3. Exercise Detector (`tracker/exercise_detector.py`)

MediaPipe Pose returns 33 body landmarks. The detector computes **8 joint angles** using the cosine rule on key joints (hips, knees, ankles, shoulders, elbows, wrists).

Each exercise is scored independently against those angles:

| Exercise | Key signal |
|---|---|
| **Squat** | Average knee angle < 140° with hip also flexed |
| **Push-Up** | Average elbow angle < 140°, shoulders forward (60–100°) |
| **Bicep Curl** | Elbow angle < 100°, shoulder stays straight |
| **Shoulder Press** | Shoulder angle > 150°, elbows partially extended |
| **Jumping Jack** | Shoulder > 130° AND hip > 30° |
| **Running** | Left/right knee angle difference > 20° |
| **Standing** | Both knees and hips > 160° |

Rep counting uses a per-exercise up/down state machine. For example, a Squat rep is counted when the knee angle drops below 90° (bottom) and rises back above 160° (top). The browser hook (`useExerciseDetector.ts`) replicates this logic identically in TypeScript.

### 4. Session Recorder (`tracker/session_recorder.py`)

Used by the Python desktop tracker. Every frame is appended to an in-memory buffer. On save, it calculates a summary (duration, frame counts, max reps, zone distribution, avg/min/max BPM) and writes a single JSON to `data/sessions/session_YYYYMMDD_HHMMSS.json`.

### 5. BLE Heart Rate Monitor (`tracker/ble_hr_monitor.py`)

Connects to a Polar H10 (or any BLE device with Heart Rate Service UUID `0x180D`) via the [`bleak`](https://github.com/hbldh/bleak) async library. Runs in a background daemon thread so the OpenCV loop is never blocked. Auto-reconnects on disconnect. Reads BPM from characteristic `0x2A37` and battery from `0x2A19`.

### 6. Python Desktop Tracker (`tracker/main.py`)

Webcam loop at up to 30 FPS. Pulls BPM from the BLE monitor each frame, runs the exercise detector, predicts fatigue zone, records the frame, and draws a colour-coded HUD.

**Keyboard controls:**

| Key | Action |
|---|---|
| `b` | Override BPM manually — type digits, press Enter |
| `s` | Save session snapshot (recording continues) |
| `r` | Reset all rep counters |
| `q` / Esc | Quit and auto-save the session |

### 7. FastAPI Backend (`dashboard/api.py`)

Serves session data to the React SPA and receives live updates from the browser tracker. Session storage uses **PostgreSQL** when `DATABASE_URL` is set (survives redeployments), otherwise falls back to local JSON files.

**API endpoints:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sessions` | List all sessions (metadata only) |
| `GET` | `/api/sessions/{id}` | Full session JSON including all frames |
| `GET` | `/api/sessions/{id}/summary` | Session summary only |
| `DELETE` | `/api/sessions/{id}` | Permanently delete a session |
| `GET` | `/api/live` | Current live session state (polled every second) |
| `GET` | `/api/live/stream` | SSE stream of live state |
| `POST` | `/api/live` | Browser tracker pushes live snapshot |
| `POST` | `/api/sessions` | Browser tracker saves a completed session |
| `GET` | `/api/classify-bpm?bpm=140` | Predict fatigue zone from BPM |
| `GET` | `/api/sessions/{id}/insight` | AI coaching insight via OpenRouter |
| `GET` | `/api/docs` | Interactive Swagger UI |

### 8. AI Coach Insight (`dashboard/frontend/src/components/AiInsightCard.tsx`)

After a session ends (or when viewing a historical session), an **AI Coach** card appears. Clicking "Analyze Session" calls `GET /api/sessions/{id}/insight`, which:

1. Fetches the session summary from storage.
2. Builds a structured prompt with duration, exercises, reps, BPM stats, and zone distribution.
3. Calls the configured model on [OpenRouter](https://openrouter.ai) (`google/gemini-2.0-flash-001` by default).
4. Returns 3–4 sentences of personalised coaching feedback.
5. Caches the result in memory so the same session isn't re-analyzed on every reload.

Requires `OPENROUTER_API_KEY`. If the key is absent the card shows a disabled message instead of erroring.

### 9. React Dashboard (`dashboard/frontend/`)

A **React + TypeScript SPA** built with Vite and served by FastAPI. Styled with a Tailwind-inspired pure-CSS design system (`src/styles/main.css`) using CSS custom properties.

| View | Feature |
|---|---|
| Live Monitoring | Start/stop browser tracker with webcam preview |
| Live Monitoring | Live metric cards: Exercise, BPM, Zone, Reps (current + total) |
| Live Monitoring | BPM area chart, exercise bar chart, fatigue zone donut, reps table |
| Live Monitoring | Recording status bar with session ID, elapsed time, frame count |
| Sessions | 5 KPI cards: Duration · Avg BPM · Peak BPM · Total Reps · Frames |
| Sessions | Exercise bar chart, fatigue zone donut, BPM timeline, reps table |
| Sessions | AI Coach Insight card with Regenerate option |
| Sessions | Delete sessions from sidebar |
| Both | CSV export (client-side blob, no server round-trip) |
| Both | Sidebar with session list, LIVE badge, session pills |

---

## Quick Start

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Train the HR classifier (one-time)

```bash
python training/train_model.py
```

### 3. Install and build the frontend (one-time, or after any UI change)

```bash
cd dashboard/frontend && npm install && npm run build && cd ../..
```

### 4. Start the API server

```bash
python dashboard/api.py
# Open http://localhost:8000
```

The browser tracker starts from the **Live Monitoring** page in the UI — no extra terminal needed.

---

## Running the System

### Easiest: use the helper script (API + Python desktop tracker)

```bash
bash start.sh
# Open http://localhost:8000
```

### Browser-only mode (API only, tracker runs in the browser)

```bash
python dashboard/api.py
# Open http://localhost:8000 → Live Monitoring → Start Tracker
```

### With the Python desktop tracker + Polar H10 BLE

```bash
# Terminal 1 – API server
python dashboard/api.py

# Terminal 2 – Python tracker, no BLE
python tracker/main.py

# Terminal 2 – Python tracker with Polar H10
python tracker/main.py --ble
# Connect directly by address (faster, skips scan):
python tracker/main.py --ble --ble-address "A0:9E:1A:XX:XX:XX"
```

> To find your Polar H10 address: `python tracker/ble_hr_monitor.py`

### Development mode (hot-reload UI)

**Prerequisites (one-time setup)**

```bash
# 1. Python dependencies
pip install -r requirements.txt

# 2. Train the HR model
python training/train_model.py

# 3. Frontend dependencies
cd dashboard/frontend && npm install && cd ../..
```

**Run dev servers**

```bash
# Terminal 1 – FastAPI backend
python dashboard/api.py
# Runs on http://localhost:8000

# Terminal 2 – Vite dev server (proxies /api → FastAPI automatically)
cd dashboard/frontend && npm run dev
# Open http://localhost:5173

# Terminal 3 – optional Python desktop tracker
python tracker/main.py
# Add --ble for Polar H10 Bluetooth
```

The browser tracker (MediaPipe WASM) runs directly from the Live Monitoring page — Terminal 3 is only needed if you want the Python desktop tracker.

**Environment variables (optional)**

Copy `.env.example` to `.env` for AI coaching or PostgreSQL:

```bash
cp .env.example .env
# Set OPENROUTER_API_KEY to enable the AI Coach insight card
# Set DATABASE_URL for PostgreSQL (defaults to local JSON files)
```

Everything works without these — only the AI Coach card is disabled when `OPENROUTER_API_KEY` is unset.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values you need.

| Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | *(unset)* | Enables the AI Coach feature. Get a key at openrouter.ai. If unset the insight card is disabled — nothing else breaks. |
| `OPENROUTER_MODEL` | `google/gemini-2.0-flash-001` | Any model available on OpenRouter (e.g. `openai/gpt-4o-mini`, `meta-llama/llama-3.1-8b-instruct:free`) |
| `DATABASE_URL` | *(unset)* | PostgreSQL connection string. When set, sessions are stored in the DB instead of local JSON files. Required for production deployments where the filesystem is ephemeral. |
| `PORT` | `8000` | FastAPI listen port. Set automatically by Railway. |

---

## Deployment

### Docker

```bash
# Build image (builds the React frontend inside the container)
docker build -t fittrack-ai .

# Run (file-based session storage)
docker run -p 8000:8000 fittrack-ai

# Run with AI coaching + PostgreSQL
docker run -p 8000:8000 \
  -e OPENROUTER_API_KEY=sk-or-... \
  -e DATABASE_URL=postgresql://user:pass@host:5432/dbname \
  fittrack-ai
```

### Railway

The repository includes `railway.json` which tells Railway to use the `Dockerfile`. To deploy:

1. Push the repo to GitHub.
2. Create a new Railway project → **Deploy from GitHub repo**.
3. Add a **PostgreSQL** service from the Railway dashboard — it automatically sets `DATABASE_URL`.
4. Add `OPENROUTER_API_KEY` in the Railway environment variables panel (optional).
5. Railway builds and deploys automatically on every push to `main`.

---

## Requirements

**Python** (3.9+): `fastapi`, `uvicorn`, `scikit-learn`, `numpy`, `pandas`, `joblib`, `httpx`, `psycopg2-binary`

**Python (desktop tracker only, install separately)**: `mediapipe`, `opencv-python`, `bleak`

**Node.js** (18+): `react`, `react-dom`, `recharts`, `vite`, `typescript`, `@mediapipe/tasks-vision`

**Hardware (desktop mode only)**: Webcam · Bluetooth adapter (for BLE HR monitor)

See [requirements.txt](requirements.txt) and [dashboard/frontend/package.json](dashboard/frontend/package.json) for pinned versions.
