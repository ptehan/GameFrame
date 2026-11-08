"""Read-only camera zoom sensitivity replay. Never updates saved hits or exports."""
import json
import math
import sqlite3
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ev-predictor/synthetic'))
from direct_video_estimate import constrained_pose_from_three_landmarks, baseline_constraints, baseline_projection_errors, FIXED_FIELD_LANDMARKS_FT
from direction_first_match import registered_origin, refine_spray_at_fixed_launch
from observation_validation import reject_early_anchor_arrivals
from match_vantage_grid import project_with_camera_pose

with sqlite3.connect((ROOT / 'app.db').as_uri() + '?mode=ro', uri=True) as conn:
    hit_id, description, raw, saved = conn.execute(
        'SELECT id,description,observation_package_json,prediction_json FROM ev_hit_tracks ORDER BY id DESC LIMIT 1').fetchone()
package, prediction = json.loads(raw), json.loads(saved)
meta = package['video_metadata']
pose = constrained_pose_from_three_landmarks(package, meta['width_px'], meta['height_px'])
assert pose is not None
shared = prediction['direction_first_match']
best = shared['best']
key = (shared['common_launch_angle_deg'], shared.get('spray_refinement', {}).get('initial_spray_deg', shared['common_spray_angle_deg']),
       best['backspin_rpm'], best['sidespin_rpm'], best['batter_hand'], 0)
bearing = prediction['field_direction']['spray_angle_deg']
observations, rejected = reject_early_anchor_arrivals(package['ball_observations'], meta['frame_step_assumption_s'])
contact = next(r for r in observations if r['relative_time_s'] == 0)
anchor = np.array([contact['image_x'], contact['image_y']])
rows = sorted((r for r in observations if 0 < r['relative_time_s'] <= .45
               and (r.get('source') != 'COMPUTER_VISION' or r.get('confidence') == 'HIGH')),
              key=lambda r:r['relative_time_s'])
times = np.array([r['relative_time_s'] for r in rows])
pixels = np.array([[r['image_x'], r['image_y']] for r in rows])
speeds = sorted({r['exit_velocity_mph'] for r in shared['candidates']})
sources = [{**best, 'exit_velocity_mph':speed} for speed in speeds]
landmarks = [r for r in package['landmarks'] if r.get('landmark') in FIXED_FIELD_LANDMARKS_FT
             and r.get('image_x') is not None and r.get('image_y') is not None]
world = np.array([[*FIXED_FIELD_LANDMARKS_FT[r['landmark']], 0.] for r in landmarks])
marked = np.array([[r['image_x'], r['image_y']] for r in landmarks])
baselines = baseline_constraints(package)
center = pose['camera_center_ft']
start = Rotation.from_matrix(pose['rotation']).as_rotvec()

def camera_at_zoom(scale, refit):
    intrinsics = pose['intrinsics'].copy()
    intrinsics[0, 0] *= scale
    intrinsics[1, 1] *= scale
    def unpack(rotvec):
        rotation = Rotation.from_rotvec(rotvec).as_matrix()
        return {**pose, 'intrinsics':intrinsics, 'rotation':rotation, 'translation':-rotation @ center}
    def residual(rotvec):
        p = unpack(rotvec)
        uv, visible = project_with_camera_pose(world, p['intrinsics'], p['rotation'], p['translation'])
        parts = [(uv-marked).ravel(), np.where(visible, 0., 5000.)]
        for line, marks in baselines:
            uv, _ = project_with_camera_pose(line, p['intrinsics'], p['rotation'], p['translation'])
            parts.append(baseline_projection_errors(uv, marks))
        return np.concatenate(parts)
    fitted = least_squares(residual, start, max_nfev=600).x if refit else start
    return unpack(fitted)

results = []
for scale, refit in [(1.,False),(.9,True),(.95,True),(1.,True),(1.05,True),(1.1,True)]:
    p = camera_at_zoom(scale,refit)
    uv, _ = project_with_camera_pose(world,p['intrinsics'],p['rotation'],p['translation'])
    landmark_rmse = float(np.sqrt(np.mean(np.sum((uv-marked)**2,axis=1))))
    line_errors=[]
    for line, marks in baselines:
        uv, _ = project_with_camera_pose(line,p['intrinsics'],p['rotation'],p['translation'])
        line_errors.extend(baseline_projection_errors(uv,marks))
    baseline_rmse = float(np.sqrt(np.mean(np.square(line_errors)))) if line_errors else None
    origin = registered_origin(anchor,p,bearing)
    row = {'zoom_scale':scale,'orientation_refitted_from_field_only':refit,
           'horizontal_fov_deg':math.degrees(2*math.atan(meta['width_px']/(2*p['intrinsics'][0,0]))),
           'landmark_rmse_px':landmark_rmse,'baseline_rmse_px':baseline_rmse,
           'field_tolerances_met':landmark_rmse/math.sqrt(2)<=10 and (baseline_rmse is None or baseline_rmse<=5),
           'contact_origin_ft':None if origin is None else origin.tolist()}
    if origin is not None:
        candidates=refine_spray_at_fixed_launch(sources,key,origin,p,times,pixels,anchor,bearing)
        if candidates:
            b=min(candidates,key=lambda r:r['projected_path_rmse_px'])
            row.update({k:b[k] for k in ('exit_velocity_mph','launch_angle_deg','spray_angle_deg','distance_ft','projected_path_rmse_px')})
            row['candidate_count']=len(candidates)
    results.append(row)
    print(json.dumps(row),flush=True)
out = Path(tempfile.mkdtemp(prefix='gf-zoom-check-')) / 'results.json'
out.write_text(json.dumps({'id':hit_id,'description':description,
    'scope':'Diagnostic only. Fixed launch, spin, camera position and height; rotation refit to field marks only, contact origin re-registered per calibration; zoom +/-10%.',
    'rejected_observations':rejected,'results':results},indent=2),encoding='utf-8')
print('Results: '+str(out),flush=True)
