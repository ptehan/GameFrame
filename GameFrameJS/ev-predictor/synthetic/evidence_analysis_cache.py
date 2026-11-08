"""Bounded, process-local reuse of unchanged evidence analysis, never labels."""
import copy
import hashlib
import json
from collections import OrderedDict
from pathlib import Path
from threading import RLock
from prediction_cancel import check_cancelled

_entries=OrderedDict()
_lock=RLock()

def source_identity(metadata):
    source=metadata.get('source_path')
    if not source:return None
    path=Path(source)
    try:
        stat=path.stat()
        return [str(path.resolve()),stat.st_size,stat.st_mtime_ns]
    except OSError:
        return [str(path),'unavailable']

def cached_analysis(stage,evidence,calculate):
    check_cancelled()
    try:
        encoded=json.dumps(evidence,sort_keys=True,separators=(',',':'),allow_nan=False,
                           default=lambda value:value.tolist()).encode()
    except (TypeError,ValueError,AttributeError):
        return calculate()
    key=(stage,hashlib.sha256(encoded).hexdigest())
    with _lock:
        if key in _entries:
            _entries.move_to_end(key)
            return copy.deepcopy(_entries[key])
    value=calculate()
    check_cancelled()
    with _lock:
        _entries[key]=copy.deepcopy(value)
        _entries.move_to_end(key)
        while len(_entries)>8:_entries.popitem(last=False)
    return value

def clear_analysis_cache():
    with _lock:_entries.clear()
