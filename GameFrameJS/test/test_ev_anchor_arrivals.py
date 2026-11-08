import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ev-predictor/synthetic'))
from observation_validation import reject_early_anchor_arrivals


def row(t, x, source='COMPUTER_VISION', y=0):
    return dict(relative_time_s=t, image_x=x, image_y=y, source=source, confidence='HIGH')


class AnchorArrivalTests(unittest.TestCase):
    def test_rejects_early_auto_point_not_later_manual_mark(self):
        rows=[row(0,0,'HUMAN'),row(7/30,80),row(8/30,99.5),row(10/30,100,'HUMAN')]
        original=copy.deepcopy(rows)
        accepted,rejected=reject_early_anchor_arrivals(rows)
        self.assertEqual(accepted,[rows[0],rows[1],rows[3]])
        self.assertEqual(rejected[0]['observation'],rows[2])
        self.assertEqual(rows,original)

    def test_frame_rate_and_direction(self):
        for fps in (30,60):
            for sign in (1,-1):
                rows=[row(0,0,'HUMAN'),row(8/fps,99.5*sign),row(10/fps,100*sign,'HUMAN')]
                accepted,rejected=reject_early_anchor_arrivals(rows,1/fps)
                self.assertEqual(len(rejected),1)
                self.assertEqual(accepted,[rows[0],rows[-1]])

    def test_preserves_adjacent_frames_manual_points_and_later_flight(self):
        for rows in ([row(0,0,'HUMAN'),row(9/30,99.5),row(10/30,100,'HUMAN')],
                     [row(0,0,'HUMAN'),row(8/30,99.5,'HUMAN'),row(10/30,100,'HUMAN')],
                     [row(0,0,'HUMAN'),row(.9,99.5),row(1.,100,'HUMAN')]):
            accepted,rejected=reject_early_anchor_arrivals(rows)
            self.assertEqual(accepted,rows)
            self.assertFalse(rejected)

    def test_does_not_require_constant_speed(self):
        rows=[row(0,0,'HUMAN'),row(2/30,40),row(5/30,72),row(8/30,95),row(10/30,100,'HUMAN')]
        self.assertEqual(reject_early_anchor_arrivals(rows),(rows,[]))

    def test_latest_hit_marker_is_rejected_with_manual_endpoint_intact(self):
        rows=[row(0,941.53,'HUMAN',448.97),
              row(.233333,603.51,y=134.03),
              row(.266667,572.78,y=105.4),
              row(.333333,572.09,'HUMAN',104.75)]
        accepted,rejected=reject_early_anchor_arrivals(rows)
        self.assertEqual(accepted,[rows[0],rows[1],rows[3]])
        self.assertEqual(len(rejected),1)
        self.assertAlmostEqual(rejected[0]['seconds_early'],.066666)


if __name__ == '__main__':
    unittest.main()
