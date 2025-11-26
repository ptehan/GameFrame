from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from fastapi.templating import Jinja2Templates
import sqlite3
import re
import tempfile
import cv2
import io
from utils.db import db

router = APIRouter()
templates = Jinja2Templates("templates")


# ============================================================
# PLAY MATCHUP PAGE
# ============================================================
@router.get("/play/matchup", response_class=HTMLResponse)
def play_matchup(request: Request, id: int, sid: str = "x"):
    return templates.TemplateResponse(
        "play_matchup.html",
        {"request": request, "sid": sid, "id": id}
    )


# ============================================================
# STREAM MATCHUP VIDEO
# ============================================================
@router.get("/stream/matchup")
def stream_matchup(request: Request, id: int):
    conn = db()
    row = conn.execute(
        "SELECT matchup_blob FROM matchups WHERE id=?", (id,)
    ).fetchone()
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

    chunk = blob[start: end + 1]

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
# FULL MATCHUP DOWNLOAD  (RENAMED TO PREVENT COLLISION)
# ============================================================
@router.get("/play/matchup/download")
def download_matchup(id: int):
    conn = db()
    row = conn.execute(
        "SELECT matchup_blob FROM matchups WHERE id=?", (id,)
    ).fetchone()
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


# ============================================================
# DOWNLOAD PITCH START IMAGE (RENAMED TO PREVENT COLLISION)
# ============================================================
@router.get("/play/matchup/pitch_start")
def download_pitch_start(id: int):

    conn = db()
    row = conn.execute(
        "SELECT matchup_blob FROM matchups WHERE id=?", (id,)
    ).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    tmp.write(row[0])
    tmp.close()

    cap = cv2.VideoCapture(tmp.name)
    ret, frame = cap.read()
    cap.release()

    if not ret:
        return HTMLResponse("cannot read first frame", status_code=500)

    pitch_frame = frame[:, :640]

    ok, jpg = cv2.imencode(".jpg", pitch_frame)
    return Response(
        content=jpg.tobytes(),
        media_type="image/jpeg",
        headers={"Content-Disposition": f'attachment; filename="pitch_start_{id}.jpg"'}
    )


# ============================================================
# DOWNLOAD PITCH DECISION IMAGE (RENAMED TO PREVENT COLLISION)
# ============================================================
@router.get("/play/matchup/pitch_decision")
def download_pitch_decision(id: int):

    conn = db()
    row = conn.execute(
        "SELECT matchup_blob FROM matchups WHERE id=?", (id,)
    ).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    tmp.write(row[0])
    tmp.close()

    cap = cv2.VideoCapture(tmp.name)
    fps = cap.get(cv2.CAP_PROP_FPS)

    decision_img = None
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    for i in range(total):
        ret, fr = cap.read()
        if not ret:
            break

        pitch_half = fr[:, :640]
        px = pitch_half[5, 5]

        if px[1] > 200 and px[0] < 50 and px[2] < 50:
            decision_img = pitch_half
            break

    if decision_img is None:
        return HTMLResponse("cannot locate decision frame", status_code=500)

    ok, jpg = cv2.imencode(".jpg", decision_img)
    return Response(
        content=jpg.tobytes(),
        media_type="image/jpeg",
        headers={"Content-Disposition": f'attachment; filename="pitch_decision_{id}.jpg"'}
    )

# =========================================
# INLINE PITCH START IMAGE (VIEW, NOT DOWNLOAD)
# =========================================
@router.get("/play/matchup/pitch_start_img")
def view_pitch_start_img(id: int):
    conn = db()
    row = conn.execute(
        "SELECT matchup_blob FROM matchups WHERE id=?", (id,)
    ).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    # read first frame
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    tmp.write(row[0]); tmp.close()

    cap = cv2.VideoCapture(tmp.name)
    ret, frame = cap.read()
    cap.release()

    if not ret:
        return HTMLResponse("cannot read first frame", status_code=500)

    pitch_frame = frame[:, :640]
    ok, jpg = cv2.imencode(".jpg", pitch_frame)

    return Response(
        content=jpg.tobytes(),
        media_type="image/jpeg"
    )


# =========================================
# INLINE PITCH DECISION IMAGE (VIEW, NOT DOWNLOAD)
# =========================================
@router.get("/play/matchup/pitch_decision_img")
def view_pitch_decision_img(id: int):
    conn = db()
    row = conn.execute(
        "SELECT matchup_blob FROM matchups WHERE id=?", (id,)
    ).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    tmp.write(row[0]); tmp.close()

    cap = cv2.VideoCapture(tmp.name)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    decision_img = None
    for _ in range(total):
        ret, fr = cap.read()
        if not ret:
            break

        pitch_half = fr[:, :640]
        px = pitch_half[5, 5]

        if px[1] > 200 and px[0] < 50 and px[2] < 50:
            decision_img = pitch_half
            break

    cap.release()

    if decision_img is None:
        return HTMLResponse("cannot locate decision frame", status_code=500)

    ok, jpg = cv2.imencode(".jpg", decision_img)

    return Response(
        content=jpg.tobytes(),
        media_type="image/jpeg"
    )
