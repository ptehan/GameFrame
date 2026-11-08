"""Fresh, read-only ablations of raw EV inputs. Never reads prediction_json."""
import copy, hashlib, json, math, sqlite3, sys, time, subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ev-predictor/synthetic'))
from direct_video_estimate import constrained_pose_from_three_landmarks
from path_distance_match import match_path_and_distance
from match_vantage_grid import project_with_camera_pose
from contact_timing import prepare_contact_observations
OUT=ROOT/'demo-output/ev-point-validation';OUT.mkdir(parents=True,exist_ok=True)
with sqlite3.connect((ROOT/'app.db').as_uri()+'?mode=ro',uri=True) as conn:
    hit_id,raw=conn.execute('SELECT id,observation_package_json FROM ev_hit_tracks ORDER BY id DESC LIMIT 1').fetchone()
package=json.loads(raw);meta=package['video_metadata'];step=meta['frame_step_assumption_s']
manual=[r for r in package['ball_observations'] if str(r.get('source','')).upper() in {'HUMAN','MANUAL','USER','MODEL_ANCHOR'}]
manual=sorted(manual,key=lambda r:r['relative_time_s'])
assert len(manual)>=4,'Need contact and all three raw flight marks'
frames=[round(r['relative_time_s']/step) for r in manual]
assert frames[:4]==[0,10,15,20],frames
pose=constrained_pose_from_three_landmarks(package,meta['width_px'],meta['height_px'])
assert pose is not None
bearing=float(package['hit']['distance_observation']['spray_angle_deg'])
distance=float(package['hit']['distance_observation']['distance_ft']);tol=float(package['hit']['distance_observation']['uncertainty_ft'])
(OUT/'raw-inputs.json').write_text(raw,encoding='utf-8')
cases=[]
for count in [2,3,4]:
 for variation,delta,angle in [('baseline',0,0),('distance_minus20',-20,0),('distance_plus20',20,0),('direction_minus2',0,-2),('direction_plus2',0,2),('no_distance',None,0)]:
  cases.append(dict(name=f'{count-1}_flight_marks_{variation}',count=count,variation=variation,delta=delta,angle=angle))
for axis in ['image_x','image_y']:
 for sign in [-1,1]:
  cases.append(dict(name=f'3_flight_marks_last_{axis}_{sign*2:+}',count=4,variation='last_mark_perturbation',delta=0,angle=0,axis=axis,pixel_delta=sign*2))
for sign in [-1,1]:
 cases.append(dict(name=f'3_flight_marks_contact_x_{sign*2:+}',count=4,variation='contact_perturbation',delta=0,angle=0,contact_delta=sign*2))
for sign in [-1,1]:
 cases.append(dict(name=f'3_flight_marks_rubber_x_{sign*2:+}',count=4,variation='calibration_perturbation',delta=0,angle=0,calibration_delta=sign*2))
def run(case):
 rows=copy.deepcopy(manual[:case['count']]);localpose=pose
 if 'pixel_delta' in case:rows[-1][case['axis']]+=case['pixel_delta']
 if 'contact_delta' in case:rows[0]['image_x']+=case['contact_delta']
 if 'calibration_delta' in case:
  p=copy.deepcopy(package)
  next(r for r in p['landmarks'] if r['landmark']=='pitching_rubber')['image_x']+=case['calibration_delta']
  localpose=constrained_pose_from_three_landmarks(p,meta['width_px'],meta['height_px'])
 target=None if case['delta'] is None else distance+case['delta']
 start=time.monotonic()
 result=match_path_and_distance(rows,localpose,bearing+case['angle'],ROOT/'ev-predictor/data/hittrax_from_video.sqlite',distance_ft=target,distance_tolerance_ft=tol,frame_step_s=step,terminal_event=package.get('terminal_event'))
 best=result.get('best',{})
 report={**case,'elapsed_s':time.monotonic()-start,'used':result.get('used'),'acceptable':result.get('acceptable'),'reason':result.get('reason'),'target_distance_ft':target,'bearing_deg':bearing+case['angle'],'best':{k:best.get(k) for k in ['exit_velocity_mph','launch_angle_deg','spray_angle_deg','distance_ft','landing_spray_angle_deg','projected_path_rmse_px','score','score_policy']},'used_count':result.get('used_count'),'supported_ranges':result.get('supported_ranges'),'supported_candidate_count':result.get('supported_candidate_count'),'at_speed_boundary':result.get('at_speed_boundary'),'holdouts':[]}
 if best and case['variation']=='baseline':
  trajectory=result['trajectory_points'];data=np.array([[v['relative_time_s'],v['x_ft'],v['y_ft'],v['z_ft']] for v in trajectory])
  for held in manual[case['count']:]:
   t=held['relative_time_s'];xyz=np.array([[np.interp(t,data[:,0],data[:,k]) for k in (1,2,3)]])
   uv,visible=project_with_camera_pose(xyz,localpose['intrinsics'],localpose['rotation'],localpose['translation'])
   report['holdouts'].append({'frame':round(t/step),'predicted_px':uv[0].tolist(),'marked_px':[held['image_x'],held['image_y']],'error_px':float(np.linalg.norm(uv[0]-[held['image_x'],held['image_y']])),'visible':bool(visible[0])})
 (OUT/f"{case['name']}.json").write_text(json.dumps(report,indent=2),encoding='utf-8')
 return report
reports=[]
with ThreadPoolExecutor(max_workers=3) as pool:
 futures={pool.submit(run,c):c for c in cases}
 for future in as_completed(futures):
  try:
   row=future.result();reports.append(row);print(json.dumps(row),flush=True)
  except Exception as exc:
   row={**futures[future],'error':repr(exc)};reports.append(row);print(json.dumps(row),flush=True)
summary={'hit_id':hit_id,'raw_input_sha256':hashlib.sha256(raw.encode()).hexdigest(),'inputs':'Raw observation_package_json only; never reads saved predictions or candidates. Fresh production matcher for every case. Synthetic simulation database is the model, not a prior fitted result.','distance_ft':distance,'distance_tolerance_ft':tol,'bearing_deg':bearing,'camera_diagnostics':pose.get('calibration_diagnostics'),'rows':sorted(reports,key=lambda r:r['name'])}
(OUT/'report.json').write_text(json.dumps(summary,indent=2,default=lambda v:v.tolist() if isinstance(v,np.ndarray) else float(v)),encoding='utf-8')
print('REPORT',str(OUT/'report.json'),flush=True)
