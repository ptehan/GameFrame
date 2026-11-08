import sys, unittest, math, copy
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from camera_geometry import projection_jacobian, motion_basis, refine_field_camera
from angle_sensitivity import launch_angle_sensitivity
from direct_video_estimate import look_at_rotation, classify_view_geometry
from match_vantage_grid import intrinsics_from_fov,project_with_camera_pose
from baseball_flight import Hit,StartPosition,simulate_trajectory


class AngleSensitivityTests(unittest.TestCase):
 def test_only_near_line_of_sight_views_use_depth_heavy_exception(self):
  for center,expected in [([-60,0,6],'side_on'),([-30,-60,6],'oblique'),([0,-60,6],'depth_heavy')]:
   view=classify_view_geometry({},np.array([0.,1.]),{'camera_center_ft':center})
   self.assertEqual(view['classification'],expected)
 def pose(self,center=(-13,-44,6)):
  center=np.array(center,dtype=float);r=look_at_rotation(center,np.array([4,130,6.5]),.3)
  return dict(camera_center_ft=center,intrinsics=intrinsics_from_fov(1280,720,40),rotation=r,translation=-r@center,horizontal_fov_deg=40,contact_height_prior_ft=3)
 def fixture(self,center=(-13,-44,6),direction=-12):
  pose=self.pose(center);truth=simulate_trajectory(Hit(86,22,direction),start=StartPosition(0,0,3))
  times=[0,1/3,.5,2/3];data=np.array([[p.t_s,p.x_ft,p.y_ft,p.z_ft] for p in truth.points]);xyz=np.column_stack([np.interp(times,data[:,0],data[:,k]) for k in (1,2,3)])
  uv,_=project_with_camera_pose(xyz,pose['intrinsics'],pose['rotation'],pose['translation'])
  rows=[dict(source='HUMAN',role='CONTACT_POINT' if t==0 else 'BALL',relative_time_s=t,video_time_s=t,image_x=p[0],image_y=p[1],uncertainty_px=.2) for t,p in zip(times,uv)]
  return pose,rows
 def test_exact_derivative_matches_independent_tiny_displacement(self):
  for center in [(-13,-25,6),(-30,-100,12)]:
   pose=self.pose(center);point=np.array([0.,0.,3.]);jac=projection_jacobian(point,pose);eps=1e-4
   for axis in range(3):
    delta=np.eye(3)[axis]*eps
    uv,_=project_with_camera_pose(np.array([point-delta,point+delta]),pose['intrinsics'],pose['rotation'],pose['translation'])
    np.testing.assert_allclose(jac[:,axis],(uv[1]-uv[0])/(2*eps),rtol=1e-7,atol=1e-7)
 def test_basis_recovers_known_angle_in_depth_view(self):
  pose=self.pose((-13,-25,6));origin=np.array([0.,0.,3.]);direction=np.array([math.sin(math.radians(-12)),math.cos(math.radians(-12))])
  velocity=np.r_[direction*100,100*math.tan(math.radians(22))];eps=1e-6
  uv,_=project_with_camera_pose(np.array([origin,origin+velocity*eps]),pose['intrinsics'],pose['rotation'],pose['translation'])
  speeds=np.linalg.solve(motion_basis(origin,direction,pose),(uv[1]-uv[0])/eps)
  self.assertAlmostEqual(math.degrees(math.atan2(speeds[1],speeds[0])),22,delta=1e-4)
 def test_larger_click_uncertainty_widens_angle_envelope(self):
  pose,rows=self.fixture();a=launch_angle_sensitivity(rows,pose,-12)
  noisy=copy.deepcopy(rows)
  for row in noisy:row['uncertainty_px']=6
  b=launch_angle_sensitivity(noisy,pose,-12)
  self.assertGreater(b['width_deg'],a['width_deg'])
  self.assertFalse(b['is_confidence_interval']);self.assertIn('contact_depth',b['varied_inputs'])
 def test_head_on_view_is_reported_as_sensitive(self):
  pose,rows=self.fixture((0,-60,6),0);result=launch_angle_sensitivity(rows,pose,0)
  self.assertTrue(result['poorly_constrained'])
 def test_depth_uncertainty_does_not_create_artificial_angle_error(self):
  pose,rows=self.fixture();precise={**pose,'contact_position_prior_sigma_ft':[.01,.01,.01]}
  narrow=launch_angle_sensitivity(rows,precise,-12);wide=launch_angle_sensitivity(rows,pose,-12)
  np.testing.assert_allclose(wide['range_deg'],narrow['range_deg'],atol=1e-7,rtol=0)
  self.assertIn('contact_depth',wide['varied_inputs'])
 def test_later_marks_and_distance_do_not_set_angle_uncertainty(self):
  pose,rows=self.fixture();a=launch_angle_sensitivity(rows,pose,-12)
  b=launch_angle_sensitivity(rows+[dict(source='HUMAN',relative_time_s=3,image_x=9000,image_y=-500)],pose,-12)
  self.assertEqual(a,b)
 def test_invalid_field_geometry_does_not_claim_an_angle_range(self):
  pose,rows=self.fixture();pose['calibration_diagnostics']={'usable_for_velocity':False}
  result=launch_angle_sensitivity(rows,pose,-12)
  self.assertIsNone(result['range_deg']);self.assertTrue(result['poorly_constrained'])
 def test_field_marks_can_correct_camera_beyond_old_map_bound(self):
  actual=self.pose((-20,-45,7));seed=self.pose((5,-15,6));world=np.array([[0,0,0],[0,60.5,0],[63.64,63.64,0],[-63.64,63.64,0],[0,127.28,0]])
  image,_=project_with_camera_pose(world,actual['intrinsics'],actual['rotation'],actual['translation'])
  result=refine_field_camera(seed,{'camera':{}},world,image,[],1280,720)
  self.assertTrue(result['calibration_diagnostics']['usable_for_velocity'])
  self.assertTrue(result['calibration_diagnostics']['map_discrepancy'])
  self.assertGreater(result['calibration_diagnostics']['camera_adjustment_ft'],15)
  self.assertLess(result['rmse_px'],3)
  self.assertGreater(len(result['_uncertainty_poses']),0)
  self.assertTrue(any(abs(p['camera_center_ft'][2]-result['camera_center_ft'][2])>.001 for p in result['_uncertainty_poses']))


if __name__=='__main__':unittest.main()
