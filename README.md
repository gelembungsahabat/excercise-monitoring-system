# FitTrack AI – Exercise Monitoring System

Real-time exercise tracking and heart-rate zone classification built with **MediaPipe Pose**, **scikit-learn**, **OpenCV**, and **Streamlit**.

---

## What This Project Does

FitTrack AI watches you exercise through your webcam and simultaneously:

1. **Identifies which exercise you are doing** (Squat, Push-Up, Bicep Curl, Shoulder Press, Jumping Jack, Running, or Standing) by analysing the angles of your joints in real time.
2. **Counts your repetitions** automatically using a state machine that tracks the up/down cycle of each movement.
3. **Predicts your fatigue zone** (Normal / Aerobic / Anaerobic / Maximum / Recovery) from your current heart rate using a Random Forest classifier trained on real workout data.
4. **Records every frame** of the session — exercise type, rep count, BPM, fatigue zone, joint angles, and timestamps — and saves it all as a structured JSON file.
5. **Visualises your sessions** in an interactive Streamlit dashboard with charts for exercise distribution, fatigue zones, heart rate over time, and rep counts.

---

## Project Structure

```
FitTrack-AI/
├── src/
│   ├── main.py               ← Live webcam app (start here)
│   ├── exercise_detector.py  ← MediaPipe pose + joint angles + rep counter
│   ├── hr_classifier.py      ← Random Forest: BPM → fatigue zone
│   └── session_recorder.py   ← Frame logger + JSON export
├── dashboard/
│   └── app.py                ← Streamlit session dashboard
├── scripts/
│   └── train_model.py        ← Retrain the HR classifier
├── data/
│   ├── dataset_training_withclass_edited.csv   ← Training dataset
│   └── sessions/             ← Saved session JSON files (auto-created)
├── models/                   ← Serialised model files (auto-created)
├── docs/
│   └── README.md             ← Full technical documentation
└── requirements.txt
```

---

## How Each Part Works

### 1. Heart Rate Zone Classifier (`src/hr_classifier.py`)

The classifier is trained on `data/dataset_training_withclass_edited.csv`, which contains real workout recordings with columns:

| Column | Description |
|--------|-------------|
| `Average BPM` | Heart rate in beats per minute |
| `Time` | Elapsed seconds in the session |
| `Date` | Date of the workout |
| `fatigue` | Target label: Normal / Aerobic / Anaerobic / Maximum / Recovery |

Four features are engineered from the raw BPM to help the model capture both linear and non-linear zone boundaries:

| Feature | Formula | Why |
|---------|---------|-----|
| `bpm` | raw value | direct predictor |
| `bpm²` | BPM × BPM | non-linear boundary |
| `log(BPM+1)` | logarithm | compresses high range |
| `bpm/220` | normalised | scale-invariant |

A **Random Forest** with 200 trees and balanced class weights is fitted on an 80/20 train/test split. The trained model and label encoder are saved to `models/` with `joblib` so they load instantly on subsequent runs. If the model file is absent, the classifier falls back to simple BPM threshold rules.

### 2. Exercise Detector (`src/exercise_detector.py`)

MediaPipe Pose returns 33 body landmarks (x, y, z coordinates normalised to the image size). The detector picks the key joints — hips, knees, ankles, shoulders, elbows, wrists — and computes **8 joint angles** using the cosine rule:

```
angle(A, B, C) = arccos( (BA · BC) / (|BA| × |BC|) )
```

where B is the vertex joint (e.g. knee for the knee angle).

Each exercise is scored independently using hand-crafted rules against those angles:

| Exercise | Key signal |
|----------|-----------|
| **Squat** | Average knee angle < 140° with hip also flexed |
| **Push-Up** | Average elbow angle < 140°, shoulders forward (60–100°) |
| **Bicep Curl** | Elbow angle < 100°, shoulder stays straight |
| **Shoulder Press** | Shoulder angle > 150°, elbows partially extended |
| **Jumping Jack** | Shoulder > 130° AND hip > 30° (arms/legs wide) |
| **Running** | Left/right knee angle difference > 20° |
| **Standing** | Both knees and hips > 160° |

The exercise with the highest score is the prediction. If no exercise scores above 0.15 confidence, it defaults to Standing.

**Rep counting** uses a per-exercise up/down state machine. For example, a Squat rep is counted when the knee angle drops below 90° (bottom) and then rises back above 160° (top). Each exercise has its own pair of thresholds.

### 3. Session Recorder (`src/session_recorder.py`)

Every frame processed by the webcam loop is appended to an in-memory buffer as a record containing:

```
timestamp, session_id, exercise_type, confidence, bpm,
fatigue_zone, rep_count, duration_seconds, joint_angles{...}
```

When you press `s` to save (or `q` to quit), the recorder:
- Calculates a **session summary**: total duration, exercise frame counts, max reps per exercise, fatigue zone distribution, avg/min/max BPM.
- Writes a single JSON file to `data/sessions/session_YYYYMMDD_HHMMSS.json`.

### 4. Main App (`src/main.py`)

The webcam loop runs at up to 30 FPS and:
- Feeds each frame through the exercise detector (pose → angles → exercise + reps).
- Predicts the fatigue zone from the current BPM via the HR classifier.
- Records the frame data.
- Draws a heads-up display on the video with colour-coded fatigue zone, exercise name, rep count, and session timer.

**Keyboard controls:**

| Key | Action |
|-----|--------|
| `b` | Enter BPM — type digits, press Enter to confirm |
| `s` | Save session snapshot (recording continues) |
| `r` | Reset all rep counters |
| `q` / Esc | Quit and auto-save the session |

**Fatigue zone colour coding:**

| Zone | Colour |
|------|--------|
| Normal | Green |
| Aerobic | Cyan |
| Anaerobic | Orange |
| Maximum | Red |
| Recovery | Light blue |

### 5. Streamlit Dashboard (`dashboard/app.py`)

A browser-based dashboard that reads all `session_*.json` files from `data/sessions/`. Select any session from the sidebar dropdown to see:

- **KPI cards** — total workout duration, avg BPM, max BPM, total reps, frame count
- **Exercise bar chart** — how many frames were spent on each exercise
- **Fatigue zone pie chart** — proportion of time in each zone
- **BPM line chart** — heart rate colour-coded by zone over session time
- **Reps table** — max reps achieved per exercise
- **CSV export** — download the session summary with one click

Enable **Auto-refresh (5 s)** in the sidebar to watch the dashboard update live while a session is recording.

---

## Quick Start

```bash
cd FitTrack-AI

# Install dependencies
pip install -r requirements.txt

# Train the HR classifier (only needed once)
python scripts/train_model.py

# Start the live tracking app
python src/main.py

# Open the dashboard in another terminal
streamlit run dashboard/app.py
```

---

## Requirements

- Python 3.9+
- Webcam
- `mediapipe`, `opencv-python`, `scikit-learn`, `numpy`, `pandas`, `joblib`, `streamlit`, `plotly`

See [requirements.txt](FitTrack-AI/requirements.txt) and the full technical docs in [docs/README.md](FitTrack-AI/docs/README.md).
