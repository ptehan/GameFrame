import sqlite3
import tempfile
import cv2
import os

DB_PATH = "app.db"

print("🔍 Connecting to database:", DB_PATH)
conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

row = cur.execute(
    "SELECT id, description, matchup_blob FROM matchups ORDER BY id DESC LIMIT 1"
).fetchone()

if not row:
    print("❌ No matchups found in database.")
    exit()

matchup_id, desc, blob = row
print(f"\n✅ Loaded matchup {matchup_id}: {desc or '(no description)'}")

# --- write blob to temp mp4 file ---
tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
tmp.write(blob)
tmp.close()

print(f"\n📁 Temporary file saved to: {tmp.name}")

# --- inspect with OpenCV ---
cap = cv2.VideoCapture(tmp.name)
fps = cap.get(cv2.CAP_PROP_FPS)
frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
codec = "".join([chr((fourcc >> 8 * i) & 0xFF) for i in range(4)])

print(f"\n🎥 Video info:")
print(f"   FPS: {fps}")
print(f"   Frames: {frames}")
print(f"   Resolution: {width}x{height}")
print(f"   Codec tag: {codec}")

cap.release()

# --- try to open it automatically (optional) ---
if os.name == "nt":  # Windows
    os.startfile(tmp.name)
else:
    print(f"\n👉 Open manually: {tmp.name}")
