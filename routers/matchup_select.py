from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from utils.db import db

router = APIRouter()
templates = Jinja2Templates("templates")


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
        "SELECT id, pitcher_id, description, fps, created_at "
        "FROM pitch_clips ORDER BY created_at DESC"
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
        "SELECT id, hitter_id, description, fps, created_at "
        "FROM swing_clips ORDER BY created_at DESC"
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
