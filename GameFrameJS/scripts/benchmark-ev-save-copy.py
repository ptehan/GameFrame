"""Measure the swing-copy save using a temporary DB, leaving the user's hit intact."""
import json
import sys
import tempfile
import time
from pathlib import Path

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'ev-predictor'))
from pending_swing import save_pending_swing, _contact_timeline
import pending_swing
from clip_server import locate_video

package_file=max((root/'ev-predictor/comparison_output/live').glob('observation_package_*.json'),key=lambda p:p.stat().st_mtime)
p=json.loads(package_file.read_text(encoding='utf-8'))
metadata=p['video_metadata']
source=locate_video(metadata.get('file_name'),metadata.get('source_path'))
if source is None:
    raise RuntimeError('Latest source video is unavailable')
contact=p['hit']['contact']['timestamp_s']
stages=[]
original_run=pending_swing.subprocess.run
def measured_run(command,*args,**kwargs):
    started=time.perf_counter()
    try:
        return original_run(command,*args,**kwargs)
    finally:
        kind='frame_window_probe' if '-show_frames' in command and '-read_intervals' in command else 'full_probe' if '-show_frames' in command else 'verify_packet_count' if '-count_packets' in command else 'encode_copy'
        stages.append(dict(stage=kind,seconds=time.perf_counter()-started))
pending_swing.subprocess.run=measured_run
with tempfile.TemporaryDirectory(prefix='gf-save-speed-') as directory:
    database=Path(directory)/'benchmark.sqlite'
    started=time.perf_counter()
    first=save_pending_swing(database,source,contact,1,1,'Temporary performance check',metadata)
    first_seconds=time.perf_counter()-started
    started=time.perf_counter()
    repeated=save_pending_swing(database,source,contact,1,1,'Temporary performance check',metadata)
    repeated_seconds=time.perf_counter()-started
    assert first==repeated
    print(json.dumps(dict(first_copy_s=first_seconds,repeated_copy_s=repeated_seconds,
                          contact_s=contact,stages=stages,timeline_cache=str(_contact_timeline.cache_info())),indent=2))
