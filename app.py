from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.base import BaseHTTPMiddleware

# -------------------------------------------------
# FASTAPI APP
# -------------------------------------------------
app = FastAPI(title="GameFrame")

# -------------------------------------------------
# REQUIRED FOR SharedArrayBuffer / ffmpeg.wasm
# -------------------------------------------------
class COOPCOEPMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        return response

app.add_middleware(COOPCOEPMiddleware)

# -------------------------------------------------
# STATIC + TEMPLATES
# -------------------------------------------------
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

from fastapi.responses import FileResponse

# -------------------------------------------------
# MANIFEST + SERVICE WORKER
# -------------------------------------------------
@app.get("/manifest.json", include_in_schema=False)
def manifest():
    return FileResponse("static/manifest.json", media_type="application/manifest+json")

@app.get("/service-worker.js", include_in_schema=False)
def service_worker():
    return FileResponse("static/service-worker.js", media_type="application/javascript")

# -------------------------------------------------
# HOMEPAGE
# -------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# -------------------------------------------------
# ROUTERS
# -------------------------------------------------
from routers import (
    admin,
    library,
    matchup_routes,
    pitch_routes,
    swing_routes,
    external_video,
    player_dashboard
)

app.include_router(admin.router)
app.include_router(library.router)
app.include_router(matchup_routes.router)
app.include_router(pitch_routes.router)
app.include_router(swing_routes.router)
app.include_router(external_video.router)
app.include_router(player_dashboard.router)


# -------------------------------------------------
# DEBUG: show all routes
# -------------------------------------------------
@app.get("/debug/routes")
def list_routes():
    routes = []
    for r in app.routes:
        if hasattr(r, "path") and hasattr(r, "endpoint"):
            mod = r.endpoint.__module__
            routes.append({
                "path": r.path,
                "methods": list(r.methods),
                "module": mod
            })
    return routes
