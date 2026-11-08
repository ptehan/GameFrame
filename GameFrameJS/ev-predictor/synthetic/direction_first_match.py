from observation_validation import is_usable_flight_observation
"""Lock video launch, then compare nearby spray and time-matched speeds."""
import math
import sqlite3
from collections import defaultdict
from contextlib import closing
from pathlib import Path

import numpy as np

from baseball_flight import Hit, StartPosition, simulate_trajectory
from match_vantage_grid import project_with_camera_pose
from observation_validation import reject_early_anchor_arrivals
from contact_timing import prepare_contact_observations


def with_contact_registration(pose, package):
    """Record clicked-ray contact registration and its explicit soft depth prior."""
    plate = next((r for r in package.get('landmarks',[]) if r.get('landmark')=='home_plate'
                  and r.get('image_x') is not None and r.get('image_y') is not None), None)
    contact = next((r for r in package.get('ball_observations',[]) if isinstance(r.get('relative_time_s'),(int,float))
                    and abs(r['relative_time_s'])<1e-6 and r.get('image_x') is not None and r.get('image_y') is not None), None)
    if contact is None:
        return pose
    def allowance(row):
        value = row.get('uncertainty_px',12.)
        return float(value) if isinstance(value,(int,float)) and math.isfinite(value) and value>0 else 12.
    result = {**pose, 'marked_home_plate_px':[plate['image_x'],plate['image_y']] if plate else [0.,0.],
              'contact_registration_tolerance_px':max(12.,math.hypot(allowance(plate or {}),allowance(contact)))}
    result['contact_height_prior_ft'] = float(((package.get('hit') or {}).get('contact') or {}).get('height_ft') or pose.get('contact_height_prior_ft',2.5))
    pixel = np.array([contact['image_x'],contact['image_y']],dtype=float)
    origin,error = home_plate_contact(pixel,result)
    projected,_ = project_with_camera_pose(np.array([[0.,0.,0.],origin]),result['intrinsics'],result['rotation'],result['translation'])
    result['contact_registration'] = dict(
        marked_home_plate_px=result['marked_home_plate_px'],marked_contact_px=pixel.tolist(),
        observed_contact_minus_plate_px=(pixel-np.asarray(result['marked_home_plate_px'])).tolist(),
        predicted_contact_minus_plate_px=(projected[1]-projected[0]).tolist(),
        residual_px=error,allowance_px=result['contact_registration_tolerance_px'],
        plate_mark_allowance_px=allowance(plate or {}),contact_mark_allowance_px=allowance(contact),
        origin_ft=origin.tolist(),horizontal_anchor='contact_pixel_ray',pixel_offset_is_acceptance_gate=False,
        depth_source='soft_batter_area_height_prior',position_prior_sigma_ft=result.get('contact_position_prior_sigma_ft',[5.,5.,1.]))
    return result


def contact_ray_origin(pixel, pose):
    """Honor the contact click exactly; use a soft prior only for unknown depth.

    A single image ray does not measure depth. Select its nearest weighted point
    to the batter-area/height prior, allowing all three coordinates to move.
    No coordinate is pinned to home plate and no image offset is subtracted.
    """
    target = np.asarray(pixel, dtype=float)
    invalid = (np.full(3, np.nan), float('inf'))
    if target.shape != (2,) or not np.isfinite(target).all():
        return invalid
    try:
        rotation = np.asarray(pose['rotation'])
        center = -rotation.T @ np.asarray(pose['translation'])
        ray = rotation.T @ np.linalg.solve(np.asarray(pose['intrinsics']), np.r_[target, 1.])
        reference = np.asarray(pose.get('contact_position_prior_ft',
            [0., 0., float(pose.get('contact_height_prior_ft', 2.5))]), dtype=float)
        sigma = np.asarray(pose.get('contact_position_prior_sigma_ft', [5., 5., 1.]), dtype=float)
        if not np.isfinite(reference).all() or not np.isfinite(sigma).all() or np.any(sigma <= 0):
            return invalid
        weights = 1. / sigma**2
        depth = float(np.dot(weights * ray, reference-center) / np.dot(weights * ray, ray))
        if not math.isfinite(depth) or depth <= 0:
            return invalid
        origin = center + depth * ray
        projected, visible = project_with_camera_pose(origin[None, :], pose['intrinsics'], rotation, pose['translation'])
        if not visible[0] or not np.isfinite(projected).all():
            return invalid
        return origin, float(np.linalg.norm(projected[0]-target))
    except (ValueError, KeyError, np.linalg.LinAlgError):
        return invalid


