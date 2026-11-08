"""Read-only diagnostic: rank all directions against saved timed video points."""
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'ev-predictor' / 'synthetic'))
from direct_video_estimate import constrained_pose_from_three_landmarks, resolved_prediction_geometry
from observation_validation import reject_early_anchor_arrivals
from path_distance_match import match_path_and_distance

hit_id = int(sys.argv[1])
with closing(sqlite3.connect((root / 'app.db').as_uri() + '?mode=ro', uri=True)) as conn:
    raw, saved = conn.execute('SELECT observation_package_json,prediction_json FROM ev_hit_tracks WHERE id=?', (hit_id,)).fetchone()
package = json.loads(raw)
saved = json.loads(saved)
metadata = package.get('video_metadata') or {}
step = float(metadata.get('frame_step_assumption_s') or 1/30)
observations, rejected = reject_early_anchor_arrivals(package.get('ball_observations') or [], step)
package = {**package, 'ball_observations': observations}
geometry = resolved_prediction_geometry(package)
assert geometry['usable'], geometry
pose = constrained_pose_from_three_landmarks(package, int(metadata.get('width_px') or 1920), int(metadata.get('height_px') or 1080))
assert pose is not None
database = root / 'ev-predictor/data/hittrax_from_video.sqlite'
result = match_path_and_distance(observations, pose, geometry['direction']['spray_angle_deg'],
    database, distance_ft=None, frame_step_s=step, half_width_deg=180)
assert result['used'], result
top = result['path_only_candidates'][:5]
with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as conn:
    conn.row_factory = sqlite3.Row
    for candidate in top:
        candidate['trajectory_points'] = [dict(p) for p in conn.execute(
            'SELECT relative_time_s,x_ft,y_ft,z_ft FROM trajectory_points WHERE hit_id=? ORDER BY relative_time_s', (candidate['hit_id'],))]
output = root / 'demo-output' / f'hit-{hit_id}-unrestricted-video-fit.json'
payload = {'saved_hit_id':hit_id, 'ranking':'timed projected video RMSE, no direction filter or distance scoring',
    'camera_rmse_px':float(pose['rmse_px']), 'saved_camera_rmse_px':saved['resolved_geometry']['pose_landmark_rmse_px'],
    'saved_best':saved['direction_first_match']['best'], 'used_count':result['used_count'],
    'points':result['pixel_error']['points'], 'performance':result['performance'],
    'calibration_diagnostics':pose.get('calibration_diagnostics'), 'matches':top,
    'rejected_observations':rejected, 'acceptance_limit_px':result['pixel_error']['acceptance_limit_px']}
output.write_text(json.dumps(payload,indent=2), encoding='utf-8')
print(json.dumps({**{k:v for k,v in payload.items() if k not in ('matches','saved_best')},
    'matches':[{k:v for k,v in c.items() if k not in ('trajectory_points','projected_pixels')} for c in top],
    'output':str(output)},indent=2))
