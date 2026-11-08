import sys,unittest,copy
from pathlib import Path
from unittest.mock import patch
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from baseball_flight import Hit,StartPosition,simulate_trajectory
from direct_video_estimate import look_at_rotation
from match_vantage_grid import intrinsics_from_fov,project_with_camera_pose
from staged_flight_match import derive_early_hypotheses,prepare_staged_flight,select_staged_match
class StagedFlightTests(unittest.TestCase):
 def test_descent_evidence_can_narrow_a_loose_landing_allowance(self):
  pose,origin,truth,_,_=self.fixture()
  times=np.array([0,.1,.2,1/3,.5,2/3,1.5,1.75,2,2.25,2.5,2.75,3])
  data=np.array([[p.t_s,p.x_ft,p.y_ft,p.z_ft] for p in truth.points])
  xyz=np.column_stack([np.interp(times,data[:,0],data[:,k]) for k in (1,2,3)])
  pixels,_=project_with_camera_pose(xyz,pose['intrinsics'],pose['rotation'],pose['translation'])
  rows=[dict(source='HUMAN',role='CONTACT_POINT' if t==0 else 'BALL',relative_time_s=float(t),
    image_x=float(p[0]),image_y=float(p[1]),camera_registered=True,uncertainty_px=1,timing_uncertainty_s=0) for t,p in zip(times,pixels)]
  package={'camera_motion_evidence':{'used':True}}
  regular=prepare_staged_flight(rows,pose,-12,angle_primary=True,use_cache=False,package=package)
  self.assertFalse(regular['late_descent_rate']['used'],'production default must remain timing-only')
  context=prepare_staged_flight(rows,pose,-12,angle_primary=True,use_cache=False,package=package,use_descent_rate=True)
  self.assertTrue(context['late_descent_rate']['used'])
  narrow=select_staged_match(context,truth.distance_ft,20)
  loose=select_staged_match(context,truth.distance_ft,40)
  self.assertTrue(narrow['acceptable']);self.assertTrue(loose['acceptable'])
  self.assertEqual(narrow['supported_ranges'],loose['supported_ranges'])
  self.assertLess(narrow['supported_ranges']['distance_ft'][1]-narrow['supported_ranges']['distance_ft'][0],40)
  shifted=copy.deepcopy(rows)
  for row in shifted:
   if row['relative_time_s']>2/3:row['image_y']+=500;row['image_x']+=1000
  other=prepare_staged_flight(shifted,pose,-12,angle_primary=True,use_cache=False,package=package,use_descent_rate=True)
  result=select_staged_match(other,truth.distance_ft,20)
  self.assertEqual(narrow['best']['launch_angle_deg'],result['best']['launch_angle_deg'])
  self.assertAlmostEqual(narrow['best']['exit_velocity_mph'],result['best']['exit_velocity_mph'],places=5)
  for a,b in zip(narrow['supported_ranges']['exit_velocity_mph'],result['supported_ranges']['exit_velocity_mph']):self.assertAlmostEqual(a,b,places=5)
 def test_adaptive_search_preserves_full_scan_results(self):
  pose,origin,_,_,_=self.fixture()
  for speed,angle in [(65,14),(86,22),(105,35)]:
   truth=simulate_trajectory(Hit(speed,angle,-12),start=StartPosition(*origin))
   times=np.array([t for t in [0,.1,.2,1/3,.5,2/3,1,1.25,1.5,1.75,2,2.25,2.5,3] if t<truth.hang_time_s-.1])
   data=np.array([[p.t_s,p.x_ft,p.y_ft,p.z_ft] for p in truth.points])
   xyz=np.column_stack([np.interp(times,data[:,0],data[:,k]) for k in (1,2,3)])
   pixels,_=project_with_camera_pose(xyz,pose['intrinsics'],pose['rotation'],pose['translation'])
   rows=[dict(source='HUMAN',role='CONTACT_POINT' if t==0 else 'BALL',relative_time_s=float(t),image_x=float(p[0]),image_y=float(p[1])) for t,p in zip(times,pixels)]
   full=prepare_staged_flight(rows,pose,-12,angle_primary=True,use_cache=False,adaptive_search=False)
   fast=prepare_staged_flight(rows,pose,-12,angle_primary=True,use_cache=False)
   for distance in [truth.distance_ft-20,truth.distance_ft,truth.distance_ft+20]:
    a=select_staged_match(full,distance,10);b=select_staged_match(fast,distance,10)
    self.assertEqual(a['acceptable'],b['acceptable'])
    self.assertEqual(a['best']['exit_velocity_mph'],b['best']['exit_velocity_mph'])
    self.assertEqual(a['best']['launch_angle_deg'],b['best']['launch_angle_deg'])
    self.assertEqual(a['supported_ranges'],b['supported_ranges'])
 def fixture(self):
  center=np.array([-13.,-44.,6.]);rotation=look_at_rotation(center,np.array([4.,130.,6.5]),.3)
  pose={'intrinsics':intrinsics_from_fov(1280,720,40),'rotation':rotation,'translation':-rotation@center,'contact_height_prior_ft':3.}
  origin=np.array([0.,0.,3.]);truth=simulate_trajectory(Hit(86,22,-12),start=StartPosition(*origin))
  times=np.array([0,1/3,.5,2/3,1.5,2.]);data=np.array([[p.t_s,p.x_ft,p.y_ft,p.z_ft] for p in truth.points]);xyz=np.column_stack([np.interp(times,data[:,0],data[:,k]) for k in (1,2,3)])
  uv,_=project_with_camera_pose(xyz,**{k:pose[k] for k in ['intrinsics','rotation','translation']})
  rows=[{'source':'HUMAN','role':'CONTACT_POINT' if t==0 else 'BALL','relative_time_s':float(t),'video_time_s':float(t),'image_x':float(p[0]),'image_y':float(p[1])} for t,p in zip(times,uv)]
  return pose,origin,truth,rows,uv
 def context(self,rows,pose):
  return prepare_staged_flight(rows,pose,-12,variants=((0.,0.),),direction_step_deg=2.)
 def test_early_geometry_recovers_angle_without_speed(self):
  pose,origin,truth,rows,uv=self.fixture()
  geometry=derive_early_hypotheses(uv[1:4],pose,origin,-12,direction_step_deg=6.,variants=((0.,0.),))
  centered=next(h for h in geometry if h['spray_angle_deg']==-12)
  self.assertAlmostEqual(centered['launch_angle_deg'],22,delta=.7)
 def test_reviewed_detections_use_same_staged_fit_as_manual_marks(self):
  pose,origin,truth,rows,uv=self.fixture()
  manual=self.context(rows,pose)
  reviewed=copy.deepcopy(rows)
  for row in reviewed[1:]:row.update(source='COMPUTER_VISION',confidence='MEDIUM',human_reviewed=True)
  automatic=self.context(reviewed,pose)
  self.assertIsNotNone(automatic)
  self.assertEqual(manual['early_hypotheses'],automatic['early_hypotheses'])
  self.assertEqual([c['score'] for c in manual['candidates']],[c['score'] for c in automatic['candidates']])
  for row in reviewed[1:]:row['human_reviewed']=False
  self.assertIsNone(self.context(reviewed,pose))
 def test_late_horizontal_position_cannot_change_fit(self):
  pose,origin,truth,rows,uv=self.fixture();a=self.context(rows,pose)
  shifted=copy.deepcopy(rows)
  for row in shifted[4:]:row['image_x']+=500
  b=self.context(shifted,pose)
  self.assertEqual(a['early_hypotheses'],b['early_hypotheses'])
  for x,y in zip(a['candidates'],b['candidates']):
   self.assertAlmostEqual(x['exit_velocity_mph'],y['exit_velocity_mph'],places=8)
   self.assertAlmostEqual(x['score'],y['score'],places=8)
 def test_late_height_offset_cannot_change_speed_or_angle(self):
  pose,origin,truth,rows,uv=self.fixture();a=self.context(rows,pose)
  shifted=copy.deepcopy(rows)
  for row in shifted[4:]:row['image_y']+=300
  b=self.context(shifted,pose)
  self.assertEqual(a['early_hypotheses'],b['early_hypotheses'])
  for x,y in zip(a['candidates'],b['candidates']):
   self.assertAlmostEqual(x['exit_velocity_mph'],y['exit_velocity_mph'],places=8)
   self.assertAlmostEqual(x['score'],y['score'],places=8)
  self.assertEqual(select_staged_match(a,truth.distance_ft,10)['acceptable'],select_staged_match(b,truth.distance_ft,10)['acceptable'])
 def test_distance_only_selects_already_fixed_flights(self):
  pose,origin,truth,rows,uv=self.fixture();context=self.context(rows,pose)
  before=copy.deepcopy(context['early_hypotheses'])
  result=select_staged_match(context,truth.distance_ft,10)
  self.assertTrue(result['acceptable']);self.assertTrue(result['staged'])
  self.assertAlmostEqual(result['best']['exit_velocity_mph'],86,delta=2.)
  self.assertEqual(context['early_hypotheses'],before)
  self.assertTrue(result['best']['angle_locked_before_speed'])
  self.assertFalse(result['selection_policy']['late_horizontal_used'])
  self.assertTrue(all(p['scored_axes']=='xy' for p in result['pixel_error']['points']))
  self.assertEqual(len(result['pixel_error']['points']),result['early_used_count'])
  self.assertFalse(result['selection_policy']['late_positions_used_as_height'])
  conflict=select_staged_match(context,10.,1.)
  self.assertFalse(conflict['acceptable']);self.assertFalse(conflict['selection_policy']['joint_fit_found'])
 def test_two_initial_marks_use_limited_early_fallback(self):
  pose,origin,truth,rows,uv=self.fixture()
  self.assertIsNone(prepare_staged_flight(rows[:2],pose,-12))
  self.assertIsNone(prepare_staged_flight(rows[:4],pose,-12))
 def test_bad_calibration_is_not_used_by_new_path(self):
  pose,origin,truth,rows,uv=self.fixture()
  pose['calibration_diagnostics']={'usable_for_velocity':False}
  context=self.context(rows,pose)
  self.assertIsNotNone(context)
  self.assertFalse(select_staged_match(context,truth.distance_ft,10)['used'])
 def test_primary_angle_is_invariant_to_distance_with_later_marks(self):
  pose,origin,truth,rows,uv=self.fixture()
  context=prepare_staged_flight(rows,pose,-12,angle_primary=True,use_cache=False)
  angles=[]
  for distance in [truth.distance_ft-25,truth.distance_ft,truth.distance_ft+25,100]:
   result=select_staged_match(context,distance,10)
   angles.append(result['best']['launch_angle_deg'])
   self.assertFalse(result['selection_policy']['distance_can_change_launch_angle'])
   self.assertEqual(len({c['launch_angle_deg'] for c in result['candidates']}),1)
  self.assertEqual(len(set(angles)),1)
  self.assertFalse(select_staged_match(context,100,1)['acceptable'])
 def test_primary_angle_is_invariant_without_later_marks(self):
  pose,origin,truth,rows,uv=self.fixture()
  context=prepare_staged_flight(rows[:4],pose,-12,angle_primary=True,use_cache=False)
  self.assertIsNotNone(context)
  self.assertAlmostEqual(min(c['exit_velocity_mph'] for c in context['candidates']),40.)
  self.assertAlmostEqual(max(c['exit_velocity_mph'] for c in context['candidates']),120.)
  a=select_staged_match(context,truth.distance_ft,10)
  b=select_staged_match(context,truth.distance_ft-40,10)
  self.assertEqual(a['best']['launch_angle_deg'],b['best']['launch_angle_deg'])
  self.assertEqual(a['late_vertical_used_count'],0)
  self.assertTrue(a['angle_primary'])
 def test_primary_angle_single_early_point_uses_only_calculated_fallback(self):
  pose,origin,truth,rows,uv=self.fixture()
  context=prepare_staged_flight(rows[:2],pose,-12,angle_primary=True,fallback_launch_angle=22.,use_cache=False)
  self.assertTrue(context['candidates'])
  self.assertTrue(all(c['launch_angle_deg']==22. for c in context['candidates']))
 def test_primary_pixel_error_is_spatial_not_a_speed_clock(self):
  pose,origin,truth,rows,uv=self.fixture()
  context=prepare_staged_flight(rows[:4],pose,-12,angle_primary=True,use_cache=False)
  self.assertTrue(all(c['early_position_policy']=='spatial_curve_only' for c in context['candidates']))
  self.assertTrue(any(c['early_timed_xy_rmse_px']>c['early_xy_rmse_px']+10 for c in context['candidates']))
  result=select_staged_match(context,truth.distance_ft,10)
  for point in result['pixel_error']['points']:
   self.assertEqual(point['alignment'],'spatial_curve_only')
   self.assertAlmostEqual(np.linalg.norm(np.array(point['observed_px'])-point['projected_px']),point['error_px'],places=6)
 def test_primary_fit_ignores_late_absolute_height_offset(self):
  pose,origin,truth,rows,uv=self.fixture();shifted=copy.deepcopy(rows)
  for row in shifted[4:]:row['image_y']+=500
  a=prepare_staged_flight(rows,pose,-12,angle_primary=True,use_cache=False)
  b=prepare_staged_flight(shifted,pose,-12,angle_primary=True,use_cache=False)
  x=select_staged_match(a,truth.distance_ft,10);y=select_staged_match(b,truth.distance_ft,10)
  self.assertEqual(x['acceptable'],y['acceptable'])
  for key in ['exit_velocity_mph','launch_angle_deg','distance_ft','score']:
   self.assertAlmostEqual(x['best'][key],y['best'][key],places=7)
  self.assertIsNone(x['selection_policy']['late_vertical_limit_px'])
if __name__=='__main__':unittest.main()
