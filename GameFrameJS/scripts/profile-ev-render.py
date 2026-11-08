"""Profile each export worker independently, including encoder pipe waits."""
import cProfile
import io
import os
import json
from pathlib import Path
import pstats
import runpy
import sys
import threading
import time
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'ev-predictor/synthetic'))
import clip_replay
label=sys.argv[1] if len(sys.argv)>1 else 'profile'
record=sys.argv[2] if len(sys.argv)>2 else '77'
folder=root/'demo-output'/label
folder.mkdir(parents=True,exist_ok=True)
original=clip_replay._render_chunk
results=[]
lock=threading.Lock()
def traced(spec):
    profile=cProfile.Profile()
    start=time.perf_counter()
    active = spec['name'] == 'Flight plane' and os.environ.get('EV_PROFILE_FLIGHT','1')!='0'
    if active: profile.enable()
    try:
        return original(spec)
    finally:
        if active: profile.disable()
        elapsed=time.perf_counter()-start
        if active:
            profile.dump_stats(str(folder/(spec['name'].replace(' ','-')+'.prof')))
            stream=io.StringIO()
            pstats.Stats(profile,stream=stream).sort_stats('cumulative').print_stats(25)
            (folder/(spec['name'].replace(' ','-')+'.txt')).write_text(stream.getvalue())
        with lock:
            results.append({'chunk':spec['name'],'seconds':elapsed})
        print(json.dumps({'chunk':spec['name'],'seconds':elapsed}),flush=True)
clip_replay._render_chunk=traced
sys.argv=['benchmark-ev-render.py',label,record]
try:
    runpy.run_path(str(root/'scripts/benchmark-ev-render.py'),run_name='__main__')
finally:
    (folder/'timings.json').write_text(json.dumps(results,indent=2))
