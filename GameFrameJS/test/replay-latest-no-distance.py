import json,sqlite3,sys
from pathlib import Path
root=Path.cwd();sys.path.insert(0,str(root/'ev-predictor/synthetic'))
from direct_video_estimate import constrained_pose_from_three_landmarks
from path_distance_match import match_path_and_distance
with sqlite3.connect('file:app.db?mode=ro',uri=True) as c:
 hit_id,raw,saved=c.execute('select id,observation_package_json,prediction_json from ev_hit_tracks order by id desc limit 1').fetchone()
p=json.loads(raw);old=json.loads(saved);m=p['video_metadata'];pose=constrained_pose_from_three_landmarks(p,m['width_px'],m['height_px'])
r=match_path_and_distance(p['ball_observations'],pose,old['field_direction']['spray_angle_deg'],root/'ev-predictor/data/hittrax_from_video.sqlite',distance_ft=None,frame_step_s=m['frame_step_assumption_s'],terminal_event=p.get('terminal_event'))
keys=['exit_velocity_mph','launch_angle_deg','spray_angle_deg','distance_ft','projected_path_rmse_px','score','score_policy']
report={'hit_id':hit_id,'used':r.get('used'),'acceptable':r.get('acceptable'),'reason':r.get('reason'),'best':{k:r.get('best',{}).get(k) for k in keys},'ranges':r.get('supported_ranges'),'selection_policy':r.get('selection_policy'),'available_speed_range_mph':r.get('available_speed_range_mph'),'at_speed_boundary':r.get('at_speed_boundary'),'used_count':r.get('used_count'),'top_candidates':[{k:v.get(k) for k in keys} for v in r.get('candidates',[])[:6]]}
(root/'demo-output/latest-video-only-fit.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,indent=2))
