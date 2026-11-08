"""Verify real source encoding and reuse, without saving a hit."""
import json
import sys
import time
from pathlib import Path
from unittest.mock import patch
import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ev-predictor'))
import clip_server
from source_clip_runtime import prepare_source_clip

package=json.loads((ROOT/'demo-output/speed-benchmark/fresh-input.json').read_text())
source=Path(package['video_metadata']['source_path']);contact=package['hit']['contact']['timestamp_s']
out=ROOT/'demo-output/source-preparation-check';out.mkdir(exist_ok=True)
with patch.object(clip_server,'CLIP_DIR',out):
    started=time.perf_counter();future=prepare_source_clip(source,contact,clip_server.trim_source_clip)
    path,start,end,duration=future.result(timeout=300)
    prepared_seconds=time.perf_counter()-started
    reused=prepare_source_clip(source,contact,clip_server.trim_source_clip)
    assert reused is future
cap=cv2.VideoCapture(str(path));fps=cap.get(cv2.CAP_PROP_FPS)
cap.set(cv2.CAP_PROP_POS_MSEC,(contact-start)*1000);ok,frame=cap.read();assert ok;cap.release()
original=cv2.VideoCapture(str(source));errors=[]
for offset in [-2,-1,0,1,2]:
    original.set(cv2.CAP_PROP_POS_MSEC,(contact+offset/30)*1000);ok,candidate=original.read();assert ok
    errors.append(float(np.mean(np.abs(candidate[300:650,750:1200].astype(float)-frame[300:650,750:1200].astype(float)))))
original.release();assert int(np.argmin(errors))-2==0,errors
report={'raw_clip_seconds':prepared_seconds,'reused_same_preparation':True,'clip_start_s':start,
        'contact_within_clip_s':contact-start,'fps':fps,'duration_s':duration,
        'best_contact_frame_offset':int(np.argmin(errors))-2,'contact_frame_errors':errors,
        'saved_hits_modified':False}
(out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
