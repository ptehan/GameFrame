import sys
from pathlib import Path
import unittest
from unittest.mock import patch
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ev-predictor' / 'synthetic'))
import clip_replay as replay


class ClosingCardTest(unittest.TestCase):
    def test_fit_summary_changes_with_evidence_and_limits(self):
        shared = {'acceptable': True, 'used_count': 1,
                  'best': {'distance_ft':134, 'hang_time_s':1.37},
                  'selection_policy':{'target_distance_ft':134},
                  'hang_time_evidence':{'landing_time_s':1.440975}}
        prediction = {'direction_first_match': shared}
        self.assertEqual(replay.prediction_confidence_sentence(prediction),
                         'Only 1 ball position after contact was used. Calculated distance is within 1 ft of your entry. Calculated time in air differs from your video timing by 0.07 s.')
        shared['used_count'] = 5
        shared['best']['distance_ft'] = 138
        self.assertIn('Compared with 5 ball positions after contact. Calculated distance differs from your entry by 4 ft.', replay.prediction_confidence_sentence(prediction))
        shared['at_speed_boundary'] = True
        self.assertIn('edge of the tested speeds or directions', replay.prediction_confidence_sentence(prediction))
        shared['acceptable'] = False
        self.assertIn('does not follow the ball positions', replay.prediction_confidence_sentence(prediction))

    def test_results_fit_common_video_sizes_without_explanatory_paragraphs(self):
        prediction = {'direction_first_match':{'acceptable':True,'used_count':1,
            'best':{'distance_ft':324,'hang_time_s':3.86},
            'selection_policy':{'target_distance_ft':324},
            'hang_time_evidence':{'landing_time_s':3.84}}}
        for width,height in [(1280,480),(1280,720),(640,360),(720,1280)]:
            calls = []
            original = replay.cv2.putText
            def record(canvas,text,origin,font,scale,color,weight,line_type):
                (w,h),baseline = replay.cv2.getTextSize(text,font,scale,weight)
                self.assertLessEqual(origin[0]+w,width)
                self.assertGreaterEqual(origin[1]-h,0)
                self.assertLessEqual(origin[1]+baseline,height)
                calls.append(text.strip())
                return original(canvas,text,origin,font,scale,color,weight,line_type)
            with patch.object(replay.cv2,'putText',side_effect=record):
                frame = replay.draw_end_card(np.zeros((height,width,3),dtype=np.uint8),['EV 84 mph','LA 30 deg','DISTANCE 324 ft'],[],prediction)
            text = ' '.join(calls)
            self.assertIn('EXIT VELOCITY',text)
            self.assertIn('84 mph',text)
            self.assertIn('DISTANCE',text)
            self.assertIn('324 ft',text)
            self.assertIn('LAUNCH ANGLE',text)
            self.assertIn('30 deg',text)
            self.assertIn('Video estimate',text)
            self.assertNotIn(replay.prediction_confidence_sentence(prediction),text)
            self.assertNotIn('What was compared',text)
            self.assertNotIn('FINAL ESTIMATE',text)
            self.assertNotIn('Fit to your marks',text)
            self.assertEqual(frame.shape,(height,width,3))


if __name__ == '__main__':
    unittest.main()
