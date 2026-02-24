from fastapi import APIRouter, Request, Form, File, UploadFile

from fastapi.responses import HTMLResponse, Response, RedirectResponse, StreamingResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from utils.db import db
import re
import cv2, numpy as np, tempfile, subprocess, os
from datetime import datetime
import imageio_ffmpeg as ffmpeg
from utils.db import db
import io

router = APIRouter()
templates = Jinja2Templates("templates")

# ------------------------------------------------------------
# GET /thumbnail/matchup
# ------------------------------------------------------------
@router.get("/thumbnail/matchup")
def thumbnail_matchup(id: int):
    conn = db()
    row = conn.execute(
        "SELECT thumb FROM matchups WHERE id=?", (id,)
    ).fetchone()
    conn.close()

    if not row or not row[0]:
        return HTMLResponse("not found", status_code=404)

    return StreamingResponse(
        io.BytesIO(row[0]),
        media_type="image/jpeg"
    )


# ------------------------------------------------------------
# GET /play/matchup
# ------------------------------------------------------------
@router.get("/play/matchup", response_class=HTMLResponse)
def play_matchup(request: Request, id: int, sid: str = "x"):
    return templates.TemplateResponse(
        "play_matchup.html",
        {"request": request, "sid": sid, "id": id}
    )


# ------------------------------------------------------------
# GET /stream/matchup   (byte-range MP4 streaming)
# ------------------------------------------------------------
@router.get("/stream/matchup")
def stream_matchup(request: Request, id: int):
    conn = db()
    row = conn.execute(
        "SELECT matchup_blob FROM matchups WHERE id=?",
        (id,)
    ).fetchone()
    conn.close()

    if not row or row[0] is None:
        return Response("not found", status_code=404)

    blob = row[0]
    size = len(blob)

    range_header = request.headers.get("range")

    # --------------------------------------------------------
    # FULL FILE
    # --------------------------------------------------------
    if not range_header:
        return Response(
            content=blob,
            status_code=200,
            headers={
                "Content-Type": "video/mp4",
                "Accept-Ranges": "bytes",
                "Content-Length": str(size),
            }
        )

    # --------------------------------------------------------
    # PARTIAL CONTENT (Range Request)
    # --------------------------------------------------------
    match = re.match(r"bytes=(\d+)-(\d*)", range_header)
    if not match:
        return Response(
            content=blob,
            status_code=200,
            headers={
                "Content-Type": "video/mp4",
                "Accept-Ranges": "bytes",
                "Content-Length": str(size),
            }
        )

    start = int(match.group(1))
    end_raw = match.group(2)
    end = size - 1 if end_raw == "" else int(end_raw)

    if start >= size or start > end:
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
        }
    )


# ------------------------------------------------------------
# POST /library/matchup/delete
# ------------------------------------------------------------
@router.post("/library/matchup/delete")
def delete_matchup_clip(id: int = Form(...), sid: str = Form("x")):
    conn = db()
    conn.execute("DELETE FROM matchups WHERE id=?", (id,))
    conn.commit()
    conn.close()

    return RedirectResponse(f"/library?sid={sid}&type=matchup", status_code=303)


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
def matchup_build_page(request: Request, sid: str):
    conn = db()
    teams = conn.execute("SELECT id, name FROM teams ORDER BY name").fetchall()

    pitchers = conn.execute("""
        SELECT id, name, team_id
        FROM pitchers
        ORDER BY name
    """).fetchall()

    hitters = conn.execute("""
        SELECT id, name, team_id
        FROM hitters
        ORDER BY name
    """).fetchall()

    pitch_clips = conn.execute("""
        SELECT id, pitcher_id, label FROM pitch_clips
    """).fetchall()

    swing_clips = conn.execute("""
        SELECT id, hitter_id, label FROM swing_clips
    """).fetchall()

    conn.close()

    pitcher_map = {}
    for pid, name, tid in pitchers:
        pitcher_map.setdefault(tid, []).append({"id": pid, "name": name})

    hitter_map = {}
    for hid, name, tid in hitters:
        hitter_map.setdefault(tid, []).append({"id": hid, "name": name})

    pitch_clip_map = {}
    for cid, pid, lbl in pitch_clips:
        pitch_clip_map.setdefault(pid, []).append({"id": cid, "label": lbl})

    swing_clip_map = {}
    for cid, hid, lbl in swing_clips:
        swing_clip_map.setdefault(hid, []).append({"id": cid, "label": lbl})

    return templates.TemplateResponse(
        "matchup_build.html",
        {
            "request": request,
            "sid": sid,
            "teams": teams,
            "pitcher_map": pitcher_map,
            "pitch_clip_map": pitch_clip_map,
            "hitter_map": hitter_map,
            "swing_clip_map": swing_clip_map
        }
    )


