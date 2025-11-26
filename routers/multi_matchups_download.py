from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from utils.db import db
import io

router = APIRouter()

@router.get("/download/multi_matchup")
def download_multi_matchup(id: int):
    conn = db()
    row = conn.execute(
        "SELECT matchup_blob FROM multi_matchups WHERE id=?",
        (id,)
    ).fetchone()
    conn.close()

    if not row:
        return "Not found"

    blob = row[0]
    return StreamingResponse(
        io.BytesIO(blob),
        media_type="video/mp4",
        headers={
            "Content-Disposition": f"attachment; filename=multi_matchup_{id}.mp4"
        }
    )
