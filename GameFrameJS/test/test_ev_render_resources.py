import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ev-predictor/synthetic'))
import clip_replay as replay


class RenderResourcesTests(unittest.TestCase):
    def test_background_encoding_does_not_get_starved_by_lower_process_priority(self):
        with patch.object(replay.subprocess,'CREATE_NO_WINDOW',8,create=True),patch.object(replay.subprocess,'BELOW_NORMAL_PRIORITY_CLASS',4,create=True):
            self.assertEqual(replay.encoder_process_flags(False),8)
            self.assertEqual(replay.encoder_process_flags(True),8)

    def test_small_computer_does_not_start_eight_encoders(self):
        with patch.dict(replay.os.environ, {}, clear=True), patch.object(replay, 'available_cpu_count', return_value=2):
            self.assertEqual(replay.render_workers(), 2)
            self.assertEqual(replay.encoder_threads(), 1)

    def test_larger_computer_can_use_parallel_sections(self):
        with patch.dict(replay.os.environ, {}, clear=True), patch.object(replay, 'available_cpu_count', return_value=16):
            self.assertEqual(replay.render_workers(), 4)
            self.assertEqual(replay.encoder_threads(), 2)

    def test_hardware_can_overlap_four_sessions_without_adding_encoder_threads(self):
        with patch.dict(replay.os.environ, {}, clear=True), patch.object(replay, 'available_cpu_count', return_value=2):
            self.assertEqual(replay.render_workers('h264_qsv'),4)
            self.assertEqual(replay.render_workers('libx264'),2)
            self.assertEqual(replay.encoder_threads(),1)

    def test_explicit_resource_settings_remain_available(self):
        with patch.dict(replay.os.environ, {'EV_RENDER_WORKERS': '3', 'EV_ENCODER_THREADS': '2'}):
            self.assertEqual(replay.render_workers(), 3)
            self.assertEqual(replay.render_workers('h264_qsv'), 3)
            self.assertEqual(replay.encoder_threads(), 2)


if __name__ == '__main__':
    unittest.main()
