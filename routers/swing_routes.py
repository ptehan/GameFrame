from fastapi import APIRouter, Request, Form, UploadFile, File
from fastapi.responses import HTMLResponse, Response, RedirectResponse, StreamingResponse, FileResponse
from fastapi.templating import Jinja2Templates
from utils.db import db
import re
import tempfile
import io
import os
import subprocess
import imageio_ffmpeg as ffmpeg
import uuid
import cv2

from datetime import datetime

router = APIRouter()
templates = Jinja2Templates("templates")

TEMP_DIR = tempfile.gettempdir()

def temp_path(id):
    return os.path.join(TEMP_DIR, f"gf_{id}.mp4")

def serve_thumbnail(blob):
    return StreamingResponse(io.BytesIO(blob), media_type="image/jpeg")


# ------------------------------------------------------------
# GET /thumbnail/swing
# ------------------------------------------------------------
@router.get("/thumbnail/swing")
def thumbnail_swing(id: int):
    conn = db()
    row = conn.execute("SELECT thumb FROM swing_clips WHERE id=?", (id,)).fetchone()
    conn.close()

    if not row or not row[0]:
        return HTMLResponse("not found", status_code=404)

    return serve_thumbnail(row[0])


# ------------------------------------------------------------
# GET /play/swing
# ------------------------------------------------------------
@router.get("/play/swing", response_class=HTMLResponse)
def play_swing(request: Request, id: int, sid: str = "x"):
    return templates.TemplateResponse(
        "play_swing.html",
        {"request": request, "sid": sid, "id": id}
    )


# ------------------------------------------------------------
# GET /stream/swing (Range streamer)
# ------------------------------------------------------------
@router.get("/stream/swing")
def stream_swing(request: Request, id: int):
    conn = db()
    row = conn.execute("SELECT clip_blob FROM swing_clips WHERE id=?", (id,)).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", 404)

    blob = row[0]
    size = len(blob)

    range_header = request.headers.get("range")
    if not range_header:
        return Response(
            content=blob,
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": str(size),
                "Accept-Ranges": "bytes",
            }
        )

    match = re.match(r"bytes=(\d+)-(\d*)", range_header)
    start = int(match.group(1))
    end = size - 1 if match.group(2) == "" else int(match.group(2))

    if start >= size:
        return Response(status_code=416)

    chunk = blob[start:end+1]

    return Response(
        content=chunk,
        status_code=206,
        headers={
            "Content-Type": "video/mp4",
            "Content-Range": f"bytes {start}-{end}/{size}",
            "Content-Length": str(len(chunk)),
            "Accept-Ranges": "bytes",
        }
    )


# ------------------------------------------------------------
# GET /stream/swing_clip
# ------------------------------------------------------------
@router.get("/stream/swing_clip")
def stream_swing_clip(id: int):
    conn = db()
    row = conn.execute("SELECT clip_blob FROM swing_clips WHERE id=?", (id,)).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", 404)

    return Response(
        content=row[0],
        media_type="video/mp4",
        headers={"Accept-Ranges": "bytes"}
    )


# ------------------------------------------------------------
# POST /upload/swing/finalize   <-- THUMBNAIL ADDED
# ------------------------------------------------------------
@router.post("/upload/swing/finalize")
async def finalize_swing(
    sid: str = Form("x"),
    team_id: int = Form(...),
    hitter_id: int = Form(...),
    description: str = Form(""),
    decision_frame: int = Form(...),
    file: UploadFile = File(...)
):

    blob = await file.read()

    # ---- generate thumbnail from last frame ----
    tmp_path = os.path.join(TEMP_DIR, f"thumb_{uuid.uuid4()}.mp4")
    with open(tmp_path, "wb") as f:
        f.write(blob)

    cap = cv2.VideoCapture(tmp_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, total_frames - 1))
    ok, frame = cap.read()
    cap.release()

    if ok:
        _, jpg = cv2.imencode(".jpg", frame)
        thumb_blob = jpg.tobytes()
    else:
        thumb_blob = None

    if os.path.exists(tmp_path):
        os.remove(tmp_path)

    conn = db()
    conn.execute("""
        INSERT INTO swing_clips
        (team_id, hitter_id, description, decision_frame, clip_blob, thumb, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    """, (
        team_id,
        hitter_id,
        description,
        decision_frame,
        blob,
        thumb_blob,
    ))
    conn.commit()
    conn.close()

    return RedirectResponse(f"/library?sid={sid}", status_code=303)


