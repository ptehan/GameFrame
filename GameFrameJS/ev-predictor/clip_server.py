from __future__ import annotations

import math

import json
import mimetypes
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from pending_swing import save_pending_swing, save_pending_pitch, prepare_swing_media
from encoder_runtime import render_environment
from source_clip_runtime import prepare_source_clip


ROOT = Path(__file__).resolve().parent
GAMEFRAME_DB = Path(os.environ.get("DB_PATH") or (ROOT.parent / "app.db")).resolve()
CLIP_DIR = ROOT / "clips"
LIVE_DIR = ROOT / "comparison_output" / "live"
LOCAL_PYTHON = ROOT.parent / ".venv-ev" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
EV_PYTHON = os.environ.get("GAMEFRAME_EV_PYTHON") or str(LOCAL_PYTHON if LOCAL_PYTHON.exists() else Path(sys.executable))
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
RELATED_COPY_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix='ev-related-copies')
TEMP_VIDEO_TTL_S = 2 * 60 * 60
PREDICTION_RUNTIME = None
MEDIA_RUNTIME = None
DEFERRED_VIDEOS = None


def prediction_export_blocker(prediction):
    if not isinstance(prediction, dict):
        return None
    review = prediction.get('distance_review') or {}
    readiness = prediction.get('export_readiness') or {}
    if review.get('required'):
        return review.get('message') or 'Review the marks and recalculate before exporting.'
    if readiness.get('allowed') is False:
        return readiness.get('message') or 'This prediction is not ready to export.'
    return None


