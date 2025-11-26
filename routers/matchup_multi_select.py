# routers/matchup_multi_select.py
from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates
from utils.db import db

router = APIRouter()
templates = Jinja2Templates("templates")


@router.get("/matchup/multi_select")
def matchup_multi_select(request: Request, sid: str = "x"):

    conn = db()

    # TEAMS
    teams = conn.execute("SELECT id, name FROM teams ORDER BY name").fetchall()

    # PITCH MAPS
    pitchers = conn.execute("SELECT id, name, team_id FROM pitchers ORDER BY name").fetchall()
    pitch_clips = conn.execute("""
        SELECT id, pitcher_id, description
        FROM pitch_clips
        ORDER BY id DESC
    """).fetchall()


    pitcher_map = {}
    for pid, name, tid in pitchers:
        pitcher_map.setdefault(tid, []).append({"id": pid, "name": name})

    pitch_clip_map = {}
    for cid, pid, desc in pitch_clips:
        label = desc if desc and desc.strip() else f"Pitch {cid}"
        pitch_clip_map.setdefault(pid, []).append({
            "id": cid,
            "label": label
        })


    # HITTER MAPS
    hitters = conn.execute("SELECT id, name, team_id FROM hitters ORDER BY name").fetchall()
    swing_clips = conn.execute("""
        SELECT id, hitter_id, description
        FROM swing_clips
        ORDER BY id DESC
    """).fetchall()



    hitter_map = {}
    for hid, name, tid in hitters:
        hitter_map.setdefault(tid, []).append({"id": hid, "name": name})

    swing_clip_map = {}
    for cid, hid, desc in swing_clips:
        label = desc if desc and desc.strip() else f"Swing {cid}"
        swing_clip_map.setdefault(hid, []).append({
            "id": cid,
            "label": label
        })



    conn.close()

    return templates.TemplateResponse(
        "matchup_multi_select.html",
        {
            "request": request,
            "sid": sid,
            "teams": teams,
            "pitcher_map": pitcher_map,
            "pitch_clip_map": pitch_clip_map,
            "hitter_map": hitter_map,
            "swing_clip_map": swing_clip_map,
        }
    )
