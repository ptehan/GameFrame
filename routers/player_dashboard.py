from fastapi import APIRouter, Request, Form
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse
from utils.db import db

import cv2
import math
import os
import tempfile

router = APIRouter()
templates = Jinja2Templates("templates")


@router.post("/dashboard/player/swing/delete")
def dashboard_delete_swing(
    sid: str = Form("x"),
    tid: int = Form(0),
    hid: int = Form(0),
    swing_id: int = Form(...),
):
    conn = db()
    try:
        conn.execute("BEGIN")
        conn.execute("DELETE FROM matchups WHERE swing_clip_id=?", (swing_id,))
        conn.execute("DELETE FROM swing_clips WHERE id=?", (swing_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return RedirectResponse(
        f"/dashboard/player?sid={sid}&tid={tid}&hid={hid}",
        status_code=303,
    )


def _ensure_metric_columns(conn):
    cols = {
        row[1] for row in conn.execute("PRAGMA table_info(swing_clips)").fetchall()
    }
    changed = False
    if "frame_count" not in cols:
        conn.execute("ALTER TABLE swing_clips ADD COLUMN frame_count INTEGER")
        changed = True
    if "swing_seconds" not in cols:
        conn.execute("ALTER TABLE swing_clips ADD COLUMN swing_seconds REAL")
        changed = True
    if changed:
        conn.commit()


def _extract_swing_metrics(blob, declared_fps):
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
    try:
        with open(tmp, "wb") as f:
            f.write(blob)

        cap = cv2.VideoCapture(tmp)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        detected_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
        cap.release()

        fps = float(declared_fps or 0)
        if fps <= 0:
            fps = detected_fps if detected_fps > 0 else 30.0
        swing_seconds = (frame_count / fps) if (frame_count > 0 and fps > 0) else 0.0
        return frame_count, fps, swing_seconds
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _pct(sorted_vals, p):
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return float(sorted_vals[0])
    pos = (len(sorted_vals) - 1) * p
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return float(sorted_vals[lo])
    frac = pos - lo
    return float(sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac)


def _build_summary(swings):
    if not swings:
        return None

    vals = [float(s["swing_seconds"]) for s in swings if s["swing_seconds"] > 0]
    if not vals:
        return None

    vals_sorted = sorted(vals)
    n = len(vals_sorted)
    avg = sum(vals_sorted) / n
    median = _pct(vals_sorted, 0.5)
    p10 = _pct(vals_sorted, 0.10)
    p25 = _pct(vals_sorted, 0.25)
    p75 = _pct(vals_sorted, 0.75)
    p90 = _pct(vals_sorted, 0.90)
    iqr = p75 - p25
    stddev = math.sqrt(sum((v - avg) * (v - avg) for v in vals_sorted) / n)
    cv = (stddev / avg) if avg > 0 else 0.0
    consistency = max(0.0, min(100.0, 100.0 - (cv * 100.0)))

    low_fence = p25 - (1.5 * iqr)
    high_fence = p75 + (1.5 * iqr)
    outlier_count = sum(1 for v in vals_sorted if v < low_fence or v > high_fence)

    oldest_to_newest = list(reversed(vals))
    if len(oldest_to_newest) >= 2:
        x_mean = (len(oldest_to_newest) - 1) / 2
        y_mean = sum(oldest_to_newest) / len(oldest_to_newest)
        num = 0.0
        den = 0.0
        for i, y in enumerate(oldest_to_newest):
            dx = i - x_mean
            num += dx * (y - y_mean)
            den += dx * dx
        trend_per_swing = (num / den) if den else 0.0
    else:
        trend_per_swing = 0.0

    recent = vals[:10]
    return {
        "count": n,
        "min": min(vals_sorted),
        "max": max(vals_sorted),
        "range": max(vals_sorted) - min(vals_sorted),
        "avg": avg,
        "median": median,
        "stddev": stddev,
        "cv": cv,
        "p10": p10,
        "p25": p25,
        "p75": p75,
        "p90": p90,
        "iqr": iqr,
        "outlier_count": outlier_count,
        "consistency_score": consistency,
        "last10_avg": (sum(recent) / len(recent)) if recent else avg,
        "trend_per_swing": trend_per_swing,
        "series_desc": vals,
    }


@router.get("/dashboard/player", response_class=HTMLResponse)
def player_dashboard(request: Request, tid: int = 0, hid: int = 0, sid: str = "x", pq: str = ""):
    conn = db()
    cur = conn.cursor()
    _ensure_metric_columns(conn)

    teams = cur.execute("SELECT id, name FROM teams ORDER BY name").fetchall()

    player_query = (pq or "").strip().lower()
    hitters = []
    selected_hitter = None
    if tid:
        hitters = cur.execute(
            """
            SELECT
                h.id,
                h.name,
                h.team_id,
                t.name AS team_name,
                COUNT(sc.id) AS swing_count,
                MAX(sc.created_at) AS last_swing_at
            FROM hitters h
            JOIN teams t ON t.id = h.team_id
            LEFT JOIN swing_clips sc ON sc.hitter_id = h.id
            WHERE h.team_id = ?
            GROUP BY h.id, h.name, h.team_id, t.name
            ORDER BY t.name, h.name
            """,
            (tid,),
        ).fetchall()
    else:
        hitters = cur.execute(
            """
            SELECT
                h.id,
                h.name,
                h.team_id,
                t.name AS team_name,
                COUNT(sc.id) AS swing_count,
                MAX(sc.created_at) AS last_swing_at
            FROM hitters h
            JOIN teams t ON t.id = h.team_id
            LEFT JOIN swing_clips sc ON sc.hitter_id = h.id
            GROUP BY h.id, h.name, h.team_id, t.name
            ORDER BY t.name, h.name
            """
        ).fetchall()

    if player_query:
        hitters = [h for h in hitters if player_query in (h[1] or "").lower()]

    if hid:
        selected_hitter = cur.execute(
            """
            SELECT h.id, h.name, t.name
            FROM hitters h
            JOIN teams t ON t.id = h.team_id
            WHERE h.id=?
            """,
            (hid,),
        ).fetchone()

    swings_view = []
    if hid:
        swing_cols = {row[1] for row in cur.execute("PRAGMA table_info(swing_clips)").fetchall()}
        has_pose_data_col = "pose_data" in swing_cols
        matchup_rows = cur.execute(
            """
            SELECT swing_clip_id, COUNT(*) AS c, MAX(id) AS latest_id
            FROM matchups
            WHERE swing_clip_id IS NOT NULL
            GROUP BY swing_clip_id
            """
        ).fetchall()
        matchup_by_swing = {
            int(r[0]): {"count": int(r[1] or 0), "latest_id": int(r[2]) if r[2] is not None else None}
            for r in matchup_rows
            if r[0] is not None
        }

        rows = cur.execute(
            f"""
            SELECT id, description, fps, decision_frame, created_at, frame_count, swing_seconds,
                   {"CASE WHEN pose_data IS NOT NULL AND pose_data <> '' THEN 1 ELSE 0 END" if has_pose_data_col else "0"} AS has_pose_data,
                   clip_blob
            FROM swing_clips
            WHERE hitter_id=?
            ORDER BY created_at DESC
            """,
            (hid,),
        ).fetchall()

        for row in rows:
            swing_id, desc, fps, decision_frame, created_at, frame_count, swing_seconds, has_pose_data, blob = row

            bad_metrics = (
                not frame_count
                or frame_count <= 0
                or not swing_seconds
                or swing_seconds <= 0
                or not fps
                or fps <= 0
            )
            if bad_metrics and blob:
                frame_count, fps, swing_seconds = _extract_swing_metrics(blob, fps)
                cur.execute(
                    """
                    UPDATE swing_clips
                    SET frame_count=?, fps=?, swing_seconds=?
                    WHERE id=?
                    """,
                    (frame_count, fps, swing_seconds, swing_id),
                )

            decision_seconds = None
            decision_pct = None
            if fps and fps > 0 and decision_frame is not None:
                decision_seconds = float(decision_frame) / float(fps)
                if swing_seconds and swing_seconds > 0:
                    decision_pct = (decision_seconds / swing_seconds) * 100.0

            swings_view.append(
                {
                    "id": swing_id,
                    "description": (desc or "").strip() or "(no description)",
                    "fps": float(fps or 0),
                    "decision_frame": decision_frame,
                    "decision_seconds": decision_seconds,
                    "decision_pct": decision_pct,
                    "created_at": created_at,
                    "frame_count": int(frame_count or 0),
                    "swing_seconds": float(swing_seconds or 0),
                    "has_pose_data": int(has_pose_data or 0),
                    "matchup_count": matchup_by_swing.get(int(swing_id), {}).get("count", 0),
                    "latest_matchup_id": matchup_by_swing.get(int(swing_id), {}).get("latest_id"),
                }
            )

    summary = _build_summary(swings_view)
    conn.commit()
    conn.close()

    return templates.TemplateResponse(
        "dashboard_player.html",
        {
            "request": request,
            "sid": sid,
            "teams": teams,
            "tid": tid,
            "pq": pq,
            "hitters": hitters,
            "hid": hid,
            "selected_hitter": selected_hitter,
            "results": swings_view,
            "summary": summary,
        },
    )
