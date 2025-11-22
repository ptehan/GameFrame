from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from utils.db import db

router = APIRouter()
templates = Jinja2Templates("templates")


# ------------------------------------------------------------
# GET /library/matchups
# Full filtering:
#   pitcher team → pitcher → pitch
#   hitter team → hitter → swing
# ------------------------------------------------------------
@router.get("/library/matchups", response_class=HTMLResponse)
def library_matchups(
    request: Request,
    sid: str = "x",
    pitcher_team: str = "all",
    pitcher_id: str = "all",
    pitch_id: str = "all",
    hitter_team: str = "all",
    hitter_id: str = "all",
    swing_id: str = "all",
):

    conn = db()
    cur = conn.cursor()

    # ------------------------------------------------------------
    # FETCH TEAMS
    # ------------------------------------------------------------
    teams = cur.execute("SELECT id, name FROM teams ORDER BY name").fetchall()

    # ------------------------------------------------------------
    # FETCH PITCHERS (filtered)
    # ------------------------------------------------------------
    if pitcher_team == "all":
        pitchers = cur.execute("SELECT id, name, team_id FROM pitchers ORDER BY name").fetchall()
    else:
        pitchers = cur.execute(
            "SELECT id, name, team_id FROM pitchers WHERE team_id=? ORDER BY name",
            (pitcher_team,)
        ).fetchall()

    # ------------------------------------------------------------
    # FETCH HITTERS (filtered)
    # ------------------------------------------------------------
    if hitter_team == "all":
        hitters = cur.execute("SELECT id, name, team_id FROM hitters ORDER BY name").fetchall()
    else:
        hitters = cur.execute(
            "SELECT id, name, team_id FROM hitters WHERE team_id=? ORDER BY name",
            (hitter_team,)
        ).fetchall()

    # ------------------------------------------------------------
    # FETCH PITCH CLIPS (filtered)
    # ------------------------------------------------------------
    pitch_query = """
        SELECT id, team_id, pitcher_id, description, fps, created_at
        FROM pitch_clips
    """
    pitch_params = []
    pitch_filters = []

    if pitcher_id != "all":
        pitch_filters.append("pitcher_id=?")
        pitch_params.append(pitcher_id)

    if pitcher_team != "all":
        pitch_filters.append("team_id=?")
        pitch_params.append(pitcher_team)

    if pitch_filters:
        pitch_query += " WHERE " + " AND ".join(pitch_filters)

    pitch_query += " ORDER BY created_at DESC"
    pitch_clips = cur.execute(pitch_query, pitch_params).fetchall()

    # ------------------------------------------------------------
    # FETCH SWING CLIPS (filtered)
    # ------------------------------------------------------------
    swing_query = """
        SELECT id, team_id, hitter_id, description, fps, created_at
        FROM swing_clips
    """
    swing_params = []
    swing_filters = []

    if hitter_id != "all":
        swing_filters.append("hitter_id=?")
        swing_params.append(hitter_id)

    if hitter_team != "all":
        swing_filters.append("team_id=?")
        swing_params.append(hitter_team)

    if swing_filters:
        swing_query += " WHERE " + " AND ".join(swing_filters)

    swing_query += " ORDER BY created_at DESC"
    swing_clips = cur.execute(swing_query, swing_params).fetchall()

    # ------------------------------------------------------------
    # FETCH MATCHUPS
    # ------------------------------------------------------------
    matchups = cur.execute(
        """
        SELECT 
            m.id, 
            m.pitch_clip_id, 
            m.swing_clip_id, 
            m.description, 
            m.created_at,
    
            pt.team_name AS pitcher_team,
            pt.pitcher_name AS pitcher_name,
            ht.team_name AS hitter_team,
            ht.hitter_name AS hitter_name
    
        FROM matchups m
    
        JOIN (
            SELECT 
                pc.id AS pitch_clip_id,
                t.name AS team_name,
                p.name AS pitcher_name
            FROM pitch_clips pc
            JOIN pitchers p ON p.id = pc.pitcher_id
            JOIN teams t ON t.id = p.team_id
        ) pt ON pt.pitch_clip_id = m.pitch_clip_id
    
        JOIN (
            SELECT 
                sc.id AS swing_clip_id,
                t.name AS team_name,
                h.name AS hitter_name
            FROM swing_clips sc
            JOIN hitters h ON h.id = sc.hitter_id
            JOIN teams t ON t.id = h.team_id
        ) ht ON ht.swing_clip_id = m.swing_clip_id
    
        ORDER BY m.created_at DESC
        """
    ).fetchall()

    conn.close()

    return templates.TemplateResponse(
        "library_matchups.html",
        {
            "request": request,
            "sid": sid,

            # all filter sources
            "teams": teams,
            "pitchers": pitchers,
            "hitters": hitters,
            "pitch_clips": pitch_clips,
            "swing_clips": swing_clips,

            # current filter values
            "pitcher_team": pitcher_team,
            "pitcher_id": pitcher_id,
            "pitch_id": pitch_id,
            "hitter_team": hitter_team,
            "hitter_id": hitter_id,
            "swing_id": swing_id,

            # matchups
            "matchups": matchups,
        }
    )
