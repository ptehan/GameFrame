"""Retest the user's current field request without supplying saved field marks."""
import json
import sqlite3
import sys
from pathlib import Path
import cv2
import numpy as np

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'ev-predictor/synthetic'))
from field_landmark_detect import read_frame,detect_landmarks

context=max((root/'ev-predictor/comparison_output/live').glob('field_context_*.json'),key=lambda p:p.stat().st_mtime)
package=json.loads(context.read_text())
package.pop('landmarks',None)
package['ball_observations']=[r for r in package['ball_observations'] if r.get('role')=='CONTACT_POINT' or r.get('relative_time_s')==0]
with sqlite3.connect('file:'+str(root/'app.db')+'?mode=ro',uri=True) as conn:
    row=conn.execute('SELECT source_video_path,observation_package_json FROM ev_hit_tracks WHERE source_file_name=? ORDER BY id DESC LIMIT 1',(package['video_metadata']['file_name'],)).fetchone()
source=Path(row[0]);saved=json.loads(row[1]);truth={r['landmark']:r for r in saved['landmarks']}
instant=package['hit']['contact'].get('frame_timestamp_s',package['hit']['contact']['timestamp_s'])
frame,scale=read_frame(source,instant,960)
if '--endpoint' in sys.argv:
    import urllib.request
    request=urllib.request.Request('http://127.0.0.1:8000/api/landmarks',data=json.dumps({'frame_time_s':instant,'package':package}).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=120) as response:
        rows=json.load(response)['landmarks']
else:
    rows=detect_landmarks(frame,scale,package)
rubber=next((r for r in rows if r['landmark']=='pitching_rubber'),None)
reference=truth.get('pitching_rubber')
report={'context':context.name,'manual_marks_withheld':True,'camera':package['camera']['field_xy_ft'],'suggestions':rows}
report['baseline_comparison']=[]
detected={r['landmark']:r for r in rows}
for side in ('first','third'):
    names=[side+'_baseline_'+suffix for suffix in ('near','far')]
    if not all(n in detected and n in truth for n in names):continue
    a,b=[np.array([truth[n]['image_x'],truth[n]['image_y']]) for n in names]
    c,d=[np.array([detected[n]['image_x'],detected[n]['image_y']]) for n in names]
    delta=b-a
    errors=[abs(delta[0]*(p-a)[1]-delta[1]*(p-a)[0])/np.linalg.norm(delta) for p in (c,d)]
    report['baseline_comparison'].append({'side':side,'span_px':float(np.linalg.norm(d-c)),'mean_line_error_px':float(np.mean(errors))})
if rubber and reference:
    report['rubber_error_px']=float(np.linalg.norm(np.array([rubber['image_x'],rubber['image_y']])-[reference['image_x'],reference['image_y']]))
for row in rows:
    point=tuple(np.round(np.array([row['image_x'],row['image_y']])*scale).astype(int))
    cv2.circle(frame,point,7,(0,165,255),2)
    label='Mound approx.' if row.get('estimate_kind')=='MOUND_TOP_APPROXIMATION' else row['landmark']
    cv2.putText(frame,label,(point[0]+8,point[1]-10),cv2.FONT_HERSHEY_SIMPLEX,.4,(0,165,255),1,cv2.LINE_AA)
if reference:
    point=tuple(np.round(np.array([reference['image_x'],reference['image_y']])*scale).astype(int))
    cv2.drawMarker(frame,point,(255,220,0),cv2.MARKER_CROSS,16,2)
out=root/'demo-output/current-field-correction';out.mkdir(parents=True,exist_ok=True)
(out/'report.json').write_text(json.dumps(report,indent=2));cv2.imwrite(str(out/'comparison.png'),frame)
print(json.dumps(report,indent=2))
