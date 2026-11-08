import sys
import unittest
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ev-predictor" / "synthetic"))
from direct_video_estimate import baseline_constraints, baseline_projection_errors


class BaselineTests(unittest.TestCase):
    def test_segments_are_lines_not_base_locations(self):
        projected = np.array([[100, 100], [200, 150]])
        marked = np.array([[120, 110], [160, 130]])
        np.testing.assert_allclose(baseline_projection_errors(projected, marked), 0, atol=1e-10)
        self.assertGreater(abs(baseline_projection_errors(projected, marked + [0, 10])[0]), 5)

    def test_pairs_and_legacy_packages(self):
        self.assertEqual(baseline_constraints({"landmarks": []}), [])
        marks = [{"landmark": f"{side}_baseline_{end}", "image_x": x, "image_y": 100}
                 for side in ("first", "third") for end, x in (("near", 100), ("far", 150))]
        self.assertEqual(len(baseline_constraints({"landmarks": marks})), 2)
        marks[1]["image_x"] = 101
        with self.assertRaises(ValueError):
            baseline_constraints({"landmarks": marks})


if __name__ == "__main__":
    unittest.main()
