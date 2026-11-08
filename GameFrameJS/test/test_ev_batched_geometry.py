import math,sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from direct_video_estimate import look_at_rotation
from match_vantage_grid import intrinsics_from_fov,project_with_camera_pose
from staged_flight_match import derive_early_hypotheses

class BatchedGeometryTests(unittest.TestCase):
 def test_matches_individual_least_squares_across_direction_and_depth(self):
  center=np.array([-13.,-44.,6.]);origin=np.array([0.,0.,3.])
  rotation=look_at_rotation(center,np.array([4.,130.,6.5]),.3)
  pose={'intrinsics':intrinsics_from_fov(1280,720,40),'rotation':rotation,'translation':-rotation@center}
  for bearing in [-35,-12,0,25]:
   along=np.array([math.sin(math.radians(bearing)),math.cos(math.radians(bearing)),0.])
   distance=np.linspace(2,25,10);points=origin+distance[:,None]*along
   points[:,2]+=.45*distance-.002*distance**2
   pixels,_=project_with_camera_pose(points,pose['intrinsics'],rotation,pose['translation'])
   hypotheses=derive_early_hypotheses(pixels,pose,origin,bearing,direction_step_deg=1.5)
   self.assertGreater(len(hypotheses),10)
   for h in hypotheses:
    observed=pixels.copy();observed[:,1]+=h['early_y_delta_px']
    start=origin+h['depth_delta_ft']*(origin-center)/np.linalg.norm(origin-center)
    direction=math.radians(h['spray_angle_deg']);a=np.array([math.sin(direction),math.cos(direction),0.]);normal=np.array([a[1],-a[0],0.])
    world=[]
    for p in observed:
     ray=rotation.T@np.linalg.inv(pose['intrinsics'])@np.r_[p,1.]
     world.append(center+ray*(normal@(start-center))/(normal@ray))
    world=np.array(world);d=(world-start)@a;rise=world[:,2]-start[2]
    slope,curvature=np.linalg.lstsq(np.column_stack([d,d*d]),rise,rcond=None)[0]
    self.assertAlmostEqual(h['launch_angle_deg'],math.degrees(math.atan(slope)),places=8)
   nominal=next(h for h in hypotheses if h['nominal'] and h['spray_angle_deg']==bearing)
   self.assertAlmostEqual(nominal['launch_angle_deg'],math.degrees(math.atan(.45)),places=8)

if __name__=='__main__':unittest.main()
