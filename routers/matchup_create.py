from fastapi import APIRouter, Form
from fastapi.responses import RedirectResponse

router = APIRouter()

# ============================================================
# RECEIVE POST FROM matchup_select.html
# REDIRECT INTO /matchup/build WITH QUERY PARAMS
# ============================================================
@router.post("/matchup/create")
def matchup_create(
    sid: str = Form("x"),
    pitch_id: int = Form(...),
    swing_id: int = Form(...),
    description: str = Form("")
):
    print("DEBUG >>> MATCHUP CREATE CALLED")
    print("DEBUG >>> pitch_id:", pitch_id)
    print("DEBUG >>> swing_id:", swing_id)
    print("DEBUG >>> description:", description)

    # Redirect to the GET /matchup/build route
    # (matchup_build.py now correctly uses @router.get("/matchup/build"))
    return RedirectResponse(
        f"/matchup/build?sid={sid}&pitch_id={pitch_id}&swing_id={swing_id}&description={description}",
        status_code=303
    )
