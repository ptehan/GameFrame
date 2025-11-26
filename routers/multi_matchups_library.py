from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from utils.db import db

router = APIRouter()
templates = Jinja2Templates("templates")

@router.get("/library/multi_matchups", response_class=HTMLResponse)
def multi_matchups_library(request: Request, sid: str):
    conn = db()
    cur = conn.cursor()

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

    conn.close()

    # Convert tuple rows → dict rows for template
    matchups = []
    for r in rows:
        matchups.append({
            "id": r[0],
            "description": r[1],
            "created_at": r[2],
            "pitcherA_name": r[3],
            "pitcherA_team": r[4],
            "pitcherB_name": r[5],
            "pitcherB_team": r[6],
            "hitter_name": r[7],
            "hitter_team": r[8],
        })

    return templates.TemplateResponse(
        "library_multi_matchups.html",
        {
            "request": request,
            "sid": sid,
            "matchups": matchups
        },
    )
