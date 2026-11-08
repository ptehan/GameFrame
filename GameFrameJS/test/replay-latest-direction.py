import json,sqlite3,sys,math
from pathlib import Path
import numpy as np
from scipy.optimize import least_squares
root=Path.cwd();sys.path.insert(0,str(root/'ev-predictor/synthetic'))
from direct_video_estimate import constrained_pose_from_three_landmarks
from direction_first_match import registered_origin
from match_vantage_grid import project_with_camera_pose
from baseball_flight import Hit,StartPosition,simulate_trajectory
from contact_timing import prepare_contact_observations
with sqlite3.connect('file:app.db?mode=ro',uri=True) as c:
 ident,raw,saved=c.execute('select id,observation_package_json,prediction_json from ev_hit_tracks order by id desc limit 1').fetchone()
p=json.loads(raw);old=json.loads(saved);m=p['video_metadata'];pose=constrained_pose_from_three_landmarks(p,m['width_px'],m['height_px'])
obs=prepare_contact_observations(p['ball_observations']);rows=[r for r in obs if str(r.get('source','')).upper() in ['HUMAN','MANUAL','USER','MODEL_ANCHOR'] and 0<r['relative_time_s']<=.55 and r.get('role')!='CONTACT_POINT'];contact=next(r for r in obs if r.get('role')=='CONTACT_POINT' or abs(r['relative_time_s'])<1e-6)
times=np.array([r['relative_time_s'] for r in rows]);pixels=np.array([[r['image_x'],r['image_y']] for r in rows]);origin=registered_origin(np.array([contact['image_x'],contact['image_y']]),pose,old['field_direction']['spray_angle_deg'])
def evaluate(params,spray):
 speed,launch=params
 f=simulate_trajectory(Hit(float(speed),float(launch),float(spray),batter_hand='R',estimate_spin=True),start=StartPosition(*origin))
 data=np.array([(v.t_s,v.x_ft,v.y_ft,v.z_ft) for v in f.points]);xyz=np.column_stack([np.interp(times,data[:,0],data[:,k]) for k in (1,2,3)])
 uv,_=project_with_camera_pose(xyz,pose['intrinsics'],pose['rotation'],pose['translation'])
 return f,uv
results=[]
for spray in [-16,-14,-12,-10,-8]:
 def residual(params):return (evaluate(params,spray)[1]-pixels).ravel()
 fit=least_squares(residual,[95,22],bounds=([40,0],[120,60]),diff_step=1e-3,max_nfev=80)
 f,uv=evaluate(fit.x,spray);r={'initial_spray_deg':spray,'ev_mph':float(fit.x[0]),'launch_deg':float(fit.x[1]),'distance_ft':f.distance_ft,'landing_bearing_deg':math.degrees(math.atan2(f.landing_x_ft,f.landing_y_ft)),'rmse_px':float(np.sqrt(np.mean(np.sum((uv-pixels)**2,axis=1))))};results.append(r);print(json.dumps(r),flush=True)
(root/'demo-output/latest-direction-sensitivity.json').write_text(json.dumps({'hit_id':ident,'assumptions':'Fixed marked camera and contact origin; default estimated spin; no landing-distance constraint; fit speed and launch at each fixed initial spray.','results':results},indent=2),encoding='utf-8')
