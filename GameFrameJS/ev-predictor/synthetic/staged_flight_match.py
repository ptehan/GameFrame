"""Early spatial launch geometry; later turn timing, never absolute late height."""
import math
import time
from pathlib import Path
import numpy as np
from scipy.optimize import minimize_scalar
from baseball_flight import Hit, StartPosition, simulate_trajectory
from contact_timing import prepare_contact_observations
from direction_first_match import registered_origin
from match_vantage_grid import project_with_camera_pose
from observation_validation import is_usable_flight_observation
from flight_fit_cache import evidence_key, get_fit, put_fit
from prediction_cancel import check_cancelled
from late_flight_timing import late_timing_evidence, timing_score, timing_error_seconds
from late_descent_rate import descent_rate_evidence,compare_descent_rate

MANUAL = {'HUMAN', 'MANUAL', 'USER', 'MODEL_ANCHOR'}
EARLY_END_S = 2 / 3


def spatial_curve_matches(points, curve):
    """Closest curve locations; deliberately does not match timestamps."""
    if len(curve)<2:
        nearest=np.repeat(curve[:1],len(points),axis=0)
        return np.linalg.norm(points-nearest,axis=1),nearest
    a=curve[:-1];delta=curve[1:]-a
    fraction=np.clip(np.sum((points[:,None]-a)*delta,axis=2)/np.maximum(np.sum(delta*delta,axis=1),1e-12),0,1)
    nearest=a+fraction[:,:,None]*delta
    squared=np.sum((points[:,None]-nearest)**2,axis=2)
    indices=np.argmin(squared,axis=1)
    return np.sqrt(squared[np.arange(len(points)),indices]),nearest[np.arange(len(points)),indices]


def early_horizontal_pan(package, early, contact):
    """Register static background to contact; change early X only, never Y."""
    raw = np.array([[r['image_x'], r['image_y']] for r in early], dtype=float)
    if package.get('camera_motion_evidence') is not None:
        return raw, package['camera_motion_evidence']
    diagnostic = {'used': False, 'assumption': 'level camera, horizontal pan allowed, no zoom'}
    source = (package.get('video_metadata') or {}).get('source_path')
    if not source or not Path(source).is_file():
        return raw, {**diagnostic, 'reason': 'source video unavailable for background registration'}
    try:
        import cv2
        cap = cv2.VideoCapture(str(source))
        try:
            meta = package.get('video_metadata') or {}
            source_fps = cap.get(cv2.CAP_PROP_FPS)
            sequential = (meta.get('variable_frame_rate') is False
                          and meta.get('timing_source') == 'source_frame_timestamps'
                          and math.isfinite(source_fps) and source_fps > 0)
            def frame(t):
                target = round(float(t) * source_fps) if sequential else -1
                cursor = round(cap.get(cv2.CAP_PROP_POS_FRAMES))
                if sequential and 0 <= target-cursor <= 15:
                    for _ in range(target-cursor):
                        if not cap.grab():
                            return None
                else:
                    cap.set(cv2.CAP_PROP_POS_MSEC, float(t) * 1000)
                ok, image = cap.read()
                return image if ok else None
            base = frame(contact.get('video_time_s', 0))
            if base is None:
                return raw, {**diagnostic, 'reason': 'contact reference frame unavailable'}
            h, w = base.shape[:2]
            if (meta.get('width_px') and int(meta['width_px']) != w) or (meta.get('height_px') and int(meta['height_px']) != h):
                return raw, {**diagnostic, 'reason': 'source orientation differs from marked frames'}
            mask = np.zeros((h, w), np.uint8)
            mask[round(h / 3):round(h * .611), :] = 255
            orb = cv2.ORB_create(nfeatures=6000)
            reference_keys, reference_desc = orb.detectAndCompute(cv2.cvtColor(base, cv2.COLOR_BGR2GRAY), mask)
            if reference_desc is None:
                return raw, {**diagnostic, 'reason': 'not enough static background features'}
            corrected, checks = raw.copy(), []
            for i, row in enumerate(early):
                check_cancelled()
                image = frame(row.get('video_time_s', 0))
                if image is None or image.shape != base.shape:
                    return raw, {**diagnostic, 'reason': 'early reference frame unavailable'}
                keys, desc = orb.detectAndCompute(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), mask)
                if desc is None:
                    return raw, {**diagnostic, 'reason': 'not enough static background features'}
                pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(desc, reference_desc, k=2)
                good = [a for pair in pairs if len(pair) == 2 for a, b in [pair] if a.distance < .7 * b.distance]
                if len(good) < 40:
                    return raw, {**diagnostic, 'reason': 'background registration is underconstrained'}
                src = np.float32([keys[m.queryIdx].pt for m in good])
                dst = np.float32([reference_keys[m.trainIdx].pt for m in good])
                homography, inliers = cv2.findHomography(src, dst, cv2.RANSAC, 2.)
                if homography is None or int(inliers.sum()) < 30:
                    return raw, {**diagnostic, 'reason': 'background registration failed'}
                errors = np.linalg.norm(cv2.perspectiveTransform(src[:, None, :], homography)[:, 0] - dst, axis=1)
                accepted = errors[inliers.ravel().astype(bool)]
                if float(np.percentile(accepted, 95)) > 3:
                    return raw, {**diagnostic, 'reason': 'background alignment error is too large'}
                point = homography @ np.r_[raw[i], 1.]
                corrected[i, 0] = point[0] / point[2]
                checks.append({'time_s': row['relative_time_s'], 'inliers': int(inliers.sum()),
                               'background_median_error_px': float(np.median(accepted)),
                               'horizontal_correction_px': float(corrected[i, 0] - raw[i, 0])})
            return corrected, {**diagnostic, 'used': True, 'frames': checks}
        finally:
            cap.release()
    except (ImportError, ValueError, OSError, RuntimeError):
        return raw, {**diagnostic, 'reason': 'background registration unavailable'}
    except Exception as error:
        if type(error).__module__.startswith('cv2'):
            return raw, {**diagnostic, 'reason': 'background registration unavailable'}
        raise


