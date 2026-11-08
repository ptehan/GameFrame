"""Cooperative cancellation, shared across hot-reloaded estimator modules."""
import threading
from contextlib import contextmanager

_current = threading.local()


class PredictionCancelled(RuntimeError):
    pass


def check_cancelled():
    event = getattr(_current, 'event', None)
    if event is not None and event.is_set():
        raise PredictionCancelled('Estimate superseded or cancelled.')


@contextmanager
def cancellation_scope(event):
    previous = getattr(_current, 'event', None)
    _current.event = event
    try:
        check_cancelled()
        yield
    finally:
        _current.event = previous
