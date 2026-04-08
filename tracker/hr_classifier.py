"""
Heart Rate Zone Classifier
--------------------------
Trains and uses a Random Forest classifier to predict fatigue zones
from BPM values. Uses the dataset at data/dataset_training_withclass_edited.csv.

Fatigue zones:
    - Normal    : Light activity / rest
    - Aerobic   : Fat-burning zone
    - Anaerobic : High-intensity zone
    - Maximum   : Near max heart rate
    - Recovery  : Post-exercise cool-down
"""

from __future__ import annotations

import os
import logging
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import classification_report, accuracy_score

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_PATH = BASE_DIR / "data" / "dataset_training_withclass_edited.csv"
MODEL_PATH = BASE_DIR / "models" / "hr_classifier.pkl"
ENCODER_PATH = BASE_DIR / "models" / "label_encoder.pkl"

# ── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

# ── Zone colour map (BGR for OpenCV) ──────────────────────────────────────
ZONE_COLORS: dict[str, tuple[int, int, int]] = {
    "Normal":    (0, 200, 0),       # green
    "Aerobic":   (255, 200, 0),     # cyan
    "Anaerobic": (0, 140, 255),     # orange
    "Maximum":   (0, 0, 255),       # red
    "Recovery":  (255, 255, 0),     # light-blue
    "Unknown":   (180, 180, 180),   # grey
}

# ── BPM range heuristics (fallback when model is unavailable) ─────────────
_BPM_RULES: list[tuple[int, int, str]] = [
    (0,   90,  "Recovery"),
    (91,  109, "Normal"),
    (110, 129, "Aerobic"),
    (130, 149, "Anaerobic"),
    (150, 300, "Maximum"),
]


def _rule_based_zone(bpm: float) -> str:
    """Return fatigue zone using simple BPM thresholds (no ML)."""
    for lo, hi, zone in _BPM_RULES:
        if lo <= bpm <= hi:
            return zone
    return "Unknown"


