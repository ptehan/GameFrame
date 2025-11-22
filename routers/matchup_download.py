from fastapi import APIRouter, Request
from fastapi.responses import Response, HTMLResponse
from utils.db import db
import tempfile
import cv2
import os

router = APIRouter()


# ------------------------------------------------------------
# DOWNLOAD: FULL MATCHUP VIDEO
# ------------------------------------------------------------
@router.get("/download/matchup")
def download_matchup(id: int):
    conn = db()
    row = conn.execute(
        "SELECT matchup_blob FROM matchups WHERE id=?",
        (id,)
    ).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("Matchup not found", status_code=404)

    blob = row[0]

    return Response(
        content=blob,
        media_type="video/mp4",
        headers={
            "Content-Disposition": f'attachment; filename="matchup_{id}.mp4"'
        }
    )


# ------------------------------------------------------------
# INTERNAL: Extract a frame JPG from a blob
# ------------------------------------------------------------
def extract_frame_jpg(blob, frame_index):
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
    with open(tmp, "wb") as f:
        f.write(blob)

    cap = cv2.VideoCapture(tmp)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ret, fr = cap.read()
    cap.release()
    try:
        os.remove(tmp)
    except:
        pass

    if not ret or fr is None:
        return None

    ok, jpg = cv2.imencode(".jpg", fr)
    if not ok:
        return None

    return jpg.tobytes()


# ------------------------------------------------------------
# DOWNLOAD: PITCHER START FRAME
# (frame index = 0)
# ------------------------------------------------------------
@router.get("/download/pitch_start")
def download_pitch_start(id: int):
    conn = db()
    row = conn.execute(
        """
        SELECT pitch_clips.clip_blob
        FROM matchups
        JOIN pitch_clips ON matchups.pitch_clip_id = pitch_clips.id
        WHERE matchups.id=?
        """,
        (id,)
    ).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("Matchup or pitch clip not found", status_code=404)

    blob = row[0]
    jpg = extract_frame_jpg(blob, 0)
    if jpg is None:
        return HTMLResponse("Could not extract frame", status_code=500)

    return Response(
        content=jpg,
        media_type="image/jpeg",
        headers={
            "Content-Disposition": f'attachment; filename="pitch_start_{id}.jpg"'
        }
    )


# ------------------------------------------------------------
# DOWNLOAD: PITCHER DECISION FRAME
# MATCHUP stores the decision frame OFFSET relative to trimmed swing,
# but for the pitch video, decision=yellow frames offset is irrelevant.
#
# We simply use the same *index* used for the green overlay step.
# Meaning: frame index = stored decision_frame + padding already applied.
# ------------------------------------------------------------
@router.get("/download/pitch_decision")
def download_pitch_decision(id: int):
    conn = db()
    row = conn.execute(
        """
        SELECT pitch_clips.clip_blob,
               swing_clips.decision_frame
        FROM matchups
        JOIN pitch_clips ON matchups.pitch_clip_id = pitch_clips.id
        JOIN swing_clips ON matchups.swing_clip_id = swing_clips.id
        WHERE matchups.id=?
        """,
        (id,)
    ).fetchone()
    conn.close()

    if not row:
        return HTMLResponse("Matchup not found", status_code=404)

    pitch_blob, decision_frame = row

    if decision_frame < 0:
        decision_frame = 0

    jpg = extract_frame_jpg(pitch_blob, decision_frame)
    if jpg is None:
        return HTMLResponse("Could not extract frame", status_code=500)

    return Response(
        content=jpg,
        media_type="image/jpeg",
        headers={
            "Content-Disposition": f'attachment; filename="pitch_decision_{id}.jpg"'
        }
    )
