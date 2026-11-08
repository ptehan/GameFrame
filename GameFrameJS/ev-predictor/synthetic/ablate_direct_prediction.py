"""Run direct-video prediction under controlled evidence ablations."""

from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import sys
from typing import Any, Callable

import numpy as np

from direct_video_estimate import (
    direction_from_terminal_or_package,
    estimate_apex_evidence,
    estimate_launch_angle_from_pose,
    fit_observed_image_direction,
    infer_ev_from_flight_table,
    score_projected_synthetic_paths,
)


Mutator = Callable[[dict[str, Any]], None]


def load_homography(db_path: Path, calibration_id: str) -> np.ndarray:
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT homography_json FROM field_calibrations WHERE calibration_id = ?",
            (calibration_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"No calibration found for {calibration_id}")
    return np.array(json.loads(row["homography_json"]), dtype=float)


def predict(package: dict[str, Any], db_path: Path, homography: np.ndarray, calibration_id: str) -> dict[str, Any]:
    observations = package.get("ball_observations") or []
    metadata = package.get("video_metadata") or {}
    width = int(metadata.get("width_px") or 1920)
    height = int(metadata.get("height_px") or 1080)

    direction = direction_from_terminal_or_package(package, homography)
    observed = fit_observed_image_direction(observations)
    direct_la = estimate_launch_angle_from_pose(
        homography,
        width,
        height,
        np.array(observed["image_velocity_px_per_s"], dtype=float),
        np.array(direction["direction_xy"], dtype=float),
        package,
        [45.0, 50.0, 55.0, 60.0, 65.0, 70.0, 75.0, 80.0],
    )
    apex_evidence = estimate_apex_evidence(
        observations,
        homography,
        direct_la,
        np.array(direction["direction_xy"], dtype=float),
    )
    path_evidence = score_projected_synthetic_paths(
        observations,
        db_path,
        homography,
        width,
        height,
        float(direct_la["horizontal_fov_deg"]),
    )
    candidates = infer_ev_from_flight_table(
        package,
        db_path,
        direct_la["launch_angle_deg"],
        direction["spray_angle_deg"],
        apex_evidence,
        path_evidence,
    )
    return {
        "calibration_id": calibration_id,
        "observed_image_direction": observed,
        "field_direction": direction,
        "direct_launch_angle": direct_la,
        "apex_evidence": apex_evidence,
        "projected_path_evidence": {key: value for key, value in path_evidence.items() if key != "scores_by_hit_id"},
        "ev_candidates": candidates[:12],
    }


def set_ground_confidence(confidence: str) -> Mutator:
    def mutate(package: dict[str, Any]) -> None:
        if package.get("terminal_event"):
            package["terminal_event"]["confidence"] = confidence

    return mutate


def remove_ground_contact(package: dict[str, Any]) -> None:
    package["terminal_event"] = None


def remove_distance(package: dict[str, Any]) -> None:
    package.setdefault("hit", {}).setdefault("distance_observation", {})["distance_ft"] = None


def set_distance(distance_ft: float, uncertainty_ft: float) -> Mutator:
    def mutate(package: dict[str, Any]) -> None:
        distance = package.setdefault("hit", {}).setdefault("distance_observation", {})
        distance["distance_ft"] = distance_ft
        distance["uncertainty_ft"] = uncertainty_ft

    return mutate


def keep_ball_points(count: int) -> Mutator:
    def mutate(package: dict[str, Any]) -> None:
        package["ball_observations"] = (package.get("ball_observations") or [])[:count]

    return mutate


def set_direction(direction: str) -> Mutator:
    def mutate(package: dict[str, Any]) -> None:
        package.setdefault("hit", {}).setdefault("direction_observation", {})["value"] = direction
        package.setdefault("hit", {}).setdefault("distance_observation", {}).pop("field_marker_percent", None)

    return mutate


def scenario_definitions() -> list[tuple[str, list[Mutator]]]:
    return [
        ("baseline", []),
        ("no_ground_contact", [remove_ground_contact]),
        ("ground_low", [set_ground_confidence("LOW")]),
        ("ground_medium", [set_ground_confidence("MEDIUM")]),
        ("ground_high", [set_ground_confidence("HIGH")]),
        ("no_distance", [remove_distance]),
        ("no_distance_ground_high", [remove_distance, set_ground_confidence("HIGH")]),
        ("distance_330_plusminus50", [set_distance(330.0, 50.0)]),
        ("distance_340_plusminus10_no_ground", [set_distance(340.0, 10.0), remove_ground_contact]),
        ("first_2_ball_points", [keep_ball_points(2)]),
        ("first_3_ball_points", [keep_ball_points(3)]),
        ("first_4_ball_points", [keep_ball_points(4)]),
        ("first_5_ball_points", [keep_ball_points(5)]),
        ("direction_left_field", [set_direction("left_field")]),
        ("direction_center_field", [set_direction("center_field")]),
    ]


