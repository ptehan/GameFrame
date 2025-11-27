# routers/youtube_import.py

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, FileResponse, PlainTextResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

import os
import uuid
import subprocess
import re
import tempfile
from yt_dlp import YoutubeDL

router = APIRouter()
templates = Jinja2Templates("templates")

# Verified ffmpeg path
import shutil

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"


@router.get("/import/youtube", response_class=HTMLResponse)
def youtube_import_page(request: Request):
    return templates.TemplateResponse("import_youtube.html", {"request": request})


async def get_direct_mp4(video_id: str):
    """Get a direct playable MP4 URL without downloading."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    opts = {
        "quiet": True,
        "skip_download": True,
        "format": "mp4"
    }
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return info["url"]


# ======================================================================
# OLD — Direct Download (kept, unchanged)
# ======================================================================
@router.get("/stream/youtube")
async def youtube_stream(url: str, start: float = 0):
    # ---- Extract YouTube video ID ----
    m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    if not m:
        return PlainTextResponse("Invalid YouTube URL", status_code=400)

    video_id = m.group(1)

    # ---- Get actual MP4 stream URL from YouTube ----
    direct = await get_direct_mp4(video_id)

    # ---- Prepare output path ----
    os.makedirs("temp", exist_ok=True)
    out = f"temp/{uuid.uuid4().hex}.mp4"

    # ---- Trim 5 seconds using ffmpeg ----
    subprocess.run([
        FFMPEG,
        "-y",
        "-ss", str(start),
        "-t", "5",
        "-i", direct,
        "-c", "copy",
        out
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # ---- Return file as a download (Save As dialog appears) ----
    return FileResponse(
        path=out,
        media_type="video/mp4",
        filename="youtube_clip.mp4"
    )


# ======================================================================
# NEW — Create temp clip and redirect into existing PITCH/SWING upload
# ======================================================================
@router.get("/import/youtube/make_clip")
async def youtube_make_clip(type: str, url: str, start: float = 0):
    """
    Create a 5-second temp clip and route into the correct upload workflow.
    type = 'pitch' | 'swing'
    """

    # Validate route
    if type not in ("pitch", "swing"):
        return PlainTextResponse("Invalid type", status_code=400)

    # Extract video ID
    m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    if not m:
        return PlainTextResponse("Invalid YouTube URL", status_code=400)

    video_id = m.group(1)

    # Get direct MP4 stream
    direct = await get_direct_mp4(video_id)

    # Use SAME temp directory your uploads already use
    temp_id = uuid.uuid4().hex
    temp_path = os.path.join(tempfile.gettempdir(), f"gf_{temp_id}.mp4")

    # 5-second trim
    subprocess.run([
        FFMPEG,
        "-y",
        "-ss", str(start),
        "-t", "5",
        "-i", direct,
        "-c", "copy",
        temp_path
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Redirect to appropriate upload workflow
    if type == "pitch":
        redirect_url = f"/upload/pitch?from_yt=1&temp_id={temp_id}"
    else:
        redirect_url = f"/upload/swing?from_yt=1&temp_id={temp_id}"

    return RedirectResponse(redirect_url, status_code=303)

@router.get("/import/youtube/tempfile")
def youtube_tempfile(temp_id: str):
    path = os.path.join(tempfile.gettempdir(), f"gf_{temp_id}.mp4")

    if not os.path.exists(path):
        return PlainTextResponse("Temp file not found", status_code=404)

    return FileResponse(path, media_type="video/mp4")