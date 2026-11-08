"""Small, process-local cache of fits from unchanged measured evidence.

No persisted predictions or reference labels are loaded. Distance is deliberately
absent: the staged fit does not use it, and acceptance is rerun on every request.
"""
import copy
import hashlib
import json
from collections import OrderedDict
from pathlib import Path
from threading import RLock

_entries = OrderedDict()
_lock = RLock()


def evidence_key(observations, pose, bearing_deg, frame_step_s, terminal_event,
                 package, direction_step_deg, variants):
    metadata = (package or {}).get('video_metadata') or {}
    source = metadata.get('source_path')
    identity = None
    if source:
        path = Path(source)
        try:
            stat = path.stat()
            identity = [str(path.resolve()), stat.st_size, stat.st_mtime_ns]
        except OSError:
            identity = [str(path), 'unavailable']
    evidence = [observations, pose, bearing_deg, frame_step_s, terminal_event,
                identity, metadata.get('width_px'), metadata.get('height_px'),
                metadata.get('variable_frame_rate'), metadata.get('timing_source'),
                direction_step_deg, variants]
    encoded = json.dumps(evidence, sort_keys=True, separators=(',', ':'),
                         allow_nan=False, default=lambda value: value.tolist()).encode()
    return hashlib.sha256(encoded).hexdigest()


def get_fit(key):
    with _lock:
        if key not in _entries:
            return None
        _entries.move_to_end(key)
        return copy.deepcopy(_entries[key])


def put_fit(key, value):
    if not value or not value.get('candidates'):
        return
    with _lock:
        _entries[key] = copy.deepcopy(value)
        _entries.move_to_end(key)
        while len(_entries) > 2:
            _entries.popitem(last=False)


def clear_fit_cache():
    with _lock:
        _entries.clear()
