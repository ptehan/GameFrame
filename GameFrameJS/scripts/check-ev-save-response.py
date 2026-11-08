"""Check EV persistence before optional copy work, using only temporary files."""
import json
import sqlite3
import sys
import tempfile
import time
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'ev-predictor'))
import clip_server as service

with tempfile.TemporaryDirectory(prefix='gf-ev-save-response-') as folder:
    folder=Path(folder)
    database=folder/'temporary.db'
    source=folder/'source.mp4'; source.write_bytes(b'source fixture')
    raw=folder/'raw.mp4'; raw.write_bytes(b'raw fixture')
    rendered=folder/'rendered.mp4'; rendered.write_bytes(b'annotated fixture')
    with closing(sqlite3.connect(database)) as conn,conn:
        conn.executescript("CREATE TABLE hitters(id INTEGER,team_id INTEGER,name TEXT); INSERT INTO hitters VALUES(1,2,'Temporary player'); CREATE TABLE ev_swing_links(pending_swing_id INTEGER);")
    payload=dict(hitter_id=1,defer_copy_preparation=True,
                 package=dict(video_metadata=dict(file_name='source.mp4'),hit=dict(contact=dict(timestamp_s=3))))
    responses=[]; work=[]
    handler=object.__new__(service.ClipServerHandler)
    with patch.object(service,'GAMEFRAME_DB',database), \
         patch.object(service,'handle_json_body',return_value=payload), \
         patch.object(service,'locate_video',return_value=source), \
         patch.object(service,'cleanup_temp_video_outputs'), \
         patch.object(service,'trim_source_clip',return_value=(raw,2,9,7)), \
         patch.object(service,'render_generated_clip',return_value=rendered), \
         patch.object(service.RELATED_COPY_POOL,'submit',side_effect=lambda fn:work.append(fn)), \
         patch.object(service,'save_pending_swing',return_value=7) as swing, \
         patch.object(service,'json_response',side_effect=lambda handler,status,data:responses.append((status,data))):
        start=time.perf_counter()
        handler.handle_gameframe_save_hit()
        elapsed=time.perf_counter()-start
        assert responses[0][0]==200
        assert responses[0][1]['copy_job_id']
        swing.assert_not_called()
        with closing(sqlite3.connect(database)) as conn:
            assert conn.execute('SELECT count(*) FROM ev_hit_tracks').fetchone()[0]==1
        work[0]()
        result=service.JOBS[responses[0][1]['copy_job_id']]
        assert result['status']=='done' and result['pending_swing_id']==7
        print(json.dumps(dict(ev_save_response_s=elapsed,ev_committed_before_copy=True,
                              background_copy_link_completed=True,media_processing_mocked=True),indent=2))