def derive_early_hypotheses(early_pixels, pose, origin, bearing_deg, half_width_deg=6., direction_step_deg=.5,
                            variants=((0., 0.), (0., -2.), (0., 2.), (-5., 0.), (5., 0.))):
    """Spatial tangent only: deliberately accepts no speed, later marks or distance."""
    rotation = np.asarray(pose['rotation'])
    center = -rotation.T @ np.asarray(pose['translation'])
    inv = np.linalg.inv(pose['intrinsics'])
    depth_ray = origin - center
    depth_ray /= np.linalg.norm(depth_ray)
    directions=np.arange(bearing_deg-half_width_deg,bearing_deg+half_width_deg+1e-6,direction_step_deg)
    alongs=np.array([[math.sin(math.radians(d)),math.cos(math.radians(d)),0.] for d in directions])
    normals=np.column_stack([alongs[:,1],-alongs[:,0],np.zeros(len(alongs))])
    hypotheses = []
    for depth_delta, vertical_delta in variants:
        start = origin + depth_delta * depth_ray
        observed = np.asarray(early_pixels).copy()
        observed[:, 1] += vertical_delta
        # The camera rays do not depend on the trial hit direction. Form them
        # together once, rather than repeating a matrix product per point for
        # every direction and sensitivity sample.
        pixels_h = np.column_stack([observed, np.ones(len(observed))])
        rays = pixels_h @ (rotation.T @ inv).T
        denominator=normals@rays.T
        valid=np.all(np.abs(denominator)>=1e-8,axis=1)
        depths=np.divide((normals@(start-center))[:,None],denominator,
                         out=np.zeros_like(denominator),where=np.abs(denominator)>=1e-8)
        valid&=np.all(depths>0,axis=1)
        points=center+depths[:,:,None]*rays
        distance=np.einsum('dni,di->dn',points-start,alongs)
        valid&=np.all(distance>0,axis=1)
        indices=np.flatnonzero(valid)
        if not len(indices):continue
        distances=distance[indices];rise=points[indices,:,2]-start[2]
        design=np.stack([distances,distances**2],axis=2)
        # Batched SVD gives the same minimum-norm least-squares solutions as
        # lstsq(rcond=None), without thousands of separate Python calls.
        u,s,vt=np.linalg.svd(design,full_matrices=False)
        cutoff=np.finfo(design.dtype).eps*max(design.shape[1:])*s[:,:1]
        inverse=np.divide(1.,s,out=np.zeros_like(s),where=s>cutoff)
        coefficients=np.einsum('kij,ki->kj',vt,np.einsum('kni,kn->ki',u,rise)*inverse)
        residual=np.einsum('kni,ki->kn',design,coefficients)-rise
        for j,index in enumerate(indices):
            direction=directions[index]
            launch=math.degrees(math.atan(coefficients[j,0]))
            if not 0 < launch < 60:
                continue
            hypotheses.append({'launch_angle_deg': launch, 'spray_angle_deg': float(direction),
                               'origin_ft': start.tolist(), 'depth_delta_ft': depth_delta,
                               'early_y_delta_px': vertical_delta, 'nominal': depth_delta == 0 and vertical_delta == 0,
                               'spatial_residual_ft':float(np.sqrt(np.mean(residual[j]**2)))})
    return hypotheses


