"""Fresh source decode; saved results are assertions only, never detector inputs."""
import json
import sys
import time
from pathlib import Path
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'experiments/ball-assist'))
import stream_scan
from frame_source import read_frame

folder = ROOT/'demo-output/ball-assist-lab/86475e65-ebae-48f3-8008-e3706a97d76f'
legacy = json.loads((folder/'c9a00c7b-c6a5-4794-8d8f-b31fb78a84b4-contact-input.json').read_text())
meta = json.loads((folder/'session.json').read_text())
baseline = json.loads((ROOT/'demo-output/real-workflow-20261105/detection-baseline.json').read_text())
files = sorted((folder/'frames').glob('*.jpg'))
original_images = stream_scan.jpeg_images
checked = []

def compare_pixels(pipe):
    for i, frame in enumerate(original_images(pipe)):
        assert np.array_equal(read_frame(frame), cv2.imread(str(files[i]))), f'JPEG pixels changed at frame {i}'
        checked.append(i)
        yield frame

stream_scan.jpeg_images = compare_pixels
config = {'video_path': meta['video'], 'ffmpeg': str(ROOT/'node_modules/ffmpeg-static/ffmpeg.exe'),
          'start': meta['start'], 'source_fps': legacy['source_fps'],
          'input_width': meta['width'], 'input_height': meta['height'],
          'contact': legacy['contact'], 'detection_stride': 1}
started = time.monotonic()
result = stream_scan.scan_video(config, lambda p: print(json.dumps(p), flush=True))
assert result['session']['times'] == legacy['frame_times']
assert result['session']['frameNumbers'] == meta['frameNumbers']
assert result['points'] == baseline['points'], 'Detected points changed'
assert result['gaps'] == baseline['gaps'], 'Gap coverage changed'
assert result['last_scanned_frame'] == baseline['last_scanned_frame']
assert len(checked) == len(files)
output = ROOT/'demo-output/real-workflow-20261105/streamed-detection.json'
output.write_text(json.dumps({'elapsed_s': time.monotonic()-started, 'pixels_checked': len(checked), 'result': result}, indent=2))
print(json.dumps({'ok': True, 'points': len(result['points']), 'elapsed_s': time.monotonic()-started, 'preparation': result['preparation']}))
