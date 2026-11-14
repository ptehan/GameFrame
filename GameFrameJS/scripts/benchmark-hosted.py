"""Measure local EV matching and software rendering without changing library data.

These measurements are not a substitute for benchmarking the Render instance.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import sqlite3
import sys
import time

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'ev-predictor' / 'synthetic'))
parser = argparse.ArgumentParser()
parser.add_argument('--database', type=Path, default=root / 'app.db')
parser.add_argument('--flight-database', type=Path, default=root / 'ev-predictor/data/hittrax_from_video.sqlite')
parser.add_argument('--output', type=Path, default=root / 'release-artifacts/benchmark')
parser.add_argument('--hit', type=int)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
os.environ.setdefault('EV_VIDEO_ENCODER', 'libx264')
os.environ.setdefault('EV_RENDER_WORKERS', '1')
os.environ.setdefault('EV_ENCODER_THREADS', '1')
with sqlite3.connect(args.database.resolve().as_uri() + '?mode=ro', uri=True) as db:
    db.row_factory = sqlite3.Row
    row = db.execute('SELECT * FROM ev_hit_tracks WHERE id=?', (args.hit,)).fetchone() if args.hit else db.execute('SELECT * FROM ev_hit_tracks ORDER BY id DESC LIMIT 1').fetchone()
    if row is None:
        raise RuntimeError('A saved EV example is required')
    row = dict(row)
package = json.loads(row['observation_package_json'])
saved_prediction = json.loads(row['prediction_json'] or '{}')
package_file = args.output / 'input.json'
package_file.write_text(json.dumps(package), encoding='utf-8')
from direct_video_estimate import main as estimate
measurements = []
for label in ['first', 'warm']:
    output = args.output / f'prediction-{label}.json'
    wall, cpu = time.perf_counter(), time.process_time()
    estimate([str(package_file), '--db', str(args.flight_database), '--out', str(output)])
    result = json.loads(output.read_text(encoding='utf-8'))
    measurements.append({'kind': f'ev-{label}', 'wall_seconds': time.perf_counter()-wall,
                         'cpu_seconds': time.process_time()-cpu,
                         'candidate_count': len(result.get('ev_candidates') or [])})
source = Path(row.get('source_video_path') or '')
contact = row['contact_time_s']
if not source.is_file():
    source = args.output / 'saved-source.mp4'
    source.write_bytes(row['clip_blob'])
    contact -= row.get('clip_start_time_s') or 0
from clip_replay import render_clip
wall = time.perf_counter()
video = args.output / 'ev-software-render.mp4'
render_clip(source, copy.deepcopy(package), saved_prediction, video, contact, 1, 6,
            ['GameFrame local release benchmark'], max_width=1280, _encoder='libx264')
measurements.append({'kind': 'ev-software-render', 'wall_seconds': time.perf_counter()-wall, 'bytes': video.stat().st_size})
report = {'environment': 'local workstation; production cost gate remains pending',
          'python': sys.version, 'record_id': row['id'], 'measurements': measurements}
(args.output / 'measurements.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