def prepare_staged_flight(observations, pose, bearing_deg, frame_step_s=1/30, terminal_event=None,
                          package=None, direction_step_deg=.5, variants=None, use_cache=True,
                          angle_primary=False, fallback_launch_angle=None, adaptive_search=True,use_descent_rate=False):
    started = time.monotonic()
    check_cancelled()
    try:
        key = evidence_key(observations, pose, bearing_deg, frame_step_s, terminal_event,
                           package, direction_step_deg, variants) if use_cache else None
        if use_cache:key=(key,angle_primary,fallback_launch_angle,package is None,adaptive_search,use_descent_rate)
    except (TypeError, ValueError):
        # Cacheability must not change the fitter's handling of invalid rows.
        use_cache, key = False, None
    cached = get_fit(key) if use_cache else None
    if cached is not None:
        cached.update(cache_hit=True, elapsed_s=time.monotonic()-started)
        return cached
    rows = sorted((r for r in prepare_contact_observations(observations)
                   if (str(r.get('source', '')).upper() in MANUAL
                       or (r.get('human_reviewed') is True and is_usable_flight_observation(r)))
                   and all(isinstance(r.get(k), (int, float)) and math.isfinite(r[k])
                           for k in ('relative_time_s', 'image_x', 'image_y'))), key=lambda r:r['relative_time_s'])
    contact = next((r for r in rows if abs(r['relative_time_s']) < 1e-6), None)
    end = (terminal_event or {}).get('relative_time_s') if (terminal_event or {}).get('type') == 'FIRST_GROUND_CONTACT' else None
    if not isinstance(end, (int,float)) or not math.isfinite(end) or end <= 0:
        end = None
    rows = [r for r in rows if r['relative_time_s'] > 0 and r.get('role') not in {'FIRST_GROUND_CONTACT','GROUND_CONTACT','TERMINAL','CATCH'}
            and (end is None or r['relative_time_s'] < end-frame_step_s)]
    early = [r for r in rows if r['relative_time_s'] <= EARLY_END_S + frame_step_s*.5]
    late = [r for r in rows if r['relative_time_s'] > EARLY_END_S + frame_step_s*.5]
    if not angle_primary and (contact is None or len(early) < 2 or not late):
        return None
    context = {'candidates': [], 'early': early, 'late': late, 'bearing_deg': bearing_deg, 'started': started, 'pose': pose, 'angle_primary':angle_primary}
    if contact is None or not early:
        context['reason']='An early ball mark is needed to constrain launch angle.'
        return context
    if not (pose.get('calibration_diagnostics') or {}).get('usable_for_velocity', True):
        context['reason'] = 'Camera calibration is not usable for velocity.'
        return context
    origin = registered_origin([contact['image_x'], contact['image_y']], pose, bearing_deg)
    if origin is None:
        return context
    early_pixels, pan = early_horizontal_pan(package or {}, early, contact)
    registration_seconds = time.monotonic()-started
    kwargs = {} if variants is None else {'variants': variants}
    if angle_primary:
        hypotheses=derive_early_hypotheses(early_pixels,pose,origin,bearing_deg,
            half_width_deg=0.,variants=((0.,0.),)) if len(early)>=2 else []
        if len(early)<2 and isinstance(fallback_launch_angle,(int,float)) and math.isfinite(fallback_launch_angle):
            hypotheses=[dict(launch_angle_deg=float(fallback_launch_angle),spray_angle_deg=float(bearing_deg),
                origin_ft=origin.tolist(),depth_delta_ft=0.,early_y_delta_px=0.,nominal=True)]
    else:
        hypotheses = derive_early_hypotheses(early_pixels, pose, origin, bearing_deg, direction_step_deg=direction_step_deg, **kwargs)
    context.update(origin_ft=origin.tolist(), early_hypotheses=hypotheses, camera_motion=pan)
    times = np.array([r['relative_time_s'] for r in early + late])
    observed = np.array([[r['image_x'], r['image_y']] for r in early + late])
    observed[:len(early)] = early_pixels
    timing_rows=late if package is None else [r for r in late if r.get('camera_registered')]
    late_timing=late_timing_evidence(timing_rows,frame_step_s)
    context['late_timing']=late_timing
    context['late_timing_mark_count']=len(timing_rows)
    descent=descent_rate_evidence(timing_rows,frame_step_s,require_registration=package is not None) if use_descent_rate else {'used':False,'reason':'Descent-rate scoring is disabled.'}
    context['late_descent_rate']=descent
    sample_times=np.unique(np.r_[times,np.arange(0.,max(3.,times[-1]+.1)+.0001,.025)]) if late_timing['used'] or angle_primary else times
    observed_indices=np.searchsorted(sample_times,times)
    simulations=0
    for index, hypothesis in enumerate(hypotheses):
        check_cancelled()
        angle, direction = hypothesis['launch_angle_deg'], hypothesis['spray_angle_deg']
        start = hypothesis['origin_ft']
        cache = {};spatial_cache={};curve_cache={};descent_cache={}
        def evaluate(speed):
            check_cancelled()
            if speed not in cache:
                samples = []
                flight = simulate_trajectory(Hit(float(speed), angle, direction, estimate_spin=True),
                                             start=StartPosition(*start), sample_times=sample_times, _position_buffer=samples)
                data = np.asarray(samples)
                xyz = np.column_stack([np.interp(sample_times,data[:,0],data[:,k]) for k in (1,2,3)])
                all_uv, all_visible = project_with_camera_pose(xyz,pose['intrinsics'],pose['rotation'],pose['translation'])
                apex_time=float(sample_times[np.argmin(all_uv[:,1])]) if all_visible.all() and late_timing['used'] else None
                invalid=np.flatnonzero(~all_visible | ~np.isfinite(all_uv).all(axis=1))
                prefix=int(invalid[0]) if len(invalid) else len(all_uv)
                curve_cache[speed]=all_uv[:prefix].tolist()
                if angle_primary:
                    spatial_cache[speed]=spatial_curve_matches(observed[:len(early)],all_uv[:max(1,prefix)])
                cache[speed] = flight, all_uv[observed_indices], all_visible[observed_indices], apex_time
                descent_cache[speed]=compare_descent_rate(descent,times,all_uv[observed_indices,1],all_visible[observed_indices])
            return cache[speed]
        def rate_fields(speed):
            rate=descent_cache[speed]
            return {'late_descent_rate_used':rate['used'],'late_descent_rate_consistent':rate['consistent'],
                    'late_descent_rate_score':rate['score'],
                    'predicted_descent_rate_px_per_s':rate.get('predicted_rate_px_per_s'),
                    'descent_rate_error_px_per_s':rate.get('error_px_per_s')}
        def cost(speed):
            flight, uv, visible, apex_time = evaluate(speed)
            if flight.hang_time_s < times[-1] or not visible[:len(early)].all():
                return 1e9 + (times[-1]-flight.hang_time_s)**2
            landing=math.degrees(math.atan2(flight.landing_x_ft,flight.landing_y_ft))
            landing_error=(landing-bearing_deg+180)%360-180
            if abs(landing_error)>6:return 1e9+(abs(landing_error)-6)**2
            errors=spatial_cache[speed][0] if angle_primary else np.linalg.norm(uv[:len(early)]-observed[:len(early)],axis=1)
            return float(np.mean(errors**2)/30**2)+timing_score(late_timing,apex_time)+descent_cache[speed]['score']
        grid = list(range(40,121,10))
        seed = min(grid, key=cost)
        fitted = minimize_scalar(cost,bounds=(max(40,seed-10),min(120,seed+10)),method='bounded',options={'xatol':1e-4})
        speed = min([float(fitted.x),float(seed)],key=cost)
        flight, uv, visible, apex_time = evaluate(speed)
        if flight.hang_time_s < times[-1] or not visible[:len(early)].all():
            continue
        errors = uv-observed
        timed_early_errors=np.linalg.norm(errors[:len(early)],axis=1)
        early_errors,early_matches=spatial_cache[speed] if angle_primary else (timed_early_errors,uv[:len(early)])
        late_errors = np.abs(errors[len(early):,1])
        scored = early_errors
        landing = math.degrees(math.atan2(flight.landing_x_ft,flight.landing_y_ft))
        landing_error = (landing-bearing_deg+180)%360-180
        if abs(landing_error)>6:
            continue
        # Materialize the complete curve only once per fitted hypothesis, not
        # on every optimizer trial. Export and animation keep their full detail.
        full_flight = simulate_trajectory(Hit(float(speed), angle, direction, estimate_spin=True), start=StartPosition(*start))
        candidate = {**hypothesis, 'hit_id': f'staged_{index}_ev{speed:.4f}', 'exit_velocity_mph':speed,
                     'distance_ft':flight.distance_ft,'hang_time_s':flight.hang_time_s,'apex_ft':flight.apex_ft,
                     'apex_time_s':flight.apex_time_s,'landing_x_ft':flight.landing_x_ft,'landing_y_ft':flight.landing_y_ft,
                     'landing_spray_angle_deg':landing,'landing_angle_residual_deg':landing_error,
                     'backspin_rpm':flight.backspin_rpm,'sidespin_rpm':flight.sidespin_rpm,'batter_hand':'R','estimate_spin':1,
                     'early_xy_rmse_px':float(np.sqrt(np.mean(early_errors**2))),
                     'early_timed_xy_rmse_px':float(np.sqrt(np.mean(timed_early_errors**2))),
                     'early_position_policy':'spatial_curve_only' if angle_primary else 'timed_positions',
                     'unscored_late_vertical_difference_rms_px':float(np.sqrt(np.mean(late_errors**2))) if late else 0.,
                     'projected_path_rmse_px':float(np.sqrt(np.mean(scored**2))),
                     'projected_path_max_error_px':float(scored.max()),'projected_pixels':uv.tolist(),
                     'projected_curve_pixels':curve_cache[speed],
                     'score_policy':'early_geometry_then_late_height','score':float(np.mean(early_errors**2)/30**2)+timing_score(late_timing,apex_time)+descent_cache[speed]['score'],
                     **rate_fields(speed),
                     'late_evidence_policy':'timing_and_descent_rate' if descent.get('used') else 'timing_only','projected_image_apex_time_s':apex_time,
                     'late_timing_error_s':timing_error_seconds(late_timing,apex_time),
                     'late_timing_used':late_timing['used'] and apex_time is not None,
                     'score_uses_late_horizontal':False,'angle_locked_before_speed':True,
                     '_errors':scored.tolist(),'_early_projection_matches':early_matches.tolist(), '_trajectory':[{'relative_time_s':p.t_s,'x_ft':p.x_ft,'y_ft':p.y_ft,'z_ft':p.z_ft} for p in full_flight.points]}
        context['candidates'].append(candidate)
        if angle_primary:
            # Distance may help select SPEED within the image-supported family;
            # every member retains exactly the independently calculated angle.
            speed_step=.5 if descent.get('used') else 1.
            trial_speeds=set(map(float,np.arange(40,120.001,speed_step)))
            if adaptive_search and late_timing['used']:
                # Only timing bounds prune the speed search. Check the whole
                # domain coarsely first; retain a full 5-mph bracket on either
                # side. Non-monotone/uncertain projections keep the full scan.
                coarse=list(range(40,121,5));turns=[];timing_supported=[]
                for trial in coarse:
                    f,_,v,turn=evaluate(float(trial))
                    turns.append(turn)
                    if (f.hang_time_s>=times[-1] and v[:len(early)].all() and turn is not None
                        and timing_error_seconds(late_timing,turn)<=late_timing['tolerance_s']+.05):
                        timing_supported.append(trial)
                monotone=all(t is not None for t in turns) and np.all(np.diff(turns)>=-.025001)
                if timing_supported and monotone:
                    low=max(40,min(timing_supported)-5);high=min(120,max(timing_supported)+5)
                    if descent.get('used'):
                        rates=[descent_cache[float(s)].get('predicted_rate_px_per_s') for s in timing_supported]
                        rate_supported=[s for s in timing_supported if descent_cache[float(s)]['consistent']]
                        rate_monotone=(all(r is not None for r in rates) and
                            (np.all(np.diff(rates)>=-1e-6) or np.all(np.diff(rates)<=1e-6)))
                        if rate_supported and rate_monotone:
                            low=max(low,min(rate_supported)-5);high=min(high,max(rate_supported)+5)
                    trial_speeds=set(map(float,np.arange(low,high+.001,speed_step)))
                    trial_speeds.update(map(float,coarse))
                    context['search_policy']='coarse_motion_bounds_then_refinement'
            context['candidate_speed_step_mph']=speed_step
            trial_speeds.update(speed+offset for offset in (-2,-1.5,-1,-.5,.5,1,1.5,2))
            for trial_speed in sorted(trial_speeds):
                if not 40<=trial_speed<=120:continue
                if abs(trial_speed-speed)<1e-6:continue
                other,other_uv,other_visible,other_apex=evaluate(trial_speed)
                if other.hang_time_s<times[-1] or not other_visible[:len(early)].all():continue
                difference=other_uv-observed
                timed_ee=np.linalg.norm(difference[:len(early)],axis=1)
                ee,matches=spatial_cache[trial_speed]
                le=np.abs(difference[len(early):,1]);scored_other=ee
                landing_other=math.degrees(math.atan2(other.landing_x_ft,other.landing_y_ft))
                landing_error_other=(landing_other-bearing_deg+180)%360-180
                if abs(landing_error_other)>6:continue
                context['candidates'].append({**candidate,
                    'hit_id':f'staged_{index}_ev{trial_speed:.4f}', 'exit_velocity_mph':trial_speed,
                    'distance_ft':other.distance_ft,'hang_time_s':other.hang_time_s,
                    'apex_ft':other.apex_ft,'apex_time_s':other.apex_time_s,
                    'landing_x_ft':other.landing_x_ft,'landing_y_ft':other.landing_y_ft,
                    'landing_spray_angle_deg':landing_other,'landing_angle_residual_deg':landing_error_other,
                    'backspin_rpm':other.backspin_rpm,'sidespin_rpm':other.sidespin_rpm,
                    'early_xy_rmse_px':float(np.sqrt(np.mean(ee**2))),
                    'early_timed_xy_rmse_px':float(np.sqrt(np.mean(timed_ee**2))),
                    'unscored_late_vertical_difference_rms_px':float(np.sqrt(np.mean(le**2))) if late else 0.,
                    'projected_path_rmse_px':float(np.sqrt(np.mean(scored_other**2))),
                    'projected_path_max_error_px':float(scored_other.max()),'projected_pixels':other_uv.tolist(),
                    'projected_curve_pixels':curve_cache[trial_speed],
                    'score':float(np.mean(ee**2)/30**2)+timing_score(late_timing,other_apex)+descent_cache[trial_speed]['score'],
                    **rate_fields(trial_speed),
                    'projected_image_apex_time_s':other_apex,
                    'late_timing_error_s':timing_error_seconds(late_timing,other_apex),
                    'late_timing_used':late_timing['used'] and other_apex is not None,
                    '_errors':scored_other.tolist(),'_early_projection_matches':matches.tolist(),'_trajectory':None})
        simulations+=len(cache)
    context.update(simulation_count=simulations,observed_pixels=observed.tolist(),observation_times_s=times.tolist(),elapsed_s=time.monotonic()-started,
                   cache_hit=False, registration_seconds=registration_seconds)
    context['cold_fit_seconds'] = context['elapsed_s']
    if use_cache:
        put_fit(key, context)
    return context