def gameframe_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(GAMEFRAME_DB)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_gameframe_ev_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS ev_hit_tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id INTEGER,
            hitter_id INTEGER,
            description TEXT,
            source_file_name TEXT,
            source_video_path TEXT,
            contact_time_s REAL,
            clip_blob BLOB,
            clip_mime_type TEXT,
            source_clip_path TEXT,
            generated_clip_blob BLOB,
            generated_clip_mime_type TEXT,
            generated_clip_path TEXT,
            clip_start_time_s REAL,
            clip_end_time_s REAL,
            clip_duration_s REAL,
            observation_package_json TEXT NOT NULL,
            prediction_json TEXT,
            best_exit_velocity_mph REAL,
            best_launch_angle_deg REAL,
            best_distance_ft REAL,
            best_hang_time_s REAL,
            best_hit_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (team_id) REFERENCES teams(id),
            FOREIGN KEY (hitter_id) REFERENCES hitters(id)
        );
        """
    )
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(ev_hit_tracks)").fetchall()}
    for name, ddl_type in {
        "source_clip_path": "TEXT",
        "generated_clip_blob": "BLOB",
        "generated_clip_mime_type": "TEXT",
        "generated_clip_path": "TEXT",
        "video_render_status": "TEXT",
        "video_render_error": "TEXT",
        "video_render_token": "TEXT",
        "save_request_key": "TEXT",
        "save_request_hash": "TEXT",
    }.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE ev_hit_tracks ADD COLUMN {name} {ddl_type}")

    conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS ev_save_request_key ON ev_hit_tracks(save_request_key)')


def background_videos():
    global DEFERRED_VIDEOS
    if DEFERRED_VIDEOS is None:
        from background_ev import BackgroundVideos
        DEFERRED_VIDEOS = BackgroundVideos(sys.modules[__name__])
    return DEFERRED_VIDEOS


def render_saved_hit(row):
    package = json.loads(row['observation_package_json'])
    prediction = json.loads(row['prediction_json'] or '{}')
    source = Path(row['source_video_path'] or '')
    contact = row['contact_time_s']
    identity=(package.get('video_metadata') or {}).get('_saved_source_identity')
    matches=source.is_file()
    if matches and identity:
        stat=source.stat();matches=stat.st_size==identity.get('size') and stat.st_mtime_ns==identity.get('mtime_ns')
    if not matches:
        # A committed source copy keeps queued work recoverable after restart,
        # even if the original upload or temporary source file disappeared.
        CLIP_DIR.mkdir(parents=True,exist_ok=True)
        source = CLIP_DIR / f"saved-source-{row['id']}-{row['video_render_token']}.mp4"
        source.write_bytes(row['clip_blob'])
        contact -= row['clip_start_time_s'] or 0
    set_export_player(package,row['hitter_id'])
    token = row['video_render_token']
    with closing(gameframe_conn()) as conn:
        table = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ev_swing_links'").fetchone()
        columns = {item[1] for item in conn.execute('PRAGMA table_info(ev_swing_links)')} if table else set()
        linked = conn.execute('SELECT 1 FROM ev_swing_links WHERE ev_hit_id=?',(row['id'],)).fetchone() if 'ev_hit_id' in columns else None
    if not linked:
        save_related_copies(row['id'],source,contact,row['hitter_id'],row['team_id'],row['description'],package.get('video_metadata') or {},False)
    with JOBS_LOCK:
        JOBS[token] = dict(id=token,kind='saved_ev_video',status='queued',progress=0)
    banner=(package.get('video_metadata') or {}).get('_saved_video_banner')
    if not banner:
        banner='|'.join(filter(None,[row['description'],f"EV {row['best_exit_velocity_mph'] or 0:.0f} mph",f"LA {row['best_launch_angle_deg'] or 0:.0f} degrees",f"Distance {row['best_distance_ft'] or 0:.0f} feet",f"Hang {row['best_hang_time_s'] or 0:.1f} seconds"]))
    run_clip_job(token,{'file_name':row['source_file_name'],'source_path':str(source),
        'contact_time_s':contact,'pre_s':1,'post_s':6,'package':package,'prediction':prediction,
        'banner_text':banner,
        '_source_already_saved':True,'_background':True})
    with JOBS_LOCK:
        job = dict(JOBS.get(token) or {})
    if job.get('status') != 'done':
        raise RuntimeError(job.get('error') or 'Video rendering did not complete.')
    return Path(job['output_path'])


def best_prediction_fields(prediction: dict | None) -> dict:
    prediction = prediction or {}
    rows = prediction.get("ev_candidates") or (prediction.get("unconstrained") or {}).get("top") or []
    best = rows[0] if rows else {}
    if not best and prediction.get("practical_combined_estimate"):
        best = prediction.get("practical_combined_estimate") or {}
    return {
        "hit_id": best.get("hit_id"),
        "exit_velocity_mph": best.get("exit_velocity_mph"),
        "launch_angle_deg": best.get("launch_angle_deg"),
        "distance_ft": best.get("distance_ft"),
        "hang_time_s": best.get("hang_time_s"),
    }


def cleanup_temp_video_outputs(max_age_s: int = TEMP_VIDEO_TTL_S) -> None:
    cutoff = time.time() - max_age_s
    for directory in (CLIP_DIR, LIVE_DIR):
        if not directory.exists():
            continue
        for path in directory.iterdir():
            if not path.is_file():
                continue
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink(missing_ok=True)
            except OSError:
                pass


def trim_source_clip(source: Path, contact_time_s: float, clip_id: str, pre_s: float = 1.0, post_s: float = 6.0) -> tuple[Path, float, float, float]:
    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    source_duration = ffprobe_duration(source)
    start_s = max(0.0, contact_time_s - pre_s)
    requested_end_s = contact_time_s + post_s
    end_s = min(requested_end_s, source_duration) if source_duration else requested_end_s
    duration_s = max(0.001, end_s - start_s)
    output_path = CLIP_DIR / f"{clip_id}.mp4"
    subprocess.run(
        [
            os.environ.get('FFMPEG_PATH', 'ffmpeg'),
            "-y",
            "-ss",
            f"{start_s:.6f}",
            "-threads",
            "1",
            "-i",
            str(source),
            "-t",
            f"{duration_s:.6f}",
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-threads",
            "1",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            str(output_path),
        ],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=True,
    )
    return output_path, start_s, end_s, duration_s


def set_export_player(package: dict, hitter_id: int | None = None) -> str:
    hit = package.setdefault("hit", {})
    selected_id = int(hitter_id if hitter_id is not None else hit.get("gameframe_hitter_id") or 0)
    name = ""
    if selected_id:
        with closing(gameframe_conn()) as conn:
            row = conn.execute("SELECT name FROM hitters WHERE id=?", (selected_id,)).fetchone()
        if row:
            name = str(row["name"] or "").strip()
    hit["player_name"] = name
    return name


def render_generated_clip(source: Path, package: dict, prediction: dict | None, contact_time_s: float, clip_id: str, pre_s: float = 1.0, post_s: float = 6.0) -> Path:
    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    output_path = CLIP_DIR / f"{clip_id}-generated.mp4"
    package_path = LIVE_DIR / f"save_package_{clip_id}.json"
    prediction_path = LIVE_DIR / f"save_prediction_{clip_id}.json"
    package_path.write_text(json.dumps(package, indent=2), encoding="utf-8")
    command = [
        EV_PYTHON,
        str(ROOT / "synthetic" / "clip_replay.py"),
        "--video",
        str(source),
        "--package",
        str(package_path),
        "--out",
        str(output_path),
        "--contact",
        f"{contact_time_s:.6f}",
        "--pre",
        f"{pre_s:.6f}",
        "--post",
        f"{post_s:.6f}",
        "--banner",
        "",
        "--max-width",
        "1280",
    ]
    if isinstance(prediction, dict) and prediction:
        prediction_path.write_text(json.dumps(prediction, indent=2), encoding="utf-8")
        command.extend(["--prediction", str(prediction_path)])
    subprocess.run(command, cwd=ROOT, stdin=subprocess.DEVNULL, text=True, capture_output=True, timeout=240, check=True, env=render_environment())
    return output_path


def gameframe_options_payload(conn: sqlite3.Connection) -> dict:
    ensure_gameframe_ev_schema(conn)
    teams = [dict(row) for row in conn.execute("SELECT id, name, COALESCE(description, '') AS description FROM teams ORDER BY name").fetchall()]
    hitters = [
        dict(row)
        for row in conn.execute(
            """
            SELECT h.id, h.team_id, h.name, COALESCE(h.description, '') AS description, t.name AS team_name
            FROM hitters h
            LEFT JOIN teams t ON t.id = h.team_id
            ORDER BY t.name, h.name
            """
        ).fetchall()
    ]
    return {"teams": teams, "hitters": hitters}


def json_response(handler: SimpleHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def safe_stem(name: str | None) -> str:
    stem = Path(name or "hit-clip").stem
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", stem).strip("-")
    return cleaned[:90] or "hit-clip"


def locate_video(file_name: str | None, explicit_path: str | None = None) -> Path | None:
    candidates: list[Path] = []
    if explicit_path:
        candidates.append(Path(explicit_path))
    if file_name:
        candidates.extend(
            [
                Path.home() / "Downloads" / file_name,
                ROOT / file_name,
                ROOT / "clips" / file_name,
                Path.home() / "Videos" / file_name,
            ]
        )
    for candidate in candidates:
        try:
            if candidate.exists() and candidate.is_file():
                return candidate.resolve()
        except OSError:
            continue
    return None


def add_source_path_to_package(package: dict) -> dict:
    metadata = package.setdefault("video_metadata", {})
    source = locate_video(metadata.get("file_name"), metadata.get("source_path"))
    if source is not None:
        metadata["source_path"] = str(source)
    return package


def ffprobe_duration(path: Path) -> float | None:
    try:
        output = subprocess.check_output(
            [os.environ.get('FFPROBE_PATH', 'ffprobe'), "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
            stdin=subprocess.DEVNULL,
            text=True,
        )
        return float(json.loads(output)["format"]["duration"])
    except Exception:
        return None


def drawtext_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "\\%")
    )


def update_job(job_id: str, **fields) -> None:
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(fields)


def save_related_copies(ev_id, source, contact, hitter_id, team_id, description, metadata, create_pitch):
    result = dict(pending_swing_id=None,pending_pitch_id=None,swing_warning=None,pitch_warning=None)
    try:
        result['pending_swing_id'] = save_pending_swing(GAMEFRAME_DB,source,contact,hitter_id,team_id,description,metadata)
        with closing(gameframe_conn()) as conn, conn:
            columns = {row[1] for row in conn.execute('PRAGMA table_info(ev_swing_links)')}
            if 'ev_hit_id' not in columns:
                conn.execute('ALTER TABLE ev_swing_links ADD COLUMN ev_hit_id INTEGER')
            conn.execute('UPDATE ev_swing_links SET ev_hit_id=? WHERE pending_swing_id=?',
                         (ev_id,result['pending_swing_id']))
    except Exception as exc:
        result['swing_warning'] = f'EV saved, but the swing copy could not be saved: {exc}'
    if create_pitch:
        try:
            result['pending_pitch_id'] = save_pending_pitch(GAMEFRAME_DB,source,contact,description,metadata)
        except Exception as exc:
            result['pitch_warning'] = f'EV saved, but the pitch copy could not be saved: {exc}'
    return result


def queue_related_copies(*arguments):
    job_id = uuid.uuid4().hex
    with JOBS_LOCK:
        JOBS[job_id] = dict(id=job_id,kind='related_copies',ev_hit_id=arguments[0],status='queued',progress=0,
                            message='EV saved; preparing swing timing copy')
    def work():
        update_job(job_id,status='running',progress=.1)
        try:
            result = save_related_copies(*arguments)
            update_job(job_id,status='done',progress=1,message='Related video copies finished',**result)
        except Exception as exc:
            update_job(job_id,status='error',error=f'EV saved; timing copy preparation failed: {exc}')
    RELATED_COPY_POOL.submit(work)
    return job_id


def related_copy_job_for_hit(hit_id):
    with JOBS_LOCK:
        return next((job_id for job_id,job in reversed(list(JOBS.items()))
                     if job.get('kind') == 'related_copies' and job.get('ev_hit_id') == hit_id
                     and job.get('status') != 'error'), None)


def run_clip_job(job_id: str, payload: dict) -> None:
    source = locate_video(payload.get("file_name"), payload.get("source_path"))
    if source is None:
        update_job(job_id, status="error", error=f"Could not find source video: {payload.get('file_name') or 'unknown'}")
        return

    try:
        contact_time = float(payload["contact_time_s"])
        pre_s = float(payload.get("pre_s", 1.0))
        post_s = float(payload.get("post_s", 6.0))
    except Exception as exc:
        update_job(job_id, status="error", error=f"Bad clip timing: {exc}")
        return

    start_s = max(0.0, contact_time - pre_s)
    source_duration = ffprobe_duration(source)
    requested_end_s = contact_time + post_s
    end_s = min(requested_end_s, source_duration) if source_duration else requested_end_s
    duration_s = max(0.001, end_s - start_s)
    # Prepare the reusable raw copy during rendering, not afterward on Save.
    if pre_s == 1.0 and post_s == 6.0 and not payload.get('_source_already_saved'):
        prepare_source_clip(source, contact_time, trim_source_clip)
    banner_text = str(payload.get("banner_text") or "").strip() or "EV n/a    LA n/a    Distance n/a"
    banner_px = int(payload.get("banner_px") or 110)
    font_size = max(22, min(64, int(banner_px * 0.38)))
    clip_name = f"{safe_stem(payload.get('file_name'))}-contact-clip-{job_id[:8]}.mp4"
    output_path = CLIP_DIR / clip_name
    CLIP_DIR.mkdir(parents=True, exist_ok=True)

    package = payload.get("package")
    prediction = payload.get("prediction")
    if isinstance(package, dict):
        try:
            player_name = set_export_player(package)
            update_job(job_id, player_name=player_name)
            update_job(
                job_id,
                status="running",
                progress=0.02,
                message="rendering annotated replay",
                source_path=str(source),
                output_path=str(output_path),
                start_s=start_s,
                end_s=end_s,
                duration_s=duration_s,
            )
            LIVE_DIR.mkdir(parents=True, exist_ok=True)
            package_path = LIVE_DIR / f"clip_package_{job_id}.json"
            prediction_path = LIVE_DIR / f"clip_prediction_{job_id}.json"
            package_path.write_text(json.dumps(package, indent=2), encoding="utf-8")
            if isinstance(prediction, dict):
                prediction_path.write_text(json.dumps(prediction, indent=2), encoding="utf-8")
            python_exe = EV_PYTHON
            command = [
                str(python_exe),
                str(ROOT / "synthetic" / "clip_replay.py"),
                "--video",
                str(source),
                "--package",
                str(package_path),
                "--out",
                str(output_path),
                "--contact",
                f"{contact_time:.6f}",
                "--pre",
                f"{pre_s:.6f}",
                "--post",
                f"{post_s:.6f}",
                "--banner",
                str(payload.get("banner_text") or ""),
                "--max-width",
                "1280",
            ]
            if isinstance(prediction, dict):
                command.extend(["--prediction", str(prediction_path)])
            if MEDIA_RUNTIME is not None:
                render_options = {'_background':True} if payload.get('_background') else {}
                render_started = time.perf_counter()
                def render_progress(message, progress):
                    update_job(job_id,progress=max(.02,min(.98,float(progress))),message=str(message))
                    print(f"EV video {job_id}: {message} ({time.perf_counter()-render_started:.2f}s)",file=sys.stderr,flush=True)
                MEDIA_RUNTIME.render(source,package,prediction,output_path,contact_time,pre_s,post_s,
                    str(payload.get('banner_text') or ''),
                    render_progress,**render_options)
            else:
                process = subprocess.Popen(
                    command,
                    env={**render_environment(),"EV_BACKGROUND_RENDER":"1" if payload.get("_background") else "0"},
                    cwd=ROOT,
                    stdin=subprocess.DEVNULL,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                )
                tail: list[str] = []
                last_output_at = time.time()
                assert process.stdout is not None
                while True:
                    line = process.stdout.readline()
                    if line:
                        last_output_at = time.time()
                        line = line.strip()
                        if line:
                            tail.append(line)
                            tail = tail[-30:]
                            try:
                                progress_event = json.loads(line)
                            except json.JSONDecodeError:
                                progress_event = None
                            if isinstance(progress_event, dict):
                                progress = progress_event.get("progress")
                                message = progress_event.get("message")
                                if isinstance(progress, (int, float)):
                                    update_job(
                                        job_id,
                                        progress=max(0.02, min(0.98, float(progress))),
                                        message=str(message or "rendering annotated replay"),
                                    )
                        continue
                    code = process.poll()
                    if code is not None:
                        break
                    if time.time() - last_output_at > 180:
                        process.kill()
                        update_job(job_id, status="error", error="annotated clip renderer stalled", progress=0)
                        return
                    time.sleep(0.1)
                if code != 0:
                    update_job(
                        job_id,
                        status="error",
                        error=("\n".join(tail[-8:]) or "annotated clip renderer failed"),
                        progress=0,
                    )
                    return
            update_job(
                job_id,
                status="done",
                progress=1,
                message="annotated clip ready",
                download_url=f"/api/clip/download?id={job_id}",
                file_name=clip_name,
            )
            return
        except Exception as exc:
            update_job(job_id, status="error", error=str(exc), progress=0)
            return

    vf = (
        f"pad=iw:ih+{banner_px}:0:{banner_px}:color=0x061015,"
        f"drawtext=font='Arial':text='{drawtext_escape(banner_text)}':"
        f"fontcolor=white:fontsize={font_size}:x=24:y=({banner_px}-text_h)/2"
    )
    command = [
        os.environ.get('FFMPEG_PATH', 'ffmpeg'),
        "-y",
        "-ss",
        f"{start_s:.6f}",
        "-i",
        str(source),
        "-t",
        f"{duration_s:.6f}",
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        "-nostats",
        str(output_path),
    ]

    update_job(
        job_id,
        status="running",
        progress=0.02,
        message="ffmpeg started",
        source_path=str(source),
        output_path=str(output_path),
        start_s=start_s,
        end_s=end_s,
        duration_s=duration_s,
    )

    try:
        process = subprocess.Popen(
            command,
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        tail: list[str] = []
        assert process.stdout is not None
        for line in process.stdout:
            line = line.strip()
            if not line:
                continue
            tail.append(line)
            tail = tail[-20:]
            if line.startswith("out_time_ms="):
                try:
                    out_time_s = int(line.split("=", 1)[1]) / 1_000_000
                    progress = max(0.02, min(0.98, out_time_s / duration_s))
                    update_job(job_id, progress=progress, message=f"encoding {round(progress * 100)}%")
                except ValueError:
                    pass
        code = process.wait()
        if code != 0:
            update_job(job_id, status="error", error="\n".join(tail[-8:]) or f"ffmpeg exited {code}", progress=0)
            return
        update_job(
            job_id,
            status="done",
            progress=1,
            message="clip ready",
            download_url=f"/api/clip/download?id={job_id}",
            file_name=clip_name,
        )
    except Exception as exc:
        update_job(job_id, status="error", error=str(exc), progress=0)


def handle_json_body(handler: SimpleHTTPRequestHandler) -> dict | None:
    try:
        length = int(handler.headers.get("Content-Length", "0"))
        return json.loads(handler.rfile.read(length).decode("utf-8") or "{}")
    except Exception as exc:
        json_response(handler, 400, {"error": f"bad json: {exc}"})
        return None


class ClipServerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def handle_video_timing(self):
        payload = handle_json_body(self)
        source = locate_video(payload.get('file_name'),payload.get('source_path'))
        if source is None:
            json_response(self,404,{'error':'Source video not available for exact frame timing'})
            return
        try:
            reference = float(payload.get('reference_time_s') or 0.)
            if not math.isfinite(reference) or reference < 0:
                raise ValueError('Invalid reference time')
            stat = source.stat()
            if payload.get('file_size') and int(payload['file_size']) != stat.st_size:
                raise ValueError('Source video does not match the selected file size')
            from pending_swing import _contact_timeline
            times,fps = _contact_timeline(str(source),stat.st_size,stat.st_mtime_ns,round(reference,1))
            frames = sorted(set(t for t in times if max(0,reference-3)<=t<=reference+.5))
            gaps = sorted(b-a for a,b in zip(frames,frames[1:]) if b>a)
            step = gaps[len(gaps)//2] if gaps else 1/fps
            json_response(self,200,dict(frame_times_s=frames,fps=fps,frame_step_assumption_s=step,
                timing_source='source_frame_timestamps',variable_frame_rate=bool(gaps and max(gaps)-min(gaps)>.05*step)))
        except (ValueError,OSError,KeyError,subprocess.SubprocessError) as error:
            json_response(self,422,{'error':str(error)})

    def do_POST(self) -> None:
        if self.path == '/api/gameframe/retry-ev-video':
            payload = handle_json_body(self)
            if payload is None:return
            try:
                status = background_videos().retry(int(payload.get('id') or 0))
                json_response(self,200 if status else 404,status or {'error':'Saved hit not found.'})
            except (ValueError,TypeError) as error:json_response(self,400,{'error':str(error)})
            return
        if self.path == '/api/gameframe/preload-contact':
            payload = handle_json_body(self)
            if payload is None:
                return
            package = payload.get('package') or {}
            metadata = package.get('video_metadata') or {}
            try:
                contact = float(payload['preload_time_s'] if 'preload_time_s' in payload else package['hit']['contact']['timestamp_s'])
                if not math.isfinite(contact) or contact < 0:
                    raise ValueError('Invalid contact time.')
                source = locate_video(metadata.get('file_name'), metadata.get('source_path'))
                if source is None:
                    json_response(self, 404, {'error': 'Source video is not ready yet.'})
                    return
                prepare_swing_media(source, contact)
                prepare_source_clip(source, contact, trim_source_clip)
                json_response(self, 202, {'ok': True})
            except Exception as error:
                json_response(self, 400, {'error': str(error)})
            return
        if self.path == '/api/gameframe/video-timing':
            self.handle_video_timing()
            return
        if self.path == "/api/gameframe/field-locations":
            self.handle_field_locations()
            return
        if self.path == "/api/predict":
            self.handle_predict()
            return
        if self.path == "/api/track":
            self.handle_track()
            return
        if self.path == "/api/landmarks":
            self.handle_landmarks()
            return
        if self.path == "/api/gameframe/team":
            self.handle_gameframe_team()
            return
        if self.path == "/api/gameframe/options":
            self.handle_gameframe_options()
            return
        if self.path == "/api/gameframe/hitter":
            self.handle_gameframe_hitter()
            return
        if self.path == "/api/gameframe/save-hit":
            self.handle_gameframe_save_hit()
            return
        if self.path == "/api/gameframe/ev-hit/description":
            self.handle_gameframe_ev_hit_description()
            return
        if self.path == "/api/gameframe/ev-hit/delete":
            self.handle_gameframe_ev_hit_delete()
            return
        if self.path != "/api/clip":
            json_response(self, 404, {"error": "not found"})
            return
        payload = handle_json_body(self)
        if payload is None:
            return
        blocker = prediction_export_blocker(payload.get('prediction'))
        if blocker:
            json_response(self, 409, {'error': blocker, 'review_required': True})
            return
        cleanup_temp_video_outputs()
        job_id = uuid.uuid4().hex
        with JOBS_LOCK:
            JOBS[job_id] = {"status": "queued", "progress": 0, "message": "queued", "created_at": time.time()}
        threading.Thread(target=run_clip_job, args=(job_id, payload), daemon=True).start()
        json_response(self, 202, {"job_id": job_id})

    def handle_predict(self) -> None:
        package = handle_json_body(self)
        if package is None:
            return
        package = add_source_path_to_package(package)

        LIVE_DIR.mkdir(parents=True, exist_ok=True)
        stamp = uuid.uuid4().hex
        package_path = LIVE_DIR / f"observation_package_{stamp}.json"
        output_path = LIVE_DIR / f"direct_video_estimate_{stamp}.json"
        package_path.write_text(json.dumps(package, indent=2), encoding="utf-8")

        python_exe = EV_PYTHON
        command = [
            str(python_exe),
            str(ROOT / "synthetic" / "direct_video_estimate.py"),
            str(package_path),
            "--db",
            str(ROOT / "data" / "hittrax_from_video.sqlite"),
            "--out",
            str(output_path),
        ]
        try:
            started = time.perf_counter()
            if PREDICTION_RUNTIME is not None:
                stdout, _calculation_seconds = PREDICTION_RUNTIME.run(command[2:], getattr(self, 'request_id', None))
                completed = subprocess.CompletedProcess(command, 0, stdout, '')
            else:
                completed = subprocess.run(
                    command,
                    cwd=ROOT,
                    stdin=subprocess.DEVNULL,
                    text=True,
                    capture_output=True,
                    timeout=240,
                    check=False,
                )
            if completed.returncode != 0:
                json_response(
                    self,
                    500,
                    {
                        "error": "prediction failed",
                        "stdout": completed.stdout[-4000:],
                        "stderr": completed.stderr[-4000:],
                    },
                )
                return
            prediction = json.loads(output_path.read_text(encoding="utf-8"))
            prediction["_live_prediction"] = {
                "package_path": str(package_path),
                "output_path": str(output_path),
                "stdout": completed.stdout[-2000:],
                "elapsed_seconds": round(time.perf_counter() - started, 3),
            }
            print(f"EV prediction {stamp}: {prediction['_live_prediction']['elapsed_seconds']}s", file=sys.stderr, flush=True)
            json_response(self, 200, prediction)
        except (subprocess.TimeoutExpired, TimeoutError):
            json_response(self, 504, {"error": "prediction timed out"})
        except Exception as exc:
            json_response(self, 500, {"error": str(exc)})

    def handle_gameframe_options(self) -> None:
        try:
            with gameframe_conn() as conn:
                json_response(self, 200, gameframe_options_payload(conn))
        except Exception as exc:
            json_response(self, 500, {"error": str(exc)})

    def handle_gameframe_team(self) -> None:
        payload = handle_json_body(self)
        if payload is None:
            return
        name = str(payload.get("name") or "").strip()
        description = str(payload.get("description") or "").strip()
        if not name:
            json_response(self, 400, {"error": "Team name is required."})
            return
        try:
            with gameframe_conn() as conn:
                conn.execute("INSERT OR IGNORE INTO teams (name, description) VALUES (?, ?)", (name, description))
                row = conn.execute("SELECT id, name, description FROM teams WHERE name=? COLLATE NOCASE ORDER BY id DESC LIMIT 1", (name,)).fetchone()
                json_response(self, 200, {"team": dict(row), **gameframe_options_payload(conn)})
        except Exception as exc:
            json_response(self, 500, {"error": str(exc)})

    def handle_gameframe_hitter(self) -> None:
        payload = handle_json_body(self)
        if payload is None:
            return
        try:
            team_id = int(payload.get("team_id") or 0)
        except Exception:
            team_id = 0
        name = str(payload.get("name") or "").strip()
        description = str(payload.get("description") or "").strip()
        if team_id <= 0 or not name:
            json_response(self, 400, {"error": "Team and hitter name are required."})
            return
        try:
            with gameframe_conn() as conn:
                team = conn.execute("SELECT id FROM teams WHERE id=?", (team_id,)).fetchone()
                if not team:
                    json_response(self, 404, {"error": "Team not found."})
                    return
                existing = conn.execute(
                    "SELECT id, name, team_id, description FROM hitters WHERE team_id=? AND name=? COLLATE NOCASE",
                    (team_id, name),
                ).fetchone()
                if existing:
                    row = existing
                else:
                    conn.execute("INSERT INTO hitters (team_id, name, description) VALUES (?, ?, ?)", (team_id, name, description))
                    row = conn.execute(
                        "SELECT id, name, team_id, description FROM hitters WHERE team_id=? AND name=? ORDER BY id DESC LIMIT 1",
                        (team_id, name),
                    ).fetchone()
                json_response(self, 200, {"hitter": dict(row), **gameframe_options_payload(conn)})
        except Exception as exc:
            json_response(self, 500, {"error": str(exc)})

    def handle_gameframe_ev_hit_description(self) -> None:
        payload = handle_json_body(self)
        if payload is None:
            return
        try:
            hit_id = int(payload.get("id") or 0)
        except Exception:
            hit_id = 0
        description = str(payload.get("description") or "").strip()[:500]
        if hit_id <= 0:
            json_response(self, 400, {"error": "Saved hit id is required."})
            return
        try:
            with gameframe_conn() as conn:
                ensure_gameframe_ev_schema(conn)
                result = conn.execute(
                    "UPDATE ev_hit_tracks SET description=? WHERE id=?",
                    (description, hit_id),
                )
                if result.rowcount == 0:
                    json_response(self, 404, {"error": "saved EV hit not found"})
                    return
                json_response(self, 200, {"id": hit_id, "description": description})
        except Exception as exc:
            json_response(self, 500, {"error": str(exc)})

    def handle_gameframe_ev_hit_delete(self) -> None:
        payload = handle_json_body(self)
        if payload is None:
            return
        try:
            hit_id = int(payload.get("id") or 0)
        except Exception:
            hit_id = 0
        if hit_id <= 0:
            json_response(self, 400, {"error": "Saved hit id is required."})
            return
        try:
            with gameframe_conn() as conn:
                ensure_gameframe_ev_schema(conn)
                link_columns = {row[1] for row in conn.execute('PRAGMA table_info(ev_swing_links)')}
                if 'ev_hit_id' in link_columns:
                    conn.execute('UPDATE ev_swing_links SET ev_hit_id=NULL WHERE ev_hit_id=?', (hit_id,))
                result = conn.execute("DELETE FROM ev_hit_tracks WHERE id=?", (hit_id,))
                if result.rowcount == 0:
                    json_response(self, 404, {"error": "saved EV hit not found"})
                    return
                json_response(self, 200, {"id": hit_id, "deleted": True})
        except Exception as exc:
            json_response(self, 500, {"error": str(exc)})

    def handle_field_locations(self) -> None:
        payload = handle_json_body(self)
        if payload is None:
            return
        try:
            with closing(gameframe_conn()) as conn, conn:
                conn.execute('CREATE TABLE IF NOT EXISTS ev_field_locations(label TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)')
                if 'delete_label' in payload:
                    label = payload['delete_label']
                    if not isinstance(label, str) or not label.strip() or len(label)>500:
                        raise ValueError('Choose a saved address to delete.')
                    conn.execute('DELETE FROM ev_field_locations WHERE label=?',(label,))
                location = payload.get('location')
                if location is not None:
                    lat, lon = float(location['lat']), float(location['lon'])
                    label = str(location.get('label') or location.get('query') or '').strip()[:500]
                    if not label or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                        raise ValueError('Invalid field address')
                    location = {key: str(location.get(key) or '')[:1000] for key in ('query', 'display_name', 'saved_at')}
                    location.update(label=label, lat=lat, lon=lon)
                    conn.execute("INSERT INTO ev_field_locations VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%f','now')) ON CONFLICT(label) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at", (label,json.dumps(location)))
                rows = conn.execute('SELECT data FROM ev_field_locations ORDER BY updated_at DESC LIMIT 20').fetchall()
                json_response(self, 200, {'locations':[json.loads(row[0]) for row in rows]})
        except (ValueError, KeyError, TypeError) as exc:
            json_response(self, 400, {'error':str(exc)})

    def handle_gameframe_save_hit(self) -> None:
        payload = handle_json_body(self)
        if payload is None:
            return
        package = payload.get("package") or {}
        prediction = payload.get("prediction") or {}
        blocker = prediction_export_blocker(prediction)
        if blocker:
            json_response(self, 409, {'error': blocker, 'review_required': True})
            return
        if payload.get('defer_video_render') is True:
            from background_ev import save_measurement
            save_measurement(self,payload,sys.modules[__name__])
            return
        metadata = package.get("video_metadata") or {}
        hit = package.get("hit") or {}
        try:
            hitter_id = int(payload.get("hitter_id") or 0)
            team_id = int(payload.get("team_id") or 0)
            contact_time_s = float((hit.get("contact") or {}).get("timestamp_s"))
        except Exception:
            json_response(self, 400, {"error": "Set contact before saving."})
            return
        package = add_source_path_to_package(package)
        package_json = json.dumps(package, separators=(",", ":"))
        prediction_json = json.dumps(prediction, separators=(",", ":")) if isinstance(prediction, dict) and prediction else None
        description = str(payload.get("description") or hit.get("description") or metadata.get("description") or "").strip()
        clip_job_id = str(payload.get("clip_job_id") or "").strip()
        try:
            cleanup_temp_video_outputs()
            source = locate_video(metadata.get("file_name"), metadata.get("source_path"))
            if source is None:
                json_response(self, 404, {"error": f"Could not find source video: {metadata.get('file_name') or 'unknown'}"})
                return
            fingerprint = uuid.uuid4().hex[:12]
            clip_id = f"ev-hit-{fingerprint}"
            source_copy = prepare_source_clip(source, contact_time_s, trim_source_clip)
            player_name = set_export_player(package, hitter_id)
            generated_clip_path = None
            if clip_job_id:
                with JOBS_LOCK:
                    job = dict(JOBS.get(clip_job_id) or {})
                candidate = Path(str(job.get("output_path") or ""))
                if job.get("status") == "done" and job.get("player_name") == player_name and candidate.exists() and candidate.is_file():
                    generated_clip_path = candidate
                    start_s = job.get("start_s")
                    end_s = job.get("end_s")
                    duration_s = job.get("duration_s")
            if generated_clip_path is None:
                generated_clip_path = render_generated_clip(source, package, prediction, contact_time_s, clip_id)
            generated_clip_blob = generated_clip_path.read_bytes()
            clip_path, start_s, end_s, duration_s = source_copy.result()
            clip_blob = clip_path.read_bytes()
            best = best_prediction_fields(prediction)
            with closing(gameframe_conn()) as conn, conn:
                ensure_gameframe_ev_schema(conn)
                if hitter_id > 0:
                    hitter = conn.execute("SELECT id, team_id FROM hitters WHERE id=?", (hitter_id,)).fetchone()
                    if not hitter:
                        json_response(self, 400, {"error": "Selected hitter was not found."})
                        return
                    team_id = int(hitter["team_id"] or 0)
                elif team_id > 0:
                    team = conn.execute("SELECT id FROM teams WHERE id=?", (team_id,)).fetchone()
                    if not team:
                        json_response(self, 400, {"error": "Selected team was not found."})
                        return
                cur = conn.execute(
                    """
                    INSERT INTO ev_hit_tracks (
                        team_id, hitter_id, description, source_file_name, source_video_path,
                        contact_time_s, clip_blob, clip_mime_type, source_clip_path,
                        generated_clip_blob, generated_clip_mime_type, generated_clip_path,
                        clip_start_time_s, clip_end_time_s,
                        clip_duration_s, observation_package_json, prediction_json,
                        best_exit_velocity_mph, best_launch_angle_deg, best_distance_ft,
                        best_hang_time_s, best_hit_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        team_id if team_id > 0 else None,
                        hitter_id if hitter_id > 0 else None,
                        description,
                        metadata.get("file_name") or source.name,
                        str(source),
                        contact_time_s,
                        sqlite3.Binary(clip_blob),
                        "video/mp4",
                        str(clip_path),
                        sqlite3.Binary(generated_clip_blob),
                        "video/mp4",
                        str(generated_clip_path),
                        start_s,
                        end_s,
                        duration_s,
                        package_json,
                        prediction_json,
                        best.get("exit_velocity_mph"),
                        best.get("launch_angle_deg"),
                        best.get("distance_ft"),
                        best.get("hang_time_s"),
                        best.get("hit_id"),
                    ),
                )
                conn.commit()
                copy_arguments = (cur.lastrowid,source,contact_time_s,hitter_id,team_id,description,metadata,payload.get('create_pitch') is True)
                copy_job_id = None
                warmed = prepare_swing_media(source, contact_time_s)
                if payload.get('defer_copy_preparation') is True and (not warmed.done() or payload.get('create_pitch') is True):
                    copy_job_id = queue_related_copies(*copy_arguments)
                    copies = dict(pending_swing_id=None,pending_pitch_id=None,swing_warning=None,pitch_warning=None)
                else:
                    copies = save_related_copies(*copy_arguments)
                json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "id": cur.lastrowid,
                        "video_persisted": True,
                        "clip_size": len(clip_blob),
                        "generated_clip_size": len(generated_clip_blob),
                        "clip_path": str(clip_path),
                        "generated_clip_path": str(generated_clip_path),
                        "copy_job_id": copy_job_id,
                        **copies,
                    },
                )
        except subprocess.CalledProcessError as exc:
            json_response(self, 500, {"error": (exc.stderr or exc.stdout or str(exc))[-2000:]})
        except Exception as exc:
            json_response(self, 500, {"error": str(exc)})

    def handle_track(self) -> None:
        package = handle_json_body(self)
        if package is None:
            return

        metadata = package.get("video_metadata") or {}
        source = locate_video(metadata.get("file_name"), metadata.get("source_path"))
        if source is None:
            json_response(self, 404, {"error": f"Could not find source video: {metadata.get('file_name') or 'unknown'}"})
            return
        if not (package.get("hit") or {}).get("contact"):
            json_response(self, 400, {"error": "Set contact before tracking."})
            return

        LIVE_DIR.mkdir(parents=True, exist_ok=True)
        stamp = uuid.uuid4().hex
        package_path = LIVE_DIR / f"track_package_{stamp}.json"
        output_path = LIVE_DIR / f"directed_trail_{stamp}.json"
        debug_path = LIVE_DIR / f"directed_trail_{stamp}_debug.jpg"
        tracked_package_path = LIVE_DIR / f"directed_trail_{stamp}_package.json"
        package_path.write_text(json.dumps(package, indent=2), encoding="utf-8")

        python_exe = EV_PYTHON
        command = [
            str(python_exe),
            str(ROOT / "synthetic" / "auto_track_ball.py"),
            str(package_path),
            "--video",
            str(source),
            "--out",
            str(tracked_package_path),
            "--diagnostic",
            str(debug_path),
            "--method",
            "path",
            "--duration",
            "0.45",
            "--work-width",
            "720",
        ]
        try:
            completed = subprocess.run(
                command,
                cwd=ROOT,
                stdin=subprocess.DEVNULL,
                text=True,
                capture_output=True,
                timeout=180,
                check=False,
            )
            if completed.returncode != 0:
                json_response(
                    self,
                    500,
                    {
                        "error": "tracking failed",
                        "stdout": completed.stdout[-4000:],
                        "stderr": completed.stderr[-4000:],
                    },
                )
                return
            tracked_package = json.loads(tracked_package_path.read_text(encoding="utf-8"))
            rows = tracked_package.get("ball_observations") or []
            cv_rows = [row for row in rows if row.get("source") == "COMPUTER_VISION"]
            tracking_method = str((tracked_package.get("auto_tracking") or {}).get("method") or "directed_trail_tracking_v1")
            details = {
                "method": tracking_method,
                "top": [
                    {
                        "source": tracking_method,
                        "support_frames": len(cv_rows),
                        "missing_frames": 0,
                        "evidence": [
                            {
                                "frame": int(round(float(row.get("relative_time_s") or 0.0) * 30.0)),
                                "candidate": {"distance_px": 0.0},
                            }
                            for row in cv_rows
                        ],
                    }
                ],
                "auto_tracking": tracked_package.get("auto_tracking") or {},
            }
            output_path.write_text(json.dumps(details, indent=2), encoding="utf-8")
            json_response(
                self,
                200,
                {
                    "package": tracked_package,
                    "details": details,
                    "debug_url": f"/comparison_output/live/{debug_path.name}",
                    "choice_debug_url": f"/comparison_output/live/{debug_path.name}",
                    "stdout": completed.stdout[-3000:],
                    "source_path": str(source),
                },
            )
        except subprocess.TimeoutExpired:
            json_response(self, 504, {"error": "tracking timed out"})
        except Exception as exc:
            json_response(self, 500, {"error": str(exc)})

    def handle_landmarks(self) -> None:
        payload = handle_json_body(self)
        if payload is None:
            return
        package = payload.get("package") or payload
        metadata = package.get("video_metadata") or {}
        source = locate_video(metadata.get("file_name"), metadata.get("source_path"))
        if source is None:
            json_response(self, 404, {"error": f"Could not find source video: {metadata.get('file_name') or 'unknown'}"})
            return
        try:
            frame_time_s = float(payload.get("frame_time_s") if "frame_time_s" in payload else (package.get("hit") or {}).get("contact", {}).get("timestamp_s", 0.0))
        except Exception:
            frame_time_s = 0.0

        LIVE_DIR.mkdir(parents=True, exist_ok=True)
        stamp = uuid.uuid4().hex
        output_path = LIVE_DIR / f"field_landmarks_{stamp}.json"
        python_exe = EV_PYTHON
        package_path = LIVE_DIR / f"field_context_{stamp}.json"
        package_path.write_text(json.dumps(package), encoding='utf-8')
        command = [
            str(python_exe),
            str(ROOT / "synthetic" / "field_landmark_detect.py"),
            "--video",
            str(source),
            "--time",
            f"{frame_time_s:.6f}",
            "--out",
            str(output_path),
            "--max-width",
            "960",
            "--package", str(package_path),
        ]
        try:
            if MEDIA_RUNTIME is not None:
                output = MEDIA_RUNTIME.landmarks(source,frame_time_s,package)
                output_path.write_text(json.dumps(output,indent=2),encoding='utf-8')
                output['_debug'] = {'output_path':str(output_path),'stdout':''}
                json_response(self,200,output)
                return
            completed = subprocess.run(command, cwd=ROOT, stdin=subprocess.DEVNULL, text=True, capture_output=True, timeout=60, check=False)
            if completed.returncode != 0:
                json_response(
                    self,
                    500,
                    {
                        "error": "landmark suggestion failed",
                        "stdout": completed.stdout[-3000:],
                        "stderr": completed.stderr[-3000:],
                    },
                )
                return
            output = json.loads(output_path.read_text(encoding="utf-8"))
            output["_debug"] = {"output_path": str(output_path), "stdout": completed.stdout[-2000:]}
            json_response(self, 200, output)
        except subprocess.TimeoutExpired:
            json_response(self, 504, {"error": "landmark suggestion timed out"})
        except Exception as exc:
            json_response(self, 500, {"error": str(exc)})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"/static/js/workflow-help.js", "/static/js/tagging-fullscreen.js"}:
            help_path = Path(__file__).resolve().parent.parent / "static" / "js" / Path(parsed.path).name
            body = help_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == '/api/gameframe/ev-video-status':
            try:
                hit_id = int(parse_qs(parsed.query).get('id',['0'])[0])
                status = background_videos().status(hit_id)
                json_response(self,200 if status else 404,status or {'error':'Saved hit not found.'})
            except (ValueError,TypeError) as error:json_response(self,400,{'error':str(error)})
            return
        if parsed.path == "/api/gameframe/options":
            try:
                with gameframe_conn() as conn:
                    json_response(self, 200, gameframe_options_payload(conn))
            except Exception as exc:
                json_response(self, 500, {"error": str(exc)})
            return
        if parsed.path == "/api/gameframe/ev-hits":
            try:
                with gameframe_conn() as conn:
                    ensure_gameframe_ev_schema(conn)
                    rows = conn.execute(
                        """
                        SELECT e.id, e.description, e.source_file_name, e.created_at,
                               e.best_exit_velocity_mph, e.best_launch_angle_deg, e.best_distance_ft,
                               e.clip_blob IS NOT NULL AS has_source_clip,
                               e.generated_clip_blob IS NOT NULL AS has_generated_clip,
                               t.name AS team_name, h.name AS hitter_name
                        FROM ev_hit_tracks e
                        LEFT JOIN hitters h ON h.id = e.hitter_id
                        LEFT JOIN teams t ON t.id = e.team_id
                        ORDER BY e.created_at DESC, e.id DESC
                        LIMIT 100
                        """
                    ).fetchall()
                json_response(self, 200, {"hits": [dict(row) for row in rows]})
            except Exception as exc:
                json_response(self, 500, {"error": str(exc)})
            return
        if parsed.path == "/api/gameframe/ev-clip":
            try:
                query = parse_qs(parsed.query)
                hit_id = int(query.get("id", ["0"])[0] or 0)
                clip_kind = str(query.get("kind", query.get("type", ["source"]))[0] or "source").lower()
                inline = str(query.get("inline", ["0"])[0]).lower() in {"1", "true", "yes"}
                with gameframe_conn() as conn:
                    row = conn.execute(
                        """
                        SELECT source_file_name, clip_mime_type, clip_blob,
                               generated_clip_mime_type, generated_clip_blob
                        FROM ev_hit_tracks
                        WHERE id=?
                        """,
                        (hit_id,),
                    ).fetchone()
                if not row:
                    json_response(self, 404, {"error": "saved EV clip not found"})
                    return
                if clip_kind in {"generated", "replay", "final"}:
                    data = row["generated_clip_blob"]
                    mime_type = row["generated_clip_mime_type"] or "video/mp4"
                    suffix = "generated"
                else:
                    data = row["clip_blob"]
                    mime_type = row["clip_mime_type"] or "video/mp4"
                    suffix = "source-trim"
                if data is None:
                    json_response(self, 404, {"error": f"saved EV {suffix} clip not found"})
                    return
                name = safe_stem(row["source_file_name"] or f"ev-hit-{hit_id}") + f"-ev-track-{hit_id}-{suffix}.mp4"
                self.send_response(200)
                self.send_header("Content-Type", mime_type)
                disposition = "inline" if inline else "attachment"
                self.send_header("Content-Disposition", f'{disposition}; filename="{name}"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as exc:
                json_response(self, 500, {"error": str(exc)})
            return
        if parsed.path == "/api/gameframe/ev-hit":
            try:
                query = parse_qs(parsed.query)
                hit_id = int(query.get("id", ["0"])[0] or 0)
                with gameframe_conn() as conn:
                    row = conn.execute(
                        """
                        SELECT id, source_file_name, description,
                               source_video_path, observation_package_json, prediction_json,
                               clip_blob, generated_clip_blob
                        FROM ev_hit_tracks
                        WHERE id=?
                        """,
                        (hit_id,),
                    ).fetchone()
                if not row:
                    json_response(self, 404, {"error": "saved EV hit not found"})
                    return
                package = json.loads(row["observation_package_json"] or "{}")
                prediction = json.loads(row["prediction_json"] or "{}") if row["prediction_json"] else None
                json_response(
                    self,
                    200,
                    {
                        "id": row["id"],
                        "source_file_name": row["source_file_name"],
                        "source_video_path": row["source_video_path"],
                        "description": row["description"],
                        "package": package,
                        "prediction": prediction,
                        "source_clip_url": f"/api/gameframe/ev-clip?id={row['id']}&kind=source&inline=1" if row["clip_blob"] is not None else None,
                        "generated_clip_url": f"/api/gameframe/ev-clip?id={row['id']}&kind=generated&inline=1" if row["generated_clip_blob"] is not None else None,
                        "package_json_url": f"/api/gameframe/ev-json?id={row['id']}&kind=package",
                        "prediction_json_url": f"/api/gameframe/ev-json?id={row['id']}&kind=prediction" if row["prediction_json"] else None,
                    },
                )
            except Exception as exc:
                json_response(self, 500, {"error": str(exc)})
            return
        if parsed.path == "/api/gameframe/ev-json":
            try:
                query = parse_qs(parsed.query)
                hit_id = int(query.get("id", ["0"])[0] or 0)
                kind = str(query.get("kind", ["package"])[0] or "package").lower()
                with gameframe_conn() as conn:
                    row = conn.execute(
                        "SELECT source_file_name, observation_package_json, prediction_json FROM ev_hit_tracks WHERE id=?",
                        (hit_id,),
                    ).fetchone()
                if not row:
                    json_response(self, 404, {"error": "saved EV hit not found"})
                    return
                if kind == "prediction":
                    data = row["prediction_json"]
                    suffix = "prediction"
                else:
                    data = row["observation_package_json"]
                    suffix = "observation"
                if not data:
                    json_response(self, 404, {"error": f"saved EV {suffix} JSON not found"})
                    return
                name = safe_stem(row["source_file_name"] or f"ev-hit-{hit_id}") + f"-ev-{suffix}-{hit_id}.json"
                pretty = json.dumps(json.loads(data), indent=2)
                payload = pretty.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Disposition", f'attachment; filename="{name}"')
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except Exception as exc:
                json_response(self, 500, {"error": str(exc)})
            return
        if parsed.path == "/api/clip/status":
            job_id = parse_qs(parsed.query).get("id", [""])[0]
            with JOBS_LOCK:
                job = dict(JOBS.get(job_id) or {})
            if not job:
                json_response(self, 404, {"error": "job not found"})
            else:
                json_response(self, 200, job)
            return
        if parsed.path == "/api/clip/download":
            job_id = parse_qs(parsed.query).get("id", [""])[0]
            with JOBS_LOCK:
                job = dict(JOBS.get(job_id) or {})
            path = Path(job.get("output_path") or "")
            if job.get("status") != "done" or not path.exists():
                json_response(self, 404, {"error": "clip not ready"})
                return
            data = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "video/mp4")
            self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            try:
                path.unlink(missing_ok=True)
                with JOBS_LOCK:
                    if job_id in JOBS:
                        JOBS[job_id]["downloaded_at"] = time.time()
                        JOBS[job_id]["output_path"] = ""
                        JOBS[job_id]["message"] = "clip downloaded and temporary file removed"
            except OSError:
                pass
            return
        super().do_GET()


if __name__ == "__main__":
    raise SystemExit("EV processing is part of GameFrame. Start the app with npm start from GameFrameJS.")