def summarize(name: str, package: dict[str, Any], prediction: dict[str, Any] | None, error: str | None = None) -> dict[str, Any]:
    if error is not None:
        return {"scenario": name, "error": error}
    assert prediction is not None
    best = prediction["ev_candidates"][0]
    top = prediction["ev_candidates"][:10]
    distance_obs = (package.get("hit", {}).get("distance_observation") or {})
    terminal = package.get("terminal_event") or {}
    return {
        "scenario": name,
        "measured_launch_angle_deg": prediction["direct_launch_angle"]["launch_angle_deg"],
        "image_angle_deg": prediction["observed_image_direction"]["image_angle_deg"],
        "ball_points_used": prediction["observed_image_direction"]["used_count"],
        "spray_angle_deg": prediction["field_direction"]["spray_angle_deg"],
        "direction_source": prediction["field_direction"]["source"],
        "distance_input_ft": distance_obs.get("distance_ft"),
        "distance_uncertainty_ft": distance_obs.get("uncertainty_ft"),
        "ground_relative_time_s": terminal.get("relative_time_s"),
        "ground_confidence": terminal.get("confidence"),
        "best_hit_id": best["hit_id"],
        "ev_mph": best["exit_velocity_mph"],
        "ev_range_top10": [min(row["exit_velocity_mph"] for row in top), max(row["exit_velocity_mph"] for row in top)],
        "distance_range_top10": [min(row["distance_ft"] for row in top), max(row["distance_ft"] for row in top)],
        "hang_time_range_top10": [min(row["hang_time_s"] for row in top), max(row["hang_time_s"] for row in top)],
        "candidate_la_deg": best["launch_angle_deg"],
        "projected_distance_ft": best["distance_ft"],
        "projected_hang_time_s": best["hang_time_s"],
        "projected_apex_time_s": best.get("apex_time_s"),
        "projected_apex_ft": best.get("apex_ft"),
        "apex_observed": (prediction.get("apex_evidence") or {}).get("observed"),
        "apex_confidence": (prediction.get("apex_evidence") or {}).get("confidence"),
        "score": best["score"],
        "distance_z": best["distance_z"],
        "hang_time_z": best["hang_time_z"],
        "apex_time_z": best.get("apex_time_z"),
        "apex_height_z": best.get("apex_height_z"),
        "projected_path_rmse_px": best.get("projected_path_rmse_px"),
        "projected_path_score_weight": best.get("projected_path_score_weight"),
        "hang_time_score_weight": best.get("hang_time_score_weight"),
        "apex_score_weight": best.get("apex_score_weight"),
        "ev_underconstrained": best.get("ev_underconstrained"),
    }


def print_table(rows: list[dict[str, Any]]) -> None:
    columns = [
        ("scenario", 31),
        ("ev_mph", 6),
        ("ev_range_top10", 11),
        ("measured_launch_angle_deg", 8),
        ("projected_distance_ft", 8),
        ("projected_hang_time_s", 7),
        ("projected_apex_time_s", 7),
        ("projected_path_rmse_px", 8),
        ("apex_confidence", 8),
        ("distance_input_ft", 8),
        ("ground_confidence", 8),
        ("score", 7),
    ]
    header = " ".join(label.ljust(width) for label, width in columns)
    print(header)
    print("-" * len(header))
    for row in rows:
        if row.get("error"):
            print(f"{row['scenario']:<31} ERROR {row['error']}")
            continue
        values = []
        for key, width in columns:
            value = row.get(key)
            if key == "ev_mph" and row.get("ev_underconstrained"):
                value = "UNDER"
            if key in {"projected_distance_ft", "projected_hang_time_s"} and row.get("ev_underconstrained"):
                value = ""
            if isinstance(value, list):
                value = f"{round(value[0], 1)}-{round(value[1], 1)}"
            if isinstance(value, float):
                value = round(value, 2)
            values.append(str(value).ljust(width))
        print(" ".join(values))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("observation_package", type=Path)
    parser.add_argument("--db", default=Path("data/hittrax_from_video.sqlite"), type=Path)
    parser.add_argument("--calibration-id", default="obs_ground_contact")
    parser.add_argument("--out", default=Path("comparison_output/direct_prediction_ablation.json"), type=Path)
    args = parser.parse_args()

    base_package = json.loads(args.observation_package.read_text(encoding="utf-8"))
    homography = load_homography(args.db, args.calibration_id)
    rows = []
    details = []

    for name, mutators in scenario_definitions():
        package = deepcopy(base_package)
        for mutator in mutators:
            mutator(package)
        try:
            prediction = predict(package, args.db, homography, args.calibration_id)
            rows.append(summarize(name, package, prediction))
            details.append({"scenario": name, "package_overrides": summarize(name, package, prediction), "prediction": prediction})
        except Exception as exc:
            rows.append(summarize(name, package, None, str(exc)))
            details.append({"scenario": name, "error": str(exc)})

    report = {
        "source_package": str(args.observation_package),
        "calibration_id": args.calibration_id,
        "rows": rows,
        "details": details,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print_table(rows)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
