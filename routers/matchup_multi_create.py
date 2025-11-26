# routers/matchup_multi_create.py
from fastapi import APIRouter, Form
from fastapi.responses import RedirectResponse

router = APIRouter()

@router.post("/matchup/multi_create")
def matchup_multi_create(
    sid: str = Form("x"),
    pitchA_id: int = Form(...),
    pitchB_id: int = Form(...),
    swing_id: int = Form(...),
    description: str = Form("")
):
    return RedirectResponse(
        f"/matchup/multi_build?sid={sid}&pitchA_id={pitchA_id}&pitchB_id={pitchB_id}&swing_id={swing_id}&description={description}",
        status_code=303
    )
