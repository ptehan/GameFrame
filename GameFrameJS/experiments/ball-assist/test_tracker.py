import sys,tempfile,unittest
from pathlib import Path
import cv2,numpy as np
sys.path.insert(0,str(Path(__file__).parent))
from tracker import track,locate

class TrackerTests(unittest.TestCase):
 def clip(self,folder,missing_after=99):
  rng=np.random.default_rng(43);background=rng.integers(30,130,(256,480),dtype=np.uint8)
  background=cv2.GaussianBlur(background,(3,3),0)
  for i in range(14):
   image=cv2.warpAffine(background,np.float32([[1,0,i],[0,1,0]]),(480,256),borderMode=cv2.BORDER_REFLECT)
   if i<=missing_after:cv2.circle(image,(100+9*i,90-2*i),3,250,-1)
   cv2.imwrite(str(folder/f'frame-{i:05}.jpg'),image,[cv2.IMWRITE_JPEG_QUALITY,98])
 def config(self,folder):return {'frames_dir':str(folder),'fps':30,'anchors':[{'frame':1,'x':109,'y':88},{'frame':3,'x':127,'y':84}],'max_steps':10}
 def test_moving_ball_and_panning_background(self):
  with tempfile.TemporaryDirectory() as d:
   folder=Path(d);self.clip(folder);result=track(self.config(folder))
   self.assertGreaterEqual(len(result['points']),5,result)
   for p in result['points']:self.assertLess(np.hypot(p['x']-(100+9*p['frame']),p['y']-(90-2*p['frame'])),2.5)
   self.assertFalse(result['automatic_acceptance']);self.assertTrue(all(p['status']=='unreviewed' for p in result['points']))
 def test_missing_ball_stops_without_filling_gap(self):
  with tempfile.TemporaryDirectory() as d:
   folder=Path(d);self.clip(folder,missing_after=6);result=track(self.config(folder))
   self.assertIsNotNone(result['stopped']);self.assertTrue(all(p['frame']<=6 for p in result['points']),result)
 def test_dark_ball_on_bright_background(self):
  with tempfile.TemporaryDirectory() as d:
   folder=Path(d);self.clip(folder)
   for file in folder.glob('*.jpg'):
    image=cv2.imread(str(file),cv2.IMREAD_GRAYSCALE);cv2.imwrite(str(file),255-image,[cv2.IMWRITE_JPEG_QUALITY,98])
   result=track(self.config(folder));self.assertGreaterEqual(len(result['points']),5,result)
   for p in result['points']:self.assertLess(np.hypot(p['x']-(100+9*p['frame']),p['y']-(90-2*p['frame'])),2.5)
 def test_ambiguous_lookalikes_abstain(self):
  previous=np.full((160,240),70,np.uint8);cv2.circle(previous,(100,80),2,250,-1)
  current=np.full_like(previous,70);cv2.circle(current,(93,80),2,250,-1);cv2.circle(current,(107,80),2,250,-1)
  template=previous[73:88,93:108]
  point,reason=locate(previous,current,np.array([100.,80.]),np.zeros(2),template,np.eye(2,3,dtype=np.float32))
  self.assertIsNone(point);self.assertEqual(reason['reason'],'competing_candidates')
 def test_border_anchor_is_not_extrapolated(self):
  with tempfile.TemporaryDirectory() as d:
   folder=Path(d);self.clip(folder);config=self.config(folder);config['anchors']=[{'frame':3,'x':2,'y':2}];result=track(config)
   self.assertEqual(result['points'],[]);self.assertEqual(result['stopped']['reason'],'anchor_near_frame_edge')

if __name__=='__main__':unittest.main()
