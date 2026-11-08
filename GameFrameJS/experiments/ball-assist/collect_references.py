"""Evaluation-only labels. Read raw manual marks; never read prediction_json."""
import json,sqlite3,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2];output=root/'demo-output/ball-assist-lab/references.json'
latest='--latest' in sys.argv
if latest:output=output.with_name('latest-reference.json')
selected=next((int(a.split('=',1)[1]) for a in sys.argv if a.startswith('--hit=')),None)
if selected is not None:output=output.with_name('selected-reference.json')
extra=next((int(a.split('=',1)[1]) for a in sys.argv if a.startswith('--extra=')),None)
named=next((a.split('=',1)[1] for a in sys.argv if a.startswith('--output=')),None)
if named:output=output.with_name(named)
with sqlite3.connect((root/'app.db').as_uri()+'?mode=ro',uri=True) as db:
 rows=db.execute('SELECT id,observation_package_json FROM ev_hit_tracks WHERE id=?',(selected,)).fetchall() if selected is not None else db.execute('SELECT id,observation_package_json FROM ev_hit_tracks ORDER BY id DESC LIMIT 1' if latest else 'SELECT id,observation_package_json FROM ev_hit_tracks WHERE id IN (85,86)').fetchall()
 extra_row=db.execute('SELECT observation_package_json FROM ev_hit_tracks WHERE id=?',(extra,)).fetchone() if extra is not None else None
references=[]
for hit_id,raw in rows:
 package=json.loads(raw);meta=package['video_metadata'];contact=package['hit']['contact']['timestamp_s']
 points=[{'time_s':float(row.get('video_time_s',contact+row['relative_time_s'])),'relative_s':row['relative_time_s'],'x':row['image_x'],'y':row['image_y']} for row in package.get('ball_observations',[]) if str(row.get('source','')).upper() in {'HUMAN','MANUAL','USER'}]
 if extra_row:
  other=json.loads(extra_row[0]);other_meta=other['video_metadata']
  if Path(other_meta['source_path']).resolve()!=Path(meta['source_path']).resolve():raise ValueError('Additional labels must refer to the identical source video.')
  for row in other.get('ball_observations',[]):
   if row['relative_time_s']<=0 or str(row.get('source','')).upper() not in {'HUMAN','MANUAL','USER'}:continue
   timestamp=float(row.get('video_time_s',other['hit']['contact']['timestamp_s']+row['relative_time_s']))
   points.append({'time_s':timestamp,'relative_s':timestamp-contact,'x':row['image_x']*meta['width_px']/other_meta['width_px'],'y':row['image_y']*meta['height_px']/other_meta['height_px'],'label_from_hit_id':extra})
 example={'1000053313.mp4':'earlier','Adam 7_10-11_26.mp4':'recent','InShot_20260704_065621235.mp4':'night'}.get(Path(meta['source_path']).name)
 if not example:raise ValueError('This source video is not registered as a lab example.')
 references.append({'hit_id':hit_id,'example':example,'video':meta['source_path'],'width':meta['width_px'],'height':meta['height_px'],'contact':contact,'manual_points':points})
output.parent.mkdir(exist_ok=True,parents=True);output.write_text(json.dumps(references,indent=2),encoding='utf-8');print(json.dumps({'references':str(output),'raw_only':True,'recordings':len(references)}))
