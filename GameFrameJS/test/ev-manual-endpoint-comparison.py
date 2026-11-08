"""Compare existing matching with manual frame-10/20 scoring; no production changes."""
import json
import math
import sqlite3
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ev-predictor/synthetic'))
from direct_video_estimate import constrained_pose_from_three_landmarks
from direction_first_match import registered_origin, refine_spray_at_fixed_launch
from observation_validation import reject_early_anchor_arrivals, AUTO_SOURCES

with sqlite3.connect((ROOT / 'app.db').as_uri() + '?mode=ro', uri=True) as conn:
    hit_id, description, raw, saved = conn.execute(
        'SELECT id,description,observation_package_json,prediction_json FROM ev_hit_tracks ORDER BY id DESC LIMIT 1').fetchone()
package, prediction = json.loads(raw), json.loads(saved)
meta = package['video_metadata']
step = float(meta['frame_step_assumption_s'])
fps = round(1 / step)
offset = round(10 * fps / 30)
target_time = offset * step
observations, rejected = reject_early_anchor_arrivals(package['ball_observations'], step)
contact = next(r for r in observations if abs(r['relative_time_s']) < 1e-6)
rows = sorted((r for r in observations if 0 < r['relative_time_s'] <= .45
               and (r.get('source') != 'COMPUTER_VISION' or r.get('confidence') == 'HIGH')),
              key=lambda r:r['relative_time_s'])
manual_indices = [i for i,r in enumerate(rows) if str(r.get('source','')).upper() not in AUTO_SOURCES
                  and abs(r['relative_time_s'] - target_time) < .5 * step]
assert len(manual_indices) == 1, 'Need exactly one manual mark at frame 10 (30 fps) or 20 (60 fps).'
endpoint_index = manual_indices[0]
pose = constrained_pose_from_three_landmarks(package, meta['width_px'], meta['height_px'])
assert pose is not None
shared = prediction['direction_first_match']
seed = shared['best']
key = (shared['common_launch_angle_deg'], shared.get('spray_refinement', {}).get('initial_spray_deg', shared['common_spray_angle_deg']),
       seed['backspin_rpm'], seed['sidespin_rpm'], seed['batter_hand'], 0)
bearing = prediction['field_direction']['spray_angle_deg']
anchor = np.array([contact['image_x'], contact['image_y']])
origin = registered_origin(anchor, pose, bearing)
assert origin is not None
times = np.array([r['relative_time_s'] for r in rows])
pixels = np.array([[r['image_x'], r['image_y']] for r in rows])
speeds = sorted({r['exit_velocity_mph'] for r in shared['candidates']})
sources = [{**seed, 'exit_velocity_mph':speed} for speed in speeds]
candidates = refine_spray_at_fixed_launch(sources,key,origin,pose,times,pixels,anchor,bearing)
for c in candidates:
    errors = np.linalg.norm(np.array(c['projected_pixels']) - pixels, axis=1)
    c['manual_endpoint_error_px'] = float(errors[endpoint_index])
    c['other_points_rmse_px'] = float(np.sqrt(np.mean(np.delete(errors,endpoint_index)**2)))
current = min(candidates,key=lambda c:c['projected_path_rmse_px'])
manual = min(candidates,key=lambda c:c['manual_endpoint_error_px'])
keys = ['exit_velocity_mph','launch_angle_deg','spray_angle_deg','distance_ft',
        'projected_path_rmse_px','manual_endpoint_error_px','other_points_rmse_px']
report = {'id':hit_id,'description':description,'fps':fps,'manual_frame_offset':offset,
          'manual_time_s':float(times[endpoint_index]),'manual_mark':rows[endpoint_index],
          'automatic_points_scored_currently':len(rows)-1,'automatic_points_scored_in_test':0,
          'locked':'Existing video launch, camera, contact origin and spin. Identical speed/spray candidate grid.',
          'current':{k:current[k] for k in keys}, 'manual_only':{k:manual[k] for k in keys},
          'tested_speed_range_mph':[min(speeds),max(speeds)],
          'manual_winner_at_speed_boundary':manual['exit_velocity_mph'] in (min(speeds),max(speeds)),
          'top_manual_candidates':[{k:c[k] for k in keys} for c in sorted(candidates,key=lambda c:c['manual_endpoint_error_px'])[:8]],
          'rejected_observations':rejected}
folder = Path(tempfile.mkdtemp(prefix='gf-manual-point-test-'))
(folder / 'results.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2),flush=True)
print('Results: '+str(folder / 'results.json'),flush=True)
