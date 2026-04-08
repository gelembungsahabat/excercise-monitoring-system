# Exercise Monitoring System

Real-time exercise tracking and heart-rate zone classification built with **MediaPipe Pose**, **scikit-learn**, **OpenCV**, **React + TypeScript**, and **Bluetooth LE** (Polar H10 / any standard BLE HR monitor).

---

## What This Project Does

Exercise Monitoring System watches you exercise through your webcam and simultaneously:

1. **Identifies which exercise you are doing** (Squat, Push-Up, Bicep Curl, Shoulder Press, Jumping Jack, Running, or Standing) by analysing the angles of your joints in real time.
2. **Counts your repetitions** automatically using a state machine that tracks the up/down cycle of each movement.
3. **Reads your heart rate live** from a Polar H10 (or any Bluetooth LE HR monitor) via the standard BLE Heart Rate Service — no manual input needed.
4. **Predicts your fatigue zone** (Normal / Aerobic / Anaerobic / Maximum / Recovery) from the live BPM using a Random Forest classifier trained on real workout data.
5. **Records every frame** of the session — exercise type, rep count, BPM, fatigue zone, joint angles, and timestamps — and saves it all as a structured JSON file.
6. **Visualises your sessions** in a React + TypeScript SPA dashboard (served by a FastAPI backend) with charts for exercise distribution, fatigue zones, heart rate over time, and rep counts.

---

## Project Structure

```
excercise-monitoring-system/
├── tracker/
│   ├── main.py               ← Live webcam app (start here)
│   ├── exercise_detector.py  ← MediaPipe pose + joint angles + rep counter
│   ├── hr_classifier.py      ← Random Forest: BPM → fatigue zone
│   ├── session_recorder.py   ← Frame logger + JSON export
│   └── ble_hr_monitor.py     ← Bluetooth LE heart rate monitor (Polar H10)
├── dashboard/
│   ├── api.py                ← FastAPI backend (serves session data + SPA)
│   └── frontend/             ← React + TypeScript + Vite SPA
│       ├── src/
│       │   ├── App.tsx       ← Root component + state
│       │   ├── api.ts        ← API client
│       │   ├── types.ts      ← TypeScript interfaces
│       │   ├── styles/main.css  ← Full CSS design system
│       │   ├── components/   ← Sidebar, Header, charts, table
│       │   └── hooks/        ← useLiveSession
│       ├── package.json
│       └── vite.config.ts
├── training/
│   └── train_model.py        ← Retrain the HR classifier
├── data/
│   ├── dataset_training_withclass_edited.csv   ← Training dataset
│   └── sessions/             ← Saved session JSON files (auto-created)
├── models/                   ← Serialised model files (auto-created)
├── start.sh                  ← Launch API + tracker together
└── requirements.txt
```

---

## How Each Part Works

### 1. Heart Rate Zone Classifier (`tracker/hr_classifier.py`)

The classifier is trained on `data/dataset_training_withclass_edited.csv`, which contains real workout recordings with columns:

| Column        | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| `Average BPM` | Heart rate in beats per minute                                  |
| `Time`        | Elapsed seconds in the session                                  |
| `Date`        | Date of the workout                                             |
| `fatigue`     | Target label: Normal / Aerobic / Anaerobic / Maximum / Recovery |

Four features are engineered from the raw BPM to help the model capture both linear and non-linear zone boundaries:

| Feature      | Formula    | Why                   |
| ------------ | ---------- | --------------------- |
| `bpm`        | raw value  | direct predictor      |
| `bpm²`       | BPM × BPM  | non-linear boundary   |
| `log(BPM+1)` | logarithm  | compresses high range |
| `bpm/220`    | normalised | scale-invariant       |

A **Random Forest** with 200 trees and balanced class weights is fitted on an 80/20 train/test split. The trained model and label encoder are saved to `models/` with `joblib` so they load instantly on subsequent runs. If the model file is absent, the classifier falls back to simple BPM threshold rules.

### 2. Exercise Detector (`tracker/exercise_detector.py`)

MediaPipe Pose returns 33 body landmarks (x, y, z coordinates normalised to the image size). The detector picks the key joints — hips, knees, ankles, shoulders, elbows, wrists — and computes **8 joint angles** using the cosine rule:

```
angle(A, B, C) = arccos( (BA · BC) / (|BA| × |BC|) )
```

