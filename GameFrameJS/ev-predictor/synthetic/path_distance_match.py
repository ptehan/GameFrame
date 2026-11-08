from observation_validation import is_usable_flight_observation
"""Match timed video positions and landing distance with direction uncertainty."""
import math
import sqlite3
import time
from contextlib import closing
from pathlib import Path

import numpy as np

from direction_first_match import registered_origin
from match_vantage_grid import project_with_camera_pose
from observation_validation import reject_early_anchor_arrivals
from contact_timing import prepare_contact_observations
from refine_path_distance import refine_candidates
from distance_review import distinct_alternatives
from prediction_cancel import check_cancelled


def manual_path_tolerance(rows, anchor):
    """Bound mark uncertainty independently of the supplied landing distance."""
    uncertainties = []
    for row in rows:
        value = row.get('uncertainty_px')
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            return 12.0
        uncertainties.append(value)
    displacement = max(math.hypot(r['image_x'] - anchor[0], r['image_y'] - anchor[1]) for r in rows)
    return max(12.0, min(30.0, min(uncertainties), displacement * .05))


def rank_candidates(candidates, distance_ft, path_slack_px=2.0, max_error_px=12.0, distance_tolerance_ft=12.0):
    """Require both measured constraints; retain a diagnostic if none qualifies."""
    best_error = min(c['projected_path_rmse_px'] for c in candidates)
    limit = min(max_error_px, best_error + path_slack_px)
    uses_distance = distance_ft is not None and math.isfinite(distance_ft) and distance_ft > 0
    if uses_distance:
        limit = max_error_px
        shortlist = [c for c in candidates if c['projected_path_rmse_px'] <= max_error_px
                     and c.get('projected_path_max_error_px', c['projected_path_rmse_px']) <= 2 * max_error_px
                     and abs(c['distance_ft']-distance_ft) <= distance_tolerance_ft]
    else:
        shortlist = [c for c in candidates if c['projected_path_rmse_px'] <= limit]
    joint_fit_found = bool(shortlist)
    # Keep a diagnostic result when no candidate passes, without fitting distance.
    if not shortlist:
        uses_distance = False
        shortlist = [c for c in candidates if c['projected_path_rmse_px'] <= max_error_px] or candidates
    for c in shortlist:
        c['distance_error_ft'] = abs(c['distance_ft'] - distance_ft) if distance_ft is not None else None
        c['score'] = ((c['projected_path_rmse_px']/max_error_px)**2 +
                      (c['distance_error_ft']/distance_tolerance_ft)**2) if uses_distance else c['projected_path_rmse_px']
        c['score_policy'] = 'joint_path_and_distance' if uses_distance else 'timed_pixel_error'
        if c.get('hang_time_error_s') is not None:
            # Compare normalized uncertainties, not seconds against raw pixels.
            if not uses_distance:
                c['score'] = (c['projected_path_rmse_px'] / max_error_px) ** 2
            c['score'] += (c['hang_time_error_s'] / c['hang_time_tolerance_s']) ** 2
            c['score_policy'] += '_and_hang_time'
        c['distance_score_weight'] = float(uses_distance)
    shortlist.sort(key=lambda c: (c['score'], c['projected_path_rmse_px'], c['hit_id']))
    return shortlist, {'best_path_rmse_px': best_error, 'path_limit_px': limit,
                       'path_slack_px': path_slack_px, 'max_error_px': max_error_px,
                       'target_distance_ft': distance_ft, 'uses_distance': uses_distance,
                       'distance_tolerance_ft':distance_tolerance_ft, 'joint_fit_found':joint_fit_found}


