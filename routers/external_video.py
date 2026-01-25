# routers/external_video.py

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

router = APIRouter()
templates = Jinja2Templates(directory="templates")


@router.get("/external_video", response_class=HTMLResponse)
def external_video_page(request: Request):
    return templates.TemplateResponse(
        "external_video.html",
        {"request": request}
    )
