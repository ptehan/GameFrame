import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from direction_first_match import registered_origin,with_contact_registration
from match_vantage_grid import project_with_camera_pose
class ContactRayTests(unittest.TestCase):
 def setUp(self):
  r=np.array([[1.,0,0],[0,0,-1],[0,1,0]])
  self.pose={'intrinsics':np.array([[1200.,0,640],[0,1200.,360],[0,0,1.]]),'rotation':r,'translation':-r@np.array([-12.,-44.,6.])}
 def test_plate_mark_does_not_translate_the_contact_click(self):
  clicked=np.array([941.,448.]);origins=[]
  for plate in [[978.,600.],[1078.,650.],[878.,550.]]:
   package={'landmarks':[{'landmark':'home_plate','image_x':plate[0],'image_y':plate[1]}],'ball_observations':[{'relative_time_s':0,'image_x':clicked[0],'image_y':clicked[1]}]}
   pose=with_contact_registration(self.pose,package);origin=registered_origin(clicked,pose,-15)
   uv,_=project_with_camera_pose(origin[None,:],**self.pose)
   np.testing.assert_allclose(uv[0],clicked,atol=1e-8)
   self.assertGreater(np.linalg.norm(origin[:2]),.1)
   self.assertEqual(pose['contact_registration']['horizontal_anchor'],'contact_pixel_ray')
   origins.append(origin)
  np.testing.assert_allclose(origins[0],origins[1],atol=1e-8)
  np.testing.assert_allclose(origins[0],origins[2],atol=1e-8)
 def test_direction_does_not_relocate_contact(self):
  origins=[registered_origin([941.,448.],self.pose,b) for b in [-90,0,90]]
  for point in origins[1:]:np.testing.assert_allclose(point,origins[0],atol=1e-8)
if __name__=='__main__':unittest.main()
