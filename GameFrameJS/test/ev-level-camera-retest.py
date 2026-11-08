"""Fresh forward-simulation test: later marks supply vertical image position only."""
import json,math,sqlite3,sys,time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
import numpy as np
from scipy.optimize import least_squares
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'ev-predictor/synthetic'))
from direct_video_estimate import constrained_pose_from_three_landmarks
from direction_first_match import registered_origin
from contact_timing import prepare_contact_observations
from baseball_flight import Hit,StartPosition,simulate_trajectory
from match_vantage_grid import project_with_camera_pose
with sqlite3.connect((ROOT/'app.db').as_uri()+'?mode=ro',uri=True) as conn:
 ident,raw=conn.execute('SELECT id,observation_package_json FROM ev_hit_tracks ORDER BY id DESC LIMIT 1').fetchone()
p=json.loads(raw);meta=p['video_metadata'];step=meta['frame_step_assumption_s'];d=p['hit']['distance_observation'];bearing=d['spray_angle_deg'];target=d['distance_ft'];sigma=d['uncertainty_ft']
pose=constrained_pose_from_three_landmarks(p,meta['width_px'],meta['height_px'])
rows=prepare_contact_observations(p['ball_observations']);contact=next(r for r in rows if abs(r['relative_time_s'])<1e-6)
rows=[r for r in rows if r['relative_time_s']>0 and str(r.get('source','')).upper() in ['HUMAN','MANUAL','USER','MODEL_ANCHOR']]
times=np.array([r['relative_time_s'] for r in rows]);pixels=np.array([[r['image_x'],r['image_y']] for r in rows]);origin=registered_origin(np.array([contact['image_x'],contact['image_y']]),pose,bearing)
OUT=ROOT/f'demo-output/level-camera-retest-{ident}';OUT.mkdir(parents=True,exist_ok=True);(OUT/'raw-inputs.json').write_text(raw,encoding='utf-8')
def simulate(v):
 speed,launch,spray=map(float,v);f=simulate_trajectory(Hit(speed,launch,spray,batter_hand='R',estimate_spin=True),start=StartPosition(*origin))
 a=np.array([[r.t_s,r.x_ft,r.y_ft,r.z_ft] for r in f.points]);xyz=np.column_stack([np.interp(times,a[:,0],a[:,k]) for k in (1,2,3)]);uv,_=project_with_camera_pose(xyz,pose['intrinsics'],pose['rotation'],pose['translation'])
 return f,uv
cases=[]
for model in ['all_xy','early20_late_y','early10_late_y']:
 for use_distance in [True,False]:cases.append(dict(name=f'{model}_'+('distance' if use_distance else 'no_distance'),model=model,distance=target if use_distance else None))
for delta in [-10,10]:cases.append(dict(name=f'early20_distance_{delta:+}',model='early20_late_y',distance=target+delta))
for delta in [-2,2]:cases.append(dict(name=f'early20_late_y_{delta:+}px',model='early20_late_y',distance=target,late_y_delta=delta))
for use_distance in [True,False]:cases.append(dict(name='fixed100_'+('distance' if use_distance else 'no_distance'),model='early20_late_y',distance=target if use_distance else None,fixed_speed=100.))
def run(c):
 observed=pixels.copy();observed[-1,1]+=c.get('late_y_delta',0)
 if c['model']=='all_xy':early=np.ones(len(times),bool)
 else:early=times<=((20 if c['model']=='early20_late_y' else 10)*step+step*.5)
 def unpack(v):return np.r_[c['fixed_speed'],v] if 'fixed_speed' in c else v
 cache={}
 def evaluate(v):
  key=tuple(v)
  if key not in cache:cache[key]=simulate(unpack(v))
  return cache[key]
 def residual(v):
  f,uv=evaluate(v);delta=uv-observed
  components=np.r_[delta[early].ravel(),delta[~early,1]]/(12*math.sqrt(len(times)))
  land=math.degrees(math.atan2(f.landing_x_ft,f.landing_y_ft));direction_error=(land-bearing+180)%360-180
  penalty=np.r_[(f.distance_ft-c['distance'])/sigma if c['distance'] is not None else 0,max(0,abs(direction_error)-6)*10,max(0,times[-1]-f.hang_time_s)*100]
  return np.r_[components,penalty]
 bounds=([40,5,bearing-6],[120,50,bearing+6])
 seeds=[[70,26,bearing],[90,22,bearing+3],[110,18,bearing+5]]
 if 'fixed_speed' in c:bounds=(bounds[0][1:],bounds[1][1:]);seeds=[v[1:] for v in seeds]
 fits=[]
 for seed in seeds:
  fit=least_squares(residual,seed,bounds=bounds,diff_step=1e-3,max_nfev=100)
  f,uv=evaluate(fit.x);v=unpack(fit.x);land=math.degrees(math.atan2(f.landing_x_ft,f.landing_y_ft))
  fits.append({'ev_mph':float(v[0]),'launch_deg':float(v[1]),'spray_deg':float(v[2]),'landing_bearing_deg':land,'distance_ft':f.distance_ft,'hang_time_s':f.hang_time_s,'apex_time_s':f.apex_time_s,'cost':float(np.sum(residual(fit.x)**2)),'success':bool(fit.success),'scored_early_xy_rms_px':float(np.sqrt(np.mean(np.sum((uv[early]-observed[early])**2,axis=1)))),'late_vertical_errors_px':(uv[~early,1]-observed[~early,1]).tolist(),'ignored_late_horizontal_errors_px':(uv[~early,0]-observed[~early,0]).tolist(),'predicted_points':uv.tolist(),'observed_points':observed.tolist(),'at_spray_limit':bool(abs(v[2]-(bearing-6))<.01 or abs(v[2]-(bearing+6))<.01)})
 fits.sort(key=lambda r:r['cost']);report={**c,'early_frames':[round(t/step) for t in times[early]],'vertical_only_frames':[round(t/step) for t in times[~early]],'best':fits[0],'multistart':fits}
 (OUT/f"{c['name']}.json").write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k!='multistart'}),flush=True);return report
reports=[]
with ThreadPoolExecutor(max_workers=3) as pool:
 for future in as_completed([pool.submit(run,c) for c in cases]):reports.append(future.result())
(OUT/'report.json').write_text(json.dumps({'hit_id':ident,'raw_only':True,'assumptions':'No camera tilt or zoom. Early marks scored in x and y; later marks scored only in y. Same calibrated contact-frame camera and default spin model in all cases. Fresh forward simulations with three fixed initial seeds per fit; no saved predictions/candidates read. No vertical stabilization applied.','distance_ft':target,'tolerance_ft':sigma,'rows':reports},indent=2),encoding='utf-8')
print('REPORT',str(OUT/'report.json'),flush=True)
