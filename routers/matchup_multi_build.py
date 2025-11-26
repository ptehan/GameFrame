# routers/matchup_multi_build.py

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


@router.get("/matchup/multi_build")
def matchup_multi_build(
    request: Request,
    sid: str,
    pitchA_id: int,
    pitchB_id: int,
    swing_id: int,
    description: str = ""
):

    # ------------------------------------------------------------
    # LOAD DATA
    # ------------------------------------------------------------
    conn = db()
    cur = conn.cursor()

    pA_row = cur.execute(
        "SELECT clip_blob, fps FROM pitch_clips WHERE id=?", (pitchA_id,)
    ).fetchone()

    pB_row = cur.execute(
        "SELECT clip_blob, fps FROM pitch_clips WHERE id=?", (pitchB_id,)
    ).fetchone()

    s_row = cur.execute("""
        SELECT clip_blob, fps, decision_frame
        FROM swing_clips WHERE id=?
    """, (swing_id,)).fetchone()

    pA_meta = cur.execute("""
        SELECT pitchers.name, teams.name
        FROM pitch_clips
        JOIN pitchers ON pitchers.id = pitch_clips.pitcher_id
        JOIN teams ON teams.id = pitchers.team_id
        WHERE pitch_clips.id=?
    """, (pitchA_id,)).fetchone()

    pB_meta = cur.execute("""
        SELECT pitchers.name, teams.name
        FROM pitch_clips
        JOIN pitchers ON pitchers.id = pitch_clips.pitcher_id
        JOIN teams ON teams.id = pitchers.team_id
        WHERE pitch_clips.id=?
    """, (pitchB_id,)).fetchone()

    s_meta = cur.execute("""
        SELECT hitters.name, teams.name
        FROM swing_clips
        JOIN hitters ON hitters.id = swing_clips.hitter_id
        JOIN teams ON teams.id = hitters.team_id
        WHERE swing_clips.id=?
    """, (swing_id,)).fetchone()

    conn.close()

    if not pA_row or not pB_row or not s_row:
        return HTMLResponse("Missing clip", 404)

    blobA, fpsA = pA_row
    blobB, fpsB = pB_row
    swing_blob, swing_fps, decision_frame = s_row

    pitchA_name, pitchA_team = pA_meta
    pitchB_name, pitchB_team = pB_meta
    hitter_name, hitter_team = s_meta

    fps = min(fpsA, fpsB, swing_fps)

    # ------------------------------------------------------------
    # WRITE TEMP FILES
    # ------------------------------------------------------------
    tmpA = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
    tmpB = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
    tmpS = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name

    open(tmpA, "wb").write(blobA)
    open(tmpB, "wb").write(blobB)
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

    pitchA_raw = load_frames(tmpA)
    pitchB_raw = load_frames(tmpB)
    swing_raw = load_frames(tmpS)

    # ------------------------------------------------------------
    # LETTERBOX ALL TO FINAL SIZES
    # ------------------------------------------------------------
    # Each pitch gets a 640×540 block (half width × half height)
    pitchA = [letterbox_exact(f, 640, 540) for f in pitchA_raw]
    pitchB = [letterbox_exact(f, 640, 540) for f in pitchB_raw]

    # Swing gets a full-width 1280×540 block
    swing = [letterbox_exact(f, 1280, 540) for f in swing_raw]

    max_len = max(len(pitchA), len(pitchB))

    # pad pitch arrays
    def pad(frames, L):
        if len(frames) < L:
            last = frames[-1]
            while len(frames) < L:
                frames.append(last.copy())
        return frames

    pitchA = pad(pitchA, max_len)
    pitchB = pad(pitchB, max_len)

    # pad swing by adding first frame before
    while len(swing) < max_len:
        swing.insert(0, swing[0])
        decision_frame += 1

    real_swing_start = len(swing) - len(swing_raw)
    raw_contact = len(swing_raw) - 1 + real_swing_start

    # ------------------------------------------------------------
    # TITLE CARD (FULLSCREEN 1080p)
    # ------------------------------------------------------------
    title = np.zeros((1080, 1280, 3), dtype=np.uint8)
    font = cv2.FONT_HERSHEY_SIMPLEX

    def putc(img, text, y, scale, thick):
        if not text:
            return
        ts = cv2.getTextSize(text, font, scale, thick)[0]
        x = (img.shape[1] - ts[0]) // 2
        cv2.putText(img, text, (x, y), font, scale, (255,255,255), thick)

    desc = description.strip()
    line1 = desc
    line2 = f"{hitter_name} vs {pitchA_name} + {pitchB_name}"
    swing_time = len(swing_raw) / swing_fps
    line3 = f"Swing Time: {swing_time:.2f} sec"
    line4 = datetime.now().strftime("%Y-%m-%d")

    y = 300
    putc(title, line1, y, 2.0, 5); y += 110
    putc(title, line2, y, 1.8, 5); y += 110
    putc(title, line3, y, 1.6, 4); y += 100
    putc(title, line4, y, 1.6, 4)

    title_frames = [title.copy() for _ in range(int(fps * 4))]

    # ------------------------------------------------------------
    # BUILD MAIN VIDEO — ALWAYS 1280×1080 CANVAS
    # ------------------------------------------------------------
    def make_canvas(top_block, bottom_block):
        canvas = np.zeros((1080, 1280, 3), dtype=np.uint8)
        canvas[0:540, 0:1280] = top_block
        canvas[540:1080, 0:1280] = bottom_block
        return canvas

    main = []

    # BEFORE SWING START
    for i in range(real_swing_start):
        top = np.hstack((pitchA[i], pitchB[i]))
        bottom = swing[0]
        main.append(make_canvas(top, bottom))

    # SWING START FREEZE
    def mkfreeze(i, col):
        pa = tint(pitchA[i], col)
        pb = tint(pitchB[i], col)
        top = np.hstack((pa, pb))
        bottom = tint(swing[i], col)
        return make_canvas(top, bottom)

    for _ in range(int(fps * 2)):
        main.append(mkfreeze(real_swing_start, (0,255,255)))

    # TO DECISION
    for i in range(real_swing_start + 1, decision_frame):
        top = np.hstack((pitchA[i], pitchB[i]))
        bottom = swing[i]
        main.append(make_canvas(top, bottom))

    # DECISION FREEZE
    for _ in range(int(fps * 2)):
        main.append(mkfreeze(decision_frame, (0,255,0)))

    # TO CONTACT
    for i in range(decision_frame + 1, raw_contact):
        top = np.hstack((pitchA[i], pitchB[i]))
        bottom = swing[i]
        main.append(make_canvas(top, bottom))

    # CONTACT FREEZE
    for _ in range(int(fps * 2)):
        top = np.hstack((pitchA[raw_contact], pitchB[raw_contact]))
        bottom = swing[raw_contact]
        main.append(make_canvas(top, bottom))

    # AFTER CONTACT
    for i in range(raw_contact + 1, max_len):
        top = np.hstack((pitchA[i], pitchB[i]))
        bottom = swing[raw_contact]
        main.append(make_canvas(top, bottom))

    # ------------------------------------------------------------
    # FINAL OUTPUT SEQUENCE
    # ------------------------------------------------------------
    out_frames = title_frames + main

    # ------------------------------------------------------------
    # ENCODE VIDEO
    # ------------------------------------------------------------
    raw_path = "multi_raw.yuv"
    out_path = "multi_matchup.mp4"

    with open(raw_path, "wb") as f:
        for fr in out_frames:
            f.write(fr.astype(np.uint8).tobytes())

    exe = ffmpeg.get_ffmpeg_exe()
    cmd = [
        exe, "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", "1280x1080",
        "-r", str(fps),
        "-i", raw_path,
        "-vcodec", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-x264opts", "no-dct-decimate=1",
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

    # cleanup temp files
    for p in (raw_path, out_path, tmpA, tmpB, tmpS):
        try:
            os.remove(p)
        except:
            pass

    # store result
    conn = db()
    conn.execute("""
        INSERT INTO multi_matchups
        (pitch_clip_id_A, pitch_clip_id_B, swing_clip_id,
         description, matchup_blob, thumb, created_at)
        VALUES (?,?,?,?,?,?,?)
    """, (pitchA_id, pitchB_id, swing_id, description, blob, thumb, datetime.now()))
    conn.commit()
    conn.close()

    return RedirectResponse(f"/library/multi_matchups?sid={sid}", 303)
