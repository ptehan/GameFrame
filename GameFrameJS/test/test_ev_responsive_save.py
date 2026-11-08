import sys
import tempfile
import threading
import time
import unittest
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from contextlib import closing

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor'))
import encoder_runtime
import source_clip_runtime
import prediction_runtime
import clip_server
from prediction_cancel import cancellation_scope, check_cancelled, PredictionCancelled


class ResponsiveSaveTests(unittest.TestCase):
    def test_save_persists_both_videos_without_reencoding_a_prepared_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);database=root/'app.sqlite';source=root/'source.mp4';source.write_bytes(b'original')
            raw=root/'raw.mp4';raw.write_bytes(b'frame-accurate raw clip')
            generated=root/'generated.mp4';generated.write_bytes(b'annotated video')
            with closing(sqlite3.connect(database)) as conn, conn:
                conn.executescript("CREATE TABLE teams(id INTEGER PRIMARY KEY);INSERT INTO teams VALUES(1);CREATE TABLE hitters(id INTEGER PRIMARY KEY,team_id INTEGER);INSERT INTO hitters VALUES(1,1);")
            payload={'team_id':1,'hitter_id':1,'clip_job_id':'prepared','defer_copy_preparation':True,
                     'package':{'video_metadata':{'file_name':'source.mp4'},'hit':{'contact':{'timestamp_s':2}}},
                     'prediction':{'export_readiness':{'allowed':True}}}
            responses=[]
            with patch.object(clip_server,'GAMEFRAME_DB',database),patch.object(clip_server,'locate_video',return_value=source),patch.object(clip_server,'cleanup_temp_video_outputs'),patch.object(clip_server,'add_source_path_to_package',side_effect=lambda p:p),patch.object(clip_server,'set_export_player',return_value='Player'),patch.object(clip_server,'handle_json_body',return_value=payload),patch.object(clip_server,'queue_related_copies',return_value='related'),patch.object(clip_server,'json_response',side_effect=lambda handler,status,data:responses.append((status,data))),patch.object(clip_server,'trim_source_clip',return_value=(raw,1,8,7)) as trim,patch.object(clip_server,'render_generated_clip',side_effect=AssertionError('must reuse generated video')),patch.dict(clip_server.JOBS,{'prepared':{'status':'done','player_name':'Player','output_path':str(generated),'start_s':1,'end_s':8,'duration_s':7}}):
                source_clip_runtime.prepare_source_clip(source,2,clip_server.trim_source_clip).result()
                clip_server.ClipServerHandler.handle_gameframe_save_hit(object())
                self.assertEqual(trim.call_count,1)
            self.assertEqual(responses[0][0],200,responses)
            with closing(sqlite3.connect(database)) as conn:
                row=conn.execute('SELECT clip_blob,generated_clip_blob,clip_start_time_s,contact_time_s FROM ev_hit_tracks').fetchone()
            self.assertEqual(row,(b'frame-accurate raw clip',b'annotated video',1,2))

    def test_one_encoder_probe_is_shared_and_passed_to_renderers(self):
        with patch.object(encoder_runtime,'_future',None), patch.object(encoder_runtime,'_probe',return_value='libx264') as probe:
            with ThreadPoolExecutor(4) as pool:
                environments=list(pool.map(lambda _:encoder_runtime.render_environment(),range(4)))
            self.assertEqual(probe.call_count,1)
            self.assertTrue(all(e['EV_VIDEO_ENCODER']=='libx264' for e in environments))

    def test_raw_copy_is_reused_but_replaced_sources_are_not(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'source.mp4';source.write_bytes(b'raw source')
            calls=[]
            def trim(path,contact,name):
                calls.append((path,contact));out=Path(directory)/(name+'.mp4');out.write_bytes(b'exact frames')
                return out,contact-1,contact+6,7
            first=source_clip_runtime.prepare_source_clip(source,2,trim)
            second=source_clip_runtime.prepare_source_clip(source,2,trim)
            self.assertIs(first,second);self.assertEqual(first.result()[1:],(1,8,7));self.assertEqual(len(calls),1)
            source.write_bytes(b'replacement source')
            self.assertIsNot(first,source_clip_runtime.prepare_source_clip(source,2,trim))
            source_clip_runtime.prepare_source_clip(source,2,trim).result()
            self.assertEqual(len(calls),2)

    def test_failed_raw_preparation_can_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'source.mp4';source.write_bytes(b'raw')
            def fail(*args):raise RuntimeError('encode failed')
            failed=source_clip_runtime.prepare_source_clip(source,2,fail)
            with self.assertRaises(RuntimeError):failed.result()
            def trim(*args):return source,1,8,7
            self.assertEqual(source_clip_runtime.prepare_source_clip(source,2,trim).result()[0],source)

    def test_cancelling_running_and_queued_estimates_frees_latest_request(self):
        runtime=prediction_runtime.PredictionRuntime();started=threading.Event()
        def calculation(arguments,event):
            with cancellation_scope(event):
                if arguments=='old':
                    started.set()
                    while not event.wait(.005):check_cancelled()
                    check_cancelled()
                return arguments,0
        with patch.object(prediction_runtime,'estimate',side_effect=calculation),patch.object(prediction_runtime,'warm_estimator'),patch.object(prediction_runtime,'warm_flight_math'):
            with ThreadPoolExecutor(3) as callers:
                old=callers.submit(runtime.run,'old','old-id');self.assertTrue(started.wait(2))
                runtime.register('queued-id');runtime.cancel('queued-id')
                queued=callers.submit(runtime.run,'queued','queued-id')
                runtime.cancel('old-id')
                latest=callers.submit(runtime.run,'latest','latest-id')
                with self.assertRaises(PredictionCancelled):old.result(timeout=2)
                with self.assertRaises(PredictionCancelled):queued.result(timeout=2)
                self.assertEqual(latest.result(timeout=2),('latest',0))
            runtime.pool.shutdown()
        self.assertEqual(runtime.tokens,{})


if __name__=='__main__':unittest.main()
