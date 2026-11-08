"""Rotate a calibrated video flight into an equal-scale launch-angle side view.

This displays the existing modeled trajectory. It does not infer additional ball
observations or change the prediction. One instance prepares one export section.
"""
from __future__ import annotations

import math
from typing import Callable

import cv2
import numpy as np


class FlightPlaneUnavailable(ValueError):
    """The saved measurement cannot support a camera-aligned plane animation."""


def _calibrated_pose(package: dict, width: int, height: int) -> dict | None:
    from direct_video_estimate import constrained_pose_from_three_landmarks
    return constrained_pose_from_three_landmarks(package, width, height)


def _saved_pose(prediction: dict, width: int, height: int) -> dict | None:
    """Reuse the exact camera selected by modeling instead of fitting it again."""
    saved = prediction.get('direct_launch_angle') or {}
    # The staged estimator replaces direct_launch_angle with its early spatial
    # angle summary, retaining the same fitted camera in this diagnostic. Only
    # camera geometry is reused here; the displayed angle still comes from the
    # selected trajectory, never the diagnostic's older angle calculation.
    if not all(key in saved for key in ('camera_center_ft', 'camera_target_ft', 'horizontal_fov_deg', 'camera_roll_deg')):
        saved = prediction.get('legacy_camera_angle_diagnostic') or {}
    try:
        center = np.asarray(saved['camera_center_ft'], dtype=float)
        target = np.asarray(saved['camera_target_ft'], dtype=float)
        fov = float(saved['horizontal_fov_deg'])
        roll = math.radians(float(saved['camera_roll_deg']))
        if center.shape != (3,) or target.shape != (3,) or not 1 < fov < 179:
            return None
        if not np.isfinite(np.r_[center, target, fov, roll]).all():
            return None
        forward = target - center
        if np.linalg.norm(forward) < 1e-8:
            return None
        forward /= np.linalg.norm(forward)
        right = np.cross(forward, [0., 0., 1.])
        if np.linalg.norm(right) < 1e-8:
            return None
        right /= np.linalg.norm(right)
        down = np.cross(forward, right)
        down /= np.linalg.norm(down)
        rotation = np.stack([math.cos(roll)*right + math.sin(roll)*down,
                             -math.sin(roll)*right + math.cos(roll)*down, forward])
        focal = width / (2 * math.tan(math.radians(fov) / 2))
        intrinsics = np.array([[focal, 0., width/2], [0., focal, height/2], [0., 0., 1.]])
        return {'rotation': rotation, 'translation': -rotation @ center, 'intrinsics': intrinsics}
    except (KeyError, TypeError, ValueError):
        return None


