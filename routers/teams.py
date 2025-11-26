from fastapi import APIRouter, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from utils.db import db

router = APIRouter()
templates = Jinja2Templates("templates")

@router.get("/teams", response_class=HTMLResponse)
def teams_page(request: Request, sid: str = "x"):
    conn = db()
    rows = conn.execute(
        "SELECT id, name, description FROM teams ORDER BY name"
    ).fetchall()
    conn.close()

    return templates.TemplateResponse(
        "manage_entities.html",
        {"request": request, "sid": sid, "view": "teams", "items": rows},
    )

@router.post("/teams/add")
def teams_add(name: str = Form(...), description: str = Form(""), sid: str = Form("x")):
    conn = db()
    conn.execute(
        "INSERT INTO teams (name, description) VALUES (?, ?)",
        (name, description)
    )
    conn.commit()
    conn.close()
    return RedirectResponse(f"/teams?sid={sid}", status_code=303)

@router.post("/teams/delete")
def teams_delete(item_id: int = Form(...), sid: str = Form("x")):
    conn = db()
    conn.execute("DELETE FROM teams WHERE id=?", (item_id,))
    conn.commit()
    conn.close()
    return RedirectResponse(f"/teams?sid={sid}", status_code=303)
