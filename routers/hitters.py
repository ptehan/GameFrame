from fastapi import APIRouter, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from utils.db import db

router = APIRouter()
templates = Jinja2Templates("templates")

@router.get("/hitters", response_class=HTMLResponse)
def hitters_page(request: Request, sid: str = "x"):
    conn = db()
    rows = conn.execute(
        "SELECT id, name, description, team_id FROM hitters ORDER BY name"
    ).fetchall()
    teams = conn.execute("SELECT id, name FROM teams ORDER BY name").fetchall()
    conn.close()

    return templates.TemplateResponse(
        "manage_entities.html",
        {"request": request, "sid": sid, "view": "hitters", "items": rows, "teams": teams},
    )

@router.post("/hitters/add")
def hitters_add(
    name: str = Form(...),
    description: str = Form(""),
    team_id: int = Form(...),
    sid: str = Form("x")
):
    conn = db()
    conn.execute(
        "INSERT INTO hitters (name, description, team_id) VALUES (?, ?, ?)",
        (name, description, team_id)
    )
    conn.commit()
    conn.close()

    return RedirectResponse(f"/hitters?sid={sid}", status_code=303)

@router.post("/hitters/delete")
def hitters_delete(item_id: int = Form(...), sid: str = Form("x")):
    conn = db()
    conn.execute("DELETE FROM hitters WHERE id=?", (item_id,))
    conn.commit()
    conn.close()

    return RedirectResponse(f"/hitters?sid={sid}", status_code=303)
