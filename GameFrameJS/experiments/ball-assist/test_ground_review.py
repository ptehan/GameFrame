import tempfile,unittest
from pathlib import Path
import cv2,numpy as np
from ground_review import review_ground,on_field

class GroundReviewTests(unittest.TestCase):
 def scene(self):
  image=np.full((200,360,3),185,np.uint8);image[100:]=(55,130,65);return image
 def run_case(self,positions,visible_until=None,pan=0):
  with tempfile.TemporaryDirectory() as directory:
   files=[];points=[];cameras={}
   for frame,(x,y) in enumerate(positions):
    matrix=np.eye(3);matrix[1,2]=pan*frame;cameras[frame]=matrix
    image=self.scene();image=cv2.warpAffine(image,matrix[:2],(360,200),borderMode=cv2.BORDER_REPLICATE)
    if visible_until is None or frame<=visible_until:
     points.append({'frame':frame,'x':x,'y':y+pan*frame,'stabilized_x':x,'stabilized_y':y,'segment':0})
     cv2.circle(image,(round(x),round(y+pan*frame)),1,(250,250,250),-1)
    file=Path(directory)/f'frame-{frame:05}.jpg';cv2.imwrite(str(file),image);files.append(file)
   return review_ground(files,points,cameras,30)
 def test_visible_bounce_is_candidate_not_measurement(self):
  points=[(70+2*i,50+4*i if i<=20 else 130-3*(i-20)) for i in range(35)]
  result=self.run_case(points);self.assertIsNotNone(result);self.assertEqual(result['kind'],'bounce_candidate');self.assertLessEqual(abs(result['frame']-20),1);self.assertFalse(result['observed_ground_contact']);self.assertTrue(result['requires_confirmation'])
 def test_camera_tilt_does_not_hide_bounce(self):
  points=[(70+2*i,50+4*i if i<=20 else 130-3*(i-20)) for i in range(35)]
  result=self.run_case(points,pan=1);self.assertEqual(result['kind'],'bounce_candidate');self.assertLessEqual(abs(result['frame']-20),1)
 def test_lost_descent_does_not_invent_ground_contact(self):
  result=self.run_case([(70+2*i,20+3*i) for i in range(50)],visible_until=15)
  self.assertIsNone(result)
 def test_apex_is_not_bounce(self):
  points=[(70+2*i,90-4*i if i<=15 else 30+3*(i-15)) for i in range(30)]
  result=self.run_case(points);self.assertTrue(result is None or result['kind']!='bounce_candidate')
 def test_hill_and_narrow_grass_strip_are_not_field(self):
  image=self.scene();image[40:70]=(50,110,60);image[80:82]=(55,130,65)
  self.assertFalse(on_field(image,(180,55)));self.assertFalse(on_field(image,(180,81)));self.assertTrue(on_field(image,(180,140)))
 def test_field_above_spectator_foreground_is_found(self):
  image=np.full((200,360,3),185,np.uint8);image[70:150]=(55,130,65);image[160:]=(50,80,120)
  self.assertTrue(on_field(image,(180,120)));self.assertFalse(on_field(image,(180,180)))

if __name__=='__main__':unittest.main()
