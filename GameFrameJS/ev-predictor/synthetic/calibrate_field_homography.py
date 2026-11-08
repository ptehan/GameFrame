"""Estimate a ground-plane field homography from annotated landmarks."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3

import numpy as np


# World coordinates in feet. Origin is home plate. y points toward center field,
# x points toward first-base side. The foul-line point coordinates are helper
# points along the foul lines, not fixed objects.
FIELD_LANDMARKS_FT = {
    "home_plate": (0.0, 0.0),
    "pitching_rubber": (0.0, 60.5),
    "first_base": (63.64, 63.64),
    "second_base": (0.0, 127.28),
    "third_base": (-63.64, 63.64),
    "left_foul_line_near": (-45.0, 45.0),
    "left_foul_line_far": (-220.0, 220.0),
    "right_foul_line_near": (45.0, 45.0),
    "right_foul_line_far": (220.0, 220.0),
    "outfield_endpoint_estimate": (-120.0, 305.0),
}


def load_landmarks(package_path: Path) -> list[dict]:
    package = json.loads(package_path.read_text(encoding="utf-8"))
    landmarks = package.get("landmarks", [])
    usable = [row for row in landmarks if row.get("landmark") in FIELD_LANDMARKS_FT]
    return usable


def estimate_homography(world_xy: np.ndarray, image_uv: np.ndarray) -> np.ndarray:
    if len(world_xy) < 4:
        raise ValueError("Need at least four field landmarks for a ground-plane homography.")
    rows = []
    for (x, y), (u, v) in zip(world_xy, image_uv):
        rows.append([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
        rows.append([0, 0, 0, -x, -y, -1, v * x, v * y, v])
    _, _, vt = np.linalg.svd(np.array(rows, dtype=float))
    h = vt[-1].reshape(3, 3)
    return h / h[2, 2]


def project_homography(h: np.ndarray, world_xy: np.ndarray) -> np.ndarray:
    pts = np.column_stack([world_xy, np.ones(len(world_xy))])
    projected = pts @ h.T
    projected = projected[:, :2] / projected[:, 2:3]
    return projected


def calibrate(package_path: Path, db_path: Path, calibration_id: str) -> None:
    landmarks = load_landmarks(package_path)
    if len(landmarks) < 4:
        raise SystemExit(
            f"Need at least four field landmarks; found {len(landmarks)}. "
            "Add landmarks in the annotation tool and export a fresh observation package."
        )
    world_xy = np.array([FIELD_LANDMARKS_FT[row["landmark"]] for row in landmarks], dtype=float)
    image_uv = np.array([[row["image_x"], row["image_y"]] for row in landmarks], dtype=float)
    h = estimate_homography(world_xy, image_uv)
    predicted = project_homography(h, world_xy)
    residuals = image_uv - predicted
    rmse_px = float(np.sqrt(np.mean(np.sum(residuals**2, axis=1))))

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS field_calibrations (
                calibration_id TEXT PRIMARY KEY,
                observation_package TEXT NOT NULL,
                homography_json TEXT NOT NULL,
                landmark_count INTEGER NOT NULL,
                rmse_px REAL NOT NULL,
                note TEXT
            )
            """
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO field_calibrations (
                calibration_id, observation_package, homography_json,
                landmark_count, rmse_px, note
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                calibration_id,
                str(package_path),
                json.dumps(h.tolist()),
                len(landmarks),
                rmse_px,
                "Ground-plane homography only. Does not solve full 3D camera pose.",
            ),
        )
        conn.commit()

    print(f"Stored calibration {calibration_id}")
    print(f"Landmarks: {len(landmarks)}")
    print(f"Ground-plane RMSE: {rmse_px:.2f} px")
    print("Homography:")
    print(h)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("observation_package", type=Path)
    parser.add_argument("--db", default=Path("data/hittrax_from_video.sqlite"), type=Path)
    parser.add_argument("--calibration-id", default="sample_video_ground_plane")
    args = parser.parse_args()
    calibrate(args.observation_package, args.db, args.calibration_id)


if __name__ == "__main__":
    main()
