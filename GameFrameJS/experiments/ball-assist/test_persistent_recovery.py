import unittest
import cv2,numpy as np
from contact_scan import confirmed_recovery_points,compact_ball_evidence,reject_line_features

class PersistentRecoveryTests(unittest.TestCase):
 def test_recovery_cannot_reverse_clear_camera_compensated_launch(self):
  launch=[{**self.point(f,y,0),'stabilized_x':x} for f,x,y in [(1,500,100),(2,450,60)]]
  returning=[{**self.point(f,y),'stabilized_x':x} for f,x,y in [(30,100,200),(31,110,220),(32,120,240)]]
  kept,rejected=confirmed_recovery_points(launch+returning,np.arange(100)/6,720,6)
  self.assertEqual(kept,launch);self.assertEqual(rejected,[30,31,32])
 def point(self,frame,y,segment=1):return dict(frame=frame,segment=segment,stabilized_y=y,x=100,y=y,evidence=.9)
 def test_segment_zero_does_not_protect_scenery_after_a_gap(self):
  points=[self.point(1,100,0),self.point(2,80,0)]+[self.point(f,50+.2*f,0) for f in range(10,18)]
  kept,rejected=confirmed_recovery_points(points,np.arange(100)/6,720,6)
  self.assertEqual([p['frame'] for p in kept],[1,2]);self.assertEqual(rejected,list(range(10,18)))
 def test_uninterrupted_launch_can_pass_through_apex(self):
  points=[self.point(f,y,0) for f,y in enumerate([100,70,50,40,40,50,70],1)]
  kept,_=confirmed_recovery_points(points,np.arange(100)/6,720,6)
  self.assertEqual(kept,points)
 def test_sparse_track_cannot_claim_launch_protection_without_a_verified_anchor(self):
  points=[self.point(f,50+.2*f,0) for f in range(10,18)]
  kept,_=confirmed_recovery_points(points,np.arange(100)/6,720,6,protected_launch={1})
  self.assertEqual(kept,[])
 def test_weak_background_chain_is_not_a_recovered_ball(self):
  points=[{**self.point(f,y),'evidence':.5} for f,y in zip([30,31,32],[5,20,40])]
  kept,_=confirmed_recovery_points(points,np.arange(100)/6,720,6);self.assertEqual(kept,[])
 def test_clear_return_can_continue_into_fainter_sightings(self):
  points=[{**self.point(f,y),'evidence':q} for f,y,q in zip([30,31,32,33],[5,20,40,65],[.72,.6,.4,.35])]
  kept,_=confirmed_recovery_points(points,np.arange(100)/6,720,6);self.assertEqual(kept,points)
 def test_real_falling_segment_survives_long_absence(self):
  points=[self.point(1,100,0)]+[self.point(f,y) for f,y in zip([30,31,32,33],[5,20,40,65])]
  kept,_=confirmed_recovery_points(points,np.arange(100)/6,720,6)
  self.assertEqual([p['frame'] for p in kept],[1,30,31,32,33])
 def test_stationary_scenery_and_slow_player_are_not_recovered_ball(self):
  points=[self.point(f,250+.2*f) for f in range(10,16)]
  kept,_=confirmed_recovery_points(points,np.arange(100)/6,720,6);self.assertEqual(kept,[])
 def test_single_match_after_another_gap_is_not_exported(self):
  points=[self.point(f,y) for f,y in zip([10,11,12,16],[5,20,40,150])]
  kept,_=confirmed_recovery_points(points,np.arange(100)/6,720,6)
  self.assertEqual([p['frame'] for p in kept],[10,11,12])
 def test_small_ball_is_kept_but_extended_edge_is_rejected(self):
  image=np.full((360,640),200,np.uint8);cv2.circle(image,(150,80),2,80,-1);image[200:]=50
  points=[dict(x=150.,y=80.),dict(x=300.,y=200.)]
  kept=compact_ball_evidence(image,points);self.assertEqual(kept,[points[0]])
 def test_ball_has_independent_support_inside_net_caution_band(self):
  image=np.full((320,320),40,np.uint8)
  for position in range(0,320,30):
   cv2.line(image,(position,0),(position,319),150,2);cv2.line(image,(0,position),(319,position),150,2)
  cv2.ellipse(image,(156,156),(7,4),30,0,360,245,-1)
  ball=dict(x=156.,y=156.,contrast=205.,quality=1.);background=dict(x=186.,y=186.,contrast=110.,quality=.9)
  kept=reject_line_features(image,[ball,background],(0,np.pi/2))
  self.assertIn(ball,kept);self.assertTrue(ball['image_supported']);self.assertFalse(background['image_supported'])
if __name__=='__main__':unittest.main()
