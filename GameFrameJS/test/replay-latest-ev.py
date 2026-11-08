"""Read-only replay of the latest saved EV inputs; writes diagnostics to a temp folder."""
import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
with sqlite3.connect((root / 'app.db').as_uri() + '?mode=ro', uri=True) as conn:
    hit_id, description, package_json = conn.execute(
        'SELECT id,description,observation_package_json FROM ev_hit_tracks ORDER BY id DESC LIMIT 1'
    ).fetchone()
folder = Path(tempfile.mkdtemp(prefix='gf-video-angle-'))
package_file = folder / 'observations.json'
package_file.write_text(package_json, encoding='utf-8')
prediction_file = folder / 'prediction.json'
subprocess.run([sys.executable, str(root / 'ev-predictor/synthetic/direct_video_estimate.py'),
                str(package_file), '--db', str(root / 'ev-predictor/data/hittrax_from_video.sqlite'),
                '--out', str(prediction_file)], check=True)
p = json.loads(prediction_file.read_text(encoding='utf-8'))
m = p['direction_first_match']
assert m['used'], m.get('reason')
assert p['method'] == 'direction_first_shared_synthetic_match'
assert p['ev_candidates'][0]['launch_angle_deg'] == m['common_launch_angle_deg']
assert all(abs(c['landing_angle_residual_deg']) <= 10 for c in p['ev_candidates'])
if p.get('estimation_pipeline') == 'early_geometry_then_late_height':
    assert p['launch_angle_evidence']['locked_before_speed_matching']
    assert not m['early_geometry']['uses_speed']
    assert not m['early_geometry']['uses_late_points']
    assert not m['selection_policy']['late_horizontal_used']
else:
    assert not p['launch_angle_evidence']['locked_before_speed_matching']
    assert m['selection_policy']['path_slack_px'] == 2
if not m['acceptable']:
    assert not p['identifiability']['identifiable']
    assert any(w['reason'] == 'video_direction_position_mismatch' for w in p['evidence_warnings'])
    assert p['export_readiness']['confidence'] == 'LOW'
keys = ['exit_velocity_mph','launch_angle_deg','distance_ft','projected_path_rmse_px']
print(json.dumps({'id':hit_id,'description':description,
    'new':{k:p['ev_candidates'][0].get(k) for k in keys},
    'video_metadata':p['video_metadata'],
    'direction_rmse_deg':m['direction_rmse_deg'],'pixel_error':m['pixel_error'],
    'tracking_validation':p.get('tracking_validation'),
    'spray_refinement':m.get('spray_refinement'),
    'export_allowed':p['export_readiness']['allowed'],'artifacts':str(folder)},indent=2))
