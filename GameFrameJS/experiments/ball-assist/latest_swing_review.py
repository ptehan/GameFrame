"""Post-inference visual checks. Labels are never inputs to the detector."""
import json,math,sys
from pathlib import Path
import cv2,numpy as np
root=Path(__file__).resolve().parents[2];out=root/'demo-output/ball-assist-lab'
report_file=sys.argv[1] if len(sys.argv)>1 else 'latest-swing-test.json';prefix=sys.argv[2] if len(sys.argv)>2 else 'latest-swing'
report=json.loads((out/report_file).read_text(encoding='utf-8-sig'));row=report['rows'][0] if 'rows' in report else {**report,'held_out':[]};folder=out/row['session']
session=json.loads((folder/'session.json').read_text())
if 'rows' in report:
 result_file=folder/(row['job']+'-contact-result.json') if row.get('job') else next(folder.glob('*-contact-result.json'));result=json.loads(result_file.read_text())
else:result={'points':report['points']}
points={p['frame']:p for p in result['points']};files=sorted((folder/'frames').glob('frame-*.jpg'))
def label(image,text,x,y,color=(230,230,230),size=.5):cv2.putText(image,text,(x,y),cv2.FONT_HERSHEY_SIMPLEX,size,color,1,cv2.LINE_AA)
def crop(frame,x,y,width=360,height=240):
 image=cv2.imread(str(files[frame]));padded=cv2.copyMakeBorder(image,60,60,90,90,cv2.BORDER_CONSTANT,value=(12,12,12));patch=cv2.getRectSubPix(padded,(90,60),(float(x)+90,float(y)+60));return cv2.resize(patch,(width,height),interpolation=cv2.INTER_NEAREST)
checks=row['held_out'];sheet=np.full((690,1140,3),24,np.uint8);label(sheet,session['name']+' - held-out manual marks',18,28,size=.7);label(sheet,'Yellow: your saved point. Cyan: fresh detection. Crops enlarged 4x.',18,53)
for i,q in enumerate(checks):
 x=10+(i%3)*380;y=75+(i//3)*300;image=crop(q['frame'],q['x'],q['y']);cx=180;cy=120
 cv2.drawMarker(image,(cx,cy),(0,220,255),cv2.MARKER_CROSS,19,1)
 p=points.get(q['frame'])
 if p:cv2.circle(image,(round(cx+(p['x']-q['x'])*4),round(cy+(p['y']-q['y'])*4)),8,(255,230,0),1)
 sheet[y:y+240,x:x+360]=image
 error=f"{q['error_source_px']:.2f} px" if p else 'No detection'
 label(sheet,f"{session['times'][q['frame']]:.3f} s | {error}",x,y+264)
cv2.imwrite(str(out/(prefix+'-manual-comparison.png')),sheet)
cols=7;tile_w=180;tile_h=150;flight=np.full((70+math.ceil(len(points)/cols)*tile_h,cols*tile_w,3),24,np.uint8);label(flight,'Every proposed point - cyan ring, 2x enlargement',12,28,size=.6)
for i,p in enumerate(points.values()):
 x=(i%cols)*tile_w;y=50+(i//cols)*tile_h;image=crop(p['frame'],p['x'],p['y'],180,120);cv2.circle(image,(90,60),7,(255,230,0),1);flight[y:y+120,x:x+180]=image;label(flight,f"{session['times'][p['frame']]:.3f}s",x+4,y+140)
cv2.imwrite(str(out/(prefix+'-all-detections.png')),flight)
print(json.dumps({'points':len(points),'first_s':session['times'][min(points)] if points else None,'last_s':session['times'][max(points)] if points else None,'review_images':2}))
