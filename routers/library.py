from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from utils.db import db

router = APIRouter()
templates = Jinja2Templates("templates")


# --------------------------------------------------------
# MAIN LIBRARY PAGE
# --------------------------------------------------------
@router.get("/library", response_class=HTMLResponse)
def unified_library(request: Request, sid: str = "x", type: str = "matchup"):
    return templates.TemplateResponse(
        "library.html",
        {
            "request": request,
            "sid": sid,
            "type": type
        },
    )


# --------------------------------------------------------
# LIBRARY DATA API
# --------------------------------------------------------
@router.get("/library/data")
def unified_library_data(type: str, sid: str = "x"):
    conn = db()
    cur = conn.cursor()

    # ========================================================
    # PITCH CLIPS
    # ========================================================
    if type == "pitch":
        rows = cur.execute("""
            SELECT 
                pc.id,
                pc.description,
                pc.created_at,
                t.name AS team_name,
                p.name AS pitcher_name
            FROM pitch_clips pc
            JOIN pitchers p ON p.id = pc.pitcher_id
            JOIN teams t ON t.id = p.team_id
            ORDER BY pc.created_at DESC
        """).fetchall()

        out = []
        for r in rows:
            out.append({
                "type": "pitch",
                "id": r[0],
                "description": r[1],
                "created_at": r[2],
                "team_name": r[3],
                "pitcher_name": r[4],
                "hitter_name": "",
                "thumbnail": f"/thumbnail/pitch?id={r[0]}",
                "play": f"/play/pitch?id={r[0]}&sid={sid}",
                "delete": "/library/pitch/delete",
            })

        return JSONResponse(out)

    # ========================================================
    # SWING CLIPS
    # ========================================================
    if type == "swing":
        rows = cur.execute("""
            SELECT 
                sc.id,
                sc.description,
                sc.created_at,
                t.name AS team_name,
                h.name AS hitter_name
            FROM swing_clips sc
            JOIN hitters h ON h.id = sc.hitter_id
            JOIN teams t ON t.id = h.team_id
            ORDER BY sc.created_at DESC
        """).fetchall()

        out = []
        for r in rows:
            out.append({
                "type": "swing",
                "id": r[0],
                "description": r[1],
                "created_at": r[2],
                "team_name": r[3],
                "pitcher_name": "",
                "hitter_name": r[4],
                "thumbnail": f"/thumbnail/swing?id={r[0]}",
                "play": f"/play/swing?id={r[0]}&sid={sid}",
                "delete": "/library/swing/delete",
            })

        return JSONResponse(out)

    # ========================================================
    # MATCHUPS (FIXED — MATCHES EXACT SCHEMA)
    # ========================================================
    if type == "matchup":
        rows = cur.execute("""
            SELECT
                m.id,
                m.description,
                m.created_at,
    
                tp.name AS pitcher_team,
                p.name  AS pitcher_name,
    
                th.name AS hitter_team,
                h.name  AS hitter_name
    
            FROM matchups m
    
            LEFT JOIN pitch_clips pc
                   ON pc.id = m.pitch_clip_id
    
            LEFT JOIN pitchers p
                   ON p.id = pc.pitcher_id
    
            LEFT JOIN teams tp
                   ON tp.id = p.team_id
    
            LEFT JOIN swing_clips sc
                   ON sc.id = m.swing_clip_id
    
            LEFT JOIN hitters h
                   ON h.id = sc.hitter_id
    
            LEFT JOIN teams th
                   ON th.id = h.team_id

            ORDER BY m.created_at DESC
        """).fetchall()

        out = []
        for r in rows:
            out.append({
                "type": "matchup",
                "id": r[0],
                "description": r[1],
                "created_at": r[2],
    
                "pitcher_team": r[3] or "(deleted)",
                "pitcher_name": r[4] or "(deleted)",
                "hitter_team":  r[5] or "(deleted)",
                "hitter_name":  r[6] or "(deleted)",

                "team_name": "",
    
                "thumbnail": f"/thumbnail/matchup?id={r[0]}",
                "play": f"/play/matchup?id={r[0]}&sid={sid}",
                "delete": "/library/matchup/delete",
            })
    
        return JSONResponse(out)
    

    # ========================================================
    # INVALID TYPE
    # ========================================================
    return JSONResponse({"error": "invalid type"}, status_code=400)
