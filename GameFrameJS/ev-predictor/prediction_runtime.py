"""Keep estimator imports warm in the app's internal Python worker."""
import sys
import importlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SYNTHETIC_DIRECTORY = Path(__file__).resolve().parent / 'synthetic'
if str(SYNTHETIC_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(SYNTHETIC_DIRECTORY))
from prediction_cancel import cancellation_scope
_source_stamp = None
_estimator_lock = threading.RLock()


def warm_estimator():
    global _source_stamp
    with _estimator_lock:
        directory = str(SYNTHETIC_DIRECTORY)
        if directory not in sys.path:
            sys.path.insert(0, directory)
        stamp = tuple((p.name, p.stat().st_mtime_ns, p.stat().st_size)
                      for p in sorted(SYNTHETIC_DIRECTORY.glob('*.py')))
        if _source_stamp is not None and stamp != _source_stamp:
            # Reload the estimator and its local helpers together, between requests.
            for name, module in list(sys.modules.items()):
                filename = getattr(module, '__file__', None)
                if name != 'prediction_cancel' and filename and Path(filename).resolve().parent == SYNTHETIC_DIRECTORY.resolve():
                    cached = getattr(module, '__cached__', None)
                    if cached and Path(cached).resolve().parent == SYNTHETIC_DIRECTORY.resolve() / '__pycache__':
                        Path(cached).unlink(missing_ok=True)
                    del sys.modules[name]
            importlib.invalidate_caches()
        importlib.import_module('direct_video_estimate')
        _source_stamp = stamp
        return True


def estimate(arguments, cancellation=None):
    with _estimator_lock, cancellation_scope(cancellation):
        warm_estimator()
        from direct_video_estimate import main
        started = time.perf_counter()
        # Keep stdout away from IPC; worker.py already routes it to stderr.
        main(arguments)
        return '', time.perf_counter() - started


def warm_flight_math():
    from baseball_flight import Hit, simulate_trajectory
    simulate_trajectory(Hit(85., 20., -15.), sample_times=[0., .333, 2.])


class PredictionRuntime:
    def __init__(self):
        self.lock = threading.Lock()
        self.pool = None
        self.tokens = {}

    def register(self, request_id):
        with self.lock:
            return self.tokens.setdefault(request_id, threading.Event())

    def cancel(self, request_id):
        with self.lock:
            token = self.tokens.get(request_id)
            if token is not None:
                token.set()

    def finish(self, request_id):
        with self.lock:
            self.tokens.pop(request_id, None)

    def warm(self, wait=False):
        with self.lock:
            pool = self._pool()
            ready = pool.submit(lambda: True) if wait else None
        if ready is not None:
            ready.result()

    def _pool(self):
        if self.pool is None:
            self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='ev-estimator')
            self.pool.submit(warm_estimator)
            self.pool.submit(warm_flight_math)
        return self.pool

    def run(self, arguments, request_id=None):
        # Avoid competing numerical searches on small machines.
        token = self.register(request_id) if request_id is not None else threading.Event()
        with self.lock:
            future = self._pool().submit(estimate, arguments, token)
        try:
            return future.result(timeout=240)
        except TimeoutError:
            token.set()
            raise
        finally:
            if request_id is not None:
                self.finish(request_id)
