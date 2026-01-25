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

@router.get("/hitters", response_class=HTMLResponse)
def hitters_page(request: Request, sid: str = "x"):
    conn = db()
    rows = conn.execute("""
        SELECT
            hitters.id,
            hitters.name,
            hitters.description,
            teams.name
        FROM hitters
        JOIN teams ON hitters.team_id = teams.id
        ORDER BY teams.name, hitters.name
    """).fetchall()
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

@router.get("/pitchers", response_class=HTMLResponse)
def pitchers_page(request: Request, sid: str = "x"):
    conn = db()
    rows = conn.execute("""
        SELECT
            pitchers.id,
            pitchers.name,
            pitchers.description,
            teams.name
        FROM pitchers
        JOIN teams ON pitchers.team_id = teams.id
        ORDER BY teams.name, pitchers.name
    """).fetchall()
    teams = conn.execute("SELECT id, name FROM teams ORDER BY name").fetchall()
    conn.close()

    return templates.TemplateResponse(
        "manage_entities.html",
        {"request": request, "sid": sid, "view": "pitchers", "items": rows, "teams": teams},
    )

@router.post("/pitchers/add")
def pitchers_add(
    name: str = Form(...),
    description: str = Form(""),
    team_id: int = Form(...),
    sid: str = Form("x")
):
    conn = db()
    conn.execute(
        "INSERT INTO pitchers (name, description, team_id) VALUES (?, ?, ?)",
        (name, description, team_id)
    )
    conn.commit()
    conn.close()

    return RedirectResponse(f"/pitchers?sid={sid}", status_code=303)

@router.post("/pitchers/delete")
def pitchers_delete(item_id: int = Form(...), sid: str = Form("x")):
    conn = db()
    conn.execute("DELETE FROM pitchers WHERE id=?", (item_id,))
    conn.commit()
    conn.close()

    return RedirectResponse(f"/pitchers?sid={sid}", status_code=303)
