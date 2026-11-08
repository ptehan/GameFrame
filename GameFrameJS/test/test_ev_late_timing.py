import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from late_flight_timing import late_timing_evidence,timing_error_seconds

class LateTimingTests(unittest.TestCase):
 def rows(self,values,uncertainty=1):
  return [dict(relative_time_s=t,image_y=y,uncertainty_px=uncertainty) for t,y in values]
 def test_absolute_height_offset_changes_nothing(self):
  rows=self.rows([(1.5,100),(1.667,130),(1.833,160)])
  self.assertEqual(late_timing_evidence(rows),late_timing_evidence([{**r,'image_y':r['image_y']+500} for r in rows]))
 def test_visible_descent_rules_out_a_model_that_turns_too_late(self):
  evidence=late_timing_evidence(self.rows([(1.5,100),(1.667,130),(1.833,160)]))
  self.assertTrue(evidence['used']);self.assertFalse(evidence['uses_absolute_height'])
  self.assertEqual(timing_error_seconds(evidence,1.4),0)
  self.assertGreater(timing_error_seconds(evidence,2),evidence['tolerance_s'])
 def test_late_upward_reversal_is_uncertain_not_a_fit_constraint(self):
  evidence=late_timing_evidence(self.rows([(1,100),(1.2,140),(1.4,100),(1.6,60)]))
  self.assertFalse(evidence['used']);self.assertEqual(timing_error_seconds(evidence,2),0)
 def test_normal_rise_then_fall_can_bracket_the_turn(self):
  evidence=late_timing_evidence(self.rows([(1,140),(1.2,100),(1.4,80),(1.6,100),(1.8,140)]))
  self.assertTrue(evidence['used'])
  self.assertLessEqual(evidence['image_apex_not_before_s'],1.4)
  self.assertGreaterEqual(evidence['image_apex_not_after_s'],1.4)
 def test_uncertain_small_steps_can_accumulate_into_visible_descent(self):
  evidence=late_timing_evidence(self.rows([(1+i/12,100+i*5) for i in range(6)],6))
  self.assertTrue(evidence['used'])
 def test_do_not_infer_turn_timing_across_long_gaps(self):
  self.assertFalse(late_timing_evidence(self.rows([(1,100),(3,200)]))['used'])

if __name__=='__main__':unittest.main()
