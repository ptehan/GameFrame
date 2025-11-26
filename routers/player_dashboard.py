# routers/player_dashboard.py

from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from utils.db import db

import tempfile
import os
import cv2

router = APIRouter()
templates = Jinja2Templates("templates")


@router.get("/dashboard/player", response_class=HTMLResponse)
def player_dashboard(request: Request, tid: int = 0, hid: int = 0, sid: str = "x"):

    conn = db()
    cur = conn.cursor()

    # Load teams
    teams = cur.execute("SELECT id, name FROM teams ORDER BY name").fetchall()

    # Load hitters for selected team
    hitters = []
    if tid:
        hitters = cur.execute(
            "SELECT id, name FROM hitters WHERE team_id=? ORDER BY name",
            (tid,)
        ).fetchall()

    results = []
    summary = None

    if hid:
        swings = cur.execute("""
            SELECT id, description, clip_blob, fps
            FROM swing_clips
            WHERE hitter_id=?
            ORDER BY created_at DESC
        """, (hid,)).fetchall()
    
        for sid, desc, blob, fps in swings:
            # write temp file
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
            open(tmp, "wb").write(blob)
    
            # count frames
            cap = cv2.VideoCapture(tmp)
            frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            cap.release()
            os.remove(tmp)
    
            # compute swing time
            swing_time = frame_count / fps if fps else 0
    
            results.append((sid, desc, swing_time))
    
        if results:
            times = [r[2] for r in results]
            summary = {
                "count": len(times),
                "min": min(times),
                "max": max(times),
                "avg": sum(times) / len(times)
            }

    conn.close()

    return templates.TemplateResponse("dashboard_player.html", {
        "request": request,
        "teams": teams,
        "tid": tid,
        "hitters": hitters,
        "hid": hid,
        "results": results,
        "summary": summary
    })
