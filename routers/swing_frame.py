from fastapi import APIRouter, Response
import cv2
import io
import os
import tempfile

router = APIRouter()

TEMP_DIR = tempfile.gettempdir()

def temp_path(id):
    return os.path.join(TEMP_DIR, f"gf_{id}.mp4")


@router.get("/frame/swing")
def frame_swing(id: str, frame: int):

    path = temp_path(id)
    if not os.path.exists(path):
        return Response(content=b"missing temp file", status_code=404)

    cap = cv2.VideoCapture(path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame)
    ret, img = cap.read()
    cap.release()

    if not ret:
        return Response(content=b"bad frame", status_code=404)

    ok, jpeg = cv2.imencode(".jpg", img)
    return Response(content=jpeg.tobytes(), media_type="image/jpeg")
