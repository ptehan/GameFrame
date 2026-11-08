import json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
import direct_video_estimate as estimator
from evidence_analysis_cache import clear_analysis_cache

class BackgroundPreparationTests(unittest.TestCase):
 def test_preparation_does_not_fit_camera_or_flights(self):
  clear_analysis_cache()
  with tempfile.TemporaryDirectory() as tmp:
   inp=Path(tmp)/'input.json';out=Path(tmp)/'prepared.json'
   package={'_prepare_background_only':True,'video_metadata':{'width_px':1280,'height_px':720},
            'hit':{'contact':{'timestamp_s':0}},'ball_observations':[
             {'role':'CONTACT_POINT','relative_time_s':0,'image_x':500,'image_y':500,'source':'HUMAN'},
             {'relative_time_s':.3,'image_x':400,'image_y':300,'source':'HUMAN'}]}
   inp.write_text(json.dumps(package))
   with (patch.object(estimator,'constrained_pose_from_three_landmarks',side_effect=AssertionError('must not fit geometry')),
         patch.object(estimator,'prepare_staged_flight',side_effect=AssertionError('must not fit flights'))):
    estimator.main([str(inp),'--out',str(out)])
   result=json.loads(out.read_text())
   self.assertEqual(result['method'],'background_preparation')
   self.assertTrue(result['prepared'])
   self.assertNotIn('ev_candidates',result)

if __name__=='__main__':unittest.main()