def select_staged_match(context, distance_ft=None, distance_tolerance_ft=10., terminal_event=None, frame_step_s=1/30):
    candidates = context['candidates']
    if not candidates:
        return {'used':False,'reason':context.get('reason','Early spatial geometry and later height do not support a flight under the current camera setup.'), 'staged':True}
    terminal = terminal_event or {}
    hang = terminal.get('relative_time_s') if terminal.get('type') == 'FIRST_GROUND_CONTACT' else None
    if not isinstance(hang, (int,float)) or not math.isfinite(hang) or hang <= 0:
        hang = None
    def acceptable(c):
        return (c['early_xy_rmse_px']<=30 and (not c.get('late_timing_used') or c['late_timing_error_s']<=context['late_timing']['tolerance_s'])
                and (not c.get('late_descent_rate_used') or c.get('late_descent_rate_consistent',False))
                and (distance_ft is None or abs(c['distance_ft']-distance_ft)<=distance_tolerance_ft)
                and (hang is None or abs(c['hang_time_s']-hang)<=max(frame_step_s,float(terminal.get('timing_uncertainty_s') or frame_step_s))))
    nominal = [c for c in candidates if c['nominal']]
    accepted = [c for c in nominal if acceptable(c)]
    ranked = sorted(accepted or nominal or candidates,key=lambda c:c['score']+
        ((c['distance_ft']-distance_ft)/distance_tolerance_ft)**2
        if accepted and context.get('angle_primary') and distance_ft is not None else c['score'])
    selected = ranked[0]
    if selected.get('_trajectory') is None:
        flight=simulate_trajectory(Hit(selected['exit_velocity_mph'],selected['launch_angle_deg'],selected['spray_angle_deg'],estimate_spin=True),
                                   start=StartPosition(*selected['origin_ft']))
        selected['_trajectory']=[{'relative_time_s':p.t_s,'x_ft':p.x_ft,'y_ft':p.y_ft,'z_ft':p.z_ft} for p in flight.points]
    supported = [c for c in candidates if acceptable(c)] if accepted else []
    ranges = {key:[float(min(c[key] for c in supported)),float(max(c[key] for c in supported))]
              for key in ('exit_velocity_mph','launch_angle_deg','distance_ft','hang_time_s')} if supported else {}
    def public(c): return {k:v for k,v in c.items() if not k.startswith('_')}
    early_count = len(context['early'])
    anchor = project_with_camera_pose(np.array([selected['origin_ft']]),
        context['pose']['intrinsics'],context['pose']['rotation'],context['pose']['translation'])[0][0]
    observed_delta = np.asarray(context['observed_pixels'][:early_count])-anchor
    predicted_delta = np.asarray(selected['projected_pixels'][:early_count])-anchor
    angles = np.arctan2(predicted_delta[:,1],predicted_delta[:,0])-np.arctan2(observed_delta[:,1],observed_delta[:,0])
    direction_error = float(np.sqrt(np.mean(np.degrees(np.arctan2(np.sin(angles),np.cos(angles)))**2)))
    return {'used':True,'staged':True,'acceptable':bool(accepted),'best':public(selected),
            'angle_primary':context.get('angle_primary',False),
            'candidates':[public(c) for c in ranked], 'trajectory_points':selected['_trajectory'],
            'supported_ranges':ranges,'supported_candidate_count':len(supported),'independently_validated':False,
            'uses_landing_distance':distance_ft is not None,'used_count':len(context['early'])+len(context['late']),
            'early_used_count':early_count,'late_vertical_used_count':0,
            'late_timing_used_count':context['late_timing_mark_count'] if selected.get('late_timing_used') else 0,
            'late_evidence_policy':'timing_and_descent_rate' if context.get('late_descent_rate',{}).get('used') else 'timing_only','late_timing':context.get('late_timing'),
            'late_descent_rate':context.get('late_descent_rate'),
            'late_descent_rate_used_count':context.get('late_descent_rate',{}).get('point_count',0),
            'early_geometry':{'hypotheses':context.get('early_hypotheses',[]),'uses_speed':False,'uses_late_points':False,'uses_landing_distance':False},
            'camera_motion':context.get('camera_motion'), 'observation_policy':'manual_and_explicitly_reviewed_detection',
            'common_launch_angle_deg':selected['launch_angle_deg'],'common_spray_angle_deg':selected['spray_angle_deg'],
            'launch_angle_source':'early_spatial_geometry','contact_origin_ft':selected['origin_ft'],
            'at_speed_boundary':selected['exit_velocity_mph']<40.01 or selected['exit_velocity_mph']>119.99,
            'direction_rmse_deg':direction_error,'families_checked':len(candidates),
            'selection_policy':{'joint_fit_found':bool(accepted),'target_distance_ft':distance_ft,'distance_tolerance_ft':distance_tolerance_ft,
                                'uses_distance':distance_ft is not None,'late_horizontal_used':False,'angle_locked_before_speed':True,
                                'max_error_px':30.,'late_vertical_limit_px':None,'late_positions_used_as_height':False,'supported_ranges_are_confidence_intervals':False,
                                'late_descent_rate_used':bool(context.get('late_descent_rate',{}).get('used')),
                                'distance_can_change_launch_angle':not context.get('angle_primary',False)},
            'spray_refinement':{'used':False,'at_search_boundary':abs(selected['spray_angle_deg']-context['bearing_deg'])>=5.99,'launch_locked':True},
            'early_position_policy':selected.get('early_position_policy'),
            'pixel_error':{'definition':'Early spatial path residuals, without matching early timestamps, plus separate late rise/descent timing.' if context.get('angle_primary') else 'Early XY residuals only. Later marks constrain rise/descent timing, not absolute positions.',
                           'rmse_px':selected['projected_path_rmse_px'],'max_px':selected['projected_path_max_error_px'],'acceptance_limit_px':30.,
                           'points':[{'time_s':t,'observed_px':p,'projected_px':q,'error_px':e,'scored_axes':'xy','alignment':selected.get('early_position_policy')}
                                     for i,(t,p,q,e) in enumerate(zip(context['observation_times_s'],context['observed_pixels'],selected['_early_projection_matches'],selected['_errors']))]},
            'path_only_candidates':[public(c) for c in sorted(nominal or candidates,key=lambda c:c['score'])[:25]],
            'review_alternatives':[], 'observed_pixels':context['observed_pixels'],'observation_times_s':context['observation_times_s'],
            'performance':{'elapsed_s':context.get('elapsed_s'), 'scored_count':len(candidates),
                           'simulation_count':context.get('simulation_count'),
                           'candidate_speed_step_mph':context.get('candidate_speed_step_mph'),
                           'search_policy':context.get('search_policy','full_speed_domain'),
                           'fit_cache_hit':context.get('cache_hit',False),
                           'cold_fit_seconds':context.get('cold_fit_seconds'),
                           'registration_seconds':context.get('registration_seconds')},
            'assumptions':'Early geometry constrains launch angle before speed fitting. Only early absolute positions are scored in pixels. Reliable later rise/descent observations bound the projected turn time. Camera-corrected descent rate supplies independent speed evidence when at least three consistent marks span 0.25 seconds; a common vertical offset cancels and later horizontal positions never score. Ambiguous camera motion leaves this evidence unused. The landing allowance limits compatible flights but does not prescribe their range. Ranges are conditional model-consistency ranges, not confidence intervals.'}