class FlightPlaneAnimation:
    duration_s = 9.0

    def __init__(self, package: dict, prediction: dict, background: np.ndarray):
        from scipy.spatial.transform import Rotation, Slerp

        if background is None or background.ndim != 3 or background.shape[2] != 3:
            raise FlightPlaneUnavailable('Contact video frame is unavailable.')
        self.height, self.width = background.shape[:2]
        if min(self.height, self.width) < 32:
            raise FlightPlaneUnavailable('Contact video frame is too small.')
        self.background = background.copy()
        rows = (prediction or {}).get('best_trajectory_points') or []
        best_rows = (prediction or {}).get('ev_candidates') or []
        if len(rows) < 3 or not best_rows:
            raise FlightPlaneUnavailable('A saved trajectory and launch angle are required.')
        try:
            rows = sorted(rows, key=lambda p: float(p.get('relative_time_s', p.get('t', 0))))
            self.xyz = np.array([[p['x_ft'], p['y_ft'], p['z_ft']] for p in rows], dtype=float)
            self.angle_deg = float(best_rows[0]['launch_angle_deg'])
        except (KeyError, TypeError, ValueError) as exc:
            raise FlightPlaneUnavailable('Saved flight geometry is incomplete.') from exc
        if not np.isfinite(self.xyz).all() or not math.isfinite(self.angle_deg) or not -89 < self.angle_deg < 89:
            raise FlightPlaneUnavailable('Saved flight geometry is invalid.')

        metadata = package.get('video_metadata') or {}
        source_width = int(metadata.get('width_px') or self.width)
        source_height = int(metadata.get('height_px') or self.height)
        if min(source_width, source_height) <= 0:
            raise FlightPlaneUnavailable('Source video dimensions are unavailable.')
        pose = _saved_pose(prediction, source_width, source_height)
        if pose is None:
            pose = _calibrated_pose(package, source_width, source_height)
        if pose is None:
            raise FlightPlaneUnavailable('A calibrated video camera is required.')
        self.rotation = np.asarray(pose['rotation'], dtype=float)
        self.translation = np.asarray(pose['translation'], dtype=float).reshape(3)
        self.intrinsics = np.diag([self.width / source_width, self.height / source_height, 1.]) @ np.asarray(pose['intrinsics'], dtype=float)
        if not all(np.isfinite(a).all() for a in [self.rotation, self.translation, self.intrinsics]):
            raise FlightPlaneUnavailable('Video camera calibration is invalid.')
        if abs(self.intrinsics[0, 1]) > 1e-7:
            raise FlightPlaneUnavailable('Video camera skew is unsupported.')
        if np.min(((self.rotation @ self.xyz.T).T + self.translation)[:, 2]) <= 0:
            raise FlightPlaneUnavailable('The saved flight is behind the calibrated camera.')

        launch = self.xyz[1] - self.xyz[0]
        horizontal = np.linalg.norm(launch[:2])
        if horizontal < 1e-7:
            raise FlightPlaneUnavailable('Saved flight has no horizontal launch direction.')
        path_angle = math.degrees(math.atan2(launch[2], horizontal))
        if abs(path_angle - self.angle_deg) > 2:
            raise FlightPlaneUnavailable('Saved trajectory and launch angle disagree.')
        self.right = np.r_[launch[:2] / horizontal, 0.]
        self.down = np.array([0., 0., -1.])
        forward = np.cross(self.right, self.down)
        self.end_rotation = np.stack([self.right, self.down, forward])
        self.slerp = Slerp([0., 1.], Rotation.from_matrix(np.stack([self.rotation, self.end_rotation])))
        self.start_center = -self.rotation.T @ self.translation
        center = (self.xyz.min(axis=0) + self.xyz.max(axis=0)) / 2
        self.distance = 600.
        self.end_center = center - forward * self.distance
        ranges = self.xyz @ self.right
        self.range_ft = float(np.ptp(ranges))
        if self.range_ft < 1e-6:
            raise FlightPlaneUnavailable('Saved flight has no horizontal extent.')
        self.scale = min(self.width * .76 / self.range_ft, self.height * .58 / max(float(np.ptp(self.xyz[:, 2])), 1.))
        self.origin = self.xyz[0]
        theta = math.radians(self.angle_deg)
        self.tangent = self.origin + (self.right * math.cos(theta) - self.down * math.sin(theta)) * 65
        self.baseline = self.origin + self.right * 75
        plane_height = max(65., float(self.xyz[:, 2].max() - self.origin[2]) + 8.)
        plane = np.array([self.origin, self.origin + self.right * self.range_ft,
                          self.origin + self.right * self.range_ft + [0, 0, plane_height],
                          self.origin + [0, 0, plane_height]])
        self._groups = {}
        arrays = []
        offset = 0
        groups = {'flight': self.xyz, 'plane': plane, 'outline': np.vstack([plane, plane[0]]),
                  'baseline': np.array([self.origin, self.baseline]),
                  'tangent': np.array([self.origin, self.tangent]), 'origin': self.origin[None, :],
                  'arc': np.array([self.origin + self.right * 48 * math.cos(a) - self.down * 48 * math.sin(a)
                                   for a in np.linspace(0, theta, 40)]),
                  'label': (self.origin + self.right * 55 - self.down * 12)[None, :]}
        for name, points in groups.items():
            arrays.append(points)
            self._groups[name] = slice(offset, offset + len(points))
            offset += len(points)
        self._all_points = np.vstack(arrays)
        initial = self._raw_project(self.xyz, 0.)
        self._initial_middle = (initial.min(axis=0) + initial.max(axis=0)) / 2
        self._frame_cache = {}

    def _raw_project(self, points: np.ndarray, u: float) -> np.ndarray:
        rotation = self.slerp(u).as_matrix()
        center = self.start_center * (1-u) + self.end_center * u
        camera = (rotation @ (np.asarray(points, dtype=float)-center).T).T
        denominator = (1-u) * camera[:, 2] + u * self.distance
        if np.any(denominator <= 1e-7):
            raise FlightPlaneUnavailable('The rotating flight crosses the camera plane.')
        focal = (1-u) * np.array([self.intrinsics[0, 0], self.intrinsics[1, 1]]) + u * self.scale * self.distance
        principal = (1-u) * self.intrinsics[:2, 2] + u * np.array([self.width / 2, self.height * .53])
        return camera[:, :2] * focal / denominator[:, None] + principal

    def project(self, points: np.ndarray, u: float) -> np.ndarray:
        """Project world feet; u=0 is exact video, u=1 is an equal-scale side view."""
        u = float(np.clip(u, 0., 1.))
        result = self._raw_project(points, u)
        if u == 0:
            return result
        bounds = self._raw_project(self.xyz, u)
        middle = (bounds.min(axis=0) + bounds.max(axis=0)) / 2
        weight = min(1., u * 3)
        target = self._initial_middle * (1-weight) + np.array([self.width / 2, self.height * .53]) * weight
        span = np.ptp(bounds, axis=0)
        fit = min(1., self.width * .80 / max(span[0], 1.), self.height * .60 / max(span[1], 1.))
        return (result-middle) * (1 + weight * (fit-1)) + target

    def frame(self, index: int, total: int) -> np.ndarray:
        """Produce an independent BGR frame. Hold, turn for four seconds, then hold."""
        t = self.duration_s * max(0, min(index, max(0, total-1))) / max(1, total-1)
        linear = float(np.clip((t-2) / 4, 0., 1.))
        u = linear * linear * (3-2*linear)
        state = 'source' if t < 1 else ('start' if u == 0 else ('end' if u == 1 else None))
        if state in self._frame_cache:
            return self._frame_cache[state].copy()
        canvas = cv2.convertScaleAbs(self.background, alpha=1-.94*min(1., u*3))
        if t >= 1:
            projected = self.project(self._all_points, u)
            if not np.isfinite(projected).all():
                raise FlightPlaneUnavailable('The rotating flight cannot be projected.')
            pixels = np.clip(projected, -100000, 100000).astype(np.int32)
            def path(name, color, thickness):
                cv2.polylines(canvas, [pixels[self._groups[name]]], False, color, thickness, cv2.LINE_AA)
            layer = canvas.copy()
            cv2.fillConvexPoly(layer, pixels[self._groups['plane']], (94, 79, 40), cv2.LINE_AA)
            cv2.addWeighted(layer, .22, canvas, .78, 0, canvas)
            path('outline', (130, 119, 78), 1)
            path('flight', (60, 211, 247), max(2, round(self.width / 425)))
            path('baseline', (172, 180, 181), 2)
            path('tangent', (236, 238, 244), 2)
            cv2.circle(canvas, tuple(pixels[self._groups['origin']][0]), max(3, round(self.width / 256)), (255, 255, 255), -1, cv2.LINE_AA)
            if u > .98:
                path('arc', (236, 238, 244), 2)
                cv2.putText(canvas, f'{self.angle_deg:.1f} deg', tuple(pixels[self._groups['label']][0]),
                            cv2.FONT_HERSHEY_SIMPLEX, max(.4, self.width / 1600), (245, 245, 245), 2, cv2.LINE_AA)
        if state:
            self._frame_cache[state] = canvas.copy()
        return canvas


def create_flight_plane_animation(package: dict, prediction: dict | None, background: np.ndarray,
                                  on_unavailable: Callable[[str], None] | None = None) -> FlightPlaneAnimation | None:
    """Omit this section if saved evidence lacks the geometry it needs."""
    try:
        animation = FlightPlaneAnimation(package, prediction or {}, background)
        # Check the moving section now so unsupported camera geometry falls back
        # before a chunk writer starts producing a partial animation.
        for u in np.linspace(0., 1., 13):
            animation.project(animation._all_points, float(u))
        return animation
    except (FlightPlaneUnavailable, ImportError, KeyError, TypeError, ValueError, np.linalg.LinAlgError) as exc:
        if on_unavailable:
            on_unavailable(str(exc))
        return None