# -------------------------------------------------------------------
# BACKEND MATCHUP CREATE
# -------------------------------------------------------------------
@router.post("/matchup/create")
async def matchup_create(
    request: Request,
    sid: str = Form(...),
    pitch_id: int = Form(...),
    swing_id: int = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...)
):
    file_bytes = await file.read()

    # ---- TEMP FILE FOR THUMBNAIL EXTRACTION ----
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
    with open(tmp, "wb") as f:
        f.write(file_bytes)

    # ---- NEW: EXTRACT LAST FRAME ----
    thumb = None
    try:
        cap = cv2.VideoCapture(tmp)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        # move to last frame safely
        last = max(0, total - 1)
        cap.set(cv2.CAP_PROP_POS_FRAMES, last)

        ok, fr = cap.read()
        cap.release()

        if ok:
            ok2, jpg = cv2.imencode(".jpg", fr)
            if ok2:
                thumb = jpg.tobytes()

    except Exception as e:
        print("thumbnail error:", e)
        thumb = None

    try:
        os.remove(tmp)
    except:
        pass

    # ---- STORE IN DB ----
    conn = db()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO matchups
            (pitch_clip_id, swing_clip_id, description, matchup_blob, thumb, created_at)
        VALUES (?,?,?,?,?,?)
    """, (
        pitch_id,
        swing_id,
        description,
        file_bytes,
        thumb,
        datetime.now()
    ))

    new_id = cur.lastrowid
    conn.commit()
    conn.close()

    return JSONResponse({"id": new_id})




# ---------------------------
# SWING META
# ---------------------------
@router.get("/api/swing_meta")
def swing_meta(id: int):
    conn = db()
    row = conn.execute(
        "SELECT fps, decision_frame, swing_seconds, frame_count, clip_blob FROM swing_clips WHERE id=?",
        (id,)
    ).fetchone()
    conn.close()

    if not row:
        return {"error": "bad_meta"}

    fps, decision_frame, swing_seconds, frame_count, clip_blob = row
    fps = float(fps or 0)
    swing_seconds = float(swing_seconds) if swing_seconds is not None else None
    frame_count = int(frame_count) if frame_count is not None else None

    if swing_seconds is None and frame_count is not None and fps > 0:
        swing_seconds = frame_count / fps
    elif swing_seconds is None and clip_blob:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
        try:
            with open(tmp, "wb") as f:
                f.write(clip_blob)
            cap = cv2.VideoCapture(tmp)
            fc = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            detected_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
            cap.release()
            fps_use = fps if fps > 0 else detected_fps
            if fc > 0 and fps_use > 0:
                swing_seconds = fc / fps_use
                if frame_count is None:
                    frame_count = fc
                if fps <= 0:
                    fps = fps_use
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass

    return {
        "fps": fps,
        "decision_frame": decision_frame,
        "swing_seconds": swing_seconds,
        "frame_count": frame_count,
    }


# ============================================================
# RECEIVE POST FROM matchup_select.html
# SEND USER INTO THE BUILD PAGE (GET)
# DOES NOT HANDLE VIDEO UPLOAD ANYMORE
# SAFELY RENAMED TO AVOID COLLISION
# ============================================================
@router.post("/matchup/select")
def matchup_select(
    sid: str = Form("x"),
    pitch_id: int = Form(...),
    swing_id: int = Form(...),
    description: str = Form("")
):
    print("DEBUG >>> MATCHUP SELECT CALLED")
    print("DEBUG >>> pitch_id:", pitch_id)
    print("DEBUG >>> swing_id:", swing_id)
    print("DEBUG >>> description:", description)

    # Redirect to the GET /matchup/build route
    return RedirectResponse(
        f"/matchup/build?sid={sid}&pitch_id={pitch_id}&swing_id={swing_id}&description={description}",
        status_code=303
    )


@router.get("/matchup/select", response_class=HTMLResponse)
def matchup_select(request: Request, sid: str = "x"):
    conn = db()
    cur = conn.cursor()

    # ------------------------------
    # LOAD TEAMS
    # ------------------------------
    teams = cur.execute(
        "SELECT id, name FROM teams ORDER BY name"
    ).fetchall()

    # ------------------------------
    # BUILD PITCHER MAP
    # ------------------------------
    pitcher_rows = cur.execute(
        "SELECT id, name, team_id FROM pitchers ORDER BY name"
    ).fetchall()

    pitcher_map = {}
    for pid, name, tid in pitcher_rows:
        tid = str(tid)
        if tid not in pitcher_map:
            pitcher_map[tid] = []
        pitcher_map[tid].append({"id": pid, "name": name})

    # ------------------------------
    # BUILD PITCH CLIP MAP
    # ------------------------------
    clip_rows = cur.execute(
        """
        SELECT id, pitcher_id, description, fps, created_at
        FROM pitch_clips
        ORDER BY created_at DESC
        """
    ).fetchall()

    pitch_clip_map = {}
    for cid, pid, desc, fps, created in clip_rows:
        pid = str(pid)
        if pid not in pitch_clip_map:
            pitch_clip_map[pid] = []

        label = f"{created[:10]} – {desc or f'Pitch {cid}'}"
        pitch_clip_map[pid].append({"id": cid, "label": label})

    # ------------------------------
    # BUILD HITTER MAP
    # ------------------------------
    hitter_rows = cur.execute(
        "SELECT id, name, team_id FROM hitters ORDER BY name"
    ).fetchall()

    hitter_map = {}
    for hid, name, tid in hitter_rows:
        tid = str(tid)
        if tid not in hitter_map:
            hitter_map[tid] = []
        hitter_map[tid].append({"id": hid, "name": name})

    # ------------------------------
    # BUILD SWING CLIP MAP
    # ------------------------------
    swing_rows = cur.execute(
        """
        SELECT id, hitter_id, description, fps, created_at
        FROM swing_clips
        ORDER BY created_at DESC
        """
    ).fetchall()

    swing_clip_map = {}
    for cid, hid, desc, fps, created in swing_rows:
        hid = str(hid)
        if hid not in swing_clip_map:
            swing_clip_map[hid] = []

        label = f"{created[:10]} – {desc or f'Swing {cid}'}"
        swing_clip_map[hid].append({"id": cid, "label": label})

    conn.close()

    return templates.TemplateResponse(
        "matchup_select.html",
        {
            "request": request,
            "sid": sid,
            "teams": teams,
            "pitcher_map": pitcher_map,
            "pitch_clip_map": pitch_clip_map,
            "hitter_map": hitter_map,
            "swing_clip_map": swing_clip_map,
        },
    )
