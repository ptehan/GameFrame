import copy,sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from late_descent_rate import descent_rate_evidence,compare_descent_rate

class DescentRateTests(unittest.TestCase):
 def rows(self):
  return [dict(relative_time_s=t,image_x=500,image_y=100+100*(t-1),uncertainty_px=2,
    camera_registered=True,timing_uncertainty_s=0) for t in [1,1.2,1.4,1.6]]
 def test_common_height_offset_and_horizontal_position_do_not_change_evidence(self):
  rows=self.rows();a=descent_rate_evidence(rows)
  moved=copy.deepcopy(rows)
  for r in moved:r['image_y']+=500;r['image_x']+=1000
  b=descent_rate_evidence(moved)
  self.assertTrue(a['used']);self.assertAlmostEqual(a['observed_rate_px_per_s'],100)
  self.assertAlmostEqual(a['observed_rate_px_per_s'],b['observed_rate_px_per_s'])
  times=np.array([r['relative_time_s'] for r in rows])
  fit=compare_descent_rate(a,times,[900+100*(t-1) for t in times])
  self.assertTrue(fit['consistent']);self.assertAlmostEqual(fit['score'],0)
 def test_wrong_descent_rate_is_not_accepted_by_shifting_the_curve(self):
  rows=self.rows();evidence=descent_rate_evidence(rows);times=[r['relative_time_s'] for r in rows]
  fit=compare_descent_rate(evidence,times,[900+150*(t-1) for t in times])
  self.assertFalse(fit['consistent']);self.assertGreater(fit['score'],4)
 def test_unregistered_or_too_few_points_do_not_supply_rate(self):
  rows=self.rows()
  for r in rows:r['camera_registered']=False
  self.assertFalse(descent_rate_evidence(rows)['used'])
  self.assertFalse(descent_rate_evidence(self.rows()[:2])['used'])
 def test_disappearance_is_not_bridged_to_create_rate(self):
  rows=self.rows()
  for i,r in enumerate(rows):r['relative_time_s']=[1,1.2,2.2,2.4][i]
  self.assertFalse(descent_rate_evidence(rows)['used'])
 def test_apparent_reversal_leaves_rate_unused(self):
  rows=self.rows()
  for r,y in zip(rows,[100,150,110,140]):r['image_y']=y
  self.assertFalse(descent_rate_evidence(rows)['used'])
 def test_source_timestamp_uncertainty_widens_comparison_allowance(self):
  rows=self.rows();a=descent_rate_evidence(rows)
  for r in rows:r['timing_uncertainty_s']=.05
  b=descent_rate_evidence(rows)
  self.assertTrue(b['used']);self.assertGreater(b['rate_allowance_px_per_s'],a['rate_allowance_px_per_s'])
 def test_irregular_frame_times_use_actual_elapsed_time(self):
  rows=self.rows()
  for r,t in zip(rows,[1,1.13,1.45,1.7]):r.update(relative_time_s=t,image_y=100+100*(t-1))
  self.assertAlmostEqual(descent_rate_evidence(rows)['observed_rate_px_per_s'],100)
 def test_model_cannot_evade_rate_evidence_with_an_invisible_projection(self):
  rows=self.rows();evidence=descent_rate_evidence(rows)
  fit=compare_descent_rate(evidence,[r['relative_time_s'] for r in rows],[r['image_y'] for r in rows],[True,True,False,True])
  self.assertTrue(fit['used']);self.assertFalse(fit['consistent'])

if __name__=='__main__':unittest.main()
