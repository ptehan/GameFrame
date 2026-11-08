import copy
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor'))
import clip_server as server
from background_ev import BackgroundVideos
REAL_RENDER_SAVED_HIT=server.render_saved_hit


def wait_for(predicate):
    deadline=time.monotonic()+5
    while not predicate():
        if time.monotonic()>deadline:raise AssertionError('Background work did not reach the expected state')
        time.sleep(.01)


class BackgroundVideoTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.database=self.root/'app.db';self.source=self.root/'source.mp4';self.source.write_bytes(b'original')
        self.raw=self.root/'raw.mp4';self.raw.write_bytes(b'preserved source frames')
        self.generated=self.root/'generated.mp4';self.generated.write_bytes(b'finished presentation')
        self.stack=ExitStack();self.responses=[];self.gate=threading.Event();self.started=threading.Event();self.renders=0
        def render(row):
            self.renders+=1;self.started.set();self.gate.wait(5);return self.generated
        replacements={'GAMEFRAME_DB':self.database,'add_source_path_to_package':lambda p:copy.deepcopy(p),
            'locate_video':lambda *a:self.source,'set_export_player':lambda *a:'Player',
            'trim_source_clip':lambda *a:(self.raw,1.,8.,7.),'render_saved_hit':render,
            'json_response':lambda h,status,data:self.responses.append((status,data))}
        for name,value in replacements.items():self.stack.enter_context(patch.object(server,name,value))
        with closing(server.gameframe_conn()) as conn,conn:
            conn.executescript('CREATE TABLE teams(id INTEGER PRIMARY KEY);INSERT INTO teams VALUES(1);CREATE TABLE hitters(id INTEGER PRIMARY KEY,team_id INTEGER);INSERT INTO hitters VALUES(1,1);CREATE TABLE ev_swing_links(ev_hit_id INTEGER,pending_swing_id INTEGER);')
            server.ensure_gameframe_ev_schema(conn)
        def copies(hit_id,*args):
            with closing(server.gameframe_conn()) as conn,conn:conn.execute('INSERT INTO ev_swing_links VALUES(?,77)',(hit_id,))
            return dict(pending_swing_id=77,pending_pitch_id=None,swing_warning=None,pitch_warning=None)
        self.stack.enter_context(patch.object(server,'save_related_copies',side_effect=copies))
        self.queue=BackgroundVideos(server);self.stack.enter_context(patch.object(server,'DEFERRED_VIDEOS',self.queue))
        self.payload={'team_id':1,'hitter_id':1,'defer_video_render':True,'save_request_key':'one-measurement','video_banner_text':'Game hit|EV 83 mph|LA 26 degrees|Distance 312 feet|Hang 4.2 seconds',
            'package':{'video_metadata':{'file_name':'source.mp4'},'hit':{'contact':{'timestamp_s':2}}},
            'prediction':{'ev_candidates':[{'exit_velocity_mph':83,'launch_angle_deg':26.5,'distance_ft':312}], 'export_readiness':{'allowed':True}}}

    def tearDown(self):
        self.gate.set();self.queue.pool.shutdown(wait=True);self.stack.close();self.temp.cleanup()

    def save(self,payload=None):
        with patch.object(server,'handle_json_body',return_value=payload or self.payload):
            server.ClipServerHandler.handle_gameframe_save_hit(object())
        return self.responses[-1]

    def test_measurement_and_timing_are_usable_while_renderer_is_blocked(self):
        status,response=self.save();self.assertEqual(status,200,response);self.assertTrue(self.started.wait(2))
        self.assertFalse(self.gate.is_set());self.assertTrue(response['measurement_persisted']);self.assertFalse(response['video_persisted']);self.assertEqual(response['pending_swing_id'],77)
        with closing(server.gameframe_conn()) as conn:
            row=conn.execute('SELECT clip_blob,generated_clip_blob,best_exit_velocity_mph,observation_package_json FROM ev_hit_tracks').fetchone()
        self.assertEqual(row['clip_blob'],b'preserved source frames');self.assertIsNone(row['generated_clip_blob']);self.assertEqual(row['best_exit_velocity_mph'],83)
        self.assertEqual(json.loads(row['observation_package_json'])['hit']['contact']['timestamp_s'],2)
        self.gate.set();wait_for(lambda:self.queue.status(response['id'])['status']=='ready')
        with closing(server.gameframe_conn()) as conn:self.assertEqual(conn.execute('SELECT generated_clip_blob FROM ev_hit_tracks').fetchone()[0],b'finished presentation')

    def test_retrying_a_save_does_not_duplicate_the_hit_or_renderer(self):
        _,first=self.save();_,second=self.save();self.assertEqual(first['id'],second['id'])
        self.assertTrue(self.started.wait(2));self.assertEqual(self.renders,1)
        with closing(server.gameframe_conn()) as conn:self.assertEqual(conn.execute('SELECT count(*) FROM ev_hit_tracks').fetchone()[0],1)
        changed=copy.deepcopy(self.payload);changed['description']='different measurement';status,_=self.save(changed);self.assertEqual(status,400)

    def test_deferred_timing_copy_does_not_block_save_response(self):
        payload=copy.deepcopy(self.payload);payload['defer_copy_preparation']=True
        copy_gate=threading.Event();copy_started=threading.Event()
        original=server.save_related_copies
        def slow_copy(*args):
            copy_started.set();copy_gate.wait(5);return original(*args)
        with ThreadPoolExecutor(1) as pool:
            def queue(*args):
                pool.submit(slow_copy,*args);return 'timing-copy-job'
            try:
                with patch.object(server,'queue_related_copies',side_effect=queue):
                    status,response=self.save(payload)
                self.assertEqual(status,200,response);self.assertTrue(response['measurement_persisted'])
                self.assertEqual(response['copy_job_id'],'timing-copy-job');self.assertIsNone(response['pending_swing_id'])
                self.assertTrue(copy_started.wait(2));self.assertFalse(copy_gate.is_set())
                with closing(server.gameframe_conn()) as conn:
                    self.assertEqual(conn.execute('SELECT count(*) FROM ev_hit_tracks').fetchone()[0],1)
                    self.assertEqual(conn.execute('SELECT count(*) FROM ev_swing_links').fetchone()[0],0)
            finally:copy_gate.set()
        with closing(server.gameframe_conn()) as conn:
            self.assertEqual(conn.execute('SELECT pending_swing_id FROM ev_swing_links').fetchone()[0],77)

    def test_concurrent_retries_commit_one_hit_and_one_timing_copy(self):
        with patch.object(server,'handle_json_body',return_value=self.payload),ThreadPoolExecutor(3) as pool:
            list(pool.map(lambda _:server.ClipServerHandler.handle_gameframe_save_hit(object()),range(3)))
        self.assertTrue(all(status==200 for status,_ in self.responses),self.responses)
        self.assertEqual(len({data['id'] for _,data in self.responses}),1)
        with closing(server.gameframe_conn()) as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM ev_hit_tracks').fetchone()[0],1)
            self.assertEqual(conn.execute('SELECT count(*) FROM ev_swing_links').fetchone()[0],1)

    def test_deleting_during_render_cannot_resurrect_a_hit(self):
        _,response=self.save();self.assertTrue(self.started.wait(2))
        with closing(server.gameframe_conn()) as conn,conn:conn.execute('DELETE FROM ev_hit_tracks WHERE id=?',(response['id'],))
        self.gate.set();wait_for(lambda:not self.queue.active)
        self.assertIsNone(self.queue.status(response['id']))

    def test_failed_render_preserves_measurement_and_can_retry(self):
        attempts=[]
        def render(row):
            attempts.append(row['id'])
            if len(attempts)==1:raise RuntimeError('encoder failed')
            return self.generated
        with patch.object(server,'render_saved_hit',side_effect=render):
            _,response=self.save();hit_id=response['id'];wait_for(lambda:not self.queue.active)
            self.assertEqual(self.queue.status(hit_id)['status'],'error')
            with closing(server.gameframe_conn()) as conn:self.assertEqual(conn.execute('SELECT clip_blob FROM ev_hit_tracks').fetchone()[0],b'preserved source frames')
            self.queue.retry(hit_id);wait_for(lambda:self.queue.status(hit_id)['status']=='ready')
            self.assertEqual(attempts,[hit_id,hit_id])

    def test_restart_recovers_a_committed_render_without_a_browser(self):
        self.gate.set();_,response=self.save();wait_for(lambda:not self.queue.active)
        with closing(server.gameframe_conn()) as conn,conn:
            conn.execute("UPDATE ev_hit_tracks SET generated_clip_blob=NULL,video_render_status='rendering' WHERE id=?",(response['id'],))
        restarted=BackgroundVideos(server)
        try:
            restarted.recover();wait_for(lambda:restarted.status(response['id'])['status']=='ready')
            self.assertEqual(self.renders,2)
        finally:restarted.pool.shutdown(wait=True)

    def test_recovery_uses_committed_source_when_original_is_missing(self):
        with patch.object(server,'render_saved_hit',return_value=self.generated):
            _,response=self.save();wait_for(lambda:not self.queue.active)
        with closing(server.gameframe_conn()) as conn:row=dict(conn.execute('SELECT * FROM ev_hit_tracks').fetchone())
        self.source.unlink();seen=[]
        def run(job,payload):
            seen.append(payload)
            self.assertIn(job,server.JOBS)
            self.assertEqual(payload['banner_text'],self.payload['video_banner_text'])
            self.assertEqual(Path(payload['source_path']).read_bytes(),b'preserved source frames')
            with server.JOBS_LOCK:server.JOBS[job]={'status':'done','output_path':str(self.generated)}
        # Bypass the fake renderer installed by setUp to exercise the real recovery adapter.
        with patch.object(server,'CLIP_DIR',self.root),patch.object(server,'set_export_player'),patch.object(server,'run_clip_job',side_effect=run):
            output=REAL_RENDER_SAVED_HIT(row)
        self.assertEqual(output,self.generated);self.assertEqual(seen[0]['contact_time_s'],1.)

    def test_replaced_original_cannot_change_the_saved_video_footage(self):
        with patch.object(server,'render_saved_hit',return_value=self.generated):
            _,response=self.save();wait_for(lambda:not self.queue.active)
        with closing(server.gameframe_conn()) as conn:row=dict(conn.execute('SELECT * FROM ev_hit_tracks').fetchone())
        self.source.write_bytes(b'replaced with different footage')
        def run(job,payload):
            self.assertEqual(Path(payload['source_path']).read_bytes(),b'preserved source frames')
            self.assertEqual(payload['contact_time_s'],1.)
            with server.JOBS_LOCK:server.JOBS[job]={'status':'done','output_path':str(self.generated)}
        with patch.object(server,'CLIP_DIR',self.root),patch.object(server,'set_export_player'),patch.object(server,'run_clip_job',side_effect=run):
            self.assertEqual(REAL_RENDER_SAVED_HIT(row),self.generated)


if __name__=='__main__':unittest.main()