def match_path_and_distance(observations, pose, bearing_deg, database, distance_ft=None,
                            frame_step_s=1/30, half_width_deg=6.0, distance_tolerance_ft=12.0,
                            refine=True, terminal_event=None):
    started = time.perf_counter()
    observations = prepare_contact_observations(observations)
    observations, rejected = reject_early_anchor_arrivals(observations, frame_step_s)
    if not (pose.get('calibration_diagnostics') or {}).get('usable_for_velocity', True):
        return {'used': False, 'reason': 'camera calibration is not usable for velocity'}
    terminal = terminal_event or {}
    hang = terminal.get('relative_time_s') if terminal.get('type') == 'FIRST_GROUND_CONTACT' else None
    if not isinstance(hang, (int, float)) or not math.isfinite(hang) or hang <= 0:
        hang = None
    uncertainty = terminal.get('timing_uncertainty_s')
    if not isinstance(uncertainty, (int, float)) or not math.isfinite(uncertainty) or uncertainty <= 0:
        uncertainty = float(frame_step_s)
    hang_tolerance = max(float(frame_step_s), float(uncertainty))

    clean = [r for r in observations if all(r.get(k) is not None for k in
             ('image_x', 'image_y', 'relative_time_s')) and
             np.isfinite([r['image_x'], r['image_y'], r['relative_time_s']]).all()]
    manual = [r for r in clean if str(r.get('source', '')).upper() in {'HUMAN', 'MANUAL', 'USER', 'MODEL_ANCHOR'}]
    has_manual_anchors = (any(abs(r['relative_time_s']) < 1e-6 for r in manual)
                          and any(.15 <= r['relative_time_s'] and r.get('role') != 'CONTACT_POINT'
                                  for r in manual))
    ignored_automatic_count = len(clean) - len(manual) if has_manual_anchors else 0
    if has_manual_anchors:
        # User-marked contact and later position are the independent observations.
        # Detector samples guided by those anchors must not overrule them.
        clean = [r for r in clean if r in manual or r.get("human_reviewed") is True]
    contact = next((r for r in clean if abs(r['relative_time_s']) < 1e-6), None)
    rows = sorted((r for r in clean if 0 < r['relative_time_s'] <= 2/3 + frame_step_s*.5 and (r in manual or r.get('human_reviewed') is True or r['relative_time_s'] <= .45) and
                   r.get('role') not in {'CONTACT_POINT', 'FIRST_GROUND_CONTACT', 'GROUND_CONTACT', 'TERMINAL', 'CATCH'} and
                   (hang is None or r['relative_time_s'] < hang - frame_step_s) and
                   is_usable_flight_observation(r)),
                  key=lambda r: r['relative_time_s'])
    if contact is None or not rows or rows[-1]['relative_time_s'] < .15:
        return {'used': False, 'reason': 'need contact and a timed flight point at least 0.15 seconds later'}
    times = np.array([r['relative_time_s'] for r in rows])
    pixels = np.array([[r['image_x'], r['image_y']] for r in rows])
    anchor = np.array([contact['image_x'], contact['image_y']])
    contact_origin = registered_origin(anchor, pose, bearing_deg)
    if contact_origin is None:
        return {'used': False, 'reason': 'camera calibration cannot project the starting point; review the video field marks and camera setup'}
    delta = pixels - anchor
    max_error_px = manual_path_tolerance(rows, anchor) if has_manual_anchors else 12.0
    if np.max(np.linalg.norm(delta, axis=1)) < 2:
        return {'used': False, 'reason': 'ball displacement is too small'}

    # Later manual sightings constrain flight duration even when their image
    # positions are outside the early-camera fit. A landing is not a sighting
    # that proves the ball remains airborne at that instant.
    airborne_times = [r['relative_time_s'] for r in clean
                      if (r in manual or r.get('human_reviewed') is True)
                      and r['relative_time_s'] > 0
                      and r.get('role') not in {'FIRST_GROUND_CONTACT', 'GROUND_CONTACT', 'TERMINAL'}
                      and (hang is None or r['relative_time_s'] < hang - frame_step_s)]
    minimum_hang = max([float(times[-1]), *[t - frame_step_s for t in airborne_times]])
    timing_evidence = {'used': hang is not None or bool(airborne_times),
                       'landing_time_s': hang, 'tolerance_s': hang_tolerance if hang is not None else None,
                       'minimum_airborne_time_s': minimum_hang}

    def timing_matches(candidate):
        duration = candidate['hang_time_s']
        return duration >= minimum_hang and (hang is None or abs(duration - hang) <= hang_tolerance)

    with closing(sqlite3.connect(Path(database).resolve().as_uri()+'?mode=ro', uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        uniform_grid = bool(conn.execute("SELECT 1 FROM sqlite_master WHERE name='generation_manifest'").fetchone())
        database_count = conn.execute('SELECT COUNT(*) FROM synthetic_hits').fetchone()[0]
        query = 'SELECT * FROM synthetic_hits'
        parameters = []
        clauses = []
        if uniform_grid:
            # Uniform-grid bearings are stored in actual degrees. Apply known
            # landing constraints before fetching trajectory samples.
            if half_width_deg < 180:
                center = (bearing_deg+180)%360-180
                low, high = center-half_width_deg, center+half_width_deg
                if low < -180:
                    clauses.append('(landing_spray_angle_deg>=? OR landing_spray_angle_deg<=?)')
                    parameters.extend([low+360,high])
                elif high > 180:
                    clauses.append('(landing_spray_angle_deg>=? OR landing_spray_angle_deg<=?)')
                    parameters.extend([low,high-360])
                else:
                    clauses.append('landing_spray_angle_deg BETWEEN ? AND ?')
                    parameters.extend([low,high])
            if distance_ft is not None and math.isfinite(distance_ft) and distance_ft > 0:
                clauses.append('distance_ft BETWEEN ? AND ?')
                parameters.extend([distance_ft-distance_tolerance_ft,distance_ft+distance_tolerance_ft])
            clauses.append('hang_time_s>=?')
            parameters.append(float(times[-1]))
        if clauses:
            query += ' WHERE ' + ' AND '.join(clauses)
        query += (' AND ' if clauses else ' WHERE ') + 'hang_time_s>=?'
        parameters.append(minimum_hang)
        if hang is not None:
            query += ' AND hang_time_s BETWEEN ? AND ?'
            parameters.extend([hang - hang_tolerance, hang + hang_tolerance])
        hits = [dict(r) for r in conn.execute(query,parameters)]
        selected, origins = {}, {}
        for h in hits:
            check_cancelled()
            # The map marks the landing bearing, not the ball's initial spray.
            landing = math.degrees(math.atan2(h['landing_x_ft'], h['landing_y_ft']))
            error = (landing - bearing_deg + 180) % 360 - 180
            if abs(error) > half_width_deg:
                continue
            spray = h['spray_angle_deg']
            if spray not in origins:
                origins[spray] = contact_origin
            if origins[spray] is None:
                continue
            selected[h['hit_id']] = {**h, 'landing_spray_angle_deg': landing,
                                     'landing_angle_residual_deg': error}
        # One indexed batch read instead of thousands of Python/SQLite calls.
        # Temporary IDs leave the source database read-only.
        conn.execute('CREATE TEMP TABLE match_ids(hit_id TEXT PRIMARY KEY)')
        conn.executemany('INSERT INTO match_ids VALUES (?)', [(k,) for k in selected])
        conn.execute('CREATE TEMP TABLE match_times(t REAL PRIMARY KEY)')
        conn.executemany('INSERT INTO match_times VALUES (?)', [(float(t),) for t in sorted({0., *times})])
        samples = {}
        # Fetch only the two bracketing samples for each requested timestamp.
        # This also handles nonuniform trajectory sampling without assuming dt.
        for r in conn.execute('''WITH brackets AS (
                SELECT (SELECT rowid FROM trajectory_points p WHERE p.hit_id=m.hit_id
                        AND p.relative_time_s<=t.t ORDER BY p.relative_time_s DESC LIMIT 1) AS rid
                FROM match_ids m CROSS JOIN match_times t
                UNION
                SELECT (SELECT rowid FROM trajectory_points p WHERE p.hit_id=m.hit_id
                        AND p.relative_time_s>=t.t ORDER BY p.relative_time_s LIMIT 1) AS rid
                FROM match_ids m CROSS JOIN match_times t)
                SELECT p.hit_id,p.relative_time_s,p.x_ft,p.y_ft,p.z_ft
                FROM brackets b JOIN trajectory_points p ON p.rowid=b.rid
                ORDER BY p.hit_id,p.relative_time_s'''):
            samples.setdefault(r[0], []).append(tuple(r)[1:])
        candidate_rows, xyzs, shifts = [], [], []
        for hit_id, points in samples.items():
            check_cancelled()
            data = np.asarray(points)
            if len(data) < 2 or data[0,0] != 0 or data[-1,0] < times[-1]:
                continue
            h = selected[hit_id]
            shift = origins[h['spray_angle_deg']] - data[0,1:]
            xyzs.append(np.column_stack([np.interp(times, data[:,0], data[:,a]) for a in (1,2,3)]) + shift)
            shifts.append(shift)
            candidate_rows.append(h)
        if not candidate_rows:
            return {'used': False, 'reason': 'no stored trajectories satisfy the landing direction, distance and observed duration', 'hang_time_evidence': timing_evidence}
        # Project every candidate in a single NumPy operation.
        xyz = np.asarray(xyzs)
        uv, visible = project_with_camera_pose(xyz.reshape(-1,3), pose['intrinsics'], pose['rotation'], pose['translation'])
        uv = uv.reshape(len(xyz), len(times), 2)
        valid = visible.reshape(len(xyz), len(times)).all(axis=1) & np.isfinite(uv).all(axis=(1,2))
        rmses = np.sqrt(np.mean(np.sum((uv-pixels)**2, axis=2), axis=1))
        candidates = [{**h, 'projected_path_rmse_px':float(rmses[i]),
                       'projected_path_max_error_px':float(np.linalg.norm(uv[i]-pixels, axis=1).max()),
                       'projected_pixels':uv[i].tolist(), '_shift':shifts[i].tolist()}
                      for i,h in enumerate(candidate_rows) if valid[i]]
        if not candidates:
            return {'used': False, 'reason': 'no visible projected trajectories'}
        stored_fit = any(c['projected_path_rmse_px'] <= max_error_px
                         and c['projected_path_max_error_px'] <= 2 * max_error_px
                         and (distance_ft is None or abs(c['distance_ft'] - distance_ft) <= distance_tolerance_ft)
                         and timing_matches(c) for c in candidates)
        # A complete grid still has gaps between sampled launch/spray angles.
        # Try the same physics between samples before rejecting an honest mark.
        refinement_enabled = refine and (not uniform_grid or not stored_fit or min(c['projected_path_rmse_px'] for c in candidates) > .25)
        additions = refine_candidates(candidates,pose,anchor,times,pixels,bearing_deg,
            half_width_deg,distance_ft,distance_tolerance_ft,
            hang_time_s=hang, hang_time_tolerance_s=hang_tolerance) if refinement_enabled else []
        candidates.extend(additions)
        candidates = [c for c in candidates if timing_matches(c)]
        if not candidates:
            return {'used': False, 'reason': 'no trajectories satisfy the observed flight duration', 'hang_time_evidence': timing_evidence}
        if hang is not None:
            for candidate in candidates:
                candidate['hang_time_error_s'] = abs(candidate['hang_time_s'] - hang)
                candidate['hang_time_tolerance_s'] = hang_tolerance
        path_only = sorted(candidates, key=lambda c: (c['projected_path_rmse_px'], c['hit_id']))
        ranked, policy = rank_candidates(candidates, distance_ft, max_error_px=max_error_px,
                                         distance_tolerance_ft=distance_tolerance_ft)
        policy['pixel_tolerance_source'] = 'bounded_manual_mark_uncertainty' if has_manual_anchors else 'fixed_video_tolerance'
        best = ranked[0]
        full = conn.execute('''SELECT relative_time_s,x_ft,y_ft,z_ft FROM trajectory_points
                            WHERE hit_id=? ORDER BY relative_time_s''', (best['hit_id'],)).fetchall()
    # Keep the exact selected database curve; do not re-simulate and change ranking.
    trajectory = best.get('_trajectory_points')
    if trajectory is None:
        # Export the same registered curve that was projected and scored above.
        # Stored simulations start at (0, 2, 2.5), not the marked contact origin.
        shift = np.asarray(best.get('_shift',[0.,0.,0.]))
        trajectory = [{'relative_time_s':r[0], 'x_ft':r[1]+float(shift[0]),
                       'y_ft':r[2]+float(shift[1]), 'z_ft':r[3]+float(shift[2])} for r in full]
    residual = np.asarray(best['projected_pixels']) - pixels
    radial = delta / np.maximum(np.linalg.norm(delta, axis=1),1e-9)[:,None]
    along = np.sum(residual*radial, axis=1)
    across = residual[:,0]*-radial[:,1] + residual[:,1]*radial[:,0]
    errors = np.linalg.norm(residual, axis=1)
    predicted_delta = np.asarray(best['projected_pixels']) - anchor
    angle_error = np.arctan2(predicted_delta[:,1],predicted_delta[:,0]) - np.arctan2(delta[:,1],delta[:,0])
    direction_error = float(np.sqrt(np.mean(np.degrees(np.arctan2(np.sin(angle_error),np.cos(angle_error)))**2)))
    speeds = [c['exit_velocity_mph'] for c in candidates]
    origin = np.asarray(best.get('_origin', origins.get(best['spray_angle_deg'])))
    for c in candidates:
        c.pop('_shift', None)
        c.pop('_trajectory_points', None)
        c.pop('_origin', None)
    supported = [c for c in candidates if c['projected_path_rmse_px'] <= max_error_px
                 and c.get('projected_path_max_error_px',c['projected_path_rmse_px']) <= 2*max_error_px
                 and (distance_ft is None or abs(c['distance_ft']-distance_ft)<=distance_tolerance_ft)]
    supported_ranges = {key:[min(c[key] for c in supported),max(c[key] for c in supported)]
                        for key in ('exit_velocity_mph','launch_angle_deg','distance_ft','hang_time_s')} if supported else {}
    return {'used':True, 'acceptable':best['projected_path_rmse_px']<=max_error_px and policy['joint_fit_found'],
            'supported_ranges':supported_ranges, 'supported_candidate_count':len(supported),
            'hang_time_evidence': timing_evidence,
            'rejected_observations':rejected, 'independently_validated':False,
            'uses_landing_distance':policy['uses_distance'], 'selection_policy':policy,
            'used_count':len(rows), 'direction_rmse_deg':direction_error,
            'observation_policy': 'manual_anchors' if has_manual_anchors else 'available_timed_points',
            'ignored_automatic_point_count': ignored_automatic_count,
            'available_speed_range_mph':[min(speeds),max(speeds)],
            'at_speed_boundary':best['exit_velocity_mph'] in (min(speeds),max(speeds)),
            'contact_origin_ft':origin.tolist(), 'common_launch_angle_deg':best['launch_angle_deg'],
            'common_spray_angle_deg':best['spray_angle_deg'], 'families_checked':len(selected),
            'spray_refinement':{'used':True, 'map_bearing_deg':bearing_deg, 'map_half_width_deg':half_width_deg,
                'selected_spray_deg':best['spray_angle_deg'], 'tested_candidates':len(candidates),
                'launch_locked':False, 'spin_locked':False, 'camera_locked':True, 'origin_locked':True,
                'at_search_boundary':abs(best['landing_angle_residual_deg'])>=half_width_deg-.5},
            'launch_angle_source':'joint_database_path_and_distance_match',
            'pixel_error':{'definition':'RMS Euclidean error at saved timestamps in source pixels',
                'rmse_px':best['projected_path_rmse_px'], 'max_px':float(max(errors)),
                'along_path_rmse_px':float(np.sqrt(np.mean(along**2))),
                'across_path_rmse_px':float(np.sqrt(np.mean(across**2))), 'acceptance_limit_px':max_error_px,
                'points':[{'time_s':float(t),'observed_px':p.tolist(),'projected_px':q,
                           'error_px':float(e),'along_path_px':float(a),'across_path_px':float(c)}
                          for t,p,q,e,a,c in zip(times,pixels,best['projected_pixels'],errors,along,across)]},
            'refinement':{'enabled':refinement_enabled,'candidate_count':len(additions)},
            'database_grid':'uniform' if uniform_grid else 'legacy_irregular',
            'assumptions':f'Allow mapped landing direction +/-{half_width_deg:g} degrees. '+('Compare stored simulations from the complete uniform grid with a fixed camera. ' if uniform_grid else 'Refine stored candidates with the same flight engine and fixed camera. ')+f'Require video RMS <={max_error_px:g} px, bounded by marking uncertainty, and carry within {distance_tolerance_ft:g} ft of the marked distance when supplied. Launch, spray and speed vary together.',
            'best':best, 'candidates':ranked, 'trajectory_points':trajectory,
            'path_only_candidates':path_only[:25],
            'review_alternatives':distinct_alternatives(path_only, max_error_px),
            'observed_pixels':pixels.tolist(), 'observation_times_s':times.tolist(),
            'contact_pixel':anchor.tolist(),
            'performance':{'elapsed_s':time.perf_counter()-started, 'database_count':database_count,
                           'scored_count':len(candidates), 'trajectory_batch_queries':1}}
