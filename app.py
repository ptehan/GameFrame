print(">>> LOADING GAMEFRAMEFASTAPI <<<")

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
import sqlite3

# ------------------------------------------------------------
# DB
# ------------------------------------------------------------
DB_PATH = "app.db"

def db():
    return sqlite3.connect(DB_PATH, check_same_thread=False)

# ------------------------------------------------------------
# APP / STATIC / TEMPLATES
# ------------------------------------------------------------
app = FastAPI(debug=True)
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# ------------------------------------------------------------
# TEAMS / PITCHERS / HITTERS
# ------------------------------------------------------------
from routers.teams import router as teams_router
from routers.pitchers import router as pitchers_router
from routers.hitters import router as hitters_router

# ------------------------------------------------------------
# PITCH ROUTERS
# ------------------------------------------------------------
from routers.pitch_upload import router as pitch_upload_router
from routers.pitch_library import router as pitch_library_router
from routers.pitch_frame import router as pitch_frame_router

# ------------------------------------------------------------
# SWING ROUTERS
# ------------------------------------------------------------
from routers.swing_upload import router as swing_upload_router
from routers.swing_library import router as swing_library_router
from routers.swing_frame import router as swing_frame_router

# ------------------------------------------------------------
# MATCHUP ROUTERS (EXACTLY WHAT’S IN YOUR FOLDER)
# ------------------------------------------------------------
from routers.matchup_build import router as matchup_build_router
from routers.matchup_create import router as matchup_create_router
from routers.matchup_delete import router as matchup_delete_router
from routers.matchup_download import router as matchup_download_router
from routers.matchup_library import router as matchup_library_router
from routers.matchup_play import router as matchup_play_router
from routers.matchup_select import router as matchup_select_router
from routers.matchup_thumbnail import router as matchup_thumbnail_router
from routers.matchup_multi_select import router as matchup_multi_select_router
from routers.matchup_multi_create import router as matchup_multi_create_router
from routers.matchup_multi_build import router as matchup_multi_build_router
from routers.multi_matchups_library import router as multi_matchups_library_router
from routers.multi_matchups_thumbnail import router as multi_matchups_thumbnail_router
from routers.play_multi_matchup import router as play_multi_matchup_router
from routers.multi_matchups_delete import router as multi_matchups_delete_router
from routers.player_dashboard import router as player_dashboard_router
from routers.multi_matchups_download import router as multi_matchups_download_router
from routers.youtube_import import router as youtube_import_router
from routers.library import router as library_router

# ------------------------------------------------------------
# INCLUDE ROUTERS
# ------------------------------------------------------------
app.include_router(teams_router)
app.include_router(pitchers_router)
app.include_router(hitters_router)

app.include_router(pitch_upload_router)
app.include_router(pitch_library_router)
app.include_router(pitch_frame_router)

app.include_router(swing_upload_router)
app.include_router(swing_library_router)
app.include_router(swing_frame_router)

app.include_router(matchup_build_router)
app.include_router(matchup_create_router)
app.include_router(matchup_delete_router)
app.include_router(matchup_download_router)
app.include_router(matchup_library_router)
app.include_router(matchup_play_router)
app.include_router(matchup_select_router)
app.include_router(matchup_thumbnail_router)

app.include_router(matchup_multi_select_router)
app.include_router(matchup_multi_create_router)
app.include_router(matchup_multi_build_router)
app.include_router(multi_matchups_library_router)
app.include_router(multi_matchups_thumbnail_router)
app.include_router(play_multi_matchup_router)
app.include_router(multi_matchups_delete_router)
app.include_router(player_dashboard_router)
app.include_router(multi_matchups_download_router)
app.include_router(youtube_import_router)
app.include_router(library_router)
# ------------------------------------------------------------
# HOME PAGE
# ------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})