class HRClassifier:
    """
    Random Forest–based heart-rate fatigue-zone classifier.

    Parameters
    ----------
    data_path : Path | str, optional
        Path to the training CSV. Defaults to DATA_PATH.
    model_path : Path | str, optional
        Where to save/load the serialised model. Defaults to MODEL_PATH.
    """

    def __init__(
        self,
        data_path: Path | str = DATA_PATH,
        model_path: Path | str = MODEL_PATH,
        encoder_path: Path | str = ENCODER_PATH,
    ) -> None:
        self.data_path = Path(data_path)
        self.model_path = Path(model_path)
        self.encoder_path = Path(encoder_path)

        self.model: Optional[RandomForestClassifier] = None
        self.encoder: Optional[LabelEncoder] = None
        self._loaded: bool = False

        # Attempt to load a pre-trained model automatically
        self._try_load()

    # ── Public API ─────────────────────────────────────────────────────────

    def train(
        self,
        test_size: float = 0.2,
        random_state: int = 42,
        n_estimators: int = 200,
    ) -> dict:
        """
        Load the CSV, engineer features, train the Random Forest, and persist
        the model to disk.

        Returns
        -------
        dict
            {'accuracy': float, 'report': str, 'classes': list[str]}
        """
        logger.info("Loading dataset from %s", self.data_path)
        df = self._load_data()

        X, y, encoder = self._build_features(df)
        self.encoder = encoder

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=random_state, stratify=y
        )

        logger.info(
            "Training RandomForest on %d samples (%d features)...",
            len(X_train), X.shape[1],
        )
        clf = RandomForestClassifier(
            n_estimators=n_estimators,
            max_depth=None,
            min_samples_split=2,
            class_weight="balanced",
            random_state=random_state,
            n_jobs=-1,
        )
        clf.fit(X_train, y_train)
        self.model = clf

        # Evaluation
        y_pred = clf.predict(X_test)
        acc = accuracy_score(y_test, y_pred)
        report = classification_report(
            y_test, y_pred, target_names=encoder.classes_
        )
        logger.info("Accuracy: %.4f\n%s", acc, report)

        # Persist
        self._save()
        self._loaded = True

        return {
            "accuracy": acc,
            "report": report,
            "classes": list(encoder.classes_),
        }

    def predict(self, bpm: float) -> str:
        """
        Predict the fatigue zone for a given BPM value.

        Falls back to rule-based classification if the model is not loaded.

        Parameters
        ----------
        bpm : float
            Heart-rate in beats per minute.

        Returns
        -------
        str
            One of: 'Normal', 'Aerobic', 'Anaerobic', 'Maximum', 'Recovery'.
        """
        if bpm <= 0:
            return "Unknown"

        if not self._loaded or self.model is None or self.encoder is None:
            logger.warning("Model not loaded – using rule-based fallback.")
            return _rule_based_zone(bpm)

        features = self._bpm_to_features(bpm)
        encoded = self.model.predict(features)[0]
        return self.encoder.inverse_transform([encoded])[0]

    def predict_proba(self, bpm: float) -> dict[str, float]:
        """
        Return class probabilities for a given BPM.

        Returns
        -------
        dict[str, float]
            Mapping zone → probability.
        """
        if not self._loaded or self.model is None or self.encoder is None:
            zone = _rule_based_zone(bpm)
            return {z: (1.0 if z == zone else 0.0) for z in ZONE_COLORS}

        features = self._bpm_to_features(bpm)
        proba = self.model.predict_proba(features)[0]
        return dict(zip(self.encoder.classes_, proba.tolist()))

    def get_zone_color(self, zone: str) -> tuple[int, int, int]:
        """Return BGR colour tuple for the given zone name."""
        return ZONE_COLORS.get(zone, ZONE_COLORS["Unknown"])

    def is_loaded(self) -> bool:
        """Return True if a trained model is currently loaded."""
        return self._loaded

    # ── Private helpers ────────────────────────────────────────────────────

    def _load_data(self) -> pd.DataFrame:
        """Read and validate the CSV dataset."""
        if not self.data_path.exists():
            raise FileNotFoundError(f"Dataset not found at {self.data_path}")
        df = pd.read_csv(self.data_path)

        required = {"Average BPM", "fatigue"}
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"Dataset missing columns: {missing}")

        df = df.dropna(subset=["Average BPM", "fatigue"])
        df["Average BPM"] = pd.to_numeric(df["Average BPM"], errors="coerce")
        df = df.dropna(subset=["Average BPM"])
        logger.info("Dataset loaded: %d records, classes=%s",
                    len(df), sorted(df["fatigue"].unique()))
        return df

    @staticmethod
    def _build_features(
        df: pd.DataFrame,
    ) -> tuple[np.ndarray, np.ndarray, LabelEncoder]:
        """
        Engineer features from raw DataFrame columns.

        Features
        --------
        - bpm           : raw BPM value
        - bpm_sq        : BPM squared (captures non-linear boundary)
        - bpm_log       : log(BPM) – compresses high-BPM range
        - bpm_norm      : BPM normalised to [0, 1] based on training max
        """
        bpm = df["Average BPM"].values.astype(float)
        bpm_max = bpm.max() if bpm.max() > 0 else 1.0

        X = np.column_stack([
            bpm,
            bpm ** 2,
            np.log1p(bpm),
            bpm / bpm_max,
        ])

        enc = LabelEncoder()
        y = enc.fit_transform(df["fatigue"].values)
        return X, y, enc

    @staticmethod
    def _bpm_to_features(bpm: float) -> np.ndarray:
        """Convert a single BPM scalar to the 4-feature vector."""
        bpm_max = 220.0  # physiological upper bound used as normaliser
        return np.array([[
            bpm,
            bpm ** 2,
            np.log1p(bpm),
            bpm / bpm_max,
        ]])

    def _save(self) -> None:
        """Serialise model and encoder to disk."""
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.model, self.model_path)
        joblib.dump(self.encoder, self.encoder_path)
        logger.info("Model saved → %s", self.model_path)
        logger.info("Encoder saved → %s", self.encoder_path)

    def _try_load(self) -> None:
        """Attempt to load a previously saved model; silently skip if absent."""
        if self.model_path.exists() and self.encoder_path.exists():
            try:
                self.model = joblib.load(self.model_path)
                self.encoder = joblib.load(self.encoder_path)
                self._loaded = True
                logger.info("Pre-trained model loaded from %s", self.model_path)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Could not load model: %s", exc)
                self._loaded = False


# ── CLI entry-point ───────────────────────────────────────────────────────
if __name__ == "__main__":
    clf = HRClassifier()
    results = clf.train()
    print(f"\nAccuracy: {results['accuracy']:.4f}")
    print(results["report"])

    # Quick sanity checks
    for bpm_val in [70, 100, 120, 140, 160, 180]:
        zone = clf.predict(bpm_val)
        proba = clf.predict_proba(bpm_val)
        top = max(proba, key=proba.get)
        print(f"BPM={bpm_val:3d} → {zone:12s}  (top conf: {proba[top]:.2f})")
