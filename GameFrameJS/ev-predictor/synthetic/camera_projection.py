"""Simple camera projection for synthetic baseball trajectories."""

from __future__ import annotations

from dataclasses import dataclass
import math

import numpy as np


@dataclass(frozen=True)
class Camera:
    position_ft: np.ndarray
    target_ft: np.ndarray
    image_width_px: int = 1920
    image_height_px: int = 1080
    horizontal_fov_deg: float = 70.0


def normalize(vec: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    if norm == 0:
        raise ValueError("Cannot normalize zero vector.")
    return vec / norm


def camera_from_field_markers(
    camera_marker_percent: dict,
    image_width_px: int,
    image_height_px: int,
    camera_height_ft: float = 12.0,
    horizontal_fov_deg: float = 70.0,
) -> Camera:
    """Map the research field-diagram marker into a rough world camera.

    The field diagram is not yet a calibrated field map. This converts marker
    percentages into a broad camera prior in feet:

    - x = left/right across the field, with home plate at center
    - y = distance from home toward center field
    - z = camera height

    It is intentionally approximate and should be replaced by explicit field
    calibration as soon as landmarks are available.
    """

    x_pct = float(camera_marker_percent.get("x", 50.0))
    y_pct = float(camera_marker_percent.get("y", 95.0))
    x_ft = (x_pct - 50.0) / 50.0 * 120.0
    # Screen bottom is near home/fan side; top is deep field.
    y_ft = (100.0 - y_pct) / 100.0 * 450.0 - 85.0
    z_ft = camera_height_ft

    position = np.array([x_ft, y_ft, z_ft], dtype=float)
    target = np.array([0.0, 95.0, 35.0], dtype=float)
    return Camera(position, target, image_width_px, image_height_px, horizontal_fov_deg)


def project_points(camera: Camera, xyz_ft: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Project world points into image pixels.

    Returns ``(uv, visible_mask)``. World coordinates are the same trajectory
    convention used by Baseball Flight Sim: x is pull/opposite lateral, y is
    toward center field, z is vertical.
    """

    forward = normalize(camera.target_ft - camera.position_ft)
    world_up = np.array([0.0, 0.0, 1.0])
    right = normalize(np.cross(forward, world_up))
    up = normalize(np.cross(right, forward))

    rel = xyz_ft - camera.position_ft
    cam_x = rel @ right
    cam_y = rel @ up
    cam_z = rel @ forward

    focal_px = (camera.image_width_px / 2.0) / math.tan(math.radians(camera.horizontal_fov_deg) / 2.0)
    u = camera.image_width_px / 2.0 + focal_px * (cam_x / cam_z)
    v = camera.image_height_px / 2.0 - focal_px * (cam_y / cam_z)

    uv = np.column_stack([u, v])
    visible = (
        (cam_z > 0)
        & (u >= 0)
        & (u <= camera.image_width_px)
        & (v >= 0)
        & (v <= camera.image_height_px)
    )
    return uv, visible
