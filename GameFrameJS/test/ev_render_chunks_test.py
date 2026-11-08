"""Concurrency, assembly, and audio regression coverage for EV exports."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ev-predictor' / 'synthetic'))
import clip_replay as replay


class ChunkSchedulingTests(unittest.TestCase):
    def test_long_sections_start_first_without_changing_playback_order(self):
        names=['Video','EV','Field map','Flight plane','Results']
        specs=[{'name':name,'output':Path(str(i)+'.mp4')} for i,name in enumerate(names)]
        started=[]
        with patch.object(replay,'_render_chunk',side_effect=lambda spec:(started.append(spec['name']),spec['output'])[1]),patch.object(replay,'report_progress'):
            outputs=replay._render_chunks(specs,workers=1)
        self.assertEqual(started[:2],['Flight plane','Video'])
        self.assertEqual(outputs,[spec['output'] for spec in specs])

    def test_jobs_overlap_and_results_keep_video_order(self):
        started = threading.Barrier(3, timeout=3)
        completed = []
        specs = [{'name': str(i), 'output': Path(f'{i}.mp4')} for i in range(3)]

        def render(spec):
            started.wait()
            time.sleep((2-int(spec['name'])) * .04)
            completed.append(spec['name'])
            return spec['output']

        with patch.object(replay, '_render_chunk', side_effect=render), \
             patch.object(replay, 'report_progress'):
            outputs = replay._render_chunks(specs, workers=3)
        self.assertEqual(outputs, [s['output'] for s in specs])
        self.assertEqual(completed[0], '2')
        self.assertEqual(set(completed), {'0', '1', '2'})

    def test_worker_error_is_not_reported_as_a_finished_video(self):
        specs = [{'name': 'broken', 'output': Path('broken.mp4')}]
        with patch.object(replay, '_render_chunk', side_effect=ValueError('encoder failed')), \
             patch.object(replay, 'report_progress'):
            with self.assertRaisesRegex(ValueError, 'encoder failed'):
                replay._render_chunks(specs, workers=1)


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
class ExportAssemblyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='ev-chunk-test-')
        cls.folder = Path(cls.temp.name)
        cls.source = cls.folder / 'source.mp4'
        subprocess.run([
            'ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i',
            'color=c=gray:size=320x180:rate=20:duration=2',
            '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=2',
            '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-shortest', str(cls.source),
        ], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    @staticmethod
    def focus(frame, label, value, index, total):
        colors = [(0, 0, 240), (0, 240, 0), (240, 0, 0)]
        return np.full_like(frame, colors[index])

    def render(self, output):
        with patch.dict(os.environ, {'EV_VIDEO_ENCODER': 'libx264', 'EV_RENDER_WORKERS': '6'}), \
             patch.object(replay, 'draw_banner', side_effect=lambda frame, *args: frame), \
             patch.object(replay, 'draw_focus_stat_card', side_effect=self.focus), \
             patch.object(replay, 'draw_end_card', side_effect=lambda frame, *args: np.full_like(frame, (25, 45, 65))), \
             patch.object(replay, 'report_progress'):
            replay.video_encoder.cache_clear()
            replay.render_clip(self.source, {}, None, output, .25, .25, .69,
                               ['EV 88 mph', 'LA 22 deg', 'DISTANCE 326 ft'])
        replay.video_encoder.cache_clear()

    def test_real_chunks_keep_order_frame_count_dimensions_and_audio_delay(self):
        output = self.folder / 'assembled.mp4'
        self.render(output)
        info = json.loads(subprocess.check_output([
            'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(output),
        ]))
        video = next(s for s in info['streams'] if s['codec_type'] == 'video')
        audio = next(s for s in info['streams'] if s['codec_type'] == 'audio')
        # The 0.94 s source window occupies 19 frames at 20 fps (0.95 s),
        # followed by the 1.5 s hold, three 1.25 s stats and 5 s closing.
        self.assertEqual(int(video['nb_frames']), 224)
        self.assertEqual((video['width'], video['height']), (320, 180))
        self.assertEqual(video['avg_frame_rate'], '20/1')
        self.assertAlmostEqual(float(video['duration']), 11.20, delta=.06)
        self.assertAlmostEqual(float(audio['start_time']), 0., delta=.04)
        self.assertAlmostEqual(float(audio['duration']), 2.44, delta=.08)
        samples = np.frombuffer(subprocess.check_output([
            'ffmpeg', '-v', 'error', '-i', str(output), '-map', '0:a:0',
            '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1',
        ]), dtype=np.float32)
        self.assertLess(float(np.sqrt(np.mean(samples[:int(1.4*48000)]**2))), .001)
        self.assertGreater(float(np.sqrt(np.mean(samples[int(1.6*48000):int(2.3*48000)]**2))), .03)
        first_sound = np.flatnonzero(np.abs(samples) > .02)[0] / 48000
        self.assertAlmostEqual(first_sound, 1.5, delta=.04)
        self.assertLess(len(samples)/48000, 2.55, 'Audio from after the selected window leaked into the closing cards')
        cap = cv2.VideoCapture(str(output))
        try:
            for frame_index, expected in [(55, (0, 0, 240)), (80, (0, 240, 0)),
                                           (105, (240, 0, 0)), (140, (25, 45, 65))]:
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                ok, frame = cap.read()
                self.assertTrue(ok)
                actual = frame.mean(axis=(0, 1))
                np.testing.assert_allclose(actual, expected, atol=8)
        finally:
            cap.release()
        # Decoder must traverse every independent H.264 chunk boundary without errors.
        subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(output),
                        '-f', 'null', '-'], check=True, capture_output=True)

    def test_worker_failure_preserves_existing_export(self):
        output = self.folder / 'existing.mp4'
        output.write_bytes(b'previous complete video')
        with patch.object(replay, '_render_chunks', side_effect=RuntimeError('chunk drawing failed')):
            with self.assertRaisesRegex(RuntimeError, 'chunk drawing failed'):
                self.render(output)
        self.assertEqual(output.read_bytes(), b'previous complete video')


if __name__ == '__main__':
    unittest.main(verbosity=2)
