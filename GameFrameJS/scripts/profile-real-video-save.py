"""Profile rendering the fresh result from the actual normal-workflow test.

This profiles video production only; its timing is not an end-to-end app claim.
"""
import cProfile
import json
import os
from pathlib import Path
import pstats
import sys
import time

root = Path(__file__).resolve().parents[1]
os.environ['FFMPEG_PATH'] = str(root/'node_modules/ffmpeg-static/ffmpeg.exe')
os.environ['FFPROBE_PATH'] = str(root/'node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe')
sys.path.insert(0, str(root/'ev-predictor/synthetic'))
import clip_replay

output = root/'demo-output/real-workflow-20261105'
trace = json.loads((output/'main-streaming-warm-render/trace.json').read_text())
job = next(row['url'].split('id=')[1] for row in trace['requests'] if row['url'].startswith('/api/clip/status?id='))
live = root/'ev-predictor/comparison_output/live'
package = json.loads((live/f'clip_package_{job}.json').read_text())
prediction = json.loads((live/f'clip_prediction_{job}.json').read_text())
original = clip_replay._render_chunk
sections = []

def measured(spec):
    # Python 3.14 reserves one monitoring slot for cProfile across threads.
    profiler = cProfile.Profile() if spec['name'] == 'Flight plane' else None
    start = time.monotonic()
    result = profiler.runcall(original, spec) if profiler else original(spec)
    profile = output/f'render-{spec["output"].stem}.prof' if profiler else None
    if profiler: profiler.dump_stats(str(profile))
    sections.append({'section': spec['name'], 'seconds':time.monotonic()-start, 'profile':str(profile) if profile else None})
    return result

clip_replay._render_chunk = measured
best = prediction['direction_first_match']['best']
started = time.monotonic()
clip_replay.render_clip(Path(trace['source']),package,prediction,output/'profiled-save.mp4',
    package['hit']['contact']['timestamp_s'],1,6,
    [f"EV {best['exit_velocity_mph']:.0f} mph",f"LA {best['launch_angle_deg']:.0f} degrees",f"Distance {best['distance_ft']:.0f} feet"])
report = {'seconds':time.monotonic()-started,'sections':sections,'scope':'Rendering only; fresh normal-workflow prediction used for display, not inference.'}
(output/'render-profile.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report),flush=True)
for section in sorted(sections,key=lambda row:-row['seconds'])[:2]:
    print(section['section'])
    if section['profile']: pstats.Stats(section['profile']).strip_dirs().sort_stats('cumulative').print_stats(9)
