"""Warm estimator requests keep separate arguments and recover after errors."""
import importlib.util
from pathlib import Path
import threading
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prediction_runtime',
    Path(__file__).resolve().parents[1] / 'ev-predictor' / 'prediction_runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class PredictionRuntimeTest(unittest.TestCase):
    def test_changed_estimator_helpers_reload_between_requests(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            helper = directory / 'runtime_test_helper.py'
            helper.write_text("VALUE = 'old'\n", encoding='utf-8')
            (directory / 'direct_video_estimate.py').write_text('from runtime_test_helper import VALUE\n', encoding='utf-8')
            with patch.object(runtime, 'SYNTHETIC_DIRECTORY', directory), patch.object(runtime, '_source_stamp', None), \
                 patch.object(sys, 'path', sys.path.copy()), patch.dict(sys.modules):
                sys.modules.pop('direct_video_estimate', None)
                runtime.warm_estimator()
                self.assertEqual(sys.modules['direct_video_estimate'].VALUE, 'old')
                helper.write_text("VALUE = 'updated helper'\n", encoding='utf-8')
                runtime.warm_estimator()
                self.assertEqual(sys.modules['direct_video_estimate'].VALUE, 'updated helper')

    def test_reuses_thread_and_recovers_after_failed_request(self):
        calls = []
        def estimate(arguments, cancellation=None):
            calls.append((threading.get_ident(), list(arguments)))
            if arguments == ['bad']:
                raise ValueError('invalid marks')
            return arguments
        service = runtime.PredictionRuntime()
        with patch.object(runtime, 'warm_estimator') as warm, patch.object(runtime, 'warm_flight_math'), patch.object(runtime, 'estimate', estimate):
            try:
                service.warm()
                self.assertEqual(service.run(['first']), ['first'])
                with self.assertRaisesRegex(ValueError, 'invalid marks'):
                    service.run(['bad'])
                self.assertEqual(service.run(['second']), ['second'])
                self.assertEqual(len({call[0] for call in calls}), 1)
                self.assertEqual([call[1] for call in calls], [['first'], ['bad'], ['second']])
                warm.assert_called_once()
            finally:
                service.pool.shutdown()


if __name__ == '__main__':
    unittest.main()
