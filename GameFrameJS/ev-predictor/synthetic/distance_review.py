"""Review evidence; alternatives never replace the user's observations."""
import math


def distinct_alternatives(candidates, max_error_px=12.0):
    selected = []
    for row in sorted(candidates, key=lambda c: c['projected_path_rmse_px']):
        if row['projected_path_rmse_px'] > max_error_px:
            continue
        if row.get('projected_path_max_error_px', row['projected_path_rmse_px']) > 2 * max_error_px:
            continue
        if any(abs(row['distance_ft'] - other['distance_ft']) < 10 for other in selected):
            continue
        selected.append(row)
        if len(selected) == 3:
            break
    return selected


def build_distance_review(shared, video_only, claimed_distance, calibration=None, manual_only=None):
    if shared.get('acceptable'):
        return {'required': False, 'status': 'supported', 'alternatives': []}
    tolerance = (shared.get('selection_policy') or {}).get('distance_tolerance_ft', 12)
    video_limit = (video_only.get('selection_policy') or {}).get('max_error_px', 12)
    def timing_compatible(row):
        return not row.get('late_timing_used') or row.get('late_timing_error_s',0)<= (video_only.get('late_timing') or {}).get('tolerance_s',0)
    def within_distance_ceiling(row):
        return claimed_distance is None or row['distance_ft'] <= claimed_distance + tolerance
    alternatives = distinct_alternatives([r for r in video_only.get('path_only_candidates', video_only.get('review_alternatives', []))
                                          if within_distance_ceiling(r) and timing_compatible(r)], video_limit)
    conflict = bool(alternatives) and claimed_distance is not None
    review = {
        'required': True,
        'status': 'distance_conflict' if conflict else 'insufficient_video_evidence',
        'claimed_distance_ft': claimed_distance,
        'alternatives': alternatives,
        'title': 'Review timing and camera setup' if conflict else 'Review the video marks and camera setup',
        'message': ('We could not reconcile a trajectory near your distance with the manual video marks within their uncertainty. Keep your landing mark while checking contact timing and camera setup. The shorter comparisons alone do not prove your distance is wrong.'
                    if conflict else 'We could not establish a good video match. Recheck contact timing, ball positions, and camera setup before judging the distance.'),
        'observed_pixels': video_only.get('observed_pixels', []),
        'contact_pixel': video_only.get('contact_pixel'),
        'observation_times_s': video_only.get('observation_times_s', []),
        'claimed_candidate': shared.get('best') if shared.get('uses_landing_distance') else None,
        'reason': video_only.get('reason') or shared.get('reason'),
        'observation_policy': shared.get('observation_policy') or video_only.get('observation_policy'),
    }
    calibration = calibration or {}
    if calibration.get('usable_for_velocity') is False:
        review.update(status='camera_setup_conflict', title='Check camera setup — distance has not been tested',
                      alternatives=[], distance_tested=False,
                      message='The camera setup does not align with the field marks in the video, so trajectory matching has not run. This does not establish that your landing distance is wrong. Review the camera position, home plate, field axis, and video field marks, then recalculate.')
        comparison = calibration.get('video_only_distance') or {}
        if comparison.get('usable'):
            mapped = calibration.get('mapped_camera_center_ft') or []
            suggested = comparison.get('camera_center_ft') or []
            if len(mapped) >= 2 and len(suggested) >= 2 and all(math.isfinite(v) for v in mapped[:2] + suggested[:2]):
                review['camera_comparison'] = {
                    'mapped_center_ft': mapped, 'suggested_center_ft': suggested,
                    'mapped_distance_ft': math.hypot(*mapped[:2]),
                    'suggested_distance_ft': math.hypot(*suggested[:2]),
                    'position_difference_ft': math.dist(mapped[:2], suggested[:2]),
                    'alignment_rmse_px': comparison.get('alignment_rmse_px'),
                    'camera_height_ft': comparison.get('camera_height_ft'),
                }
                review['message'] += (f" Your mapped camera is {math.hypot(*mapped[:2]):.0f} ft from home; "
                                      f"the field-line fit suggests {math.hypot(*suggested[:2]):.0f} ft, "
                                      f"at a position {math.dist(mapped[:2], suggested[:2]):.0f} ft from your mark. "
                                      'That suggestion depends on the marked field lines and assumed camera height; it is not an automatic correction.')
        return review
    review['distance_tested'] = bool(shared.get('used'))
    review['late_observation_policy'] = shared.get('late_evidence_policy')
    if not alternatives:
        # Failed fits are still useful to inspect, but must never be described as supported.
        review['diagnostic_alternatives'] = distinct_alternatives([r for r in video_only.get('path_only_candidates', [])
                                                                 if within_distance_ceiling(r)], math.inf)
        if review['diagnostic_alternatives']:
            error = review['diagnostic_alternatives'][0]['projected_path_rmse_px']
            review['message'] = (f'The closest video trajectory misses the marked ball positions by {error:.1f} px RMS '
                                 f'(the current limit is {video_limit:g} px). These comparisons are not accepted matches. '
                                 'Review the overlaid paths, contact frame, ball marks, and camera setup; the distance alone is not established as wrong.')
        elif review['reason']:
            review['message'] += ' Matching stopped because: ' + review['reason'] + '.'
    if shared.get('late_evidence_policy') in {'timing_only','timing_and_descent_rate'}:
        review['message']='No tested flight reconciles the early marks, reliable later motion and your distance. Later absolute heights are not scored. This does not establish that your landing mark is wrong.'
        review['alternatives']=[{**row,'comparison_label':f'Distance-free comparison {i+1} (not accepted at your distance)'} for i,row in enumerate(review['alternatives'])]
    if review.get('diagnostic_alternatives'):
        closest = review['diagnostic_alternatives'][0]
        near_claim = shared.get('best') or {}
        tolerance = (shared.get('selection_policy') or {}).get('distance_tolerance_ft', 12)
        rows = []
        if claimed_distance is not None and abs(near_claim.get('distance_ft', math.inf) - claimed_distance) <= tolerance:
            rows.append({**near_claim, 'comparison_label': 'Near your marked distance — not accepted'})
            review['claimed_candidate'] = near_claim
        if within_distance_ceiling(closest) and (not rows or closest.get('hit_id') != rows[0].get('hit_id')):
            rows.append({**closest, 'comparison_label': 'Closest video fit ignoring distance — not accepted'})
        review['diagnostic_alternatives'] = rows
        review['message'] += ' The distance-free fit is a failed diagnostic, not a recommendation to move your landing mark.'
    elif not alternatives and shared.get('best') and within_distance_ceiling(shared['best']):
        review['diagnostic_alternatives'] = [{**shared['best'], 'comparison_label': 'Near your marked distance — not accepted'}]
    if manual_only and manual_only.get('used'):
        manual_best = manual_only.get('best') or {}
        all_best = shared.get('best') or {}
        manual_error = manual_best.get('projected_path_rmse_px')
        all_error = all_best.get('projected_path_rmse_px')
        if manual_error is not None and all_error is not None and manual_error + 2 < all_error:
            review['tracking_comparison'] = {
                'manual_error_px': manual_error, 'all_point_error_px': all_error,
                'manual_distance_ft': manual_best['distance_ft'],
                'manual_exit_velocity_mph': manual_best['exit_velocity_mph'],
                'manual_point_count': manual_only.get('used_count'),
                'automatically_applied': False,
            }
            review['message'] += (f" With automatic points omitted, a {manual_best['distance_ft']:.0f}-ft trajectory "
                                  f"misses your manual marks by {manual_error:.1f} px, compared with {all_error:.1f} px using all points. "
                                  'Review automatic tracking first. Fewer marks provide less evidence; this comparison does not validate the estimate or change your marks.')
    if review.get('observation_policy') == 'manual_anchors':
        review['message'] += ' Matching uses your manual contact and flight marks; automatic intermediate points do not affect acceptance.'
    timing = shared.get('hang_time_evidence') or video_only.get('hang_time_evidence') or {}
    review['hang_time_evidence'] = timing
    if timing.get('landing_time_s') is not None:
        review['message'] += (f" Matching also requires hang time within {timing['tolerance_s']:.2f} s "
                              f"of your marked landing at {timing['landing_time_s']:.2f} s after contact.")
    return review
