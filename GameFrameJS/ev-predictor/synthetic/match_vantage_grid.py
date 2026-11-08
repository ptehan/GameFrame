"""Match observed ball points to synthetic trajectories across camera/vantage hypotheses.

This is the intended "no distance / no hangtime" test path: use only field
landmarks, declared direction, and early ball observations, then ask which
synthetic hit and camera hypothesis best reproduce those image points.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sqlite3
import sys
from typing import Any

import numpy as np

from calibrate_field_homography import FIELD_LANDMARKS_FT, estimate_homography


def load_package(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def observed_points(package: dict[str, Any], max_time_s: float = 0.22) -> tuple[np.ndarray, np.ndarray]:
    rows = [
        row
        for row in package.get("ball_observations", [])
        if row.get("image_x") is not None
        and row.get("image_y") is not None
        and row.get("relative_time_s") is not None
        and float(row["relative_time_s"]) <= max_time_s
    ]
    if len(rows) < 2:
        raise ValueError("Need at least two early ball observations.")
    times = np.array([float(row["relative_time_s"]) for row in rows], dtype=float)
    uv = np.array([[float(row["image_x"]), float(row["image_y"])] for row in rows], dtype=float)
    return times, uv


def direction_to_spray(package: dict[str, Any]) -> float | None:
    value = (package.get("hit", {}).get("direction_observation") or {}).get("value")
    return {
        "left_field": -35.0,
        "left_center": -18.0,
        "center_field": 0.0,
        "right_center": 18.0,
        "right_field": 35.0,
        "third_base_line": -45.0,
        "first_base_line": 45.0,
    }.get(value)


def compute_package_homography(package: dict[str, Any]) -> np.ndarray:
    landmarks = [
        row for row in package.get("landmarks", [])
        if row.get("landmark") in FIELD_LANDMARKS_FT
        and row.get("image_x") is not None
        and row.get("image_y") is not None
    ]
    if len(landmarks) < 4:
        raise ValueError(f"Need at least four field landmarks; found {len(landmarks)}.")
    world_xy = np.array([FIELD_LANDMARKS_FT[row["landmark"]] for row in landmarks], dtype=float)
    image_uv = np.array([[row["image_x"], row["image_y"]] for row in landmarks], dtype=float)
    return estimate_homography(world_xy, image_uv)


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
    traj_t = np.array([row["relative_time_s"] for row in rows], dtype=float)
    xyz = np.array([[row["x_ft"], row["y_ft"], row["z_ft"]] for row in rows], dtype=float)
    return np.column_stack(
        [
            np.interp(times, traj_t, xyz[:, 0]),
            np.interp(times, traj_t, xyz[:, 1]),
            np.interp(times, traj_t, xyz[:, 2]),
        ]
    )


def intrinsics_from_fov(width_px: int, height_px: int, horizontal_fov_deg: float) -> np.ndarray:
    fx = (width_px / 2.0) / math.tan(math.radians(horizontal_fov_deg) / 2.0)
    fy = fx
    cx = width_px / 2.0
    cy = height_px / 2.0
    return np.array([[fx, 0.0, cx], [0.0, fy, cy], [0.0, 0.0, 1.0]], dtype=float)


def pose_from_homography(homography: np.ndarray, intrinsics: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Decompose a ground-plane homography into a pinhole camera pose.

    The homography maps world ground coordinates ``[x, y, 1]`` to image pixels.
    Given camera intrinsics K, H = K [r1 r2 t] up to scale.
    """

    b = np.linalg.inv(intrinsics) @ homography
    scale = 2.0 / (np.linalg.norm(b[:, 0]) + np.linalg.norm(b[:, 1]))
    r1 = scale * b[:, 0]
    r2 = scale * b[:, 1]
    t = scale * b[:, 2]
    r3 = np.cross(r1, r2)
    r = np.column_stack([r1, r2, r3])
    u, _, vt = np.linalg.svd(r)
    r = u @ vt
    if np.linalg.det(r) < 0:
        r *= -1.0
        t *= -1.0
    return r, t


