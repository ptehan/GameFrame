"""Regression checks for distance-assisted matching and batched interpolation."""
import sqlite3
import unittest
from contextlib import closing

import numpy as np

import test_ev_direction_first as fixtures
from path_distance_match import match_path_and_distance, rank_candidates, manual_path_tolerance
from direction_first_match import registered_origin
from match_vantage_grid import project_with_camera_pose
from distance_review import build_distance_review, distinct_alternatives


class PathDistanceTests(unittest.TestCase):
    setUp = fixtures.DirectionFirstTests.setUp
    observations = fixtures.DirectionFirstTests.observations

    def test_contact_pixel_offset_is_not_a_pre_matching_rejection(self):
        rows = self.observations(80)
        pixel, _ = project_with_camera_pose(np.array([[0., -13., 3.]]), **self.pose)
        rows[0].update(image_x=float(pixel[0,0]), image_y=float(pixel[0,1]))
        result = match_path_and_distance(rows, self.pose, -17, self.db, refine=False)
        self.assertTrue(result['used'])
        projected,_=project_with_camera_pose(np.array([result['contact_origin_ft']]),**self.pose)
        np.testing.assert_allclose(projected[0],[rows[0]['image_x'],rows[0]['image_y']],atol=1e-8)

    def test_contact_pixel_offsets_are_honored_instead_of_snapped_to_plate(self):
        for offset in (42.3,42.5,44.7):
            rows=self.observations(80)
            rows[0]['image_x']+=offset
            result=match_path_and_distance(rows,self.pose,-17,self.db,refine=False)
            self.assertTrue(result['used'])
            origin=np.array(result['contact_origin_ft'])
            self.assertGreater(np.linalg.norm(origin[:2]),.1)
            pixel,_=project_with_camera_pose(origin[None,:],**self.pose)
            np.testing.assert_allclose(pixel[0],[rows[0]['image_x'],rows[0]['image_y']],atol=1e-8)

    def test_contact_registration_is_shared_across_spray_candidates(self):
        from unittest.mock import patch
        with patch('path_distance_match.registered_origin', wraps=registered_origin) as register:
            result = match_path_and_distance(self.observations(80), self.pose, -17, self.db, refine=False)
        self.assertTrue(result['acceptable'])
        register.assert_called_once()
        self.assertTrue(result['spray_refinement']['origin_locked'])

    def test_uniform_grid_refines_a_flight_between_stored_speeds(self):
        import math
        from baseball_flight import Hit, simulate_trajectory
        flight = simulate_trajectory(Hit(90, 23.5, -16))
        times = np.arange(11) / 30
        xyz = np.column_stack([np.interp(times, [p.t_s for p in flight.points],
                               [getattr(p, axis) for p in flight.points]) for axis in ('x_ft','y_ft','z_ft')])
        xyz += self.origin - xyz[0]
        pixels, _ = project_with_camera_pose(xyz, **self.pose)
        rows = [dict(relative_time_s=float(t), image_x=float(p[0]), image_y=float(p[1]),
                     source='MANUAL', role='CONTACT_POINT' if t == 0 else 'BALL') for t,p in zip(times,pixels)]
        with closing(sqlite3.connect(self.db)) as conn, conn:
            conn.execute('CREATE TABLE generation_manifest (version TEXT)')
            conn.execute('ALTER TABLE synthetic_hits ADD COLUMN landing_spray_angle_deg REAL')
            for name, x, y in conn.execute('SELECT hit_id, landing_x_ft, landing_y_ft FROM synthetic_hits').fetchall():
                conn.execute('UPDATE synthetic_hits SET landing_spray_angle_deg=? WHERE hit_id=?', (math.degrees(math.atan2(x,y)), name))
        result = match_path_and_distance(rows, self.pose, -17, self.db, distance_ft=None)
        self.assertTrue(result['refinement']['enabled'])
        self.assertTrue(result['acceptable'])
        self.assertTrue(result['best']['refined'])
        self.assertLess(result['best']['projected_path_rmse_px'], 1)

    def test_landing_time_filters_even_an_exact_early_path(self):
        rows = self.observations(80)
        result = match_path_and_distance(rows, self.pose, -17, self.db, refine=False,
            terminal_event={'type': 'FIRST_GROUND_CONTACT', 'relative_time_s': .8, 'timing_uncertainty_s': .1})
        self.assertFalse(result['used'])
        self.assertEqual(result['hang_time_evidence']['landing_time_s'], .8)

    def test_marked_landing_without_uncertainty_uses_frame_precision(self):
        duration = self.flights['80_24_-14'].hang_time_s
        result = match_path_and_distance(self.observations(80), self.pose, -17, self.db, refine=False,
            terminal_event={'type': 'FIRST_GROUND_CONTACT', 'relative_time_s': duration + .2})
        self.assertFalse(result['used'])
        self.assertAlmostEqual(result['hang_time_evidence']['tolerance_s'], 1/30)

    def test_correct_landing_is_used_and_not_treated_as_airborne_lower_bound(self):
        duration = self.flights['80_24_-14'].hang_time_s
        rows = self.observations(80)
        rows.append({**rows[-1], 'relative_time_s': duration + .1})
        result = match_path_and_distance(rows, self.pose, -17, self.db, refine=False,
            terminal_event={'type': 'FIRST_GROUND_CONTACT', 'relative_time_s': duration + .1, 'timing_uncertainty_s': .2})
        self.assertTrue(result['acceptable'])
        self.assertAlmostEqual(result['best']['hang_time_error_s'], .1)
        self.assertIn('hang_time', result['best']['score_policy'])

    def test_late_airborne_mark_excludes_already_landed_trajectories(self):
        rows = self.observations(80)
        rows.append({**rows[-1], 'relative_time_s': 20.0})
        result = match_path_and_distance(rows, self.pose, -17, self.db, refine=False)
        self.assertFalse(result['used'])
        self.assertGreater(result['hang_time_evidence']['minimum_airborne_time_s'], 19)

    def test_catch_is_not_a_ground_landing_time(self):
        result = match_path_and_distance(self.observations(80), self.pose, -17, self.db, refine=False,
            terminal_event={'type': 'CATCH', 'relative_time_s': .8, 'timing_uncertainty_s': .1})
        self.assertTrue(result['acceptable'])
        self.assertIsNone(result['hang_time_evidence']['landing_time_s'])

    def test_automatic_points_cannot_override_manual_anchors(self):
        manual = [self.observations(80)[0], self.observations(80)[-1]]
        automatic = [{**r, 'source': 'COMPUTER_VISION', 'confidence': 'HIGH',
                      'image_x': r['image_x'] + 100, 'image_y': r['image_y'] + 60}
                     for r in self.observations(80)[1:-1]]
        baseline = match_path_and_distance(manual, self.pose, -17, self.db, refine=False)
        mixed = match_path_and_distance(manual + automatic, self.pose, -17, self.db, refine=False)
        self.assertEqual(mixed['best']['hit_id'], baseline['best']['hit_id'])
        self.assertEqual(mixed['acceptable'], baseline['acceptable'])
        self.assertAlmostEqual(mixed['best']['projected_path_rmse_px'], baseline['best']['projected_path_rmse_px'])
        self.assertEqual(mixed['used_count'], 1)
        self.assertEqual(mixed['observation_policy'], 'manual_anchors')
        self.assertEqual(mixed['ignored_automatic_point_count'], len(automatic))

    def test_manual_anchors_still_reject_impossible_distance(self):
        manual = [self.observations(80)[0], self.observations(80)[-1]]
        result = match_path_and_distance(manual, self.pose, -17, self.db, distance_ft=1000, refine=False)
        self.assertFalse(result['acceptable'])
        self.assertEqual(result['observation_policy'], 'manual_anchors')

    def test_review_distinguishes_conflict_from_bad_video_and_accepts_good_claim(self):
        from direct_video_estimate import export_readiness_for_prediction
        video = match_path_and_distance(self.observations(80), self.pose, -17, self.db, refine=False)
        review = build_distance_review({'used': False}, video, 1000)
        self.assertTrue(review['required'])
        self.assertEqual(review['status'], 'distance_conflict')
        self.assertGreater(len(review['alternatives']), 0)
        self.assertTrue(all(r['projected_path_rmse_px'] <= 12 for r in review['alternatives']))
        self.assertFalse(export_readiness_for_prediction({'distance_review': review}, [])['allowed'])
        self.assertEqual(build_distance_review({}, {}, 1000)['status'], 'insufficient_video_evidence')
        self.assertFalse(build_distance_review({'acceptable': True}, video, 1000)['required'])

    def test_alternatives_are_distinct_good_matches_beyond_top_25(self):
        rows = [dict(distance_ft=270, projected_path_rmse_px=i / 100) for i in range(30)]
        rows += [dict(distance_ft=d, projected_path_rmse_px=e) for d, e in [(290, 1), (310, 2), (330, 13)]]
        self.assertEqual([r['distance_ft'] for r in distinct_alternatives(rows)], [270, 290, 310])

    def test_failed_camera_explains_search_not_run_and_compares_camera_positions(self):
        calibration = {'usable_for_velocity': False, 'mapped_camera_center_ft': [-31.471, -20.979, 6],
                       'video_only_distance': {'usable': True, 'camera_center_ft': [-19.892, -50.227, 6],
                                               'camera_height_ft': 6, 'alignment_rmse_px': .496}}
        review = build_distance_review({'used': False, 'reason': 'camera calibration is not usable for velocity'}, {}, 320, calibration)
        self.assertEqual(review['status'], 'camera_setup_conflict')
        self.assertFalse(review['distance_tested'])
        self.assertFalse(review['alternatives'])
        self.assertIn('38 ft from home', review['message'])
        self.assertIn('54 ft', review['message'])
        self.assertAlmostEqual(review['camera_comparison']['position_difference_ft'], 31.46, delta=.1)

    def test_failed_video_fits_remain_visible_as_diagnostics(self):
        review = build_distance_review({}, {'used': True, 'path_only_candidates': [
            {'distance_ft': 300, 'projected_path_rmse_px': 25}]}, 320)
        self.assertTrue(review['required'])
        self.assertFalse(review['alternatives'])
        self.assertEqual(len(review['diagnostic_alternatives']), 1)
        self.assertIn('25.0 px', review['message'])

    def test_failed_diagnostics_prioritize_claim_and_explain_tracking_without_accepting(self):
        shared = {'used': True, 'acceptable': False, 'best': {'hit_id': 'claim', 'distance_ft': 322,
                  'projected_path_rmse_px': 29}, 'selection_policy': {'distance_tolerance_ft': 12}}
        video = {'path_only_candidates': [{'hit_id': 'long', 'distance_ft': 461, 'projected_path_rmse_px': 17.8}]}
        manual = {'used': True, 'used_count': 1, 'best': {'distance_ft': 326, 'exit_velocity_mph': 88, 'projected_path_rmse_px': 14.1}}
        review = build_distance_review(shared, video, 320, manual_only=manual)
        self.assertTrue(review['required'])
        self.assertFalse(review['alternatives'])
        self.assertEqual([r['distance_ft'] for r in review['diagnostic_alternatives']], [322])
        self.assertIn('not accepted', review['diagnostic_alternatives'][0]['comparison_label'])
        self.assertIn('Review automatic tracking first', review['message'])
        self.assertFalse(review['tracking_comparison']['automatically_applied'])

    def test_mark_uncertainty_is_bounded_and_does_not_depend_on_distance(self):
        row = {'image_x': 600, 'image_y': 0, 'uncertainty_px': 30}
        self.assertEqual(manual_path_tolerance([row], [0, 0]), 30)
        self.assertEqual(manual_path_tolerance([{**row, 'uncertainty_px': 10000}], [0, 0]), 30)
        self.assertEqual(manual_path_tolerance([{**row, 'image_x': 40}], [0, 0]), 12)
        self.assertEqual(manual_path_tolerance([{**row, 'uncertainty_px': None}], [0, 0]), 12)
        ranked, policy = rank_candidates([{'hit_id': 'near', 'distance_ft': 325, 'projected_path_rmse_px': 12.7},
                                           {'hit_id': 'far', 'distance_ft': 410, 'projected_path_rmse_px': 1}], 317, max_error_px=30)
        self.assertTrue(policy['joint_fit_found'])
        self.assertEqual(ranked[0]['hit_id'], 'near')
        for error in (31, 100):
            _, policy = rank_candidates([{'hit_id': 'bad', 'distance_ft': 317, 'projected_path_rmse_px': error}], 317, max_error_px=30)
            self.assertFalse(policy['joint_fit_found'])

    def test_review_never_suggests_substantially_longer_distances(self):
        rows = [{'hit_id': str(d), 'distance_ft': d, 'projected_path_rmse_px': 5} for d in (410, 399, 239)]
        review = build_distance_review({}, {'path_only_candidates': rows}, 317)
        self.assertEqual([r['distance_ft'] for r in review['alternatives']], [239])
        self.assertNotIn('Review your landing mark', review['title'])

    def test_requires_distance_and_video_even_outside_relative_pixel_shortlist(self):
        rows = [dict(hit_id=str(i), projected_path_rmse_px=e, distance_ft=d)
                for i,e,d in [(1,8,268),(2,9.7,320),(3,11,308)]]
        ranked, policy = rank_candidates(rows,308)
        self.assertEqual(ranked[0]['hit_id'],'3')
        self.assertEqual(len(ranked),2)
        self.assertEqual(policy['path_limit_px'],12)
        self.assertTrue(policy['joint_fit_found'])
        ranked, _ = rank_candidates(rows,None)
        self.assertEqual(ranked[0]['hit_id'],'1')

    def test_distance_cannot_rescue_failed_path_or_exceed_absolute_cap(self):
        rows = [dict(hit_id=str(i),projected_path_rmse_px=e,distance_ft=d)
                for i,e,d in [(1,13,268),(2,14,308)]]
        ranked, policy = rank_candidates(rows,308)
        self.assertEqual(ranked[0]['hit_id'],'1')
        self.assertFalse(policy['uses_distance'])
        self.assertFalse(policy['joint_fit_found'])
        rows[0]['projected_path_rmse_px']=11.5
        ranked, _ = rank_candidates(rows,308)
        self.assertEqual(len(ranked),1)

    def test_batch_projection_matches_independent_full_curve_interpolation(self):
        obs=self.observations(80)
        result=match_path_and_distance(obs,self.pose,-17,self.db,refine=False)
        self.assertTrue(result['acceptable'])
        self.assertEqual(result['best']['hit_id'],'80_24_-14')
        self.assertLess(result['best']['projected_path_rmse_px'],1e-7)
        times=np.array([r['relative_time_s'] for r in obs[1:]])
        pixels=np.array([[r['image_x'],r['image_y']] for r in obs[1:]])
        anchor=[obs[0]['image_x'],obs[0]['image_y']]
        for row in result['path_only_candidates']:
            flight=self.flights[row['hit_id']]
            data=np.array([(p.t_s,p.x_ft,p.y_ft,p.z_ft) for p in flight.points])
            origin=registered_origin(anchor,self.pose,row['spray_angle_deg'])
            xyz=np.column_stack([np.interp(times,data[:,0],data[:,a]) for a in (1,2,3)])+origin-data[0,1:]
            uv,_=project_with_camera_pose(xyz,**self.pose)
            error=np.sqrt(np.mean(np.sum((uv-pixels)**2,axis=1)))
            self.assertAlmostEqual(row['projected_path_rmse_px'],error,places=9)
        self.assertEqual(result['performance']['trajectory_batch_queries'],1)

    def test_rejects_missing_contact_low_quality_points_and_outside_direction(self):
        obs=self.observations(80)
        self.assertFalse(match_path_and_distance(obs[1:],self.pose,-17,self.db)['used'])
        self.assertFalse(match_path_and_distance(obs,self.pose,90,self.db)['used'])
        for r in obs[1:]:
            r.update(source='COMPUTER_VISION',confidence='LOW')
        self.assertFalse(match_path_and_distance(obs,self.pose,-17,self.db)['used'])

    def test_distance_may_select_different_launch_and_export_keeps_database_curve(self):
        obs=self.observations(80)
        # Give a second launch row the identical observed trajectory, but a
        # different carry. This isolates a real tie from a poor video fit.
        with closing(sqlite3.connect(self.db)) as c, c:
            c.execute("DELETE FROM trajectory_points WHERE hit_id='80_23_-18'")
            c.execute("INSERT INTO trajectory_points SELECT '80_23_-18',relative_time_s,x_ft,y_ft,z_ft FROM trajectory_points WHERE hit_id='80_24_-14'")
            c.execute("UPDATE synthetic_hits SET distance_ft=308 WHERE hit_id='80_23_-18'")
        result=match_path_and_distance(obs,self.pose,-17,self.db,distance_ft=308)
        self.assertEqual(result['best']['launch_angle_deg'],23)
        self.assertEqual(result['best']['distance_ft'],308)
        self.assertFalse(result['spray_refinement']['launch_locked'])
        self.assertTrue(all(abs(c['landing_angle_residual_deg'])<=10 for c in result['candidates']))
        flight=self.flights['80_24_-14']
        self.assertEqual(len(result['trajectory_points']),len(flight.points))
        self.assertAlmostEqual(result['trajectory_points'][-1]['x_ft'],flight.points[-1].x_ft)

    def test_missing_speed_and_angle_are_refined_with_fixed_camera(self):
        from baseball_flight import Hit, StartPosition, simulate_trajectory
        flight=simulate_trajectory(Hit(90,23.5,-16),start=StartPosition(*self.origin))
        times=np.arange(11)/30
        xyz=np.column_stack([np.interp(times,[p.t_s for p in flight.points],[getattr(p,a) for p in flight.points]) for a in ('x_ft','y_ft','z_ft')])
        uv,_=project_with_camera_pose(xyz,**self.pose)
        obs=[{'relative_time_s':float(t),'image_x':float(p[0]),'image_y':float(p[1]),'source':'HUMAN'} for t,p in zip(times,uv)]
        result=match_path_and_distance(obs,self.pose,-17,self.db,distance_ft=flight.distance_ft)
        self.assertTrue(result['acceptable'])
        self.assertTrue(result['best']['refined'])
        self.assertAlmostEqual(result['best']['exit_velocity_mph'],90,delta=.2)
        self.assertAlmostEqual(result['best']['launch_angle_deg'],23.5,delta=.1)
        self.assertAlmostEqual(result['best']['spray_angle_deg'],-16,delta=.1)
        self.assertLess(result['best']['projected_path_rmse_px'],.1)
        self.assertLess(abs(result['best']['distance_ft']-flight.distance_ft),1)
        self.assertAlmostEqual(result['trajectory_points'][0]['z_ft'],self.origin[2],places=7)

    def test_conflicting_distance_cannot_be_marked_acceptable(self):
        result=match_path_and_distance(self.observations(80),self.pose,-17,self.db,distance_ft=1000)
        self.assertFalse(result['acceptable'])
        self.assertFalse(result['selection_policy']['joint_fit_found'])
        from direct_video_estimate import export_readiness_for_prediction
        readiness=export_readiness_for_prediction({'method':'direction_first_shared_synthetic_match',
            'direction_first_match':result,'ev_candidates':[result['best']]},[])
        self.assertFalse(readiness['allowed'])


if __name__=='__main__':
    unittest.main()
