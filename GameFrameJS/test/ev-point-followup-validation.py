from pathlib import Path
source=Path('test/ev-point-validation.py').read_text().split('reports=[]')[0]
source=source.replace("ROOT/'demo-output/ev-point-validation'", "ROOT/'demo-output/ev-point-followup-83'")
source=source.replace('FROM ev_hit_tracks ORDER BY id DESC LIMIT 1','FROM ev_hit_tracks WHERE id=83')
exec(source)
cases=[dict(name=f'{n-1}_flight_marks_baseline',count=n,variation='baseline',delta=0,angle=0) for n in [2,3,4,5]]
cases += [dict(name=f'{n-1}_flight_marks_no_distance',count=n,variation='no_distance',delta=None,angle=0) for n in [4,5]]
for delta in [-10,10]:cases.append(dict(name=f'all_marks_distance_{delta:+}',count=5,variation='distance_sensitivity',delta=delta,angle=0))
for axis in ['image_x','image_y']:
 for delta in [-2,2]:cases.append(dict(name=f'all_marks_last_{axis}_{delta:+}',count=5,variation='mark_sensitivity',delta=0,angle=0,axis=axis,pixel_delta=delta))
reports=[]
with ThreadPoolExecutor(max_workers=3) as pool:
 for future in as_completed([pool.submit(run,c) for c in cases]):
  row=future.result();reports.append(row);print(json.dumps(row),flush=True)
(OUT/'report.json').write_text(json.dumps({'hit_id':hit_id,'raw_only':True,'distance_ft':distance,'tolerance_ft':tol,'bearing_deg':bearing,'rows':reports},indent=2),encoding='utf-8')
