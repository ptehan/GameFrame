"""Fresh timing-only/rate comparisons; predictions never become fit inputs."""
import json,pathlib,sqlite3,sys,time
root=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'ev-predictor/synthetic'))
from direct_video_estimate import constrained_pose_from_three_landmarks,resolved_prediction_geometry
from camera_motion_observations import register_ball_observations
from contact_timing import prepare_contact_observations
from observation_validation import reject_early_anchor_arrivals
from staged_flight_match import prepare_staged_flight,select_staged_match
from baseball_flight import Hit,simulate_trajectory

out=root/'demo-output/ev-descent-rate';out.mkdir(parents=True,exist_ok=True)
current=root/'ev-predictor/comparison_output/live/observation_package_a4e4bf47de0f4804bc363fc704bc35f6.json'
cases=[('current',json.loads(current.read_text()))]
with sqlite3.connect('file:'+str(root/'app.db')+'?mode=ro',uri=True) as conn:
    raw,source=conn.execute('SELECT observation_package_json,source_video_path FROM ev_hit_tracks WHERE id=94').fetchone()
    package=json.loads(raw);package['video_metadata']['source_path']=source;cases.append(('night',package))
simulate_trajectory(Hit(85,20,-15),sample_times=[0,.333,2])
reports=[]
for name,package in cases:
    meta=package['video_metadata'];step=meta.get('frame_step_assumption_s') or 1/30
    rows,motion=register_ball_observations(package,prepare_contact_observations(package['ball_observations']))
    rows,_=reject_early_anchor_arrivals(rows,step)
    package={**package,'ball_observations':rows,'camera_motion_evidence':motion}
    pose=constrained_pose_from_three_landmarks(package,meta['width_px'],meta['height_px'])
    bearing=resolved_prediction_geometry(package)['direction']['spray_angle_deg']
    distance=package['hit']['distance_observation']['distance_ft']
    report={'case':name,'fresh_observations_only':True,'target_distance_ft':distance,'results':[]}
    for enabled in [False,True]:
        started=time.perf_counter()
        context=prepare_staged_flight(rows,pose,bearing,frame_step_s=step,package=package,
            angle_primary=True,use_cache=False,use_descent_rate=enabled)
        item={'rate_enabled':enabled,'fit_seconds':time.perf_counter()-started,'simulation_count':context.get('simulation_count'),
              'descent_evidence':context.get('late_descent_rate'),'fits':[]}
        for allowance in [None,5,10,20,40]:
            result=select_staged_match(context,None if allowance is None else distance,allowance or 20,frame_step_s=step)
            best=result['best']
            item['fits'].append({'landing_allowance_ft':allowance,'acceptable':result['acceptable'],
                'best':{k:best.get(k) for k in ['exit_velocity_mph','launch_angle_deg','distance_ft','predicted_descent_rate_px_per_s','descent_rate_error_px_per_s']},
                'ranges':result['supported_ranges']})
        report['results'].append(item)
        print(json.dumps({'case':name,'enabled':enabled,'seconds':item['fit_seconds'],'rate':item['descent_evidence'],
            'video_only':item['fits'][0],'with_20ft':item['fits'][3]}),flush=True)
    before=report['results'][0]['fits'][3];after=report['results'][1]['fits'][3]
    assert abs(before['best']['launch_angle_deg']-after['best']['launch_angle_deg'])<1e-10
    if not report['results'][1]['descent_evidence'].get('used'):
        assert before['ranges']==after['ranges']
        assert before['best']['exit_velocity_mph']==after['best']['exit_velocity_mph']
    reports.append(report);(out/'report.json').write_text(json.dumps(reports,indent=2))
