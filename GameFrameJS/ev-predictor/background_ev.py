"""Persist measurements first; render their presentation independently of the browser."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import threading
import uuid


class BackgroundVideos:
    def __init__(self, services):
        self.s = services
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='ev-saved-video')
        self.lock = threading.Lock()
        self.active = set()

    def recover(self):
        with closing(self.s.gameframe_conn()) as conn, conn:
            self.s.ensure_gameframe_ev_schema(conn)
            rows = conn.execute("SELECT id FROM ev_hit_tracks WHERE video_render_status IN ('saving','queued','rendering')").fetchall()
            conn.execute("UPDATE ev_hit_tracks SET video_render_status='queued' WHERE video_render_status IN ('saving','rendering')")
        for row in rows:
            self.submit(row['id'])

    def submit(self, hit_id):
        with self.lock:
            if hit_id in self.active:
                return
            self.active.add(hit_id)
        try:
            self.pool.submit(self._run, hit_id)
        except BaseException:
            with self.lock:
                self.active.discard(hit_id)
            raise

    def _run(self, hit_id):
        token = None
        try:
            with closing(self.s.gameframe_conn()) as conn, conn:
                row = conn.execute('SELECT * FROM ev_hit_tracks WHERE id=?', (hit_id,)).fetchone()
                if not row or row['video_render_status'] != 'queued':
                    return
                token = row['video_render_token']
                claimed = conn.execute("UPDATE ev_hit_tracks SET video_render_status='rendering',video_render_error=NULL WHERE id=? AND video_render_token=? AND video_render_status='queued'", (hit_id,token))
                if claimed.rowcount != 1:
                    return
                row = dict(row)
            generated = self.s.render_saved_hit(row)
            data = Path(generated).read_bytes()
            if not data:
                raise ValueError('The generated video is empty.')
            with closing(self.s.gameframe_conn()) as conn, conn:
                # Deleting or replacing a queued hit must never resurrect it.
                conn.execute("""UPDATE ev_hit_tracks SET generated_clip_blob=?,generated_clip_path=?,
                    generated_clip_mime_type='video/mp4',video_render_status='ready',video_render_error=NULL
                    WHERE id=? AND video_render_token=? AND video_render_status='rendering'""",
                    (sqlite3.Binary(data),str(generated),hit_id,token))
        except Exception as error:
            if token:
                with closing(self.s.gameframe_conn()) as conn, conn:
                    conn.execute("UPDATE ev_hit_tracks SET video_render_status='error',video_render_error=? WHERE id=? AND video_render_token=?",
                                 (str(error)[-2000:],hit_id,token))
        finally:
            with self.lock:
                self.active.discard(hit_id)

    def retry(self, hit_id):
        with self.lock:
            if hit_id in self.active:
                return self.status(hit_id)
            with closing(self.s.gameframe_conn()) as conn, conn:
                conn.execute("UPDATE ev_hit_tracks SET video_render_status='queued',video_render_error=NULL,video_render_token=? WHERE id=? AND generated_clip_blob IS NULL AND (video_render_status='error' OR video_render_status IS NULL)",
                             (uuid.uuid4().hex,hit_id))
        self.submit(hit_id)
        return self.status(hit_id)

    def status(self, hit_id):
        with closing(self.s.gameframe_conn()) as conn:
            self.s.ensure_gameframe_ev_schema(conn)
            row = conn.execute("""SELECT id,video_render_status,video_render_error,video_render_token,
                generated_clip_blob IS NOT NULL AS ready,clip_blob IS NOT NULL AS source
                FROM ev_hit_tracks WHERE id=?""", (hit_id,)).fetchone()
            if not row:
                return None
            pending = None
            if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ev_swing_links'").fetchone():
                linked = conn.execute('SELECT pending_swing_id FROM ev_swing_links WHERE ev_hit_id=?', (hit_id,)).fetchone()
                pending = linked['pending_swing_id'] if linked else None
        with self.s.JOBS_LOCK:
            progress = dict(self.s.JOBS.get(row['video_render_token']) or {})
        return {'id':hit_id,'status':'ready' if row['ready'] else row['video_render_status'] or 'unavailable',
                'error':row['video_render_error'], 'progress':1 if row['ready'] else progress.get('progress',0),
                'message':'Video ready' if row['ready'] else progress.get('message','Waiting to render video'),
                'pending_swing_id':pending, 'has_source_clip':bool(row['source']),
                'generated_clip_url':f'/stream/ev-clip?id={hit_id}&kind=generated&inline=1' if row['ready'] else None}


def save_measurement(handler, payload, s):
    """Snapshot and commit the hit before submitting any presentation rendering."""
    try:
        package = s.add_source_path_to_package(payload.get('package') or {})
        prediction = payload.get('prediction') or {}
        metadata = package.get('video_metadata') or {}
        hit = package.get('hit') or {}
        contact = float(hit['contact']['timestamp_s'])
        if not s.math.isfinite(contact) or contact < 0:
            raise ValueError('Set contact before saving.')
        hitter_id = int(payload.get('hitter_id') or 0)
        team_id = int(payload.get('team_id') or 0)
        if hitter_id <= 0:
            raise ValueError('Select the hitter before saving.')
        key = str(payload.get('save_request_key') or '')
        if not key or len(key) > 100:
            raise ValueError('A save request identifier is required.')
        description = str(payload.get('description') or hit.get('description') or metadata.get('description') or '').strip()
        package_json = json.dumps(package,separators=(',',':'))
        prediction_json = json.dumps(prediction,separators=(',',':'))
        fingerprint = hashlib.sha256(json.dumps([hitter_id,description,package,prediction,payload.get('create_pitch') is True,payload.get('video_banner_text')],sort_keys=True,separators=(',',':')).encode()).hexdigest()
        with closing(s.gameframe_conn()) as conn, conn:
            s.ensure_gameframe_ev_schema(conn)
            existing = conn.execute('SELECT id,save_request_hash FROM ev_hit_tracks WHERE save_request_key=?',(key,)).fetchone()
            if existing:
                if existing['save_request_hash'] != fingerprint:
                    raise ValueError('The measurement changed. Start a new save request.')
                status = s.background_videos().status(existing['id'])
                if status['status']=='queued':s.background_videos().submit(existing['id'])
                s.json_response(handler,200,{'ok':True,'id':existing['id'],'measurement_persisted':True,'video_persisted':status['status']=='ready','video_status':status['status'],'pending_swing_id':status['pending_swing_id'],'copy_job_id':s.related_copy_job_for_hit(existing['id'])})
                return
            hitter = conn.execute('SELECT team_id FROM hitters WHERE id=?',(hitter_id,)).fetchone()
            if not hitter:
                raise ValueError('Selected hitter was not found.')
            team_id = int(hitter['team_id'] or 0)
        source = s.locate_video(metadata.get('file_name'),metadata.get('source_path'))
        if source is None:
            raise ValueError('The source video is not available. Your draft has not been removed.')
        stat=source.stat()
        metadata['_saved_source_identity']={'size':stat.st_size,'mtime_ns':stat.st_mtime_ns}
        metadata['_saved_video_banner']=payload.get('video_banner_text')
        package_json=json.dumps(package,separators=(',',':'))
        source_copy = s.prepare_source_clip(source,contact,s.trim_source_clip)
        s.set_export_player(package,hitter_id)
        raw,start,end,duration = source_copy.result()
        raw_data = Path(raw).read_bytes()
        best = s.best_prediction_fields(prediction)
        token = uuid.uuid4().hex
        with closing(s.gameframe_conn()) as conn, conn:
            cursor = conn.execute("""INSERT INTO ev_hit_tracks(team_id,hitter_id,description,source_file_name,source_video_path,
                contact_time_s,clip_blob,clip_mime_type,source_clip_path,clip_start_time_s,clip_end_time_s,clip_duration_s,
                observation_package_json,prediction_json,best_exit_velocity_mph,best_launch_angle_deg,best_distance_ft,
                best_hang_time_s,best_hit_id,video_render_status,video_render_token,save_request_key,save_request_hash)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'saving',?,?,?) ON CONFLICT(save_request_key) DO NOTHING""",
                (team_id or None,hitter_id,description,metadata.get('file_name') or source.name,str(source),contact,
                 sqlite3.Binary(raw_data),'video/mp4',str(raw),start,end,duration,package_json,prediction_json,
                 best.get('exit_velocity_mph'),best.get('launch_angle_deg'),best.get('distance_ft'),best.get('hang_time_s'),best.get('hit_id'),token,key,fingerprint))
            stored = conn.execute('SELECT id,save_request_hash FROM ev_hit_tracks WHERE save_request_key=?',(key,)).fetchone()
            if stored['save_request_hash'] != fingerprint:
                raise ValueError('The measurement changed. Start a new save request.')
            hit_id = stored['id']
            inserted = cursor.rowcount == 1
        copies = dict(pending_swing_id=None,pending_pitch_id=None,swing_warning=None,pitch_warning=None)
        copy_job = None
        if inserted:
            args = (hit_id,source,contact,hitter_id,team_id,description,metadata,payload.get('create_pitch') is True)
            try:
                if payload.get('defer_copy_preparation') is True:
                    copy_job = s.queue_related_copies(*args)
                else:
                    copies = s.save_related_copies(*args)
            except Exception as error:
                copies['swing_warning'] = f'Hit saved. Timing copy could not finish: {error}'
        if inserted:
            with closing(s.gameframe_conn()) as conn,conn:
                conn.execute("UPDATE ev_hit_tracks SET video_render_status='queued' WHERE id=? AND video_render_token=? AND video_render_status='saving'",(hit_id,token))
        status = s.background_videos().status(hit_id)
        if status is None:
            s.json_response(handler,404,{'error':'This saved hit was removed.'});return
        if status['status']=='queued':s.background_videos().submit(hit_id)
        s.json_response(handler,200,{'ok':True,'id':hit_id,'measurement_persisted':True,
            'video_persisted':status['status']=='ready','video_status':status['status'],
            'copy_job_id':copy_job,**copies})
    except (ValueError,KeyError,TypeError) as error:
        s.json_response(handler,400,{'error':str(error)})
    except Exception as error:
        s.json_response(handler,500,{'error':str(error)})
