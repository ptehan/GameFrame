"""Compare a real observation package against synthetic trajectories.

This is the first rough comparison layer. It deliberately fits a simple
affine 3D-to-2D projection per synthetic trajectory because the real camera is
not calibrated yet. That makes the score a shape/timing sanity check, not a
final physical inference result.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import sqlite3

import numpy as np


@dataclass(frozen=True)
class Observation:
    t: float
    u: float
    v: float
    sigma_px: float


def load_observations(path: Path) -> tuple[dict, list[Observation]]:
    package = json.loads(path.read_text(encoding="utf-8"))
    observations = [
        Observation(
            t=float(row["relative_time_s"]),
            u=float(row["image_x"]),
            v=float(row["image_y"]),
            sigma_px=float(row.get("uncertainty_px") or 30.0),
        )
        for row in package.get("ball_observations", [])
        if row.get("image_x") is not None and row.get("image_y") is not None
    ]
    return package, observations


def interpolate_trajectory(conn: sqlite3.Connection, hit_id: str, times: np.ndarray) -> np.ndarray:
    rows = conn.execute(
        """
        SELECT relative_time_s, x_ft, y_ft, z_ft
        FROM trajectory_points
        WHERE hit_id = ?
        ORDER BY relative_time_s
        """,
        (hit_id,),
    ).fetchall()
    traj_t = np.array([row[0] for row in rows], dtype=float)
    xyz = np.array([[row[1], row[2], row[3]] for row in rows], dtype=float)
    if times.min() < traj_t.min() or times.max() > traj_t.max():
        raise ValueError(f"Observation times exceed trajectory for {hit_id}")
    return np.column_stack(
        [
            np.interp(times, traj_t, xyz[:, 0]),
            np.interp(times, traj_t, xyz[:, 1]),
            np.interp(times, traj_t, xyz[:, 2]),
        ]
    )


def fit_affine_projection(xyz: np.ndarray, uv: np.ndarray, sigma: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    design = np.column_stack([xyz, np.ones(len(xyz))])
    weights = 1.0 / np.maximum(sigma, 1.0)
    weighted_design = design * weights[:, None]
    weighted_uv = uv * weights[:, None]
    coeffs, *_ = np.linalg.lstsq(weighted_design, weighted_uv, rcond=None)
    predicted = design @ coeffs
    residuals = uv - predicted
    normalized_rmse = float(np.sqrt(np.mean(np.sum((residuals / sigma[:, None]) ** 2, axis=1))))
    pixel_rmse = float(np.sqrt(np.mean(np.sum(residuals**2, axis=1))))
    return coeffs, predicted, pixel_rmse, normalized_rmse


def compare(package_path: Path, db_path: Path, top_n: int) -> list[dict]:
    package, observations = load_observations(package_path)
    if len(observations) < 4:
        raise ValueError("Need at least four visible ball observations for this first comparison.")

    obs_times = np.array([obs.t for obs in observations], dtype=float)
    obs_uv = np.array([[obs.u, obs.v] for obs in observations], dtype=float)
    obs_sigma = np.array([obs.sigma_px for obs in observations], dtype=float)

    distance_obs = package.get("hit", {}).get("distance_observation") or {}
    target_distance = distance_obs.get("distance_ft")
    distance_sigma = distance_obs.get("uncertainty_ft") or 50

    results: list[dict] = []
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        hits = conn.execute("SELECT * FROM synthetic_hits").fetchall()
        for hit in hits:
            xyz = interpolate_trajectory(conn, hit["hit_id"], obs_times)
            coeffs, predicted, pixel_rmse, normalized_rmse = fit_affine_projection(xyz, obs_uv, obs_sigma)
            distance_z = 0.0
            if target_distance is not None:
                distance_z = (float(hit["distance_ft"]) - float(target_distance)) / float(distance_sigma)
            score = normalized_rmse + abs(distance_z)
            results.append(
                {
                    "hit_id": hit["hit_id"],
                    "score": score,
                    "pixel_rmse": pixel_rmse,
                    "normalized_rmse": normalized_rmse,
                    "distance_z": distance_z,
                    "exit_velocity_mph": hit["exit_velocity_mph"],
                    "launch_angle_deg": hit["launch_angle_deg"],
                    "spray_angle_deg": hit["spray_angle_deg"],
                    "distance_ft": hit["distance_ft"],
                    "hang_time_s": hit["hang_time_s"],
                    "apex_ft": hit["apex_ft"],
                    "backspin_rpm": hit["backspin_rpm"],
                    "sidespin_rpm": hit["sidespin_rpm"],
                    "projection_coefficients": coeffs.tolist(),
                    "predicted_points": [
                        {
                            "relative_time_s": float(t),
                            "predicted_x": float(p[0]),
                            "predicted_y": float(p[1]),
                            "observed_x": float(o[0]),
                            "observed_y": float(o[1]),
                        }
                        for t, p, o in zip(obs_times, predicted, obs_uv)
                    ],
                }
            )

    results.sort(key=lambda row: row["score"])
    return results[:top_n]


def store_results(db_path: Path, observation_package: Path, results: list[dict]) -> None:
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS comparison_runs (
                run_id INTEGER PRIMARY KEY AUTOINCREMENT,
                observation_package TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                method TEXT NOT NULL,
                note TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS comparison_candidates (
                run_id INTEGER NOT NULL,
                rank INTEGER NOT NULL,
                hit_id TEXT NOT NULL,
                score REAL NOT NULL,
                pixel_rmse REAL NOT NULL,
                normalized_rmse REAL NOT NULL,
                distance_z REAL NOT NULL,
                exit_velocity_mph REAL NOT NULL,
                launch_angle_deg REAL NOT NULL,
                spray_angle_deg REAL NOT NULL,
                distance_ft REAL NOT NULL,
                hang_time_s REAL NOT NULL,
                apex_ft REAL NOT NULL,
                FOREIGN KEY(run_id) REFERENCES comparison_runs(run_id),
                FOREIGN KEY(hit_id) REFERENCES synthetic_hits(hit_id)
            )
            """
        )
        cur = conn.execute(
            """
            INSERT INTO comparison_runs (observation_package, method, note)
            VALUES (?, ?, ?)
            """,
            (
                str(observation_package),
                "affine_3d_to_2d_fit_plus_distance_prior",
                "First-pass shape/timing comparison. Camera is not calibrated; early arc can be overfit by affine projection.",
            ),
        )
        run_id = int(cur.lastrowid)
        conn.executemany(
            """
            INSERT INTO comparison_candidates (
                run_id, rank, hit_id, score, pixel_rmse, normalized_rmse, distance_z,
                exit_velocity_mph, launch_angle_deg, spray_angle_deg,
                distance_ft, hang_time_s, apex_ft
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    run_id,
                    rank,
                    row["hit_id"],
                    row["score"],
                    row["pixel_rmse"],
                    row["normalized_rmse"],
                    row["distance_z"],
                    row["exit_velocity_mph"],
                    row["launch_angle_deg"],
                    row["spray_angle_deg"],
                    row["distance_ft"],
                    row["hang_time_s"],
                    row["apex_ft"],
                )
                for rank, row in enumerate(results, start=1)
            ],
        )
        conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("observation_package", type=Path)
    parser.add_argument("--db", default=Path("data/hittrax_from_video.sqlite"), type=Path)
    parser.add_argument("--out", default=Path("comparison_output/comparison_results.json"), type=Path)
    parser.add_argument("--top", default=10, type=int)
    args = parser.parse_args()

    results = compare(args.observation_package, args.db, args.top)
    store_results(args.db, args.observation_package, results)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"results": results}, indent=2), encoding="utf-8")

    print(f"Wrote {len(results)} ranked candidates to {args.out}")
    for row in results:
        print(
            f"{row['hit_id']:14s} score={row['score']:.3f} "
            f"px_rmse={row['pixel_rmse']:.1f} EV={row['exit_velocity_mph']:.1f} "
            f"LA={row['launch_angle_deg']:.1f} dist={row['distance_ft']:.1f}"
        )


if __name__ == "__main__":
    main()
