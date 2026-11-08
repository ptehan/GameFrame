"""Independent, read-only field detection evaluation on the latest saved swing."""
import json
import sqlite3
import sys
import time
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ev-predictor/synthetic'))
from field_landmark_detect import read_frame, detect_landmarks

with sqlite3.connect('file:'+str(ROOT/'app.db')+'?mode=ro',uri=True) as conn:
    conn.row_factory=sqlite3.Row
    swing=conn.execute('SELECT id,created_at FROM swing_clips ORDER BY id DESC LIMIT 1').fetchone()
    hit=conn.execute('''SELECT e.* FROM ev_hit_tracks e JOIN ev_swing_links l ON l.ev_hit_id=e.id
                       WHERE l.swing_clip_id=? ORDER BY e.id DESC LIMIT 1''',(swing['id'],)).fetchone()
    if not hit: raise RuntimeError('Latest swing has no linked EV field marks to compare.')
    saved=json.loads(hit['observation_package_json'])

truth=saved.get('landmarks') or []
contact=[r for r in saved['ball_observations'] if r.get('role')=='CONTACT_POINT' or r.get('relative_time_s')==0]
package={key:saved[key] for key in ('camera','field','video_metadata')}
package['ball_observations']=contact
package['hit']={'contact':saved['hit']['contact']}
# No manual field landmarks, other flight points, or prior model outputs enter detection.
instant=package['hit']['contact'].get('frame_timestamp_s',package['hit']['contact']['timestamp_s'])
source=Path(package['video_metadata']['source_path'])
started=time.perf_counter()
frame,scale=read_frame(source,instant,960)
suggestions=detect_landmarks(frame,scale,package)
elapsed=time.perf_counter()-started
by_name=lambda rows:{r['landmark']:r for r in rows}
manual,auto=by_name(truth),by_name(suggestions)
xy=lambda r:np.array([r['image_x'],r['image_y']],dtype=float)
comparisons=[]
for name in ('home_plate','pitching_rubber'):
    result={'landmark':name,'detected':name in auto}
    if name in auto:
        result['estimate_kind']=auto[name].get('estimate_kind','VISIBLE_MARKING')
    if name in auto and name in manual:
        result.update(error_px=float(np.linalg.norm(xy(auto[name])-xy(manual[name]))),
                      dx_px=float(xy(auto[name])[0]-xy(manual[name])[0]),
                      dy_px=float(xy(auto[name])[1]-xy(manual[name])[1]))
    comparisons.append(result)
for side in ('first','third'):
    names=[f'{side}_baseline_{suffix}' for suffix in ('near','far')]
    result={'landmark':f'{side}_baseline','detected':all(n in auto for n in names)}
    if result['detected'] and all(n in manual for n in names):
        a,b=map(lambda n:xy(manual[n]),names);c,d=map(lambda n:xy(auto[n]),names)
        delta=b-a;direction=d-c
        distances=[abs(delta[0]*(p-a)[1]-delta[1]*(p-a)[0])/np.linalg.norm(delta) for p in (c,d)]
        angle=float(np.degrees(np.arccos(np.clip(abs(np.dot(delta,direction))/(np.linalg.norm(delta)*np.linalg.norm(direction)),0,1))))
        result.update(mean_line_error_px=float(np.mean(distances)),max_line_error_px=float(max(distances)),angle_error_deg=angle)
    comparisons.append(result)

labels={'home_plate':'Home','pitching_rubber':'Rubber','first_baseline_near':'1 near',
        'first_baseline_far':'1 far','third_baseline_near':'3 near','third_baseline_far':'3 far'}
colors=[(255,220,0),(0,165,255)] # cyan manual crosses; orange detected circles
for rows,color in zip((truth,suggestions),colors):
    mapping=by_name(rows)
    for side in ('first','third'):
        names=[f'{side}_baseline_{suffix}' for suffix in ('near','far')]
        if all(n in mapping for n in names):
            a,b=[tuple(np.round(xy(mapping[n])*scale).astype(int)) for n in names]
            cv2.line(frame,a,b,color,2,cv2.LINE_AA)
    for row in rows:
        point=tuple(np.round(xy(row)*scale).astype(int))
        if rows is truth: cv2.drawMarker(frame,point,color,cv2.MARKER_CROSS,16,2)
        else: cv2.circle(frame,point,7,color,2,cv2.LINE_AA)
        label=labels.get(row['landmark'],row['landmark'])
        if row.get('estimate_kind')=='MOUND_TOP_APPROXIMATION':label='Mound approx.'
        offset=-12 if rows is truth else 19
        cv2.putText(frame,label,(point[0]+8,point[1]+offset),cv2.FONT_HERSHEY_SIMPLEX,.45,(0,0,0),3,cv2.LINE_AA)
        cv2.putText(frame,label,(point[0]+8,point[1]+offset),cv2.FONT_HERSHEY_SIMPLEX,.45,color,1,cv2.LINE_AA)
canvas=cv2.copyMakeBorder(frame,45,0,0,0,cv2.BORDER_CONSTANT,value=(22,22,22))
cv2.putText(canvas,f'Swing #{swing["id"]} / contact {instant:.6f}s: CYAN crosses = your marks; ORANGE circles = fresh detection',
            (12,28),cv2.FONT_HERSHEY_SIMPLEX,.49,(245,245,245),1,cv2.LINE_AA)
output=ROOT/'demo-output'/f'swing-{swing["id"]}-field-comparison'
output.mkdir(parents=True,exist_ok=True)
cv2.imwrite(str(output/'comparison.png'),canvas)
report={'swing_id':swing['id'],'ev_hit_id':hit['id'],'source':str(source),'contact_frame_time_s':instant,
        'source_resolution':[package['video_metadata']['width_px'],package['video_metadata']['height_px']],
        'detection_input_keys':list(package),'manual_field_marks_withheld':True,'elapsed_s':elapsed,
        'comparisons':comparisons,'detected_marks':suggestions,'manual_marks':truth}
(output/'report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ('detected_marks','manual_marks')},indent=2))
print(str(output/'comparison.png'))
