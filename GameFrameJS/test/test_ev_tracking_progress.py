import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor'/'synthetic'))
from auto_track_ball import build_output_package, manual_line_track, reject_backward_track_points, smooth_detected_track


def point(frame,x,y=0,**extra):
    return dict(frame_index=frame,x=float(x),y=float(y),score=180.,prediction_error_px=0.,area=1,**extra)


class TrackingProgressTests(unittest.TestCase):
    def setUp(self):
        self.package={'hit':{'contact':{'timestamp_s':2}},
            'video_metadata':{'detection_brush':{'points':[{'x':0,'y':0},{'x':200,'y':0}],'width_px':40}},
            'ball_observations':[{'relative_time_s':0,'image_x':0,'image_y':0,'source':'HUMAN'}]}

    def test_backward_point_becomes_gap_without_coordinate_changes(self):
        track=[point(1,30),point(2,60),point(3,45),point(4,90)]
        before=copy.deepcopy(track)
        accepted,rejected=reject_backward_track_points(self.package,track)
        self.assertEqual([p['frame_index'] for p in accepted],[1,2,4])
        self.assertEqual(rejected[0]['frame_index'],3)
        self.assertEqual(track,before)
        result=build_output_package(self.package,track,30)
        self.assertEqual([p['image_x'] for p in result['ball_observations']],[0,30,60,90])
        self.assertEqual(result['ball_observations'][-1]['relative_time_s'],round(4/30,6))
        self.assertEqual(result['auto_tracking']['tracked_points'],3)
        self.assertEqual(len(result['auto_tracking']['rejected_points']),1)

    def test_final_point_is_not_exempt(self):
        track=[point(1,30),point(2,60),point(3,100),point(4,90)]
        result=smooth_detected_track(track,(0,0))
        self.assertEqual([p['frame_index'] for p in result],[1,2,3])
        accepted,_=reject_backward_track_points(self.package,[point(1,30),point(2,20)])
        self.assertEqual(len(accepted),1)

    def test_projection_cannot_hide_raw_backward_detection(self):
        track=[point(1,30,raw_x=30,raw_y=0),point(2,40,raw_x=20,raw_y=0)]
        accepted,rejected=reject_backward_track_points(self.package,track)
        self.assertEqual(len(accepted),1)
        self.assertEqual(rejected[0]['reason'],'backward_or_stationary_along_flight')

    def test_stationary_and_evidence_free_points_are_dropped(self):
        track=[point(1,30),point(2,30),point(3,60,path_source='brush_line_prior'),point(4,90)]
        accepted,rejected=reject_backward_track_points(self.package,track)
        self.assertEqual([p['frame_index'] for p in accepted],[1,4])
        self.assertEqual(len(rejected),2)

    def test_leftward_motion_is_forward_along_leftward_hint(self):
        self.package['video_metadata']['detection_brush']['points'][1]['x']=-200
        accepted,_=reject_backward_track_points(self.package,[point(1,-30),point(2,-20),point(3,-60)])
        self.assertEqual([p['x'] for p in accepted],[-30,-60])

    def test_manual_endpoint_cannot_jump_back_or_repeat(self):
        responses=[np.zeros((50,200)) for _ in range(5)]
        with patch('auto_track_ball.best_line_evidence',side_effect=[(40,30),(40,60),(40,85),(40,100)]):
            result=manual_line_track(responses,(0,10),{5:(100,10)},30)
        self.assertEqual([p['frame_index'] for p in result],[1,2,3,4])


if __name__=='__main__':
    unittest.main()
