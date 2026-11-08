"""Fill gaps between stored trajectories using the existing flight model."""
import math
import numpy as np
from scipy.optimize import least_squares
from baseball_flight import Hit, StartPosition, simulate_trajectory
from direction_first_match import registered_origin
from match_vantage_grid import project_with_camera_pose
from prediction_cancel import check_cancelled


def refine_candidates(candidates, pose, anchor, times, pixels, bearing_deg,
                      half_width_deg, distance_ft, distance_tolerance_ft=12.0,
                      hang_time_s=None, hang_time_tolerance_s=None):
    if not candidates:
        return []
    origin = registered_origin(anchor, pose, bearing_deg)
    if origin is None:
        return []
    has_distance = distance_ft is not None and math.isfinite(distance_ft) and distance_ft > 0
    has_hang = hang_time_s is not None and hang_time_tolerance_s is not None and hang_time_tolerance_s > 0
    def cost(c):
        return (c['projected_path_rmse_px']/12)**2 + (
            ((c['distance_ft']-distance_ft)/distance_tolerance_ft)**2 if has_distance else 0) + (
            ((c['hang_time_s']-hang_time_s)/hang_time_tolerance_s)**2 if has_hang else 0)
    ordered = sorted(candidates, key=cost)
    seeds = []
    for c in ordered:
        if all(abs(c['spray_angle_deg']-s['spray_angle_deg']) >= 2 or
               abs(c['launch_angle_deg']-s['launch_angle_deg']) >= 3 for s in seeds):
            seeds.append(c)
        if len(seeds) == 3:
            break
    bounds = np.array([[min(c[k] for c in candidates), max(c[k] for c in candidates)]
                       for k in ('exit_velocity_mph','launch_angle_deg','spray_angle_deg')])
    # Landing-bearing filtering may leave only one stored spray sample. The
    # supplied bearing interval still supports continuous spray refinement.
    bounds[2,0] = min(bounds[2,0], bearing_deg-half_width_deg)
    bounds[2,1] = max(bounds[2,1], bearing_deg+half_width_deg)
    # A single speed/launch sample does not establish a supported search range.
    if np.any(bounds[:,1] <= bounds[:,0]):
        return []
    refined = []
    for source in seeds:
        def evaluate(params):
            check_cancelled()
            speed, launch, spray = map(float, params)
            flight = simulate_trajectory(Hit(speed, launch, spray,
                batter_hand=source.get('batter_hand','R'),
                estimate_spin=bool(source.get('estimate_spin',1)),
                backspin_rpm=source.get('backspin_rpm',0), sidespin_rpm=source.get('sidespin_rpm',0)),
                start=StartPosition(*origin))
            if flight.points[-1].t_s < times[-1]:
                return None
            data = np.array([(p.t_s,p.x_ft,p.y_ft,p.z_ft) for p in flight.points])
            xyz = np.column_stack([np.interp(times,data[:,0],data[:,i]) for i in (1,2,3)])
            uv, visible = project_with_camera_pose(xyz,pose['intrinsics'],pose['rotation'],pose['translation'])
            if not visible.all() or not np.isfinite(uv).all():
                return None
            landing = math.degrees(math.atan2(flight.landing_x_ft,flight.landing_y_ft))
            error = (landing-bearing_deg+180)%360-180
            return flight, uv, origin, landing, error
        def residual(params):
            value = evaluate(params)
            if value is None:
                return np.full(2*len(times)+3,1e4)
            flight, uv, _, _, error = value
            return np.r_[((uv-pixels)/(12*math.sqrt(len(times)))).ravel(),
                (flight.distance_ft-distance_ft)/distance_tolerance_ft if has_distance else 0,
                max(0,abs(error)-half_width_deg)*10,
                (flight.hang_time_s-hang_time_s)/hang_time_tolerance_s if has_hang else 0]
        initial = [source[k] for k in ('exit_velocity_mph','launch_angle_deg','spray_angle_deg')]
        result = least_squares(residual,initial,bounds=(bounds[:,0],bounds[:,1]),
                               diff_step=1e-3,max_nfev=80)
        value = evaluate(result.x)
        if value is None:
            continue
        flight, uv, origin, landing, error = value
        if abs(error) > half_width_deg:
            continue
        speed, launch, spray = map(float,result.x)
        if any(all(abs(r[k]-v)<.001 for k,v in zip(('exit_velocity_mph','launch_angle_deg','spray_angle_deg'),(speed,launch,spray))) for r in refined):
            continue
        refined.append({**source, 'hit_id':f'refined_ev{speed:.4f}_la{launch:.4f}_spray{spray:.4f}',
            'source_hit_id':source['hit_id'], 'refined':True,
            'exit_velocity_mph':speed,'launch_angle_deg':launch,'spray_angle_deg':spray,
            'backspin_rpm':flight.backspin_rpm,'sidespin_rpm':flight.sidespin_rpm,'spin_rpm':flight.spin_rpm,
            'distance_ft':flight.distance_ft,'hang_time_s':flight.hang_time_s,
            'apex_ft':flight.apex_ft,'apex_time_s':flight.apex_time_s,
            'landing_x_ft':flight.landing_x_ft,'landing_y_ft':flight.landing_y_ft,
            'bfs_display_angle_deg':flight.bfs_display_angle_deg,
            'landing_spray_angle_deg':landing,'landing_angle_residual_deg':error,
            'projected_path_rmse_px':float(np.sqrt(np.mean(np.sum((uv-pixels)**2,axis=1)))),
            'projected_path_max_error_px':float(np.linalg.norm(uv-pixels, axis=1).max()),
            'projected_pixels':uv.tolist(), '_origin':origin.tolist(),
            '_trajectory_points':[{'relative_time_s':p.t_s,'x_ft':p.x_ft,'y_ft':p.y_ft,'z_ft':p.z_ft} for p in flight.points]})
    return refined
