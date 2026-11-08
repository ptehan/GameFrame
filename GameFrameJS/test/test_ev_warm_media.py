import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ev-predictor'))
import clip_server as service


class WarmMediaTests(unittest.TestCase):
    def test_field_request_uses_loaded_detector_without_a_python_subprocess(self):
        responses = []
        handler = object.__new__(service.ClipServerHandler)
        runtime = SimpleNamespace(landmarks=Mock(return_value={'scale': 1., 'landmarks': []}))
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'source.mp4'
            source.touch()
            package = {'video_metadata': {'file_name': source.name}}
            with (patch.object(service, 'MEDIA_RUNTIME', runtime),
                  patch.object(service, 'LIVE_DIR', Path(folder)),
                  patch.object(service, 'locate_video', return_value=source),
                  patch.object(service, 'handle_json_body', return_value={'package': package, 'frame_time_s': 2.}),
                  patch.object(service, 'json_response', side_effect=lambda h, status, body: responses.append((status, body))),
                  patch.object(service.subprocess, 'run', side_effect=AssertionError('must not start another Python process'))):
                handler.handle_landmarks()
            self.assertEqual(responses[0][0], 200)
            runtime.landmarks.assert_called_once_with(source, 2., package)

    def test_export_reports_progress_and_success_without_a_python_subprocess(self):
        self.export_case(False)

    def test_export_failure_is_not_reported_as_a_finished_video(self):
        self.export_case(True)

    def export_case(self, fail):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'source.mp4'
            source.touch()
            job_id = 'warm-media-test'
            def render(*args):
                if fail:
                    raise RuntimeError('test-render-failed')
                Path(args[3]).write_bytes(b'test-video')
                args[8]('test progress', .8)
            runtime = SimpleNamespace(render=Mock(side_effect=render))
            with (patch.object(service, 'MEDIA_RUNTIME', runtime),
                  patch.object(service, 'CLIP_DIR', Path(folder)),
                  patch.object(service, 'LIVE_DIR', Path(folder)),
                  patch.object(service, 'locate_video', return_value=source),
                  patch.object(service, 'ffprobe_duration', return_value=8.),
                  patch.object(service, 'prepare_source_clip'),
                  patch.object(service, 'set_export_player', return_value='Test player'),
                  patch.dict(service.JOBS, {job_id: {'status': 'queued'}}),
                  patch.object(service.subprocess, 'Popen', side_effect=AssertionError('must not start another Python process'))):
                service.run_clip_job(job_id, {'file_name': source.name, 'contact_time_s': 1., 'package': {}, 'prediction': {}})
                job = service.JOBS[job_id]
                self.assertEqual(job['status'], 'error' if fail else 'done')
                if fail:
                    self.assertIn('test-render-failed', job['error'])
                else:
                    self.assertIn(job_id, job['download_url'])
                runtime.render.assert_called_once()


if __name__ == '__main__':
    unittest.main()
