"""Direct video-first LA estimate, then EV from flight table constraints.

This separates two things that should not be conflated:

1. Launch angle is estimated from observed image direction plus field/camera
   geometry.
2. Exit velocity is inferred afterward from the flight simulator table using
   the measured LA, spray/direction, hang time, and distance evidence.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sqlite3

import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation
from path_distance_match import match_path_and_distance
from direction_first_match import home_plate_contact, with_contact_registration
from staged_flight_match import prepare_staged_flight, select_staged_match
from prediction_cancel import check_cancelled
from distance_hang_match import match_distance_and_hang
from distance_review import build_distance_review
from observation_validation import reject_early_anchor_arrivals

from calibrate_field_homography import FIELD_LANDMARKS_FT
from compare_homography_observations import (
    estimate_camera_from_homography,
    estimate_vertical_scale_from_camera,
    project_ground,
)
from match_vantage_grid import (
    intrinsics_from_fov,
    pose_from_homography,
    project_with_camera_pose,
)

PROJECTED_PATH_MAX_TIME_S = 0.45
PROJECTED_PATH_DECAY_S = 0.16
PROJECTED_PATH_MIN_WEIGHT = 0.18
PROJECTED_PATH_EARLY_CHECK_POINTS = 8
PROJECTED_PATH_EARLY_CHECK_WEIGHT = 1.0
FIELD_PROFILE_FENCE_FT = {
    "43_60_softball": 200.0,
    "45_60": 225.0,
    "50_70": 250.0,
    "60_90": 400.0,
}

FIXED_FIELD_LANDMARKS_FT = {
    key: FIELD_LANDMARKS_FT[key]
    for key in ("home_plate", "pitching_rubber", "first_base", "second_base", "third_base")
}


def load_package(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def usable_field_landmark_count(package: dict) -> int:
    return sum(
        1 for row in package.get("landmarks", [])
        if row.get("landmark") in FIXED_FIELD_LANDMARKS_FT
        and row.get("image_x") is not None
        and row.get("image_y") is not None
    )


def image_to_ground(h: np.ndarray, uv: np.ndarray) -> np.ndarray:
    h_inv = np.linalg.inv(h)
    pts = np.column_stack([uv, np.ones(len(uv))])
    projected = pts @ h_inv.T
    return projected[:, :2] / projected[:, 2:3]


def field_fence_ft(package: dict) -> float:
    metadata = package.get("video_metadata") or {}
    key = (
        (package.get("field") or {}).get("key")
        or (package.get("field_size") or {}).get("key")
        or metadata.get("field_size_key")
        or metadata.get("field_key")
        or "60_90"
    )
    if str(key) in FIELD_PROFILE_FENCE_FT:
        return FIELD_PROFILE_FENCE_FT[str(key)]
    field = package.get("field") or package.get("field_size") or {}
    try:
        return float(field.get("outfield_guide_distance_ft") or 400.0)
    except Exception:
        return 400.0


def direction_from_field_marker_percent(package: dict) -> dict | None:
    distance_observation = (package.get("hit", {}).get("distance_observation") or {})
    field_xy = distance_observation.get("terminal_ground_xy_ft") or distance_observation.get("field_xy_ft")
    if isinstance(field_xy, dict) and field_xy.get("x") is not None and field_xy.get("y") is not None:
        dx = float(field_xy["x"])
        dy = float(field_xy["y"])
        if abs(dx) < 1e-6 and abs(dy) < 1e-6:
            return None
        spray_deg = float(np.degrees(np.arctan2(dx, dy)))
        estimated_distance_ft = float(np.hypot(dx, dy))
        return {
            "source": str(distance_observation.get("source") or "actual_field_map").lower(),
            "spray_angle_deg": spray_deg,
            "direction_xy": [float(dx / estimated_distance_ft), float(dy / estimated_distance_ft)],
            "terminal_ground_xy_ft": [dx, dy],
            "estimated_distance_ft": estimated_distance_ft,
            "actual_field_map": distance_observation.get("actual_field_map"),
        }

    marker = (distance_observation.get("field_marker_percent") or {})
    if marker.get("x") is None or marker.get("y") is None:
        return None

    # Field diagram viewBox is 360x420 with home at (180, 316).  Convert the
    # stored overlay percentages back into that same schematic coordinate space.
    marker_x = float(marker["x"]) * 3.6
    marker_y = float(marker["y"]) * 4.2
    home_x = 180.0
    home_y = 316.0
    dx = marker_x - home_x
    dy = home_y - marker_y
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return None

    spray_deg = float(np.degrees(np.arctan2(dx, dy)))
    norm = float(np.hypot(dx, dy))
    # The field diagram distance arcs are drawn at radii 147, 176, 205, and
    # 234 SVG units for 250, 300, 350, and 400 ft respectively.
    estimated_distance_ft = norm * (field_fence_ft(package) / 234.0)
    return {
        "source": "field_endpoint_marker",
        "spray_angle_deg": spray_deg,
        "direction_xy": [float(math.sin(math.radians(spray_deg))), float(math.cos(math.radians(spray_deg)))],
        "terminal_ground_xy_ft": [
            float(math.sin(math.radians(spray_deg)) * estimated_distance_ft),
            float(math.cos(math.radians(spray_deg)) * estimated_distance_ft),
        ],
        "estimated_distance_ft": float(estimated_distance_ft),
        "field_marker_percent": {"x": float(marker["x"]), "y": float(marker["y"])},
        "field_marker_vector_percent": [float(dx / 3.6), float(dy / 4.2)],
    }


def field_diagram_marker_to_field_xy(marker: dict | None, package: dict | None = None) -> np.ndarray | None:
    if not marker or marker.get("x") is None or marker.get("y") is None:
        return None
    marker_x = float(marker["x"]) * 3.6
    marker_y = float(marker["y"]) * 4.2
    dx = marker_x - 180.0
    dy = 316.0 - marker_y
    scale = field_fence_ft(package or {}) / 234.0
    return np.array([dx * scale, dy * scale], dtype=float)


def camera_center_from_package(package: dict) -> np.ndarray | None:
    camera = package.get("camera") or {}
    field_xy = camera.get("field_xy_ft")
    if isinstance(field_xy, dict) and field_xy.get("x") is not None and field_xy.get("y") is not None:
        height = float(camera.get("height_ft") or 6.0)
        return np.array([float(field_xy["x"]), float(field_xy["y"]), height], dtype=float)
    xy = field_diagram_marker_to_field_xy(camera.get("field_marker_percent"), package)
    if xy is None:
        return None
    height = float(camera.get("height_ft") or 6.0)
    return np.array([float(xy[0]), float(xy[1]), height], dtype=float)


def fixed_landmark_rows(package: dict) -> list[dict]:
    return [
        row for row in package.get("landmarks", [])
        if row.get("landmark") in FIXED_FIELD_LANDMARKS_FT
        and row.get("image_x") is not None
        and row.get("image_y") is not None
    ]


def has_core_video_landmarks(rows: list[dict]) -> bool:
    marked = {str(row.get("landmark")) for row in rows}
    return {"home_plate", "pitching_rubber"}.issubset(marked)


def ignored_helper_landmarks(package: dict) -> list[str]:
    ignored = []
    for row in package.get("landmarks", []):
        landmark = row.get("landmark")
        if (
            landmark in FIELD_LANDMARKS_FT
            and landmark not in FIXED_FIELD_LANDMARKS_FT
            and row.get("image_x") is not None
            and row.get("image_y") is not None
        ):
            ignored.append(str(landmark))
    return ignored


def resolved_prediction_geometry(package: dict) -> dict:
    """Resolve the one geometry source used for this prediction.

    This keeps map/diagram direction, camera position, and fixed landmarks in
    one explicit contract so older fallback paths cannot silently answer with a
    different camera model.
    """

    direction = direction_from_field_marker_percent(package)
    camera_center = camera_center_from_package(package)
    fixed_rows = fixed_landmark_rows(package)
    source = (direction or {}).get("source")
    usable = direction is not None and camera_center is not None and has_core_video_landmarks(fixed_rows)
    missing = []
    if direction is None:
        missing.append("landing/direction geometry")
    if camera_center is None:
        missing.append("camera position")
    if not has_core_video_landmarks(fixed_rows):
        missing.append("home plate and pitching rubber video landmarks")
    return {
        "usable": usable,
        "source": source,
        "direction": direction,
        "camera_center_ft": None if camera_center is None else [float(v) for v in camera_center],
        "fixed_landmark_count": len(fixed_rows),
        "fixed_landmarks": [str(row.get("landmark")) for row in fixed_rows],
        "ignored_helper_landmarks": ignored_helper_landmarks(package),
        "missing": missing,
        "policy": "actual field map resolves landing/direction and field size; home plate plus pitching rubber video landmarks calibrate the minimum camera pose; extra bases improve confidence but are not required",
    }


def look_at_rotation(camera_center: np.ndarray, target: np.ndarray, roll_deg: float = 0.0) -> np.ndarray:
    forward = target - camera_center
    forward = forward / max(float(np.linalg.norm(forward)), 1e-9)
    # Fixed world-up cross product, without NumPy axis-dispatch overhead.
    right = np.array([forward[1], -forward[0], 0.0], dtype=float)
    right_length = float(np.linalg.norm(right))
    if right_length < 1e-9:
        right = np.array([1.0, 0.0, 0.0], dtype=float)
        right_length = 1.0
    right = right / right_length
    down = np.array([forward[1]*right[2]-forward[2]*right[1],
                     forward[2]*right[0]-forward[0]*right[2],
                     forward[0]*right[1]-forward[1]*right[0]], dtype=float)
    down = down / max(float(np.linalg.norm(down)), 1e-9)
    roll = math.radians(float(roll_deg))
    cos_r = math.cos(roll)
    sin_r = math.sin(roll)
    rolled_right = cos_r * right + sin_r * down
    rolled_down = -sin_r * right + cos_r * down
    return np.vstack([rolled_right, rolled_down, forward])


def baseline_constraints(package: dict) -> list[tuple[np.ndarray, np.ndarray]]:
    marks = {row.get("landmark"): row for row in package.get("landmarks", [])}
    result = []
    for side in ("first", "third"):
        pair = [marks.get(f"{side}_baseline_{end}") for end in ("near", "far")]
        if not all(row and row.get("image_x") is not None and row.get("image_y") is not None for row in pair):
            continue
        pixels = np.array([[row["image_x"], row["image_y"]] for row in pair], dtype=float)
        if not np.isfinite(pixels).all() or np.linalg.norm(pixels[1] - pixels[0]) < 20:
            raise ValueError(f"Mark two farther-apart points on the {side}-base line.")
        ground = np.array([[*FIXED_FIELD_LANDMARKS_FT[key], 0.0]
                           for key in ("home_plate", f"{side}_base")], dtype=float)
        result.append((ground, pixels))
    return result


def baseline_projection_errors(projected: np.ndarray, marked: np.ndarray) -> np.ndarray:
    # Only the infinite projected line is constrained, not distance along it.
    direction = projected[1] - projected[0]
    length = max(float(np.linalg.norm(direction)), 1e-6)
    normal = np.array([-direction[1], direction[0]]) / length
    return (marked - projected[0]) @ normal


def constrained_pose_from_three_landmarks(
    package: dict,
    width_px: int,
    height_px: int,
) -> dict | None:
    camera_center = camera_center_from_package(package)
    if camera_center is None:
        return None
    rows = [
        row for row in package.get("landmarks", [])
        if row.get("landmark") in FIXED_FIELD_LANDMARKS_FT
        and row.get("image_x") is not None
        and row.get("image_y") is not None
    ]
    if not has_core_video_landmarks(rows):
        return None
    world = np.array(
        [[*FIXED_FIELD_LANDMARKS_FT[row["landmark"]], 0.0] for row in rows],
        dtype=float,
    )
    image = np.array([[float(row["image_x"]), float(row["image_y"])] for row in rows], dtype=float)
    baselines = baseline_constraints(package)

    def unpack(params: np.ndarray) -> tuple[np.ndarray, float, float]:
        target = np.array([params[0], params[1], params[2]], dtype=float)
        return target, float(params[3]), float(params[4])

    def residual(params: np.ndarray) -> np.ndarray:
        check_cancelled()
        target, roll_deg, fov_deg = unpack(params)
        intrinsics = intrinsics_from_fov(width_px, height_px, fov_deg)
        rotation = look_at_rotation(camera_center, target, roll_deg)
        translation = -rotation @ camera_center
        projected, visible = project_with_camera_pose(world, intrinsics, rotation, translation)
        penalty = np.where(visible, 0.0, 500.0)
        residuals = [(projected - image).ravel() / 30.0, penalty]
        for ground, pixels in baselines:
            projected_line, _ = project_with_camera_pose(ground, intrinsics, rotation, translation)
            residuals.append(baseline_projection_errors(projected_line, pixels) / 10.0)
        if len(rows) < 3 and len(baselines) < 2:
            # Two video landmarks define the field axis in the image, but leave
            # one camera-pose degree underconstrained. Keep the solution in a
            # plausible phone-camera range instead of asking the user for bases.
            residuals.append(np.array([
                roll_deg / 8.0,
                (fov_deg - 62.0) / 18.0,
                target[0] / 90.0,
                (target[1] - 60.5) / 120.0,
                (target[2] - 3.0) / 6.0,
            ], dtype=float))
        return np.concatenate(residuals)

    starts = [
        [0.0, 60.5, 3.0, 0.0, 60.0],
        [0.0, 90.0, 3.0, 0.0, 70.0],
        [30.0, 70.0, 3.0, 0.0, 60.0],
        [-30.0, 70.0, 3.0, 0.0, 60.0],
        [0.0, 127.0, 5.0, 0.0, 75.0],
    ]
    bounds = ([-250.0, -60.0, 0.0, -35.0, 35.0], [250.0, 420.0, 20.0, 35.0, 90.0])
    best = None
    for start in starts:
        result = least_squares(residual, np.array(start, dtype=float), bounds=bounds, max_nfev=3000)
        rmse = float(np.sqrt(np.mean((residual(result.x)[: len(image) * 2] * 30.0) ** 2)))
        fit_score = float(np.sum(residual(result.x) ** 2))
        if best is None or fit_score < best["fit_score"]:
            target, roll_deg, fov_deg = unpack(result.x)
            intrinsics = intrinsics_from_fov(width_px, height_px, fov_deg)
            rotation = look_at_rotation(camera_center, target, roll_deg)
            translation = -rotation @ camera_center
            best = {
                "intrinsics": intrinsics,
                "rotation": rotation,
                "translation": translation,
                "camera_center_ft": camera_center,
                "target_ft": target,
                "roll_deg": roll_deg,
                "horizontal_fov_deg": fov_deg,
                "rmse_px": rmse,
                "fit_score": fit_score,
                "baseline_count": len(baselines),
                "landmark_count": len(rows),
            }
    if best is not None:
        best = refine_camera_from_baselines(best, package, world, image, baselines, width_px, height_px)
        best = with_contact_registration(best,package)
    return best


def video_only_camera_distance(world, image, baselines, width_px, height_px, height_ft):
    """Estimate ground distance without a map prior, conditional on camera height."""
    if len(baselines) != 2 or not math.isfinite(height_ft) or height_ft <= 0:
        return {"available": False, "reason": "two baselines and a positive camera height are required"}

    def unpack(params):
        center = np.array([params[4], params[5], height_ft])
        rotation = Rotation.from_rotvec(params[:3]).as_matrix()
        intrinsics = intrinsics_from_fov(width_px, height_px, params[3])
        return intrinsics, rotation, -rotation @ center, center

    def residual(params):
        check_cancelled()
        intrinsics, rotation, translation, _ = unpack(params)
        pixels, visible = project_with_camera_pose(world, intrinsics, rotation, translation)
        errors = [(pixels - image).ravel(), np.where(visible, 0.0, 5000.0)]
        for ground, marked in baselines:
            projected, _ = project_with_camera_pose(ground, intrinsics, rotation, translation)
            errors.append(baseline_projection_errors(projected, marked))
        return np.concatenate(errors)

    solutions = []
    for x, y, fov in [(-15, -40, 40), (0, -20, 70), (-30, -80, 30), (15, -40, 55)]:
        center = np.array([x, y, height_ft])
        rotation = look_at_rotation(center, np.array([0.0, 60.5, 3.0]), 0.0)
        start = np.r_[Rotation.from_matrix(rotation).as_rotvec(), fov, x, y]
        fit = least_squares(residual, start, bounds=(
            [-np.inf] * 3 + [10.0, -500.0, -500.0],
            [np.inf] * 3 + [120.0, 500.0, 500.0]), max_nfev=600)
        if fit.success and np.isfinite(fit.fun).all():
            solutions.append(fit)
    if not solutions:
        return {"available": False, "reason": "video-only camera fit did not converge"}
    best = min(solutions, key=lambda fit: float(np.sum(fit.fun ** 2)))
    intrinsics, rotation, translation, center = unpack(best.x)
    pixels, visible = project_with_camera_pose(world, intrinsics, rotation, translation)
    point_errors = (pixels - image).ravel().tolist()
    line_errors = []
    for ground, marked in baselines:
        projected, _ = project_with_camera_pose(ground, intrinsics, rotation, translation)
        line_errors.extend(baseline_projection_errors(projected, marked).tolist())
    rmse = float(np.sqrt(np.mean(np.square(point_errors + line_errors))))
    singular = np.linalg.svd(best.jac, compute_uv=False)
    at_limit = bool(best.x[3] <= 10.01 or best.x[3] >= 119.99 or np.any(np.abs(best.x[4:]) >= 499.9))
    identifiable = bool(singular[-1] > singular[0] * 1e-8)
    return {
        "available": True,
        "method": "video_landmarks_and_baselines_fixed_height_no_map_prior",
        "camera_center_ft": center.tolist(),
        "camera_to_home_ground_distance_ft": float(np.linalg.norm(center[:2])),
        "camera_height_ft": float(height_ft),
        "horizontal_fov_deg": float(best.x[3]),
        "alignment_rmse_px": rmse,
        "at_parameter_limit": at_limit,
        "identifiable_at_fixed_height": identifiable,
        "usable": bool(identifiable and not at_limit and np.all(visible) and rmse <= 5.0),
        "uses_map_position": False,
        "uses_ball_or_landing_distance": False,
        "conditional_on": "supplied camera height; centered principal point; square pixels; negligible lens distortion",
    }


def refine_camera_from_baselines(pose, package, world, image, baselines, width_px, height_px):
    from camera_geometry import refine_field_camera
    result = refine_field_camera(pose, package, world, image, baselines, width_px, height_px)
    center, rotation = result['camera_center_ft'], result['rotation']
    unrolled = look_at_rotation(center, center + rotation[2] * 100., 0.)
    result['roll_deg'] = float(np.degrees(np.arctan2(np.dot(rotation[0],unrolled[1]),np.dot(rotation[0],unrolled[0]))))
    result['calibration_diagnostics']['video_only_distance'] = video_only_camera_distance(
        world, image, baselines, width_px, height_px, float(pose['camera_center_ft'][2]))
    return result


def camera_adjusted_launch_angle(
    observed_image_velocity: np.ndarray,
    camera_center: np.ndarray,
    ground_direction_xy: np.ndarray,
    pose_launch_angle_deg: float,
) -> dict:
    image_velocity = np.asarray(observed_image_velocity, dtype=float)
    camera_xy = np.asarray(camera_center[:2], dtype=float)
    camera_norm = float(np.linalg.norm(camera_xy))
    direction_norm = float(np.linalg.norm(ground_direction_xy))
    pose_launch_angle_deg = float(pose_launch_angle_deg)
    if camera_norm <= 1e-6 or direction_norm <= 1e-6 or abs(float(image_velocity[0])) <= 1e-6:
        return {
            "launch_angle_deg": pose_launch_angle_deg,
            "camera_pose_launch_angle_deg": pose_launch_angle_deg,
        }

    hit_direction = ground_direction_xy / direction_norm
    camera_from_home = camera_xy / camera_norm
    depth_alignment = abs(float(np.dot(camera_from_home, hit_direction)))
    literal_rise_deg = float(np.degrees(np.arctan2(-float(image_velocity[1]), abs(float(image_velocity[0])))))
    across_component = math.sqrt(max(0.0, 1.0 - depth_alignment * depth_alignment))
    effective_across = max(0.22, across_component)
    line_of_sight_deg = float(np.degrees(np.arctan(math.tan(math.radians(literal_rise_deg)) * effective_across)))
    return {
        "launch_angle_deg": pose_launch_angle_deg,
        "camera_pose_launch_angle_deg": pose_launch_angle_deg,
        "literal_2d_rise_angle_deg": literal_rise_deg,
        "line_of_sight_depth_alignment": depth_alignment,
        "line_of_sight_across_component": across_component,
        "line_of_sight_effective_across_component": effective_across,
        "line_of_sight_adjusted_launch_angle_deg": line_of_sight_deg,
        "line_of_sight_selected_launch_angle_deg": pose_launch_angle_deg,
        "line_of_sight_note": "diagnostic only; final LA is solved from the 3D camera projection basis at the observed ball point",
    }


def estimate_launch_angle_from_fixed_pose(
    observed_image_velocity: np.ndarray,
    observed_origin_uv: np.ndarray,
    ground_direction_xy: np.ndarray,
    pose: dict,
    package: dict,
) -> dict:
    origin_xyz, origin_fit_error = contact_origin_for_observed_pixel(
        observed_origin_uv,
        pose["intrinsics"],
        pose["rotation"],
        pose["translation"],
        package,
        ground_direction_xy,
    )
    from camera_geometry import motion_basis
    basis = motion_basis(origin_xyz[0], ground_direction_xy, pose)
    ground_delta, vertical_delta = basis[:,0], basis[:,1]
    horizontal_ft_per_s, vertical_ft_per_s = np.linalg.lstsq(basis, observed_image_velocity, rcond=None)[0]
    reconstructed = basis @ np.array([horizontal_ft_per_s, vertical_ft_per_s])
    residual = observed_image_velocity - reconstructed
    pose_launch_angle_deg = float(np.degrees(np.arctan2(vertical_ft_per_s, abs(horizontal_ft_per_s))))
    angle = camera_adjusted_launch_angle(
        observed_image_velocity,
        pose["camera_center_ft"],
        ground_direction_xy,
        pose_launch_angle_deg,
    )
    return {
        "method": "constrained_camera_pose_from_three_landmarks_and_camera_marker",
        **angle,
        "launch_angle_range_deg": [angle["launch_angle_deg"] - 6.0, angle["launch_angle_deg"] + 6.0],
        "horizontal_fov_deg": float(pose["horizontal_fov_deg"]),
        "camera_center_ft": [float(v) for v in pose["camera_center_ft"]],
        "camera_target_ft": [float(v) for v in pose["target_ft"]],
        "camera_roll_deg": float(pose["roll_deg"]),
        "pose_landmark_rmse_px": float(pose["rmse_px"]),
        "pose_landmark_count": int(pose["landmark_count"]),
        "contact_origin_ft": [float(v) for v in origin_xyz[0]],
        "contact_origin_fit_error_px": float(origin_fit_error),
        "horizontal_component_ft_per_s_unscaled": float(horizontal_ft_per_s),
        "vertical_component_ft_per_s_unscaled": float(vertical_ft_per_s),
        "ground_image_delta_px_per_ft": [float(ground_delta[0]), float(ground_delta[1])],
        "vertical_image_delta_px_per_ft": [float(vertical_delta[0]), float(vertical_delta[1])],
        "image_reconstruction_residual_px_per_s": [float(residual[0]), float(residual[1])],
        "image_reconstruction_error_px_per_s": float(np.hypot(residual[0], residual[1])),
    }


def contact_height_guess_ft(package: dict) -> float:
    try:
        return float(((package.get("hit") or {}).get("contact") or {}).get("height_ft") or 2.5)
    except (TypeError, ValueError):
        return 2.5


def contact_origin_for_observed_pixel(
    observed_origin_uv: np.ndarray,
    intrinsics: np.ndarray,
    rotation: np.ndarray,
    translation: np.ndarray,
    package: dict,
    ground_direction_xy: np.ndarray | None = None,
) -> tuple[np.ndarray, float]:
    """Register contact on its clicked camera ray, independently of flight direction."""
    origin, error = home_plate_contact(observed_origin_uv, with_contact_registration({
        'intrinsics': intrinsics, 'rotation': rotation, 'translation': translation,
    },package))
    return origin[None, :], error


def target_distance_from_package(package: dict, direction: dict | None = None) -> tuple[float | None, float]:
    distance_obs = package.get("hit", {}).get("distance_observation") or {}
    if distance_obs.get("distance_ft") is not None:
        source = str(distance_obs.get("source") or "").lower()
        default_sigma = 12.0 if "actual_field_map" in source else 45.0
        floor_sigma = 5.0 if "actual_field_map" in source else 30.0
        return float(distance_obs["distance_ft"]), max(floor_sigma, float(distance_obs.get("uncertainty_ft") or default_sigma))
    if direction and direction.get("source") == "field_endpoint_marker" and direction.get("estimated_distance_ft") is not None:
        return float(direction["estimated_distance_ft"]), max(45.0, float(distance_obs.get("uncertainty_ft") or 60.0))
    return None, max(8.0, float(distance_obs.get("uncertainty_ft") or 50.0))


def fit_observed_image_direction(observations: list[dict], max_time_s: float = 0.18) -> dict:
    rows = [
        row for row in observations
        if row.get("image_x") is not None
        and row.get("image_y") is not None
        and row.get("relative_time_s") is not None
        and float(row["relative_time_s"]) <= max_time_s
    ]
    if len(rows) < 2:
        rows = [
            row for row in observations
            if row.get("image_x") is not None and row.get("image_y") is not None
        ][:5]
    if len(rows) < 2:
        raise ValueError("Need at least two ball observations to measure image direction.")

    times = np.array([float(row["relative_time_s"]) for row in rows], dtype=float)
    uv = np.array([[float(row["image_x"]), float(row["image_y"])] for row in rows], dtype=float)
    detected_anchor = next(
        (
            row for row in rows
            if str(row.get("source") or "").upper() in {"COMPUTER_VISION", "PATH_SEARCH", "BRUSH_PATH_SEARCH"}
        ),
        rows[0],
    )
    t = times - times[0]
    design = np.column_stack([np.ones(len(t)), t])
    x_intercept, x_slope = np.linalg.lstsq(design, uv[:, 0], rcond=None)[0]
    y_intercept, y_slope = np.linalg.lstsq(design, uv[:, 1], rcond=None)[0]
    delta = np.array([x_slope, y_slope], dtype=float)
    angle_deg = float(np.degrees(np.arctan2(delta[1], delta[0])))
    return {
        "used_count": len(rows),
        "time_span_s": float(times[-1] - times[0]),
        "image_velocity_px_per_s": [float(delta[0]), float(delta[1])],
        "image_angle_deg": angle_deg,
        "line_start_px": [float(x_intercept), float(y_intercept)],
        "detected_anchor_px": [float(detected_anchor["image_x"]), float(detected_anchor["image_y"])],
        "detected_anchor_time_s": float(detected_anchor["relative_time_s"]),
        "detected_anchor_source": detected_anchor.get("source"),
    }


def direction_from_terminal_or_package(package: dict, h: np.ndarray) -> dict:
    marker_direction = direction_from_field_marker_percent(package)
    if marker_direction is not None:
        return marker_direction

    declared_direction = (package.get("hit", {}).get("direction_observation") or {}).get("value")
    expected_sign = {
        "left_field": -1,
        "left_center": -1,
        "third_base_line": -1,
        "right_field": 1,
        "right_center": 1,
        "first_base_line": 1,
    }.get(declared_direction, 0)
    dropdown_spray = {
        "left_field": -35.0,
        "left_center": -18.0,
        "center_field": 0.0,
        "right_center": 18.0,
        "right_field": 35.0,
        "third_base_line": -45.0,
        "first_base_line": 45.0,
    }.get(declared_direction)
    if dropdown_spray is not None:
        rad = math.radians(dropdown_spray)
        return {
            "source": f"direction_dropdown:{declared_direction}",
            "spray_angle_deg": dropdown_spray,
            "direction_xy": [float(math.sin(rad)), float(math.cos(rad))],
            "terminal_ground_xy_ft": None,
        }

    terminal = package.get("terminal_event")
    if terminal and terminal.get("image_x") is not None and terminal.get("image_y") is not None:
        ground = image_to_ground(h, np.array([[float(terminal["image_x"]), float(terminal["image_y"])]], dtype=float))[0]
        spray_deg = float(np.degrees(np.arctan2(ground[0], ground[1])))
        norm = float(np.hypot(ground[0], ground[1]))
        terminal_sign = -1 if spray_deg < -3 else 1 if spray_deg > 3 else 0
        if norm > 1e-6 and (expected_sign == 0 or terminal_sign == 0 or terminal_sign == expected_sign):
            return {
                "source": "terminal_ground_contact",
                "spray_angle_deg": spray_deg,
                "direction_xy": [float(ground[0] / norm), float(ground[1] / norm)],
                "terminal_ground_xy_ft": [float(ground[0]), float(ground[1])],
            }

    landmarks = package.get("landmarks") or []
    for row in landmarks:
        if row.get("landmark") == "outfield_endpoint_estimate":
            ground = np.array(FIELD_LANDMARKS_FT["outfield_endpoint_estimate"], dtype=float)
            spray_deg = float(np.degrees(np.arctan2(ground[0], ground[1])))
            norm = float(np.hypot(ground[0], ground[1]))
            return {
                "source": "outfield_endpoint_estimate_landmark",
                "spray_angle_deg": spray_deg,
                "direction_xy": [float(ground[0] / norm), float(ground[1] / norm)],
                "terminal_ground_xy_ft": [float(ground[0]), float(ground[1])],
            }

    fallback = 0.0
    rad = math.radians(fallback)
    return {
        "source": f"direction_dropdown:{declared_direction or 'unknown'}",
        "spray_angle_deg": fallback,
        "direction_xy": [float(math.sin(rad)), float(math.cos(rad))],
        "terminal_ground_xy_ft": None,
    }


def estimate_launch_angle(
    h: np.ndarray,
    vertical_px_per_ft: float,
    observed_image_velocity: np.ndarray,
    ground_direction_xy: np.ndarray,
) -> dict:
    q = np.asarray(h) @ np.array([0.,0.,1.])
    jacobian = (np.asarray(h)[:2,:2]*q[2]-q[:2,None]*np.asarray(h)[2,:2])/q[2]**2
    ground_delta = jacobian @ np.asarray(ground_direction_xy)
    vertical_delta = np.array([0.0, -vertical_px_per_ft], dtype=float)

    basis = np.column_stack([ground_delta, vertical_delta])
    horizontal_ft_per_s, vertical_ft_per_s = np.linalg.lstsq(basis, observed_image_velocity, rcond=None)[0]
    launch_angle_deg = float(np.degrees(np.arctan2(vertical_ft_per_s, abs(horizontal_ft_per_s))))
    reconstructed = basis @ np.array([horizontal_ft_per_s, vertical_ft_per_s])
    residual = observed_image_velocity - reconstructed
    return {
        "launch_angle_deg": launch_angle_deg,
        "horizontal_component_ft_per_s_unscaled": float(horizontal_ft_per_s),
        "vertical_component_ft_per_s_unscaled": float(vertical_ft_per_s),
        "ground_image_delta_px_per_ft": [float(ground_delta[0]), float(ground_delta[1])],
        "vertical_image_delta_px_per_ft": [float(vertical_delta[0]), float(vertical_delta[1])],
        "image_reconstruction_residual_px_per_s": [float(residual[0]), float(residual[1])],
        "image_reconstruction_error_px_per_s": float(np.hypot(residual[0], residual[1])),
    }


def camera_height_target(package: dict) -> float | None:
    camera = package.get("camera") or {}
    for key in ("height_ft", "camera_height_ft"):
        value = camera.get(key)
        if value is not None:
            try:
                return float(value)
            except (TypeError, ValueError):
                return None
    return None


def estimate_launch_angle_from_pose(
    h: np.ndarray,
    width_px: int,
    height_px: int,
    observed_image_velocity: np.ndarray,
    observed_origin_uv: np.ndarray,
    ground_direction_xy: np.ndarray,
    package: dict,
    fovs: list[float],
) -> dict:
    """Measure launch angle with a pinhole camera pose inferred from field markers.

    For each plausible FOV, decompose the ground homography into K[R|t].  Then
    use the local projected image vectors for one foot downrange and one foot
    vertically up at contact.  This removes the old screen-up shortcut.
    """

    target_height = camera_height_target(package)

    variants = []
    for fov in fovs:
        intrinsics = intrinsics_from_fov(width_px, height_px, fov)
        rotation, translation = pose_from_homography(h, intrinsics)
        origin_xyz, origin_fit_error = contact_origin_for_observed_pixel(
            observed_origin_uv,
            intrinsics,
            rotation,
            translation,
            package,
            ground_direction_xy,
        )
        origin_uv, origin_visible = project_with_camera_pose(origin_xyz, intrinsics, rotation, translation)
        if not bool(origin_visible[0]):
            continue
        from camera_geometry import motion_basis
        basis = motion_basis(origin_xyz[0], ground_direction_xy,
                             dict(intrinsics=intrinsics,rotation=rotation,translation=translation))
        ground_delta, vertical_delta = basis[:,0], basis[:,1]
        if abs(float(np.linalg.det(basis))) < 1e-6:
            continue

        horizontal_ft_per_s, vertical_ft_per_s = np.linalg.lstsq(basis, observed_image_velocity, rcond=None)[0]
        reconstructed = basis @ np.array([horizontal_ft_per_s, vertical_ft_per_s])
        residual = observed_image_velocity - reconstructed
        pose_launch_angle_deg = float(np.degrees(np.arctan2(vertical_ft_per_s, abs(horizontal_ft_per_s))))
        camera_center = -(rotation.T @ translation)
        angle = camera_adjusted_launch_angle(
            observed_image_velocity,
            camera_center,
            ground_direction_xy,
            pose_launch_angle_deg,
        )
        height_error = None if target_height is None else abs(float(camera_center[2]) - target_height)
        variants.append(
            {
                "horizontal_fov_deg": float(fov),
                **angle,
                "horizontal_component_ft_per_s_unscaled": float(horizontal_ft_per_s),
                "vertical_component_ft_per_s_unscaled": float(vertical_ft_per_s),
                "ground_image_delta_px_per_ft": [float(ground_delta[0]), float(ground_delta[1])],
                "vertical_image_delta_px_per_ft": [float(vertical_delta[0]), float(vertical_delta[1])],
                "contact_origin_ft": [float(v) for v in origin_xyz[0]],
                "contact_origin_fit_error_px": float(origin_fit_error),
                "camera_center_ft": [float(camera_center[0]), float(camera_center[1]), float(camera_center[2])],
                "camera_height_target_ft": target_height,
                "camera_height_error_ft": height_error,
                "image_reconstruction_residual_px_per_s": [float(residual[0]), float(residual[1])],
                "image_reconstruction_error_px_per_s": float(np.hypot(residual[0], residual[1])),
            }
        )

    if not variants:
        raise ValueError("Could not derive a usable camera-pose launch-angle estimate.")

    if target_height is not None:
        selected = min(
            variants,
            key=lambda row: (
                row["camera_height_error_ft"] if row["camera_height_error_ft"] is not None else float("inf"),
                row["image_reconstruction_error_px_per_s"],
            ),
        )
    else:
        selected = min(variants, key=lambda row: abs(row["horizontal_fov_deg"] - 60.0))

    angles = [row["launch_angle_deg"] for row in variants]
    return {
        **selected,
        "method": "homography_decomposed_camera_pose_fov_sweep",
        "fov_sweep": variants,
        "launch_angle_range_deg": [float(min(angles)), float(max(angles))],
    }


def estimate_apex_evidence(
    package: dict,
    observations: list[dict],
    h: np.ndarray,
    direct_launch_angle: dict,
    ground_direction_xy: np.ndarray,
) -> dict | None:
    explicit = ((package.get("hit") or {}).get("apex_observation") or {})
    explicit_time = explicit.get("relative_time_s")
    explicit_height = explicit.get("height_ft")
    if explicit_time is not None and explicit_height is None:
        try:
            confidence = str(explicit.get("confidence") or "MEDIUM").upper()
            apex_time_s = float(explicit_time)
            start_height_ft = float(((package.get("hit") or {}).get("contact") or {}).get("height_ft") or 2.5)
            g_ft_s2 = 32.174
            ballistic_height_ft = start_height_ft + 0.5 * g_ft_s2 * apex_time_s * apex_time_s
            return {
                "observed": True,
                "source": "explicit_apex_time_observation",
                "reason": "user-marked apex frame; height estimated from time-to-apex physics",
                "relative_time_s": apex_time_s,
                "candidate_relative_time_s": apex_time_s,
                "estimated_height_ft": ballistic_height_ft,
                "estimated_height_source": "time_to_apex_ballistic_height",
                "start_height_ft": start_height_ft,
                "confidence": confidence,
                "score_weight": {"HIGH": 1.15, "MEDIUM": 0.85, "LOW": 0.45}.get(confidence, 0.65),
                "time_uncertainty_s": float(explicit.get("time_uncertainty_s") or explicit.get("uncertainty_s") or 0.08),
                "height_uncertainty_ft": float(explicit.get("height_uncertainty_ft") or 8.0),
                "note": "Apex time was supplied explicitly; for depth-heavy views this is treated as the physical apex and is not moved earlier by image perspective.",
            }
        except (TypeError, ValueError):
            pass
    if explicit_time is not None and explicit_height is not None:
        try:
            confidence = str(explicit.get("confidence") or "MEDIUM").upper()
            return {
                "observed": True,
                "source": "explicit_apex_observation",
                "relative_time_s": float(explicit_time),
                "estimated_height_ft": float(explicit_height),
                "confidence": confidence,
                "score_weight": {"HIGH": 1.15, "MEDIUM": 0.85, "LOW": 0.45}.get(confidence, 0.65),
                "time_uncertainty_s": float(explicit.get("time_uncertainty_s") or explicit.get("uncertainty_s") or 0.12),
                "height_uncertainty_ft": float(explicit.get("height_uncertainty_ft") or 12.0),
                "note": "Apex evidence was supplied explicitly; it is used as a physics anchor for EV/LA.",
            }
        except (TypeError, ValueError):
            pass

    rows = [
        row for row in observations
        if row.get("image_x") is not None
        and row.get("image_y") is not None
        and row.get("relative_time_s") is not None
    ]
    rows = sorted(rows, key=lambda row: float(row["relative_time_s"]))
    if len(rows) < 5:
        return None

    ys = np.array([float(row["image_y"]) for row in rows], dtype=float)
    apex_index = int(np.argmin(ys))
    if apex_index == 0 or apex_index == len(rows) - 1:
        return {
            "observed": False,
            "reason": "highest visible point is at the edge of the tracked path",
            "used_count": len(rows),
        }
    if len(rows) - apex_index - 1 < 2:
        return {
            "observed": False,
            "reason": "not enough post-peak points to confirm a real apex",
            "used_count": len(rows),
        }

    apex_row = rows[apex_index]
    apex_time = float(apex_row["relative_time_s"])
    apex_uv = np.array([float(apex_row["image_x"]), float(apex_row["image_y"])], dtype=float)
    vertical_delta = np.array(direct_launch_angle.get("vertical_image_delta_px_per_ft") or [0.0, -1.0], dtype=float)
    vertical_norm = float(np.dot(vertical_delta, vertical_delta))
    horizontal_speed = float(direct_launch_angle.get("horizontal_component_ft_per_s_unscaled") or 0.0)
    if vertical_norm <= 1e-6 or abs(horizontal_speed) <= 1e-6:
        return None

    ground_distance_ft = max(0.0, horizontal_speed * apex_time)
    ground_xy = np.array(
        [[ground_direction_xy[0] * ground_distance_ft, ground_direction_xy[1] * ground_distance_ft]],
        dtype=float,
    )
    expected_ground_uv = project_ground(h, ground_xy)[0]
    apex_height_ft = float(np.dot(apex_uv - expected_ground_uv, vertical_delta) / vertical_norm)
    apex_height_ft = max(0.0, apex_height_ft)

    before_drop_px = float(ys[apex_index - 1] - ys[apex_index])
    after_drop_px = float(ys[apex_index + 1] - ys[apex_index])
    sustained_descent_px = float(np.max(ys[apex_index + 1:]) - ys[apex_index])
    descent_time_span_s = float(float(rows[-1]["relative_time_s"]) - float(apex_row["relative_time_s"]))
    if sustained_descent_px < 12.0 or descent_time_span_s < 0.08:
        return {
            "observed": False,
            "reason": "no sustained descent after highest visible point",
            "used_count": len(rows),
            "candidate_relative_time_s": apex_time,
            "sustained_descent_px": sustained_descent_px,
            "descent_time_span_s": descent_time_span_s,
        }
    prominence_px = min(before_drop_px, after_drop_px)
    total_rise_px = float(max(ys[0], ys[-1]) - ys[apex_index])
    confidence = "LOW"
    weight = 0.12
    if prominence_px >= 6 and total_rise_px >= 20:
        confidence = "MEDIUM"
        weight = 0.18
    if prominence_px >= 12 and total_rise_px >= 40:
        confidence = "HIGH"
        weight = 0.35

    return {
        "observed": True,
        "source": "existing_ball_points",
        "used_count": len(rows),
        "relative_time_s": apex_time,
        "image_x": float(apex_row["image_x"]),
        "image_y": float(apex_row["image_y"]),
        "estimated_height_ft": apex_height_ft,
        "estimated_ground_distance_ft": ground_distance_ft,
        "prominence_px": prominence_px,
        "sustained_descent_px": sustained_descent_px,
        "descent_time_span_s": descent_time_span_s,
        "total_rise_px": total_rise_px,
        "confidence": confidence,
        "score_weight": weight,
        "time_uncertainty_s": 0.18 if confidence == "LOW" else 0.12 if confidence == "MEDIUM" else 0.08,
        "height_uncertainty_ft": 28.0 if confidence == "LOW" else 18.0 if confidence == "MEDIUM" else 12.0,
        "note": "Apex evidence is inferred only when the highest visible ball point is inside the tracked sequence.",
    }


def classify_view_geometry(package: dict, ground_direction_xy: np.ndarray, direct_launch_angle: dict) -> dict:
    camera_center = direct_launch_angle.get("camera_center_ft")
    if camera_center is None:
        return {
            "classification": "unknown",
            "depth_alignment": None,
            "reason": "camera center unavailable",
        }
    camera_xy = np.array([float(camera_center[0]), float(camera_center[1])], dtype=float)
    camera_norm = float(np.linalg.norm(camera_xy))
    direction_norm = float(np.linalg.norm(ground_direction_xy))
    if camera_norm <= 1e-6 or direction_norm <= 1e-6:
        return {
            "classification": "unknown",
            "depth_alignment": None,
            "reason": "camera or hit direction is degenerate",
        }

    camera_from_home = camera_xy / camera_norm
    hit_direction = ground_direction_xy / direction_norm
    depth_alignment = abs(float(np.dot(camera_from_home, hit_direction)))
    if depth_alignment >= 0.95:
        classification = "depth_heavy"
        reason = "hit direction has a large component toward/away from the camera"
    elif depth_alignment <= 0.25:
        classification = "side_on"
        reason = "hit direction is mostly across the camera view"
    else:
        classification = "oblique"
        reason = "hit direction has mixed side and depth components"

    return {
        "classification": classification,
        "depth_alignment": depth_alignment,
        "camera_center_ft": [float(camera_xy[0]), float(camera_xy[1]), float(camera_center[2])],
        "camera_vantage": (package.get("camera") or {}).get("vantage"),
        "reason": reason,
    }


def apex_physics_estimate(apex_evidence: dict | None, start_height_ft: float = 2.5) -> dict | None:
    if not (apex_evidence and apex_evidence.get("observed")):
        return None
    try:
        apex_time_s = float(apex_evidence["relative_time_s"])
        apex_height_ft = float(apex_evidence["estimated_height_ft"])
    except (KeyError, TypeError, ValueError):
        return None
    if apex_time_s <= 0:
        return None

    g_ft_s2 = 32.174
    height_gain_ft = max(0.0, apex_height_ft - start_height_ft)
    vz_from_height_ft_s = (height_gain_ft + 0.5 * g_ft_s2 * apex_time_s * apex_time_s) / apex_time_s
    vz_from_time_ft_s = g_ft_s2 * apex_time_s
    vertical_velocity_ft_s = 0.5 * (vz_from_height_ft_s + vz_from_time_ft_s)
    conflict_ft_s = abs(vz_from_height_ft_s - vz_from_time_ft_s)
    return {
        "source": "apex_time_and_height_ballistic_vertical_component",
        "apex_time_s": apex_time_s,
        "apex_height_ft": apex_height_ft,
        "start_height_ft": start_height_ft,
        "height_gain_ft": height_gain_ft,
        "vertical_velocity_from_height_ft_s": vz_from_height_ft_s,
        "vertical_velocity_from_time_ft_s": vz_from_time_ft_s,
        "vertical_velocity_ft_s": vertical_velocity_ft_s,
        "vertical_velocity_mph": vertical_velocity_ft_s / 1.467,
        "time_height_conflict_ft_s": conflict_ft_s,
        "note": "This gives the vertical launch component. EV/LA are selected by matching this apex against the synthetic flight table.",
    }


def apex_time_launch_angle_estimate(
    apex_evidence: dict | None,
    launch_angle_deg: float | None,
    start_height_ft: float = 2.5,
) -> dict | None:
    if not apex_evidence or launch_angle_deg is None:
        return None
    apex_time = apex_evidence.get("relative_time_s") or apex_evidence.get("candidate_relative_time_s")
    if apex_time is None:
        return None
    try:
        apex_time_s = float(apex_time)
        launch_angle = float(launch_angle_deg)
    except (TypeError, ValueError):
        return None
    if apex_time_s <= 0 or abs(math.sin(math.radians(launch_angle))) <= 1e-6:
        return None

    g_ft_s2 = 32.174
    vertical_velocity_ft_s = g_ft_s2 * apex_time_s
    exit_velocity_ft_s = vertical_velocity_ft_s / math.sin(math.radians(launch_angle))
    apex_height_ft = start_height_ft + 0.5 * g_ft_s2 * apex_time_s * apex_time_s
    confidence = "MEDIUM" if apex_evidence.get("observed") else "LOW"
    return {
        "source": "apex_time_and_launch_angle_ballistic_estimate",
        "apex_time_s": apex_time_s,
        "apex_height_ft": apex_height_ft,
        "start_height_ft": start_height_ft,
        "launch_angle_deg": launch_angle,
        "vertical_velocity_ft_s": vertical_velocity_ft_s,
        "vertical_velocity_mph": vertical_velocity_ft_s / 1.467,
        "exit_velocity_ft_s": exit_velocity_ft_s,
        "exit_velocity_mph": exit_velocity_ft_s / 1.467,
        "confidence": confidence,
        "note": "Estimated from time-to-apex and launch angle only; no tagged apex height required.",
    }


def apex_ballistic_launch_estimate(apex_physics: dict | None, distance_ft: float | None) -> dict | None:
    if not apex_physics or distance_ft is None:
        return None
    vertical_velocity_ft_s = float(apex_physics["vertical_velocity_ft_s"])
    start_height_ft = float(apex_physics.get("start_height_ft") or 2.5)
    g_ft_s2 = 32.174
    landing_time_s = (vertical_velocity_ft_s + math.sqrt(vertical_velocity_ft_s**2 + 2.0 * g_ft_s2 * start_height_ft)) / g_ft_s2
    if landing_time_s <= 0:
        return None
    horizontal_velocity_ft_s = float(distance_ft) / landing_time_s
    exit_velocity_ft_s = math.hypot(horizontal_velocity_ft_s, vertical_velocity_ft_s)
    launch_angle_deg = math.degrees(math.atan2(vertical_velocity_ft_s, horizontal_velocity_ft_s))
    return {
        "source": "apex_time_height_and_endpoint_distance_ballistic_estimate",
        "distance_ft": float(distance_ft),
        "landing_time_s": landing_time_s,
        "horizontal_velocity_ft_s": horizontal_velocity_ft_s,
        "horizontal_velocity_mph": horizontal_velocity_ft_s / 1.467,
        "vertical_velocity_ft_s": vertical_velocity_ft_s,
        "vertical_velocity_mph": vertical_velocity_ft_s / 1.467,
        "exit_velocity_ft_s": exit_velocity_ft_s,
        "exit_velocity_mph": exit_velocity_ft_s / 1.467,
        "launch_angle_deg": launch_angle_deg,
        "note": "Used for depth-heavy views when apex time/height and endpoint distance are available.",
    }


def estimate_image_apex_time(observations: list[dict]) -> dict | None:
    rows = [
        row for row in observations
        if row.get("image_x") is not None
        and row.get("image_y") is not None
        and row.get("relative_time_s") is not None
    ]
    rows = sorted(rows, key=lambda row: float(row["relative_time_s"]))
    if len(rows) < 5:
        return None
    ys = np.array([float(row["image_y"]) for row in rows], dtype=float)
    apex_index = int(np.argmin(ys))
    if apex_index == 0 or apex_index == len(rows) - 1:
        return {
            "observed": False,
            "reason": "highest visible point is at the edge of the tracked path",
            "used_count": len(rows),
        }
    apex_row = rows[apex_index]
    if len(rows) - apex_index - 1 < 2:
        return {
            "observed": False,
            "reason": "not enough post-peak points to confirm a real apex",
            "used_count": len(rows),
            "candidate_relative_time_s": float(apex_row["relative_time_s"]),
        }
    before_drop_px = float(ys[apex_index - 1] - ys[apex_index])
    after_drop_px = float(ys[apex_index + 1] - ys[apex_index])
    sustained_descent_px = float(np.max(ys[apex_index + 1:]) - ys[apex_index])
    descent_time_span_s = float(float(rows[-1]["relative_time_s"]) - float(apex_row["relative_time_s"]))
    if sustained_descent_px < 12.0 or descent_time_span_s < 0.08:
        return {
            "observed": False,
            "reason": "no sustained descent after highest visible point",
            "used_count": len(rows),
            "candidate_relative_time_s": float(apex_row["relative_time_s"]),
            "sustained_descent_px": sustained_descent_px,
            "descent_time_span_s": descent_time_span_s,
        }
    prominence_px = min(before_drop_px, after_drop_px)
    total_rise_px = float(max(ys[0], ys[-1]) - ys[apex_index])
    confidence = "LOW"
    weight = 0.25
    uncertainty = 0.28
    if prominence_px >= 4 and total_rise_px >= 25:
        confidence = "MEDIUM"
        weight = 0.55
        uncertainty = 0.18
    if prominence_px >= 10 and total_rise_px >= 45:
        confidence = "HIGH"
        weight = 0.9
        uncertainty = 0.1
    return {
        "observed": True,
        "source": "image_apex_time",
        "used_count": len(rows),
        "relative_time_s": float(apex_row["relative_time_s"]),
        "image_x": float(apex_row["image_x"]),
        "image_y": float(apex_row["image_y"]),
        "prominence_px": prominence_px,
        "sustained_descent_px": sustained_descent_px,
        "descent_time_span_s": descent_time_span_s,
        "total_rise_px": total_rise_px,
        "confidence": confidence,
        "score_weight": weight,
        "time_uncertainty_s": uncertainty,
        "note": "Apex time is usable without field calibration; apex height still requires calibrated geometry.",
    }


def uncalibrated_apex_evidence(package: dict) -> dict | None:
    explicit = ((package.get("hit") or {}).get("apex_observation") or {})
    if explicit.get("relative_time_s") is not None:
        confidence = str(explicit.get("confidence") or "LOW").upper()
        height = explicit.get("height_ft")
        apex_time_s = float(explicit["relative_time_s"])
        start_height_ft = float(((package.get("hit") or {}).get("contact") or {}).get("height_ft") or 2.5)
        if height is None:
            height = start_height_ft + 0.5 * 32.174 * apex_time_s * apex_time_s
        return {
            "observed": True,
            "source": "explicit_apex_observation" if explicit.get("height_ft") is not None else "explicit_apex_time_observation",
            "relative_time_s": apex_time_s,
            "estimated_height_ft": float(height),
            "estimated_height_source": "explicit_height" if explicit.get("height_ft") is not None else "time_to_apex_ballistic_height",
            "start_height_ft": start_height_ft,
            "confidence": confidence,
            "time_uncertainty_s": float(explicit.get("time_uncertainty_s") or 0.15),
            "height_uncertainty_ft": float(explicit.get("height_uncertainty_ft") or (15.0 if explicit.get("height_ft") is not None else 8.0)),
            "score_weight": {"HIGH": 1.0, "MEDIUM": 0.65, "LOW": 0.3}.get(confidence, 0.3),
            "note": "Explicit apex time is scored as the physical apex; height is explicit when supplied, otherwise estimated from time-to-apex physics.",
        }
    return estimate_image_apex_time(package.get("ball_observations") or [])


def is_auto_contact_seed(row: dict) -> bool:
    note = str(row.get("note") or "").lower()
    return (
        abs(float(row.get("relative_time_s") or 0.0)) <= 1e-6
        and (
            "contact seed retained" in note
            or "manual contact ball point" in note
        )
    )


def observed_path_rows(observations: list[dict], max_time_s: float = 0.35) -> list[dict]:
    rows = [
        row for row in observations
        if row.get("image_x") is not None
        and row.get("image_y") is not None
        and row.get("relative_time_s") is not None
        and 0.0 <= float(row["relative_time_s"]) <= max_time_s
        and not is_auto_contact_seed(row)
    ]
    return sorted(rows, key=lambda row: float(row["relative_time_s"]))


def path_source_summary(rows: list[dict]) -> dict:
    cv_count = sum(1 for row in rows if str(row.get("source") or "").upper() == "COMPUTER_VISION")
    manual_count = sum(1 for row in rows if str(row.get("source") or "").upper() != "COMPUTER_VISION")
    high_confidence_count = sum(1 for row in rows if str(row.get("confidence") or "").upper() == "HIGH")
    usable_point_count = min(len(rows), PROJECTED_PATH_EARLY_CHECK_POINTS)
    median_uncertainty = None
    uncertainties = sorted(
        float(row.get("uncertainty_px") or 30.0)
        for row in rows
        if math.isfinite(float(row.get("uncertainty_px") or 30.0))
    )
    if uncertainties:
        median_uncertainty = float(uncertainties[len(uncertainties) // 2])
    point_count_strength = min(1.0, usable_point_count / float(PROJECTED_PATH_EARLY_CHECK_POINTS))
    if median_uncertainty is None:
        point_quality_strength = 0.5
    else:
        point_quality_strength = float(np.clip(24.0 / max(6.0, median_uncertainty), 0.35, 1.0))
    confidence_strength = min(1.0, (manual_count + high_confidence_count) / max(1.0, float(usable_point_count)))
    path_evidence_strength = point_count_strength * (
        0.7 * point_quality_strength + 0.3 * max(point_quality_strength, confidence_strength)
    )
    timing_reliable = (
        len(rows) >= 4
        and (
            manual_count >= max(3, cv_count)
            or high_confidence_count >= 3
            or (median_uncertainty is not None and median_uncertainty <= 24.0)
        )
    )
    return {
        "manual_points": int(manual_count),
        "computer_vision_points": int(cv_count),
        "high_confidence_points": int(high_confidence_count),
        "usable_point_count": int(usable_point_count),
        "max_strength_point_count": PROJECTED_PATH_EARLY_CHECK_POINTS,
        "point_count_strength": point_count_strength,
        "point_quality_strength": point_quality_strength,
        "path_evidence_strength": path_evidence_strength,
        "median_uncertainty_px": median_uncertainty,
        "timing_reliable": bool(timing_reliable),
        "timing_policy": "frame_specific_points" if timing_reliable else "low_confidence_auto_detection_downweighted",
    }


def observed_path_measurements(observations: list[dict], max_time_s: float = 0.35, min_points: int = 4) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    rows = observed_path_rows(observations, max_time_s=max_time_s)
    if len(rows) < min_points:
        return None
    times = np.array([float(row["relative_time_s"]) for row in rows], dtype=float)
    uv = np.array([[float(row["image_x"]), float(row["image_y"])] for row in rows], dtype=float)
    uncertainty = np.array([max(6.0, float(row.get("uncertainty_px") or 30.0)) for row in rows], dtype=float)
    return times, uv, uncertainty


def observed_path_points(observations: list[dict], max_time_s: float = 0.35, min_points: int = 4) -> tuple[np.ndarray, np.ndarray] | None:
    measurements = observed_path_measurements(observations, max_time_s=max_time_s, min_points=min_points)
    if measurements is None:
        return None
    times, uv, _uncertainty = measurements
    return times, uv


def normalize_2d_shape(points: np.ndarray) -> np.ndarray | None:
    if len(points) < 2:
        return None
    translated = points - points[0]
    chord = translated[-1]
    scale = float(np.linalg.norm(chord))
    if scale < 1e-6:
        return None
    angle = math.atan2(float(chord[1]), float(chord[0]))
    cos_a = math.cos(-angle)
    sin_a = math.sin(-angle)
    rotation = np.array([[cos_a, -sin_a], [sin_a, cos_a]], dtype=float)
    return (translated @ rotation.T) / scale


def synthetic_shape_variants(xyz: np.ndarray) -> list[np.ndarray]:
    horizontal_range = np.sqrt(xyz[:, 0] ** 2 + xyz[:, 1] ** 2)
    variants = [
        np.column_stack([horizontal_range, xyz[:, 2]]),
        np.column_stack([xyz[:, 0], xyz[:, 2]]),
        np.column_stack([xyz[:, 1], xyz[:, 2]]),
        np.column_stack([-xyz[:, 0], xyz[:, 2]]),
        np.column_stack([-xyz[:, 1], xyz[:, 2]]),
    ]
    return variants + [np.column_stack([variant[:, 0], -variant[:, 1]]) for variant in variants]


def minimal_shape_score(obs_uv: np.ndarray, xyz: np.ndarray) -> tuple[float, str] | None:
    obs_shape = normalize_2d_shape(obs_uv)
    if obs_shape is None:
        return None
    best_score = None
    best_variant = ""
    for idx, variant in enumerate(synthetic_shape_variants(xyz)):
        synth_shape = normalize_2d_shape(variant)
        if synth_shape is None:
            continue
        deltas = obs_shape[1:-1] - synth_shape[1:-1]
        score = float(np.sqrt(np.mean(np.sum(deltas**2, axis=1)))) if len(deltas) else 0.0
        if best_score is None or score < best_score:
            best_score = score
            best_variant = f"normalized_arc_variant_{idx}"
    if best_score is None:
        return None
    return best_score, best_variant


def score_uncalibrated_path_shapes(package: dict, db_path: Path) -> dict:
    observed = observed_path_points(package.get("ball_observations") or [], max_time_s=1.5, min_points=3)
    if observed is None:
        return {"used": False, "reason": "need at least three ball points", "candidates": []}
    times, obs_uv = observed
    obs_sigma = np.full(len(times), 30.0, dtype=float)
    distance_obs = package.get("hit", {}).get("distance_observation") or {}
    marker_direction = direction_from_field_marker_percent(package)
    target_distance, distance_sigma = target_distance_from_package(package, marker_direction)
    if target_distance is not None and distance_obs.get("distance_ft") is not None:
        distance_source = "numeric_distance"
    elif target_distance is not None and marker_direction and marker_direction.get("source") == "field_endpoint_marker":
        distance_source = "field_endpoint_marker"
    else:
        distance_source = None
    terminal = package.get("terminal_event") or {}
    target_hang = terminal.get("relative_time_s") if terminal.get("type") == "FIRST_GROUND_CONTACT" else None
    terminal_confidence = str(terminal.get("confidence") or "LOW").upper()
    hang_sigma = float(terminal.get("timing_uncertainty_s") or 0.5)
    hang_weight = {
        "HIGH": 0.9,
        "MEDIUM": 0.55,
        "LOW": 0.12,
        "VERY_LOW": 0.05,
    }.get(terminal_confidence, 0.05)
    if target_hang is None:
        hang_weight = 0.0
    apex_evidence = uncalibrated_apex_evidence(package)
    use_apex = bool(apex_evidence and apex_evidence.get("observed"))
    apex_weight = float((apex_evidence or {}).get("score_weight") or 0.0)
    apex_sigma = float((apex_evidence or {}).get("time_uncertainty_s") or 0.25)
    target_apex_time = None if not use_apex else float(apex_evidence["relative_time_s"])
    target_apex_height = None
    if use_apex and (apex_evidence or {}).get("estimated_height_ft") is not None:
        target_apex_height = float(apex_evidence["estimated_height_ft"])
    apex_height_sigma = float((apex_evidence or {}).get("height_uncertainty_ft") or 20.0)

    candidates = []
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        hits = conn.execute("SELECT * FROM synthetic_hits").fetchall()
        trajectories = trajectory_rows_by_hit(conn)
        for hit in hits:
            traj_rows = trajectories.get(str(hit["hit_id"]), [])
            xyz = interpolate_xyz_for_times(traj_rows, times)
            if xyz is None:
                continue
            shape_mode = "uncalibrated_affine_path_shape"
            shape_variant = None
            if len(times) >= 4:
                design = np.column_stack([xyz, np.ones(len(xyz))])
                weights = 1.0 / obs_sigma
                coeffs, *_ = np.linalg.lstsq(design * weights[:, None], obs_uv * weights[:, None], rcond=None)
                predicted = design @ coeffs
                residual = obs_uv - predicted
                pixel_rmse = float(np.sqrt(np.mean(np.sum(residual**2, axis=1))))
                normalized_rmse = float(np.sqrt(np.mean(np.sum((residual / obs_sigma[:, None]) ** 2, axis=1))))
            else:
                minimal = minimal_shape_score(obs_uv, xyz)
                if minimal is None:
                    continue
                normalized_rmse, shape_variant = minimal
                pixel_rmse = float(normalized_rmse * np.linalg.norm(obs_uv[-1] - obs_uv[0]))
                shape_mode = "three_point_normalized_arc"
            distance_z = 0.0 if target_distance is None else (float(hit["distance_ft"]) - float(target_distance)) / distance_sigma
            hang_z = 0.0 if target_hang is None else (float(hit["hang_time_s"]) - float(target_hang)) / hang_sigma
            apex_time_z = 0.0 if target_apex_time is None else (float(hit["apex_time_s"]) - target_apex_time) / apex_sigma
            apex_height_z = 0.0 if target_apex_height is None else (float(hit["apex_ft"]) - target_apex_height) / apex_height_sigma
            candidates.append(
                {
                    "hit_id": hit["hit_id"],
                    "score": (
                        normalized_rmse
                        + abs(distance_z)
                        + abs(hang_z) * hang_weight
                        + abs(apex_time_z) * apex_weight
                        + abs(apex_height_z) * apex_weight * 0.6
                    ),
                    "pixel_rmse": pixel_rmse,
                    "normalized_rmse": normalized_rmse,
                    "shape_mode": shape_mode,
                    "shape_variant": shape_variant,
                    "distance_z": distance_z,
                    "hang_time_z": hang_z,
                    "apex_time_z": apex_time_z,
                    "apex_height_z": apex_height_z,
                    "hang_time_score_weight": hang_weight,
                    "apex_score_weight": apex_weight,
                    "apex_confidence": None if not use_apex else apex_evidence.get("confidence"),
                    "ground_contact_confidence": terminal_confidence if target_hang is not None else None,
                    "exit_velocity_mph": hit["exit_velocity_mph"],
                    "launch_angle_deg": hit["launch_angle_deg"],
                    "spray_angle_deg": hit["spray_angle_deg"],
                    "distance_ft": hit["distance_ft"],
                    "hang_time_s": hit["hang_time_s"],
                    "apex_ft": hit["apex_ft"],
                    "apex_time_s": hit["apex_time_s"],
                    "ev_underconstrained": not use_apex and target_distance is None and hang_weight == 0.0,
                    "projection_uncalibrated": True,
                }
            )
    candidates.sort(key=lambda row: row["score"])
    top = candidates[:50]
    return {
        "used": True,
        "reason": (
            "three ball points; using normalized arc-shape diagnostic only"
            if len(times) == 3
            else "no field landmarks; path shape can be compared but physical camera scale is uncalibrated"
        ),
        "used_count": int(len(times)),
        "time_span_s": float(times[-1] - times[0]),
        "distance_evidence": {
            "source": distance_source,
            "distance_ft": None if target_distance is None else float(target_distance),
            "uncertainty_ft": float(distance_sigma),
        },
        "apex_evidence": apex_evidence,
        "candidates": candidates,
        "diagnostic_range": None if not top else {
            "ev_mph": [min(float(row["exit_velocity_mph"]) for row in top), max(float(row["exit_velocity_mph"]) for row in top)],
            "launch_angle_deg": [min(float(row["launch_angle_deg"]) for row in top), max(float(row["launch_angle_deg"]) for row in top)],
            "distance_ft": [min(float(row["distance_ft"]) for row in top), max(float(row["distance_ft"]) for row in top)],
            "hang_time_s": [min(float(row["hang_time_s"]) for row in top), max(float(row["hang_time_s"]) for row in top)],
        },
    }


def interpolate_xyz_for_times(traj_rows: list[sqlite3.Row], times: np.ndarray) -> np.ndarray | None:
    if len(traj_rows) < 2:
        return None
    traj_t = np.array([float(row["relative_time_s"]) for row in traj_rows], dtype=float)
    if float(times[-1]) > float(traj_t[-1]):
        return None
    xyz = np.array([[float(row["x_ft"]), float(row["y_ft"]), float(row["z_ft"])] for row in traj_rows], dtype=float)
    return np.column_stack(
        [
            np.interp(times, traj_t, xyz[:, 0]),
            np.interp(times, traj_t, xyz[:, 1]),
            np.interp(times, traj_t, xyz[:, 2]),
        ]
    )


def rotate_xyz_to_ground_direction(xyz: np.ndarray, target_direction_xy: np.ndarray | None) -> tuple[np.ndarray, dict]:
    if target_direction_xy is None:
        return xyz, {"rotated": False, "reason": "no_target_direction"}
    target = np.asarray(target_direction_xy, dtype=float)
    target_norm = float(np.linalg.norm(target))
    if not np.isfinite(target_norm) or target_norm <= 1e-6:
        return xyz, {"rotated": False, "reason": "invalid_target_direction"}

    origin_xy = xyz[0, :2]
    rel_xy = xyz[:, :2] - origin_xy
    distances = np.linalg.norm(rel_xy, axis=1)
    source = rel_xy[int(np.argmax(distances))]
    source_norm = float(np.linalg.norm(source))
    if not np.isfinite(source_norm) or source_norm <= 1e-6:
        return xyz, {"rotated": False, "reason": "invalid_source_direction"}

    source_unit = source / source_norm
    target_unit = target / target_norm
    cos_theta = float(np.clip(np.dot(source_unit, target_unit), -1.0, 1.0))
    sin_theta = float(source_unit[0] * target_unit[1] - source_unit[1] * target_unit[0])
    rotation = np.array(
        [
            [cos_theta, -sin_theta],
            [sin_theta, cos_theta],
        ],
        dtype=float,
    )

    rotated = xyz.copy()
    rotated[:, :2] = origin_xy + (rel_xy @ rotation.T)
    source_spray = float(np.degrees(np.arctan2(source_unit[0], source_unit[1])))
    target_spray = float(np.degrees(np.arctan2(target_unit[0], target_unit[1])))
    delta_spray = float(np.degrees(np.arctan2(sin_theta, cos_theta)))
    return rotated, {
        "rotated": True,
        "source_spray_angle_deg": source_spray,
        "target_spray_angle_deg": target_spray,
        "delta_spray_angle_deg": delta_spray,
    }


def spray_angle_from_direction(target_direction_xy: np.ndarray | None) -> float | None:
    if target_direction_xy is None:
        return None
    target = np.asarray(target_direction_xy, dtype=float)
    target_norm = float(np.linalg.norm(target))
    if not np.isfinite(target_norm) or target_norm <= 1e-6:
        return None
    unit = target / target_norm
    return float(np.degrees(np.arctan2(unit[0], unit[1])))


def projected_path_candidate_hit_ids(
    conn: sqlite3.Connection,
    launch_angle_deg: float | None,
    target_spray_angle_deg: float | None = None,
    target_distance_ft: float | None = None,
    launch_angle_window_deg: float = 6.0,
    spray_angle_window_deg: float = 15.0,
    distance_window_ft: float = 150.0,
) -> set[str] | None:
    if launch_angle_deg is None or not math.isfinite(float(launch_angle_deg)):
        return None
    params: list[float] = [float(launch_angle_deg), float(launch_angle_window_deg)]
    spray_clause = ""
    if target_spray_angle_deg is not None and math.isfinite(float(target_spray_angle_deg)):
        spray_clause = "AND ABS(spray_angle_deg - ?) <= ?"
        params.extend([float(target_spray_angle_deg), float(spray_angle_window_deg)])
    distance_clause = ""
    if target_distance_ft is not None and math.isfinite(float(target_distance_ft)):
        distance_clause = "AND ABS(distance_ft - ?) <= ?"
        params.extend([float(target_distance_ft), float(distance_window_ft)])
    rows = conn.execute(
        f"""
        SELECT hit_id
        FROM synthetic_hits
        WHERE ABS(launch_angle_deg - ?) <= ?
        {spray_clause}
        {distance_clause}
        """,
        params,
    ).fetchall()
    return {str(row["hit_id"]) for row in rows}


def trajectory_rows_by_hit(conn: sqlite3.Connection, hit_ids: set[str] | None = None) -> dict[str, list[sqlite3.Row]]:
    rows_by_hit: dict[str, list[sqlite3.Row]] = {}
    if hit_ids is None:
        row_iter = conn.execute(
            """
            SELECT hit_id, relative_time_s, x_ft, y_ft, z_ft
            FROM trajectory_points
            ORDER BY hit_id, relative_time_s
            """
        )
        for row in row_iter:
            rows_by_hit.setdefault(str(row["hit_id"]), []).append(row)
        return rows_by_hit

    ordered_ids = sorted(hit_ids)
    for offset in range(0, len(ordered_ids), 900):
        chunk = ordered_ids[offset : offset + 900]
        placeholders = ",".join("?" for _ in chunk)
        row_iter = conn.execute(
            f"""
            SELECT hit_id, relative_time_s, x_ft, y_ft, z_ft
            FROM trajectory_points
            WHERE hit_id IN ({placeholders})
            ORDER BY hit_id, relative_time_s
            """,
            chunk,
        )
        for row in row_iter:
            rows_by_hit.setdefault(str(row["hit_id"]), []).append(row)
    return rows_by_hit


def early_path_weights(times: np.ndarray) -> np.ndarray:
    elapsed = np.maximum(0.0, times - times[0])
    weights = np.exp(-elapsed / PROJECTED_PATH_DECAY_S)
    return np.maximum(weights, PROJECTED_PATH_MIN_WEIGHT)


def measurement_path_weights(times: np.ndarray, uncertainty_px: np.ndarray) -> np.ndarray:
    timing_weights = early_path_weights(times)
    sigma = np.maximum(6.0, uncertainty_px)
    precision_weights = (24.0 / sigma) ** 2
    return timing_weights * np.clip(precision_weights, 0.12, 4.0)


def weighted_path_rmse_px(residual: np.ndarray, weights: np.ndarray) -> float:
    squared = np.sum(residual**2, axis=1)
    return float(np.sqrt(np.average(squared, weights=weights)))


def early_velocity_path_metrics(
    times: np.ndarray,
    obs_uv: np.ndarray,
    pred_uv: np.ndarray,
    residual: np.ndarray,
    weights: np.ndarray,
) -> dict:
    count = min(len(times), PROJECTED_PATH_EARLY_CHECK_POINTS)
    if count < 2:
        return {
            "used": False,
            "reason": "need_two_points_in_early_velocity_window",
            "max_points": PROJECTED_PATH_EARLY_CHECK_POINTS,
            "used_count": count,
        }
    window_residual = residual[:count]
    window_weights = weights[:count]
    window_obs = obs_uv[:count]
    window_pred = pred_uv[:count]
    observed_distance_px = cumulative_path_px(window_obs)
    projected_distance_px = cumulative_path_px(window_pred)
    return {
        "used": True,
        "max_points": PROJECTED_PATH_EARLY_CHECK_POINTS,
        "used_count": count,
        "start_s": float(times[0]),
        "end_s": float(times[count - 1]),
        "rmse_px": weighted_path_rmse_px(window_residual, window_weights),
        "end_error_px": float(np.hypot(*(window_residual[-1]))),
        "observed_distance_px": observed_distance_px,
        "projected_distance_px": projected_distance_px,
        "distance_ratio": None if observed_distance_px <= 1e-6 else projected_distance_px / observed_distance_px,
    }


def combined_path_rmse_px(base_rmse: float, early_velocity: dict) -> float:
    if not early_velocity.get("used"):
        return base_rmse
    early_rmse = float(early_velocity["rmse_px"])
    weight = PROJECTED_PATH_EARLY_CHECK_WEIGHT
    return float(math.sqrt((base_rmse**2 + weight * early_rmse**2) / (1.0 + weight)))


def scaled_shape_residual(obs_relative: np.ndarray, pred_relative: np.ndarray) -> tuple[np.ndarray, float]:
    """Compare path shape without trusting per-frame image-space speed.

    Automatic ball detection can find a useful streak/path while assigning the
    wrong point-in-time position along that path. In that case, absolute pixel
    travel is not comparable to a projected synthetic trajectory. Fit one
    scalar pixel scale before scoring so the evidence is direction/curvature
    shape, not "the model moved fewer pixels by frame N."
    """
    denom = float(np.sum(pred_relative * pred_relative))
    if denom <= 1e-6:
        return obs_relative - pred_relative, 1.0
    scale = max(0.0, float(np.sum(obs_relative * pred_relative)) / denom)
    return obs_relative - pred_relative * scale, scale


def cumulative_path_px(points: np.ndarray) -> float:
    if len(points) < 2:
        return 0.0
    steps = np.diff(points, axis=0)
    return float(np.sum(np.linalg.norm(steps, axis=1)))


def score_projected_synthetic_paths(
    observations: list[dict],
    db_path: Path,
    h: np.ndarray,
    width_px: int,
    height_px: int,
    fovs_deg: list[float],
    target_direction_xy: np.ndarray | None = None,
    launch_angle_deg: float | None = None,
    target_distance_ft: float | None = None,
    frame_step_s: float | None = None,
) -> dict:
    observed = observed_path_measurements(observations, max_time_s=PROJECTED_PATH_MAX_TIME_S, min_points=4)
    if observed is None:
        return {
            "used": False,
            "reason": "need at least four frame-specific ball points in the stable post-contact camera window",
            "scores_by_hit_id": {},
        }
    times, obs_uv, uncertainty_px = observed
    source_summary = path_source_summary(observed_path_rows(observations, max_time_s=PROJECTED_PATH_MAX_TIME_S))
    obs_relative = obs_uv - obs_uv[0]
    observed_distance_px = cumulative_path_px(obs_uv)
    path_weights = measurement_path_weights(times, uncertainty_px)
    scores: dict[str, dict] = {}
    camera_hypotheses = []
    for fov in fovs_deg:
        intrinsics = intrinsics_from_fov(width_px, height_px, fov)
        rotation, translation = pose_from_homography(h, intrinsics)
        camera_hypotheses.append((float(fov), intrinsics, rotation, translation))

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        target_spray_angle_deg = spray_angle_from_direction(target_direction_xy)
        candidate_hit_ids = projected_path_candidate_hit_ids(
            conn,
            launch_angle_deg,
            target_spray_angle_deg,
            target_distance_ft,
        )
        trajectories = trajectory_rows_by_hit(conn, candidate_hit_ids)
        for hit_id, traj_rows in trajectories.items():
            xyz = interpolate_xyz_for_times(traj_rows, times)
            if xyz is None:
                continue
            xyz, alignment = rotate_xyz_to_ground_direction(xyz, target_direction_xy)
            best_score = None
            for fov, intrinsics, rotation, translation in camera_hypotheses:
                pred_uv, visible = project_with_camera_pose(xyz, intrinsics, rotation, translation)
                if not np.all(visible):
                    continue
                pred_relative = pred_uv - pred_uv[0]
                residual = obs_relative - pred_relative
                shape_scale = 1.0
                path_distance_ratio = None if observed_distance_px <= 1e-6 else cumulative_path_px(pred_uv) / observed_distance_px
                base_rmse = weighted_path_rmse_px(residual, path_weights)
                early_velocity = early_velocity_path_metrics(times, obs_uv, pred_uv, residual, path_weights)
                rmse = combined_path_rmse_px(base_rmse, early_velocity)
                end_error = float(np.hypot(*(residual[-1])))
                projected_distance_px = cumulative_path_px(pred_uv)
                row_score = {
                    "projected_path_rmse_px": rmse,
                    "base_projected_path_rmse_px": base_rmse,
                    "projected_path_end_error_px": end_error,
                    "observed_path_distance_px": observed_distance_px,
                    "projected_path_distance_px": projected_distance_px,
                    "path_distance_ratio": path_distance_ratio,
                    "early_velocity_path_rmse_px": early_velocity.get("rmse_px") if early_velocity.get("used") else None,
                    "early_velocity_path_end_error_px": early_velocity.get("end_error_px") if early_velocity.get("used") else None,
                    "early_velocity_observed_distance_px": early_velocity.get("observed_distance_px") if early_velocity.get("used") else None,
                    "early_velocity_projected_distance_px": early_velocity.get("projected_distance_px") if early_velocity.get("used") else None,
                    "early_velocity_path_distance_ratio": early_velocity.get("distance_ratio") if early_velocity.get("used") else None,
                    "early_velocity_path_used_count": int(early_velocity.get("used_count") or 0),
                    "path_shape_scale": shape_scale,
                    "projected_path_fov_deg": fov,
                    "trajectory_alignment": alignment,
                }
                if best_score is None or rmse < best_score["projected_path_rmse_px"]:
                    best_score = row_score
            if best_score is not None:
                scores[hit_id] = best_score

    rmses = [row["projected_path_rmse_px"] for row in scores.values()]
    return {
        "used": bool(scores),
        "source": (
            "low_confidence_auto_points_projected_through_camera_pose"
            if not source_summary["timing_reliable"]
            else "frame_specific_ball_points_projected_through_camera_pose"
        ),
        "calibrated_pose": True,
        "used_count": int(len(times)),
        **source_summary,
        "time_span_s": float(times[-1] - times[0]),
        "max_time_s": PROJECTED_PATH_MAX_TIME_S,
        "weighting": "per_point_uncertainty_and_exponential_decay_from_first_scored_point",
        "decay_s": PROJECTED_PATH_DECAY_S,
        "min_weight": PROJECTED_PATH_MIN_WEIGHT,
        "observed_path_distance_px": observed_distance_px,
        "early_velocity_check": {
            "max_points": PROJECTED_PATH_EARLY_CHECK_POINTS,
            "weight": PROJECTED_PATH_EARLY_CHECK_WEIGHT,
        },
        "synthetic_trajectory_alignment": "rotated_to_field_direction" if target_direction_xy is not None else "raw_table_coordinates",
        "candidate_filter": {
            "launch_angle_deg": launch_angle_deg,
            "launch_angle_window_deg": 6.0,
            "target_spray_angle_deg": target_spray_angle_deg,
            "spray_angle_window_deg": 15.0,
            "target_distance_ft": target_distance_ft,
            "distance_window_ft": 150.0,
            "candidate_count": None if candidate_hit_ids is None else len(candidate_hit_ids),
        },
        "horizontal_fovs_deg": [float(fov) for fov in fovs_deg],
        "weight": 0.75,
        "sigma_px": 35.0,
        "best_rmse_px": None if not rmses else float(min(rmses)),
        "scores_by_hit_id": scores,
    }


def score_projected_synthetic_paths_with_pose(
    observations: list[dict],
    db_path: Path,
    pose: dict,
    target_direction_xy: np.ndarray | None = None,
    launch_angle_deg: float | None = None,
    target_distance_ft: float | None = None,
    frame_step_s: float | None = None,
) -> dict:
    observed = observed_path_measurements(observations, max_time_s=PROJECTED_PATH_MAX_TIME_S, min_points=4)
    if observed is None:
        return {
            "used": False,
            "reason": "need at least four frame-specific ball points in the stable post-contact camera window",
            "scores_by_hit_id": {},
        }
    times, obs_uv, uncertainty_px = observed
    source_summary = path_source_summary(observed_path_rows(observations, max_time_s=PROJECTED_PATH_MAX_TIME_S))
    obs_relative = obs_uv - obs_uv[0]
    observed_distance_px = cumulative_path_px(obs_uv)
    path_weights = measurement_path_weights(times, uncertainty_px)
    scores: dict[str, dict] = {}

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        target_spray_angle_deg = spray_angle_from_direction(target_direction_xy)
        candidate_hit_ids = projected_path_candidate_hit_ids(
            conn,
            launch_angle_deg,
            target_spray_angle_deg,
            target_distance_ft,
        )
        trajectories = trajectory_rows_by_hit(conn, candidate_hit_ids)
        for hit_id, traj_rows in trajectories.items():
            xyz = interpolate_xyz_for_times(traj_rows, times)
            if xyz is None:
                continue
            xyz, alignment = rotate_xyz_to_ground_direction(xyz, target_direction_xy)
            pred_uv, visible = project_with_camera_pose(
                xyz,
                pose["intrinsics"],
                pose["rotation"],
                pose["translation"],
            )
            if not np.all(visible):
                continue
            pred_relative = pred_uv - pred_uv[0]
            residual = obs_relative - pred_relative
            shape_scale = 1.0
            path_distance_ratio = None if observed_distance_px <= 1e-6 else cumulative_path_px(pred_uv) / observed_distance_px
            base_rmse = weighted_path_rmse_px(residual, path_weights)
            early_velocity = early_velocity_path_metrics(times, obs_uv, pred_uv, residual, path_weights)
            rmse = combined_path_rmse_px(base_rmse, early_velocity)
            end_error = float(np.hypot(*(residual[-1])))
            projected_distance_px = cumulative_path_px(pred_uv)
            scores[hit_id] = {
                "projected_path_rmse_px": rmse,
                "base_projected_path_rmse_px": base_rmse,
                "projected_path_end_error_px": end_error,
                "observed_path_distance_px": observed_distance_px,
                "projected_path_distance_px": projected_distance_px,
                "path_distance_ratio": path_distance_ratio,
                "early_velocity_path_rmse_px": early_velocity.get("rmse_px") if early_velocity.get("used") else None,
                "early_velocity_path_end_error_px": early_velocity.get("end_error_px") if early_velocity.get("used") else None,
                "early_velocity_observed_distance_px": early_velocity.get("observed_distance_px") if early_velocity.get("used") else None,
                "early_velocity_projected_distance_px": early_velocity.get("projected_distance_px") if early_velocity.get("used") else None,
                "early_velocity_path_distance_ratio": early_velocity.get("distance_ratio") if early_velocity.get("used") else None,
                "early_velocity_path_used_count": int(early_velocity.get("used_count") or 0),
                "path_shape_scale": shape_scale,
                "projected_path_fov_deg": float(pose["horizontal_fov_deg"]),
                "trajectory_alignment": alignment,
            }

    rmses = [row["projected_path_rmse_px"] for row in scores.values()]
    return {
        "used": bool(scores),
        "source": (
            "low_confidence_auto_points_projected_through_constrained_user_camera_pose"
            if not source_summary["timing_reliable"]
            else "frame_specific_ball_points_projected_through_constrained_user_camera_pose"
        ),
        "calibrated_pose": True,
        "used_count": int(len(times)),
        **source_summary,
        "time_span_s": float(times[-1] - times[0]),
        "max_time_s": PROJECTED_PATH_MAX_TIME_S,
        "weighting": "per_point_uncertainty_and_exponential_decay_from_first_scored_point",
        "decay_s": PROJECTED_PATH_DECAY_S,
        "min_weight": PROJECTED_PATH_MIN_WEIGHT,
        "observed_path_distance_px": observed_distance_px,
        "early_velocity_check": {
            "max_points": PROJECTED_PATH_EARLY_CHECK_POINTS,
            "weight": PROJECTED_PATH_EARLY_CHECK_WEIGHT,
        },
        "synthetic_trajectory_alignment": "rotated_to_field_direction" if target_direction_xy is not None else "raw_table_coordinates",
        "candidate_filter": {
            "launch_angle_deg": launch_angle_deg,
            "launch_angle_window_deg": 6.0,
            "target_spray_angle_deg": target_spray_angle_deg,
            "spray_angle_window_deg": 15.0,
            "target_distance_ft": target_distance_ft,
            "distance_window_ft": 150.0,
            "candidate_count": None if candidate_hit_ids is None else len(candidate_hit_ids),
        },
        "horizontal_fovs_deg": [float(pose["horizontal_fov_deg"])],
        "pose_landmark_rmse_px": float(pose["rmse_px"]),
        "weight": 1.15,
        "calibration_diagnostics": pose.get("calibration_diagnostics", {}),
        "sigma_px": 30.0,
        "best_rmse_px": None if not rmses else float(min(rmses)),
        "scores_by_hit_id": scores,
    }


def useful_velocity_path(evidence: dict | None) -> bool:
    evidence = evidence or {}
    count = int(evidence.get("usable_point_count") or evidence.get("used_count") or 0)
    pose_error = evidence.get("pose_landmark_rmse_px")
    return bool(evidence.get("used") and count >= 4
                and evidence.get("independent_velocity_validated", True)
                and (evidence.get("calibration_diagnostics") or {}).get("usable_for_velocity", True)
                and evidence.get("timing_reliable", False)
                and float(evidence.get("path_evidence_strength") or 0) >= 0.65
                and (pose_error is None or float(pose_error) <= 25.0))


def infer_ev_from_flight_table(
    package: dict,
    db_path: Path,
    launch_angle_deg: float,
    spray_angle_deg: float,
    field_direction: dict | None = None,
    apex_evidence: dict | None = None,
    path_evidence: dict | None = None,
    launch_angle_evidence: dict | None = None,
    view_geometry: dict | None = None,
    apex_physics: dict | None = None,
    apex_launch_estimate: dict | None = None,
    path_only_model: bool = False,
) -> list[dict]:
    target_distance, distance_sigma = target_distance_from_package(package, field_direction)
    terminal = package.get("terminal_event") or {}
    target_hang = terminal.get("relative_time_s") if terminal.get("type") == "FIRST_GROUND_CONTACT" else None
    hang_sigma = float(terminal.get("timing_uncertainty_s") or 0.5)
    terminal_confidence = str(terminal.get("confidence") or "LOW").upper()
    if path_only_model:
        target_distance = None
        target_hang = None
        terminal_confidence = "LOW"
        apex_evidence = None
        apex_physics = None
        apex_launch_estimate = None
    hang_weight = {
        "HIGH": 0.9,
        "MEDIUM": 0.55,
        "LOW": 0.08,
        "VERY_LOW": 0.03,
    }.get(terminal_confidence, 0.05)
    if target_hang is None:
        hang_weight = 0.0
    if target_distance is None and terminal_confidence != "HIGH":
        hang_weight = 0.0
    distance_weight = 2.4 if target_distance is not None else 0.0
    use_apex = bool(apex_evidence and apex_evidence.get("observed"))
    apex_weight = float((apex_evidence or {}).get("score_weight") or 0.0)
    view_classification = (view_geometry or {}).get("classification")
    if use_apex and view_classification in {"depth_heavy", "oblique"}:
        apex_weight *= 2.1 if view_classification == "depth_heavy" else 1.45
    apex_time_sigma = float((apex_evidence or {}).get("time_uncertainty_s") or 0.15)
    apex_height_sigma = float((apex_evidence or {}).get("height_uncertainty_ft") or 20.0)
    target_apex_time = None if not use_apex else float(apex_evidence["relative_time_s"])
    target_apex_height = None
    if use_apex and (apex_evidence or {}).get("estimated_height_ft") is not None:
        target_apex_height = float(apex_evidence["estimated_height_ft"])
    target_apex_vz = None if not apex_physics else float(apex_physics["vertical_velocity_ft_s"])
    apex_confidence = str((apex_evidence or {}).get("confidence") or "LOW").upper()
    base_apex_vz_sigma = {"HIGH": 8.0, "MEDIUM": 12.0, "LOW": 18.0}.get(apex_confidence, 18.0)
    apex_vz_sigma = base_apex_vz_sigma
    if apex_physics:
        apex_vz_sigma = max(base_apex_vz_sigma, float(apex_physics.get("time_height_conflict_ft_s") or 0.0) * 0.75)
    apex_vz_weight = 0.0 if target_apex_vz is None else apex_weight * (0.55 if view_classification == "depth_heavy" else 0.35)
    target_apex_ev = None if not apex_launch_estimate else float(apex_launch_estimate["exit_velocity_mph"])
    target_apex_la = None if not apex_launch_estimate else float(apex_launch_estimate["launch_angle_deg"])
    if (
        apex_launch_estimate
        and apex_launch_estimate.get("source") == "apex_time_and_launch_angle_ballistic_estimate"
        and view_classification in {"depth_heavy", "oblique"}
        and (launch_angle_evidence or {}).get("confidence") == "LOW"
    ):
        target_apex_ev = None
        target_apex_la = None
    apex_ev_sigma = 5.0 if apex_confidence == "HIGH" else 7.5 if apex_confidence == "MEDIUM" else 10.0
    apex_launch_angle_sigma = 3.5 if apex_confidence == "HIGH" else 5.0 if apex_confidence == "MEDIUM" else 7.0
    apex_launch_weight = 0.0 if target_apex_ev is None else (3.0 if view_classification == "depth_heavy" else 1.8)
    path_scores = (path_evidence or {}).get("scores_by_hit_id") or {}
    path_weight = float((path_evidence or {}).get("weight") or 0.0) if (path_evidence or {}).get("used") else 0.0
    path_weight_policy = "used"
    path_is_calibrated = bool((path_evidence or {}).get("calibrated_pose"))
    path_timing_reliable = bool((path_evidence or {}).get("timing_reliable", True))
    path_evidence_strength = float((path_evidence or {}).get("path_evidence_strength") or (1.0 if path_timing_reliable else 0.35))
    if path_weight > 0 and not path_timing_reliable:
        path_weight *= max(0.12, min(1.0, path_evidence_strength))
        path_weight_policy = "low_confidence_frame_points_scaled_by_available_evidence"
    elif path_weight > 0:
        path_weight *= max(0.55, min(1.0, path_evidence_strength))
        path_weight_policy = "frame_points_scaled_by_available_evidence"
    if view_classification == "depth_heavy" and not path_is_calibrated:
        path_weight = 0.0
        path_weight_policy = "ignored_depth_heavy_view"
    elif view_classification == "depth_heavy":
        path_weight *= 0.65
        path_weight_policy = (
            "calibrated_depth_heavy_low_confidence_frame_points_scaled_by_available_evidence"
            if not path_timing_reliable
            else "calibrated_depth_heavy_frame_points_scaled_by_available_evidence"
        )
    elif view_classification == "oblique" and not use_apex:
        path_weight *= 0.55 if path_is_calibrated else 0.25
        path_weight_policy = "calibrated_oblique_without_apex_downweighted" if path_is_calibrated else "downweighted_oblique_without_apex"
    path_sigma_px = float((path_evidence or {}).get("sigma_px") or 35.0)
    if target_distance is not None and not path_only_model and not useful_velocity_path(path_evidence):
        # Unreliable frame displacement cannot override the supplied landing distance.
        path_weight = 0.0
        path_weight_policy = "user_distance_and_angle_unvalidated_by_early_path"
    path_missing_z = 0.0
    if path_weight > 0 and path_scores:
        best_path_rmse = float((path_evidence or {}).get("best_rmse_px") or path_sigma_px)
        path_missing_z = (best_path_rmse / path_sigma_px) + 1.5
    ev_underconstrained = target_distance is None and hang_weight == 0.0 and path_weight == 0.0 and apex_weight == 0.0
    launch_angle_sigma = 4.0 if path_weight > 0 else 1.5
    launch_angle_weight = 2.4 if path_weight > 0 else 1.35
    launch_angle_confidence = str((launch_angle_evidence or {}).get("confidence") or "").upper()
    if launch_angle_confidence in {"HIGH", "MEDIUM"}:
        evidence_sigma = float((launch_angle_evidence or {}).get("sigma_deg") or (2.5 if launch_angle_confidence == "HIGH" else 4.0))
        launch_angle_sigma = min(launch_angle_sigma, evidence_sigma)
        launch_angle_weight = max(launch_angle_weight, 3.2 if launch_angle_confidence == "HIGH" else 2.7)
        if target_hang is None:
            # Without a true ground-contact/hang-time anchor, do not let path shape
            # or inferred apex timing pull LA far away from the camera-corrected
            # launch angle. They can still rank EV/distance within that LA band.
            launch_angle_sigma = min(launch_angle_sigma, 3.5 if launch_angle_confidence == "MEDIUM" else 2.5)
            launch_angle_weight = max(launch_angle_weight, 3.1 if launch_angle_confidence == "MEDIUM" else 3.7)
    elif use_apex and view_classification == "depth_heavy":
        launch_angle_sigma = max(launch_angle_sigma, 10.0)
        launch_angle_weight = min(launch_angle_weight, 0.35 if target_apex_la is not None else 0.18)
    elif use_apex and view_classification == "oblique":
        launch_angle_sigma = max(launch_angle_sigma, 8.0)
        launch_angle_weight = min(launch_angle_weight, 0.45)
    if launch_angle_evidence and launch_angle_evidence.get("confidence") == "LOW":
        launch_angle_sigma = max(launch_angle_sigma, float(launch_angle_evidence.get("sigma_deg") or 10.0))
        launch_angle_weight = min(launch_angle_weight, 0.25)
        low = min(float(launch_angle_evidence["launch_angle_deg"]), float(launch_angle_evidence["legacy_launch_angle_deg"])) - 3.0
        high = max(float(launch_angle_evidence["launch_angle_deg"]), float(launch_angle_evidence["legacy_launch_angle_deg"])) + 3.0
        launch_angle_evidence["scoring_interval_deg"] = [low, high]

    rows = []
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        for row in conn.execute("SELECT * FROM synthetic_hits"):
            row_ev = float(row["exit_velocity_mph"])
            row_la = float(row["launch_angle_deg"])
            interval = (launch_angle_evidence or {}).get("scoring_interval_deg")
            if interval:
                if row_la < float(interval[0]):
                    la_z = (row_la - float(interval[0])) / launch_angle_sigma
                elif row_la > float(interval[1]):
                    la_z = (row_la - float(interval[1])) / launch_angle_sigma
                else:
                    la_z = 0.0
            else:
                la_z = (row_la - launch_angle_deg) / launch_angle_sigma
            spray_z = (float(row["spray_angle_deg"]) - spray_angle_deg) / 5.0
            dist_z = 0.0 if target_distance is None else (float(row["distance_ft"]) - float(target_distance)) / distance_sigma
            hang_z = 0.0 if target_hang is None else (float(row["hang_time_s"]) - float(target_hang)) / hang_sigma
            apex_time_z = 0.0 if target_apex_time is None else (float(row["apex_time_s"]) - target_apex_time) / apex_time_sigma
            apex_height_z = 0.0 if target_apex_height is None else (float(row["apex_ft"]) - target_apex_height) / apex_height_sigma
            row_vz = row_ev * 1.467 * math.sin(math.radians(row_la))
            apex_vz_z = 0.0 if target_apex_vz is None else (row_vz - target_apex_vz) / apex_vz_sigma
            apex_ev_z = 0.0 if target_apex_ev is None else (float(row["exit_velocity_mph"]) - target_apex_ev) / apex_ev_sigma
            apex_launch_angle_z = 0.0 if target_apex_la is None else (row_la - target_apex_la) / apex_launch_angle_sigma
            path_score = path_scores.get(row["hit_id"])
            path_z = path_missing_z if path_score is None else float(path_score["projected_path_rmse_px"]) / path_sigma_px
            score = (
                abs(la_z) * launch_angle_weight
                + abs(spray_z) * 0.5
                + abs(dist_z) * distance_weight
                + abs(hang_z) * hang_weight
                + abs(apex_time_z) * apex_weight
                + abs(apex_height_z) * apex_weight * 0.6
                + abs(apex_vz_z) * apex_vz_weight
                + abs(apex_ev_z) * apex_launch_weight
                + abs(apex_launch_angle_z) * apex_launch_weight
                + path_z * path_weight
            )
            path_first_score = None
            if path_only_model and path_score is not None:
                early_ratio = (
                    path_score.get("early_velocity_path_distance_ratio")
                    or path_score.get("path_distance_ratio")
                    or 1.0
                )
                ratio_penalty = abs(math.log(max(float(early_ratio), 0.05))) * 80.0
                path_first_score = (
                    float(path_score["projected_path_rmse_px"])
                    + ratio_penalty
                    + float(path_score.get("projected_path_end_error_px") or 0.0) * 0.10
                )
                score = path_first_score
            if path_only_model and path_score is None:
                continue
            rows.append({
                "hit_id": row["hit_id"],
                "score": score,
                "path_first_score": path_first_score,
                "score_policy": "path_first_distance_free" if path_only_model else "combined_evidence",
                "la_z": la_z,
                "spray_z": spray_z,
                "distance_z": dist_z,
                "hang_time_z": hang_z,
                "apex_time_z": apex_time_z,
                "apex_height_z": apex_height_z,
                "apex_vertical_velocity_z": apex_vz_z,
                "apex_vertical_velocity_ft_s": row_vz,
                "apex_ballistic_ev_z": apex_ev_z,
                "apex_ballistic_launch_angle_z": apex_launch_angle_z,
                "projected_path_z": path_z,
                "projected_path_rmse_px": None if path_score is None else path_score["projected_path_rmse_px"],
                "base_projected_path_rmse_px": None if path_score is None else path_score.get("base_projected_path_rmse_px"),
                "projected_path_end_error_px": None if path_score is None else path_score["projected_path_end_error_px"],
                "observed_path_distance_px": None if path_score is None else path_score.get("observed_path_distance_px"),
                "projected_path_distance_px": None if path_score is None else path_score.get("projected_path_distance_px"),
                "path_distance_ratio": None if path_score is None else path_score.get("path_distance_ratio"),
                "early_velocity_path_rmse_px": None if path_score is None else path_score.get("early_velocity_path_rmse_px"),
                "early_velocity_path_end_error_px": None if path_score is None else path_score.get("early_velocity_path_end_error_px"),
                "early_velocity_observed_distance_px": None if path_score is None else path_score.get("early_velocity_observed_distance_px"),
                "early_velocity_projected_distance_px": None if path_score is None else path_score.get("early_velocity_projected_distance_px"),
                "early_velocity_path_distance_ratio": None if path_score is None else path_score.get("early_velocity_path_distance_ratio"),
                "early_velocity_path_used_count": 0 if path_score is None else int(path_score.get("early_velocity_path_used_count") or 0),
                "distance_score_weight": distance_weight,
                "hang_time_score_weight": hang_weight,
                "launch_angle_score_weight": launch_angle_weight,
                "launch_angle_sigma_deg": launch_angle_sigma,
                "apex_score_weight": apex_weight,
                "apex_vertical_velocity_score_weight": apex_vz_weight,
                "apex_vertical_velocity_sigma_ft_s": apex_vz_sigma,
                "apex_ballistic_launch_score_weight": apex_launch_weight,
                "apex_ballistic_ev_target_mph": target_apex_ev,
                "apex_ballistic_launch_angle_target_deg": target_apex_la,
                "projected_path_score_weight": path_weight,
                "projected_path_weight_policy": path_weight_policy,
                "ground_contact_confidence": terminal_confidence if target_hang is not None else None,
                "apex_confidence": None if not use_apex else apex_evidence.get("confidence"),
                "view_classification": view_classification,
                "ev_underconstrained": ev_underconstrained,
                "exit_velocity_mph": row["exit_velocity_mph"],
                "launch_angle_deg": row["launch_angle_deg"],
                "spray_angle_deg": row["spray_angle_deg"],
                "distance_ft": row["distance_ft"],
                "hang_time_s": row["hang_time_s"],
                "apex_ft": row["apex_ft"],
                "apex_time_s": row["apex_time_s"],
            })
    return sorted(rows, key=lambda row: row["score"])


def evidence_warnings_for_prediction(prediction: dict, best: dict | None = None) -> list[dict]:
    if best is None:
        rows = prediction.get("ev_candidates") or []
        best = rows[0] if rows else None
    if not best:
        return []

    warnings: list[dict] = []
    contact_timing = (prediction.get('video_metadata') or {}).get('contact_timing') or {}
    if contact_timing.get('timing_mode') == 'BETWEEN_FRAMES':
        warnings.append(dict(severity='warning',title='Contact occurred between frames',
            message='Ball marks retain their actual frame times. The contact image anchor is extrapolated from the timed manual marks, not directly observed; verify the timing and camera before relying on the estimate.',
            evidence=contact_timing))
    shared = prediction.get("direction_first_match") or {}
    if shared.get("used") and int(shared.get("used_count") or 0) < 2:
        warnings.append({
            "severity": "strong",
            "title": "Only one timed flight point supports this estimate",
            "message": "Speed and launch angle depend strongly on camera calibration and the early ball marks. Mark another visible ball position at a different time and verify the contact frame before relying on these numbers.",
            "evidence": {"used_count": shared.get("used_count"),
                         "contact_origin_ft": shared.get("contact_origin_ft")},
        })
    signed_distance_z = float(best.get("distance_z") or 0.0)
    distance_z = abs(signed_distance_z)
    hang_z = abs(float(best.get("hang_time_z") or 0.0))
    la_z = abs(float(best.get("la_z") or 0.0))
    path_rmse = best.get("projected_path_rmse_px")
    path_evidence = prediction.get("projected_path_evidence") or {}
    path_best = path_evidence.get("best_rmse_px")
    pose_rmse = path_evidence.get("pose_landmark_rmse_px")
    path_timing_reliable = bool(path_evidence.get("timing_reliable", True))
    path_only_best = ((prediction.get("path_only_model_fit") or {}).get("best") or {})
    direction = prediction.get("field_direction") or {}
    target_distance = direction.get("estimated_distance_ft")

    if distance_z >= 1.5 and best.get("distance_score_weight", 0.0) > 0:
        warnings.append({
            "severity": "warning" if distance_z < 3.0 else "strong",
            "title": "Distance estimate conflicts with the best flight match",
            "message": (
                f"The selected synthetic flight lands at about {float(best['distance_ft']):.0f} ft, "
                "which is meaningfully away from the marked or typed endpoint distance. "
                "Recheck the endpoint marker or type a measured distance if you have one."
            ),
            "evidence": {"distance_z": distance_z},
        })
    if hang_z >= 1.3 and best.get("hang_time_score_weight", 0.0) > 0:
        warnings.append({
            "severity": "warning" if hang_z < 2.0 else "strong",
            "title": "Ground contact timing conflicts with the best flight match",
            "message": (
                f"The selected synthetic flight has about {float(best['hang_time_s']):.2f}s hang time. "
                "That is hard to reconcile with the marked ground-contact frame. "
                "Recheck the contact frame if the ball was hard to see near landing."
            ),
            "evidence": {"hang_time_z": hang_z},
        })
    if la_z >= 1.4 and best.get("launch_angle_score_weight", 0.0) > 0:
        warnings.append({
            "severity": "warning" if la_z < 2.1 else "strong",
            "title": "Camera launch angle conflicts with the best flight match",
            "message": (
                f"The selected synthetic flight uses about {float(best['launch_angle_deg']):.0f} degrees LA, "
                "which is not lining up cleanly with the camera/landmark launch-angle estimate. "
                "Recheck the first few ball marks and field landmarks."
            ),
            "evidence": {"launch_angle_z": la_z},
        })
    if path_timing_reliable and path_rmse is not None and path_best is not None:
        path_gap = float(path_rmse) - float(path_best)
        if path_gap >= 35.0:
            warnings.append({
                "severity": "warning" if path_gap < 70.0 else "strong",
                "title": "Early ball path prefers a different synthetic flight",
                "message": (
                    f"The best overall estimate is {path_gap:.0f}px worse on the early frame-by-frame path fit "
                    "than the closest visual path. The endpoint, timing, or launch-angle evidence is pulling "
                    "against the visual path."
                ),
                "evidence": {"projected_path_rmse_px": float(path_rmse), "best_projected_path_rmse_px": float(path_best)},
            })
    if path_only_best and target_distance is not None and useful_velocity_path(path_evidence):
        path_only_distance = path_only_best.get("distance_ft")
        path_only_ev = path_only_best.get("exit_velocity_mph")
        if path_only_distance is not None:
            distance_gap = abs(float(target_distance) - float(path_only_distance))
            warning_gap = max(40.0, float(path_only_distance) * 0.16)
            strong_gap = max(65.0, float(path_only_distance) * 0.25)
            if distance_gap >= warning_gap:
                warnings.append({
                    "severity": "strong" if distance_gap >= strong_gap else "warning",
                    "title": "Marked distance conflicts with the video-only path fit",
                    "message": (
                        "The camera-corrected early ball path matches a distance-free synthetic row at about "
                        f"{float(path_only_ev):.0f} mph and {float(path_only_distance):.0f} ft, but the marked "
                        f"landing distance is about {float(target_distance):.0f} ft. Recheck the landing marker "
                        "or the early ball points."
                    ),
                    "evidence": {
                        "marked_distance_ft": float(target_distance),
                        "path_only_distance_ft": float(path_only_distance),
                        "path_only_exit_velocity_mph": None if path_only_ev is None else float(path_only_ev),
                        "distance_gap_ft": distance_gap,
                    },
                })
    path_ratio = best.get("path_distance_ratio")
    if path_timing_reliable and path_ratio is not None:
        ratio = float(path_ratio)
        speed_conflict = ratio >= 1.18 or ratio <= 0.82
        strong_speed_conflict = ratio >= 1.32 or ratio <= 0.68
        if speed_conflict:
            warnings.append({
                "severity": "strong" if strong_speed_conflict else "warning",
                "title": "Video ball speed conflicts with the selected flight",
                "message": (
                    "The selected synthetic flight moves a different distance between early video frames "
                    f"than the marked ball path ({ratio:.2f}x). Recheck the landing marker, add more early "
                    "ball points, or mark ground contact before exporting."
                ),
                "evidence": {
                    "path_distance_ratio": ratio,
                    "observed_path_distance_px": best.get("observed_path_distance_px"),
                    "projected_path_distance_px": best.get("projected_path_distance_px"),
                },
            })
    if pose_rmse is not None and float(pose_rmse) >= 35.0:
        warnings.append({
            "severity": "warning" if float(pose_rmse) < 55.0 else "strong",
            "title": "Field landmarks do not fit the camera view cleanly",
            "message": (
                f"The camera pose misses the marked landmarks by about {float(pose_rmse):.0f}px RMS. "
                "That can make the projected synthetic path less reliable. Recheck landmark placement."
            ),
            "evidence": {"pose_landmark_rmse_px": float(pose_rmse)},
        })
    if path_timing_reliable and len(warnings) >= 2 and not any(row["severity"] == "strong" for row in warnings):
        warnings[0]["severity"] = "strong"
    return warnings


def export_readiness_for_prediction(prediction: dict, warnings: list[dict], best: dict | None = None) -> dict:
    review = prediction.get('distance_review') or {}
    if review.get('required'):
        return {'allowed': False, 'severity': 'blocked', 'confidence': 'LOW',
                'title': review['title'], 'message': review['message'],
                'actions': ['Review the landing mark, contact frame, and ball positions, then recalculate.'],
                'evidence': {'distance_review': review}, 'warnings': warnings}
    rows = prediction.get("ev_candidates") or []
    if best is None:
        best = rows[0] if rows else None
    if not best:
        return {
            "allowed": False,
            "severity": "blocked",
            "title": "Build an estimate before export",
            "message": "GameFrame needs a prediction before it can generate the EV video.",
            "actions": ["Build the prediction again after marking the ball path and field setup."],
            "evidence": {},
        }

    if prediction.get('method') == 'distance_hang_constrained':
        return dict(allowed=True,severity='warning',confidence='LOW',title='Conditional distance/hang-time estimate',
                    message='Matched to distance and hang time; video alignment is a separate diagnostic and is not independently validated.',warnings=warnings)

    if prediction.get("method") == "direction_first_shared_synthetic_match":
        shared = prediction.get("direction_first_match") or {}
        policy = shared.get("selection_policy") or {}
        if policy.get("joint_fit_found") is False:
            return {
                "allowed":False, "severity":"blocked", "confidence":"LOW",
                "title":"No trajectory fits the measurements",
                "message":"No candidate satisfies the video-position tolerance and the supplied landing distance together. The displayed candidate is diagnostic, not an accepted estimate.",
                "actions":["Review the ball tracking and camera calibration before generating the EV video."],
                "warnings":warnings, "evidence":{"selection_policy":policy},
            }
        uncertain = (not shared.get("acceptable") or shared.get("at_speed_boundary", False)
                     or int(shared.get("used_count") or 0) < 2
                     or prediction.get("estimation_pipeline") == "limited_early_flight_joint_fit"
                     or (shared.get('angle_primary') and not shared.get('late_timing_used_count',shared.get('late_vertical_used_count')))
                     or (shared.get("spray_refinement") or {}).get("at_search_boundary", False))
        return {
            "allowed": True,
            "severity": "warning" if uncertain or warnings else "ok",
            "confidence": "LOW" if uncertain else "MEDIUM",
            "title": "Conditional video estimate" if uncertain else "Ready to export",
            "message": (("Early marks constrain launch angle. Reliable camera-corrected later heights constrain speed, apex and descent; uncertain later positions are excluded. These are conditional model sensitivity ranges." if prediction.get('camera_motion') else "Launch angle is constrained by early marks before later vertical marks fit speed. The camera is assumed level with no zoom; sideways panning is allowed. These are conditional model sensitivity ranges.") if shared.get("staged") else "Launch, spray and speed are fitted together to the timed video points and marked landing distance. This is a distance-assisted estimate."
                        if shared.get("selection_policy") else "Launch angle is fixed from video direction. Speed remains conditional on the timed-position fit and camera calibration."),
            "warnings": warnings,
            "evidence": {"projected_path_rmse_px": best.get("projected_path_rmse_px"),
                         "direction_rmse_deg": shared.get("direction_rmse_deg"),
                         "independently_validated": False},
        }

    blockers: list[dict] = []
    terminal = prediction.get("terminal_event") or {}
    has_ground_contact = (
        terminal.get("type") == "FIRST_GROUND_CONTACT"
        and terminal.get("relative_time_s") is not None
    ) or best.get("ground_contact_confidence") is not None
    path_evidence = prediction.get("projected_path_evidence") or {}
    path_used = bool(path_evidence.get("used"))
    path_count = int(path_evidence.get("usable_point_count") or path_evidence.get("used_count") or 0)
    path_strength = float(path_evidence.get("path_evidence_strength") or 0.0)
    path_timing_reliable = bool(path_evidence.get("timing_reliable", True))
    path_best = path_evidence.get("best_rmse_px")
    path_rmse = best.get("projected_path_rmse_px")
    path_ratio = best.get("path_distance_ratio")
    path_only_best = ((prediction.get("path_only_model_fit") or {}).get("best") or {})
    direction = prediction.get("field_direction") or {}
    distance_source = str(direction.get("source") or "").lower()
    has_measured_distance = direction.get("estimated_distance_ft") is not None and (
        "actual_field_map" in distance_source or "field_endpoint" in distance_source
    )
    strong_path_evidence = path_count >= 6 and path_strength >= 0.65
    very_strong_path_evidence = path_count >= 8 and path_strength >= 0.8

    supplied_distance = direction.get("estimated_distance_ft")
    if (supplied_distance is not None and math.isfinite(float(supplied_distance))
            and float(supplied_distance) > 0 and not useful_velocity_path(path_evidence)
            and best.get("launch_angle_deg") is not None
            and math.isfinite(float(best["launch_angle_deg"]))):
        return {
            "allowed": True,
            "severity": "warning",
            "title": "Ready to export: distance and angle estimate",
            "message": "Using the supplied distance and estimated launch angle. Early ball tracking is insufficient to independently validate speed.",
            "warnings": warnings,
            "blockers": [],
            "evidence": {"distance_ft": float(supplied_distance), "early_path_validated": False},
        }

    if not path_used or path_count < 4:
        blockers.append({
            "reason": "missing_early_path",
            "message": "Mark at least four early ball positions so GameFrame can compare video speed against the synthetic flight.",
            "evidence": {"projected_path_used": path_used, "used_count": path_count},
        })

    if path_timing_reliable and path_rmse is not None and path_best is not None:
        path_gap = float(path_rmse) - float(path_best)
        gap_threshold = 45.0 if not has_ground_contact else 70.0
        if has_measured_distance and strong_path_evidence:
            gap_threshold = 95.0 if very_strong_path_evidence else 80.0
        if path_gap >= gap_threshold:
            blockers.append({
                "reason": "selected_flight_not_best_visual_path",
                "message": (
                    "The selected EV/distance row is too far from the best early-path synthetic match. "
                    "Recheck the landing marker and early ball points before exporting."
                ),
                "evidence": {
                    "projected_path_rmse_px": float(path_rmse),
                    "best_projected_path_rmse_px": float(path_best),
                    "path_gap_px": path_gap,
                    "has_ground_contact": has_ground_contact,
                    "path_evidence_strength": path_strength,
                    "usable_point_count": path_count,
                },
            })

    if path_timing_reliable and path_ratio is not None:
        ratio = float(path_ratio)
        upper = 1.22 if not has_ground_contact else 1.36
        lower = 0.78 if not has_ground_contact else 0.64
        if has_measured_distance and strong_path_evidence:
            upper = max(upper, 1.40 if very_strong_path_evidence else 1.32)
            lower = min(lower, 0.60 if very_strong_path_evidence else 0.68)
        if ratio >= upper or ratio <= lower:
            blockers.append({
                "reason": "frame_distance_mismatch",
                "message": (
                    "The selected synthetic flight travels too different a distance between frames "
                    "than the marked ball in the video."
                ),
                "evidence": {
                    "path_distance_ratio": ratio,
                    "observed_path_distance_px": best.get("observed_path_distance_px"),
                    "projected_path_distance_px": best.get("projected_path_distance_px"),
                    "has_ground_contact": has_ground_contact,
                    "path_evidence_strength": path_strength,
                    "usable_point_count": path_count,
                },
            })

    if path_only_best and direction.get("estimated_distance_ft") is not None:
        path_only_distance = path_only_best.get("distance_ft")
        path_only_rmse = path_only_best.get("projected_path_rmse_px")
        path_only_early_ratio = path_only_best.get("early_velocity_path_distance_ratio")
        if path_only_distance is not None:
            target_distance = float(direction["estimated_distance_ft"])
            distance_gap = abs(target_distance - float(path_only_distance))
            strict_gap = max(65.0, float(path_only_distance) * 0.25)
            if strong_path_evidence and distance_gap >= strict_gap:
                blockers.append({
                    "reason": "marked_distance_conflicts_with_path_only_fit",
                    "message": (
                        "The entered or mapped landing distance does not match the camera-corrected early ball path. "
                        "Recheck the landing marker before exporting."
                    ),
                    "evidence": {
                        "marked_distance_ft": target_distance,
                        "path_only_distance_ft": float(path_only_distance),
                        "path_only_exit_velocity_mph": path_only_best.get("exit_velocity_mph"),
                        "path_only_projected_path_rmse_px": path_only_rmse,
                        "path_only_early_velocity_path_distance_ratio": path_only_early_ratio,
                        "distance_gap_ft": distance_gap,
                        "path_evidence_strength": path_strength,
                        "usable_point_count": path_count,
                    },
                })

    if blockers:
        primary = blockers[0]
        return {
            "allowed": False,
            "severity": "blocked",
            "title": "Export paused: flight evidence does not reconcile yet",
            "message": primary["message"],
            "actions": [
                "Add or correct early ball path points.",
                "Move the landing marker to the actual landing area or enter a measured distance.",
                "Mark first ground contact if it is visible.",
            ],
            "blockers": blockers,
            "warnings": warnings,
            "evidence": primary.get("evidence") or {},
        }

    return {
        "allowed": True,
        "severity": "ok" if not warnings else "warning",
        "title": "Ready to export",
        "message": "The marked evidence is plausible enough to generate the EV video.",
        "warnings": warnings,
        "evidence": {
            "projected_path_rmse_px": path_rmse,
            "best_projected_path_rmse_px": path_best,
            "path_distance_ratio": path_ratio,
            "has_ground_contact": has_ground_contact,
        },
    }


def assess_launch_angle_evidence(direct_launch_angle: dict, legacy_launch_angle: dict) -> dict:
    measured = float(direct_launch_angle["launch_angle_deg"])
    legacy = float(legacy_launch_angle["launch_angle_deg"])
    fov_range = direct_launch_angle.get("launch_angle_range_deg") or [measured, measured]
    fov_width = abs(float(fov_range[1]) - float(fov_range[0]))
    method_disagreement = abs(measured - legacy)
    origin_fit_error = float(direct_launch_angle.get("contact_origin_fit_error_px") or 0.0)
    reconstruction_error = float(direct_launch_angle.get("image_reconstruction_error_px_per_s") or 0.0)
    sigma = max(2.5, fov_width / 2.0)
    confidence = "HIGH"
    reason = "camera-pose LA solved from marked field/camera geometry"
    if fov_width > 16.0 or origin_fit_error > 18.0 or reconstruction_error > 80.0:
        confidence = "LOW"
        reason = "camera-pose LA has high FOV or contact-anchor sensitivity"
        sigma = max(sigma, 8.0)
    elif fov_width > 8.0 or origin_fit_error > 10.0 or reconstruction_error > 35.0:
        confidence = "MEDIUM"
        reason = "camera-pose LA has moderate FOV or contact-anchor sensitivity"
        sigma = max(sigma, 4.0)
    return {
        "launch_angle_deg": measured,
        "legacy_launch_angle_deg": legacy,
        "fov_range_deg": [float(fov_range[0]), float(fov_range[1])],
        "fov_width_deg": fov_width,
        "method_disagreement_deg": method_disagreement,
        "legacy_diagnostic_only": True,
        "contact_origin_fit_error_px": origin_fit_error,
        "image_reconstruction_error_px_per_s": reconstruction_error,
        "sigma_deg": sigma,
        "confidence": confidence,
        "reason": reason,
    }


def assess_identifiability(rows: list[dict]) -> dict:
    if not rows:
        return {"identifiable": False, "reason": "no candidates"}
    best = rows[0]
    if best.get("ev_underconstrained"):
        view_classification = best.get("view_classification")
        reason = "EV cannot be ranked without numeric distance, HIGH-confidence hang evidence, usable apex evidence, or side-on path evidence"
        if view_classification == "depth_heavy":
            reason = "EV cannot be ranked from a depth-heavy view without a visible/supplied apex, numeric distance, or HIGH-confidence hang evidence"
        return {
            "identifiable": False,
            "reason": reason,
        }
    top_score = float(best["score"])
    near = [row for row in rows if float(row["score"]) <= top_score + 0.35][:50]
    evs = [float(row["exit_velocity_mph"]) for row in near]
    las = [float(row["launch_angle_deg"]) for row in near]
    if len(near) >= 8 and (max(evs) - min(evs) >= 6.0 or max(las) - min(las) >= 6.0):
        return {
            "identifiable": False,
            "reason": "best treated as a range because nearby synthetic rows score similarly",
            "near_tie_count": len(near),
            "near_tie_ev_range_mph": [min(evs), max(evs)],
            "near_tie_la_range_deg": [min(las), max(las)],
            "near_tie_distance_range_ft": [min(float(row["distance_ft"]) for row in near), max(float(row["distance_ft"]) for row in near)],
            "near_tie_hang_time_range_s": [min(float(row["hang_time_s"]) for row in near), max(float(row["hang_time_s"]) for row in near)],
            "score_window": 0.35,
        }
    return {
        "identifiable": True,
        "reason": "top synthetic rows are separated enough to rank",
        "near_tie_count": len(near),
    }


def trajectory_points_for_hit(db_path: Path, hit_id: str | None, max_points: int = 90) -> list[dict]:
    if not hit_id:
        return []
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT relative_time_s, x_ft, y_ft, z_ft
            FROM trajectory_points
            WHERE hit_id = ?
            ORDER BY relative_time_s
            """,
            (hit_id,),
        ).fetchall()
    if not rows:
        return []
    stride = max(1, int(math.ceil(len(rows) / max_points)))
    sampled = rows[::stride]
    if sampled[-1]["relative_time_s"] != rows[-1]["relative_time_s"]:
        sampled.append(rows[-1])
    return [
        {
            "relative_time_s": round(float(row["relative_time_s"]), 4),
            "x_ft": round(float(row["x_ft"]), 3),
            "y_ft": round(float(row["y_ft"]), 3),
            "z_ft": round(float(row["z_ft"]), 3),
        }
        for row in sampled
    ]


