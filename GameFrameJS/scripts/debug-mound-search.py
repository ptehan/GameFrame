import json,sqlite3,sys
from pathlib import Path
import cv2,numpy as np
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'ev-predictor/synthetic'))
import field_landmark_detect as detector
with sqlite3.connect('file:'+str(root/'app.db')+'?mode=ro',uri=True) as conn:
    source,raw=conn.execute('SELECT source_video_path,observation_package_json FROM ev_hit_tracks ORDER BY id DESC LIMIT 1').fetchone()
package=json.loads(raw);package.pop('landmarks',None)
package['ball_observations']=[r for r in package['ball_observations'] if r.get('role')=='CONTACT_POINT']
frame,scale=detector.read_frame(Path(source),package['hit']['contact']['frame_timestamp_s'],960)
original=detector.find_mound_top
def debug(hsv,predicted,home):
    h,w=hsv.shape[:2];print('PRIOR',json.dumps({'predicted':predicted.tolist(),'home':home.tolist(),'scale':scale}))
    mask=(((hsv[:,:,0]<30)|(hsv[:,:,0]>165))&(hsv[:,:,1]>45)&(hsv[:,:,2]>40)).astype(np.uint8)
    mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((3,7),np.uint8))
    out=root/'demo-output/mound-debug';out.mkdir(parents=True,exist_ok=True)
    for size in (1,3,5,7,9):
        current=mask if size==1 else cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((size,3),np.uint8))
        rows=detector.component_rows(current,15,int(w*h*.5))
        nearby=[c for c in rows if abs(c['x']-predicted[0])<w*.3 and abs(c['y']-predicted[1])<h*.2]
        nearby.sort(key=lambda c:np.linalg.norm(np.array([c['x'],c['y']])-predicted))
        print('MASK',size,json.dumps(nearby[:14]))
        cv2.imwrite(str(out/f'mask-{size}.png'),current*255)
    return original(hsv,predicted,home)
detector.find_mound_top=debug
print('RESULT',json.dumps(detector.detect_landmarks(frame,scale,package)))
