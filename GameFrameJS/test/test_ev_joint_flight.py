import sys
import unittest
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ev-predictor' / 'synthetic'))
from baseball_flight import Hit, StartPosition, simulate_trajectory
from calibrated_flight_fit import fit_calibrated_flight
from direct_video_estimate import look_at_rotation, useful_velocity_path, export_readiness_for_prediction
from match_vantage_grid import intrinsics_from_fov, project_with_camera_pose


class JointFlightTests(unittest.TestCase):
    def fixture(self):
        center = np.array([-13., -44., 6.])
        rotation = look_at_rotation(center, np.array([4., 130., 6.5]), 0.3)
        pose = dict(intrinsics=intrinsics_from_fov(1280, 720, 40), rotation=rotation,
                    translation=-rotation @ center, calibration_diagnostics={'usable_for_velocity': True})
        trajectory = simulate_trajectory(Hit(86, 24, -12), start=StartPosition(0, 0, 2.5))
        ts = np.array([v.t_s for v in trajectory.points])
        times = np.arange(1, 11) / 30
        xyz = np.column_stack([np.interp(times, ts, [getattr(v, axis) for v in trajectory.points])
                               for axis in ('x_ft', 'y_ft', 'z_ft')])
        pixels, _ = project_with_camera_pose(xyz, pose['intrinsics'], rotation, pose['translation'])
        rows = [dict(relative_time_s=float(t), image_x=float(uv[0]), image_y=float(uv[1]),
                     source='VISUAL_REVIEW', uncertainty_px=3, confidence='HIGH') for t, uv in zip(times, pixels)]
        contact, _ = project_with_camera_pose(np.array([[0., 0., 2.5]]), pose['intrinsics'], rotation, pose['translation'])
        rows.insert(0, dict(relative_time_s=0, role='CONTACT_POINT', image_x=float(contact[0,0]),
                            image_y=float(contact[0,1]), source='HUMAN'))
        angle = float(np.degrees(np.arctan2(trajectory.landing_x_ft, trajectory.landing_y_ft)))
        return pose, trajectory, rows, angle

    def test_recovers_known_flight_from_its_contact_click(self):
        pose, truth, rows, angle = self.fixture()
        result = fit_calibrated_flight(rows, pose, angle, truth.distance_ft)
        self.assertTrue(result['acceptable'])
        self.assertTrue(result['uses_landing_distance'])
        self.assertFalse(result['independently_validated'])
        self.assertEqual(result['used_count'], 10)
        self.assertAlmostEqual(result['best']['exit_velocity_mph'], 86, delta=1)
        self.assertAlmostEqual(result['best']['spray_angle_deg'], -12, delta=1)
        self.assertAlmostEqual(result['best']['distance_ft'], truth.distance_ft, delta=1)
        self.assertLess(result['pixel_rmse'], .1)
        self.assertGreater(len(result['trajectory_points']), 20)
        np.testing.assert_allclose(result['contact_origin_ft'], [0., 0., 2.5], atol=1e-8)
        np.testing.assert_allclose([result['trajectory_points'][0][axis] for axis in ('x_ft','y_ft')],[0.,0.],atol=1e-8)

    def test_inconsistent_contact_cannot_be_ignored_to_fit_a_flight(self):
        pose, truth, rows, angle = self.fixture()
        rows[0].update(image_x=-1000, image_y=5000)
        result = fit_calibrated_flight(rows, pose, angle, truth.distance_ft)
        self.assertFalse(result.get('acceptable',False))

    def test_joint_export_uses_fitted_curve(self):
        from clip_replay import synthetic_flight_points
        points = [dict(relative_time_s=0, x_ft=1, y_ft=3, z_ft=4),
                  dict(relative_time_s=1, x_ft=-10, y_ft=80, z_ft=20)]
        result = synthetic_flight_points(dict(method='joint_calibrated_pixels_and_supplied_landing_distance',
                                              best_trajectory_points=points))
        self.assertEqual(result[0], dict(t=0., x=1., y=3., z=4.))
        self.assertEqual(result[1], dict(t=1., x=-10., y=80., z=20.))

    def test_questionable_points_and_bad_camera_do_not_enter_joint_fit(self):
        pose, truth, rows, angle = self.fixture()
        self.assertFalse(fit_calibrated_flight(rows[:3], pose, angle)['used'])
        for row in rows:
            row.update(source='COMPUTER_VISION', confidence='MEDIUM')
        self.assertFalse(fit_calibrated_flight(rows, pose, angle)['used'])
        for row in rows:
            row.update(source='VISUAL_REVIEW')
        pose['calibration_diagnostics']['usable_for_velocity'] = False
        self.assertFalse(fit_calibrated_flight(rows, pose, angle)['used'])

    def test_distance_constrained_fit_is_not_independent_validation(self):
        evidence = dict(used=True, used_count=10, timing_reliable=True, path_evidence_strength=1,
                        independent_velocity_validated=False)
        self.assertFalse(useful_velocity_path(evidence))
        result = export_readiness_for_prediction(dict(ev_candidates=[dict(launch_angle_deg=24)],
            projected_path_evidence=evidence, field_direction=dict(estimated_distance_ft=316)), [])
        self.assertTrue(result['allowed'])
        self.assertFalse(result['evidence']['early_path_validated'])


if __name__ == '__main__':
    unittest.main()
