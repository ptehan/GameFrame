from pathlib import Path
source=Path('test/ev-point-validation.py').read_text().split('reports=[]')[0]
source=source.replace("ROOT/'demo-output/ev-point-validation'", "ROOT/'demo-output/ev-point-followup-83-stabilized'").replace('FROM ev_hit_tracks ORDER BY id DESC LIMIT 1','FROM ev_hit_tracks WHERE id=83')
exec(source)
corrected=json.loads((ROOT/'demo-output/ev-point-followup-83/stabilized-raw-inputs.json').read_text())
manual=corrected['ball_observations']
cases=[dict(name=f'{n-1}_flight_marks_{variation}',count=n,variation=variation,delta=delta,angle=0) for n in [4,5] for variation,delta in [('baseline',0),('no_distance',None)]]
reports=[]
with ThreadPoolExecutor(max_workers=2) as pool:
 for future in as_completed([pool.submit(run,c) for c in cases]):
  row=future.result();reports.append(row);print(json.dumps(row),flush=True)
(OUT/'report.json').write_text(json.dumps({'diagnostic_only':True,'camera_compensation':'Background-feature homography to contact frame, no ball points used to estimate camera motion. Assumes predominantly rotational motion; sky extrapolation needs further validation.','rows':reports},indent=2),encoding='utf-8')
