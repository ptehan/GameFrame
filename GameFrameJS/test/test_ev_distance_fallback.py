import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ev-predictor" / "synthetic"))
from direct_video_estimate import export_readiness_for_prediction, useful_velocity_path


class DistanceFallbackTest(unittest.TestCase):
    def prediction(self, evidence):
        return {
            "ev_candidates": [{"launch_angle_deg": 27, "path_distance_ratio": 2}],
            "field_direction": {"source": "actual_field_map", "estimated_distance_ft": 320},
            "projected_path_evidence": evidence,
            "path_only_model_fit": {"best": {"distance_ft": 221}},
        }

    def test_unreliable_or_missing_path_uses_distance(self):
        for evidence in ({}, {"used": True, "used_count": 8, "path_evidence_strength": .9,
                              "timing_reliable": False},
                         {"used": True, "used_count": 8, "path_evidence_strength": .9,
                          "timing_reliable": True, "pose_landmark_rmse_px": 37}):
            result = export_readiness_for_prediction(self.prediction(evidence), [])
            self.assertTrue(result["allowed"])
            self.assertFalse(result["evidence"]["early_path_validated"])

    def test_reliable_path_still_validates(self):
        evidence = {"used": True, "used_count": 8, "path_evidence_strength": .9,
                    "timing_reliable": True, "pose_landmark_rmse_px": 5}
        self.assertTrue(useful_velocity_path(evidence))
        self.assertFalse(export_readiness_for_prediction(self.prediction(evidence), [])["allowed"])

    def test_missing_distance_or_prediction_not_bypassed(self):
        prediction = self.prediction({})
        prediction["field_direction"] = {}
        self.assertFalse(export_readiness_for_prediction(prediction, [])["allowed"])
        self.assertFalse(export_readiness_for_prediction({}, [])["allowed"])


if __name__ == "__main__":
    unittest.main()
