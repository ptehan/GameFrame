from fastapi import FastAPI, Request, Form, UploadFile, File, Response
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import sqlite3
import uuid
import imageio_ffmpeg as ffmpeg
import tempfile
import os
import io
import subprocess
import shutil
import cv2
import numpy as np
import base64
import re
from typing import Optional
from datetime import datetime
from pathlib import Path

DB_PATH = "app.db"
TEMP_DIR = tempfile.gettempdir()

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


# ============================================================
# START SECTION: DATABASE CONNECTION
# ============================================================
def db():
    return sqlite3.connect(DB_PATH, check_same_thread=False)
# ============================================================
# END SECTION: DATABASE CONNECTION
# ============================================================



# ============================================================
# START ENDPOINT: INDEX PAGE (GET /)
# ============================================================
@app.get("/", response_class=HTMLResponse)
def index(request: Request, sid: str = "x"):
    return templates.TemplateResponse("index.html", {"request": request, "sid": sid})
# ============================================================
# END ENDPOINT: INDEX PAGE
# ============================================================



# ============================================================
# START SECTION: MANAGE TEAMS
# ============================================================

# ---------- GET /teams ----------
@app.get("/teams", response_class=HTMLResponse)
def teams_page(request: Request, sid: str = "x"):
    conn = db()
    rows = conn.execute("SELECT id, name, description FROM teams ORDER BY name").fetchall()
    conn.close()
    return templates.TemplateResponse(
        "manage_entities.html",
        {"request": request, "sid": sid, "view": "teams", "items": rows},
    )

# ---------- POST /teams/add ----------
@app.post("/teams/add")
def teams_add(name: str = Form(...), description: str = Form(""), sid: str = Form("x")):
    conn = db()
    conn.execute("INSERT INTO teams (name, description) VALUES (?, ?)", (name, description))
    conn.commit()
    conn.close()
    return RedirectResponse(f"/teams?sid={sid}", status_code=303)

# ---------- POST /teams/delete ----------
@app.post("/teams/delete")
def teams_del(item_id: int = Form(...), sid: str = Form("x")):
    conn = db()
    conn.execute("DELETE FROM teams WHERE id=?", (item_id,))
    conn.commit()
    conn.close()
    return RedirectResponse(f"/teams?sid={sid}", status_code=303)

# ============================================================
# END SECTION: MANAGE TEAMS
# ============================================================



# ============================================================
# START SECTION: MANAGE PITCHERS
# ============================================================

# ---------- GET /pitchers ----------
@app.get("/pitchers", response_class=HTMLResponse)
def pitchers_page(request: Request, sid: str = "x"):
    conn = db()
    rows = conn.execute("SELECT id, name, description, team_id FROM pitchers ORDER BY name").fetchall()
    teams = conn.execute("SELECT id, name FROM teams ORDER BY name").fetchall()
    conn.close()
    return templates.TemplateResponse(
        "manage_entities.html",
        {"request": request, "sid": sid, "view": "pitchers", "items": rows, "teams": teams},
    )

# ---------- POST /pitchers/add ----------
@app.post("/pitchers/add")
def pitchers_add(
    name: str = Form(...),
    description: str = Form(""),
    team_id: int = Form(...),
    sid: str = Form("x"),
):
    conn = db()
    conn.execute("INSERT INTO pitchers (name, description, team_id) VALUES (?, ?, ?)",
                 (name, description, team_id))
    conn.commit()
    conn.close()
    return RedirectResponse(f"/pitchers?sid={sid}", status_code=303)

# ---------- POST /pitchers/delete ----------
@app.post("/pitchers/delete")
def pitchers_del(item_id: int = Form(...), sid: str = Form("x")):
    conn = db()
    conn.execute("DELETE FROM pitchers WHERE id=?", (item_id,))
    conn.commit()
    conn.close()
    return RedirectResponse(f"/pitchers?sid={sid}", status_code=303)

# ============================================================
# END SECTION: MANAGE PITCHERS
# ============================================================



# ============================================================
# START SECTION: MANAGE HITTERS
# ============================================================

# ---------- GET /hitters ----------
@app.get("/hitters", response_class=HTMLResponse)
def hitters_page(request: Request, sid: str = "x"):
    conn = db()
    rows = conn.execute("SELECT id, name, description, team_id FROM hitters ORDER BY name").fetchall()
    teams = conn.execute("SELECT id, name FROM teams ORDER BY name").fetchall()
    conn.close()
    return templates.TemplateResponse(
        "manage_entities.html",
        {"request": request, "sid": sid, "view": "hitters", "items": rows, "teams": teams},
    )

