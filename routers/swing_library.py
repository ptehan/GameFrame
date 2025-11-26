from fastapi import APIRouter, Request, Form
from fastapi.responses import HTMLResponse, Response, RedirectResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from utils.db import db
import re
import cv2
import tempfile
import io

router = APIRouter()
templates = Jinja2Templates("templates")


# ------------------------------------------------------------
# GET /library/swing
# ------------------------------------------------------------
@router.get("/library/swing", response_class=HTMLResponse)
def library_swing(request: Request, sid: str = "x"):
    conn = db()
    clips = conn.execute(
        "SELECT id, team_id, hitter_id, description, fps, created_at "
        "FROM swing_clips ORDER BY created_at DESC"
    ).fetchall()
    conn.close()

    return templates.TemplateResponse(
        "library_swing.html",
        {"request": request, "sid": sid, "clips": clips},
    )


# ------------------------------------------------------------
# POST /library/swing/delete   <-- FIXED / ADDED
# ------------------------------------------------------------
@router.post("/library/swing/delete")
def delete_swing_clip(id: int = Form(...), sid: str = Form("x")):
    conn = db()
    conn.execute("DELETE FROM swing_clips WHERE id=?", (id,))
    conn.commit()
    conn.close()

    return RedirectResponse(f"/library/swing?sid={sid}", status_code=303)


# ------------------------------------------------------------
# GET /thumbnail/swing
# ------------------------------------------------------------
@router.get("/thumbnail/swing")
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

    try:
        import os
        os.remove(temp.name)
    except:
        pass

    if not ret:
        return HTMLResponse("bad frame", status_code=500)

    ok, jpg = cv2.imencode(".jpg", frame)
    return StreamingResponse(io.BytesIO(jpg.tobytes()), media_type="image/jpeg")


# ------------------------------------------------------------
# GET /play/swing
# ------------------------------------------------------------
@router.get("/play/swing", response_class=HTMLResponse)
def play_swing(request: Request, id: int, sid: str = "x"):
    return templates.TemplateResponse(
        "play_swing.html",
        {"request": request, "sid": sid, "id": id},
    )


# ------------------------------------------------------------
# GET /stream/swing
# ------------------------------------------------------------
@router.get("/stream/swing")
def stream_swing(request: Request, id: int):
    conn = db()
    row = conn.execute("SELECT clip_blob FROM swing_clips WHERE id=?", (id,)).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("not found", status_code=404)

    blob = row[0]
    size = len(blob)

    range_header = request.headers.get("range")

    # No range → serve entire file
    if not range_header:
        return Response(
            content=blob,
            status_code=200,
            headers={
                "Content-Type": "video/mp4",
                "Accept-Ranges": "bytes",
                "Content-Length": str(size),
            },
        )

    match = re.match(r"bytes=(\d+)-(\d*)", range_header)
    if not match:
        return Response(
            content=blob,
            status_code=200,
            headers={
                "Content-Type": "video/mp4",
                "Accept-Ranges": "bytes",
                "Content-Length": str(size),
            },
        )

    start = int(match.group(1))
    end = match.group(2)
    end = size - 1 if end == "" else int(end)

    if start >= size or start > end:
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