def home_plate_contact(pixel, pose):
    """Compatibility name: contact follows the clicked ray, never a plate lock."""
    return contact_ray_origin(pixel, pose)


def registered_origin(pixel, pose, bearing_deg):
    """Register the 3D flight origin to the user's actual contact pixel."""
    origin, error = contact_ray_origin(pixel, pose)
    return origin if math.isfinite(error) and np.isfinite(origin).all() else None


def refine_spray_at_fixed_launch(candidates, key, origin, pose, times, pixels, anchor, bearing_deg, half_width=5.0):
    """Search nearby spray and speed using the same physics, launch and spin."""
    observed_delta = pixels - anchor
    observed = np.arctan2(observed_delta[:, 1], observed_delta[:, 0])
    refined = []
    # Include the original angle as well as a one-degree grid around it.
    sprays = [key[1] + offset for offset in range(-math.floor(half_width), math.floor(half_width) + 1)]
    by_speed = {c['exit_velocity_mph']:c for c in candidates}
    # Extension grids can omit an interior band (e.g. 67-100 mph). Simulate
    # those speeds too; min/max coverage alone does not mean a complete family.
    stored_speeds = sorted(by_speed)
    if stored_speeds:
        for speed in range(math.ceil(stored_speeds[0]), math.floor(stored_speeds[-1]) + 1):
            if speed not in by_speed:
                nearest = min(stored_speeds, key=lambda existing: abs(existing - speed))
                by_speed[speed] = {**by_speed[nearest], 'exit_velocity_mph': float(speed)}
    for speed, source in sorted(by_speed.items()):
        for spray in sprays:
            flight = simulate_trajectory(Hit(speed, key[0], spray, batter_hand=key[4],
                estimate_spin=False, backspin_rpm=key[2], sidespin_rpm=key[3]), start=StartPosition(*origin))
            landing = math.degrees(math.atan2(flight.landing_x_ft, flight.landing_y_ft))
            map_error = (landing - bearing_deg + 180) % 360 - 180
            if abs(map_error) > half_width or flight.points[-1].t_s < times[-1]:
                continue
            time_axis = [p.t_s for p in flight.points]
            xyz = np.column_stack([np.interp(times, time_axis, [getattr(p, a) for p in flight.points])
                                   for a in ('x_ft', 'y_ft', 'z_ft')])
            uv, visible = project_with_camera_pose(xyz, pose['intrinsics'], pose['rotation'], pose['translation'])
            if not np.all(visible) or not np.isfinite(uv).all():
                continue
            delta = uv - anchor
            error = np.arctan2(delta[:, 1], delta[:, 0]) - observed
            error = np.degrees(np.arctan2(np.sin(error), np.cos(error)))
            refined.append({**source, 'hit_id':f"refined_ev{speed:g}_la{key[0]:g}_spray{spray:g}",
                'source_hit_id':source['hit_id'], 'spray_angle_deg':spray, 'estimate_spin':0,
                'direction_mse':float(np.mean(error**2)),
                'projected_path_rmse_px':float(np.sqrt(np.mean(np.sum((uv-pixels)**2,axis=1)))),
                'projected_pixels':uv.tolist(), 'landing_spray_angle_deg':landing,
                'landing_angle_residual_deg':map_error, 'distance_ft':flight.distance_ft,
                'hang_time_s':flight.hang_time_s, 'apex_ft':flight.apex_ft, 'apex_time_s':flight.apex_time_s,
                'landing_x_ft':flight.landing_x_ft, 'landing_y_ft':flight.landing_y_ft})
    return refined


