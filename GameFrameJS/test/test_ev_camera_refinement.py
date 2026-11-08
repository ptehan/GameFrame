import copy
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ev-predictor' / 'synthetic'))
import direct_video_estimate as model


class CameraRefinementTests(unittest.TestCase):
    def fixture(self):
        actual = np.array([-13.0, -44.0, 6.0])
        mapped = np.array([-6.5, -37.5, 6.0])
        rotation = model.look_at_rotation(actual, np.array([4.0, 130.0, 6.5]), 0.3)
        k = model.intrinsics_from_fov(1280, 720, 40.0)
        world = np.array([[0, 0, 0], [0, 60.5, 0]])
        image, _ = model.project_with_camera_pose(world, k, rotation, -rotation @ actual)
        lines = []
        for side in [-1, 1]:
            ground = np.array([[0, 0, 0], [side * 63.64, 63.64, 0]])
            clicks = np.array([[side * 10, 10, 0], [side * 35, 35, 0]])
            pixels, _ = model.project_with_camera_pose(clicks, k, rotation, -rotation @ actual)
            lines.append((ground, pixels))
        pose = dict(camera_center_ft=mapped, intrinsics=k, rotation=rotation,
                    translation=-rotation @ mapped, horizontal_fov_deg=40.0,
                    rmse_px=100.0, baseline_count=2, landmark_count=2)
        return actual, pose, world, image, lines

    def test_field_lines_correct_map_position_without_landing_distance(self):
        actual, pose, world, image, lines = self.fixture()
        outputs = []
        for distance in [200, 320, 450]:
            package = {'camera': {'height_uncertainty_ft': .01}, 'hit': {'distance_observation': {'distance_ft': distance}}}
            result = model.refine_camera_from_baselines(copy.deepcopy(pose), package, world, image, lines, 1280, 720)
            outputs.append(result['camera_center_ft'])
            self.assertLess(np.linalg.norm(result['camera_center_ft'] - actual), 2.0)
            self.assertAlmostEqual(result['camera_center_ft'][2], 6.0, delta=.03)
            self.assertLess(result['rmse_px'], 2.0)
            self.assertTrue(result['calibration_diagnostics']['usable_for_velocity'])
            self.assertEqual(result['calibration_diagnostics']['video_only_distance']['camera_height_ft'], 6.0)
            self.assertGreater(result['calibration_diagnostics']['camera_adjustment_ft'], 3.0)
        np.testing.assert_allclose(outputs[0], outputs[1])
        np.testing.assert_allclose(outputs[0], outputs[2])

    def test_legacy_position_is_not_moved_and_lens_bound_is_flagged(self):
        _, pose, world, image, _ = self.fixture()
        pose['horizontal_fov_deg'] = 35.0
        pose['rmse_px'] = 1.0
        result = model.refine_camera_from_baselines(pose, {}, world, image, [], 1280, 720)
        self.assertEqual(result['calibration_diagnostics']['camera_adjustment_ft'], 0.0)
        self.assertFalse(result['calibration_diagnostics']['usable_for_velocity'])
        evidence = dict(used=True, used_count=10, timing_reliable=True, path_evidence_strength=1,
                        pose_landmark_rmse_px=1, calibration_diagnostics=result['calibration_diagnostics'])
        self.assertFalse(model.useful_velocity_path(evidence))

    def test_inconsistent_lines_do_not_validate_velocity(self):
        _, pose, world, image, lines = self.fixture()
        lines[0] = (lines[0][0], lines[0][1] + [0, 200])
        result = model.refine_camera_from_baselines(pose, {}, world, image, lines, 1280, 720)
        self.assertFalse(result['calibration_diagnostics']['usable_for_velocity'])
        self.assertTrue(np.isfinite(result['camera_center_ft']).all())

    def test_video_only_distance_recovers_known_camera(self):
        actual, _, world, image, lines = self.fixture()
        result = model.video_only_camera_distance(world, image, lines, 1280, 720, 6.0)
        self.assertTrue(result['usable'])
        self.assertFalse(result['uses_map_position'])
        self.assertAlmostEqual(result['camera_to_home_ground_distance_ft'], float(np.linalg.norm(actual[:2])), places=3)
        self.assertAlmostEqual(result['horizontal_fov_deg'], 40.0, places=3)
        self.assertLess(result['alignment_rmse_px'], 0.001)

    def test_video_only_distance_requires_both_baselines(self):
        _, _, world, image, lines = self.fixture()
        result = model.video_only_camera_distance(world, image, lines[:1], 1280, 720, 6.0)
        self.assertFalse(result['available'])


if __name__ == '__main__':
    unittest.main()
