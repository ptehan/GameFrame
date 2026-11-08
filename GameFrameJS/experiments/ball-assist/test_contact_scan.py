import sys,tempfile,unittest
from pathlib import Path
import cv2,numpy as np
sys.path.insert(0,str(Path(__file__).parent))
from contact_scan import scan,candidates,reject_line_features

class ContactScanTests(unittest.TestCase):
 def test_net_intersection_is_rejected_but_ball_crossing_net_is_kept(self):
  image=np.full((360,640),30,np.uint8)
  for x in range(64,640,64):cv2.line(image,(x,0),(x,359),90,2)
  for y in range(50,360,50):cv2.line(image,(0,y),(639,y),90,2)
  cv2.line(image,(311,41),(329,59),245,5)
  points=[{'x':128.,'y':100.,'contrast':70.,'quality':1.,'area':10},{'x':320.,'y':50.,'contrast':160.,'quality':1.,'area':20}]
  found=reject_line_features(image,points);self.assertEqual(len(found),1);self.assertEqual(found[0]['x'],320.)
 def test_small_ball_survives_stronger_foreground_motion(self):
  rng=np.random.default_rng(12);texture=cv2.GaussianBlur(rng.integers(10,240,(180,640),dtype=np.uint8),(3,3),0)
  frames=[]
  for step in (-1,0,1):
   image=np.full((360,640),210,np.uint8);image[180:]=np.roll(texture,step*3,axis=1);cv2.circle(image,(220-step*10,70-step*8),3,160,-1);frames.append(image)
  found=candidates(frames[0],frames[1],np.eye(2,3,dtype=np.float32),coverage=True,next_frame=frames[2],next_matrix=np.eye(2,3,dtype=np.float32))
  self.assertTrue(any(np.hypot(p['x']-220,p['y']-70)<2 for p in found),'The quiet sky region must retain the ball despite stronger moving clutter below.')
 def clip(self,folder,dark=False,reentry=False,decoy=False):
  rng=np.random.default_rng(34);base=cv2.GaussianBlur(rng.integers(45,100,(200,360),dtype=np.uint8),(3,3),0)
  for i in range(50):
   image=base.copy()
   if decoy:point=(70+5*min(i,5),130+3*min(i,5))
   elif reentry:
    point=(70+7*i,130-8*i) if i<17 else ((220+2*(i-30),2+4*(i-30)) if i>=30 else None)
   else:point=(70+6*i,130-2*i) if i<38 else None
   if point:cv2.circle(image,point,3,245,-1)
   if dark:image=255-image
   cv2.imwrite(str(folder/f'frame-{i:05}.jpg'),image,[cv2.IMWRITE_JPEG_QUALITY,98])
 def run_clip(self,stride=1,**options):
  with tempfile.TemporaryDirectory() as directory:
   folder=Path(directory);self.clip(folder,**options)
   return scan({'frames_dir':str(folder),'fps':30,'contact':{'frame':0,'x':70,'y':130},'detection_stride':stride})
 def test_sampling_emits_only_pixels_from_frames_actually_checked(self):
  result=self.run_clip(stride=3);checked=set(result['sampling']['detection_frames']);self.assertLess(len(checked),49)
  self.assertTrue(all(p['frame'] in checked for p in result['points']));self.assertNotIn(20,checked)
  point=next(p for p in result['points'] if p['frame']==21);self.assertLess(np.hypot(point['x']-196,point['y']-88),3)
 def test_sampling_refines_a_visible_bounce_at_native_frame_rate(self):
  with tempfile.TemporaryDirectory() as directory:
   folder=Path(directory)
   for i in range(50):
    image=np.full((200,360,3),185,np.uint8);image[110:]=(55,130,65)
    y=40+4*i if i<=25 else 140-3*(i-25);cv2.circle(image,(70+5*i,y),2,(245,245,245),-1);cv2.imwrite(str(folder/f'frame-{i:05}.jpg'),image)
   result=scan({'frames_dir':str(folder),'fps':30,'contact':{'frame':0,'x':70,'y':40},'detection_stride':3})
   self.assertIsNotNone(result['ground_review']);self.assertEqual(result['ground_review']['kind'],'bounce_candidate');self.assertLessEqual(abs(result['ground_review']['frame']-25),1)
   self.assertTrue(all(frame in result['sampling']['detection_frames'] for frame in range(23,29)))
 def test_contact_only_tracks_without_later_seeds(self):
  result=self.run_clip();self.assertEqual(result['scanned_frames'],49);self.assertEqual(result['last_scanned_frame'],49)
  by_frame={p['frame']:p for p in result['points']};self.assertIn(20,by_frame,result)
  self.assertLess(np.hypot(by_frame[20]['x']-190,by_frame[20]['y']-90),3,str(by_frame[20])+str(result.get('debug')))
  self.assertTrue(all(p['frame']<38 for p in result['points']),result)
  self.assertFalse(result['uses_later_manual_seeds']);self.assertFalse(result['automatic_acceptance'])
 def test_dark_ball_supported(self):
  result=self.run_clip(dark=True);self.assertTrue(any(p['frame']==20 for p in result['points']),result)
 def test_local_motion_that_stops_is_not_a_flight(self):
  result=self.run_clip(decoy=True);self.assertEqual(result['points'],[]);self.assertEqual(result['scanned_frames'],49)
 def test_scans_gap_and_reacquires(self):
  result=self.run_clip(reentry=True);frames={p['frame'] for p in result['points']}
  self.assertTrue(any(f>32 for f in frames),result);self.assertTrue(all(f not in frames for f in range(18,30)),result)
 def test_invalid_contact_rejected(self):
  with tempfile.TemporaryDirectory() as directory:
   folder=Path(directory);self.clip(folder)
   with self.assertRaises(ValueError):scan({'frames_dir':str(folder),'fps':30,'contact':{'frame':49,'x':70,'y':130}})

if __name__=='__main__':unittest.main()
