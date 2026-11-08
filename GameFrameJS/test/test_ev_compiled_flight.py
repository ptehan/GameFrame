import sys
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
import baseball_flight
import flight_integrator


class CompiledFlightTests(unittest.TestCase):
    def test_compiled_flight_matches_python_across_speed_angle_spin_and_wind(self):
        self.assertIsNotNone(flight_integrator.compiled_integrator)
        for speed,angle,spray,wind in [(45,12,-35,0),(87,21,-16,0),(100,30,12,8),(115,45,25,15)]:
            hit=baseball_flight.Hit(speed,angle,spray)
            env=baseball_flight.Environment(wind_mph=wind,wind_direction_deg=40)
            with patch.object(baseball_flight,'integrate_flight',flight_integrator.integrate_python):
                reference=baseball_flight.simulate_trajectory(hit,env=env)
            actual=baseball_flight.simulate_trajectory(hit,env=env)
            self.assertEqual(len(actual.points),len(reference.points))
            for key in ('distance_ft','hang_time_s','apex_ft','apex_time_s','landing_x_ft','landing_y_ft'):
                self.assertAlmostEqual(getattr(actual,key),getattr(reference,key),places=9)
            np.testing.assert_allclose([[p.x_ft,p.y_ft,p.z_ft] for p in actual.points],
                                       [[p.x_ft,p.y_ft,p.z_ft] for p in reference.points],rtol=1e-12,atol=1e-10)

    def test_missing_accelerator_keeps_working_python_path(self):
        with patch.object(flight_integrator,'compiled_integrator',None):
            result=baseball_flight.simulate_trajectory(baseball_flight.Hit(87,21,-16))
        self.assertGreater(result.distance_ft,200)


if __name__=='__main__':unittest.main()
