"""Build a compact prediction summary JSON for the local annotation app."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def summarize(rows: list[dict], max_ev: float | None = None, top_n: int = 10) -> dict:
    filtered = [row for row in rows if max_ev is None or row["exit_velocity_mph"] <= max_ev]
    top = filtered[:top_n]
    if not top:
        return {"top": [], "range": None}
    return {
        "top": top,
        "range": {
            "ev_mph": [min(row["exit_velocity_mph"] for row in top), max(row["exit_velocity_mph"] for row in top)],
            "launch_angle_deg": [min(row["launch_angle_deg"] for row in top), max(row["launch_angle_deg"] for row in top)],
            "distance_ft": [min(row["distance_ft"] for row in top), max(row["distance_ft"] for row in top)],
            "hang_time_s": [min(row["hang_time_s"] for row in top), max(row["hang_time_s"] for row in top)],
            "pixel_rmse": [min(row["pixel_rmse"] for row in top), max(row["pixel_rmse"] for row in top)],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--comparison", default=Path("comparison_output/homography_comparison_dense_v2.json"), type=Path)
    parser.add_argument("--out", default=Path("comparison_output/latest_prediction.json"), type=Path)
    args = parser.parse_args()

    rows = json.loads(args.comparison.read_text(encoding="utf-8"))["results"]
    summary = {
        "source_comparison": str(args.comparison),
        "method": "dense_synthetic_grid + landmark_homography + fitted_vertical_scale",
        "caveat": "Prototype result. Uses field-landmark homography, not full 3D camera pose.",
        "unconstrained": summarize(rows),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
