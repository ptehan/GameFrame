"""Two-stage test: fit angle/direction to early points only; freeze before later-y scoring."""
from pathlib import Path
source=Path('test/ev-level-camera-retest.py').read_text().split('cases=[]')[0]
source=source.replace('demo-output/level-camera-retest-', 'demo-output/early-launch-held-fixed-')
exec(source)
early=times<=20*step+step*.5;late=~early
assert early.sum()>=2 and late.sum()>=1
from concurrent.futures import ThreadPoolExecutor,as_completed
# No landing distance and no late-point coordinates enter stage-one residuals.
def profile(speed):
 cache={}
 def evaluate(v):
  key=tuple(v)
  if key not in cache:cache[key]=simulate([speed,*v])
  return cache[key]
 def residual(v):
  f,uv=evaluate(v);land=math.degrees(math.atan2(f.landing_x_ft,f.landing_y_ft));error=(land-bearing+180)%360-180
  return np.r_[(uv[early]-pixels[early]).ravel(),max(0,abs(error)-6)*120]
 fitted=[]
 for launch,spray_delta in [(18,5),(22,2),(27,-2)]:
  fit=least_squares(residual,[launch,bearing+spray_delta],bounds=([5,bearing-6],[50,bearing+6]),diff_step=1e-3,max_nfev=80)
  f,uv=evaluate(fit.x);land=math.degrees(math.atan2(f.landing_x_ft,f.landing_y_ft))
  fitted.append((float(np.sum(residual(fit.x)**2)),fit,f,uv,land))
 _,fit,f,uv,land=min(fitted,key=lambda r:r[0])
 # Stage two reads the later y values, without reoptimizing anything.
 data=np.array([[v.t_s,v.x_ft,v.y_ft,v.z_ft] for v in f.points if 0<v.t_s<=2.5]);screen,_=project_with_camera_pose(data[:,1:],pose['intrinsics'],pose['rotation'],pose['translation']);apparent_idx=int(np.argmin(screen[:,1]))
 row={'ev_mph':speed,'early_launch_deg':float(fit.x[0]),'early_spray_deg':float(fit.x[1]),'early_xy_rmse_px':float(np.sqrt(np.mean(np.sum((uv[early]-pixels[early])**2,axis=1)))),'late_y_error_px':(uv[late,1]-pixels[late,1]).tolist(),'late_y_rms_px':float(np.sqrt(np.mean((uv[late,1]-pixels[late,1])**2))),'predicted_late_y':uv[late,1].tolist(),'distance_ft':f.distance_ft,'landing_bearing_deg':land,'physical_apex_time_s':f.apex_time_s,'apparent_apex_time_s':float(data[apparent_idx,0]),'success':bool(fit.success),'at_spray_limit':bool(abs(fit.x[1]-(bearing-6))<.01 or abs(fit.x[1]-(bearing+6))<.01)}
 print(json.dumps(row),flush=True);return row
rows=[]
with ThreadPoolExecutor(max_workers=3) as pool:
 for future in as_completed([pool.submit(profile,s) for s in sorted(set([*range(40,121,2),87,99]))]):rows.append(future.result())
rows.sort(key=lambda r:r['ev_mph']);best_early=min(rows,key=lambda r:r['early_xy_rmse_px']);bands=[]
for slack in [2.,5.]:
 accepted=[r for r in rows if r['early_xy_rmse_px']<=best_early['early_xy_rmse_px']+slack]
 bands.append({'early_fit_allowance_above_best_px':slack,'count':len(accepted),'speed_range_mph':[min(r['ev_mph'] for r in accepted),max(r['ev_mph'] for r in accepted)],'launch_range_deg':[min(r['early_launch_deg'] for r in accepted),max(r['early_launch_deg'] for r in accepted)],'best_by_withheld_vertical':min(accepted,key=lambda r:r['late_y_rms_px'])})
# Additional literal-angle-lock test: pick early best angle and direction once.
locked=[]
for speed in sorted(set([*range(40,121),87,99,100])):
 f,uv=simulate([speed,best_early['early_launch_deg'],best_early['early_spray_deg']])
 locked.append({'ev_mph':speed,'early_xy_rmse_px':float(np.sqrt(np.mean(np.sum((uv[early]-pixels[early])**2,axis=1)))),'late_y_rms_px':float(np.sqrt(np.mean((uv[late,1]-pixels[late,1])**2))),'late_y_error_px':(uv[late,1]-pixels[late,1]).tolist(),'distance_ft':f.distance_ft})
locked_best_early=min(r['early_xy_rmse_px'] for r in locked)
locked_accepted=[r for r in locked if r['early_xy_rmse_px']<=locked_best_early+2]
report={'hit_id':ident,'method':'Stage 1: independent fixed-speed profiles fit launch/spray to early XY only, without landing distance. Stage 2: freeze each profile and compare later Y only. Also test a single angle/spray pair frozen from the best early-only profile.','early_times_s':times[early].tolist(),'late_times_s':times[late].tolist(),'observed_late_y':pixels[late,1].tolist(),'best_early_only':best_early,'early_uncertainty_bands':bands,'profiles':rows,'literal_lock':{'launch_deg':best_early['early_launch_deg'],'spray_deg':best_early['early_spray_deg'],'best_by_late_among_early_accepted':min(locked_accepted,key=lambda r:r['late_y_rms_px']),'profiles':locked},'comparison_87_100':[r for r in rows if r['ev_mph'] in [87,100]],'distance_compatible_profiles':[r for r in rows if abs(r['distance_ft']-target)<=sigma]}
(OUT/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print('SUMMARY',json.dumps({k:v for k,v in report.items() if k not in ['profiles','literal_lock','distance_compatible_profiles']}),flush=True)
