"""Replace only a saved EV export's closing card, preserving its estimate and source."""
import argparse
import json
from pathlib import Path
import sqlite3
import subprocess
import sys

import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ev-predictor' / 'synthetic'))
from clip_replay import draw_end_card

parser = argparse.ArgumentParser()
parser.add_argument('id', type=int)
args = parser.parse_args()
conn = sqlite3.connect(ROOT / 'app.db')
conn.row_factory = sqlite3.Row
row = conn.execute('SELECT * FROM ev_hit_tracks WHERE id=?', (args.id,)).fetchone()
if not row or not row['generated_clip_blob']:
    raise SystemExit('Saved EV export not found')
folder = ROOT / 'tmp_inspect' / f'ev-{args.id}-closing-repair'
folder.mkdir(parents=True, exist_ok=True)
backup = folder / 'original.mp4'
if backup.exists():
    raise SystemExit('Backup already exists; refusing to overwrite it')
backup.write_bytes(row['generated_clip_blob'])
cap = cv2.VideoCapture(str(backup))
fps = cap.get(cv2.CAP_PROP_FPS)
frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
cap.release()
source = cv2.VideoCapture(row['source_video_path'])
source.set(cv2.CAP_PROP_POS_MSEC, row['contact_time_s'] * 1000)
ok, frame = source.read()
source.release()
if not ok:
    raise SystemExit('Source contact frame unavailable')
frame = cv2.resize(frame, (width,height))
lines = [row['description'] or '', f"EV {row['best_exit_velocity_mph']:.0f} mph",
         f"LA {row['best_launch_angle_deg']:.0f} deg", f"DISTANCE {row['best_distance_ft']:.0f} ft"]
card = draw_end_card(frame, lines, [], json.loads(row['prediction_json']))
png = folder / 'closing.png'
cv2.imwrite(str(png), card)
output = folder / 'repaired.mp4'
subprocess.run(['ffmpeg','-y','-v','error','-i',str(backup),'-i',str(png),
    '-filter_complex',f"[0:v][1:v]overlay=enable='gte(n,{frames-round(2.4*fps)})':eof_action=repeat[v]",
    '-map','[v]','-map','0:a?','-c:v','libx264','-preset','veryfast','-crf','18','-c:a','copy',
    '-movflags','+faststart',str(output)], check=True)
check = cv2.VideoCapture(str(output))
assert int(check.get(cv2.CAP_PROP_FRAME_COUNT)) == frames, 'Export frame count changed'
check.release()
with conn:
    conn.execute('UPDATE ev_hit_tracks SET generated_clip_blob=?,generated_clip_path=? WHERE id=?',
                 (output.read_bytes(),str(output),args.id))
conn.close()
print(json.dumps({'id':args.id,'backup':str(backup),'preview':str(png),'output':str(output),'frames':frames}))