# ---------- POST /hitters/add ----------
@app.post("/hitters/add")
def hitters_add(
    name: str = Form(...),
    description: str = Form(""),
    team_id: int = Form(...),
    sid: str = Form("x"),
):
    conn = db()
    conn.execute("INSERT INTO hitters (name, description, team_id) VALUES (?, ?, ?)",
                 (name, description, team_id))
    conn.commit()
    conn.close()
    return RedirectResponse(f"/hitters?sid={sid}", status_code=303)

# ---------- POST /hitters/delete ----------
@app.post("/hitters/delete")
def hitters_del(item_id: int = Form(...), sid: str = Form("x")):
    conn = db()
    conn.execute("DELETE FROM hitters WHERE id=?", (item_id,))
    conn.commit()
    conn.close()
    return RedirectResponse(f"/hitters?sid={sid}", status_code=303)

# ============================================================
# END SECTION: MANAGE HITTERS
# ============================================================



# ============================================================
# START SECTION: PITCH UPLOAD WORKFLOW
# ============================================================

def temp_path(id):
    return os.path.join(TEMP_DIR, f"gf_{id}.mp4")


# ---------- GET /upload/pitch ----------
@app.get("/upload/pitch", response_class=HTMLResponse)
def upload_pitch_page(request: Request, sid: str = "x"):
    conn = db()
    teams = conn.execute("SELECT id, name FROM teams ORDER BY name").fetchall()
    pitchers = conn.execute("SELECT id, name, team_id FROM pitchers ORDER BY name").fetchall()
    conn.close()
    return templates.TemplateResponse(
        "upload_pitch.html",
        {"request": request, "sid": sid, "teams": teams, "pitchers": pitchers},
    )


# ---------- POST /upload/pitch ----------
@app.post("/upload/pitch")
async def upload_pitch(
    sid: str = Form("x"),
    team_id: int = Form(...),
    pitcher_id: int = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...),
):
    temp_id = str(uuid.uuid4())
    path = temp_path(temp_id)

    with open(path, "wb") as f:
        f.write(await file.read())

    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    # ---- FIX: reject corrupted uploads (moov atom missing, fps=0, total=0)
    if fps == 0 or total == 0:
        if os.path.exists(path):
            os.remove(path)
        return HTMLResponse(
            "ERROR: Invalid or corrupted MP4 file. Re-export the video and try again.",
            status_code=400
        )


    return RedirectResponse(
        f"/upload/pitch/trim?sid={sid}&temp_id={temp_id}&team_id={team_id}"
        f"&pitcher_id={pitcher_id}&description={description}&fps={fps}&total={total}",
        status_code=303,
    )


