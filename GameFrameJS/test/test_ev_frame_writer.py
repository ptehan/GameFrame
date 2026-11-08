import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ev-predictor' / 'synthetic'))
from clip_replay import EncodedFrameWriter, video_encoder


class FrameWriterTest(unittest.TestCase):
    def test_hardware_selection_and_software_fallback(self):
        for code, expected in [(0, 'h264_qsv'), (1, 'libx264')]:
            video_encoder.cache_clear()
            with patch.dict('os.environ', {'EV_VIDEO_ENCODER': 'auto'}), \
                 patch('clip_replay.subprocess.run', return_value=SimpleNamespace(returncode=code)):
                self.assertEqual(video_encoder(), expected)
        video_encoder.cache_clear()

    def test_preserves_frame_count_order_and_dimensions(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'frames.mp4'
            with EncodedFrameWriter(output, 30, 96, 64) as writer:
                for level in [30, 70, 110, 150, 190]:
                    writer.write(np.full((64, 96, 3), level, dtype=np.uint8))
                writer.release()
            cap = cv2.VideoCapture(str(output))
            self.assertEqual(cap.get(cv2.CAP_PROP_FRAME_COUNT), 5)
            self.assertEqual(cap.get(cv2.CAP_PROP_FPS), 30)
            for level in [30, 70, 110, 150, 190]:
                ok, frame = cap.read()
                self.assertTrue(ok)
                self.assertEqual(frame.shape, (64, 96, 3))
                self.assertAlmostEqual(float(frame.mean()), level, delta=5)
            self.assertFalse(cap.read()[0])
            cap.release()

    def test_render_failure_stops_encoder(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'drawing failed'):
                with EncodedFrameWriter(Path(directory) / 'partial.mp4', 30, 96, 64) as writer:
                    raise ValueError('drawing failed')
            self.assertIsNotNone(writer.process.poll())


if __name__ == '__main__':
    unittest.main()
