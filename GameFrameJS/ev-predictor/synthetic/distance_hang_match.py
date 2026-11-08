"""Fit measured carry and flight time; camera projection is diagnostic only."""
import math
import sqlite3
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

from baseball_flight import Hit, StartPosition, simulate_trajectory
from match_vantage_grid import project_with_camera_pose


def match_distance_and_hang(package, database, direction, pose=None):
    distance_obs = (package.get('hit') or {}).get('distance_observation') or {}
    terminal = package.get('terminal_event') or {}
    distance, hang = distance_obs.get('distance_ft'), terminal.get('relative_time_s')
    if terminal.get('type') != 'FIRST_GROUND_CONTACT' or not all(
            isinstance(x, (int, float)) and math.isfinite(x) and x > 0 for x in (distance, hang)):
        return None
    step = float((package.get('video_metadata') or {}).get('frame_step_assumption_s') or 1/30)
    distance_tolerance = max(1., float(distance_obs.get('uncertainty_ft') or 12))
    time_tolerance = max(step, float(terminal.get('timing_uncertainty_s') or step))
    bearing = direction.get('spray_angle_deg')
    if bearing is None:
        return None
    # Height is an explicit flight assumption, never fitted to the video/camera.
    contact_height = float(((package.get('hit') or {}).get('contact') or {}).get('height_ft') or 2.5)
    origin = StartPosition(0., 0., contact_height)
    rows = [r for r in package.get('ball_observations', [])
            if str(r.get('source','')).upper() in {'HUMAN','MANUAL','USER'}]
    contact = next((r for r in rows if abs(r.get('relative_time_s',-1)) < 1e-6), None)
    observations = [r for r in rows if 0 < r.get('relative_time_s',-1) <= .45
                    and r.get('image_x') is not None and r.get('image_y') is not None]
    times = np.array([r['relative_time_s'] for r in observations])
    pixels = np.array([[r['image_x'],r['image_y']] for r in observations])
    cache = {}

    def evaluate(params):
        key = tuple(float(v) for v in params)
        if key in cache:
            return cache[key]
        speed, launch, spray = key
        flight = simulate_trajectory(Hit(speed,launch,spray),start=origin)
        landing = math.degrees(math.atan2(flight.landing_x_ft,flight.landing_y_ft))
        bearing_error = (landing-bearing+180)%360-180
        de,te = flight.distance_ft-distance, flight.hang_time_s-hang
        row = dict(hit_id=f'distance_hang_{speed:.4f}_{launch:.4f}_{spray:.4f}',
            exit_velocity_mph=speed,launch_angle_deg=launch,spray_angle_deg=spray,
            distance_ft=flight.distance_ft,hang_time_s=flight.hang_time_s,
            apex_ft=flight.apex_ft,apex_time_s=flight.apex_time_s,
            landing_x_ft=flight.landing_x_ft,landing_y_ft=flight.landing_y_ft,
            backspin_rpm=flight.backspin_rpm,sidespin_rpm=flight.sidespin_rpm,
            distance_error_ft=de,hang_time_error_s=te,landing_angle_residual_deg=bearing_error,
            score=(de/distance_tolerance)**2+(te/time_tolerance)**2,
            score_policy='distance_and_hang_time_only',distance_score_weight=1.,
            physical_constraints_pass=abs(de)<=distance_tolerance and abs(te)<=time_tolerance and abs(bearing_error)<=6.)
        cache[key] = (row,flight)
        return row,flight

    with sqlite3.connect(Path(database).resolve().as_uri()+'?mode=ro',uri=True) as conn:
        seeds = conn.execute('''SELECT DISTINCT exit_velocity_mph,launch_angle_deg,spray_angle_deg
            FROM synthetic_hits WHERE distance_ft BETWEEN ? AND ? AND hang_time_s BETWEEN ? AND ?
            AND spray_angle_deg BETWEEN ? AND ?
            ORDER BY abs(distance_ft-?)/?+abs(hang_time_s-?)/? LIMIT 300''',
            (distance-distance_tolerance-25,distance+distance_tolerance+25,
             max(.1,hang-time_tolerance-.2),hang+time_tolerance+.2,
             bearing-20,bearing+20,distance,distance_tolerance,hang,time_tolerance)).fetchall()
    for seed in seeds:
        evaluate(seed)
    initial_rows = sorted((value[0] for value in cache.values()),key=lambda r:r['score']+max(0,abs(r['landing_angle_residual_deg'])-6)**2)
    starts = []
    for row in initial_rows:
        if all(abs(row['launch_angle_deg']-r['launch_angle_deg'])>=1 or abs(row['spray_angle_deg']-r['spray_angle_deg'])>=3 for r in starts):
            starts.append(row)
        if len(starts)==5:
            break
    def residual(params):
        row,_ = evaluate(params)
        return [row['distance_error_ft']/distance_tolerance,row['hang_time_error_s']/time_tolerance,
                row['landing_angle_residual_deg']/6]
    # Only optimizer results and stored grid samples, not derivative probes, are candidates.
    candidates = [evaluate(seed)[0] for seed in seeds]
    for seed in starts:
        fit = least_squares(residual,[seed[k] for k in ('exit_velocity_mph','launch_angle_deg','spray_angle_deg')],
            bounds=([40,1,-85],[120,70,85]),diff_step=.003,max_nfev=65)
        candidates.append(evaluate(fit.x)[0])
    accepted = sorted((r for r in candidates if r['physical_constraints_pass']),key=lambda r:(r['score'],abs(r['landing_angle_residual_deg'])))
    distinct = []
    for row in accepted:
        if all(abs(row['exit_velocity_mph']-r['exit_velocity_mph'])>=.5 or abs(row['launch_angle_deg']-r['launch_angle_deg'])>=.3 or abs(row['spray_angle_deg']-r['spray_angle_deg'])>=2 for r in distinct):
            distinct.append(row)
    selected = distinct[:25]
    for row in selected:
        _,flight = evaluate([row[k] for k in ('exit_velocity_mph','launch_angle_deg','spray_angle_deg')])
        if pose is not None and len(observations):
            samples = np.array([(q.t_s,q.x_ft,q.y_ft,q.z_ft) for q in flight.points])
            xyz = np.column_stack([np.interp(times,samples[:,0],samples[:,axis]) for axis in (1,2,3)])
            uv,visible = project_with_camera_pose(xyz,pose['intrinsics'],pose['rotation'],pose['translation'])
            if visible.all() and np.isfinite(uv).all():
                row['projected_path_rmse_px'] = float(np.sqrt(np.mean(np.sum((uv-pixels)**2,axis=1))))
                row['projected_pixels'] = uv.tolist()
    points = []
    if selected:
        _,flight = evaluate([selected[0][k] for k in ('exit_velocity_mph','launch_angle_deg','spray_angle_deg')])
        indices = sorted(set(np.linspace(0,len(flight.points)-1,min(90,len(flight.points))).astype(int)))
        points = [dict(relative_time_s=flight.points[i].t_s,x_ft=flight.points[i].x_ft,
                       y_ft=flight.points[i].y_ft,z_ft=flight.points[i].z_ft) for i in indices]
    return dict(used=True,acceptable=bool(selected),candidates=selected,trajectory_points=points,
        target_distance_ft=distance,distance_tolerance_ft=distance_tolerance,
        target_hang_time_s=hang,hang_time_tolerance_s=time_tolerance,
        candidate_count=len(accepted),ranking_policy='distance_and_hang_time_only',
        video_alignment=dict(used_for_ranking=False,calibration_usable=bool(pose is not None and
            (pose.get('calibration_diagnostics') or {}).get('usable_for_velocity',True)),
            best_rmse_px=selected[0].get('projected_path_rmse_px') if selected else None),
        contact_origin_ft=[0.,0.,contact_height],
        assumptions='Estimated spin, default environment, contact anchored above home plate; camera projection is diagnostic only.',
        ranges={key:[min(r[key] for r in accepted),max(r[key] for r in accepted)] for key in
                ('exit_velocity_mph','launch_angle_deg','distance_ft','hang_time_s')} if accepted else {})
