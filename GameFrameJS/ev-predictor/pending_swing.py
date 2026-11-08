"""Save a separate, contact-anchored source clip for later swing timing."""
import hashlib
import json
import math
import os
import sqlite3
import subprocess
import tempfile
from contextlib import closing
from fractions import Fraction
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=24)
def _contact_timeline(source_name, size, modified_ns, contact_time):
    """Decode a bounded contact window; retain the full-scan fallback for odd PTS."""
    def probe(window):
        command = [os.environ.get('FFPROBE_PATH','ffprobe'),'-v','error','-select_streams','v:0']
        if window:
            command += ['-read_intervals', f'{max(0.,contact_time-3):.9f}%{contact_time+.5:.9f}']
        command += ['-show_frames','-show_entries',
                    'frame=best_effort_timestamp_time:stream=avg_frame_rate,start_time','-of','json',source_name]
        return json.loads(subprocess.run(command,stdin=subprocess.DEVNULL,capture_output=True,text=True,check=True).stdout)
    info = probe(True)
    stream = info['streams'][0]
    timestamps = [float(frame['best_effort_timestamp_time']) for frame in info.get('frames',[]) if 'best_effort_timestamp_time' in frame]
    fps = float(Fraction(stream['avg_frame_rate']))
    # Preserve the existing exact interpretation for nonzero/unknown source PTS,
    # or a demuxer that did not return enough frames around the requested seek.
    if (not timestamps or stream.get('start_time') is None or abs(float(stream['start_time']))>1e-6
            or timestamps[0]>max(0.,contact_time-2)+1/max(fps,1)
            or timestamps[-1]<contact_time-1/max(fps,1)):
        info = probe(False)
        timestamps = [float(frame['best_effort_timestamp_time']) for frame in info.get('frames',[]) if 'best_effort_timestamp_time' in frame]
        fps = float(Fraction(info['streams'][0]['avg_frame_rate']))
        base = timestamps[0] if timestamps else 0.
    else:
        base = 0.
    return tuple(time-base for time in timestamps),fps


def save_pending_swing(db_path, source, contact_time, hitter_id, team_id, description, metadata):
    return _save_pending_clip(db_path, source, contact_time, hitter_id, team_id, description, metadata, "swing")


def save_pending_pitch(db_path, source, contact_time, description, metadata):
    return _save_pending_clip(db_path, source, contact_time, None, None, description, metadata, "pitch")


def _save_pending_clip(db_path, source, contact_time, hitter_id, team_id, description, metadata, kind):
    table = f"pending_{kind}_clips"
    links = f"ev_{kind}_links"
    pending_id = f"pending_{kind}_id"
    clip_id = f"{kind}_clip_id"
    player_id = "hitter_id" if kind == "swing" else "pitcher_id"
    if kind == "swing" and hitter_id <= 0:
        raise ValueError("Select a hitter to also save this video in the swing library.")
    if kind == "swing" and team_id <= 0:
        raise ValueError("The hitter needs a team for the swing library.")
    if not math.isfinite(contact_time) or contact_time < 0:
        raise ValueError("Invalid swing contact time.")
    source = Path(source)
    stat = source.stat()
    fast_key = hashlib.sha256(json.dumps([str(source.resolve()),stat.st_size,stat.st_mtime_ns,
                                         round(contact_time,6),hitter_id,'contact-time-v1']).encode()).hexdigest()
    # Existing copies should not trigger any media probe or encoding at all.
    with closing(sqlite3.connect(db_path)) as conn:
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",(links,)).fetchone():
            existing = conn.execute(f'''SELECT p.id FROM {links} link JOIN {table} p
                ON p.id=link.{pending_id} WHERE link.source_key=?''',(fast_key,)).fetchone()
            if existing:
                return existing[0]
    times,fps = _contact_timeline(str(source.resolve()),stat.st_size,stat.st_mtime_ns,round(contact_time,6))
    contact = min(range(len(times)), key=lambda index: abs(times[index] - contact_time))
    key = fast_key
    legacy_key = hashlib.sha256(json.dumps([str(source.resolve()),stat.st_size,stat.st_mtime_ns,
                                           round(times[contact]*fps),hitter_id]).encode()).hexdigest()
    with closing(sqlite3.connect(db_path)) as conn, conn:
        conn.executescript(f"""
            CREATE TABLE IF NOT EXISTS {table} (
                id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT NOT NULL,
                team_id INTEGER, {player_id} INTEGER, description TEXT, swing_type TEXT,
                clip_blob BLOB NOT NULL, fps REAL NOT NULL, contact_frame INTEGER NOT NULL,
                source_contact_seconds REAL, video_created_at TEXT, status TEXT NOT NULL DEFAULT 'pending',
                {clip_id} INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS {links} (
                source_key TEXT PRIMARY KEY, {pending_id} INTEGER NOT NULL, {clip_id} INTEGER
            );
        """)
        existing = conn.execute(f"""SELECT p.id FROM {links} link
            JOIN {table} p ON p.id=link.{pending_id}
            WHERE link.source_key IN (?,?)""", (key,legacy_key)).fetchone()
        if existing:
            conn.execute(f"INSERT OR IGNORE INTO {links}(source_key,{pending_id}) VALUES(?,?)",(key,existing[0]))
            return existing[0]
    clip, fps, contact_frame = prepare_swing_media(source, contact_time).result()
    with closing(sqlite3.connect(db_path)) as conn, conn:
        # Serialize the final duplicate check with insertion, including concurrent EV saves.
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(f"""SELECT p.id FROM {links} link
            JOIN {table} p ON p.id=link.{pending_id}
            WHERE link.source_key=?""", (key,)).fetchone()
        if existing:
            return existing[0]
        result = conn.execute(f"""INSERT INTO {table}
            (batch_id,team_id,{player_id},description,clip_blob,fps,contact_frame,source_contact_seconds,video_created_at)
            VALUES(?,?,?,?,?,?,?,?,?)""", ("ev-" + key, team_id, hitter_id, description, clip, fps,
                contact_frame, contact_time, metadata.get("video_created_at") or metadata.get("creation_time")))
        conn.execute(f"""INSERT INTO {links}(source_key,{pending_id}) VALUES(?,?)
            ON CONFLICT(source_key) DO UPDATE SET {pending_id}=excluded.{pending_id}""", (key,result.lastrowid))
        return result.lastrowid


