from fastapi import APIRouter, Request, Form, UploadFile, File
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from utils.db import db
import uuid
import cv2
import os
import tempfile
import subprocess
import imageio_ffmpeg as ffmpeg
from datetime import datetime

router = APIRouter()
templates = Jinja2Templates("templates")

TEMP_DIR = tempfile.gettempdir()

def temp_path(id):
    return os.path.join(TEMP_DIR, f"gf_{id}.mp4")


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
# POST /upload/swing
# -------------------------------------------------------
@router.post("/upload/swing")
async def upload_swing(
    sid: str = Form("x"),
    team_id: int = Form(...),
    hitter_id: int = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...)
):
    temp_id = str(uuid.uuid4())
    path = temp_path(temp_id)

    with open(path, "wb") as f:
        f.write(await file.read())

    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    if fps == 0 or total == 0:
        if os.path.exists(path):
            os.remove(path)
        return HTMLResponse("ERROR: corrupted or invalid video", status_code=400)

    return RedirectResponse(
        f"/upload/swing/trim?sid={sid}&temp_id={temp_id}&team_id={team_id}"
        f"&hitter_id={hitter_id}&description={description}&fps={fps}&total={total}",
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
    fps: str,
    total: int
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
# POST /upload/swing/finalize
# -------------------------------------------------------
@router.post("/upload/swing/finalize")
def finalize_swing(
    sid: str = Form(...),
    temp_id: str = Form(...),
    team_id: int = Form(...),
    hitter_id: int = Form(...),
    description: str = Form(""),
    fps: float = Form(...),
    start_frame: int = Form(...),
    decision_frame: int = Form(...),
    contact_frame: int = Form(...)
):
    path = temp_path(temp_id)

    try:
        fps = float(fps)
    except:
        fps = 30.0

    # ------------------------------------------------------------
    # EXACT FRAME EXTRACTION (no decode drift)
    # ------------------------------------------------------------
    cap = cv2.VideoCapture(path)
    frames = []

    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    for i in range(start_frame, contact_frame + 1):
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)

    cap.release()

    if not frames:
        return HTMLResponse("ERROR: no frames extracted", status_code=500)

    decision_relative = max(0, decision_frame - start_frame)

    # ------------------------------------------------------------
    # FRAME-PERFECT MP4 EXPORT (H.264 ALL-INTRA)
    # ------------------------------------------------------------
    temp_raw = "swing_raw.yuv"
    temp_out = "swing_out.mp4"

    h, w, _ = frames[0].shape

    with open(temp_raw, "wb") as f:
        for fr in frames:
            f.write(fr.tobytes())

    exe = ffmpeg.get_ffmpeg_exe()

    cmd = [
        exe, "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{w}x{h}",
        "-r", str(fps),
        "-i", temp_raw,

        # H.264 ALL-INTRA:
        "-vcodec", "libx264",
        "-preset", "fast",
        "-crf", "17",
        "-pix_fmt", "yuv420p",

        # FORCE EACH FRAME TO BE A KEYFRAME
        "-g", "1",
        "-keyint_min", "1",
        "-sc_threshold", "0",
        "-x264opts", "no-scenecut",

        "-movflags", "+faststart",
        temp_out,
    ]

    subprocess.run(cmd, check=True)

    # load encoded file
    with open(temp_out, "rb") as f:
        blob = f.read()

    # cleanup temp files
    for p in [temp_raw, temp_out, path]:
        if os.path.exists(p):
            try:
                os.remove(p)
            except:
                pass

    # ------------------------------------------------------------
    # DB INSERT
    # ------------------------------------------------------------
    conn = db()
    conn.execute(
        "INSERT INTO swing_clips (team_id, hitter_id, description, clip_blob, fps, decision_frame, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (team_id, hitter_id, description, blob, fps, decision_relative, datetime.now())
    )
    conn.commit()
    conn.close()

    return RedirectResponse(f"/library/swing?sid={sid}", status_code=303)
