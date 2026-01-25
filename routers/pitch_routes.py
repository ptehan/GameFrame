from fastapi import APIRouter, Request, Form, UploadFile, File, Response
from fastapi.responses import HTMLResponse, Response, RedirectResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from utils.db import db
import re
import tempfile
import io
import uuid
import os
from datetime import datetime
from PIL import Image
import cv2
import numpy as np

router = APIRouter()
templates = Jinja2Templates("templates")

TEMP_DIR = tempfile.gettempdir()

def temp_path(id):
    return os.path.join(TEMP_DIR, f"gf_{id}.mp4")

def serve_thumbnail(blob):
    return StreamingResponse(
        io.BytesIO(blob),
        media_type="image/jpeg"
    )

# ------------------------------------------------------------
# GET /thumbnail/pitch
# ------------------------------------------------------------
@router.get("/thumbnail/pitch")
def thumbnail_pitch(id: int):
    conn = db()
    row = conn.execute("SELECT thumb FROM pitch_clips WHERE id=?", (id,)).fetchone()
    conn.close()

    if not row or not row[0]:
        return HTMLResponse("not found", status_code=404)

    return serve_thumbnail(row[0])

# ------------------------------------------------------------
# GET /play/pitch
# ------------------------------------------------------------
@router.get("/play/pitch", response_class=HTMLResponse)
def play_pitch(request: Request, id: int, sid: str = "x"):
    return templates.TemplateResponse(
        "play_pitch.html",
        {"request": request, "sid": sid, "id": id}
    )

# ------------------------------------------------------------
# GET /stream/pitch (RANGE)
# ------------------------------------------------------------
@router.get("/stream/pitch")
def stream_pitch(request: Request, id: int):
    conn = db()
    row = conn.execute("SELECT clip_blob FROM pitch_clips WHERE id=?", (id,)).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    blob = row[0]
    size = len(blob)
    range_header = request.headers.get("range")

    if not range_header:
        return Response(
            content=blob,
            headers={
                "Content-Type": "video/mp4",
                "Accept-Ranges": "bytes",
                "Content-Length": str(size),
            },
        )

    match = re.match(r"bytes=(\d+)-(\d*)", range_header)
    start = int(match.group(1))
    end = size - 1 if match.group(2) == "" else int(match.group(2))

    if start >= size:
        return Response(status_code=416)

    chunk = blob[start:end + 1]

    return Response(
        content=chunk,
        status_code=206,
        headers={
            "Content-Type": "video/mp4",
            "Content-Range": f"bytes {start}-{end}/{size}",
            "Content-Length": str(len(chunk)),
            "Accept-Ranges": "bytes",
        },
    )

# ------------------------------------------------------------
# GET /stream/pitch_clip
# ------------------------------------------------------------
@router.get("/stream/pitch_clip")
def stream_pitch_clip(id: int):
    conn = db()
    row = conn.execute("SELECT clip_blob FROM pitch_clips WHERE id=?", (id,)).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    return Response(content=row[0], media_type="video/mp4")

# ------------------------------------------------------------
# POST /library/pitch/delete
# ------------------------------------------------------------
@router.post("/library/pitch/delete")
def delete_pitch_clip(id: int = Form(...), sid: str = Form("x")):
    conn = db()
    conn.execute("DELETE FROM pitch_clips WHERE id=?", (id,))
    conn.commit()
    conn.close()
    return RedirectResponse(f"/library?sid={sid}&type=pitch", status_code=303)

# ------------------------------------------------------------
# GET /upload/pitch
# ------------------------------------------------------------
@router.get("/upload/pitch", response_class=HTMLResponse)
def upload_pitch_page(request: Request, sid: str = "x"):
    conn = db()
    teams = conn.execute("SELECT id, name FROM teams ORDER BY name").fetchall()
    pitchers = conn.execute("SELECT id, name, team_id FROM pitchers ORDER BY name").fetchall()
    conn.close()

    return templates.TemplateResponse(
        "upload_pitch.html",
        {"request": request, "sid": sid, "teams": teams, "pitchers": pitchers},
    )

# ------------------------------------------------------------
# POST /upload/pitch  (store temp)
# ------------------------------------------------------------
@router.post("/upload/pitch")
async def upload_pitch(
    sid: str = Form("x"),
    team_id: int = Form(...),
    pitcher_id: int = Form(...),
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
        f"/upload/pitch/trim?sid={sid}&temp_id={temp_id}&team_id={team_id}"
        f"&pitcher_id={pitcher_id}&description={description}",
        status_code=303,
    )


# ------------------------------------------------------------
# GET /upload/pitch/trim
# ------------------------------------------------------------
@router.get("/upload/pitch/trim", response_class=HTMLResponse)
def pitch_trim_page(
    request: Request,
    sid: str,
    temp_id: str,
    team_id: int,
    pitcher_id: int,
    description: str
):
    return templates.TemplateResponse(
        "upload_pitch_trim.html",
        {
            "request": request,
            "sid": sid,
            "temp_id": temp_id,
            "team_id": team_id,
            "pitcher_id": pitcher_id,
            "description": description,
        },
    )

# ------------------------------------------------------------
# POST /upload/pitch/finalize   (NOW STORES THUMBNAIL)
# ------------------------------------------------------------
@router.post("/upload/pitch/finalize")
async def finalize_pitch(
    sid: str = Form(...),
    team_id: int = Form(...),
    pitcher_id: int = Form(...),
    description: str = Form(""),
    fps: float = Form(...),
    file: UploadFile = File(...)
):
    blob = await file.read()

    # ---- generate thumbnail from last frame ----
    # Write temp to disk
    tmp_path = os.path.join(TEMP_DIR, f"thumb_{uuid.uuid4()}.mp4")
    with open(tmp_path, "wb") as f:
        f.write(blob)

    # Extract last frame using cv2
    cap = cv2.VideoCapture(tmp_path)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_count - 1))
    ok, frame = cap.read()
    cap.release()

    if ok:
        # Convert to JPEG bytes
        _, jpg = cv2.imencode(".jpg", frame)
        thumb_blob = jpg.tobytes()
    else:
        thumb_blob = None

    if os.path.exists(tmp_path):
        os.remove(tmp_path)

    conn = db()
    conn.execute(
        "INSERT INTO pitch_clips (team_id, pitcher_id, description, clip_blob, thumb, fps, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (team_id, pitcher_id, description, blob, thumb_blob, fps, datetime.now())
    )
    conn.commit()
    conn.close()

    return RedirectResponse(f"/library?sid={sid}&type=pitch", status_code=303)

# ------------------------------------------------------------
# GET /raw/pitch
# ------------------------------------------------------------
@router.get("/raw/pitch")
def raw_pitch(id: str):
    path = temp_path(id)
    if not os.path.exists(path):
        return Response(status_code=404)
    with open(path, "rb") as f:
        return Response(f.read(), media_type="video/mp4")
