"""Exercise staged preparation through the real app, using raw observations."""
import json,pathlib,sys,time,urllib.request
root=pathlib.Path(__file__).resolve().parents[1]
folder=root/'ev-predictor/comparison_output/live'
source=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else next(p for p in sorted(folder.glob('observation_package_*.json'),key=lambda p:p.stat().st_mtime,reverse=True) if not json.loads(p.read_text()).get('_prepare_background_only'))
package=json.loads(source.read_text());out=root/'demo-output/estimate-performance/deep-dive';out.mkdir(parents=True,exist_ok=True)
report=[];original=None
for name in ['camera-during-field-review','full-before-estimate-click','confirm-same-field-marks','revise-distance']:
    payload=json.loads(json.dumps(package))
    if name=='camera-during-field-review':
        payload['_prepare_background_only']=True;payload['landmarks']=[]
    if name=='full-before-estimate-click':
        for row in payload['landmarks']:row['human_reviewed']=False
    if name=='revise-distance':
        distance=payload['hit']['distance_observation'];distance['distance_ft']+=5
        for geometry in [distance.get('actual_field_map'),payload.get('camera',{}).get('actual_field_map')]:
            if geometry and isinstance(geometry.get('landing_distance_ft'),(int,float)):
                geometry['landing_distance_ft']+=5
    request=urllib.request.Request('http://127.0.0.1:8000/api/predict',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    started=time.perf_counter()
    with urllib.request.urlopen(request,timeout=240) as response:result=json.load(response)
    row={'phase':name,'wall_s':time.perf_counter()-started,'worker_s':result.get('_live_prediction',{}).get('elapsed_seconds')}
    if name=='camera-during-field-review':
        assert result['method']=='background_preparation' and 'ev_candidates' not in result
    else:
        match=result['direction_first_match'];best=match['best']
        row.update(speed_mph=best['exit_velocity_mph'],launch_angle_deg=best['launch_angle_deg'],
            fit_cache_hit=match['performance']['fit_cache_hit'],simulation_count=match['performance'].get('simulation_count'))
        assert match['selection_policy']['target_distance_ft']==payload['hit']['distance_observation']['distance_ft']
        if name=='full-before-estimate-click':original=best
        else:
            assert match['performance']['fit_cache_hit']
            assert abs(best['launch_angle_deg']-original['launch_angle_deg'])<1e-8
            if name=='confirm-same-field-marks':assert best['exit_velocity_mph']==original['exit_velocity_mph']
    report.append(row);print(json.dumps(row),flush=True)
    document=json.dumps({'input':str(source),'phases':report},indent=2)
    (out/'app-staged-timing.json').write_text(document)
    (out/('app-staged-'+source.stem+'.json')).write_text(document)