where B is the vertex joint (e.g. knee for the knee angle).

Each exercise is scored independently using hand-crafted rules against those angles:

| Exercise           | Key signal                                              |
| ------------------ | ------------------------------------------------------- |
| **Squat**          | Average knee angle < 140° with hip also flexed          |
| **Push-Up**        | Average elbow angle < 140°, shoulders forward (60–100°) |
| **Bicep Curl**     | Elbow angle < 100°, shoulder stays straight             |
| **Shoulder Press** | Shoulder angle > 150°, elbows partially extended        |
| **Jumping Jack**   | Shoulder > 130° AND hip > 30° (arms/legs wide)          |
| **Running**        | Left/right knee angle difference > 20°                  |
| **Standing**       | Both knees and hips > 160°                              |

The exercise with the highest score is the prediction. If no exercise scores above 0.15 confidence, it defaults to Standing.

**Rep counting** uses a per-exercise up/down state machine. For example, a Squat rep is counted when the knee angle drops below 90° (bottom) and then rises back above 160° (top). Each exercise has its own pair of thresholds.

### 3. Session Recorder (`tracker/session_recorder.py`)

Every frame processed by the webcam loop is appended to an in-memory buffer as a record containing:

```
timestamp, session_id, exercise_type, confidence, bpm,
fatigue_zone, rep_count, duration_seconds, joint_angles{...}
```

When you press `s` to save (or `q` to quit), the recorder:

- Calculates a **session summary**: total duration, exercise frame counts, max reps per exercise, fatigue zone distribution, avg/min/max BPM.
- Writes a single JSON file to `data/sessions/session_YYYYMMDD_HHMMSS.json`.

### 4. BLE Heart Rate Monitor (`tracker/ble_hr_monitor.py`)

Connects to a Polar H10 (or any Bluetooth LE device that implements the standard **Heart Rate Service, UUID 0x180D**) and streams real-time BPM data to the main app.

**How it works:**

