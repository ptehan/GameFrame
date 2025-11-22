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
# GET /library/pitch
# ------------------------------------------------------------
@router.get("/library/pitch", response_class=HTMLResponse)
def library_pitch(
    request: Request,
    sid: str = "x",
    team_filter: str = "all",
    pitcher_filter: str = "all"
):
    conn = db()

    teams = conn.execute("SELECT id, name FROM teams ORDER BY name").fetchall()
    pitchers = conn.execute("SELECT id, name FROM pitchers ORDER BY name").fetchall()

    sql = "SELECT id, team_id, pitcher_id, description, fps, created_at FROM pitch_clips"
    filters = []
    params = []

    if team_filter != "all":
        filters.append("team_id = ?")
        params.append(team_filter)

    if pitcher_filter != "all":
        filters.append("pitcher_id = ?")
        params.append(pitcher_filter)

    if filters:
        sql += " WHERE " + " AND ".join(filters)

    sql += " ORDER BY created_at DESC"

    clips = conn.execute(sql, params).fetchall()
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

# ------------------------------------------------------------
# GET /thumbnail/pitch
# ------------------------------------------------------------
@router.get("/thumbnail/pitch")
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
# GET /play/pitch
# ------------------------------------------------------------
@router.get("/play/pitch", response_class=HTMLResponse)
def play_pitch(request: Request, id: int, sid: str = "x"):
    return templates.TemplateResponse(
        "play_pitch.html",
        {"request": request, "sid": sid, "id": id}
    )

# ------------------------------------------------------------
# GET /stream/pitch
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

# ------------------------------------------------------------
# POST /library/pitch/delete
# ------------------------------------------------------------
@router.post("/library/pitch/delete")
def delete_pitch_clip(id: int = Form(...), sid: str = Form("x")):
    conn = db()
    conn.execute("DELETE FROM pitch_clips WHERE id=?", (id,))
    conn.commit()
    conn.close()
    return RedirectResponse(f"/library/pitch?sid={sid}", status_code=303)
