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
    rows=[dict(r) for r in conn.execute('SELECT * FROM ev_hit_tracks ORDER BY id DESC LIMIT 3')]
    identities={r['id']:dict(conn.execute('SELECT id,team_id,name FROM hitters WHERE id=?',(r['hitter_id'],)).fetchone())
                for r in rows if r.get('hitter_id')}
before={r['id']:hashlib.sha256((r['observation_package_json']+(r.get('prediction_json') or '')).encode()).hexdigest() for r in rows}
report={'replays':[], 'save_check':None}
for row in rows:
    package_file=folder/f"hit-{row['id']}-inputs.json"
    package_file.write_text(row['observation_package_json'],encoding='utf-8')
    prediction_file=folder/f"hit-{row['id']}-prediction.json"
    started=time.perf_counter()
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

# Use the newest existing source and its already-created annotated video.
for row in rows:
    package=json.loads(row['observation_package_json'])
    metadata=package['video_metadata']
    source=service.locate_video(metadata.get('file_name'),row.get('source_video_path') or metadata.get('source_path'))
    if source is None or not row.get('generated_clip_blob') or row['id'] not in identities:
        continue
    with tempfile.TemporaryDirectory(prefix='gf-existing-hit-save-') as temporary:
        temporary=Path(temporary)
        database=temporary/'save-check.db'
        clips=temporary/'clips'; clips.mkdir()
        live=temporary/'live'; live.mkdir()
        rendered=clips/'existing-annotated.mp4'; rendered.write_bytes(row['generated_clip_blob'])
        who=identities[row['id']]
        with closing(sqlite3.connect(database)) as conn,conn:
            conn.execute('CREATE TABLE hitters(id INTEGER,team_id INTEGER,name TEXT)')
            conn.execute('INSERT INTO hitters VALUES(?,?,?)',(who['id'],who['team_id'],who['name']))
        prediction=json.loads((folder/f"hit-{row['id']}-prediction.json").read_text(encoding='utf-8'))
        if not prediction.get('export_readiness',{}).get('allowed'):
            prediction=json.loads(row['prediction_json'])
        if service.prediction_export_blocker(prediction):
            continue
        package=copy.deepcopy(package); package['video_metadata']['source_path']=str(source)
        service.JOBS['existing-render']=dict(status='done',player_name=who['name'],output_path=str(rendered),
            start_s=row['clip_start_time_s'],end_s=row['clip_end_time_s'],duration_s=row['clip_duration_s'])
        payload=dict(hitter_id=who['id'],team_id=who['team_id'],description=row['description'],
            package=package,prediction=prediction,clip_job_id='existing-render',defer_copy_preparation=True)
        responses=[]; timings={}; trim=service.trim_source_clip
        def measured_trim(*args,**kwargs):
            started=time.perf_counter()
            result=trim(*args,**kwargs)
            timings['raw_video_trim_s']=time.perf_counter()-started
            return result
        handler=object.__new__(service.ClipServerHandler)
        with patch.object(service,'GAMEFRAME_DB',database),patch.object(service,'CLIP_DIR',clips), \
             patch.object(service,'LIVE_DIR',live),patch.object(service,'handle_json_body',return_value=payload), \
             patch.object(service,'trim_source_clip',side_effect=measured_trim), \
             patch.object(service,'json_response',side_effect=lambda handler,status,data:responses.append((status,data))):
            try:
                started=time.perf_counter(); handler.handle_gameframe_save_hit()
                timings['save_response_s']=time.perf_counter()-started
                assert responses and responses[-1][0]==200,responses
                result=responses[-1][1]
                with closing(sqlite3.connect(database)) as conn:
                    assert conn.execute('SELECT count(*) FROM ev_hit_tracks').fetchone()[0]==1
                job_id=result['copy_job_id']
                initial_status=service.JOBS[job_id]['status']
                while service.JOBS[job_id]['status'] not in {'done','error'}:
                    time.sleep(.1)
                copy_finished_seconds=time.perf_counter()-started
                finished=copy.deepcopy(service.JOBS[job_id])
                assert finished['status']=='done',finished
                assert finished.get('pending_swing_id'),finished
                with closing(sqlite3.connect(database)) as conn:
                    saved=conn.execute('SELECT contact_frame,fps,clip_blob FROM pending_swing_clips WHERE id=?',
                                       (finished['pending_swing_id'],)).fetchone()
                    assert conn.execute('SELECT ev_hit_id FROM ev_swing_links WHERE pending_swing_id=?',
                                        (finished['pending_swing_id'],)).fetchone()[0]==result['id']
                copy_path=temporary/'timing-copy.mp4'; copy_path.write_bytes(saved[2])
                counted=json.loads(service.subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0',
                    '-count_frames','-show_entries','stream=nb_read_frames','-of','json',str(copy_path)]))
                count=int(counted['streams'][0]['nb_read_frames'])
                assert count==saved[0]+1
                report['save_check']=dict(hit_id=row['id'],**timings,
                    data_commit_and_dispatch_s=timings['save_response_s']-timings['raw_video_trim_s'],
                    background_copy_finished_s=copy_finished_seconds,
                    copy_status_when_save_returned=initial_status,copy_frame_count=count,
                    contact_frame=saved[0],fps=saved[1],existing_annotated_video_reused=True,
                    source_trim_and_swing_encoding_real=True,checks_passed=True)
                print('SAVE '+json.dumps(report['save_check']),flush=True)
            finally:
                # Keep all background writes inside the temporary DB patch.
                service.RELATED_COPY_POOL.shutdown(wait=True)
    break

with closing(sqlite3.connect((root/'app.db').as_uri()+'?mode=ro',uri=True)) as conn:
    for hit_id,digest in before.items():
        row=conn.execute('SELECT observation_package_json,prediction_json FROM ev_hit_tracks WHERE id=?',(hit_id,)).fetchone()
        assert hashlib.sha256((row[0]+(row[1] or '')).encode()).hexdigest()==digest
report['saved_inputs_unchanged']=True
(folder/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('REPORT '+str(folder/'report.json'),flush=True)