- Uses the [`bleak`](https://github.com/hbldh/bleak) library — a cross-platform async BLE client.
- The BLE asyncio event loop runs in a **background daemon thread** so the OpenCV main loop is never blocked.
- Parses the **Heart Rate Measurement characteristic (UUID 0x2A37)** to extract BPM and RR-intervals.
- Also reads the **Battery Level characteristic (UUID 0x2A19)** and shows it in the HUD.
- **Auto-reconnects** if the strap disconnects — no manual restart needed.
- All shared state (BPM, status, battery) is protected by a `threading.Lock`.

**Connection states shown in the HUD:**

| State        | Indicator colour | HUD text              |
| ------------ | ---------------- | --------------------- |
| Connected    | Green            | `BLE  CONNECTED`      |
| Scanning     | Yellow           | `BLE  SCANNING...`    |
| Connecting   | Yellow           | `BLE  CONNECTING...`  |
| Offline      | Grey             | `BLE  OFFLINE`        |

**BPM source label** in the bottom panel:

| Source          | Label        | Colour |
| --------------- | ------------ | ------ |
| BLE (live)      | `BPM: 142 [BLE]` | Green  |
| Manual override | `BPM: 120 [MAN]` | White  |

### 5. Main App (`tracker/main.py`)

The webcam loop runs at up to 30 FPS and:

- Pulls live BPM from the BLE monitor each frame (when connected).
- Feeds each frame through the exercise detector (pose → angles → exercise + reps).
- Predicts the fatigue zone from the current BPM via the HR classifier.
- Records the frame data.
- Draws a heads-up display on the video with colour-coded fatigue zone, exercise name, rep count, BLE status pill, and session timer.

**Keyboard controls:**

| Key       | Action                                                             |
| --------- | ------------------------------------------------------------------ |
| `b`       | Override BPM manually — type digits, press Enter to confirm        |
| `s`       | Save session snapshot (recording continues)                        |
| `r`       | Reset all rep counters                                             |
| `q` / Esc | Quit and auto-save the session                                     |

> In BLE mode, pressing `b` sets a manual override. The BLE reading takes over again as soon as the next notification arrives.

**Fatigue zone colour coding:**

| Zone      | Colour     |
| --------- | ---------- |
| Normal    | Green      |
| Aerobic   | Cyan       |
| Anaerobic | Orange     |
| Maximum   | Red        |
| Recovery  | Light blue |

### 6. React Dashboard (`dashboard/`)

A **React + TypeScript SPA** built with Vite and served by a **FastAPI** backend. Styled with a Tailwind-inspired pure-CSS design system using CSS custom properties.

**Backend** (`dashboard/api.py`):
- `GET /api/sessions` — list all sessions (lightweight metadata, no frames)
- `GET /api/sessions/{id}` — full session JSON including all frames
- `GET /api/live` — current live session state (polled every second by the frontend)
- Serves the built React app as static files in production

**Frontend** (`dashboard/frontend/`):

| View | Feature | Details |
| ---- | ------- | ------- |
| Live Monitoring | Real-time metric cards | Current exercise, BPM, zone, reps, total reps |
| Live Monitoring | Live BPM chart | Area chart updating every second (Recharts) |
| Live Monitoring | Exercise distribution | Bar chart of detected exercises |
| Live Monitoring | Fatigue zone breakdown | Donut chart, colour-coded by zone |
| Live Monitoring | Reps table | Live rep counts per exercise |
| Sessions | 5 KPI metric cards | Duration · Avg BPM · Peak BPM · Total Reps · Frames |
| Sessions | Exercise bar chart | Horizontal bars, frame count per exercise |
| Sessions | Fatigue zone donut | Colour-coded by zone (Recharts) |
| Sessions | BPM timeline | Area chart with zone threshold reference lines |
| Sessions | Reps table | Sorted by max reps, progress bars |
| Both | CSV export | Client-side blob download, no server round-trip |
| Both | Sidebar navigation | Live Monitoring / Sessions menu with LIVE badge |

**CSS design system** (`src/styles/main.css`):
- Tailwind-inspired tokens: `--brand`, `--zone-*`, `--sh-*` (shadow scale), `--r-*` (radius scale)
- BEM-like class naming, organised into 18 labelled sections
- Dark sidebar (`#111827`), light content area (`#f9fafb`), white cards
- Responsive grid: 5-col metrics → 3-col → 2-col → 1-col at breakpoints

---

## Quick Start

### 1. Install dependencies (one-time)

```bash
# Python dependencies
pip install -r requirements.txt

# Frontend dependencies
cd dashboard/frontend && npm install && cd ../..
```

### 2. Build the frontend (one-time, or after any UI change)

```bash
cd dashboard/frontend && npm run build && cd ../..
```

### 3. Train the HR classifier (one-time)

```bash
python training/train_model.py
```

---

## Running the System

### Easiest: use the helper script

`start.sh` launches the API server and the webcam tracker together. Press `Ctrl+C` to stop both.

```bash
bash start.sh
# Open http://localhost:8000
```

### Manual: two terminals

```bash
# Terminal 1 – dashboard API + frontend
python dashboard/api.py
# Open http://localhost:8000

# Terminal 2 – webcam tracker (no BLE)
python tracker/main.py

# Terminal 2 – webcam tracker with Polar H10
python tracker/main.py --ble
# Or connect directly by address (faster):
python tracker/main.py --ble --ble-address "A0:9E:1A:XX:XX:XX"
```

> To find your Polar H10 address (one-time): `python tracker/ble_hr_monitor.py`

### Development mode (hot-reload UI)

```bash
# Terminal 1 – API server
python dashboard/api.py

# Terminal 2 – Vite dev server (proxies /api to FastAPI)
cd dashboard/frontend && npm run dev
# Open http://localhost:5173

# Terminal 3 – webcam tracker
python tracker/main.py
```

---

## Keyboard Controls (during tracker session)

| Key | Action |
| --- | ------ |
| `b` | Override BPM manually — type digits, press Enter |
| `s` | Save a session snapshot (recording continues) |
| `r` | Reset all rep counters |
| `q` / Esc | Quit and auto-save the session |

---

## Requirements

**Python** (3.9+): `mediapipe`, `opencv-python`, `scikit-learn`, `numpy`, `pandas`, `joblib`, `fastapi`, `uvicorn`, `bleak`

**Node.js** (18+): `react`, `react-dom`, `recharts`, `vite`, `typescript`

**Hardware**: Webcam · Bluetooth adapter (for BLE HR monitor)

See [requirements.txt](requirements.txt) for Python deps and [dashboard/frontend/package.json](dashboard/frontend/package.json) for Node deps.
