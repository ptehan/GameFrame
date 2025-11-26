from fastapi import APIRouter, Form
from fastapi.responses import RedirectResponse
from utils.db import db

router = APIRouter()

@router.post("/matchup/multi_delete")
def multi_matchup_delete(id: int = Form(...), sid: str = Form("x")):
    conn = db()
    conn.execute("DELETE FROM multi_matchups WHERE id=?", (id,))
    conn.commit()
    conn.close()

    return RedirectResponse(f"/library/multi_matchups?sid={sid}", status_code=303)
