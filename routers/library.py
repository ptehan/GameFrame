# routers/library.py

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from utils.db import db

router = APIRouter()
templates = Jinja2Templates("templates")


@router.get("/library", response_class=HTMLResponse)
def unified_library(request: Request, sid: str = "x"):
    return templates.TemplateResponse(
        "library.html",
        {"request": request, "sid": sid},
    )


@router.get("/library/data")
def unified_library_data(type: str, sid: str = "x"):
    conn = db()
    cur = conn.cursor()

    # --------------------------------------------------------
    # PITCH CLIPS
    # --------------------------------------------------------
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

    # --------------------------------------------------------
    # SWING CLIPS
    # --------------------------------------------------------
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

    # --------------------------------------------------------
    # MATCHUPS
    # --------------------------------------------------------
    if type == "matchup":
        rows = cur.execute("""
            SELECT 
                m.id,
                m.description,
                m.created_at,
                pt.team_name AS pitcher_team,
                pt.pitcher_name,
                ht.team_name AS hitter_team,
                ht.hitter_name
            FROM matchups m
            JOIN (
                SELECT pc.id AS pitch_clip_id, t.name AS team_name, p.name AS pitcher_name
                FROM pitch_clips pc
                JOIN pitchers p ON p.id = pc.pitcher_id
                JOIN teams t ON t.id = p.team_id
            ) pt ON pt.pitch_clip_id = m.pitch_clip_id
            JOIN (
                SELECT sc.id AS swing_clip_id, t.name AS team_name, h.name AS hitter_name
                FROM swing_clips sc
                JOIN hitters h ON h.id = sc.hitter_id
                JOIN teams t ON t.id = h.team_id
            ) ht ON ht.swing_clip_id = m.swing_clip_id
            ORDER BY m.created_at DESC
        """).fetchall()

        out = []
        for r in rows:
            out.append({
                "type": "matchup",
                "id": r[0],
                "description": r[1],
                "created_at": r[2],
                "team_name": r[3],
                "pitcher_name": r[4],
                "hitter_team": r[5],
                "hitter_name": r[6],
                "thumbnail": f"/thumbnail/matchup?id={r[0]}",
                "play": f"/play/matchup?id={r[0]}&sid={sid}",   # FIXED
                "delete": "/matchup/delete",
            })

        return JSONResponse(out)

    # --------------------------------------------------------
    # MULTI MATCHUPS
    # --------------------------------------------------------
    if type == "multi":
        rows = cur.execute("""
            SELECT 
                mm.id,
                mm.description,
                mm.created_at,
                pA.name AS pitcherA_name,
                tA.name AS pitcherA_team,
                pB.name AS pitcherB_name,
                tB.name AS pitcherB_team,
                h.name AS hitter_name,
                tH.name AS hitter_team
            FROM multi_matchups mm
            JOIN pitch_clips pcA ON pcA.id = mm.pitch_clip_id_A
            JOIN pitchers pA ON pA.id = pcA.pitcher_id
            JOIN teams tA ON tA.id = pA.team_id
            JOIN pitch_clips pcB ON pcB.id = mm.pitch_clip_id_B
            JOIN pitchers pB ON pB.id = pcB.pitcher_id
            JOIN teams tB ON tB.id = pB.team_id
            JOIN swing_clips sc ON sc.id = mm.swing_clip_id
            JOIN hitters h ON h.id = sc.hitter_id
            JOIN teams tH ON tH.id = h.team_id
            ORDER BY mm.created_at DESC
        """).fetchall()

        out = []
        for r in rows:
            out.append({
                "type": "multi",
                "id": r[0],
                "description": r[1],
                "created_at": r[2],
                "pitcherA_name": r[3],
                "pitcherA_team": r[4],
                "pitcherB_name": r[5],
                "pitcherB_team": r[6],
                "hitter_name": r[7],
                "hitter_team": r[8],
                "thumbnail": f"/thumbnail/multi?id={r[0]}",
                "play": f"/play/multi_matchup?id={r[0]}&sid={sid}",   # FIXED
                "delete": "/matchup/multi_delete",
            })

        return JSONResponse(out)

    return JSONResponse({"error": "invalid type"}, status_code=400)
