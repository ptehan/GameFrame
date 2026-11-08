import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
from contextlib import closing
root=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(root/'ev-predictor/synthetic')]
from direct_video_estimate import main
folder=root/'demo-output/camera-motion-20261026';folder.mkdir(exist_ok=True)
with closing(sqlite3.connect((root/'app.db').as_uri()+'?mode=ro',uri=True)) as conn:
    rows=conn.execute('SELECT id,observation_package_json FROM ev_hit_tracks WHERE id IN (72,73) ORDER BY id').fetchall()
assert len(rows)==2
results=[]
for hit_id,original in rows:
    package=json.loads(original);package.setdefault('camera',{})['changed_during_ball_marks']=True
    source=folder/f'hit-{hit_id}-inputs.json';source.write_text(json.dumps(package))
    output=folder/f'hit-{hit_id}-prediction.json'
    main([str(source),'--db',str(root/'ev-predictor/data/hittrax_from_video.sqlite'),'--out',str(output)])
    prediction=json.loads(output.read_text())
    has_hang=(package.get('terminal_event') or {}).get('type')=='FIRST_GROUND_CONTACT'
    if has_hang:
        assert prediction['method']=='distance_hang_constrained'
        assert prediction['distance_hang_match']['video_alignment']['used_for_ranking'] is False
        assert prediction['distance_hang_match']['video_alignment']['calibration_usable'] is False
    else:
        assert prediction['export_readiness']['allowed'] is False
    with closing(sqlite3.connect((root/'app.db').as_uri()+'?mode=ro',uri=True)) as conn:
        assert conn.execute('SELECT observation_package_json FROM ev_hit_tracks WHERE id=?',(hit_id,)).fetchone()[0]==original
    results.append(dict(hit_id=hit_id,has_ground_time=has_hang,method=prediction['method'],checks_passed=True))
(folder/'report.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