# A bounded, source/contact-keyed cache holds media only; abandoned work creates
# no library rows. Save consumes the same Future, including work still running.
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import threading

_media_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='ev-swing-preload')
_media_lock = threading.Lock()
_media_entries = OrderedDict()


def prepare_swing_media(source, contact_time):
    source = Path(source).resolve()
    stat = source.stat()
    key = (str(source), stat.st_size, stat.st_mtime_ns, round(float(contact_time), 6))
    with _media_lock:
        future = _media_entries.get(key)
        if future is not None and future.done() and future.exception() is not None:
            del _media_entries[key]
            future = None
        if future is None:
            future = _media_pool.submit(_encode_swing_media, source, key[-1])
            _media_entries[key] = future
        _media_entries.move_to_end(key)
        while len(_media_entries) > 3:
            _media_entries.popitem(last=False)
        return future


def _encode_swing_media(source, contact_time):
    stat = source.stat()
    times,fps = _contact_timeline(str(source.resolve()),stat.st_size,stat.st_mtime_ns,round(contact_time,6))
    if not times or not math.isfinite(fps) or fps <= 0:
        raise ValueError("Could not read source swing timing.")
    if contact_time > times[-1] + 1 / fps:
        raise ValueError("Contact is outside the source video.")
    contact = min(range(len(times)), key=lambda index: abs(times[index] - contact_time))
    start = next(index for index, time in enumerate(times) if time >= max(0, times[contact] - 2))
    if start >= contact:
        raise ValueError("The source needs frames before contact for swing timing.")
    with tempfile.TemporaryDirectory(prefix="gf_ev_swing_") as directory:
        output = Path(directory) / "swing.mp4"
        subprocess.run([
            os.environ.get("FFMPEG_PATH", "ffmpeg"), "-y", "-v", "error",
            "-ss", f"{times[start]:.9f}", "-threads", "1", "-i", str(source),
            "-vf", f"trim=start_frame=0:end_frame={contact - start + 1},setpts=PTS-STARTPTS",
            "-an", "-fps_mode", "passthrough", "-c:v", "libx264", "-preset", "veryfast",
            "-crf", "23", "-threads", "1", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
        ], stdin=subprocess.DEVNULL, capture_output=True, text=True, check=True)
        output_info = json.loads(subprocess.run([
            os.environ.get("FFPROBE_PATH", "ffprobe"), "-v", "error", "-select_streams", "v:0",
            # Our H.264/MP4 encoder emits one access-unit packet per frame.
            # Count packets to verify preservation without decoding the copy again.
            "-count_packets", "-show_entries", "stream=avg_frame_rate,nb_read_packets", "-of", "json", str(output),
        ], stdin=subprocess.DEVNULL, capture_output=True, text=True, check=True).stdout)["streams"][0]
        if int(output_info["nb_read_packets"]) != contact - start + 1:
            raise ValueError("Swing copy did not preserve the contact frame.")
        fps = float(Fraction(output_info["avg_frame_rate"]))
        clip = output.read_bytes()
    return clip, fps, contact - start
