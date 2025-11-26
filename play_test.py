import streamlit as st
import sqlite3
import base64
import tempfile
import subprocess
import os
import imageio_ffmpeg as ffmpeg  # ✅ provides ffmpeg binary inside venv

DB_PATH = "app.db"

st.set_page_config(page_title="Video Test", layout="wide")
st.title("🎞️ Minimal DB Video Test (FFmpeg bundled binary)")

# ---------- Connect to database ----------
conn = sqlite3.connect(DB_PATH, check_same_thread=False)
cur = conn.cursor()

row = cur.execute(
    "SELECT id, description, matchup_blob FROM matchups ORDER BY id DESC LIMIT 1"
).fetchone()
if not row:
    st.error("No matchups found in database.")
    st.stop()

matchup_id, desc, blob = row
st.write(f"Showing Matchup {matchup_id}: {desc or '(no description)'}")

# ---------- Write blob to temp file ----------
orig_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
orig_tmp.write(blob)
orig_tmp.close()

# ---------- Re-encode with FFmpeg (H.264 for browser playback) ----------
ffmpeg_path = ffmpeg.get_ffmpeg_exe()
reencoded_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
reencoded_tmp.close()

cmd = [
    ffmpeg_path,
    "-y",
    "-i", orig_tmp.name,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-an",
    reencoded_tmp.name,
]

try:
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
except subprocess.CalledProcessError as e:
    st.error("❌ FFmpeg failed to convert video.")
    st.text(e.stderr.decode())
    st.stop()

# ---------- Read converted video ----------
with open(reencoded_tmp.name, "rb") as f:
    fixed_bytes = f.read()

# ---------- Inline preview (fits screen) ----------
b64 = base64.b64encode(fixed_bytes).decode()
st.markdown(
    f"""
    <div style="
        display:flex;
        justify-content:center;
        align-items:center;
        height:80vh;                /* total vertical space to use (80% of screen) */
        overflow:hidden;
    ">
        <video
            controls
            autoplay
            muted
            playsinline
            style="
                max-height:100%;
                max-width:100%;
                object-fit:contain;
                border-radius:12px;
                outline:none;
            "
        >
            <source src="data:video/mp4;base64,{b64}" type="video/mp4">
        </video>
    </div>
    """,
    unsafe_allow_html=True,
)

# ---------- Download button ----------
st.download_button(
    "⬇️ Download Matchup Video",
    fixed_bytes,
    file_name=f"matchup_{matchup_id}.mp4",
    mime="video/mp4",
)

st.success("✅ Transcoded with bundled FFmpeg (H.264 / yuv420p) — should play and download cleanly")

# ---------- Cleanup temp files ----------
for fpath in (orig_tmp.name, reencoded_tmp.name):
    try:
        os.unlink(fpath)
    except Exception:
        pass
