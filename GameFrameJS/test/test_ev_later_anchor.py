import sys, unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from path_distance_match import match_path_and_distance
class LaterAnchorTests(unittest.TestCase):
 def test_half_second_manual_point_reaches_fitter(self):
  rows=[dict(source='HUMAN',relative_time_s=t,image_x=100+200*t,image_y=100-50*t) for t in [0,1/3,.5,2/3,5/6,1.,1.5]]
  seen=[]
  def capture(points,anchor):
   seen.extend(p['relative_time_s'] for p in points)
   raise RuntimeError('fit inputs captured')
  with patch('path_distance_match.registered_origin',return_value=np.array([0.,0.,3.])),patch('path_distance_match.manual_path_tolerance',side_effect=capture):
   with self.assertRaisesRegex(RuntimeError,'fit inputs captured'):
    match_path_and_distance(rows,{},0,Path('unused.sqlite'))
  self.assertEqual(seen,[1/3,.5,2/3,5/6,1.,1.5])
if __name__=='__main__':unittest.main()
