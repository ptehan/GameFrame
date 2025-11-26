from fastapi import APIRouter
from fastapi.responses import Response, HTMLResponse
from utils.db import db

router = APIRouter()

@router.get("/thumbnail/matchup")
def thumbnail_matchup(id: int):
    conn = db()
    row = conn.execute(
        "SELECT thumb FROM matchups WHERE id=?",
        (id,)
    ).fetchone()
    conn.close()

    if not row or row[0] is None:
        return HTMLResponse("not found", status_code=404)

    return Response(
        content=row[0],
        media_type="image/jpeg",
        headers={
            "Content-Disposition": f'inline; filename="thumb_{id}.jpg"'
        }
    )
