import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from baseball_flight import Hit, StartPosition, simulate_trajectory


class SparseFlightTests(unittest.TestCase):
    def test_optimizer_samples_and_flight_metrics_are_exactly_unchanged(self):
        times=np.array([0,.033333,.166665,.33333,1.499985,1.99998,2.499975])
        for speed,angle,spray in [(70,20,-15),(87,21,-16),(100,30,12)]:
            hit=Hit(speed,angle,spray)
            full=simulate_trajectory(hit,start=StartPosition(2,-4,3))
            sparse=simulate_trajectory(hit,start=StartPosition(2,-4,3),sample_times=times)
            self.assertLess(len(sparse.points),len(full.points)/4)
            for key in ('distance_ft','hang_time_s','apex_ft','apex_time_s','landing_x_ft','landing_y_ft'):
                self.assertEqual(getattr(full,key),getattr(sparse,key))
            for axis in ('x_ft','y_ft','z_ft'):
                observed=[np.interp(times,[p.t_s for p in f.points],[getattr(p,axis) for p in f.points]) for f in (full,sparse)]
                np.testing.assert_array_equal(*observed)


if __name__=='__main__':unittest.main()
