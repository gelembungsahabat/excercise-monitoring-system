# FitTrack AI — Educational Overview

> Prepared for academic presentation. Covers project scope, technology concepts, and talking points for each component.

---

## Project Summary

FitTrack AI is a **real-time exercise monitoring system** that combines computer vision, machine learning, IoT hardware, and full-stack web development into one end-to-end pipeline.

The system watches a user exercise through a webcam, reads live heart rate from a Bluetooth LE chest strap, classifies fatigue intensity with a trained ML model, counts repetitions automatically, records every session frame-by-frame, and visualises all data in a live React dashboard.

---

## Topics Covered

### Machine Learning & Data Science

| Concept | Where applied |
|---|---|
| Supervised classification | Random Forest predicting 5 fatigue zones from BPM |
| Feature engineering | 4 features derived from a single raw BPM value |
| Train/test split (80/20, stratified) | `scripts/train_model.py` |
| Class imbalance handling | `class_weight="balanced"` in RandomForestClassifier |
| Model evaluation | `classification_report` + accuracy score on test set |
| Model persistence | `joblib` serialisation to `models/` — no retraining on each run |
| Graceful degradation | Rule-based BPM threshold fallback when model file is missing |

**Feature engineering rationale** — four features are engineered from the raw BPM to expose both linear and non-linear zone boundaries to the classifier:

| Feature | Formula | Purpose |
|---|---|---|
| `bpm` | raw value | direct linear predictor |
| `bpm²` | BPM × BPM | captures quadratic zone boundaries |
| `log(BPM + 1)` | natural log | compresses the high-BPM range |
| `bpm / 220` | normalised | scale-invariant, near [0, 1] |

---

### Computer Vision & Signal Processing

| Concept | Where applied |
|---|---|
| Pose estimation | MediaPipe Pose — 33 body landmarks from webcam frames |
| Geometric angle computation | Cosine-rule on landmark triples for 8 joint angles |
| Real-time video processing | OpenCV loop up to 30 FPS |
| Rule-based classification | Scored confidence per exercise, winner-take-all with confidence gate |
| State machine | Per-exercise up/down rep counter with angle thresholds |

**Joint angle formula** used in `src/exercise_detector.py`:

```
angle(A, B, C) = arccos( (BA · BC) / (|BA| × |BC|) )
```

Where B is the vertex joint (e.g. the knee for the knee angle). Computed for: left/right knee, hip, elbow, and shoulder — 8 angles per frame.

**Exercise classification logic:**

| Exercise | Key signal |
|---|---|
| Squat | Avg knee angle < 140°, hip also flexed |
| Push-Up | Avg elbow angle < 140°, shoulder angle 60–100° |
| Bicep Curl | Elbow angle < 100°, shoulder stays straight (> 140°) |
| Shoulder Press | Shoulder angle > 150°, elbow partially extended |
| Jumping Jack | Shoulder > 130° AND hip > 30° (wide), or both < threshold (closed) |
| Running | Asymmetric knee angles (|left − right| > 20°) |
| Standing | Both knees and hips > 160° |

**Rep counting** uses a per-exercise state machine. Example for Squat:
- Knee angle drops below 90° → enter `"down"` state
- Knee angle rises above 160° → enter `"up"` state → increment rep count

---

### Software Engineering & Architecture

```
src/main.py              ← Webcam loop, integrates all modules
src/exercise_detector.py ← MediaPipe pose + angles + rep counter
src/hr_classifier.py     ← Random Forest: BPM → fatigue zone
src/session_recorder.py  ← Frame logger + JSON export + live state
src/ble_hr_monitor.py    ← Bluetooth LE heart rate monitor (Polar H10)
dashboard/api.py         ← FastAPI REST backend + SPA serving
dashboard/frontend/      ← React + TypeScript SPA (Vite)
scripts/train_model.py   ← Standalone model retraining script
```

| Concept | Where applied |
|---|---|
| Modular design | 4 independent, importable modules wired by `main.py` |
| Separation of concerns | Detection, classification, recording, and display are separate layers |
| Multithreading | BLE client runs in a background daemon thread; main OpenCV loop is never blocked |
| Thread safety | Shared BPM/status state protected with `threading.Lock` |
| Async I/O | `bleak` BLE client uses `asyncio` inside the background thread |
| REST API design | FastAPI with clear endpoints: `/api/sessions`, `/api/sessions/{id}`, `/api/live` |
| Real-time state sharing | `data/live.json` written at ~1 Hz by the tracker; frontend polls it every second |

---

### Full-Stack Web Development

| Layer | Technology | Role |
|---|---|---|
| Backend | FastAPI (Python) | REST API, static file serving |
| Frontend | React + TypeScript + Vite | Single-page application |
| Charts | Recharts | Area, bar, donut, table |
| Styling | Custom CSS design system | Token-based variables, BEM classes, responsive grid |
| Build | Vite | Dev server with proxy, production bundle |

**API endpoints:**

| Method | Path | Returns |
|---|---|---|
| GET | `/api/sessions` | List of session metadata (no frames) |
| GET | `/api/sessions/{id}` | Full session JSON including all frames |
| GET | `/api/live` | Current live session state (or `{"status":"idle"}`) |

**Frontend features:**
- Live Monitoring page — polls `/api/live` every second, renders metric cards + 4 charts updating in real time
- Sessions page — browse past sessions, load full frame data, visualise with the same chart suite
- Sidebar navigation — switches between Live and Sessions views; auto-switches to Sessions when a live session ends
- CSV export — client-side `Blob` download, no server round-trip

---

### IoT & Bluetooth LE

