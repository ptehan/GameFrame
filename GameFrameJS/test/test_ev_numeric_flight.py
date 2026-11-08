import sys,unittest,dataclasses
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from baseball_flight import Hit,Environment,StartPosition,simulate_trajectory

class NumericFlightTests(unittest.TestCase):
 def test_optimizer_samples_and_all_metadata_match_regular_trajectory_exactly(self):
  for speed,angle,bearing in [(40,5,-40),(83,26.6,-16),(120,55,30)]:
   with self.subTest(speed=speed,angle=angle):
    times=np.arange(0.,6.,.025)
    args=dict(start=StartPosition(-1.,2.,3.5),env=Environment(wind_mph=5.,wind_direction_deg=45.),sample_times=times)
    regular=simulate_trajectory(Hit(speed,angle,bearing),**args)
    samples=[]
    numeric=simulate_trajectory(Hit(speed,angle,bearing),**args,_position_buffer=samples)
    np.testing.assert_array_equal(samples,[(p.t_s,p.x_ft,p.y_ft,p.z_ft) for p in regular.points])
    for field in dataclasses.fields(regular):
     if field.name!='points':self.assertEqual(getattr(regular,field.name),getattr(numeric,field.name),field.name)
    self.assertEqual(numeric.points,[])

if __name__=='__main__':unittest.main()
