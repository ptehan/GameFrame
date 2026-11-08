"""Replay saved user hits read-only; exercise saves only in a temporary database."""
import copy
import hashlib
import json
import sqlite3
import sys
import tempfile
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

root=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(root/'ev-predictor'),str(root/'ev-predictor/synthetic')]
import clip_server as service
from direct_video_estimate import main
from clip_replay import synthetic_flight_points

folder=root/'demo-output'/('saved-hit-replay-'+datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S'))
folder.mkdir(parents=True,exist_ok=True)
with closing(sqlite3.connect((root/'app.db').as_uri()+'?mode=ro',uri=True)) as conn:
    conn.row_factory=sqlite3.Row
    rows=[dict(r) for r in conn.execute('SELECT * FROM ev_hit_tracks WHERE length(generated_clip_blob)>0 ORDER BY id DESC')]
    identities={r['id']:dict(conn.execute('SELECT id,team_id,name FROM hitters WHERE id=?',(r['hitter_id'],)).fetchone())
                for r in rows if r.get('hitter_id')}
before={r['id']:hashlib.sha256((r['observation_package_json']+(r.get('prediction_json') or '')).encode()).hexdigest() for r in rows}
report={'scope':'Every EV record with a nonempty stored generated video', 'replays':[], 'stored_video_checks':[]}
for row in rows:
    package_file=folder/f"hit-{row['id']}-inputs.json"
    package_file.write_text(row['observation_package_json'],encoding='utf-8')
    prediction_file=folder/f"hit-{row['id']}-prediction.json"
    started=time.perf_counter()
    try:
        main([str(package_file),'--db',str(root/'ev-predictor/data/hittrax_from_video.sqlite'),'--out',str(prediction_file)])
        prediction=json.loads(prediction_file.read_text(encoding='utf-8'))
        physical=prediction.get('distance_hang_match')
        if physical:
            for candidate in prediction['ev_candidates']:
                assert abs(candidate['distance_error_ft'])<=physical['distance_tolerance_ft']
                assert abs(candidate['hang_time_error_s'])<=physical['hang_time_tolerance_s']
                assert abs(candidate['landing_angle_residual_deg'])<=6
            assert physical['video_alignment']['used_for_ranking'] is False
        points=synthetic_flight_points(prediction)
        if points:
            assert points[0]['x']==points[0]['y']==0
        best=(prediction.get('ev_candidates') or [{}])[0]
        replay=dict(id=row['id'],file=row['source_file_name'],seconds=time.perf_counter()-started,
            method=prediction['method'],candidate_count=len(prediction.get('ev_candidates') or []),
            export_readiness=prediction.get('export_readiness'),
            best={k:best.get(k) for k in ('exit_velocity_mph','launch_angle_deg','distance_ft','hang_time_s')},
            checks_passed=True)
        report['replays'].append(replay)
        print('REPLAY '+json.dumps(replay),flush=True)
    except Exception as error:
        report['replays'].append(dict(id=row['id'],file=row['source_file_name'],checks_passed=False,error=repr(error)))
        print('FAILED '+str(row['id'])+' '+repr(error),flush=True)
    (folder/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')

# Decode every stored successful video independently; original blobs remain read-only.
for row in rows:
    with tempfile.TemporaryDirectory(prefix='gf-stored-video-check-') as temporary:
        video=Path(temporary)/'stored.mp4'
        video.write_bytes(row['generated_clip_blob'])
        result=service.subprocess.run(['ffmpeg','-v','error','-i',str(video),'-map','0:v:0','-f','null','-'],capture_output=True,text=True)
        check=dict(id=row['id'],bytes=len(row['generated_clip_blob']),checks_passed=result.returncode==0 and not result.stderr.strip(),error=result.stderr.strip())
        report['stored_video_checks'].append(check)
        print('VIDEO '+json.dumps(check),flush=True)
        (folder/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')

with closing(sqlite3.connect((root/'app.db').as_uri()+'?mode=ro',uri=True)) as conn:
    for hit_id,digest in before.items():
        row=conn.execute('SELECT observation_package_json,prediction_json FROM ev_hit_tracks WHERE id=?',(hit_id,)).fetchone()
        assert hashlib.sha256((row[0]+(row[1] or '')).encode()).hexdigest()==digest
report['saved_inputs_unchanged']=True
(folder/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('REPORT '+str(folder/'report.json'),flush=True)
