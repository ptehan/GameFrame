"""Read-only diagnostic search; never treats invalid camera calibration as accepted."""
import json
import math
import sqlite3
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root/'ev-predictor/synthetic'))
from baseball_flight import Hit, StartPosition, simulate_trajectory
from direct_video_estimate import constrained_pose_from_three_landmarks, resolved_prediction_geometry
from direction_first_match import home_plate_contact
from match_vantage_grid import project_with_camera_pose

source = max((root/'ev-predictor/comparison_output/live').glob('observation_package_*.json'), key=lambda p:p.stat().st_mtime)
p = json.loads(source.read_text(encoding='utf-8'))
metadata = p['video_metadata']
distance = p['hit']['distance_observation']['distance_ft']
distance_tolerance = p['hit']['distance_observation'].get('uncertainty_ft',10)
hang = p['terminal_event']['relative_time_s']
hang_tolerance = max(metadata['frame_step_assumption_s'],p['terminal_event'].get('timing_uncertainty_s',0))
bearing = resolved_prediction_geometry(p)['direction']['spray_angle_deg']
rows = [r for r in p['ball_observations'] if r.get('source') in {'HUMAN','MANUAL','USER'}]
anchor = next(r for r in rows if abs(r['relative_time_s'])<1e-6)
observed = [r for r in rows if 0<r['relative_time_s']<=.45]
times = np.array([r['relative_time_s'] for r in observed])
pixels = np.array([[r['image_x'],r['image_y']] for r in observed])
pose = constrained_pose_from_three_landmarks(p,metadata['width_px'],metadata['height_px'])
origin, contact_error = home_plate_contact([anchor['image_x'],anchor['image_y']],pose)

def evaluate(params):
    speed, launch, spray = map(float,params)
    flight = simulate_trajectory(Hit(speed,launch,spray),start=StartPosition(*origin))
    samples = np.array([(q.t_s,q.x_ft,q.y_ft,q.z_ft) for q in flight.points])
    xyz = np.column_stack([np.interp(times,samples[:,0],samples[:,axis]) for axis in (1,2,3)])
    uv,visible = project_with_camera_pose(xyz,pose['intrinsics'],pose['rotation'],pose['translation'])
    direction = math.degrees(math.atan2(flight.landing_x_ft,flight.landing_y_ft))
    row = dict(exit_velocity_mph=speed,launch_angle_deg=launch,spray_angle_deg=spray,
        distance_ft=flight.distance_ft,hang_time_s=flight.hang_time_s,
        distance_error_ft=flight.distance_ft-distance,hang_error_s=flight.hang_time_s-hang,
        landing_bearing_error_deg=(direction-bearing+180)%360-180,
        video_rmse_px=float(np.sqrt(np.mean(np.sum((uv-pixels)**2,axis=1)))),projected_pixels=uv.tolist())
    row['physical_constraints_pass'] = (abs(row['distance_error_ft'])<=distance_tolerance and
        abs(row['hang_error_s'])<=hang_tolerance and abs(row['landing_bearing_error_deg'])<=6)
    return row,uv

with sqlite3.connect((root/'ev-predictor/data/hittrax_from_video.sqlite').as_uri()+'?mode=ro',uri=True) as c:
    seeds = c.execute('''SELECT DISTINCT exit_velocity_mph,launch_angle_deg,spray_angle_deg
        FROM synthetic_hits WHERE distance_ft BETWEEN ? AND ? AND hang_time_s BETWEEN ? AND ?
        AND landing_spray_angle_deg BETWEEN ? AND ?''',
        (distance-35,distance+35,hang-.2,hang+.2,bearing-10,bearing+10)).fetchall()
results = [evaluate(seed)[0] for seed in seeds]
def cost(row):
    return (row['video_rmse_px']/12)**2+(row['distance_error_ft']/distance_tolerance)**2+(row['hang_error_s']/hang_tolerance)**2+(row['landing_bearing_error_deg']/6)**2
selected = []
for row in sorted(results,key=cost):
    if all(abs(row['exit_velocity_mph']-s['exit_velocity_mph'])>=3 or abs(row['launch_angle_deg']-s['launch_angle_deg'])>=2 or abs(row['spray_angle_deg']-s['spray_angle_deg'])>=3 for s in selected):
        selected.append(row)
    if len(selected)==5:break
def residual(params):
    row,uv = evaluate(params)
    return np.r_[((uv-pixels)/12).ravel(),row['distance_error_ft']/distance_tolerance,
        row['hang_error_s']/hang_tolerance,max(0,abs(row['landing_bearing_error_deg'])-6)]
for seed in selected:
    initial = [seed[k] for k in ('exit_velocity_mph','launch_angle_deg','spray_angle_deg')]
    fit = least_squares(residual,initial,bounds=([40,3,-60],[120,60,10]),diff_step=.003,max_nfev=55)
    results.append(evaluate(fit.x)[0])
physical = sorted((r for r in results if r['physical_constraints_pass']),key=lambda r:r['video_rmse_px'])
best = []
for row in physical:
    if all(abs(row['exit_velocity_mph']-s['exit_velocity_mph'])>=1 or abs(row['launch_angle_deg']-s['launch_angle_deg'])>=1 or abs(row['spray_angle_deg']-s['spray_angle_deg'])>=2 for s in best):
        best.append(row)
    if len(best)==5:break
output = dict(package_path=str(source),camera_height_ft=p['camera']['height_ft'],
    target_distance_ft=distance,target_hang_time_s=hang,hang_tolerance_s=hang_tolerance,
    contact_origin_ft=origin.tolist(),contact_error_px=contact_error,
    calibration=pose.get('calibration_diagnostics'),searched=len(results),
    best_distance_and_hang_matches=best,best_compromise=sorted(results,key=cost)[:3],
    proposed_86_19_minus30=evaluate([86,19,-30])[0])
out = root/'demo-output/latest-ev-match-search.json'
out.write_text(json.dumps(output,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in output.items() if k!='calibration'},indent=2))
