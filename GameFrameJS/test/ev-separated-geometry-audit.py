"""Fresh separated geometry/speed audit after removing the contact plate lock."""
from pathlib import Path
source=Path('test/ev-level-camera-retest.py').read_text().split('cases=[]')[0].replace('demo-output/level-camera-retest-','demo-output/separated-geometry-audit-')
exec(source)
from scipy.optimize import brentq,minimize_scalar
import hashlib
from concurrent.futures import ThreadPoolExecutor,as_completed
original_origin=origin.copy();unit=(origin-(-pose['rotation'].T@pose['translation']));unit/=np.linalg.norm(unit)
early=times<=20*step+step*.5;late=~early;R=pose['rotation'];Kinv=np.linalg.inv(pose['intrinsics']);C=-R.T@pose['translation']
xy=pixels.copy();motion_file=ROOT/f'demo-output/ev-point-followup-{ident}/camera-motion.json'
if motion_file.exists():
 motion=json.loads(motion_file.read_text());by_frame={r['frame']:r for r in motion}
 for i,t in enumerate(times):
  if early[i] and round(t/step) in by_frame:
   H=np.array(by_frame[round(t/step)]['homography']);q=H@np.r_[pixels[i],1.];xy[i,0]=q[0]/q[2]
variants=[('raw_early',pixels),('horizontal_pan_corrected_early',xy)] if motion_file.exists() else [('raw_early',pixels)]
def evaluate_flight(speed,angle,direction,start):
 f=simulate_trajectory(Hit(float(speed),angle,direction,batter_hand='R',estimate_spin=True),start=StartPosition(*start))
 a=np.array([[r.t_s,r.x_ft,r.y_ft,r.z_ft] for r in f.points]);xyz=np.column_stack([np.interp(times,a[:,0],a[:,k]) for k in (1,2,3)]);uv,_=project_with_camera_pose(xyz,pose['intrinsics'],pose['rotation'],pose['translation']);return f,uv
jobs=[(name,obs,direction,depth,delta) for name,obs in variants for direction in np.arange(bearing-6,bearing+6.01,.5) for depth in [0.] for delta in [0.]]
# Separate uncertainty checks; never move the contact off its observed camera ray.
jobs += [('raw_early',pixels,direction,depth,delta) for direction in np.arange(bearing-6,bearing+6.01,2.) for depth,delta in [(-5.,0.),(5.,0.),(0.,-2.),(0.,2.)]]
def run(job):
 name,obs,direction,depth,delta=job;start=original_origin+depth*unit;observed=obs.copy();observed[early,1]+=delta
 u=np.array([math.sin(math.radians(direction)),math.cos(math.radians(direction)),0.]);n=np.array([u[1],-u[0],0.]);world=[]
 for point in observed[early]:
  ray=R.T@Kinv@np.r_[point,1.];lam=float(n@(start-C)/(n@ray));world.append(C+lam*ray)
 world=np.array(world);s=(world-start)@u;z=world[:,2]-start[2];b,c=np.linalg.lstsq(np.column_stack([s,s*s]),z,rcond=None)[0];angle=math.degrees(math.atan(b))
 if not (0<angle<60 and np.all(s>0)):return {'invalid_geometry':True,'direction_deg':direction,'depth_delta_ft':depth}
 cache={}
 def prediction(speed):
  if speed not in cache:cache[speed]=evaluate_flight(speed,angle,direction,start)
  return cache[speed]
 def error(speed):return float(np.mean(prediction(speed)[1][late,1]-pixels[late,1]))
 roots=[]
 grid=list(range(40,121,10));e=[error(v) for v in grid]
 for i in range(len(grid)-1):
  if e[i]*e[i+1]<=0:
   candidate=brentq(error,grid[i],grid[i+1],xtol=1e-5)
   if prediction(candidate)[0].hang_time_s>=times[late].max():roots.append(candidate)
 speed=min(roots,key=lambda v:abs(error(v))) if roots else float(minimize_scalar(lambda v:error(v)**2,bounds=(40,120),method='bounded').x)
 f,uv=prediction(speed)
 return {'variant':name,'direction_deg':float(direction),'depth_delta_ft':depth,'early_y_delta_px':delta,'origin_ft':start.tolist(),'launch_deg':angle,'speed_mph':speed,'distance_ft':f.distance_ft,'spatial_residual_ft':float(np.sqrt(np.mean((b*s+c*s*s-z)**2))),'early_xy_rmse_px':float(np.sqrt(np.mean(np.sum((uv[early]-observed[early])**2,axis=1)))),'late_vertical_error_px':error(speed),'physical_apex_time_s':f.apex_time_s,'airborne_at_late_mark':bool(f.hang_time_s>=times[late].max()),'y_errors_fixed_speed':{str(v):error(float(v)) for v in [87,100]}}
results=[]
with ThreadPoolExecutor(max_workers=3) as pool:
 for future in as_completed([pool.submit(run,j) for j in jobs]):results.append(future.result())
summaries=[]
for name,_ in variants:
 base=[r for r in results if r.get('variant')==name and r['depth_delta_ft']==0 and r['early_y_delta_px']==0]
 compatible=[r for r in base if abs(r['distance_ft']-target)<=sigma]
 summaries.append({'variant':name,'all_speed_range_mph':[min(r['speed_mph'] for r in base),max(r['speed_mph'] for r in base)],'smallest_100mph_vertical_miss_px':min(abs(r['y_errors_fixed_speed']['100']) for r in base),'distance_compatible':{'count':len(compatible),'speed_range_mph':[min(r['speed_mph'] for r in compatible),max(r['speed_mph'] for r in compatible)] if compatible else None,'angle_range_deg':[min(r['launch_deg'] for r in compatible),max(r['launch_deg'] for r in compatible)] if compatible else None,'best_early_consistency':min(compatible,key=lambda r:r['early_xy_rmse_px']) if compatible else None}})
report={'hit_id':ident,'input_sha256':hashlib.sha256(raw.encode()).hexdigest(),'stage1':'Early 10/15/20-frame rays reconstructed into vertical planes; launch from quadratic spatial tangent. NO trial speed, landing distance, or frame45 position used. Direction conditioned on mapped bearing +/-6 degrees.','stage2':'Freeze angle and plane direction, then fit speed to frame45 vertical position. Later X unused.','contact_reprojection_error_px':float(np.linalg.norm(project_with_camera_pose(original_origin[None,:],pose['intrinsics'],pose['rotation'],pose['translation'])[0][0]-[contact['image_x'],contact['image_y']])),'depth_sensitivity':'+/-5 ft along the clicked camera ray; click always preserved.','distance_check_only':[target-sigma,target+sigma],'summary':summaries,'results':results}
(OUT/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k!='results'},indent=2));print('REPORT',OUT/'report.json')