# ---------- GET /upload/pitch/trim ----------
@app.get("/upload/pitch/trim", response_class=HTMLResponse)
def pitch_trim_page(
    request: Request,
    sid: str,
    temp_id: str,
    team_id: int,
    pitcher_id: int,
    description: str,
    fps: str,
    total: int,
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


# ---------- POST /upload/pitch/finalize ----------
@app.post("/upload/swing/finalize")
def finalize_swing(
    request: Request,
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
    print("DEBUG >>> FINALIZE_SWING CALLED")
    print("DEBUG >>> temp_id:", temp_id)
    print("DEBUG >>> team_id:", team_id)
    print("DEBUG >>> hitter_id:", hitter_id)
    print("DEBUG >>> fps (raw):", fps)
    print("DEBUG >>> start_frame:", start_frame)
    print("DEBUG >>> decision_frame:", decision_frame)
    print("DEBUG >>> contact_frame:", contact_frame)

    # ---- TEMP FILE PATH ----
    temp_path = os.path.join(tempfile.gettempdir(), f"gf_{temp_id}.mp4")
    print("DEBUG >>> temp path:", temp_path)

    if not os.path.exists(temp_path):
        print("ERROR >>> temp file missing")
        return HTMLResponse("Temp file missing", status_code=500)

    # ---- LOAD FULL VIDEO ----
    cap = cv2.VideoCapture(temp_path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print("DEBUG >>> source frame count:", total)

    # clamp window
    start_frame = max(0, min(start_frame, total - 1))
    contact_frame = max(0, min(contact_frame, total - 1))

    if contact_frame < start_frame:
        contact_frame = start_frame

    print(f"DEBUG >>> EXACT frames extracted: {start_frame} to {contact_frame}, "
          f"count={contact_frame - start_frame + 1}")

    # ---- EXTRACT FRAMES ----
    frames = []
    for f in range(start_frame, contact_frame + 1):
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, frame = cap.read()
        if not ok:
            print("WARN >>> failed to read frame", f)
            break
        frames.append(frame)
    cap.release()

    if not frames:
        print("ERROR >>> no frames extracted")
        return HTMLResponse("Extraction error", status_code=500)

    # ---- WRITE RAW YUV ----
    raw_path = "temp_raw.yuv"
    print("DEBUG >>> writing raw frames to:", raw_path)

    h, w, _ = frames[0].shape
    with open(raw_path, "wb") as f:
        for fr in frames:
            bgr = fr.astype(np.uint8).tobytes()
            f.write(bgr)

    # ---- ENCODE MP4 ----
    out_path = "temp_out.mp4"
    ff = ffmpeg.get_ffmpeg_exe()
    print("DEBUG >>> ffmpeg exe:", ff)

    cmd = [
        ff, "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{w}x{h}",
        "-r", str(fps),
        "-i", raw_path,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        out_path
    ]

    print("DEBUG >>> running ffmpeg command:")
    print(" ".join(cmd))

    proc = subprocess.run(cmd, capture_output=True, text=True)
    print(proc.stdout)
    print(proc.stderr)

    if not os.path.exists(out_path):
        print("ERROR >>> ffmpeg failed")
        return HTMLResponse("FFmpeg error", status_code=500)

    print("DEBUG >>> ffmpeg finished successfully")

    # ---- READ FINAL MP4 ----
    with open(out_path, "rb") as f:
        final_blob = f.read()

    # ---- CLEANUP ----
    try:
        os.remove(raw_path)
        os.remove(out_path)
    except:
        pass
    print("DEBUG >>> cleanup done")

    # ---- STORE TO DATABASE ----
    conn = sqlite3.connect("app.db")
    cur = conn.cursor()

    # Adjust decision frame RELATIVE to the trimmed clip
    decision_relative = max(0, decision_frame - start_frame)

    cur.execute("""
        INSERT INTO swing_clips (team_id, hitter_id, description,
                                 clip_blob, fps, decision_frame, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        team_id,
        hitter_id,
        description,
        final_blob,
        fps,
        decision_relative,
        datetime.now().isoformat()
    ))

    conn.commit()
    conn.close()

    print("DEBUG >>> DB write complete")

    # redirect to library
    return RedirectResponse(f"/library/swing?sid={sid}", status_code=303)

# ============================================================
# END SECTION: PITCH UPLOAD WORKFLOW
# ============================================================



# ============================================================
# START ENDPOINT: /frame (PREVIEW)
# ============================================================
@app.get("/frame")
def frame_endpoint(clip_type: str, id: str, frame: int):
    path = temp_path(id)
    if not os.path.exists(path):
        return HTMLResponse("missing temp file", status_code=404)

    cap = cv2.VideoCapture(path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame)
    ret, img = cap.read()
    cap.release()

    if not ret:
        return HTMLResponse("bad frame", status_code=404)

    ok, jpeg = cv2.imencode(".jpg", img)
    return StreamingResponse(io.BytesIO(jpeg.tobytes()), media_type="image/jpeg")
# ============================================================
# END ENDPOINT: /frame
# ============================================================



# ============================================================
# START SECTION: LIBRARY / PITCH CLIPS
# ============================================================

# ---------- GET /library/pitch ----------
@app.get("/library/pitch", response_class=HTMLResponse)
def library_pitch(
    request: Request, sid: str = "x", team_filter: str = "all", pitcher_filter: str = "all"
):
    conn = db()
    teams = conn.execute("SELECT id, name FROM teams ORDER BY name").fetchall()
    pitchers = conn.execute("SELECT id, name FROM pitchers ORDER BY name").fetchall()

    base = "SELECT id, team_id, pitcher_id, description, fps, created_at FROM pitch_clips"
    filters = []
    params = []

    if team_filter != "all":
        filters.append("team_id = ?")
        params.append(team_filter)

    if pitcher_filter != "all":
        filters.append("pitcher_id = ?")
        params.append(pitcher_filter)

    if filters:
        base += " WHERE " + " AND ".join(filters)

    base += " ORDER BY created_at DESC"

    clips = conn.execute(base, params).fetchall()
    conn.close()

    return templates.TemplateResponse(
        "library_pitch.html",
        {
            "request": request,
            "sid": sid,
            "teams": teams,
            "pitchers": pitchers,
            "team_filter": team_filter,
            "pitcher_filter": pitcher_filter,
            "clips": clips,
        },
    )

# ============================================================
# END SECTION: LIBRARY / PITCH CLIPS
# ============================================================



# ============================================================
# START ENDPOINT: /thumbnail/pitch
# ============================================================
@app.get("/thumbnail/pitch")
def thumbnail_pitch(id: int):
    conn = db()
    row = conn.execute("SELECT clip_blob FROM pitch_clips WHERE id=?", (id,)).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    blob = row[0]
    temp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    temp.write(blob)
    temp.close()

    cap = cv2.VideoCapture(temp.name)
    ret, frame = cap.read()
    cap.release()
    os.remove(temp.name)

    if not ret:
        return HTMLResponse("bad frame", status_code=500)

    ok, jpg = cv2.imencode(".jpg", frame)
    return StreamingResponse(io.BytesIO(jpg.tobytes()), media_type="image/jpeg")
# ============================================================
# END ENDPOINT: /thumbnail/pitch
# ============================================================



# ============================================================
# START ENDPOINT: play page (GET /play/pitch)
# ============================================================
@app.get("/play/pitch", response_class=HTMLResponse)
def play_pitch(request: Request, id: int, sid: str = "x"):
    return templates.TemplateResponse(
        "play_pitch.html", {"request": request, "sid": sid, "id": id}
    )
# ============================================================
# END ENDPOINT: /play/pitch
# ============================================================



# ============================================================
# START ENDPOINT: STREAM PITCH VIDEO (GET /stream/pitch)
# ============================================================
@app.get("/stream/pitch")
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
            status_code=200,
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": str(size),
                "Accept-Ranges": "bytes",
            },
        )

    match = re.match(r"bytes=(\d+)-(\d*)", range_header)
    if not match:
        return Response(
            content=blob,
            status_code=200,
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": str(size),
                "Accept-Ranges": "bytes",
            },
        )

    start = int(match.group(1))
    end = match.group(2)
    end = size - 1 if end == "" else int(end)

    if start > end or start >= size:
        return Response(status_code=416)

    chunk = blob[start : end + 1]

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
# ============================================================
# END ENDPOINT: STREAM PITCH VIDEO
# ============================================================

# ============================================================
# START ENDPOINT: DELETE PITCH CLIP
# ============================================================
@app.post("/pitch/delete")
def delete_pitch_clip(id: int = Form(...), sid: str = Form("x")):
    conn = db()
    conn.execute("DELETE FROM pitch_clips WHERE id=?", (id,))
    conn.commit()
    conn.close()
    return RedirectResponse(f"/library/pitch?sid={sid}", status_code=303)
# ============================================================
# END ENDPOINT: DELETE PITCH CLIP
# ============================================================# ============================================================
# START SECTION: SWING UPLOAD WORKFLOW
# ============================================================

@app.get("/upload/swing", response_class=HTMLResponse)
def upload_swing_page(request: Request, sid: str = "x"):
    conn = db()
    teams = conn.execute("SELECT id, name FROM teams ORDER BY name").fetchall()
    hitters = conn.execute("SELECT id, name, team_id FROM hitters ORDER BY name").fetchall()
    conn.close()
    return templates.TemplateResponse(
        "upload_swing.html",
        {"request": request, "sid": sid, "teams": teams, "hitters": hitters},
    )

@app.post("/upload/swing")
async def upload_swing(
    sid: str = Form("x"),
    team_id: int = Form(...),
    hitter_id: int = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...),
):
    temp_id = str(uuid.uuid4())
    path = temp_path(temp_id)

    with open(path, "wb") as f:
        f.write(await file.read())

    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    return RedirectResponse(
        f"/upload/swing/trim?sid={sid}&temp_id={temp_id}&team_id={team_id}"
        f"&hitter_id={hitter_id}&description={description}&fps={fps}&total={total}",
        status_code=303,
    )

@app.get("/upload/swing/trim", response_class=HTMLResponse)
def swing_trim_page(
    request: Request,
    sid: str,
    temp_id: str,
    team_id: int,
    hitter_id: int,
    description: str,
    fps: str,
    total: int,
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

@app.post("/upload/swing/finalize")
def finalize_swing(
    sid: str = Form("x"),
    temp_id: str = Form(...),
    team_id: int = Form(...),
    hitter_id: int = Form(...),
    description: str = Form(""),
    fps: float = Form(...),
    start_frame: int = Form(...),
    decision_frame: int = Form(...),
    contact_frame: int = Form(...),
):
    path = temp_path(temp_id)

    try:
        fps = float(fps)
    except:
        fps = 30.0

    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    frames = []
    for i in range(total):
        ret, frame = cap.read()
        if not ret:
            break
        if start_frame <= i <= contact_frame:
            frames.append(frame)

    cap.release()

    if not frames:
        return HTMLResponse("ERROR: extraction failed", status_code=500)

    # Rebase decision frame
    dec_rel = decision_frame - start_frame
    if dec_rel < 0:
        dec_rel = 0

    h, w, _ = frames[0].shape

    temp_raw = "temp_raw.yuv"
    temp_out = "temp_out.mp4"

    with open(temp_raw, "wb") as f:
        for fr in frames:
            f.write(fr.tobytes())

    ff = ffmpeg.get_ffmpeg_exe()
    cmd = [
        ff,
        "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{w}x{h}",
        "-r", str(fps),
        "-i", temp_raw,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        temp_out,
    ]

    try:
        subprocess.run(cmd, check=True)
    except:
        return HTMLResponse("encoding failed", status_code=500)

    with open(temp_out, "rb") as f:
        blob = f.read()

    if os.path.exists(temp_raw): os.remove(temp_raw)
    if os.path.exists(temp_out): os.remove(temp_out)
    if os.path.exists(path): os.remove(path)

    conn = db()
    conn.execute(
        "INSERT INTO swing_clips (team_id, hitter_id, description, clip_blob, fps, decision_frame, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (team_id, hitter_id, description, blob, fps, dec_rel, datetime.now()),
    )
    conn.commit()
    conn.close()

    return RedirectResponse(f"/library/swing?sid={sid}", status_code=303)

@app.post("/matchup/create")
def matchup_create(request: Request,
                   sid: str = Form(...),
                   pitch_id: int = Form(...),
                   swing_id: int = Form(...),
                   description: str = Form("")):

    print("DEBUG >>> MATCHUP CREATE CALLED")
    print("DEBUG >>> pitch_id:", pitch_id)
    print("DEBUG >>> swing_id:", swing_id)
    print("DEBUG >>> description:", description)

    # NEXT STEP: build the finalized matchup (video)
    return RedirectResponse(f"/matchup/build?sid={sid}&pitch_id={pitch_id}&swing_id={swing_id}&description={description}",
                            status_code=303)
# ============================================================
# START ENDPOINT: MATCHUP BUILD
# ============================================================
@app.get("/matchup/build")
def matchup_build(
    request: Request,
    sid: str,
    pitch_id: int,
    swing_id: int,
    description: str = "",
):
    import numpy as np
    import cv2
    import imageio_ffmpeg as ffmpeg
    import subprocess
    import tempfile
    import os
    from datetime import datetime

    print("DEBUG >>> MATCHUP BUILD START")
    print("DEBUG >>> pitch_id:", pitch_id)
    print("DEBUG >>> swing_id:", swing_id)

    conn = db()

    # ---- LOAD PITCH ----
    p_row = conn.execute(
        "SELECT clip_blob, fps FROM pitch_clips WHERE id=?", (pitch_id,)
    ).fetchone()

    if not p_row:
        return HTMLResponse("pitch not found", status_code=404)

    pitch_blob, pitch_fps = p_row

    # ---- LOAD SWING ----
    s_row = conn.execute(
        "SELECT clip_blob, fps, decision_frame FROM swing_clips WHERE id=?", (swing_id,)
    ).fetchone()

    if not s_row:
        return HTMLResponse("swing not found", status_code=404)

    swing_blob, swing_fps, decision_frame = s_row

    conn.close()

    # ---- fps selection ----
    fps = min(pitch_fps, swing_fps)
    print("DEBUG >>> final fps:", fps)

    # ---- Write temp files ----
    tmp_pitch = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
    tmp_swing = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name

    with open(tmp_pitch, "wb") as f:
        f.write(pitch_blob)
    with open(tmp_swing, "wb") as f:
        f.write(swing_blob)

    # ---- Load frames ----
    def load_frames(path):
        cap = cv2.VideoCapture(path)
        frames = []
        while True:
            ret, fr = cap.read()
            if not ret:
                break
            frames.append(fr)
        cap.release()
        return frames

    pitch_frames = load_frames(tmp_pitch)
    swing_frames = load_frames(tmp_swing)

    print("DEBUG >>> pitch frames:", len(pitch_frames))
    print("DEBUG >>> swing frames:", len(swing_frames))

    # ---- Letterbox to 640x720 ----
    def letterbox(frame, target_w=640, target_h=720):
        h, w = frame.shape[:2]
        scale = min(target_w / w, target_h / h)
        new_w = int(w * scale)
        new_h = int(h * scale)

        resized = cv2.resize(frame, (new_w, new_h))
        canvas = np.zeros((target_h, target_w, 3), dtype=np.uint8)

        y = (target_h - new_h) // 2
        x = (target_w - new_w) // 2
        canvas[y:y+new_h, x:x+new_w] = resized
        return canvas

    pitch_frames = [letterbox(f) for f in pitch_frames]
    swing_frames_raw = [letterbox(f) for f in swing_frames]

    # ---- FRONT-PAD SWING WITH SWING[0] ----
    swing0 = swing_frames_raw[0]
    diff = len(pitch_frames) - len(swing_frames_raw)

    if diff > 0:
        pad_block = [swing0.copy() for _ in range(diff)]
        swing_frames = pad_block + swing_frames_raw
        decision_frame += diff
    else:
        swing_frames = swing_frames_raw

    print("DEBUG >>> after pad: pitch =", len(pitch_frames), "swing =", len(swing_frames))
    print("DEBUG >>> shifted decision_frame =", decision_frame)

    # ---- Overlays ----
    YELLOW = (0, 255, 255)
    GREEN = (0, 255, 0)

    # yellow first 3 frames
    for i in range(3):
        if i < len(pitch_frames):
            cv2.rectangle(pitch_frames[i], (0, 0), (639, 719), YELLOW, 12)
        if i < len(swing_frames):
            cv2.rectangle(swing_frames[i], (0, 0), (639, 719), YELLOW, 12)

    # green at decision frame
    for i in range(decision_frame, decision_frame + 3):
        if 0 <= i < len(pitch_frames):
            cv2.rectangle(pitch_frames[i], (0, 0), (639, 719), GREEN, 12)
        if 0 <= i < len(swing_frames):
            cv2.rectangle(swing_frames[i], (0, 0), (639, 719), GREEN, 12)

    # ---- Combine frames (side-by-side) ----
    combo_frames = []
    for pf, sf in zip(pitch_frames, swing_frames):
        # horizontal stack → 1280x720
        combo = np.hstack((pf, sf))
        combo_frames.append(combo)

    print("DEBUG >>> base combo frames:", len(combo_frames))

    # ---- Title card 5s ----
    title_frames = []
    total_title = int(fps * 5)

    title = np.zeros((720, 1280, 3), dtype=np.uint8)
    cv2.putText(
        title,
        f"Pitch {pitch_id} vs Swing {swing_id}",
        (50, 300),
        cv2.FONT_HERSHEY_SIMPLEX,
        2.0,
        (255, 255, 255),
        4,
        cv2.LINE_AA,
    )
    cv2.putText(
        title,
        datetime.now().strftime("%Y-%m-%d"),
        (50, 380),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.5,
        (255, 255, 255),
        3,
        cv2.LINE_AA,
    )

    title_frames = [title for _ in range(total_title)]

    # ---- Freeze at start 2s ----
    start_freeze = [combo_frames[0]] * int(fps * 2)

    # ---- Freeze at decision 2s ----
    if 0 <= decision_frame < len(combo_frames):
        decision_freeze = [combo_frames[decision_frame]] * int(fps * 2)
    else:
        decision_freeze = []

    # ---- Final freeze 3s ----
    final_freeze = [combo_frames[-1]] * int(fps * 3)

    # ---- Build final output ----
    final_frames = (
        title_frames +
        start_freeze +
        combo_frames +
        decision_freeze +
        final_freeze
    )

    print("DEBUG >>> final video frame count:", len(final_frames))

    # ---- Write raw file ----
    temp_raw = "matchup_raw.yuv"
    temp_out = "matchup_out.mp4"

    with open(temp_raw, "wb") as f:
        for fr in final_frames:
            f.write(fr.astype(np.uint8).tobytes())

    ff = ffmpeg.get_ffmpeg_exe()

    cmd = [
        ff,
        "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", "1280x720",
        "-r", str(fps),
        "-i", temp_raw,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        temp_out,
    ]

    print("DEBUG >>> ffmpeg command:")
    print(" ".join(cmd))

    proc = subprocess.run(cmd, capture_output=True, text=True)
    print("DEBUG >>> ffmpeg stdout:", proc.stdout)
    print("DEBUG >>> ffmpeg stderr:", proc.stderr)

    # ---- Read result ----
    with open(temp_out, "rb") as f:
        matchup_blob = f.read()

    # ---- Make thumb from 5s frame ----
    thumb = None
    try:
        cap = cv2.VideoCapture(temp_out)
        frame_index = int(fps * 5)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        ret, fr = cap.read()
        cap.release()
        if ret:
            ok, jpg = cv2.imencode(".jpg", fr)
            if ok:
                thumb = jpg.tobytes()
    except:
        thumb = None

    # ---- Clean up ----
    if os.path.exists(temp_raw): os.remove(temp_raw)
    if os.path.exists(temp_out): os.remove(temp_out)
    if os.path.exists(tmp_pitch): os.remove(tmp_pitch)
    if os.path.exists(tmp_swing): os.remove(tmp_swing)

    # ---- Store to DB ----
    conn = db()
    conn.execute(
        "INSERT INTO matchups (pitch_clip_id, swing_clip_id, description, matchup_blob, thumb, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (pitch_id, swing_id, description, matchup_blob, thumb, datetime.now())
    )
    conn.commit()
    conn.close()

    print("DEBUG >>> MATCHUP SAVED")

    return RedirectResponse(f"/library/matchups?sid={sid}", status_code=303)

# ============================================================
# END ENDPOINT: MATCHUP BUILD
# ============================================================


# ============================================================
# SWING LIBRARY / PLAY / STREAM / THUMBNAIL
# ============================================================

@app.get("/library/swing", response_class=HTMLResponse)
def library_swing(request: Request, sid: str = "x"):
    conn = db()
    clips = conn.execute(
        "SELECT id, team_id, hitter_id, description, fps, created_at FROM swing_clips ORDER BY created_at DESC"
    ).fetchall()
    conn.close()

    return templates.TemplateResponse(
        "library_swing.html",
        {"request": request, "sid": sid, "clips": clips},
    )

@app.get("/thumbnail/swing")
def thumbnail_swing(id: int):
    conn = db()
    row = conn.execute("SELECT clip_blob FROM swing_clips WHERE id=?", (id,)).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    blob = row[0]
    temp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    temp.write(blob)
    temp.close()

    cap = cv2.VideoCapture(temp.name)
    ret, frame = cap.read()
    cap.release()
    os.remove(temp.name)

    if not ret:
        return HTMLResponse("bad frame", status_code=500)

    ok, jpg = cv2.imencode(".jpg", frame)
    return StreamingResponse(io.BytesIO(jpg.tobytes()), media_type="image/jpeg")

@app.get("/play/swing", response_class=HTMLResponse)
def play_swing(request: Request, id: int, sid: str = "x"):
    return templates.TemplateResponse(
        "play_swing.html", {"request": request, "sid": sid, "id": id}
    )

@app.get("/stream/swing")
def stream_swing(request: Request, id: int):
    conn = db()
    row = conn.execute("SELECT clip_blob FROM swing_clips WHERE id=?", (id,)).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    blob = row[0]
    size = len(blob)

    range_header = request.headers.get("range")
    if not range_header:
        return Response(
            content=blob,
            status_code=200,
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": str(size),
                "Accept-Ranges": "bytes",
            },
        )

    match = re.match(r"bytes=(\d+)-(\d*)", range_header)
    if not match:
        return Response(
            content=blob,
            status_code=200,
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": str(size),
                "Accept-Ranges": "bytes",
            },
        )

    start = int(match.group(1))
    end = match.group(2)
    end = size - 1 if end == "" else int(end)

    if start > end or start >= size:
        return Response(status_code=416)

    chunk = blob[start : end + 1]

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


# ============================================================
# END SECTION: SWING WORKFLOW
# ============================================================

# ============================================================
# START SECTION: MATCHUPS (LIST / THUMB / PLAY / STREAM / DELETE)
# ============================================================


# ---------- GET /download/matchup/video ----------
@app.get("/download/matchup/video")
def download_matchup_video(id: int):
    conn = db()
    row = conn.execute("SELECT matchup_blob FROM matchups WHERE id=?", (id,)).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    blob = row[0]

    return Response(
        content=blob,
        media_type="video/mp4",
        headers={
            "Content-Disposition": f'attachment; filename="matchup_{id}.mp4"'
        }
    )

# ---------- GET /download/matchup/start_frame ----------
@app.get("/download/matchup/start_frame")
def download_start_frame(id: int):
    conn = db()
    row = conn.execute(
        "SELECT pitch_clip_id FROM matchups WHERE id=?", (id,)
    ).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    pitch_id = row[0]

    conn = db()
    p_row = conn.execute(
        "SELECT clip_blob FROM pitch_clips WHERE id=?", (pitch_id,)
    ).fetchone()
    conn.close()

    if not p_row:
        return HTMLResponse("pitch not found", status_code=404)

    blob = p_row[0]

    # load pitch clip into temp file
    temp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    temp.write(blob)
    temp.close()

    cap = cv2.VideoCapture(temp.name)
    ret, frame = cap.read()
    cap.release()
    os.remove(temp.name)

    if not ret:
        return HTMLResponse("bad frame", status_code=500)

    ok, jpg = cv2.imencode(".jpg", frame)
    if not ok:
        return HTMLResponse("encode error", status_code=500)

    return Response(
        content=jpg.tobytes(),
        media_type="image/jpeg",
        headers={
            "Content-Disposition": f'attachment; filename="pitch_start_{id}.jpg"'
        }
    )

# ---------- GET /download/matchup/decision_frame ----------
@app.get("/download/matchup/decision_frame")
def download_decision_frame(id: int):
    conn = db()
    row = conn.execute(
        "SELECT pitch_clip_id, swing_clip_id FROM matchups WHERE id=?", (id,)
    ).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    pitch_id, swing_id = row

    # get swing decision frame
    conn = db()
    dec_row = conn.execute(
        "SELECT decision_frame FROM swing_clips WHERE id=?", (swing_id,)
    ).fetchone()
    conn.close()

    if not dec_row:
        return HTMLResponse("swing not found", status_code=404)

    decision_frame = dec_row[0]

    # load pitch clip
    conn = db()
    p_row = conn.execute(
        "SELECT clip_blob FROM pitch_clips WHERE id=?", (pitch_id,)
    ).fetchone()
    conn.close()

    if not p_row:
        return HTMLResponse("pitch not found", status_code=404)

    blob = p_row[0]

    temp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    temp.write(blob)
    temp.close()

    cap = cv2.VideoCapture(temp.name)
    cap.set(cv2.CAP_PROP_POS_FRAMES, decision_frame)
    ret, frame = cap.read()
    cap.release()
    os.remove(temp.name)

    if not ret:
        return HTMLResponse("bad frame", status_code=500)

    ok, jpg = cv2.imencode(".jpg", frame)
    if not ok:
        return HTMLResponse("encode error", status_code=500)

    return Response(
        content=jpg.tobytes(),
        media_type="image/jpeg",
        headers={
            "Content-Disposition": f'attachment; filename="pitch_decision_{id}.jpg"'
        }
    )



@app.get("/library/matchups", response_class=HTMLResponse)
def library_matchups(request: Request, sid: str = "x"):
    conn = db()
    rows = conn.execute(
        "SELECT id, pitch_clip_id, swing_clip_id, description, matchup_blob, created_at, thumb FROM matchups ORDER BY created_at DESC"
    ).fetchall()
    conn.close()

    return templates.TemplateResponse(
        "library_matchups.html",
        {"request": request, "sid": sid, "matchups": rows},
    )

@app.get("/thumbnail/matchup")
def thumbnail_matchup(id: int):
    conn = db()
    row = conn.execute("SELECT thumb FROM matchups WHERE id=?", (id,)).fetchone()
    conn.close()

    if not row or not row[0]:
        return HTMLResponse("no thumb", status_code=404)

    return StreamingResponse(io.BytesIO(row[0]), media_type="image/jpeg")

@app.get("/play/matchup", response_class=HTMLResponse)
def play_matchup(request: Request, id: int, sid: str = "x"):
    return templates.TemplateResponse(
        "play_matchup.html",
        {"request": request, "sid": sid, "id": id}
    )

@app.get("/stream/matchup")
def stream_matchup(request: Request, id: int):
    conn = db()
    row = conn.execute("SELECT matchup_blob FROM matchups WHERE id=?", (id,)).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    blob = row[0]
    size = len(blob)

    range_header = request.headers.get("range")
    if not range_header:
        return Response(
            content=blob,
            status_code=200,
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": str(size),
                "Accept-Ranges": "bytes",
            },
        )

    match = re.match(r"bytes=(\d+)-(\d*)", range_header)
    if not match:
        return Response(
            content=blob,
            status_code=200,
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": str(size),
                "Accept-Ranges": "bytes",
            },
        )

    start = int(match.group(1))
    end = match.group(2)
    end = size - 1 if end == "" else int(end)

    chunk = blob[start : end + 1]

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

# ============================================================
# END SECTION: MATCHUPS
# ============================================================
