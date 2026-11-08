"""Read-only replay of the latest saved hit with nearby landing marks."""
import copy,json,math,sqlite3,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
with sqlite3.connect((ROOT/'app.db').as_uri()+'?mode=ro',uri=True) as conn:
    hit_id,raw=conn.execute('SELECT id,observation_package_json FROM ev_hit_tracks ORDER BY id DESC LIMIT 1').fetchone()
original=json.loads(raw)
folder=Path(tempfile.mkdtemp(prefix='gf-distance-spray-'))
rows=[]
for delta,angle_delta in [(0,0),(-10,-2),(10,2),(-20,0),(20,0)]:
    package=copy.deepcopy(original)
    d=package['hit']['distance_observation']
    distance=d['distance_ft']+delta
    angle=d['spray_angle_deg']+angle_delta
    xy={'x':distance*math.sin(math.radians(angle)),'y':distance*math.cos(math.radians(angle))}
    d.update(distance_ft=distance,spray_angle_deg=angle,terminal_ground_xy_ft=xy)
    m=d.get('actual_field_map',{})
    m.update(landing_distance_ft=distance,landing_angle_deg=angle,landing_xy_ft=xy)
    inp=folder/f'input-{delta}-{angle_delta}.json';out=folder/f'output-{delta}-{angle_delta}.json'
    inp.write_text(json.dumps(package),encoding='utf-8')
    subprocess.run([sys.executable,str(ROOT/'ev-predictor/synthetic/direct_video_estimate.py'),str(inp),'--db',str(ROOT/'ev-predictor/data/hittrax_from_video.sqlite'),'--out',str(out)],check=True,stdout=subprocess.DEVNULL)
    prediction=json.loads(out.read_text(encoding='utf-8'))
    best=(prediction.get('ev_candidates') or [{}])[0]
    row={'distance_ft':distance,'spray_deg':angle,'uncertainty_ft':d.get('uncertainty_ft'),'best':{k:best.get(k) for k in ['exit_velocity_mph','launch_angle_deg','distance_ft']},'support':prediction.get('measurement_support'),'export':prediction.get('export_readiness')}
    rows.append(row)
    print(json.dumps(row),flush=True)
report={'hit_id':hit_id,'source':original['video_metadata']['file_name'],'results':rows,'artifacts':str(folder)}
(ROOT/'demo-output/distance-spray-sensitivity.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
