"""Geometry and output checks for the calibrated export animation."""
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ev-predictor' / 'synthetic'))
from flight_plane import FlightPlaneAnimation, create_flight_plane_animation


class FlightPlaneTests(unittest.TestCase):
    def fixture(self, width=1280, height=720):
        package = {'video_metadata': {'width_px': 1280, 'height_px': 720}}
        distances = np.linspace(0, 200, 81)
        prediction = {'ev_candidates': [{'launch_angle_deg': 20}], 'best_trajectory_points': [
            {'relative_time_s': i*.025, 'x_ft': 0, 'y_ft': s,
             'z_ft': 3+s*math.tan(math.radians(20))-.00183*s*s}
            for i,s in enumerate(distances)]}
        rotation = np.array([[1.,0,0], [0,0,-1.], [0,1.,0]])
        pose = {'rotation': rotation, 'translation': -rotation @ np.array([0.,-100.,6.]),
                'intrinsics': np.array([[900.,0,640.], [0,900.,360.], [0,0,1.]])}
        background = np.full((height,width,3), 110, np.uint8)
        return package,prediction,pose,background

    def make(self, width=1280, height=720):
        package,prediction,pose,background = self.fixture(width,height)
        with patch('flight_plane._calibrated_pose', return_value=pose) as calibrate:
            animation = FlightPlaneAnimation(package,prediction,background)
        calibrate.assert_called_once_with(package,1280,720)
        return animation,pose,background

    def test_initial_camera_alignment_including_resized_export(self):
        for width,height in [(1280,720),(640,360),(720,1280)]:
            a,pose,_ = self.make(width,height)
            camera = (pose['rotation'] @ a.xyz.T).T + pose['translation']
            pixels = (pose['intrinsics'] @ camera.T).T
            expected = pixels[:,:2]/pixels[:,2,None]*[width/1280,height/720]
            np.testing.assert_allclose(a.project(a.xyz,0),expected,atol=1e-8)

    def test_final_angle_and_equal_axes(self):
        a,_,_ = self.make()
        points = a.project(np.array([a.origin,a.tangent,a.origin+a.right*10,a.origin+[0,0,10]]),1)
        vector = points[1]-points[0]
        self.assertAlmostEqual(math.degrees(math.atan2(-vector[1],vector[0])),20,places=8)
        self.assertAlmostEqual(np.linalg.norm(points[2]-points[0]),np.linalg.norm(points[3]-points[0]),places=8)
        for u in [.34,.5,.75,1.]:
            path = a.project(a.xyz,u)
            self.assertGreaterEqual(path[:,0].min(),a.width*.09)
            self.assertLessEqual(path[:,0].max(),a.width*.91)
            self.assertGreaterEqual(path[:,1].min(),0)
            self.assertLessEqual(path[:,1].max(),a.height)

    def test_frames_are_independent_and_holds_do_not_recalibrate(self):
        a,_,background = self.make(640,360)
        original = background.copy()
        for index in [0,45,120,225,269]:
            frame = a.frame(index,270)
            self.assertEqual(frame.shape,(360,640,3))
            self.assertEqual(frame.dtype,np.uint8)
        expected = a.frame(269,270)
        a.frame(269,270)[:] = 0
        np.testing.assert_array_equal(a.frame(269,270),expected)
        np.testing.assert_array_equal(background,original)

    def test_factory_reports_unsupported_geometry(self):
        package,prediction,pose,background = self.fixture()
        reasons = []
        self.assertIsNone(create_flight_plane_animation(package,None,background,reasons.append))
        self.assertIn('trajectory',reasons[-1])
        prediction['ev_candidates'][0]['launch_angle_deg'] = 50
        with patch('flight_plane._calibrated_pose',return_value=pose):
            self.assertIsNone(create_flight_plane_animation(package,prediction,background,reasons.append))
        self.assertIn('disagree',reasons[-1])

    def test_staged_angle_summary_reuses_the_same_camera_without_refitting(self):
        package,prediction,_,background = self.fixture()
        camera = {'camera_center_ft':[0.,-100.,6.], 'camera_target_ft':[0.,0.,6.],
                  'horizontal_fov_deg':math.degrees(2*math.atan(1280/1800)),
                  'camera_roll_deg':0., 'launch_angle_deg':45.}
        prediction['direct_launch_angle'] = camera
        with patch('flight_plane._calibrated_pose', side_effect=AssertionError('Export must reuse this estimate camera')):
            before = FlightPlaneAnimation(package,prediction,background)
            prediction['legacy_camera_angle_diagnostic'] = camera
            prediction['direct_launch_angle'] = {'method':'early_spatial_geometry','launch_angle_deg':20.}
            after = FlightPlaneAnimation(package,prediction,background)
            self.assertEqual(after.angle_deg,20.,'Diagnostic launch angle must not replace the selected angle')
            np.testing.assert_array_equal(before.rotation,after.rotation)
            np.testing.assert_array_equal(before.intrinsics,after.intrinsics)
            for index in [0,45,120,269]:
                np.testing.assert_array_equal(before.frame(index,270),after.frame(index,270))


if __name__ == '__main__':
    unittest.main()
