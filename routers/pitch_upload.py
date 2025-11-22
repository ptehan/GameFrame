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
# GET /upload/pitch
# -------------------------------------------------------
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


# -------------------------------------------------------
# POST /upload/pitch  (upload file)
# -------------------------------------------------------
@router.post("/upload/pitch")
async def upload_pitch(
    sid: str = Form("x"),
    team_id: int = Form(...),
    pitcher_id: int = Form(...),
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
        f"/upload/pitch/trim?sid={sid}&temp_id={temp_id}&team_id={team_id}"
        f"&pitcher_id={pitcher_id}&description={description}&fps={fps}&total={total}",
        status_code=303,
    )


# -------------------------------------------------------
# GET /upload/pitch/trim
# -------------------------------------------------------
@router.get("/upload/pitch/trim", response_class=HTMLResponse)
def pitch_trim_page(
    request: Request,
    sid: str,
    temp_id: str,
    team_id: int,
    pitcher_id: int,
    description: str,
    fps: str,
    total: int
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
            "fps": fps,
            "total": total,
        },
    )


# -------------------------------------------------------
# POST /upload/pitch/finalize
# -------------------------------------------------------
@router.post("/upload/pitch/finalize")
def finalize_pitch(
    sid: str = Form(...),
    temp_id: str = Form(...),
    team_id: int = Form(...),
    pitcher_id: int = Form(...),
    description: str = Form(""),
    contact_frame: int = Form(...),
    fps: float = Form(...)
):
    path = temp_path(temp_id)

    try:
        fps = float(fps)
    except:
        fps = 30.0

    # 2 seconds before contact
    start_frame = max(0, int(contact_frame - 2 * fps))
    end_frame   = int(contact_frame)

    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # ------------------------------------------------------------
    # EXACT frame extraction (no decode drift)
    # ------------------------------------------------------------
    frames = []
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    for i in range(start_frame, end_frame + 1):
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)

    cap.release()

    if not frames:
        return HTMLResponse("ERROR: frame extraction failed", status_code=500)

    # ------------------------------------------------------------
    # FRAME-PERFECT MP4 EXPORT (H.264 ALL-INTRA)
    # ------------------------------------------------------------
    temp_raw = "pitch_raw.yuv"
    temp_out = "pitch_out.mp4"

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

        # H.264 ALL INTRA (every frame is a keyframe)
        "-vcodec", "libx264",
        "-preset", "fast",
        "-crf", "17",
        "-pix_fmt", "yuv420p",

        # force I-frame only
        "-g", "1",
        "-keyint_min", "1",
        "-sc_threshold", "0",
        "-x264opts", "no-scenecut",

        "-movflags", "+faststart",
        temp_out,
    ]

    subprocess.run(cmd, check=True)

    # read output
    with open(temp_out, "rb") as f:
        blob = f.read()

    # cleanup
    for p in [temp_raw, temp_out, path]:
        if os.path.exists(p):
            try:
                os.remove(p)
            except:
                pass

    # ------------------------------------------------------------
    # STORE TO DB
    # ------------------------------------------------------------
    conn = db()
    conn.execute(
        "INSERT INTO pitch_clips (team_id, pitcher_id, description, clip_blob, fps, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (team_id, pitcher_id, description, blob, fps, datetime.now())
    )
    conn.commit()
    conn.close()

    return RedirectResponse(f"/library/pitch?sid={sid}", status_code=303)
