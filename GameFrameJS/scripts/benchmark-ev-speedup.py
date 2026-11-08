"""Compare independent fresh pipelines on identical raw day/night inputs."""
import contextlib,io,json,os,pathlib,sqlite3,sys,time
root=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'ev-predictor/synthetic'))
import direct_video_estimate as estimator
from baseball_flight import Hit,simulate_trajectory
from evidence_analysis_cache import clear_analysis_cache
from flight_fit_cache import clear_fit_cache
out=root/'demo-output/estimate-performance/deep-dive';out.mkdir(parents=True,exist_ok=True)
with sqlite3.connect('file:'+str(root/'app.db')+'?mode=ro',uri=True) as conn:
    rows=conn.execute('select id,source_video_path,observation_package_json from ev_hit_tracks where id in (93,94)').fetchall()
original=estimator.prepare_staged_flight
simulate_trajectory(Hit(85,20,-15),sample_times=[0,.333,2])
report=[]
for hit_id,source,raw in rows:
    package=json.loads(raw);package['video_metadata']['source_path']=source
    inp=out/f'hit-{hit_id}-input.json';inp.write_text(json.dumps(package))
    results={};timings={}
    for method in ['reference','fast']:
        clear_analysis_cache();clear_fit_cache()
        os.environ['GAMEFRAME_BACKGROUND_FLOW']='0' if method=='reference' else '1'
        estimator.prepare_staged_flight=lambda *a,_adaptive=method=='fast',**kw:original(*a,**kw,adaptive_search=_adaptive)
        dest=out/f'hit-{hit_id}-{method}.json';started=time.perf_counter()
        with contextlib.redirect_stdout(io.StringIO()):
            estimator.main([str(inp),'--db',str(root/'ev-predictor/data/hittrax_from_video.sqlite'),'--out',str(dest)])
        timings[method]=time.perf_counter()-started;results[method]=json.loads(dest.read_text())
        print('FINISHED',hit_id,method,timings[method],flush=True)
    a=results['reference']['direction_first_match'];b=results['fast']['direction_first_match']
    row={'hit_id':hit_id,'raw_observations_only':True,'seconds':timings,
         'reference':{k:a['best'][k] for k in ['exit_velocity_mph','launch_angle_deg','distance_ft']},
         'fast':{k:b['best'][k] for k in ['exit_velocity_mph','launch_angle_deg','distance_ft']},
         'reference_ranges':a['supported_ranges'],'fast_ranges':b['supported_ranges'],
         'reference_simulations':a['performance'].get('simulation_count'),'fast_simulations':b['performance'].get('simulation_count'),
         'accepted_same':a['acceptable']==b['acceptable']}
    assert row['accepted_same'],row
    assert abs(a['best']['launch_angle_deg']-b['best']['launch_angle_deg'])<.5,row
    assert abs(a['best']['exit_velocity_mph']-b['best']['exit_velocity_mph'])<=1,row
    for old,new in zip(a['supported_ranges'].get('exit_velocity_mph',[]),b['supported_ranges'].get('exit_velocity_mph',[])):
        assert abs(old-new)<=2,row
    report.append(row);(out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(row),flush=True)
os.environ.pop('GAMEFRAME_BACKGROUND_FLOW',None)
estimator.prepare_staged_flight=original
