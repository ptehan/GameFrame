from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from utils.db import db

router = APIRouter()
templates = Jinja2Templates("templates")


@router.get("/play/multi_matchup", response_class=HTMLResponse)
def play_multi_matchup(request: Request, id: int, sid: str = "x"):
    conn = db()
    row = conn.execute("""
        SELECT matchup_blob
        FROM multi_matchups
        WHERE id=?
    """, (id,)).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("Not found", status_code=404)

    # Save blob to temp file to play in HTML5
    video_path = f"static/tmp_multi_{id}.mp4"
    with open(video_path, "wb") as f:
        f.write(row[0])

    return templates.TemplateResponse(
        "play_multi_matchup.html",
        {
            "request": request,
            "sid": sid,
            "video_path": "/" + video_path
        }
    )
