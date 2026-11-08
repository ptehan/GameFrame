"""Compare observations using a landmark-derived ground-plane homography."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3

import numpy as np


def load_observed(path: Path) -> tuple[dict, list[dict]]:
    package = json.loads(path.read_text(encoding="utf-8"))
    observations = [
        row
        for row in package.get("ball_observations", [])
        if row.get("image_x") is not None and row.get("image_y") is not None
    ]
    return package, observations


def project_ground(h: np.ndarray, xy: np.ndarray) -> np.ndarray:
    pts = np.column_stack([xy, np.ones(len(xy))])
    projected = pts @ h.T
    return projected[:, :2] / projected[:, 2:3]


def estimate_camera_from_homography(
    h: np.ndarray,
    image_width: int,
    image_height: int,
) -> dict:
    """Estimate a pinhole camera from a ground-plane homography.

    Assumptions are explicit and fixed for every candidate: square pixels, zero
    skew, and principal point at image center. This is still approximate, but it
    removes the previous per-hit vertical-scale fit.
    """
    cx = image_width / 2.0
    cy = image_height / 2.0

    def residual_for_f(f: float) -> float:
        k_inv = np.array([[1.0 / f, 0.0, -cx / f], [0.0, 1.0 / f, -cy / f], [0.0, 0.0, 1.0]])
        b = k_inv @ h
        b1 = b[:, 0]
        b2 = b[:, 1]
        n1 = np.linalg.norm(b1)
        n2 = np.linalg.norm(b2)
        if n1 <= 1e-9 or n2 <= 1e-9:
            return float("inf")
        r1 = b1 / n1
        r2 = b2 / n2
        return float((np.dot(r1, r2) ** 2) + ((n1 - n2) / max(n1, n2)) ** 2)

    # Coarse-to-fine search is stable enough here and avoids symbolic fragility.
    candidates = np.geomspace(max(image_width, image_height) * 0.35, max(image_width, image_height) * 8.0, 400)
    best_f = float(candidates[int(np.argmin([residual_for_f(float(f)) for f in candidates]))])
    for span in [0.25, 0.08, 0.025]:
        lo = max(10.0, best_f * (1.0 - span))
        hi = best_f * (1.0 + span)
        candidates = np.linspace(lo, hi, 300)
        best_f = float(candidates[int(np.argmin([residual_for_f(float(f)) for f in candidates]))])

    k = np.array([[best_f, 0.0, cx], [0.0, best_f, cy], [0.0, 0.0, 1.0]])
    b = np.linalg.inv(k) @ h
    b1 = b[:, 0]
    b2 = b[:, 1]
    b3 = b[:, 2]
    scale = (np.linalg.norm(b1) + np.linalg.norm(b2)) / 2.0
    r1 = b1 / scale
    r2 = b2 / scale
    r1 = r1 / np.linalg.norm(r1)
    r2 = r2 - r1 * np.dot(r1, r2)
    r2 = r2 / np.linalg.norm(r2)
    r3 = np.cross(r1, r2)
    # Choose the vertical axis orientation that puts higher z higher in the image
    # near home plate.
    r = np.column_stack([r1, r2, r3])
    t = b3 / scale
    test = project_camera(k, r, t, np.array([[0.0, 0.0, 0.0], [0.0, 0.0, 10.0]]))
    if test[1, 1] > test[0, 1]:
        r[:, 2] *= -1.0
    return {"k": k, "r": r, "t": t, "focal_length_px": best_f}


def project_camera(k: np.ndarray, r: np.ndarray, t: np.ndarray, xyz: np.ndarray) -> np.ndarray:
    camera_xyz = xyz @ r.T + t
    projected = camera_xyz @ k.T
    return projected[:, :2] / projected[:, 2:3]


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
    return np.column_stack(
        [
            np.interp(times, traj_t, xyz[:, 0]),
            np.interp(times, traj_t, xyz[:, 1]),
            np.interp(times, traj_t, xyz[:, 2]),
        ]
    )


def initial_image_angle_deg(points: np.ndarray, times: np.ndarray, max_time_s: float = 0.16) -> float | None:
    if len(points) < 2:
        return None
    mask = times <= max_time_s
    if int(mask.sum()) < 2:
        mask = np.arange(len(points)) < min(len(points), 5)
    selected = points[mask]
    if len(selected) < 2:
        return None
    delta = selected[-1] - selected[0]
    if float(np.hypot(delta[0], delta[1])) < 1e-6:
        return None
    # Screen-space angle: +x right, +y down. The absolute number is not physical
    # launch angle; it is a camera-specific takeoff-direction feature.
    return float(np.degrees(np.arctan2(delta[1], delta[0])))


def angle_difference_deg(a: float | None, b: float | None) -> float:
    if a is None or b is None:
        return 0.0
    diff = (a - b + 180.0) % 360.0 - 180.0
    return float(diff)


def score_hit_with_vertical_scale(
    h: np.ndarray,
    xyz: np.ndarray,
    obs_uv: np.ndarray,
    sigma: np.ndarray,
    times: np.ndarray,
) -> tuple[float, float, float, float | None, float | None, float]:
    ground_uv = project_ground(h, xyz[:, :2])
    z = xyz[:, 2]
    # Approximate vertical displacement in image as k * height_ft.
    # Positive k moves pixels upward when height increases.
    design = z[:, None]
    target = ground_uv[:, 1] - obs_uv[:, 1]
    weights = 1.0 / np.maximum(sigma, 1.0)
    k = float(np.linalg.lstsq(design * weights[:, None], target * weights, rcond=None)[0][0])
    predicted = ground_uv.copy()
    predicted[:, 1] = ground_uv[:, 1] - k * z
    residual = obs_uv - predicted
    normalized_rmse = float(np.sqrt(np.mean(np.sum((residual / sigma[:, None]) ** 2, axis=1))))
    pixel_rmse = float(np.sqrt(np.mean(np.sum(residual**2, axis=1))))
    observed_angle = initial_image_angle_deg(obs_uv, times)
    predicted_angle = initial_image_angle_deg(predicted, times)
    angle_residual = angle_difference_deg(predicted_angle, observed_angle)
    return pixel_rmse, normalized_rmse, k, observed_angle, predicted_angle, angle_residual


def score_hit_with_camera_pose(
    camera: dict,
    xyz: np.ndarray,
    obs_uv: np.ndarray,
    sigma: np.ndarray,
    times: np.ndarray,
) -> tuple[float, float, float | None, float | None, float]:
    predicted = project_camera(camera["k"], camera["r"], camera["t"], xyz)
    residual = obs_uv - predicted
    normalized_rmse = float(np.sqrt(np.mean(np.sum((residual / sigma[:, None]) ** 2, axis=1))))
    pixel_rmse = float(np.sqrt(np.mean(np.sum(residual**2, axis=1))))
    observed_angle = initial_image_angle_deg(obs_uv, times)
    predicted_angle = initial_image_angle_deg(predicted, times)
    angle_residual = angle_difference_deg(predicted_angle, observed_angle)
    return pixel_rmse, normalized_rmse, observed_angle, predicted_angle, angle_residual


def estimate_vertical_scale_from_camera(camera: dict, sample_xy: np.ndarray) -> float:
    if len(sample_xy) == 0:
        sample_xy = np.array([[0.0, 0.0]], dtype=float)
    ground = np.column_stack([sample_xy, np.zeros(len(sample_xy))])
    raised = ground.copy()
    raised[:, 2] = 10.0
    ground_uv = project_camera(camera["k"], camera["r"], camera["t"], ground)
    raised_uv = project_camera(camera["k"], camera["r"], camera["t"], raised)
    # Positive k means larger z moves upward in image coordinates.
    return float(np.median((ground_uv[:, 1] - raised_uv[:, 1]) / 10.0))


def score_hit_with_fixed_vertical_scale(
    h: np.ndarray,
    vertical_px_per_ft: float,
    xyz: np.ndarray,
    obs_uv: np.ndarray,
    sigma: np.ndarray,
    times: np.ndarray,
) -> tuple[float, float, float | None, float | None, float]:
    ground_uv = project_ground(h, xyz[:, :2])
    predicted = ground_uv.copy()
    predicted[:, 1] = ground_uv[:, 1] - vertical_px_per_ft * xyz[:, 2]
    residual = obs_uv - predicted
    normalized_rmse = float(np.sqrt(np.mean(np.sum((residual / sigma[:, None]) ** 2, axis=1))))
    pixel_rmse = float(np.sqrt(np.mean(np.sum(residual**2, axis=1))))
    observed_angle = initial_image_angle_deg(obs_uv, times)
    predicted_angle = initial_image_angle_deg(predicted, times)
    angle_residual = angle_difference_deg(predicted_angle, observed_angle)
    return pixel_rmse, normalized_rmse, observed_angle, predicted_angle, angle_residual


def compare(observation_package: Path, db_path: Path, calibration_id: str, projection_mode: str) -> list[dict]:
    package, observations = load_observed(observation_package)
    times = np.array([float(row["relative_time_s"]) for row in observations], dtype=float)
    obs_uv = np.array([[float(row["image_x"]), float(row["image_y"])] for row in observations], dtype=float)
    sigma = np.array([float(row.get("uncertainty_px") or 30.0) for row in observations], dtype=float)

    distance_observation = package.get("hit", {}).get("distance_observation") or {}
    target_distance = distance_observation.get("distance_ft")
    distance_sigma = float(distance_observation.get("uncertainty_ft") or 50.0)
    terminal_event = package.get("terminal_event") or {}
    target_hang_time = terminal_event.get("relative_time_s")
    hang_time_sigma = float(terminal_event.get("timing_uncertainty_s") or 0.5)
    angle_sigma_deg = float(package.get("model_options", {}).get("initial_image_angle_sigma_deg") or 8.0)
    score_weights = {
        "video_pixel": float(package.get("model_options", {}).get("video_pixel_weight") or 1.0),
        "video_angle": float(package.get("model_options", {}).get("video_angle_weight") or 1.0),
        "hang_time": float(package.get("model_options", {}).get("hang_time_weight") or 0.75),
        "distance": float(package.get("model_options", {}).get("distance_weight") or 0.35),
    }

    results = []
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        calibration = conn.execute(
            "SELECT homography_json FROM field_calibrations WHERE calibration_id = ?",
            (calibration_id,),
        ).fetchone()
        if calibration is None:
            raise ValueError(f"No calibration found for {calibration_id}")
        h = np.array(json.loads(calibration["homography_json"]), dtype=float)
        metadata = package.get("video_metadata") or {}
        width = int(metadata.get("width_px") or 1920)
        height = int(metadata.get("height_px") or 1080)
        camera = estimate_camera_from_homography(h, width, height) if projection_mode in {"camera_pose", "fixed_vertical_scale"} else None
        fixed_vertical_px_per_ft = None
        if projection_mode == "fixed_vertical_scale":
            sample_rows = conn.execute(
                """
                SELECT x_ft, y_ft
                FROM trajectory_points
                WHERE relative_time_s <= 0.25
                LIMIT 500
                """
            ).fetchall()
            sample_xy = np.array([[row["x_ft"], row["y_ft"]] for row in sample_rows], dtype=float)
            fixed_vertical_px_per_ft = estimate_vertical_scale_from_camera(camera, sample_xy)

        for hit in conn.execute("SELECT * FROM synthetic_hits ORDER BY hit_id"):
            xyz = interpolate_trajectory(conn, hit["hit_id"], times)
            if projection_mode == "camera_pose":
                (
                    pixel_rmse,
                    normalized_rmse,
                    observed_angle_deg,
                    predicted_angle_deg,
                    image_angle_residual_deg,
                ) = score_hit_with_camera_pose(camera, xyz, obs_uv, sigma, times)
                vertical_px_per_ft = None
            elif projection_mode == "fixed_vertical_scale":
                vertical_px_per_ft = fixed_vertical_px_per_ft
                (
                    pixel_rmse,
                    normalized_rmse,
                    observed_angle_deg,
                    predicted_angle_deg,
                    image_angle_residual_deg,
                ) = score_hit_with_fixed_vertical_scale(h, vertical_px_per_ft, xyz, obs_uv, sigma, times)
            else:
                (
                    pixel_rmse,
                    normalized_rmse,
                    vertical_px_per_ft,
                    observed_angle_deg,
                    predicted_angle_deg,
                    image_angle_residual_deg,
                ) = score_hit_with_vertical_scale(h, xyz, obs_uv, sigma, times)
            distance_z = 0.0
            if target_distance is not None:
                distance_z = (float(hit["distance_ft"]) - float(target_distance)) / distance_sigma
            hang_time_z = 0.0
            if target_hang_time is not None and terminal_event.get("type") == "FIRST_GROUND_CONTACT":
                hang_time_z = (float(hit["hang_time_s"]) - float(target_hang_time)) / hang_time_sigma
            image_angle_z = image_angle_residual_deg / angle_sigma_deg
            video_pixel_score = score_weights["video_pixel"] * normalized_rmse
            video_angle_score = score_weights["video_angle"] * abs(image_angle_z)
            hang_time_score = score_weights["hang_time"] * abs(hang_time_z)
            distance_score = score_weights["distance"] * abs(distance_z)
            score_value = video_pixel_score + video_angle_score + hang_time_score + distance_score
            results.append(
                {
                    "hit_id": hit["hit_id"],
                    "score": score_value,
                    "score_weights": score_weights,
                    "video_pixel_score": video_pixel_score,
                    "video_angle_score": video_angle_score,
                    "hang_time_score": hang_time_score,
                    "distance_score": distance_score,
                    "pixel_rmse": pixel_rmse,
                    "normalized_rmse": normalized_rmse,
                    "distance_z": distance_z,
                    "hang_time_z": hang_time_z,
                    "image_angle_z": image_angle_z,
                    "observed_initial_image_angle_deg": observed_angle_deg,
                    "predicted_initial_image_angle_deg": predicted_angle_deg,
                    "image_angle_residual_deg": image_angle_residual_deg,
                    "vertical_px_per_ft": vertical_px_per_ft,
                    "projection_mode": projection_mode,
                    "camera_focal_length_px": None if camera is None else camera["focal_length_px"],
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
    parser.add_argument("--calibration-id", default="sample_video_ground_plane_v2")
    parser.add_argument(
        "--projection-mode",
        choices=["camera_pose", "fixed_vertical_scale", "fitted_vertical_scale"],
        default="fixed_vertical_scale",
    )
    parser.add_argument("--out", default=Path("comparison_output/homography_comparison_results.json"), type=Path)
    args = parser.parse_args()

    results = compare(args.observation_package, args.db, args.calibration_id, args.projection_mode)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"results": results}, indent=2), encoding="utf-8")

    print(f"Wrote {len(results)} homography scores to {args.out}")
    for row in results[:10]:
        k_text = "n/a" if row["vertical_px_per_ft"] is None else f"{row['vertical_px_per_ft']:.2f}"
        print(
            f"{row['hit_id']:14s} score={row['score']:.3f} "
            f"px_rmse={row['pixel_rmse']:.1f} EV={row['exit_velocity_mph']:.1f} "
            f"LA={row['launch_angle_deg']:.1f} dist={row['distance_ft']:.1f} "
            f"k={k_text}"
        )


if __name__ == "__main__":
    main()
