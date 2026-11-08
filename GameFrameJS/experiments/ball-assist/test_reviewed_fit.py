import sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'ev-predictor/synthetic'))
from observation_validation import is_usable_flight_observation
from path_distance_match import match_path_and_distance

class ReachedGeometry(Exception):pass
class ReviewedFitTests(unittest.TestCase):
 def rows(self,source='COMPUTER_VISION',reviewed=False):
  return [dict(relative_time_s=0,image_x=300,image_y=200,source='HUMAN',role='CONTACT_POINT'),dict(relative_time_s=.8,image_x=200,image_y=80,source=source,confidence='MEDIUM',human_reviewed=reviewed)]
 def test_reviewed_medium_detection_reaches_fitter_including_later_marks(self):
  rows=self.rows(reviewed=True)
  with patch('path_distance_match.registered_origin',side_effect=ReachedGeometry):
   with self.assertRaises(ReachedGeometry):match_path_and_distance(rows,{},0,Path('unused.sqlite'))
  self.assertEqual(rows[1]['confidence'],'MEDIUM');self.assertEqual(rows[1]['source'],'COMPUTER_VISION')
 def test_unreviewed_medium_detection_is_still_excluded(self):
  result=match_path_and_distance(self.rows(),{},0,Path('unused.sqlite'))
  self.assertFalse(result['used']);self.assertIn('timed flight point',result['reason'])
 def test_regular_manual_interval_mark_still_reaches_fitter(self):
  with patch('path_distance_match.registered_origin',side_effect=ReachedGeometry):
   with self.assertRaises(ReachedGeometry):match_path_and_distance(self.rows(source='HUMAN'),{},0,Path('unused.sqlite'))
 def test_only_explicit_boolean_review_counts(self):
  self.assertFalse(is_usable_flight_observation(dict(source='COMPUTER_VISION',confidence='MEDIUM',human_reviewed='true')))
  self.assertTrue(is_usable_flight_observation(dict(source='COMPUTER_VISION',confidence='HIGH')))
if __name__=='__main__':unittest.main()
