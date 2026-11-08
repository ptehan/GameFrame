import copy,json,sqlite3,subprocess,sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
root=Path.cwd();out=root/'demo-output/ev-point-validation';out.mkdir(parents=True,exist_ok=True)
with sqlite3.connect('file:app.db?mode=ro',uri=True) as c:raw=c.execute('select observation_package_json from ev_hit_tracks order by id desc limit 1').fetchone()[0]
p=json.loads(raw);rows=sorted(p['ball_observations'],key=lambda r:r['relative_time_s'])
def run(n):
 q=copy.deepcopy(p);q['ball_observations']=rows[:n];inp=out/f'pipeline-input-{n-1}.json';dest=out/f'pipeline-output-{n-1}.json';inp.write_text(json.dumps(q),encoding='utf-8')
 result=subprocess.run([sys.executable,str(root/'ev-predictor/synthetic/direct_video_estimate.py'),str(inp),'--db',str(root/'ev-predictor/data/hittrax_from_video.sqlite'),'--out',str(dest)],capture_output=True,text=True)
 if result.returncode:raise RuntimeError(result.stderr)
 pred=json.loads(dest.read_text());best=(pred.get('ev_candidates') or [{}])[0]
 row={'flight_marks':n-1,'method':pred.get('method'),'best':{k:best.get(k) for k in ['exit_velocity_mph','launch_angle_deg','distance_ft','projected_path_rmse_px']},'support':pred.get('measurement_support'),'export_readiness':pred.get('export_readiness'),'used_count':pred.get('direction_first_match',{}).get('used_count')};return row
reports=[]
with ThreadPoolExecutor(max_workers=2) as pool:
 for future in as_completed([pool.submit(run,n) for n in [2,3,4]]):
  report=future.result();reports.append(report);print(json.dumps(report),flush=True)
(out/'pipeline-summary.json').write_text(json.dumps(reports,indent=2),encoding='utf-8')
