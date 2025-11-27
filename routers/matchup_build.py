from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from fastapi.templating import Jinja2Templates

import cv2
import numpy as np
import tempfile
import subprocess
import os
from datetime import datetime

import imageio_ffmpeg as ffmpeg
from utils.db import db


import shutil

router = APIRouter()
templates = Jinja2Templates("templates")


def tint(frame, color):
    overlay = np.full_like(frame, color)
    return cv2.addWeighted(frame, 0.8, overlay, 0.2, 0)


def letterbox_exact(f, w, h):
    H, W = f.shape[:2]
    s = min(w / W, h / H)
    nw, nh = int(W * s), int(H * s)

    r = cv2.resize(f, (nw, nh))
    canvas = np.zeros((h, w, 3), dtype=np.uint8)
    x = (w - nw) // 2
    y = (h - nh) // 2
    canvas[y:y+nh, x:x+nw] = r
    return canvas


@router.get("/matchup/build")
def matchup_build(
    request: Request,
    sid: str,
    pitch_id: int,
    swing_id: int,
    description: str = ""
):

    # ------------------------------------------------------------
    # LOAD DATA
    # ------------------------------------------------------------
    conn = db()
    cur = conn.cursor()

    p_row = cur.execute(
        "SELECT clip_blob, fps FROM pitch_clips WHERE id=?",
        (pitch_id,)
    ).fetchone()

    s_row = cur.execute("""
        SELECT clip_blob, fps, decision_frame
        FROM swing_clips WHERE id=?
    """, (swing_id,)).fetchone()

    p_meta = cur.execute("""
        SELECT pitchers.name, teams.name
        FROM pitch_clips
        JOIN pitchers ON pitchers.id = pitch_clips.pitcher_id
        JOIN teams ON teams.id = pitchers.team_id
        WHERE pitch_clips.id=?
    """, (pitch_id,)).fetchone()

    s_meta = cur.execute("""
        SELECT hitters.name, teams.name
        FROM swing_clips
        JOIN hitters ON hitters.id = swing_clips.hitter_id
        JOIN teams ON teams.id = hitters.team_id
        WHERE swing_clips.id=?
    """, (swing_id,)).fetchone()

    conn.close()

    if not p_row or not s_row:
        return HTMLResponse("Missing clip", 404)

    pitch_blob, pitch_fps = p_row
    swing_blob, swing_fps, decision_frame = s_row

    pitcher_name, pitcher_team = p_meta
    hitter_name, hitter_team = s_meta

    fps = min(pitch_fps, swing_fps)

    # ------------------------------------------------------------
    # WRITE TEMP FILES
    # ------------------------------------------------------------
    tmpP = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
    tmpS = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name

    open(tmpP, "wb").write(pitch_blob)
    open(tmpS, "wb").write(swing_blob)

    # ------------------------------------------------------------
    # LOAD FRAMES
    # ------------------------------------------------------------
    def load_frames(path):
        cap = cv2.VideoCapture(path)
        frames = []
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame.copy())
        cap.release()
        return frames

    pitch_raw = load_frames(tmpP)
    swing_raw = load_frames(tmpS)

    # swing contact = last raw frame BEFORE padding
    raw_contact = len(swing_raw) - 1

    # ------------------------------------------------------------
    # LETTERBOX BOTH TO 640 × 720
    # ------------------------------------------------------------
    pitch = [letterbox_exact(f, 640, 720) for f in pitch_raw]
    swing = [letterbox_exact(f, 640, 720) for f in swing_raw]

    # ------------------------------------------------------------
    # PAD SWING AT FRONT UNTIL MATCHES PITCH LENGTH
    # ------------------------------------------------------------
    while len(swing) < len(pitch):
        swing.insert(0, swing[0])
        decision_frame += 1
        raw_contact += 1

    real_swing_start = len(swing) - len(swing_raw)
    swing_duration = len(swing_raw) / swing_fps

    # ------------------------------------------------------------
    # TITLE CARD (1280×720)
    # ------------------------------------------------------------
    title = np.zeros((720, 1280, 3), dtype=np.uint8)
    font = cv2.FONT_HERSHEY_SIMPLEX

    def putc(img, text, y, scale, thick):
        if not text:
            return
        ts = cv2.getTextSize(text, font, scale, thick)[0]
        x = (img.shape[1] - ts[0]) // 2
        cv2.putText(img, text, (x, y), font, scale,
                    (255,255,255), thick, cv2.LINE_AA)

    desc = description.strip() if description else "Matchup"

    y = 150
    putc(title, desc, y, 2.2, 6); y += 100
    putc(title, f"Pitcher: {pitcher_name} ({pitcher_team})", y, 1.8, 5); y += 80
    putc(title, f"Hitter: {hitter_name} ({hitter_team})", y, 1.8, 5); y += 80
    putc(title, f"Swing Duration: {swing_duration:.2f} sec", y, 1.6, 4); y += 70
    putc(title, datetime.now().strftime("%Y-%m-%d"), y, 1.4, 3)

    title_frames = [title.copy() for _ in range(int(fps * 4))]

    # ------------------------------------------------------------
    # FINAL OUTPUT FRAMES
    # ------------------------------------------------------------
    out = []

    def side_by_side(l, r):
        return np.hstack((l, r))

    # BEFORE SWING START
    for i in range(real_swing_start):
        out.append(side_by_side(pitch[i], swing[0]))

    # SWING START FREEZE (yellow)
    for _ in range(int(fps * 2)):
        out.append(side_by_side(
            tint(pitch[real_swing_start], (0,255,255)),
            tint(swing[real_swing_start], (0,255,255))
        ))

    # START → DECISION
    for i in range(real_swing_start + 1, decision_frame):
        out.append(side_by_side(pitch[i], swing[i]))

    # DECISION FREEZE (green)
    for _ in range(int(fps * 2)):
        out.append(side_by_side(
            tint(pitch[decision_frame], (0,255,0)),
            tint(swing[decision_frame], (0,255,0))
        ))

    # DECISION → CONTACT
    for i in range(decision_frame + 1, raw_contact):
        out.append(side_by_side(pitch[i], swing[i]))

    # CONTACT FREEZE (no tint)
    for _ in range(int(fps * 2)):
        out.append(side_by_side(
            pitch[raw_contact],
            swing[raw_contact]
        ))

    # AFTER CONTACT
    for i in range(raw_contact + 1, len(pitch)):
        out.append(side_by_side(
            pitch[i],
            swing[raw_contact]
        ))

    final_frames = title_frames + out

    # ------------------------------------------------------------
    # ENCODE
    # ------------------------------------------------------------
    raw_path = tempfile.NamedTemporaryFile(delete=False, suffix=".yuv").name
    out_path = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name


    with open(raw_path, "wb") as f:
        for fr in final_frames:
            f.write(fr.astype(np.uint8).tobytes())
    
    exe = shutil.which("ffmpeg") or "ffmpeg"

    cmd = [
        exe, "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", "1280x720",
        "-r", str(fps),
        "-i", raw_path,
        "-vcodec", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-movflags", "+faststart",
        out_path
    ]
    subprocess.run(cmd, capture_output=True)

    with open(out_path, "rb") as f:
        blob = f.read()

    # thumbnail
    thumb = None
    try:
        cap = cv2.VideoCapture(out_path)
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(fps * 5))
        ok, fr = cap.read()
        if ok:
            ok2, jpg = cv2.imencode(".jpg", fr)
            if ok2:
                thumb = jpg.tobytes()
    except:
        pass

    # cleanup
    for p in (raw_path, out_path, tmpP, tmpS):
        try: os.remove(p)
        except: pass

    # save
    conn = db()
    conn.execute("""
        INSERT INTO matchups
        (pitch_clip_id, swing_clip_id, description, matchup_blob, thumb, created_at)
        VALUES (?,?,?,?,?,?)
    """, (pitch_id, swing_id, description, blob, thumb, datetime.now()))
    conn.commit()
    conn.close()

    return RedirectResponse(f"/library/matchups?sid={sid}", 303)