| Concept | Where applied |
|---|---|
| BLE standard services | Heart Rate Service UUID `0x180D` |
| BLE characteristic parsing | Heart Rate Measurement `0x2A37` → BPM and RR-intervals |
| Battery monitoring | Battery Level characteristic `0x2A19` |
| Auto-reconnect | Retries connection automatically if strap disconnects mid-session |
| Cross-platform BLE | `bleak` library (works on macOS, Windows, Linux) |

---

## Strengths to Highlight

| Strength | Why it matters |
|---|---|
| End-to-end pipeline | Raw sensor data → ML prediction → web visualisation in one coherent system |
| Real-world dataset | Trained on actual workout heart-rate recordings, not synthetic or toy data |
| Two detection strategies | ML for HR zones (data-driven, probabilistic), rule-based for exercises (interpretable, no training data needed) — right tool for each problem |
| Graceful degradation | Rule-based fallback if model is missing; BLE offline mode with manual BPM override |
| Feature engineering rationale | Each of the 4 features has a clear mathematical justification |
| Live monitoring | Dashboard updates in real time while `main.py` is running — demonstrates full system integration |
| Production-quality code | Docstrings, type hints, logging, structured error handling, clean module boundaries |
| Full-stack scope | Backend REST API + React SPA — not just a Jupyter notebook |

---

## Likely Lecturer Questions & Suggested Answers

**Q: "Why Random Forest for HR zone classification? Isn't it just thresholding?"**

The BPM boundaries between zones are not fixed — they vary by individual, fitness level, and session context. A Random Forest learns these boundaries from real workout data. The engineered features (especially BPM² and log-BPM) expose non-linear transitions that a hard threshold cannot capture. Additionally, `predict_proba()` returns a confidence distribution over all 5 zones, which a simple threshold does not provide.

---

**Q: "Why rule-based for exercise detection instead of ML?"**

Exercise detection from joint angles is fundamentally a geometric problem — you can state *why* a squat is a squat (knee angle < 90°, hip flexed). Training an ML model here would require a large, labelled video dataset that does not exist for this project. Rule-based detection is also fully interpretable, runs in microseconds, and is easy to tune without retraining.

---

**Q: "What is the accuracy of your HR classifier?"**

Run `python scripts/train_model.py` before the presentation and record the output. It prints accuracy and a full per-class `classification_report` showing precision, recall, and F1-score for all 5 zones. Have these numbers ready.

---

**Q: "What happens if the person is not in frame?"**

When MediaPipe finds no landmarks, `process_frame` in `exercise_detector.py` returns `"Standing"` with `confidence = 0.0`. The session recorder still logs the frame but marks it as a no-detection frame. The fatigue zone is still predicted from the last known BPM.

---

**Q: "How does the live dashboard update without page refresh?"**

The frontend polls `/api/live` every 1 second using `setInterval + fetch`. The backend reads `data/live.json`, which the tracker (`main.py`) rewrites approximately once per second. When the tracker exits, it deletes the file; the next poll returns `{"status":"idle"}` and the dashboard switches to the idle state.

> Note: Server-Sent Events (SSE) was considered but ruled out because Vite's development proxy (`http-proxy`) buffers streaming responses, preventing events from reaching the browser. Polling was chosen as the reliable alternative.

---

## Known Limitations & Possible Extensions

| Limitation | Possible extension |
|---|---|
| Exercise detection is single-frame (no temporal smoothing) | Add a rolling majority-vote window (e.g. mode of last 10 frames) to reduce exercise flickering |
| HR classifier only uses BPM as input | Add session time elapsed, previous zone, and RR-interval variability as additional features |
| Rep counting assumes bilateral symmetry (averages left/right angles) | Track left and right limbs independently for unilateral exercises (single-arm curl, single-leg squat) |
| No user profile / max HR calibration | Allow the user to input age so `bpm / max_hr` uses a personalised maximum instead of the constant 220 |
| Dashboard has no authentication | Add session-based auth if deployed as a shared server |

---

## How to Run for the Demonstration

```bash
# 1. Install dependencies (one-time)
pip install -r requirements.txt
cd dashboard/frontend && npm install && cd ../..

# 2. Train the model (one-time — do this before presenting)
python scripts/train_model.py

# 3. Start everything
bash start.sh
# Opens: http://localhost:8000

# 4. In a separate terminal, start the webcam tracker
python src/main.py
# With Polar H10:
python src/main.py --ble
```

**Keyboard controls during demo:**

| Key | Action |
|---|---|
| `b` | Manually override BPM (type digits + Enter) |
| `s` | Save a session snapshot (recording continues) |
| `r` | Reset all rep counters |
| `q` / Esc | Quit and auto-save session |

---

## Dataset

- **File:** `data/dataset_training_withclass_edited.csv`
- **Columns:** `Average BPM`, `Time (hh:mm:ss)`, `Date`, `fatigue`
- **Classes:** Normal · Aerobic · Anaerobic · Maximum · Recovery
- **Source:** Real workout heart-rate recordings
- **Size:** 1000+ rows

---

## Technology Stack Summary

| Layer | Technology | Version |
|---|---|---|
| Pose estimation | MediaPipe | 0.10.x |
| Computer vision | OpenCV | 4.x |
| ML framework | scikit-learn | latest |
| Bluetooth LE | bleak | latest |
| Backend API | FastAPI + Uvicorn | latest |
| Frontend framework | React + TypeScript | 18 / 5 |
| Frontend build | Vite | 5.x |
| Charts | Recharts | 2.x |
| Language (backend) | Python | 3.11 |
| Language (frontend) | TypeScript | 5.x |
