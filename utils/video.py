import cv2
import numpy as np
import imageio_ffmpeg as ffmpeg
import subprocess
import os

def encode_raw_frames_to_mp4(frames, fps, out_path):
    """
    Encode a list of BGR frames to MP4 using ffmpeg.
    frames: list of np.ndarray (H,W,3)
    fps: float
    out_path: target mp4 file path
    """

    if not frames:
        raise ValueError("encode_raw_frames_to_mp4: no frames provided")

    h, w = frames[0].shape[:2]

    raw_path = out_path + ".yuv"

    # write raw bgr frames
    with open(raw_path, "wb") as f:
        for fr in frames:
            f.write(fr.astype(np.uint8).tobytes())

    exe = ffmpeg.get_ffmpeg_exe()

    cmd = [
        exe,
        "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{w}x{h}",
        "-r", str(fps),
        "-i", raw_path,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        out_path,
    ]

    subprocess.run(cmd, check=True)

    if os.path.exists(raw_path):
        os.remove(raw_path)
