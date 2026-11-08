"""Manual-only launch/speed diagnostic. Does not change app behavior or saved data."""
import json
import math
import sqlite3
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ev-predictor/synthetic'))
from direct_video_estimate import constrained_pose_from_three_landmarks, resolved_prediction_geometry
from direction_first_match import registered_origin
from observation_validation import AUTO_SOURCES
from baseball_flight import Hit, StartPosition, simulate_trajectory
from match_vantage_grid import project_with_camera_pose


def projected_endpoint(speed, launch, spray, spin, origin, pose, time):
    flight = simulate_trajectory(Hit(float(speed), float(launch), float(spray),
        estimate_spin=False, backspin_rpm=spin[0], sidespin_rpm=spin[1]), start=StartPosition(*origin))
    if flight.points[-1].t_s < time:
        raise ValueError('Flight ends before the marked point.')
    ts = [p.t_s for p in flight.points]
    xyz = np.array([[np.interp(time,ts,[getattr(p,a) for p in flight.points]) for a in ('x_ft','y_ft','z_ft')]])
    uv, visible = project_with_camera_pose(xyz,pose['intrinsics'],pose['rotation'],pose['translation'])
    if not visible[0]:
        raise ValueError('Ball projects behind camera.')
    return uv[0], flight


def fit_mark(pixel, spray, spin, origin, pose, time):
    def residual(params):
        try:
            uv, _ = projected_endpoint(*params,spray,spin,origin,pose,time)
            return uv-pixel
        except ValueError:
            return np.array([10000.,10000.])
    fits = [least_squares(residual,start,bounds=([40.,0.],[120.,65.]),
                         max_nfev=100,diff_step=1e-5,xtol=1e-10,ftol=1e-10,gtol=1e-10)
            for start in ([75.,20.],[95.,35.])]
    fit = min(fits,key=lambda f:float(np.sum(f.fun**2)))
    speed, launch = fit.x
    uv, flight = projected_endpoint(speed,launch,spray,spin,origin,pose,time)
    return {'exit_velocity_mph':float(speed),'launch_angle_deg':float(launch),
            'spray_angle_deg':float(spray),'distance_ft':flight.distance_ft,
            'manual_point_error_px':float(np.linalg.norm(uv-pixel)),
            'landing_bearing_deg':math.degrees(math.atan2(flight.landing_x_ft,flight.landing_y_ft)),
            'at_parameter_boundary':bool(speed<=40.01 or speed>=119.99 or launch<=.01 or launch>=64.99)}


with sqlite3.connect((ROOT/'app.db').as_uri()+'?mode=ro',uri=True) as conn:
    hit_id,description,raw,saved=conn.execute(
        'SELECT id,description,observation_package_json,prediction_json FROM ev_hit_tracks ORDER BY id DESC LIMIT 1').fetchone()
package,prediction=json.loads(raw),json.loads(saved)
meta=package['video_metadata']
step=float(meta['frame_step_assumption_s'])
fps=round(1/step)
target_time=round(10*fps/30)*step
manual=[r for r in package['ball_observations'] if str(r.get('source','')).upper() not in AUTO_SOURCES]
contact=next(r for r in manual if abs(r['relative_time_s'])<1e-6)
endpoints=[r for r in manual if abs(r['relative_time_s']-target_time)<.5*step]
assert len(endpoints)==1
endpoint=endpoints[0]
# Field calibration receives no automatic observations, nor any fitted EV/LA.
package={**package,'ball_observations':[contact,endpoint]}
pose=constrained_pose_from_three_landmarks(package,meta['width_px'],meta['height_px'])
geometry=resolved_prediction_geometry(package)
bearing=geometry['direction']['spray_angle_deg']
anchor=np.array([contact['image_x'],contact['image_y']])
origin=registered_origin(anchor,pose,bearing)
assert origin is not None
time=float(endpoint['relative_time_s'])
pixel=np.array([endpoint['image_x'],endpoint['image_y']])
# Hold the existing unmeasured spin assumption fixed to isolate mark selection.
seed=prediction['direction_first_match']['best']
spin=(seed['backspin_rpm'],seed['sidespin_rpm'])

# Verify that this inverse calculation recovers a known synthetic launch and EV.
known_uv,_=projected_endpoint(80,30,-14,spin,origin,pose,time)
check=fit_mark(known_uv,-14,spin,origin,pose,time)
assert abs(check['exit_velocity_mph']-80)<.01 and abs(check['launch_angle_deg']-30)<.01,check
print('PASS: manual-endpoint inversion recovers synthetic 80 mph / 30 degrees.',flush=True)

results=[]
for spray in range(math.floor(bearing)-10,math.ceil(bearing)+11):
    result=fit_mark(pixel,spray,spin,origin,pose,time)
    result['map_direction_difference_deg']=(result['landing_bearing_deg']-bearing+180)%360-180
    if abs(result['map_direction_difference_deg'])<=5 and result['manual_point_error_px']<=1 and not result['at_parameter_boundary']:
        results.append(result)
        print(json.dumps(result),flush=True)
assert results,'No manual-only fit within the directional range.'
distance=geometry['direction'].get('estimated_distance_ft')
report={'id':hit_id,'description':description,'manual_time_s':time,'automatic_points_used':0,
        'controls':{'camera':'unchanged field-only calibration','contact_origin_ft':origin.tolist(),
                    'backspin_rpm':spin[0],'sidespin_rpm':spin[1],
                    'spin_note':'Unmeasured baseline assumptions held fixed, not estimated from the manual point.',
                    'landing_distance_used_to_fit':False},
        'mapped_bearing_reference':min(results,key=lambda r:abs(r['map_direction_difference_deg'])),
        'ranges':{k:[min(r[k] for r in results),max(r[k] for r in results)]
                  for k in ('exit_velocity_mph','launch_angle_deg','distance_ft')},
        'marked_distance_ft':distance,
        'nearest_distance_cross_check':None if distance is None else min(results,key=lambda r:abs(r['distance_ft']-distance)),
        'solutions':results,'synthetic_recovery_test':check}
folder=Path(tempfile.mkdtemp(prefix='gf-manual-launch-test-'))
(folder/'results.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k not in ('solutions','synthetic_recovery_test')},indent=2),flush=True)
print('Results: '+str(folder/'results.json'),flush=True)
