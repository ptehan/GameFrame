from pathlib import Path
source=Path('test/ev-level-camera-retest.py').read_text().split('cases=[]')[0].replace('demo-output/level-camera-retest-','demo-output/geometric-angle-fixed-registration-')
exec(source)
from scipy.optimize import minimize_scalar
early=times<=20*step+step*.5;late=~early
Kinv=np.linalg.inv(pose['intrinsics']);R=pose['rotation'];C=-R.T@pose['translation']
records=[]
# Geometry stage: intersect early pixel rays with a vertical flight plane.
# Fit the spatial curve z(s), then take its contact tangent. No speed or later mark enters.
for direction in np.arange(bearing-6,bearing+6.01,2.):
 u=np.array([math.sin(math.radians(direction)),math.cos(math.radians(direction)),0.]);n=np.array([u[1],-u[0],0.])
 for perturb in [0,-2,2]:
  observed=pixels.copy();observed[early,1]+=perturb
  world=[]
  for uv in observed[early]:
   ray=R.T@Kinv@np.r_[uv,1.];lam=float(n@(origin-C)/(n@ray));world.append(C+lam*ray)
  world=np.array(world);s=(world-origin)@u;z=world[:,2]-origin[2]
  b,c=np.linalg.lstsq(np.column_stack([s,s*s]),z,rcond=None)[0];angle=math.degrees(math.atan(b))
  if not (0<angle<60 and np.all(s>0)):continue
  # Speed stage uses only later vertical positions, with angle/direction frozen.
  def speed_error(speed):
   f,uv=simulate([speed,angle,direction]);return float(np.mean((uv[late,1]-pixels[late,1])**2))
  grid=[(speed_error(v),v) for v in range(40,121)];_,seed=min(grid)
  fit=minimize_scalar(speed_error,bounds=(max(40,seed-2),min(120,seed+2)),method='bounded')
  f,uv=simulate([fit.x,angle,direction]);records.append({'direction_deg':float(direction),'early_y_perturbation_px':perturb,'geometric_launch_deg':angle,'spatial_curve_residual_ft':float(np.sqrt(np.mean((b*s+c*s*s-z)**2))),'late_only_ev_mph':float(fit.x),'late_y_error_px':(uv[late,1]-pixels[late,1]).tolist(),'early_xy_error_px':float(np.sqrt(np.mean(np.sum((uv[early]-pixels[early])**2,axis=1)))),'distance_ft':f.distance_ft,'apex_time_s':f.apex_time_s,'comparison':[{'speed':speed,'late_y_error_px':(simulate([speed,angle,direction])[1][late,1]-pixels[late,1]).tolist()} for speed in [87,100]]})
report={'hit_id':ident,'method':'Speed-free early ray/vertical-plane reconstruction and quadratic spatial tangent; angle and supplied plane direction frozen before fitting later Y to speed. Plane direction is conditioned on the mapped bearing, not independently measured. No saved prediction or candidates read.','rows':records}
(OUT/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
center=min((r for r in records if r['early_y_perturbation_px']==0),key=lambda r:abs(r['direction_deg']-bearing));print('CENTER',json.dumps(center));print('RANGES',json.dumps({'launch':[min(r['geometric_launch_deg'] for r in records),max(r['geometric_launch_deg'] for r in records)],'speed':[min(r['late_only_ev_mph'] for r in records),max(r['late_only_ev_mph'] for r in records)],'cases':len(records)}))
