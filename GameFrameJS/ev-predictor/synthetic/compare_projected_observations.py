"""Score observed ball points against stored projected synthetic observations."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3

import numpy as np


def load_observed(path: Path) -> tuple[list[dict], dict]:
    package = json.loads(path.read_text(encoding="utf-8"))
    rows = [
        row
        for row in package.get("ball_observations", [])
        if row.get("image_x") is not None and row.get("image_y") is not None
    ]
    return rows, package


def score(db_path: Path, observation_package: Path, camera_id: str) -> list[dict]:
    observed, package = load_observed(observation_package)
    obs_by_time = {round(float(row["relative_time_s"]), 6): row for row in observed}
    distance_observation = package.get("hit", {}).get("distance_observation") or {}
    target_distance = distance_observation.get("distance_ft")
    distance_sigma = float(distance_observation.get("uncertainty_ft") or 50.0)

    results = []
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        hit_ids = [row[0] for row in conn.execute("SELECT hit_id FROM synthetic_hits ORDER BY hit_id")]
        for hit_id in hit_ids:
            projected = conn.execute(
                """
                SELECT relative_time_s, projected_x_px, projected_y_px, visible
                FROM synthetic_projected_observations
                WHERE camera_id = ? AND hit_id = ?
                ORDER BY relative_time_s
                """,
                (camera_id, hit_id),
            ).fetchall()

            residuals = []
            for row in projected:
                key = round(float(row["relative_time_s"]), 6)
                obs = obs_by_time.get(key)
                if not obs:
                    continue
                sigma = float(obs.get("uncertainty_px") or 30.0)
                residuals.append(
                    [
                        (float(obs["image_x"]) - float(row["projected_x_px"])) / sigma,
                        (float(obs["image_y"]) - float(row["projected_y_px"])) / sigma,
                    ]
                )

            residual_array = np.array(residuals, dtype=float)
            normalized_rmse = float(np.sqrt(np.mean(np.sum(residual_array**2, axis=1))))
            pixel_rmse = float(normalized_rmse * 30.0)

            hit = conn.execute("SELECT * FROM synthetic_hits WHERE hit_id = ?", (hit_id,)).fetchone()
            distance_z = 0.0
            if target_distance is not None:
                distance_z = (float(hit["distance_ft"]) - float(target_distance)) / distance_sigma
            score_value = normalized_rmse + abs(distance_z)
            results.append(
                {
                    "hit_id": hit_id,
                    "score": score_value,
                    "pixel_rmse_assuming_30px": pixel_rmse,
                    "normalized_rmse": normalized_rmse,
                    "distance_z": distance_z,
                    "exit_velocity_mph": hit["exit_velocity_mph"],
                    "launch_angle_deg": hit["launch_angle_deg"],
                    "spray_angle_deg": hit["spray_angle_deg"],
                    "distance_ft": hit["distance_ft"],
                    "hang_time_s": hit["hang_time_s"],
                    "apex_ft": hit["apex_ft"],
                }
            )

    results.sort(key=lambda row: row["score"])
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("observation_package", type=Path)
    parser.add_argument("--db", default=Path("data/hittrax_from_video.sqlite"), type=Path)
    parser.add_argument("--camera-id", default="sample_video_camera_prior")
    parser.add_argument("--out", default=Path("comparison_output/projected_comparison_results.json"), type=Path)
    args = parser.parse_args()

    results = score(args.db, args.observation_package, args.camera_id)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"results": results}, indent=2), encoding="utf-8")

    print(f"Wrote {len(results)} projected-camera scores to {args.out}")
    for row in results[:10]:
        print(
            f"{row['hit_id']:14s} score={row['score']:.3f} "
            f"px_rmse~={row['pixel_rmse_assuming_30px']:.1f} "
            f"EV={row['exit_velocity_mph']:.1f} LA={row['launch_angle_deg']:.1f} "
            f"dist={row['distance_ft']:.1f}"
        )


if __name__ == "__main__":
    main()