def main(argv=None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("observation_package", type=Path)
    parser.add_argument("--db", default=Path("data/hittrax_from_video.sqlite"), type=Path)
    parser.add_argument("--calibration-id", default="obs_ground_contact")
    parser.add_argument("--out", default=Path("comparison_output/direct_video_estimate.json"), type=Path)
    args = parser.parse_args(argv)

    package = load_package(args.observation_package)
    from contact_timing import prepare_contact_observations
    package = {**package, "ball_observations": prepare_contact_observations(package.get("ball_observations") or [])}
    from camera_motion_observations import register_ball_observations
    from evidence_analysis_cache import cached_analysis, source_identity
    source_meta=package.get('video_metadata') or {}
    registration_meta={k:source_meta.get(k) for k in ('width_px','height_px','variable_frame_rate','timing_source')}
    registered_observations, camera_motion = cached_analysis('background_registration',
        [source_identity(source_meta),registration_meta,package['ball_observations']],
        lambda:register_ball_observations(package, package['ball_observations']))
    if package.get('_prepare_background_only') is True:
        args.out.parent.mkdir(parents=True,exist_ok=True)
        args.out.write_text(json.dumps({'method':'background_preparation','prepared':True,
            'observation_count':len(registered_observations)}),encoding='utf-8')
        return
    package = {**package, 'ball_observations': registered_observations, 'camera_motion_evidence': camera_motion}
    metadata = {**(package.get("video_metadata") or {}), "contact_timing": (package.get("hit") or {}).get("contact")}
    observations, rejected_observations = reject_early_anchor_arrivals(
        package.get("ball_observations") or [], float(metadata.get("frame_step_assumption_s") or 1 / 30))
    package = {**package, "ball_observations": observations}
    tracking_validation = {"rejected_points": rejected_observations, "manual_anchors_preserved": True}
    width = int(metadata.get("width_px") or 1920)
    height = int(metadata.get("height_px") or 1080)

    geometry = resolved_prediction_geometry(package)
    landmark_count = int(geometry["fixed_landmark_count"])
    # Field calibration is independent of landing distance and flight marks
    # other than contact. Reuse it while those actual inputs remain unchanged.
    pose_camera={k:v for k,v in (package.get('camera') or {}).items() if k!='actual_field_map'}
    pose_marks=sorted([[r.get(k) for k in ('landmark','image_x','image_y','uncertainty_px','estimate_kind','rubber_visible')]
        for r in package.get('landmarks',[])],key=lambda r:str(r[0]))
    pose_evidence=[pose_camera,package.get('field'),package.get('field_size'),pose_marks,
        width,height,(package.get('hit') or {}).get('contact'),
        [r for r in observations if abs(r.get('relative_time_s',-1))<1e-6]]
    constrained_pose = cached_analysis('field_pose',pose_evidence,
        lambda:constrained_pose_from_three_landmarks(package,width,height)) if geometry["usable"] else None
    from angle_sensitivity import launch_angle_sensitivity
    sensitivity_bearing=(geometry.get('direction') or {}).get('spray_angle_deg',0.)
    sensitivity_step=float(metadata.get('frame_step_assumption_s') or 1/30)
    angle_uncertainty = cached_analysis('angle_sensitivity',
        [observations,constrained_pose,sensitivity_bearing,sensitivity_step],
        lambda:launch_angle_sensitivity(observations,constrained_pose,sensitivity_bearing,sensitivity_step)) if constrained_pose is not None else None
    direction = geometry.get('direction') or {}
    camera = constrained_pose['camera_center_ft'] if constrained_pose is not None else camera_center_from_package(package)
    vector = np.asarray(direction.get('direction_xy') or [0.,0.], dtype=float)
    alignment = (abs(float(np.dot(camera[:2],vector))) / (float(np.linalg.norm(camera[:2])) * float(np.linalg.norm(vector)))
                 if camera is not None and np.linalg.norm(camera[:2]) > 0 and np.linalg.norm(vector) > 0 else None)
    # Calibration describes the contact frame. Later camera movement is handled
    # by background registration / exclusion, not by invalidating that pose.
    calibration_uncertain = constrained_pose is None or not (constrained_pose.get('calibration_diagnostics') or {}).get('usable_for_velocity',True)
    angle_primary = not calibration_uncertain and alignment is not None and alignment < .95
    if calibration_uncertain or (alignment is not None and alignment >= .95):
        physical = match_distance_and_hang(package,args.db,direction,constrained_pose)
        if physical is not None:
            message = ('Candidates satisfy the marked distance, hang time and landing direction. Video alignment is a separate, conditional camera check; it does not rank or reject these candidates.'
                       if physical['acceptable'] else 'No simulated trajectory satisfies the marked distance, hang time and landing direction within their uncertainties.')
            output = dict(method='distance_hang_constrained',video_metadata=metadata,
                angle_constraint_policy={'mode':'calibration_uncertain_user_inputs' if calibration_uncertain else 'near_line_of_sight_user_inputs',
                    'view_alignment':alignment,'near_line_of_sight_alignment':.95,'distance_can_change_launch_angle':True},
                launch_angle_uncertainty=angle_uncertainty,camera_motion=camera_motion,
                tracking_validation=tracking_validation,resolved_geometry=geometry,field_direction=direction,
                field_landmark_count=landmark_count,terminal_event=package.get('terminal_event'),
                view_geometry=dict(classification='depth_heavy' if alignment is not None and alignment>=.95 else 'calibration_uncertain',depth_alignment=alignment),
                ev_candidates=physical['candidates'],best_trajectory_points=physical['trajectory_points'],
                distance_hang_match=physical,
                identifiability=dict(identifiable=False,reason='Conditional distance/hang-time range; camera alignment is not independently validated.'),
                evidence_policy=dict(exit_velocity='Rank by marked distance and hang time only; require mapped landing direction.',
                                     launch_angle='Search launch angle jointly with speed; no video-angle lock.',
                                     projected_path='Separate conditional diagnostic; never used for ranking or acceptance.'),
                distance_review=dict(required=False,status='distance_hang_supported' if physical['acceptable'] else 'no_distance_hang_match'),
                evidence_warnings=[dict(severity='warning',title='Distance and hang time estimate',message=message+' '+physical['assumptions'])],
                export_readiness=dict(allowed=physical['acceptable'],severity='warning' if physical['acceptable'] else 'blocked',
                    confidence='LOW',title='Conditional distance/hang-time estimate' if physical['acceptable'] else 'No distance/hang-time match',
                    message=message,independently_validated=False))
            args.out.parent.mkdir(parents=True,exist_ok=True)
            args.out.write_text(json.dumps(output,indent=2),encoding='utf-8')
            print(f'Wrote {args.out}; distance/hang-time candidates: {physical["candidate_count"]}')
            return
    if constrained_pose is None:
        direction = geometry.get("direction") or {
            "source": "unresolved",
            "spray_angle_deg": 0.0,
            "direction_xy": [0.0, 1.0],
            "estimated_distance_ft": None,
        }
        diagnostic = score_uncalibrated_path_shapes(package, args.db)
        candidates = diagnostic.get("candidates", [])
        output = {
            "method": "uncalibrated_path_shape_diagnostic",
            "tracking_validation": tracking_validation,
            "calibration_id": None,
            "video_metadata": metadata,
            "field_landmark_count": landmark_count,
            "resolved_geometry": geometry,
            "field_direction": direction,
            "identifiability": {
                "identifiable": False,
                "reason": (
                    "current video geometry is incomplete, so camera scale/pose is not calibrated; "
                    f"missing: {', '.join(geometry.get('missing') or ['usable camera pose'])}"
                ),
                "diagnostic_range": diagnostic.get("diagnostic_range"),
            },
            "launch_angle_evidence": {
                "confidence": "LOW",
                "reason": "no current-package calibrated camera pose for direct trigonometry",
            },
            "apex_evidence": diagnostic.get("apex_evidence"),
            "projected_path_evidence": {
                key: value for key, value in diagnostic.items()
                if key not in {"candidates", "apex_evidence"}
            },
            "evidence_policy": {
                "launch_angle": "requires actual field map camera position plus home plate and pitching rubber video landmarks; stored DB calibration is intentionally not used",
                "exit_velocity": "requires current-package camera pose, reliable hang/landing evidence, or another real-world scale constraint",
                "projected_path": "uncalibrated affine path-shape diagnostic only; not a physical EV estimator",
            },
            "ev_candidates": candidates[:25],
            "best_trajectory_points": trajectory_points_for_hit(
                args.db,
                None if not candidates else str(candidates[0].get("hit_id")),
            ),
        }
        output["evidence_warnings"] = evidence_warnings_for_prediction(output)
        output["export_readiness"] = export_readiness_for_prediction(output, output["evidence_warnings"])
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(output, indent=2), encoding="utf-8")
        print(f"Wrote {args.out}")
        print("No calibrated field landmarks; wrote uncalibrated path-shape diagnostic.")
        for row in candidates[:10]:
            print(
                f"{row['hit_id']:<24} score={row['score']:.3f} "
                f"EV={row['exit_velocity_mph']:.1f} LA={row['launch_angle_deg']:.1f} "
                f"dist={row['distance_ft']:.1f} hang={row['hang_time_s']:.2f}"
            )
        return

    if constrained_pose is not None:
        direction = geometry["direction"]
        observed = fit_observed_image_direction(observations)
        direct_la = estimate_launch_angle_from_fixed_pose(
            np.array(observed["image_velocity_px_per_s"], dtype=float),
            np.array(observed["detected_anchor_px"], dtype=float),
            np.array(direction["direction_xy"], dtype=float),
            constrained_pose,
            package,
        )
        view_geometry = classify_view_geometry(
            package,
            np.array(direction["direction_xy"], dtype=float),
            direct_la,
        )
        launch_angle_evidence = {
            "launch_angle_deg": float(direct_la["launch_angle_deg"]),
            "legacy_launch_angle_deg": float(direct_la["launch_angle_deg"]),
            "fov_range_deg": direct_la.get("launch_angle_range_deg"),
            "fov_width_deg": 12.0,
            "method_disagreement_deg": 0.0,
            "sigma_deg": 4.0,
            "confidence": (
                "HIGH" if constrained_pose["landmark_count"] >= 3 and constrained_pose["rmse_px"] <= 25.0
                else "MEDIUM" if constrained_pose["rmse_px"] <= 25.0
                else "LOW"
            ),
            "reason": (
                "minimum camera pose from home plate and pitching rubber plus supplied map camera position/height"
                if constrained_pose["landmark_count"] < 3
                else "constrained camera pose from video landmarks plus supplied map camera position/height"
            ),
        }
        apex_evidence = uncalibrated_apex_evidence(package)
        apex_physics = apex_physics_estimate(apex_evidence)
        target_distance, _ = target_distance_from_package(package, direction)
        apex_time_angle_estimate = apex_time_launch_angle_estimate(
            apex_evidence,
            direct_la["launch_angle_deg"],
        )
        apex_launch_estimate = apex_ballistic_launch_estimate(apex_physics, target_distance) or apex_time_angle_estimate
        staged_context = prepare_staged_flight(
            observations, constrained_pose, direction['spray_angle_deg'],
            frame_step_s=float(metadata.get('frame_step_assumption_s') or 1/30),
            terminal_event=package.get('terminal_event'), package=package,
            angle_primary=angle_primary,fallback_launch_angle=float(direct_la['launch_angle_deg']),use_descent_rate=False)
        if staged_context is not None:
            shared_match = select_staged_match(staged_context, target_distance,
                distance_tolerance_ft=float((package.get('hit',{}).get('distance_observation') or {}).get('uncertainty_ft') or 12.),
                terminal_event=package.get('terminal_event'),frame_step_s=float(metadata.get('frame_step_assumption_s') or 1/30))
        else:
            shared_match = match_path_and_distance(
                observations, constrained_pose, direction["spray_angle_deg"], args.db,
                distance_ft=target_distance,
                terminal_event=package.get('terminal_event'),
                frame_step_s=float(metadata.get("frame_step_assumption_s") or 1 / 30),
                distance_tolerance_ft=max(1.0,float((package.get('hit',{}).get('distance_observation') or {}).get('uncertainty_ft') or 12.0)))
        # The joint matcher supplies the result directly. Avoid two legacy path
        # scans and two legacy rankings that were immediately overwritten.
        path_evidence = {}
        path_only_evidence = {}
        path_only_candidates = []
        ev_candidates = []
        identifiability = {}
        output = {
            "method": "constrained_camera_pose_launch_angle_then_flight_table_ev",
            "tracking_validation": tracking_validation,
            "calibration_id": "home_rubber_plus_camera_marker",
            "video_metadata": metadata,
            "field_landmark_count": landmark_count,
            "resolved_geometry": {
                **geometry,
                "camera_center_ft": constrained_pose["camera_center_ft"].tolist(),
                "calibration_diagnostics": constrained_pose.get("calibration_diagnostics", {}),
                "pose_landmark_rmse_px": float(constrained_pose["rmse_px"]),
                "pose_horizontal_fov_deg": float(constrained_pose["horizontal_fov_deg"]),
                "contact_registration": constrained_pose.get('contact_registration'),
            },
            "observed_image_direction": observed,
            "field_direction": direction,
            "direct_launch_angle": direct_la,
            "launch_angle_evidence": launch_angle_evidence,
            "view_geometry": view_geometry,
            "identifiability": identifiability,
            "apex_evidence": apex_evidence,
            "apex_physics_estimate": apex_physics,
            "apex_time_launch_angle_estimate": apex_time_angle_estimate,
            "apex_ballistic_launch_estimate": apex_launch_estimate,
            "projected_path_evidence": {key: value for key, value in path_evidence.items() if key != "scores_by_hit_id"},
            "path_only_model_fit": {
                "independently_validated": False,
                "description": "Distance-free comparison using camera orientation, launch angle, spray direction, and detected early ball locations only. Endpoint distance, hang time, and apex anchors are ignored.",
                "projected_path_evidence": {key: value for key, value in path_only_evidence.items() if key != "scores_by_hit_id"},
                "candidates": path_only_candidates[:10],
                "best": path_only_candidates[0] if path_only_candidates else None,
            },
            "evidence_policy": {
                "launch_angle": "computed from constrained camera pose using home plate and pitching rubber video landmarks plus supplied map camera position/height; extra base marks only improve confidence",
                "exit_velocity": "selected from synthetic trajectory table using constrained LA, spray, endpoint distance, ground contact evidence, and calibrated frame-by-frame path fit",
                "projected_distance": "reported from selected flight row",
                "ground_contact": "used as confidence-weighted hangtime hint; HIGH confidence counts strongly, lower confidence counts lightly",
                "apex": "uses explicit hit.apex_observation when supplied, otherwise inferred from existing ball points only when a visible interior peak exists",
                "projected_path": "compares the earliest stable post-contact ball points to each synthetic trajectory projected through the user-marked camera pose; later points are avoided/downweighted because the camera may move",
            },
            "ev_candidates": ev_candidates[:25],
            "best_trajectory_points": trajectory_points_for_hit(
                args.db,
                None if not ev_candidates else str(ev_candidates[0].get("hit_id")),
            ),
        }
        output["direction_first_match"] = shared_match
        output["measurement_support"] = shared_match.get("supported_ranges") or {}
        if staged_context is not None:
            video_only_match = select_staged_match(staged_context, None,
                terminal_event=package.get('terminal_event'),frame_step_s=float(metadata.get('frame_step_assumption_s') or 1/30))
        else:
            video_only_match = match_path_and_distance(
                observations, constrained_pose, direction["spray_angle_deg"], args.db,
                distance_ft=None, refine=False,
                terminal_event=package.get('terminal_event'),
                frame_step_s=float(metadata.get("frame_step_assumption_s") or 1 / 30))
        if video_only_match.get("used"):
            output["path_only_model_fit"] = {
                "description": "Closest timed video paths without using distance, allowing the same direction range.",
                "independently_validated": False,
                "best": video_only_match["path_only_candidates"][0],
                "candidates": video_only_match["path_only_candidates"],
                "diagnostics": {"uses_distance": False, "performance": video_only_match["performance"]},
            }
        output['video_only_support']=video_only_match.get('supported_ranges') or {}
        if shared_match.get("used"):
            output["method"] = "direction_first_shared_synthetic_match"
            output["ev_candidates"] = shared_match["candidates"][:25]
            output["best_trajectory_points"] = shared_match["trajectory_points"]
            output["projected_path_evidence"] = {
                "source": "direction_first_shared_synthetic_match", "independent_velocity_validated": False,
                "used": True, "timing_reliable": True,
                "used_count": shared_match["used_count"],
                "best_rmse_px": shared_match["best"]["projected_path_rmse_px"],
                "direction_rmse_deg": shared_match["direction_rmse_deg"],
            }
            output["evidence_policy"]["exit_velocity"] = shared_match["assumptions"]
            output["evidence_policy"]["launch_angle"] = "launch, spray and speed selected together with fixed camera and separate video/distance acceptance limits"
            output["launch_angle_evidence"].update(
                launch_angle_deg=shared_match["common_launch_angle_deg"],
                source="joint_database_path_and_distance_match",
                locked_before_speed_matching=False,
                geometry_diagnostic_launch_angle_deg=direct_la["launch_angle_deg"],
                reason="joint timed-video and marked-distance fit within the mapped direction range")
            if shared_match.get('staged'):
                output['estimation_pipeline'] = 'early_geometry_then_late_height'
                output['legacy_camera_angle_diagnostic'] = output['direct_launch_angle']
                output['direct_launch_angle'] = {
                    'method':'early_spatial_geometry', 'launch_angle_deg':shared_match['common_launch_angle_deg'],
                    'launch_angle_range_deg':shared_match.get('supported_ranges',{}).get('launch_angle_deg'),
                    'locked_before_speed_matching':True, 'range_is_confidence_interval':False}
                output['evidence_policy']['launch_angle'] = '3D spatial tangent from early marks and field geometry, without speed, later marks or landing distance; fixed before speed matching'
                output['evidence_policy']['projected_path'] = 'early XY and later vertical positions only; later horizontal positions do not score the fit'
                output['launch_angle_evidence'].update(source='early_spatial_geometry',locked_before_speed_matching=True,
                    reason='Each early geometric angle/direction hypothesis is frozen before later vertical marks fit speed.',
                    fov_range_deg=None, fov_width_deg=None, sigma_deg=None,
                    supported_angle_range_deg=shared_match.get('supported_ranges',{}).get('launch_angle_deg'))
            else:
                output['estimation_pipeline'] = 'limited_early_flight_joint_fit'
            output["evidence_policy"]["projected_distance"] = "flight-model carry must agree with the marked landing distance within its uncertainty"
            output["identifiability"] = {**assess_identifiability(output["ev_candidates"]),
                "independent_video_only": False, "reason": "estimate depends on camera calibration, timed ball marks, and supplied distance"}
            if shared_match["at_speed_boundary"]:
                output["identifiability"].update(identifiable=False,
                    reason="closest speed is at the edge of the eligible database range")
            if not shared_match["acceptable"]:
                output["identifiability"].update(identifiable=False,
                    reason="no candidate satisfies the timed video and supplied landing-distance tolerances together")
            if (shared_match.get("spray_refinement") or {}).get("at_search_boundary"):
                output["identifiability"].update(identifiable=False,
                    reason="best spray is near the edge of the permitted direction search; the direction constraint may need review")
        else:
            output["method"] = "video_direction_match_unavailable"
            output["ev_candidates"] = []
            output["best_trajectory_points"] = []
            output["identifiability"] = {"identifiable": False, "reason": shared_match.get("reason")}
        manual_only_match = None
        manual_rows = [r for r in observations if str(r.get('source', '')).upper()
                       not in {'COMPUTER_VISION', 'PATH_SEARCH', 'BRUSH_PATH_SEARCH'}]
        if (not angle_primary and shared_match.get('used') and not shared_match.get('acceptable') and target_distance is not None
                and shared_match.get('observation_policy') != 'manual_anchors'
                and 2 <= len(manual_rows) < len(observations)):
            # Diagnostic only: never replace tracking or accept a weaker fit automatically.
            manual_only_match = match_path_and_distance(
                manual_rows, constrained_pose, direction['spray_angle_deg'], args.db,
                distance_ft=target_distance, refine=False,
                terminal_event=package.get('terminal_event'),
                frame_step_s=float(metadata.get('frame_step_assumption_s') or 1 / 30),
                distance_tolerance_ft=max(1.0, float((package.get('hit', {}).get('distance_observation') or {}).get('uncertainty_ft') or 12.0)))
        output['distance_review'] = build_distance_review(shared_match, video_only_match, target_distance,
                                                         constrained_pose.get('calibration_diagnostics'), manual_only_match)
        output['camera_motion'] = camera_motion
        output['late_observation_policy'] = shared_match.get('late_evidence_policy','early_positions_only')
        if shared_match.get('late_evidence_policy') == 'timing_and_descent_rate':
            output['evidence_policy']['projected_path']='Early spatial geometry fixes launch angle. Reliable camera-corrected descent rate and rise/descent timing constrain speed. Absolute late height and late horizontal positions are excluded.'
        elif shared_match.get('late_evidence_policy') == 'timing_only':
            output['evidence_policy']['projected_path']='Early spatial path is checked without forcing position-at-time matches in angle-first views. Later marks constrain reliable rise/descent timing, not absolute height or horizontal position.'
        output['angle_constraint_policy'] = {'mode':'calculated_angle_primary' if angle_primary else 'calibration_uncertain_user_inputs' if calibration_uncertain else 'near_line_of_sight_user_inputs',
            'near_line_of_sight_alignment':.95,'view_alignment':alignment,
            'distance_can_change_launch_angle':not angle_primary}
        if angle_primary:
            output['evidence_policy']['launch_angle'] = 'Calculated from early marks, camera geometry and supplied direction before matching. Distance can select speed but cannot change this angle.'
            output['launch_angle_evidence']['reason'] = output['evidence_policy']['launch_angle']
        output['launch_angle_uncertainty'] = angle_uncertainty
        if angle_uncertainty and angle_uncertainty.get('range_deg') and shared_match.get('acceptable'):
            geometric = angle_uncertainty['range_deg']
            supported = output['measurement_support'].get('launch_angle_deg', [shared_match['common_launch_angle_deg']]*2)
            # Keep conditional simulation ranges separate from the displayed
            # envelope, which also includes camera/depth/click uncertainty.
            output['measurement_support'] = {**output['measurement_support'],
                'launch_angle_deg':[min(geometric[0],supported[0]),max(geometric[1],supported[1])],
                'launch_angle_range_source':'geometry_and_mark_sensitivity'}
            output['direct_launch_angle']['launch_angle_range_deg'] = output['measurement_support']['launch_angle_deg']
        output["evidence_warnings"] = evidence_warnings_for_prediction(output)
        camera_calibration = constrained_pose.get('calibration_diagnostics') or {}
        if camera_calibration.get('map_discrepancy'):
            output['evidence_warnings'].append({'severity':'info','reason':'map_camera_discrepancy',
                'message':camera_calibration['message'],'evidence':camera_calibration})
        if angle_uncertainty and angle_uncertainty.get('poorly_constrained'):
            output['evidence_warnings'].append({'severity':'info','reason':'launch_angle_geometry_sensitive',
                'message':angle_uncertainty['reason'],'evidence':angle_uncertainty})
            output['launch_angle_evidence']['confidence'] = 'LOW'
        if camera_motion.get('excluded_late_points'):
            output['evidence_warnings'].append({'severity': 'info', 'reason': 'late_camera_alignment_uncertain',
                'message': 'Later camera movement could not be corrected reliably. Those positions do not reject the early fit; apex and descent are less constrained.',
                'evidence': camera_motion})
        if shared_match.get("used") and not shared_match.get("acceptable"):
            output["evidence_warnings"].append({
                "severity": "warning", "reason": "video_direction_position_mismatch",
                "message": ('No tested flight agrees with the early marks, reliable later motion and entered distance. Absolute later positions are not used.' if shared_match.get('late_evidence_policy') in {'timing_only','timing_and_descent_rate'} else f"No accepted match: the diagnostic candidate has {shared_match['best']['projected_path_rmse_px']:.1f} px RMS position error. No candidate satisfies both the video and supplied distance tolerances."),
                "evidence": {"pixel_error": shared_match.get("pixel_error"), "direction_rmse_deg": shared_match["direction_rmse_deg"]},
            })
        output["export_readiness"] = export_readiness_for_prediction(output, output["evidence_warnings"])
        if shared_match.get("used") and not shared_match.get("acceptable"):
            output["export_readiness"]["confidence"] = "LOW"
        if angle_primary:
            output['export_readiness']['message']=('The calculated launch angle is held fixed. Distance can refine speed within the video-supported range; it cannot change the angle to fit the landing mark.' if shared_match.get('acceptable') else 'No tested speed reconciles the video marks and entered distance at the calculated launch angle. The angle has been retained; review the measurements.')
        if camera_motion.get('excluded_late_points'):
            output['export_readiness']['confidence'] = 'LOW'
        if (angle_uncertainty and angle_uncertainty.get('poorly_constrained')) or camera_calibration.get('map_discrepancy'):
            output['export_readiness'].update(confidence='LOW',severity='warning',title='Conditional video estimate')
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(output, indent=2), encoding="utf-8")
        print(f"Wrote {args.out}")
        print("Used constrained camera pose from video landmarks plus map camera marker.")
        for row in output["ev_candidates"][:10]:
            print(
                f"{row['hit_id']:<24} score={row['score']:.3f} "
                f"EV={row['exit_velocity_mph']:.1f} LA={row['launch_angle_deg']:.1f} "
                f"dist={row['distance_ft']:.1f} hang={row['hang_time_s']:.2f}"
            )
        return


if __name__ == "__main__":
    main()
