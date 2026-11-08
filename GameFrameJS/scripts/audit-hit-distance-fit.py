"""Read-only audit of stored coverage versus continuous flight parameters."""
import json, sqlite3, sys, math
from pathlib import Path
from contextlib import closing
import numpy as np
from scipy.optimize import least_squares

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'ev-predictor/synthetic'))
import path_distance_match as matcher
from direct_video_estimate import constrained_pose_from_three_landmarks, resolved_prediction_geometry
from direction_first_match import registered_origin
from match_vantage_grid import project_with_camera_pose
from baseball_flight import Hit, simulate_trajectory

with closing(sqlite3.connect((root/'app.db').as_uri()+'?mode=ro',uri=True)) as conn:
    package=json.loads(conn.execute('SELECT observation_package_json FROM ev_hit_tracks WHERE id=62').fetchone()[0])
meta=package['video_metadata'];obs=package['ball_observations'];anchor=np.array([obs[0]['image_x'],obs[0]['image_y']])
pose=constrained_pose_from_three_landmarks(package,meta['width_px'],meta['height_px'])
times=np.array([r['relative_time_s'] for r in obs[1:]])
pixels=np.array([[r['image_x'],r['image_y']] for r in obs[1:]])
target=package['hit']['distance_observation']['distance_ft']
def evaluate(params):
    speed,launch,spray=params
    origin=registered_origin(anchor,pose,spray)
    if origin is None: return None
    flight=simulate_trajectory(Hit(speed,launch,spray))
    points=np.array([(p.t_s,p.x_ft,p.y_ft,p.z_ft) for p in flight.points])
    xyz=np.column_stack([np.interp(times,points[:,0],points[:,a]) for a in (1,2,3)])+origin-points[0,1:]
    uv,visible=project_with_camera_pose(xyz,pose['intrinsics'],pose['rotation'],pose['translation'])
    if not visible.all(): return None
    return flight,uv,origin
fits=[]
for selection in ('all','manual'):
    mask=np.array([True,True,True] if selection=='all' else [False,False,True])
    def residual(params):
        value=evaluate(params)
        if value is None:return np.full(int(mask.sum())*2+1,1e4)
        flight,uv,_=value
        return np.r_[((uv-pixels)[mask]/12).ravel(),(flight.distance_ft-target)/12]
    for initial in ([82,23,-12],[85,22,-10],[59,29,-20]):
        fit=least_squares(residual,initial,bounds=([45,5,-30],[110,50,-5]),diff_step=1e-4,max_nfev=160)
        flight,uv,origin=evaluate(fit.x)
        fits.append(dict(selection=selection,parameters=fit.x.tolist(),distance_ft=flight.distance_ft,
            video_rmse_px=float(np.sqrt(np.mean(np.sum((uv-pixels)**2,axis=1)))),
            per_point_error_px=np.linalg.norm(uv-pixels,axis=1).tolist(),landing_bearing_deg=math.degrees(math.atan2(flight.landing_x_ft,flight.landing_y_ft)),
            contact_origin_ft=origin.tolist(),cost=fit.cost))
print('CONTINUOUS FITS '+json.dumps(fits),flush=True)
captured=[]
original=matcher.rank_candidates
def capture(rows,*args,**kwargs):
    captured.extend(rows)
    return original(rows,*args,**kwargs)
matcher.rank_candidates=capture
result=matcher.match_path_and_distance(obs,pose,resolved_prediction_geometry(package)['direction']['spray_angle_deg'],root/'ev-predictor/data/hittrax_from_video.sqlite',distance_ft=target,half_width_deg=180)
near=sorted((c for c in captured if abs(c['distance_ft']-target)<=12),key=lambda c:c['projected_path_rmse_px'])[:10]
fields=('hit_id','exit_velocity_mph','launch_angle_deg','spray_angle_deg','distance_ft','projected_path_rmse_px')
summary={'continuous':fits,'best_stored_within_12ft':[{k:c[k] for k in fields} for c in near],
    'candidate_count':len(captured),'original_selection_policy':result['selection_policy']}
out=root/'demo-output/hit-62-distance-audit.json';out.write_text(json.dumps(summary,indent=2));
np.savez(root/'demo-output/hit-62-camera.npz',**{k:pose[k] for k in ['intrinsics','rotation','translation']})
(root/'demo-output/hit-62-scored-candidates.json').write_text(json.dumps(captured))
print(json.dumps(summary,indent=2),flush=True)
