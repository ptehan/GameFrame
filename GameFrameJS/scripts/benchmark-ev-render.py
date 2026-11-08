"""Render a saved EV record without modifying the library."""
import json
import os
from pathlib import Path
import sqlite3
import sys
import time

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'ev-predictor' / 'synthetic'))
import clip_replay

label = sys.argv[1]
with sqlite3.connect((root / 'app.db').as_uri()+'?mode=ro',uri=True) as db:
    db.row_factory = sqlite3.Row
    row = (db.execute('SELECT * FROM ev_hit_tracks WHERE id=?', (int(sys.argv[2]),)).fetchone()
           if len(sys.argv) > 2 else db.execute('SELECT * FROM ev_hit_tracks ORDER BY id DESC LIMIT 1').fetchone())
package = json.loads(row['observation_package_json'])
prediction = json.loads(row['prediction_json'])
out = root / 'demo-output' / f'ev-benchmark-{label}.mp4'
start = time.perf_counter()
clip_replay.render_clip(Path(row['source_video_path']), package, prediction, out,
                       row['contact_time_s'], 1, 6,
                       [row['description'] or '', f"EV {row['best_exit_velocity_mph']:.0f} mph", f"LA {row['best_launch_angle_deg']:.0f} degrees", f"Distance {row['best_distance_ft']:.0f} feet"],
                       _background=os.environ.get('EV_BACKGROUND_RENDER')=='1')
result = {'label': label, 'seconds': time.perf_counter()-start, 'bytes': out.stat().st_size,
          'video': str(out), 'record': row['id'],
          'encoder': clip_replay.video_encoder(), 'workers': clip_replay.render_workers(clip_replay.video_encoder())}
out.with_suffix('.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
