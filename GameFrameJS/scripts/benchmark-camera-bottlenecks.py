"""Compare fresh raw-evidence pipelines before/after camera optimizations."""
import contextlib,importlib.util,io,json,pathlib,sqlite3,sys,time,numpy as np
root=pathlib.Path(__file__).resolve().parents[1];out=root/'demo-output/speed-audit-20261105';sys.path.insert(0,str(root/'ev-predictor/synthetic'))
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
before=load('before_estimator',out/'before-direct_video_estimate.py');old_camera=load('before_camera',out/'before-camera_motion_observations.py')
import direct_video_estimate as after, camera_motion_observations as new_camera
old_flight=load('before_flight',out/'before-baseball_flight.py')
old_staged=load('before_staged',out/'before-staged_flight_match.py')
old_staged.simulate_trajectory=old_flight.simulate_trajectory
before.prepare_staged_flight=old_staged.prepare_staged_flight
before.select_staged_match=old_staged.select_staged_match
from baseball_flight import Hit,simulate_trajectory
from evidence_analysis_cache import clear_analysis_cache
from flight_fit_cache import clear_fit_cache
simulate_trajectory(Hit(85.,20.,-15.),sample_times=[0.,.333,2.])
# Exact rotation equations, including vertical and coincident-view fallbacks.
rng=np.random.default_rng(102)
for _ in range(100):
 center=rng.normal(size=3)*50;target=rng.normal(size=3)*100;roll=float(rng.uniform(-35,35))
 np.testing.assert_allclose(before.look_at_rotation(center,target,roll),after.look_at_rotation(center,target,roll),rtol=0,atol=1e-15)
with sqlite3.connect('file:'+str(root/'app.db')+'?mode=ro',uri=True) as c:rows=c.execute('select id,source_video_path,observation_package_json from ev_hit_tracks where id in (93,94,98)').fetchall()
report=[]
for hit,source,raw in rows:
 assert pathlib.Path(source).is_file(),source
 pkg=json.loads(raw);pkg['video_metadata']['source_path']=source;inp=out/f'camera-{hit}-raw.json';inp.write_text(json.dumps(pkg))
 results={};timings={}
 for label,estimator,camera in [('before',before,old_camera),('after',after,new_camera)]:
  sys.modules['camera_motion_observations']=camera;clear_analysis_cache();clear_fit_cache();dest=out/f'camera-{hit}-{label}.json'
  started=time.perf_counter()
  with contextlib.redirect_stdout(io.StringIO()):estimator.main([str(inp),'--db',str(root/'ev-predictor/data/hittrax_from_video.sqlite'),'--out',str(dest)])
  timings[label]=time.perf_counter()-started;results[label]=json.loads(dest.read_text());print('DONE',hit,label,round(timings[label],3),flush=True)
 a=results['before']['direction_first_match'];b=results['after']['direction_first_match']
 error={k:abs(a['best'][k]-b['best'][k]) for k in ['exit_velocity_mph','launch_angle_deg','distance_ft']}
 row={'hit':hit,'seconds':timings,'before':a['best'],'after':b['best'],'difference':error,'accepted_same':a['acceptable']==b['acceptable'],'late_policy':b.get('late_evidence_policy')}
 # The optimization cannot turn a questionable observation into an accepted fit.
 assert row['accepted_same'],row
 assert error['launch_angle_deg']<.5 and error['exit_velocity_mph']<=1 and error['distance_ft']<6,row
 assert row['late_policy']=='timing_only',row
 report.append(row);(out/'camera-comparison.json').write_text(json.dumps(report,indent=2));print('PASS',hit,error,flush=True)
