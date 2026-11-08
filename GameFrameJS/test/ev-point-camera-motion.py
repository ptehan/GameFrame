import json,subprocess,sys
from pathlib import Path
import cv2,numpy as np
root=Path.cwd();out=root/'demo-output/ev-point-followup-83';p=json.loads((out/'raw-inputs.json').read_text());ff=root/'node_modules/ffmpeg-static/ffmpeg.exe';base=cv2.imread(str(out/'contact.png'));h,w=base.shape[:2]
# Static scenery only: trees, distant hills and fence, excluding moving players.
mask=np.zeros((h,w),np.uint8);mask[240:440,:]=255
orb=cv2.ORB_create(nfeatures=6000);kb,db=orb.detectAndCompute(cv2.cvtColor(base,cv2.COLOR_BGR2GRAY),mask)
reports=[];corrected=[]
for row in p['ball_observations']:
 t=row['relative_time_s'];frame=round(t/p['video_metadata']['frame_step_assumption_s']);dest=out/f'source-{frame}.png'
 subprocess.run([str(ff),'-v','error','-y','-ss',str(row['video_time_s']),'-i',p['video_metadata']['source_path'],'-frames:v','1',str(dest)],check=True)
 img=cv2.imread(str(dest));k,d=orb.detectAndCompute(cv2.cvtColor(img,cv2.COLOR_BGR2GRAY),mask)
 pairs=cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(d,db,k=2);good=[a for a,b in pairs if a.distance<.7*b.distance]
 src=np.float32([k[m.queryIdx].pt for m in good]);target=np.float32([kb[m.trainIdx].pt for m in good]);H,inlier=cv2.findHomography(src,target,cv2.RANSAC,2.)
 assert H is not None
 errors=np.linalg.norm(cv2.perspectiveTransform(src.reshape(-1,1,2),H).reshape(-1,2)-target,axis=1);inlier=inlier.ravel().astype(bool)
 point=cv2.perspectiveTransform(np.float32([[[row['image_x'],row['image_y']]]]),H)[0,0]
 report={'frame':frame,'matches':len(good),'inliers':int(inlier.sum()),'background_median_error_px':float(np.median(errors[inlier])),'background_p95_error_px':float(np.percentile(errors[inlier],95)),'raw_ball_px':[row['image_x'],row['image_y']],'stabilized_ball_px':point.tolist(),'image_shift_px':(point-np.array([row['image_x'],row['image_y']])).tolist(),'homography':H.tolist()};reports.append(report);print(json.dumps(report),flush=True)
 corrected.append({**row,'image_x':float(point[0]),'image_y':float(point[1])})
p['ball_observations']=corrected
(out/'stabilized-raw-inputs.json').write_text(json.dumps(p),encoding='utf-8');(out/'camera-motion.json').write_text(json.dumps(reports,indent=2),encoding='utf-8')