def match_direction_first(observations, pose, bearing_deg, database, distance_ft=None, distance_sigma_ft=12.0, frame_step_s=1 / 30):
    observations = prepare_contact_observations(observations)
    observations, rejected = reject_early_anchor_arrivals(observations, frame_step_s)
    if not (pose.get('calibration_diagnostics') or {}).get('usable_for_velocity', True):
        return {'used': False, 'reason': 'camera calibration is not usable for velocity'}
    clean = [r for r in observations if r.get('image_x') is not None and r.get('image_y') is not None
             and np.isfinite([r['image_x'], r['image_y'], r.get('relative_time_s', -1)]).all()]
    contact = next((r for r in clean if abs(float(r.get('relative_time_s', -1))) < 1e-6), None)
    rows = sorted((r for r in clean if 0 < r['relative_time_s'] <= .45
                   and r.get('role') != 'CONTACT_POINT'
                   and is_usable_flight_observation(r)),
                  key=lambda r:r['relative_time_s'])
    if contact is None or not rows:
        return {'used': False, 'reason': 'need contact mark and a timed flight point'}
    times = np.array([r['relative_time_s'] for r in rows])
    if times[-1] < .15:
        return {'used': False, 'reason': 'insufficient free-flight time span'}
    anchor = np.array([contact['image_x'], contact['image_y']])
    origin = registered_origin(anchor, pose, bearing_deg)
    if origin is None:
        return {'used': False, 'reason': 'contact ray does not give a plausible common starting point'}
    pixels = np.array([[r['image_x'], r['image_y']] for r in rows])
    observed_delta = pixels-anchor
    if np.any(np.linalg.norm(observed_delta, axis=1) < 2):
        return {'used': False, 'reason': 'ball displacement is too small to establish direction'}
    observed_angle = np.arctan2(observed_delta[:, 1], observed_delta[:, 0])
    groups = defaultdict(list)
    with closing(sqlite3.connect(Path(database).resolve().as_uri()+'?mode=ro', uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        hits = {r['hit_id']:dict(r) for r in conn.execute('SELECT * FROM synthetic_hits')}
        family_fields = ('launch_angle_deg','spray_angle_deg','backspin_rpm','sidespin_rpm','batter_hand','estimate_spin')
        metadata_groups = defaultdict(list)
        for h in hits.values():
            metadata_groups[tuple(h[k] for k in family_fields)].append(h)
        allowed = set()
        for key, family in metadata_groups.items():
            errors = [abs((math.degrees(math.atan2(h['landing_x_ft'],h['landing_y_ft']))-bearing_deg+180)%360-180) for h in family]
            if len({h['exit_velocity_mph'] for h in family})>=2 and float(np.median(errors))<=5.0:
                allowed.add(key)
        for hit_id, h in hits.items():
            key = tuple(h[k] for k in family_fields)
            if key not in allowed:
                continue
            # Use the (hit_id,time) index instead of scanning every full flight.
            data = np.asarray([tuple(r) for r in conn.execute(
                'SELECT relative_time_s,x_ft,y_ft,z_ft FROM trajectory_points WHERE hit_id=? AND relative_time_s<=? ORDER BY relative_time_s',
                (hit_id,float(times[-1])+.05))])
            if len(data)<2 or data[0,0]!=0 or data[-1,0]<times[-1]:
                continue
            xyz = np.column_stack([np.interp(times,data[:,0],data[:,a]) for a in (1,2,3)])
            xyz += origin-data[0,1:]
            uv, visible = project_with_camera_pose(xyz, pose['intrinsics'], pose['rotation'], pose['translation'])
            if not np.all(visible) or not np.isfinite(uv).all():
                continue
            delta = uv-anchor
            error = np.arctan2(delta[:,1],delta[:,0])-observed_angle
            error = np.degrees(np.arctan2(np.sin(error),np.cos(error)))
            landing = math.degrees(math.atan2(h['landing_x_ft'],h['landing_y_ft']))
            landing_error = (landing-bearing_deg+180)%360-180
            groups[key].append({**h, 'direction_mse':float(np.mean(error**2)),
                                'landing_spray_angle_deg':landing,
                                'landing_angle_residual_deg':landing_error,
                                'projected_path_rmse_px':float(np.sqrt(np.mean(np.sum((uv-pixels)**2,axis=1)))),
                                'projected_pixels':uv.tolist()})
    eligible = []
    for key, candidates in groups.items():
        by_speed = defaultdict(list)
        for c in candidates:
            by_speed[c['exit_velocity_mph']].append(c)
        if len(by_speed)<2:
            continue
        # Equal weight per speed: duplicate database rows cannot steer direction.
        direction_error = math.sqrt(float(np.mean([np.mean([c['direction_mse'] for c in cs]) for cs in by_speed.values()])))
        map_error = float(np.median([abs(c['landing_angle_residual_deg']) for c in candidates]))
        if map_error <= 5.0:
            eligible.append((direction_error,key,candidates))
    if not eligible:
        return {'used': False, 'reason': 'no shared-angle speed family consistent with mapped direction'}
    direction_error, key, candidates = min(eligible,key=lambda p:p[0])
    original_spray = key[1]
    refined = refine_spray_at_fixed_launch(candidates, key, origin, pose, times, pixels, anchor, bearing_deg)
    if not refined:
        return {'used':False, 'reason':'no fixed-launch spray candidates within the map direction range'}
    candidates = refined
    baseline = [c['projected_path_rmse_px'] for c in candidates if c['spray_angle_deg'] == original_spray]
    original_rmse = min(baseline) if baseline else None
    uses_distance = distance_ft is not None and math.isfinite(float(distance_ft)) and distance_ft>0
    for c in candidates:
        c['score'] = (c['projected_path_rmse_px']/6.0)**2
        c['distance_z'] = (c['distance_ft']-distance_ft)/max(1.,distance_sigma_ft) if uses_distance else 0.
        if uses_distance:
            c['score'] += c['distance_z']**2
        c['score_policy'] = 'fixed_launch_then_spray_speed_and_distance' if uses_distance else 'fixed_launch_then_spray_and_speed'
        c['distance_score_weight'] = 1.0 if uses_distance else 0.0
    candidates.sort(key=lambda c:c['score'])
    best = candidates[0]
    direction_error = math.sqrt(best['direction_mse'])
    key = (key[0], best['spray_angle_deg'], *key[2:])
    speeds = sorted({c['exit_velocity_mph'] for c in candidates})
    at_speed_boundary = best['exit_velocity_mph'] in (speeds[0], speeds[-1])
    # Generate the full physical flight at the shared registered height for export.
    flight = simulate_trajectory(Hit(best['exit_velocity_mph'], key[0], key[1], batter_hand=key[4],
        estimate_spin=False, backspin_rpm=key[2], sidespin_rpm=key[3]), start=StartPosition(*origin))
    best = {**best,'distance_ft':flight.distance_ft,'hang_time_s':flight.hang_time_s,
            'apex_ft':flight.apex_ft,'apex_time_s':flight.apex_time_s,
            'landing_x_ft':flight.landing_x_ft,'landing_y_ft':flight.landing_y_ft,
            'landing_spray_angle_deg':math.degrees(math.atan2(flight.landing_x_ft,flight.landing_y_ft))}
    candidates[0] = best
    residual = np.asarray(best['projected_pixels']) - pixels
    radial = observed_delta / np.linalg.norm(observed_delta, axis=1)[:, None]
    along = np.sum(residual * radial, axis=1)
    across = residual[:, 0] * -radial[:, 1] + residual[:, 1] * radial[:, 0]
    errors = np.linalg.norm(residual, axis=1)
    return {'used':True, 'acceptable':direction_error<=2.0 and best['projected_path_rmse_px']<=12.0,
            'rejected_observations':rejected,
            'independently_validated':False, 'uses_landing_distance':bool(uses_distance),
            'used_count':len(rows),'direction_rmse_deg':direction_error,
            'available_speed_range_mph':[speeds[0],speeds[-1]], 'at_speed_boundary':at_speed_boundary,
            'contact_origin_ft':origin.tolist(),'common_launch_angle_deg':key[0],
            'common_spray_angle_deg':key[1], 'families_checked':len(eligible),
            'spray_refinement':{'used':True, 'map_bearing_deg':bearing_deg, 'map_half_width_deg':5.0,
                'step_deg':1.0, 'initial_spray_deg':original_spray, 'selected_spray_deg':key[1],
                'initial_best_rmse_px':original_rmse, 'tested_candidates':len(candidates),
                'launch_locked':True, 'spin_locked':True, 'camera_locked':True, 'origin_locked':True,
                'at_search_boundary':abs(key[1]-original_spray)>=5.0 or abs(best['landing_angle_residual_deg'])>=4.5},
            'launch_angle_source':'video_path_direction_with_calibrated_camera',
            'pixel_error': {
                'definition':'RMS Euclidean distance between observed and projected ball centers at matching timestamps, in source-image pixels',
                'rmse_px':float(np.sqrt(np.mean(errors**2))),
                'max_px':float(np.max(errors)),
                'along_path_rmse_px':float(np.sqrt(np.mean(along**2))),
                'across_path_rmse_px':float(np.sqrt(np.mean(across**2))),
                'acceptance_limit_px':12.0,
                'points':[{'time_s':float(t),'observed_px':p.tolist(),'projected_px':q.tolist(),
                           'error_px':float(e),'along_path_px':float(a),'across_path_px':float(c)}
                          for t,p,q,e,a,c in zip(times,pixels,np.asarray(best['projected_pixels']),errors,along,across)],
            },
            'assumptions':'Video launch locked before fitting; nearby spray and speed compared using the same flight engine with fixed spin, camera and origin; mapped landing bearing is a +/-5 degree range, not an exact target.',
            'best':best,'candidates':candidates,
            'trajectory_points':[{'relative_time_s':p.t_s,'x_ft':p.x_ft,'y_ft':p.y_ft,'z_ft':p.z_ft} for p in flight.points]}
