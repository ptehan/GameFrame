from observation_validation import is_usable_flight_observation
"""Joint calibrated fit of free-flight pixels and optional landing measurements."""

import math
import numpy as np
from scipy.optimize import least_squares

from baseball_flight import Hit, StartPosition, simulate_trajectory
from match_vantage_grid import project_with_camera_pose
from direction_first_match import registered_origin


def fit_calibrated_flight(observations, pose, landing_angle_deg, distance_ft=None, distance_sigma_ft=12.0):
    rows = sorted((r for r in observations
                   if 0 < float(r.get('relative_time_s', -1)) <= 0.45
                   and r.get('role') != 'CONTACT_POINT'
                   and r.get('image_x') is not None and r.get('image_y') is not None
                   and is_usable_flight_observation(r)),
                  key=lambda r: r['relative_time_s'])
    if len(rows) < 6:
        return {'used': False, 'reason': 'need six reviewed or high-confidence free-flight points'}
    if not (pose.get('calibration_diagnostics') or {}).get('usable_for_velocity', True):
        return {'used': False, 'reason': 'camera calibration is not usable for velocity'}
    contact = next((r for r in observations if abs(float(r.get('relative_time_s', -1))) < 1e-6
                    and r.get('image_x') is not None and r.get('image_y') is not None), None)
    if contact is None:
        return {'used': False, 'reason': 'need a marked contact point'}
    origin = registered_origin([contact['image_x'], contact['image_y']], pose, landing_angle_deg)
    if origin is None:
        return {'used': False, 'reason': 'contact mark cannot be projected under this camera calibration'}
    times = np.array([r['relative_time_s'] for r in rows], dtype=float)
    pixels = np.array([[r['image_x'], r['image_y']] for r in rows], dtype=float)
    if not np.isfinite(times).all() or not np.isfinite(pixels).all() or np.ptp(times) < 0.15:
        return {'used': False, 'reason': 'insufficient finite free-flight time span'}
    sigma = np.array([max(3.0, float(r.get('uncertainty_px') or 6.0)) for r in rows])
    uses_distance = distance_ft is not None and math.isfinite(float(distance_ft)) and float(distance_ft) > 0
    lower = np.array([30.0, 1.0, -60.0])
    upper = np.array([130.0, 65.0, 60.0])

    def evaluate(params):
        trajectory = simulate_trajectory(Hit(*map(float, params[:3])),
                                         start=StartPosition(*origin))
        ts = np.array([p.t_s for p in trajectory.points])
        xyz = np.column_stack([np.interp(times, ts, [getattr(p, axis) for p in trajectory.points])
                               for axis in ('x_ft', 'y_ft', 'z_ft')])
        projected, visible = project_with_camera_pose(xyz, pose['intrinsics'], pose['rotation'], pose['translation'])
        angle = math.degrees(math.atan2(trajectory.landing_x_ft, trajectory.landing_y_ft))
        return trajectory, projected, visible, angle

    def residual(params):
        trajectory, projected, visible, angle = evaluate(params)
        # A landing bearing is not the launch bearing: the simulator includes curvature.
        angle_error = (angle - landing_angle_deg + 180.0) % 360.0 - 180.0
        constraints = [angle_error / 5.0]
        if uses_distance:
            constraints.append((trajectory.distance_ft - distance_ft) / max(1.0, distance_sigma_ft))
        return np.r_[((projected - pixels) / sigma[:, None]).ravel(),
                     np.where(visible, 0.0, 1000.0), constraints]

    fits = [least_squares(residual, [speed, 25.0, np.clip(landing_angle_deg, -59, 59)],
                          bounds=(lower, upper), max_nfev=150) for speed in (65.0, 95.0)]
    fits = [f for f in fits if f.success and np.isfinite(f.fun).all()]
    if not fits:
        return {'used': False, 'reason': 'joint flight fit did not converge'}
    best = min(fits, key=lambda f: float(np.sum(f.fun ** 2)))
    trajectory, projected, visible, angle = evaluate(best.x)
    pixel_rmse = float(np.sqrt(np.mean((projected - pixels) ** 2)))
    at_bounds = bool(np.any(np.minimum(best.x - lower, upper - best.x) < 0.01))
    candidate = {
        'hit_id': 'calibrated_joint_fit', 'score': float(np.sum(best.fun ** 2)),
        'score_policy': 'joint_pixels_and_landing' if uses_distance else 'joint_pixels_and_landing_bearing',
        'exit_velocity_mph': float(best.x[0]), 'launch_angle_deg': float(best.x[1]),
        'spray_angle_deg': float(best.x[2]), 'landing_spray_angle_deg': angle,
        'distance_ft': trajectory.distance_ft, 'hang_time_s': trajectory.hang_time_s,
        'apex_ft': trajectory.apex_ft, 'apex_time_s': trajectory.apex_time_s,
        'projected_path_rmse_px': pixel_rmse,
        'distance_score_weight': 1.0 if uses_distance else 0.0,
        'distance_z': (trajectory.distance_ft - distance_ft) / max(1.0, distance_sigma_ft) if uses_distance else 0.0,
    }
    samples = np.linspace(0, len(trajectory.points) - 1, min(90, len(trajectory.points))).astype(int)
    points = [{'relative_time_s': trajectory.points[i].t_s, 'x_ft': trajectory.points[i].x_ft,
               'y_ft': trajectory.points[i].y_ft, 'z_ft': trajectory.points[i].z_ft} for i in samples]
    return {
        'used': True, 'acceptable': bool(not at_bounds and np.all(visible) and pixel_rmse <= 5.0),
        'uses_landing_distance': bool(uses_distance), 'independently_validated': False,
        'used_count': len(rows), 'pixel_rmse': pixel_rmse, 'at_parameter_bound': at_bounds,
        'contact_origin_ft': origin.tolist(), 'landing_angle_residual_deg': angle - landing_angle_deg,
        'contact_point_excluded': True,
        'assumptions': 'fixed calibrated camera and contact registered to the clicked ray with a soft depth prior, simulator spin estimate, 5-degree landing-bearing uncertainty',
        'best': candidate, 'trajectory_points': points,
    }
