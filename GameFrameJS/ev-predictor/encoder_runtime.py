"""Probe encoder capabilities once in the long-lived app worker."""
import os
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor

_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='ev-encoder-probe')
_lock = threading.Lock()
_future = None


def _probe():
    requested = os.environ.get('EV_VIDEO_ENCODER', 'auto')
    if requested in ('libx264', 'h264_qsv'):
        return requested
    if requested != 'auto':
        raise ValueError('Unsupported EV encoder: ' + requested)
    try:
        result = subprocess.run([os.environ.get('FFMPEG_PATH', 'ffmpeg'), '-v', 'error',
            '-f', 'lavfi', '-i', 'color=size=320x240:rate=30', '-frames:v', '3',
            '-c:v', 'h264_qsv', '-f', 'null', '-'], stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        if result.returncode == 0:
            return 'h264_qsv'
    except (OSError, subprocess.TimeoutExpired):
        pass
    return 'libx264'


def warm_video_encoder():
    global _future
    with _lock:
        if _future is None:
            _future = _pool.submit(_probe)
        return _future


def render_environment():
    return {**os.environ, 'EV_VIDEO_ENCODER': warm_video_encoder().result(),
            'GAMEFRAME_FLIGHT_ACCELERATION': '0'}
