"""Internal EV processor. Communicates over stdio; opens no network listener."""
import io
import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from email.message import Message
from pathlib import Path

from clip_server import ClipServerHandler, json_response

protocol = sys.stdout
sys.stdout = sys.stderr
output_lock = threading.Lock()


class WorkerHandler(ClipServerHandler):
    def __init__(self, request, output):
        self.request_id = request['id']
        self.path = request['path']
        self.command = request['method']
        body = json.dumps(request.get('body') or {}).encode('utf-8')
        self.headers = Message()
        self.headers['Content-Length'] = str(len(body))
        self.headers['Content-Type'] = 'application/json'
        self.rfile = io.BytesIO(body)
        self.wfile = output
        self.status = 200
        self.response_headers = {}

    def send_response(self, code, message=None):
        self.status = code

    def send_header(self, name, value):
        self.response_headers[name] = str(value)

    def end_headers(self):
        self.response_headers['Cache-Control'] = 'no-store'
        if getattr(sys.modules.get('clip_server'), 'MEDIA_RUNTIME', None) is not None:
            self.response_headers['X-GameFrame-Processor'] = '20261105-warm-media'

    def send_error(self, code, message=None, explain=None):
        json_response(self, code, {'error': message or 'Not found'})

    def log_message(self, *args):
        pass


def handle(request):
    try:
        with Path(request['output']).open('wb') as output:
            handler = WorkerHandler(request, output)
            try:
                if request['method'] == 'POST':
                    handler.do_POST()
                elif request['method'] == 'GET':
                    # Never fall through to SimpleHTTPRequestHandler's static serving.
                    if request['path'].split('?')[0] not in {
                        '/api/gameframe/options', '/api/gameframe/ev-hits',
                        '/api/gameframe/ev-hit', '/api/gameframe/ev-clip',
                        '/api/gameframe/ev-json', '/api/gameframe/ev-video-status', '/api/clip/status', '/api/clip/download',
                    }:
                        handler.send_error(404)
                    else:
                        handler.do_GET()
                else:
                    handler.send_error(405)
            except Exception as error:
                output.seek(0)
                output.truncate()
                handler.response_headers = {}
                json_response(handler, 500, {'error': str(error)})
        result = {'id': request['id'], 'status': handler.status, 'headers': handler.response_headers}
    except Exception as error:
        result = {'id': request['id'], 'error': str(error)}
    if request.get('path', '').split('?')[0] == '/api/predict':
        import clip_server
        if clip_server.PREDICTION_RUNTIME is not None:
            clip_server.PREDICTION_RUNTIME.finish(request['id'])
    with output_lock:
        protocol.write(json.dumps(result) + '\n')
        protocol.flush()


if __name__ == '__main__':
    import clip_server
    from prediction_runtime import PredictionRuntime, warm_estimator
    # Load native math libraries before blocking on the Windows stdin pipe.
    # Loading BLAS concurrently with that read can stall DLL initialization.
    warm_estimator()
    from media_runtime import MediaRuntime
    clip_server.MEDIA_RUNTIME = MediaRuntime()
    clip_server.MEDIA_RUNTIME.warm()
    clip_server.PREDICTION_RUNTIME = PredictionRuntime()
    clip_server.PREDICTION_RUNTIME.warm(wait=True)
    from encoder_runtime import warm_video_encoder
    warm_video_encoder().result()
    clip_server.background_videos().recover()
    with ThreadPoolExecutor(max_workers=4) as executor:
        for line in sys.stdin:
            request = json.loads(line)
            if request.get('method') == 'CANCEL':
                clip_server.PREDICTION_RUNTIME.cancel(request['id'])
                continue
            if request.get('path', '').split('?')[0] == '/api/predict':
                clip_server.PREDICTION_RUNTIME.register(request['id'])
            executor.submit(handle, request)
