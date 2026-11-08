"""Evaluate fresh field proposals against withheld marks on the latest saved hit."""
import json
import sqlite3
import sys
from pathlib import Path
import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ev-predictor/synthetic'))
from field_landmark_detect import read_frame,detect_landmarks

with sqlite3.connect('file:'+str(ROOT/'app.db')+'?mode=ro',uri=True) as conn:
    conn.row_factory=sqlite3.Row
    query='SELECT id,source_file_name,source_video_path,observation_package_json FROM ev_hit_tracks'
    hit=conn.execute(query+' WHERE id=?',(int(sys.argv[1]),)).fetchone() if len(sys.argv)>1 else conn.execute(query+' ORDER BY id DESC LIMIT 1').fetchone()
saved=json.loads(hit['observation_package_json'])
truth={row['landmark']:row for row in saved.get('landmarks',[])}
package={key:saved[key] for key in ('camera','field','video_metadata')}
package['hit']={'contact':saved['hit']['contact']}
package['ball_observations']=[row for row in saved['ball_observations'] if row.get('role')=='CONTACT_POINT' or row.get('relative_time_s')==0]
time=saved['hit']['contact'].get('frame_timestamp_s',saved['hit']['contact']['timestamp_s'])
frame,scale=read_frame(Path(hit['source_video_path']),time,960)
rows=detect_landmarks(frame,scale,package);detected={r['landmark']:r for r in rows}
xy=lambda row:np.array([row['image_x'],row['image_y']],float)
report={'hit_id':hit['id'],'file':hit['source_file_name'],'contact_time_s':time,'manual_field_marks_withheld':True,'image_size':[saved['video_metadata']['width_px'],saved['video_metadata']['height_px']],'baselines':[],'suggestions':rows}
for side in ('first','third'):
    names=[side+'_baseline_'+suffix for suffix in ('near','far')]
    result={'side':side,'found':all(name in detected for name in names)}
    if result['found']:
        a,b=[xy(truth[name]) for name in names];c,d=[xy(detected[name]) for name in names]
        v=b-a;u=d-c;span=float(np.linalg.norm(u))
        distances=[abs(v[0]*(p-a)[1]-v[1]*(p-a)[0])/np.linalg.norm(v) for p in (c,d)]
        angle=float(np.degrees(np.arccos(np.clip(abs(v@u)/(np.linalg.norm(v)*span),0,1))))
        result.update(spacing_px=span,spacing_percent_width=100*span/saved['video_metadata']['width_px'],mean_perpendicular_error_px=float(np.mean(distances)),angle_difference_deg=angle)
        cv2.line(frame,tuple(np.round(c*scale).astype(int)),tuple(np.round(d*scale).astype(int)),(0,165,255),2,cv2.LINE_AA)
    report['baselines'].append(result)
report['mound']={'found':'pitching_rubber' in detected}
if report['mound']['found']:
    delta=xy(detected['pitching_rubber'])-xy(truth['pitching_rubber'])
    report['mound'].update(error_px=float(np.linalg.norm(delta)),dx_px=float(delta[0]),dy_px=float(delta[1]),kind=detected['pitching_rubber'].get('estimate_kind','VISIBLE_MARKING'))
for row in rows:
    p=tuple(np.round(xy(row)*scale).astype(int));cv2.circle(frame,p,7,(0,165,255),2)
    label={'home_plate':'Home','pitching_rubber':'Mound'}.get(row['landmark'],row['landmark'].replace('_baseline_',' '))
    cv2.putText(frame,label,(p[0]+8,p[1]-10),cv2.FONT_HERSHEY_SIMPLEX,.45,(0,165,255),1,cv2.LINE_AA)
if 'pitching_rubber' in truth:
    p=tuple(np.round(xy(truth['pitching_rubber'])*scale).astype(int));cv2.drawMarker(frame,p,(255,220,0),cv2.MARKER_CROSS,16,2)
    cv2.putText(frame,'Your mound mark',(p[0]+8,p[1]+18),cv2.FONT_HERSHEY_SIMPLEX,.45,(255,220,0),1,cv2.LINE_AA)
output=ROOT/'demo-output'/f'hit-{hit["id"]}-field-test';output.mkdir(parents=True,exist_ok=True)
cv2.imwrite(str(output/'comparison.png'),frame);(output/'report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({key:value for key,value in report.items() if key!='suggestions'},indent=2))