def project_with_camera_pose(
    xyz_ft: np.ndarray,
    intrinsics: np.ndarray,
    rotation: np.ndarray,
    translation: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    camera_xyz = (rotation @ xyz_ft.T).T + translation
    image_h = (intrinsics @ camera_xyz.T).T
    uv = image_h[:, :2] / image_h[:, 2:3]
    visible = camera_xyz[:, 2] > 1e-6
    return uv, visible


def fit_similarity(src: np.ndarray, dst: np.ndarray) -> tuple[np.ndarray, float, float]:
    """Fit isotropic scale + rotation + translation from src to dst.

    The homography/vertical model should already be close, but this accounts
    for small FOV/pose errors without letting the matcher arbitrarily warp the
    trajectory.
    """

    src_mean = src.mean(axis=0)
    dst_mean = dst.mean(axis=0)
    src_c = src - src_mean
    dst_c = dst - dst_mean
    norm = float(np.sum(src_c**2))
    if norm <= 1e-9:
        return src, 1.0, 0.0
    cov = src_c.T @ dst_c
    u, _, vt = np.linalg.svd(cov)
    rotation = u @ vt
    if np.linalg.det(rotation) < 0:
        u[:, -1] *= -1
        rotation = u @ vt
    scale = float(np.trace((src_c @ rotation).T @ dst_c) / norm)
    fitted = scale * (src_c @ rotation) + dst_mean
    rotation_deg = float(math.degrees(math.atan2(rotation[1, 0], rotation[0, 0])))
    return fitted, scale, rotation_deg


def score_projection(predicted: np.ndarray, observed: np.ndarray, allow_similarity: bool) -> dict[str, float]:
    scale = 1.0
    rotation_deg = 0.0
    fitted = predicted
    if allow_similarity:
        fitted, scale, rotation_deg = fit_similarity(predicted, observed)
    residual = observed - fitted
    pixel_rmse = float(np.sqrt(np.mean(np.sum(residual**2, axis=1))))
    return {
        "pixel_rmse": pixel_rmse,
        "similarity_scale": scale,
        "similarity_rotation_deg": rotation_deg,
    }


def candidate_hits(conn: sqlite3.Connection, spray_deg: float | None) -> list[sqlite3.Row]:
    query = "SELECT * FROM synthetic_hits"
    params: tuple[Any, ...] = ()
    if spray_deg is not None:
        query += " WHERE ABS(spray_angle_deg - ?) <= 8"
        params = (spray_deg,)
    query += " ORDER BY hit_id"
    return conn.execute(query, params).fetchall()


def match(
    package: dict[str, Any],
    db_path: Path,
    fovs: list[float],
    allow_similarity: bool,
) -> dict[str, Any]:
    times, obs_uv = observed_points(package)
    homography = compute_package_homography(package)
    spray_deg = direction_to_spray(package)
    video = package.get("video_metadata") or {}
    width_px = int(video.get("width_px") or 1920)
    height_px = int(video.get("height_px") or 1080)

    results = []
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        for hit in candidate_hits(conn, spray_deg):
            xyz = interpolate_trajectory(conn, hit["hit_id"], times)
            for fov in fovs:
                intrinsics = intrinsics_from_fov(width_px, height_px, fov)
                rotation, translation = pose_from_homography(homography, intrinsics)
                projected, visible = project_with_camera_pose(xyz, intrinsics, rotation, translation)
                if not np.all(visible):
                    continue
                projection_score = score_projection(projected, obs_uv, allow_similarity)
                scale_penalty = abs(math.log(max(projection_score["similarity_scale"], 1e-6))) * 8.0 if allow_similarity else 0.0
                rotation_penalty = abs(projection_score["similarity_rotation_deg"]) / 8.0 if allow_similarity else 0.0
                score = projection_score["pixel_rmse"] / 30.0 + scale_penalty + rotation_penalty
                camera_center = -(rotation.T @ translation)
                results.append(
                    {
                        "hit_id": hit["hit_id"],
                        "score": score,
                        **projection_score,
                        "horizontal_fov_deg": fov,
                        "camera_center_ft": camera_center.tolist(),
                        "exit_velocity_mph": hit["exit_velocity_mph"],
                        "launch_angle_deg": hit["launch_angle_deg"],
                        "spray_angle_deg": hit["spray_angle_deg"],
                        "distance_ft": hit["distance_ft"],
                        "hang_time_s": hit["hang_time_s"],
                        "apex_ft": hit["apex_ft"],
                    }
                )
    results.sort(key=lambda row: row["score"])
    return {
        "method": "vantage_grid_projected_ball_points_only",
        "used_times_s": times.tolist(),
        "direction_spray_deg": spray_deg,
        "allow_similarity": allow_similarity,
        "horizontal_fovs_deg": fovs,
        "results": results[:50],
    }


def parse_float_list(value: str) -> list[float]:
    return [float(part.strip()) for part in value.split(",") if part.strip()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("observation_package", type=Path)
    parser.add_argument("--db", default=Path("data/hittrax_from_video.sqlite"), type=Path)
    parser.add_argument("--horizontal-fovs", default="45,50,55,60,65,70,75,80")
    parser.add_argument("--allow-similarity", action="store_true")
    parser.add_argument("--out", default=Path("comparison_output/vantage_grid_match.json"), type=Path)
    args = parser.parse_args()

    package = load_package(args.observation_package)
    report = match(
        package,
        args.db,
        parse_float_list(args.horizontal_fovs),
        args.allow_similarity,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Wrote {args.out}")
    for row in report["results"][:15]:
        print(
            f"{row['hit_id']:<24} score={row['score']:.3f} px={row['pixel_rmse']:.1f} "
            f"EV={row['exit_velocity_mph']:.1f} LA={row['launch_angle_deg']:.1f} "
            f"dist={row['distance_ft']:.1f} hang={row['hang_time_s']:.2f} "
            f"fov={row['horizontal_fov_deg']:.1f} "
            f"sim_scale={row['similarity_scale']:.3f} sim_rot={row['similarity_rotation_deg']:.1f}"
        )


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
