"""A predictor must not inherit the worker's long-lived command-input pipe."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class PredictionInputTest(unittest.TestCase):
    def test_prediction_finishes_while_worker_input_remains_open(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'synthetic').mkdir()
            (root / 'synthetic' / 'direct_video_estimate.py').write_text(
                "import json, pathlib, sys\n"
                "assert sys.stdin.read() == ''\n"
                "pathlib.Path(sys.argv[sys.argv.index('--out')+1]).write_text(json.dumps({'ev_candidates': []}))\n")
            processor = Path(__file__).resolve().parents[1] / 'ev-predictor'
            parent_code = """
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import clip_server as service
service.ROOT = Path(sys.argv[2])
service.LIVE_DIR = service.ROOT / 'live'
service.EV_PYTHON = sys.executable
service.handle_json_body = lambda handler: {}
service.json_response = lambda handler, status, data: print(json.dumps({'status': status, 'data': data}), flush=True)
object.__new__(service.ClipServerHandler).handle_predict()
"""
            parent = subprocess.Popen([sys.executable, '-c', parent_code, str(processor), str(root)],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True)
            try:
                # Deliberately keep stdin open, exactly as the app's IPC channel is.
                parent.wait(timeout=15)
                self.assertEqual(parent.returncode, 0, parent.stderr.read())
                result = json.loads(parent.stdout.read())
                self.assertEqual(result['status'], 200, result)
            finally:
                if parent.poll() is None:
                    parent.kill()
                    parent.wait()
                parent.stdin.close()
                parent.stdout.close()
                parent.stderr.close()


if __name__ == '__main__':
    unittest.main()