# -------------------------------------------------------
# GET /upload/swing
# -------------------------------------------------------
@router.get("/upload/swing", response_class=HTMLResponse)
def upload_swing_page(request: Request, sid: str = "x"):
    conn = db()
    teams = conn.execute("SELECT id, name FROM teams ORDER BY name").fetchall()
    hitters = conn.execute("SELECT id, name, team_id FROM hitters ORDER BY name").fetchall()
    conn.close()

    return templates.TemplateResponse(
        "upload_swing.html",
        {"request": request, "sid": sid, "teams": teams, "hitters": hitters},
    )


# -------------------------------------------------------
# POST /upload/swing (initial upload)
# -------------------------------------------------------
@router.post("/upload/swing")
async def upload_swing(
    sid: str = Form("x"),
    team_id: int = Form(...),
    hitter_id: int = Form(...),
    description: str = Form(""),
    start_min: int = Form(0),
    start_sec: int = Form(0),
    file: UploadFile = File(...)
):
    temp_id = str(uuid.uuid4())

    # save original upload
    orig_path = temp_path(temp_id + "_orig")
    with open(orig_path, "wb") as f:
        f.write(await file.read())

    # compute start time
    start_time = start_min * 60 + start_sec

    # final trimmed path (this is what the app uses)
    trimmed_path = temp_path(temp_id)

    # trim to 5 seconds using ffmpeg
    cmd = (
        f'ffmpeg -y '
        f'-ss {start_time} '
        f'-i "{orig_path}" '
        f'-t 5 '
        f'-c:v libx264 -preset veryfast -crf 23 '
        f'-an '
        f'"{trimmed_path}"'
    )
    os.system(cmd)

    # cleanup big file
    if os.path.exists(orig_path):
        os.remove(orig_path)

    return RedirectResponse(
        f"/upload/swing/trim?sid={sid}&temp_id={temp_id}&team_id={team_id}"
        f"&hitter_id={hitter_id}&description={description}",
        status_code=303,
    )



# -------------------------------------------------------
# GET /upload/swing/trim
# -------------------------------------------------------
@router.get("/upload/swing/trim", response_class=HTMLResponse)
def swing_trim_page(
    request: Request,
    sid: str,
    temp_id: str,
    team_id: int,
    hitter_id: int,
    description: str,
    fps: float = 0.0,
    total: int = 0
):
    return templates.TemplateResponse(
        "upload_swing_trim.html",
        {
            "request": request,
            "sid": sid,
            "temp_id": temp_id,
            "team_id": team_id,
            "hitter_id": hitter_id,
            "description": description,
            "fps": fps,
            "total": total,
        },
    )


# -------------------------------------------------------
# GET /raw/swing
# -------------------------------------------------------
@router.get("/raw/swing")
def raw_swing(id: str):
    path = temp_path(id)
    if not os.path.exists(path):
        return HTMLResponse("not found", status_code=404)
    return FileResponse(path, media_type="video/mp4")


# ------------------------------------------------------------
# POST /library/swing/delete
# ------------------------------------------------------------
@router.post("/library/swing/delete")
def delete_swing_clip(
    id: int = Form(...),
    sid: str = Form(...)
):
    conn = db()
    conn.execute("DELETE FROM swing_clips WHERE id=?", (id,))
    conn.commit()
    conn.close()

    return RedirectResponse(f"/library?sid={sid}&type=swing", status_code=303)
