import json
import sys
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ev-predictor'))
from clip_server import ClipServerHandler, prediction_export_blocker


class ReviewExportTests(unittest.TestCase):
    def test_review_and_readiness_block_both_export_endpoints_before_work(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), ClipServerHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch('clip_server.cleanup_temp_video_outputs', side_effect=AssertionError('must not render')):
                for prediction in ({'distance_review': {'required': True, 'message': 'Correct marks'}},
                                   {'export_readiness': {'allowed': False, 'message': 'No good match'}}):
                    for endpoint in ('/api/clip', '/api/gameframe/save-hit'):
                        request = Request(f'http://127.0.0.1:{server.server_port}{endpoint}',
                                          json.dumps({'prediction': prediction}).encode(),
                                          {'Content-Type': 'application/json'})
                        with self.assertRaises(HTTPError) as error:
                            urlopen(request)
                        self.assertEqual(error.exception.code, 409)
                        self.assertTrue(json.load(error.exception)['review_required'])
                        error.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_supported_claim_remains_exportable(self):
        self.assertIsNone(prediction_export_blocker({'distance_review': {'required': False},
                                                    'export_readiness': {'allowed': True}}))
