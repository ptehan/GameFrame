from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
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


@router.get("/matchup/build")
def matchup_build(
    request: Request,
    sid: str,
    pitch_id: int,
    swing_id: int,
    description: str = ""
):
    conn = db()

    p_row = conn.execute(
        "SELECT clip_blob, fps FROM pitch_clips WHERE id=?", (pitch_id,)
    ).fetchone()

    # ------------------------------------------------------------
    # FETCH PITCHER + HITTER NAMES AND TEAM NAMES
    # ------------------------------------------------------------
    p_meta = conn.execute("""
        SELECT pitchers.name, teams.name
        FROM pitch_clips
        JOIN pitchers ON pitchers.id = pitch_clips.pitcher_id
        JOIN teams ON teams.id = pitchers.team_id
        WHERE pitch_clips.id=?
    """, (pitch_id,)).fetchone()

    s_meta = conn.execute("""
        SELECT hitters.name, teams.name
        FROM swing_clips
        JOIN hitters ON hitters.id = swing_clips.hitter_id
        JOIN teams ON teams.id = hitters.team_id
        WHERE swing_clips.id=?
    """, (swing_id,)).fetchone()

    pitcher_name, pitcher_team = p_meta
    hitter_name,  hitter_team  = s_meta


    s_row = conn.execute(
        "SELECT clip_blob, fps, decision_frame FROM swing_clips WHERE id=?",
        (swing_id,)
    ).fetchone()

    if not p_row or not s_row:
        conn.close()
        return HTMLResponse("Missing pitch or swing clip", 404)

    pitch_blob, pitch_fps = p_row
    swing_blob, swing_fps, decision_frame = s_row
    conn.close()

    fps = min(pitch_fps, swing_fps)

    tmp_pitch = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
    tmp_swing = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name

    with open(tmp_pitch, "wb") as f:
        f.write(pitch_blob)
    with open(tmp_swing, "wb") as f:
        f.write(swing_blob)

    def load(path):
        cap = cv2.VideoCapture(path)
        out = []
        while True:
            ret, fr = cap.read()
            if not ret:
                break
            out.append(fr.copy())
        cap.release()
        return out

    pitch_raw = load(tmp_pitch)
    swing_raw = load(tmp_swing)   # ORIGINAL swing clip (unpadded)

    # ---------------------------------------------
    # SWING DURATION (seconds, BEFORE padding)
    # ---------------------------------------------
    swing_duration_sec = len(swing_raw) / swing_fps


    def letterbox(f, w=640, h=720):
        H, W = f.shape[:2]
        s = min(w / W, h / H)
        nw, nh = int(W * s), int(H * s)
        r = cv2.resize(f, (nw, nh))
        c = np.zeros((h, w, 3), dtype=np.uint8)
        y = (h - nh) // 2
        x = (w - nw) // 2
        c[y:y+nh, x:x+nw] = r
        return c

    pitch = [letterbox(f) for f in pitch_raw]
    swing = [letterbox(f) for f in swing_raw]

    # contact frame inside the raw swing BEFORE padding
    raw_contact = len(swing_raw) - 1

    # ------------------------------------------------------------
    # PAD SWING TO FULL LENGTH OF PITCH
    # (so pitch plays full length and swing waits)
    # ------------------------------------------------------------
    while len(swing) < len(pitch):
        swing.insert(0, swing[0].copy())
        decision_frame += 1
        raw_contact += 1

    # THIS IS THE ONLY REAL START VALUE THAT MATTERS
    real_swing_start = len(swing) - len(swing_raw)

    out_frames = []

    # ------------------------------------------------------------
    # BEAUTIFULLY CENTERED TITLE CARD
    # ------------------------------------------------------------
    title = np.zeros((720, 1280, 3), dtype=np.uint8)

    # ---------- helpers ----------
    # ---------- helpers ----------
    def put_center_text(img, text, y, base_scale, thickness):
        """
        Automatically shrink text horizontally so it always fits in 1280 width.
        """
        font = cv2.FONT_HERSHEY_SIMPLEX

        # Max width allowed
        max_w = img.shape[1] - 100  # 100px margins

        # Measure at base scale
        size = cv2.getTextSize(text, font, base_scale, thickness)[0]

        if size[0] > max_w:
            scale = base_scale * (max_w / size[0])
        else:
            scale = base_scale

        # Recalculate with final scale
        size = cv2.getTextSize(text, font, scale, thickness)[0]
        x = (img.shape[1] - size[0]) // 2

        cv2.putText(img, text, (x, y), font, scale,
                    (255,255,255), thickness, cv2.LINE_AA)


    def wrap_text(text, max_width_px, scale, thickness):
        """
        Wrap text more aggressively by using a smaller max width.
        """
        font = cv2.FONT_HERSHEY_SIMPLEX
        words = text.split()
        lines = []
        cur = ""

        for w in words:
            test = cur + (" " if cur else "") + w
            size = cv2.getTextSize(test, font, scale, thickness)[0]

            # Force early wrap
            if size[0] > max_width_px and cur != "":
                lines.append(cur)
                cur = w
            else:
                cur = test

        if cur:
            lines.append(cur)

        return lines


    y = 150

    # 1) TITLE
    put_center_text(title, "MATCHUP", y, 2.5, 6)
    y += 100

    # 2) DESCRIPTION (multi-line wrapped)
    if description.strip():
        lines = wrap_text(description.strip(), 900, 1.8, 4)
        for line in lines:
            put_center_text(title, line, y, 1.8, 4)
            y += 70
        y += 20  # extra spacing after block

    # 3) PITCHER vs HITTER
    vs_text = f"{pitcher_name} ({pitcher_team})  vs  {hitter_name} ({hitter_team})"
    put_center_text(title, vs_text, y, 1.7, 4)
    y += 90

    # 4) Swing Duration
    dur_txt = f"Swing Duration: {swing_duration_sec:.2f} sec"
    put_center_text(title, dur_txt, y, 1.5, 3)
    y += 70

    # 5) Date
    date_txt = datetime.now().strftime("%Y-%m-%d")
    put_center_text(title, date_txt, y, 1.7, 4)


    # >>> INSERT THIS BLOCK <<<
    for _ in range(int(fps * 5)):
        out_frames.append(title.copy())
    # >>> END INSERT <<<

    # ------------------------------------------------------------
    # BEFORE SWING START:
    # pitch plays normally
    # swing stays frozen on frame[0]
    # ------------------------------------------------------------
    for i in range(real_swing_start):
        out_frames.append(np.hstack((pitch[i], swing[0])))

    # ------------------------------------------------------------
    # FREEZE 1 — SWING START — YELLOW — 2s
    # ------------------------------------------------------------
    freeze_start_frames = int(fps * 2)

    sp = tint(pitch[real_swing_start], (0, 255, 255))
    ss = tint(swing[real_swing_start], (0, 255, 255))
    start_freeze = np.hstack((sp, ss))

    for _ in range(freeze_start_frames):
        out_frames.append(start_freeze.copy())

    # ------------------------------------------------------------
    # PLAY FROM START TO DECISION
    # ------------------------------------------------------------
    for i in range(real_swing_start + 1, decision_frame):
        out_frames.append(np.hstack((pitch[i], swing[i])))

    # ------------------------------------------------------------
    # FREEZE 2 — DECISION — GREEN — 2s
    # ------------------------------------------------------------
    freeze_decision_frames = int(fps * 2)

    dp = tint(pitch[decision_frame], (0, 255, 0))
    ds = tint(swing[decision_frame], (0, 255, 0))
    decision_freeze = np.hstack((dp, ds))

    for _ in range(freeze_decision_frames):
        out_frames.append(decision_freeze.copy())

    # ------------------------------------------------------------
    # PLAY FROM DECISION TO CONTACT
    # ------------------------------------------------------------
    for i in range(decision_frame + 1, raw_contact):
        out_frames.append(np.hstack((pitch[i], swing[i])))

    # ------------------------------------------------------------
    # FREEZE 3 — CONTACT — 2s
    # ------------------------------------------------------------
    freeze_contact_frames = int(fps * 2)

    cp = pitch[raw_contact]
    cs = swing[raw_contact]
    contact_freeze = np.hstack((cp, cs))

    for _ in range(freeze_contact_frames):
        out_frames.append(contact_freeze.copy())

    # ------------------------------------------------------------
    # AFTER CONTACT — pitch may have more frames
    # ------------------------------------------------------------
    for i in range(raw_contact + 1, len(pitch)):
        out_frames.append(np.hstack((pitch[i], swing[raw_contact])))

    # ------------------------------------------------------------
    # ENCODE VIDEO
    # ------------------------------------------------------------
    raw_path = "match_raw.yuv"
    out_path = "match_out.mp4"

    with open(raw_path, "wb") as f:
        for fr in out_frames:
            f.write(fr.astype(np.uint8).tobytes())

    exe = ffmpeg.get_ffmpeg_exe()

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
        "-x264opts", "no-dct-decimate=1",
        "-movflags", "+faststart",
        out_path
    ]

    subprocess.run(cmd, capture_output=True)

    with open(out_path, "rb") as f:
        matchup_blob = f.read()

    thumb = None
    try:
        cap = cv2.VideoCapture(out_path)
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(fps * 5))
        ret, fr = cap.read()
        cap.release()
        if ret:
            ok, j = cv2.imencode(".jpg", fr)
            if ok:
                thumb = j.tobytes()
    except:
        thumb = None

    for p in (raw_path, out_path, tmp_pitch, tmp_swing):
        try:
            os.remove(p)
        except:
            pass

    conn = db()
    conn.execute("""
        INSERT INTO matchups
        (pitch_clip_id, swing_clip_id, description, matchup_blob, thumb, created_at)
        VALUES (?,?,?,?,?,?)""",
        (pitch_id, swing_id, description, matchup_blob, thumb, datetime.now()))
    conn.commit()
    conn.close()

    return RedirectResponse(f"/library/matchups?sid={sid}", 303)
