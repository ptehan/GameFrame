"""Share frame-accurate source preparation between rendering and final save."""
import threading
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='ev-source-copy')
_lock = threading.Lock()
_entries = OrderedDict()


def prepare_source_clip(source, contact, trim):
    source = Path(source).resolve()
    stat = source.stat()
    key = (str(source), stat.st_size, stat.st_mtime_ns, float(contact))
    with _lock:
        future = _entries.get(key)
        if future is not None and future.done():
            if future.exception() is not None or not Path(future.result()[0]).is_file():
                _entries.pop(key)
                future = None
        if future is None:
            future = _pool.submit(trim, source, contact, 'source-ready-' + uuid.uuid4().hex)
            _entries[key] = future
        _entries.move_to_end(key)
        while len(_entries) > 4:
            _entries.popitem(last=False)
        return future
