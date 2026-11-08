"""Fresh estimate timing; saved predictions are comparisons, never fit inputs."""
import cProfile
import json
import pathlib
import pstats
import sys
import time

root=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'ev-predictor/synthetic'))
from direct_video_estimate import main

folder=root/'ev-predictor/comparison_output/live'
inp=max((p for p in folder.glob('observation_package_*.json') if not json.loads(p.read_text()).get('_prepare_background_only')),key=lambda p:p.stat().st_mtime)
out=root/'demo-output/estimate-performance'
out.mkdir(parents=True,exist_ok=True)
label=sys.argv[1] if len(sys.argv)>1 else 'optimized'
prof=cProfile.Profile()
started=time.perf_counter()
prof.runcall(main,[str(inp),'--db',str(root/'ev-predictor/data/hittrax_from_video.sqlite'),'--out',str(out/(label+'.json'))])
elapsed=time.perf_counter()-started
prof.dump_stats(str(out/(label+'.prof')))
print('WALL_SECONDS',elapsed,flush=True)
pstats.Stats(prof).strip_dirs().sort_stats('cumulative').print_stats(20)
(out/(label+'-timing.json')).write_text(json.dumps({'input':str(inp),'elapsed_s':elapsed}))
if label!='baseline' and (out/'baseline.json').exists():
    previous=json.loads((out/'baseline.json').read_text())
    current=json.loads((out/(label+'.json')).read_text())
    for key in ['measurement_support','launch_angle_uncertainty']:
        print(key,current.get(key))
    a=previous['direction_first_match'];b=current['direction_first_match']
    assert a['acceptable']==b['acceptable']
    for key in ['exit_velocity_mph','launch_angle_deg','distance_ft']:
        assert abs(a['best'][key]-b['best'][key])<1e-7,(key,a['best'][key],b['best'][key])
    for key,values in a['supported_ranges'].items():
        assert all(abs(x-y)<1e-7 for x,y in zip(values,b['supported_ranges'][key])),key
    print('PASS: selected estimate and all supported ranges preserved.',flush=True)
if '--repeat' in sys.argv:
    # Change a real input and rerun the actual pipeline in the persistent
    # process. No saved prediction/candidate is supplied as an input.
    package=json.loads(inp.read_text())
    original=package['hit']['distance_observation']['distance_ft']
    package['hit']['distance_observation']['distance_ft']=original+5
    revised=out/'revised-distance-input.json'
    revised.write_text(json.dumps(package))
    dest=out/'revised-distance.json'
    started=time.perf_counter()
    main([str(revised),'--db',str(root/'ev-predictor/data/hittrax_from_video.sqlite'),'--out',str(dest)])
    seconds=time.perf_counter()-started
    revised_result=json.loads(dest.read_text())
    match=revised_result['direction_first_match']
    assert match['selection_policy']['target_distance_ft']==original+5
    assert match['performance']['fit_cache_hit']
    assert abs(match['best']['launch_angle_deg']-current['direction_first_match']['best']['launch_angle_deg'])<1e-7
    print('REVISED_DISTANCE_SECONDS',seconds,flush=True)
    (out/'revised-distance-timing.json').write_text(json.dumps({'elapsed_s':seconds,'distance_ft':original+5,
        'selected_speed_mph':match['best']['exit_velocity_mph'],'angle_deg':match['best']['launch_angle_deg']}))
