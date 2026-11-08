"""Read-only saved-hit evaluation: manual field marks are withheld from detection."""
import json
import sqlite3
import sys
from pathlib import Path
import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ev-predictor/synthetic'))
from field_landmark_detect import read_frame, detect_landmarks

output=ROOT/'demo-output/field-autodetect'
output.mkdir(parents=True,exist_ok=True)
reports=[]
with sqlite3.connect('file:'+str(ROOT/'app.db')+'?mode=ro',uri=True) as conn:
    for ident in (92,91):
        row=conn.execute('SELECT observation_package_json FROM ev_hit_tracks WHERE id=?',(ident,)).fetchone()
        package=json.loads(row[0]); truth=package.pop('landmarks',[])
        package.pop('prediction',None)
        frame,scale=read_frame(Path(package['video_metadata']['source_path']),package['hit']['contact'].get('frame_timestamp_s',package['hit']['contact']['timestamp_s']),960)
        rows=detect_landmarks(frame,scale,package)
        errors=[]
        for mark in rows:
            xy=np.array([mark['image_x'],mark['image_y']])
            cv2.circle(frame,tuple((xy*scale).astype(int)),7,(0,210,255),2)
            cv2.putText(frame,mark['landmark'],tuple((xy*scale+[8,-8]).astype(int)),cv2.FONT_HERSHEY_SIMPLEX,.4,(0,210,255),1)
            reference=next((r for r in truth if r['landmark']==mark['landmark']),None)
            if reference and 'baseline' not in mark['landmark']:
                errors.append({'landmark':mark['landmark'],'error_px':float(np.linalg.norm(xy-[reference['image_x'],reference['image_y']]))})
        cv2.imwrite(str(output/f'hit-{ident}.jpg'),frame)
        reports.append({'hit':ident,'suggestions':rows,'withheld_manual_comparison':errors})
(output/'report.json').write_text(json.dumps(reports,indent=2))
print(json.dumps(reports,indent=2))
