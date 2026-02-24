# FitTrack AI

> Real-time exercise tracking and heart-rate zone classification powered by
> MediaPipe Pose and scikit-learn.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Installation](#installation)
4. [How to Run Each Component](#how-to-run-each-component)
5. [Dataset Explanation](#dataset-explanation)
6. [Exercise Detection Logic](#exercise-detection-logic)
7. [API / Function Reference](#api--function-reference)
8. [Example Output](#example-output)
9. [Troubleshooting](#troubleshooting)

---

## Project Overview

FitTrack AI is a Python application that:

- **Detects exercises** in real time using your webcam and Google's MediaPipe Pose
- **Counts repetitions** using a per-exercise up/down state machine
- **Classifies fatigue zones** (Normal → Aerobic → Anaerobic → Maximum) from heart-rate
  BPM using a trained Random Forest classifier
- **Records sessions** frame-by-frame and exports them as structured JSON
- **Visualises sessions** through an interactive Streamlit dashboard

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FitTrack AI System                   │
│                                                         │
│  ┌──────────┐    BGR frames    ┌───────────────────┐    │
│  │  Webcam  │ ───────────────► │ ExerciseDetector  │    │
│  │ (OpenCV) │                  │  (MediaPipe Pose) │    │
│  └──────────┘                  │  • Joint angles   │    │
│                                │  • Exercise class │    │
│                                │  • Rep counter    │    │
│                                └────────┬──────────┘    │
│                                         │               │
│  ┌──────────────────┐                   │               │
│  │   HRClassifier   │◄── BPM input ─────┤               │
│  │  (Random Forest) │                   │               │
│  │  • Fatigue zone  │                   │               │
│  └────────┬─────────┘                   │               │
│           │                             │               │
│           └──────────┬──────────────────┘               │
│                      ▼                                  │
│           ┌──────────────────┐                          │
│           │ SessionRecorder  │                          │
│           │ • Frame buffer   │                          │
│           │ • JSON export    │                          │
│           └────────┬─────────┘                          │
│                    │                                    │
│                    ▼                                    │
│           data/sessions/*.json                          │
│                    │                                    │
│                    ▼                                    │
│           ┌──────────────────┐                          │
│           │ Streamlit Dash   │                          │
│           │ • Charts         │                          │
│           │ • CSV export     │                          │
│           └──────────────────┘                          │
└─────────────────────────────────────────────────────────┘
```

### Project Structure

```
FitTrack-AI/
├── src/
│   ├── main.py               ← Webcam loop entry point
│   ├── exercise_detector.py  ← MediaPipe + angle thresholds + rep counter
│   ├── hr_classifier.py      ← Random Forest BPM → fatigue zone
│   └── session_recorder.py   ← Frame logging + JSON persistence
├── dashboard/
│   └── app.py                ← Streamlit dashboard
├── scripts/
│   └── train_model.py        ← Standalone training script
├── data/
│   ├── dataset_training_withclass_edited.csv   ← Training data
│   └── sessions/             ← Saved session JSON files
├── models/
│   ├── hr_classifier.pkl     ← Serialised Random Forest
│   └── label_encoder.pkl     ← Serialised LabelEncoder
├── docs/
│   └── README.md             ← This file
└── requirements.txt
```

---

## Installation

### Prerequisites

- Python 3.9 or newer
- A working webcam (for the main app)
- pip

### Steps

```bash
# 1. Clone / enter the project directory
cd FitTrack-AI

# 2. Create a virtual environment (recommended)
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Train the HR classifier (first run)
python scripts/train_model.py
```

> **macOS users**: `mediapipe` requires `pip install mediapipe` with Python ≤ 3.11.
> On Apple Silicon you may need `pip install mediapipe-silicon` instead.

---

## How to Run Each Component

### 1. Train the HR Classifier

```bash
python scripts/train_model.py

# Options:
python scripts/train_model.py --estimators 300 --seed 0
python scripts/train_model.py --data path/to/custom.csv --no-plot
```

The script prints a classification report, an ASCII feature-importance chart,
and a table of sample predictions.

### 2. Main App (webcam)

```bash
python src/main.py

# Use a different camera:
python src/main.py --camera 1

# Force retrain before starting:
python src/main.py --train
```

**Keyboard controls while the app is running:**

| Key | Action |
|-----|--------|
| `b` | Enter BPM input mode (type digits → Enter to confirm) |
| `s` | Manually save the current session (recording continues) |
| `r` | Reset all rep counters |
| `q` / `Esc` | Quit and auto-save session |

### 3. Streamlit Dashboard

```bash
streamlit run dashboard/app.py
```

Open `http://localhost:8501` in your browser.

- Select a session from the sidebar dropdown
- Enable **Auto-refresh** while recording is active to see live updates

### 4. HR Classifier (standalone)

```python
from src.hr_classifier import HRClassifier

clf = HRClassifier()
clf.train()                        # trains and saves to models/
zone = clf.predict(145)            # → "Anaerobic"
proba = clf.predict_proba(145)     # → {"Normal": 0.01, "Anaerobic": 0.87, ...}
```

---

## Dataset Explanation

**File:** `data/dataset_training_withclass_edited.csv`

| Column | Type | Description |
|--------|------|-------------|
| `Average BPM` | float | Heart-rate in beats per minute |
| `Time (hh:mm:ss)` / `Time` | float | Elapsed seconds within the workout session |
| `Date` | date | Date of the recorded workout |
| `fatigue` | string | Target label: `Normal`, `Aerobic`, `Anaerobic`, `Maximum`, `Recovery` |

### How the CSV is used

1. `HRClassifier._load_data()` reads the CSV, drops rows with missing `Average BPM`
   or `fatigue`, and coerces numeric types.
2. `_build_features()` engineers four features from the raw BPM column:

   | Feature | Formula | Rationale |
   |---------|---------|-----------|
   | `bpm`      | raw value | direct predictor |
   | `bpm_sq`   | BPM² | non-linear boundary capture |
   | `bpm_log`  | log(BPM + 1) | compress high-end range |
   | `bpm_norm` | BPM / max_BPM | scale-invariant |

3. A `LabelEncoder` converts string zone labels to integers for scikit-learn.
4. A `RandomForestClassifier` with `class_weight="balanced"` is fitted on an
   80/20 train/test split.

### Fatigue zone definitions (approx. BPM ranges)

| Zone | Typical BPM | Intensity |
|------|-------------|-----------|
| Recovery | < 90 | Very light, cool-down |
| Normal | 90–109 | Resting / light activity |
| Aerobic | 110–129 | Fat-burning, sustainable |
| Anaerobic | 130–149 | High-intensity, lactic acid zone |
| Maximum | ≥ 150 | Near-maximal effort |

---

## Exercise Detection Logic

### MediaPipe Pose Landmarks

MediaPipe returns 33 normalised body landmarks (x, y, z ∈ [0, 1]).
The detector uses:

- `LEFT_HIP`, `RIGHT_HIP`
- `LEFT_KNEE`, `RIGHT_KNEE`
- `LEFT_ANKLE`, `RIGHT_ANKLE`
- `LEFT_SHOULDER`, `RIGHT_SHOULDER`
- `LEFT_ELBOW`, `RIGHT_ELBOW`
- `LEFT_WRIST`, `RIGHT_WRIST`

### Angle Calculation

Each joint angle is computed using the cosine rule over three landmark coordinates:

```
angle(A, B, C) = arccos( (BA · BC) / (|BA| × |BC|) )
```

where B is the vertex joint.

### Rule-Based Exercise Classification

The `_classify_exercise()` function scores each exercise independently from
the 8 computed joint angles and returns the highest-scoring class with its
confidence value:

| Exercise | Primary cue | Threshold |
|----------|-------------|-----------|
| Squat | avg knee angle | < 140° → in squat |
| Push-Up | avg elbow angle | < 140° + shoulder 60–100° |
| Bicep Curl | avg elbow angle | < 100° |
| Shoulder Press | avg shoulder angle | > 150° |
| Jumping Jack | shoulder + hip spread | shoulder > 130°, hip > 30° |
| Running | knee asymmetry | |L_knee − R_knee| > 20° |
| Standing | knee + hip straight | both > 160° |

### Rep Counter State Machine

Each exercise uses an **up/down state machine**:

```
        ┌──────────────────────────────────────┐
        │            Up state                  │
        │  (starting position, angle > up_thr) │
        └──────────────┬───────────────────────┘
                       │ angle drops below down_thr
                       ▼
        ┌──────────────────────────────────────┐
        │            Down state                │
        │  (bottom position)                   │
        └──────────────┬───────────────────────┘
                       │ angle rises above up_thr
                       ▼  (+1 rep counted)
                  Back to Up state
```

Thresholds per exercise:

| Exercise | Down threshold | Up threshold |
|----------|---------------|-------------|
| Squat | knee < 90° | knee > 160° |
| Push-Up | elbow < 90° | elbow > 160° |
| Bicep Curl | elbow < 50° (curled) | elbow > 160° |
| Shoulder Press | shoulder < 80° | shoulder > 160° |
| Jumping Jack | shoulder < 30° | shoulder > 150° |
| Running | knee < 60° | knee > 140° |

---

## API / Function Reference

### `src/hr_classifier.py`

#### `HRClassifier`

| Method | Signature | Description |
|--------|-----------|-------------|
| `train` | `(test_size, random_state, n_estimators) → dict` | Train & save model, return accuracy + report |
| `predict` | `(bpm: float) → str` | Predict fatigue zone from BPM |
| `predict_proba` | `(bpm: float) → dict[str, float]` | Return class probabilities |
| `get_zone_color` | `(zone: str) → tuple[int,int,int]` | BGR colour for OpenCV overlay |
| `is_loaded` | `() → bool` | True if a model is ready |

#### Module-level constants

| Name | Type | Description |
|------|------|-------------|
| `ZONE_COLORS` | `dict[str, tuple]` | BGR colour map per zone |
| `DATA_PATH` | `Path` | Default CSV path |
| `MODEL_PATH` | `Path` | Default model output path |

---

### `src/exercise_detector.py`

#### `ExerciseDetector`

| Method | Signature | Description |
|--------|-----------|-------------|
| `process_frame` | `(frame: ndarray) → (annotated, exercise, confidence, reps)` | Run full inference on one BGR frame |
| `get_rep_count` | `(exercise=None) → int` | Rep count for given (or current) exercise |
| `get_all_reps` | `() → dict[str, int]` | All exercise rep counts |
| `reset_reps` | `(exercise=None)` | Reset counters |
| `get_joint_angles` | `() → dict[str, float]` | Current angles as plain dict |
| `close` | `()` | Release MediaPipe resources |

#### `JointAngles` dataclass

Fields: `left_knee`, `right_knee`, `left_hip`, `right_hip`,
`left_elbow`, `right_elbow`, `left_shoulder`, `right_shoulder` (all float, degrees)

#### `RepCounter` dataclass

Fields: `exercise`, `count`, `stage` | Method: `update(angle)`, `reset()`

---

### `src/session_recorder.py`

#### `SessionRecorder`

| Method | Signature | Description |
|--------|-----------|-------------|
| `start` | `(session_id=None) → str` | Begin a new session |
| `record_frame` | `(exercise_type, confidence, bpm, fatigue_zone, rep_count, joint_angles)` | Buffer one frame |
| `stop_and_save` | `() → dict` | Finalise, write JSON, return summary |
| `get_live_summary` | `() → dict` | Partial summary during recording |
| `elapsed_seconds` | `() → float` | Seconds since session start |

Static methods:

| Method | Description |
|--------|-------------|
| `load_session(path)` | Load and return a session JSON |
| `list_sessions(dir)` | Return sorted list of session Paths |

---

### `dashboard/app.py`

Pure Streamlit app – no public API. Run with `streamlit run dashboard/app.py`.

Reads all `session_*.json` files from `data/sessions/` and renders:
- Metric cards (duration, avg BPM, max BPM, total reps, frame count)
- Exercise bar chart (Plotly)
- Fatigue zone pie chart (Plotly)
- BPM over time line chart (Plotly)
- Reps-per-exercise table
- CSV export download button

---

## Example Output

### Training script output

```
════════════════════════════════════════════════════════════
  FitTrack AI – HR Classifier Training
════════════════════════════════════════════════════════════
  Dataset  : data/dataset_training_withclass_edited.csv
  Model out: models/hr_classifier.pkl
  Estimators: 200   Test size: 0.2   Seed: 42
────────────────────────────────────────────────────────────
  Accuracy : 0.9412  (94.12%)

Classification Report

               precision    recall  f1-score   support
      Aerobic       0.93      0.96      0.94       47
    Anaerobic       0.96      0.94      0.95      107
      Maximum       0.91      0.95      0.93       22
       Normal       0.97      0.94      0.95       35
     Recovery       1.00      1.00      1.00        6

     accuracy                           0.94      217
    macro avg       0.95      0.96      0.95      217
 weighted avg       0.94      0.94      0.94      217

Feature Importances
────────────────────────────────────────────────────────────
  BPM              │████████████████████████████████████████│ 0.4821
  BPM²             │██████████████████████░░░░░░░░░░░░░░░░░░│ 0.3247
  log(BPM+1)       │████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ 0.1198
  BPM/220          │████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ 0.0734

Sample Predictions
────────────────────────────────────────────────────────────
    BPM  │  Zone          │  Probabilities
────────────────────────────────────────────────────────────
     60  │  Recovery      │  Recovery=0.98  Normal=0.02
     90  │  Normal        │  Normal=0.91    Recovery=0.09
    110  │  Aerobic       │  Aerobic=0.88   Normal=0.12
    125  │  Aerobic       │  Aerobic=0.79   Anaerobic=0.21
    140  │  Anaerobic     │  Anaerobic=0.93 Aerobic=0.07
    160  │  Maximum       │  Maximum=0.96   Anaerobic=0.04
    180  │  Maximum       │  Maximum=1.00
```

### Session JSON structure

```json
{
  "session_id": "session_20240101_120000",
  "start_time": "2024-01-01T12:00:00",
  "end_time":   "2024-01-01T12:05:00",
  "duration_seconds": 300.0,
  "frames": [
    {
      "timestamp": "2024-01-01T12:00:01.123",
      "session_id": "session_20240101_120000",
      "exercise_type": "Squat",
      "confidence": 0.82,
      "bpm": 135,
      "fatigue_zone": "Anaerobic",
      "rep_count": 3,
      "duration_seconds": 1.0,
      "joint_angles": {
        "left_knee": 88.4,
        "right_knee": 91.2,
        "left_hip": 95.1,
        "right_hip": 93.8,
        "left_elbow": 172.0,
        "right_elbow": 169.5,
        "left_shoulder": 78.3,
        "right_shoulder": 81.1
      }
    }
  ],
  "summary": {
    "total_duration_seconds": 300.0,
    "exercises_detected": ["Squat", "Standing"],
    "max_reps_per_exercise": {"Squat": 12, "Standing": 0},
    "fatigue_zone_distribution": {"Anaerobic": 180, "Aerobic": 120},
    "avg_bpm": 135.0,
    "max_bpm": 148,
    "min_bpm": 122
  }
}
```

---

## Troubleshooting

### Camera not opening

```
Error: Cannot open camera index 0
```

- Try `--camera 1` or `--camera 2`
- On macOS: grant Terminal/IDE camera access in System Preferences → Privacy
- Ensure no other app has the camera open

### MediaPipe import error

```
ImportError: No module named 'mediapipe'
```

```bash
pip install mediapipe
# Apple Silicon:
pip install mediapipe-silicon
```

### Dataset not found

```
FileNotFoundError: Dataset not found at data/dataset_training_withclass_edited.csv
```

Make sure you run scripts from the `FitTrack-AI/` root directory, or pass `--data`
with the full path.

### Low exercise detection confidence

- Ensure your **full body is visible** in the frame (especially for Squats)
- Use **good lighting** – MediaPipe struggles in low-light conditions
- Stand **2–3 metres** from the camera for best pose coverage
- For Push-Ups: a **side-on** camera angle works best

### Streamlit dashboard shows "No sessions found"

- Record at least one session with the main app first
- Confirm that `data/sessions/` contains `session_*.json` files
- Check the path printed in the sidebar footer

### Model accuracy is low after retraining

- Verify the CSV has sufficient examples per class (`df["fatigue"].value_counts()`)
- Try increasing `--estimators 400` or adjusting `--test-size 0.15`
- Classes with very few samples may benefit from collecting more data
