"""
Standalone training script for the FitTrack AI HR Classifier.

Usage
-----
    python scripts/train_model.py
    python scripts/train_model.py --data data/my_data.csv --estimators 300
    python scripts/train_model.py --no-plot
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

# ── Make project root importable ─────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
_ROOT_DIR   = _SCRIPT_DIR.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

from src.hr_classifier import HRClassifier, DATA_PATH, MODEL_PATH, ENCODER_PATH

# ── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)


# ── CLI ───────────────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train (or retrain) the FitTrack AI HR classifier.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--data", type=Path, default=DATA_PATH,
        help="Path to training CSV.",
    )
    parser.add_argument(
        "--model-out", type=Path, default=MODEL_PATH,
        help="Output path for the serialised model (.pkl).",
    )
    parser.add_argument(
        "--encoder-out", type=Path, default=ENCODER_PATH,
        help="Output path for the label encoder (.pkl).",
    )
    parser.add_argument(
        "--test-size", type=float, default=0.2,
        help="Fraction of data held out for evaluation.",
    )
    parser.add_argument(
        "--estimators", type=int, default=200,
        help="Number of trees in the Random Forest.",
    )
    parser.add_argument(
        "--seed", type=int, default=42,
        help="Random seed for reproducibility.",
    )
    parser.add_argument(
        "--no-plot", action="store_true",
        help="Skip the feature-importance chart.",
    )
    parser.add_argument(
        "--bpm-test", type=float, nargs="*",
        default=[60, 90, 110, 125, 140, 160, 180],
        help="BPM values to run inference on after training.",
    )
    return parser.parse_args()


# ── Helpers ───────────────────────────────────────────────────────────────

def _print_separator(char: str = "─", width: int = 60) -> None:
    print(char * width)


def _plot_feature_importance(clf: HRClassifier) -> None:
    """Print an ASCII bar chart of feature importance scores."""
    if clf.model is None:
        return

    feature_names = ["BPM", "BPM²", "log(BPM+1)", "BPM/220"]
    importances   = clf.model.feature_importances_

    _print_separator()
    print("Feature Importances")
    _print_separator()

    max_val = max(importances) if importances.max() > 0 else 1.0
    bar_width = 40

    for name, imp in sorted(zip(feature_names, importances), key=lambda x: -x[1]):
        filled = int(imp / max_val * bar_width)
        bar    = "█" * filled + "░" * (bar_width - filled)
        print(f"  {name:<16} │{bar}│ {imp:.4f}")

    _print_separator()


def _run_sample_predictions(clf: HRClassifier, bpm_values: list[float]) -> None:
    """Print a table of predictions for sample BPM values."""
    _print_separator()
    print("Sample Predictions")
    _print_separator()
    print(f"  {'BPM':>5}  │  {'Zone':<12}  │  Probabilities")
    _print_separator("─", 60)

    for bpm in bpm_values:
        zone  = clf.predict(bpm)
        proba = clf.predict_proba(bpm)
        proba_str = "  ".join(
            f"{z}={v:.2f}" for z, v in sorted(proba.items(), key=lambda x: -x[1])
            if v > 0.01
        )
        print(f"  {bpm:>5.0f}  │  {zone:<12}  │  {proba_str}")

    _print_separator()


# ── Main ──────────────────────────────────────────────────────────────────

def main() -> None:
    args = _parse_args()

    _print_separator("═")
    print("  FitTrack AI – HR Classifier Training")
    _print_separator("═")
    print(f"  Dataset  : {args.data}")
    print(f"  Model out: {args.model_out}")
    print(f"  Estimators: {args.estimators}   Test size: {args.test_size}   Seed: {args.seed}")
    _print_separator()

    clf = HRClassifier(
        data_path=args.data,
        model_path=args.model_out,
        encoder_path=args.encoder_out,
    )

    try:
        results = clf.train(
            test_size=args.test_size,
            random_state=args.seed,
            n_estimators=args.estimators,
        )
    except FileNotFoundError as exc:
        logger.error("Dataset not found: %s", exc)
        sys.exit(1)
    except ValueError as exc:
        logger.error("Dataset validation error: %s", exc)
        sys.exit(1)

    # ── Print classification report ────────────────────────────────────────
    _print_separator()
    print(f"  Accuracy : {results['accuracy']:.4f}  ({results['accuracy']*100:.2f}%)")
    _print_separator()
    print("\nClassification Report\n")
    print(results["report"])

    # ── Feature importance ─────────────────────────────────────────────────
    if not args.no_plot:
        _plot_feature_importance(clf)

    # ── Sample predictions ─────────────────────────────────────────────────
    _run_sample_predictions(clf, args.bpm_test)

    print("\n✓  Model training complete.")
    print(f"   Saved to: {args.model_out}")
    print(f"   Encoder : {args.encoder_out}\n")


if __name__ == "__main__":
    main()
