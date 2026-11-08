"""Read-only check of a proposed flight against the latest live observation package."""
import copy
import json
import math
import sys
from pathlib import Path

import numpy as np

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'ev-predictor/synthetic'))
from baseball_flight import Hit, StartPosition, simulate_trajectory
from direct_video_estimate import constrained_pose_from_three_landmarks, resolved_prediction_geometry
from direction_first_match import home_plate_contact
from match_vantage_grid import project_with_camera_pose

source = max((root / 'ev-predictor/comparison_output/live').glob('observation_package_*.json'),
             key=lambda path: path.stat().st_mtime)
package = json.loads(source.read_text(encoding='utf-8'))
meta = package['video_metadata']
rows = [row for row in package['ball_observations']
        if str(row.get('source', '')).upper() in {'HUMAN', 'MANUAL', 'USER'}]
contact = next(row for row in rows if abs(row['relative_time_s']) < 1e-6)
flight_rows = [row for row in rows if 0 < row['relative_time_s'] <= .45]
times = np.array([row['relative_time_s'] for row in flight_rows])
pixels = np.array([[row['image_x'], row['image_y']] for row in flight_rows])
distance = package['hit'].get('distance_observation') or {}
bearing = resolved_prediction_geometry(package)['direction']['spray_angle_deg']
terminal = package.get('terminal_event') or {}
results = []
legacy = None
for height in [6, 10, 11, 12]:
    trial = copy.deepcopy(package)
    trial['camera']['height_ft'] = height
    pose = constrained_pose_from_three_landmarks(trial, meta['width_px'], meta['height_px'])
    if pose is None:
        results.append({'camera_height_ft': height, 'pose_available': False})
        continue
    if height == 6:
        rotation = np.asarray(pose['rotation'])
        center = -rotation.T @ np.asarray(pose['translation'])
        ray = rotation.T @ np.linalg.solve(pose['intrinsics'], [contact['image_x'], contact['image_y'], 1.])
        normal = np.array([math.cos(math.radians(-30)), -math.sin(math.radians(-30)), 0.])
        old_origin = center - float(normal @ center) / float(normal @ ray) * ray
        old_flight = simulate_trajectory(Hit(86, 19, -30))
        old_samples = np.array([(point.t_s, point.x_ft, point.y_ft, point.z_ft) for point in old_flight.points])
        old_xyz = np.column_stack([np.interp(times, old_samples[:,0], old_samples[:,axis]) for axis in (1,2,3)])
        old_xyz += old_origin - old_samples[0,1:]
        old_uv, _ = project_with_camera_pose(old_xyz, pose['intrinsics'], pose['rotation'], pose['translation'])
        legacy = {'contact_origin_ft': old_origin.tolist(), 'distance_ft': old_flight.distance_ft,
                  'hang_time_s': old_flight.hang_time_s,
                  'path_rmse_px': float(np.sqrt(np.mean(np.sum((old_uv-pixels)**2, axis=1))))}
    origin, contact_error = home_plate_contact([contact['image_x'], contact['image_y']], pose)
    flight = simulate_trajectory(Hit(86, 19, -30), start=StartPosition(*origin))
    samples = np.array([(point.t_s, point.x_ft, point.y_ft, point.z_ft) for point in flight.points])
    xyz = np.column_stack([np.interp(times, samples[:, 0], samples[:, axis]) for axis in (1, 2, 3)])
    projected, visible = project_with_camera_pose(xyz, pose['intrinsics'], pose['rotation'], pose['translation'])
    landing_bearing = math.degrees(math.atan2(flight.landing_x_ft, flight.landing_y_ft))
    diagnostics = pose.get('calibration_diagnostics') or {}
    results.append({
        'camera_height_ft': height, 'calibration_usable': diagnostics.get('usable_for_velocity'),
        'landmark_rmse_px': pose['rmse_px'], 'baseline_rmse_px': diagnostics.get('baseline_rmse_px'),
        'contact_origin_ft': origin.tolist(), 'contact_error_px': contact_error,
        'candidate': {'exit_velocity_mph': 86, 'launch_angle_deg': 19, 'spray_angle_deg': -30},
        'distance_ft': flight.distance_ft, 'hang_time_s': flight.hang_time_s,
        'hang_error_s': abs(flight.hang_time_s - terminal['relative_time_s']) if terminal.get('relative_time_s') else None,
        'landing_bearing_deg': landing_bearing, 'landing_bearing_error_deg': (landing_bearing-bearing+180)%360-180,
        'path_rmse_px': float(np.sqrt(np.mean(np.sum((projected-pixels)**2, axis=1)))),
        'observed_pixels': pixels.tolist(), 'projected_pixels': projected.tolist(),
    })
print(json.dumps({'package_path': str(source), 'camera_height_ft': package.get('camera',{}).get('height_ft'),
                  'distance': {k:v for k,v in distance.items() if k!='actual_field_map'},
                  'terminal': terminal, 'manual_observations': rows, 'old_worker_candidate_projection': legacy,
                  'height_comparison': results}, indent=2))
