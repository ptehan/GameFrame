"""Diagnostic: recover known flight inputs with the unchanged production matcher."""
import json
import sys
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ev-predictor' / 'synthetic'))
import numpy as np
from baseball_flight import Hit, StartPosition, simulate_trajectory
from direct_video_estimate import constrained_pose_from_three_landmarks
from direction_first_match import match_direction_first, registered_origin
from match_vantage_grid import project_with_camera_pose

packet = json.loads((ROOT / 'demo-output/ev-recording-1792655034486/observations.json').read_text())
pose = constrained_pose_from_three_landmarks(packet, 1280, 720)
bearing = packet['hit']['distance_observation']['spray_angle_deg']
contact = packet['ball_observations'][0]
origin = registered_origin([contact['image_x'], contact['image_y']], pose, bearing)
results = []
with sqlite3.connect(ROOT / 'ev-predictor/data/hittrax_from_video.sqlite') as db:
    backspin, sidespin = db.execute('SELECT backspin_rpm,sidespin_rpm FROM synthetic_hits WHERE launch_angle_deg=30 AND spray_angle_deg=-5 LIMIT 1').fetchone()
for speed in (80, 100):
    flight = simulate_trajectory(Hit(speed, 30, -5, batter_hand='R', estimate_spin=False,
                                     backspin_rpm=backspin, sidespin_rpm=sidespin), start=StartPosition(*origin))
    for times in ([1/3], [i/30 for i in range(1, 11)]):
        time_axis = [p.t_s for p in flight.points]
        xyz = np.column_stack([np.interp(times, time_axis, [getattr(p, a) for p in flight.points])
                               for a in ('x_ft', 'y_ft', 'z_ft')])
        pixels, _ = project_with_camera_pose(xyz, pose['intrinsics'], pose['rotation'], pose['translation'])
        observations = [contact] + [dict(relative_time_s=t, image_x=float(p[0]), image_y=float(p[1]),
            source='HUMAN', confidence='HIGH') for t, p in zip(times, pixels)]
        match = match_direction_first(observations, pose, bearing, ROOT / 'ev-predictor/data/hittrax_from_video.sqlite')
        best = match.get('best') or {}
        result = dict(input_ev=speed, input_launch=30, input_spray=-5, input_backspin=backspin, input_sidespin=sidespin, point_count=len(times),
                      recovered_ev=best.get('exit_velocity_mph'), recovered_launch=best.get('launch_angle_deg'),
                      recovered_spray=best.get('spray_angle_deg'), rmse=best.get('projected_path_rmse_px'),
                      acceptable=match.get('acceptable'), reason=match.get('reason'))
        results.append(result)
        print(json.dumps(result), flush=True)
out = ROOT / 'demo-output/synthetic-recovery.json'
out.write_text(json.dumps(results, indent=2))
for result in results:
    assert result['recovered_ev'] == result['input_ev'], result
    assert result['recovered_launch'] == result['input_launch'], result
    assert result['recovered_spray'] == result['input_spray'], result
    assert result['rmse'] < 1e-7 and result['acceptable'], result
