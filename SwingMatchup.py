import streamlit as st
import sqlite3
import cv2
import numpy as np
import tempfile
import os
from datetime import datetime

# ---------- SETUP ----------
os.makedirs("clips", exist_ok=True)

DB_PATH = "app.db"
conn = sqlite3.connect(DB_PATH, check_same_thread=False)
cur = conn.cursor()



# ---------- TABLES ----------
tables = [
    """CREATE TABLE IF NOT EXISTS teams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS pitchers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER,
        name TEXT NOT NULL,
        description TEXT,
        FOREIGN KEY (team_id) REFERENCES teams(id)
    )""",
    """CREATE TABLE IF NOT EXISTS hitters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER,
        name TEXT NOT NULL,
        description TEXT,
        FOREIGN KEY (team_id) REFERENCES teams(id)
    )""",
    """CREATE TABLE IF NOT EXISTS pitch_clips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER,
        pitcher_id INTEGER,
        description TEXT,
        clip_blob BLOB,
        fps REAL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS swing_clips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER,
        hitter_id INTEGER,
        description TEXT,
        clip_blob BLOB,
        fps REAL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS matchups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pitch_clip_id INTEGER,
        swing_clip_id INTEGER,
        description TEXT,
        matchup_blob BLOB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )"""
]
for sql in tables:
    cur.execute(sql)

try:
    cur.execute("ALTER TABLE swing_clips ADD COLUMN decision_frame INTEGER DEFAULT NULL")
    conn.commit()
except sqlite3.OperationalError:
    pass  # already exists

conn.commit()



# ---------- HELPERS ----------
def get_all(table, order="id"):
    cur.execute(f"SELECT * FROM {table} ORDER BY {order}")
    return cur.fetchall()

def delete_record(table, rec_id):
    cur.execute(f"DELETE FROM {table} WHERE id=?", (rec_id,))
    conn.commit()

def update_record(table, rec_id, **kwargs):
    cols = ", ".join(f"{k}=?" for k in kwargs)
    vals = list(kwargs.values()) + [rec_id]
    cur.execute(f"UPDATE {table} SET {cols} WHERE id=?", vals)
    conn.commit()

def extract_clip(cap, start_frame, end_frame, fps):
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.mp4')
    writer = cv2.VideoWriter(tmp.name, fourcc, fps, (w, h))
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    for _ in range(start_frame, end_frame + 1):
        ret, frame = cap.read()
        if not ret:
            break
        writer.write(frame)
    writer.release()
    tmp.close()
    with open(tmp.name, 'rb') as f:
        data = f.read()
    os.unlink(tmp.name)
    return data

# ---------- UI ----------
st.set_page_config(page_title="SwingMatchup", layout="wide")
st.title("⚾ Baseball / Softball Swing-Pitch Matchup")

menu = st.sidebar.selectbox("Menu", [
    "Create Matchup", "Library", "Upload Pitch", "Upload Swing", "Pitchers", "Hitters", "Teams"
])

# ---------- TEAMS ----------
if menu == "Teams":
    st.header("Teams")
    teams = get_all("teams")
    for t in teams:
        col1, col2, col3, col4 = st.columns([1, 3, 4, 1])
        col1.write(t[0])
        col2.write(t[1])
        col3.write(t[2] or "")
        if col4.button("Delete", key=f"del_team_{t[0]}"):
            delete_record("teams", t[0])
            st.rerun()

    with st.expander("Create / Edit Team", expanded=True):
        team_id = st.text_input("Team ID (blank = new)", "")
        name = st.text_input("Team Name")
        desc = st.text_area("Description")
        if st.button("Save"):
            if name.strip():
                if team_id:
                    update_record("teams", int(team_id), name=name, description=desc)
                else:
                    cur.execute("INSERT INTO teams (name, description) VALUES (?,?)", (name, desc))
                    conn.commit()
                st.success("Saved!"); st.rerun()
            else:
                st.error("Name required")

# ---------- PITCHERS ----------
elif menu == "Pitchers":
    st.header("Pitchers")
    pitchers = cur.execute("""
        SELECT p.id, t.name, p.name, p.description 
        FROM pitchers p JOIN teams t ON p.team_id=t.id
    """).fetchall()
    for p in pitchers:
        col1, col2, col3, col4, col5 = st.columns([1, 2, 2, 3, 1])
        col1.write(p[0]); col2.write(p[1]); col3.write(p[2]); col4.write(p[3] or "")
        if col5.button("Delete", key=f"del_p_{p[0]}"):
            delete_record("pitchers", p[0]); st.rerun()

    with st.expander("Create / Edit Pitcher", expanded=True):
        pitcher_id = st.text_input("Pitcher ID (blank = new)", "")
        teams = get_all("teams", "name")
        team_map = {t[1]: t[0] for t in teams}
        team_name = st.selectbox("Team", [""] + list(team_map.keys()))
        name = st.text_input("Pitcher Name")
        desc = st.text_area("Description")
        if st.button("Save"):
            if name and team_name:
                tid = team_map[team_name]
                if pitcher_id:
                    update_record("pitchers", int(pitcher_id), team_id=tid, name=name, description=desc)
                else:
                    cur.execute("INSERT INTO pitchers (team_id, name, description) VALUES (?,?,?)",
                                (tid, name, desc))
                    conn.commit()
                st.success("Saved!"); st.rerun()
            else:
                st.error("Name + Team required")

# ---------- HITTERS ----------
elif menu == "Hitters":
    st.header("Hitters")
    hitters = cur.execute("""
        SELECT h.id, t.name, h.name, h.description 
        FROM hitters h JOIN teams t ON h.team_id=t.id
    """).fetchall()
    for h in hitters:
        col1, col2, col3, col4, col5 = st.columns([1, 2, 2, 3, 1])
        col1.write(h[0]); col2.write(h[1]); col3.write(h[2]); col4.write(h[3] or "")
        if col5.button("Delete", key=f"del_h_{h[0]}"):
            delete_record("hitters", h[0]); st.rerun()

    with st.expander("Create / Edit Hitter", expanded=True):
        hitter_id = st.text_input("Hitter ID (blank = new)", "")
        teams = get_all("teams", "name")
        team_map = {t[1]: t[0] for t in teams}
        team_name = st.selectbox("Team", [""] + list(team_map.keys()))
        name = st.text_input("Hitter Name")
        desc = st.text_area("Description")
        if st.button("Save"):
            if name and team_name:
                tid = team_map[team_name]
                if hitter_id:
                    update_record("hitters", int(hitter_id), team_id=tid, name=name, description=desc)
                else:
                    cur.execute("INSERT INTO hitters (team_id, name, description) VALUES (?,?,?)",
                                (tid, name, desc))
                    conn.commit()
                st.success("Saved!"); st.rerun()
            else:
                st.error("Name + Team required")

# ---------- UPLOAD PITCH ----------
elif menu == "Upload Pitch":
    st.header("Upload Pitch Video")
    teams = get_all("teams", "name")
    team_map = {t[1]: t[0] for t in teams}
    team_name = st.selectbox("Team", [""] + list(team_map.keys()))
    if team_name:
        pitchers = cur.execute("SELECT id,name FROM pitchers WHERE team_id=?",
                               (team_map[team_name],)).fetchall()
        pitcher_map = {p[1]: p[0] for p in pitchers}
        pitcher_name = st.selectbox("Pitcher", [""] + list(pitcher_map.keys()))
    else:
        pitcher_name = ""
    desc = st.text_input("Description")
    file = st.file_uploader("Pitch Video", type=["mp4", "mov", "avi"])

    if file and team_name and pitcher_name:
        data = file.read()
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        tmp.write(data); tmp.close()
        cap = cv2.VideoCapture(tmp.name)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        st.write(f"FPS: {fps:.1f} | Frames: {total}")
        frame_idx = st.slider("Contact Frame", 0, total - 1, total - 1, key="pitch_slider")

        # frame step buttons
        c1, c2, c3 = st.columns([1, 2, 1])
        if c1.button("⏮️ Prev Frame", key="pitch_prev") and frame_idx > 0:
            frame_idx -= 1
        if c3.button("⏭️ Next Frame", key="pitch_next") and frame_idx < total - 1:
            frame_idx += 1

        # show smaller preview
        if ret:
            # smaller preview that won't take up the full screen
            st.image(
                cv2.cvtColor(img, cv2.COLOR_BGR2RGB),
                caption=f"Frame {frame_idx}",
                width=320
            )



        if st.button("Extract 2-second Clip"):
            try:
                start = max(0, frame_idx - int(2 * fps))
                clip = extract_clip(cap, start, frame_idx, fps)
                cur.execute(
                    "INSERT INTO pitch_clips (team_id,pitcher_id,description,clip_blob,fps) VALUES (?,?,?,?,?)",
                    (team_map[team_name], pitcher_map[pitcher_name], desc, clip, fps)
                )
                conn.commit()
                with st.container():
                    st.success("✅ Pitch clip saved successfully!")
                    st.info(f"Team: {team_name} | Pitcher: {pitcher_name} | Time: {datetime.now().strftime('%I:%M:%S %p')}")


                # Write the saved clip to a temp file for download
                preview_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
                preview_tmp.write(clip)
                preview_tmp.close()
                with open(preview_tmp.name, "rb") as f:
                    st.download_button("⬇️ Download Newly Created Pitch Clip", f, f"pitch_preview_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4", "video/mp4")
                os.unlink(preview_tmp.name)

            finally:
                cap.release(); os.unlink(tmp.name)
            st.rerun()

# ---------- UPLOAD SWING ----------
elif menu == "Upload Swing":
    st.header("Upload Swing Video")

    # --- Team and hitter selection ---
    teams = get_all("teams", "name")
    team_map = {t[1]: t[0] for t in teams}
    team_name = st.selectbox("Team", [""] + list(team_map.keys()))
    if team_name:
        hitters = cur.execute("SELECT id,name FROM hitters WHERE team_id=?", (team_map[team_name],)).fetchall()
        hitter_map = {h[1]: h[0] for h in hitters}
        hitter_name = st.selectbox("Hitter", [""] + list(hitter_map.keys()))
    else:
        hitter_name = ""

    desc = st.text_input("Description")
    file = st.file_uploader("Swing Video", type=["mp4", "mov", "avi"])

    if file and team_name and hitter_name:
        data = file.read()
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        tmp.write(data)
        tmp.close()

        cap = cv2.VideoCapture(tmp.name)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        st.write(f"FPS: {fps:.1f} | Frames: {total}")

        frame_idx = st.slider("Frame", 0, total - 1, 0, key="swing_slider")

        # frame step buttons
        c1, c2, c3 = st.columns([1, 2, 1])
        if c1.button("⏮️ Prev Frame", key="swing_prev") and frame_idx > 0:
            frame_idx -= 1
        if c3.button("⏭️ Next Frame", key="swing_next") and frame_idx < total - 1:
            frame_idx += 1

        # show smaller preview
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, img = cap.read()
        if ret:
            st.image(
                cv2.cvtColor(img, cv2.COLOR_BGR2RGB),
                caption=f"Frame {frame_idx}",
                width=320
            )




        # --- Tag buttons ---
        c1, c2, c3 = st.columns(3)
        if c1.button("Set Swing Start"):
            st.session_state.swing_start = frame_idx
            st.success(f"Swing start set: {frame_idx}")
        if c2.button("Set Swing Decision"):
            st.session_state.swing_decision = frame_idx
            st.success(f"Swing decision set: {frame_idx}")
        if c3.button("Set Contact"):
            st.session_state.swing_contact = frame_idx
            st.success(f"Contact set: {frame_idx}")

        # --- Extract and save clip ---
        if "swing_start" in st.session_state and "swing_contact" in st.session_state:
            s0 = st.session_state.swing_start
            s1 = st.session_state.swing_contact
            if s0 < s1:
                
                
                if st.button("Extract Clip"):
                    try:
                        clip = extract_clip(cap, s0, s1, fps)
                        raw_decision = st.session_state.get("swing_decision", None)
                        decision_frame = (raw_decision - s0) if raw_decision is not None else None
                        cur.execute(
                            "INSERT INTO swing_clips (team_id, hitter_id, description, clip_blob, fps, decision_frame) VALUES (?,?,?,?,?,?)",
                            (team_map[team_name], hitter_map[hitter_name], desc, clip, fps, decision_frame)
                        )

                        conn.commit()
                        with st.container():
                            st.success("✅ Swing clip saved successfully!")
                            st.info(f"Team: {team_name} | Hitter: {hitter_name} | Time: {datetime.now().strftime('%I:%M:%S %p')}")


                        # Write the saved clip to a temp file for download
                        preview_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
                        preview_tmp.write(clip)
                        preview_tmp.close()
                        with open(preview_tmp.name, "rb") as f:
                            st.download_button("⬇️ Download Newly Created Swing Clip", f, f"swing_preview_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4", "video/mp4")
                        os.unlink(preview_tmp.name)

                    finally:
                        cap.release()
                        os.unlink(tmp.name)
                        st.session_state.pop("swing_start", None)
                        st.session_state.pop("swing_contact", None)
                        st.session_state.pop("swing_decision", None)
                    import time
                    time.sleep(2)
                    st.rerun()

            else:
                st.error("Start must be before Contact")


# ---------- CREATE MATCHUP ----------
elif menu == "Create Matchup":
    st.header("Create Matchup")

    # ---------------- Pitch Side ----------------
    st.subheader("🎯 Pitch Side")
    teams_p = get_all("teams", "name")
    team_map_p = {t[1]: t[0] for t in teams_p}
    team_name_p = st.selectbox("Pitcher Team", [""] + list(team_map_p.keys()), key="pitch_team")

    if team_name_p:
        team_id_p = team_map_p[team_name_p]
        pitchers = cur.execute("SELECT id, name FROM pitchers WHERE team_id=?", (team_id_p,)).fetchall()
        pitcher_map = {p[1]: p[0] for p in pitchers}
        pitcher_name = st.selectbox("Pitcher", [""] + list(pitcher_map.keys()), key="pitcher_name")
        if pitcher_name:
            pitch_clips = cur.execute(
                "SELECT id, description, fps FROM pitch_clips WHERE team_id=? AND pitcher_id=? ORDER BY id DESC",
                (team_id_p, pitcher_map[pitcher_name])
            ).fetchall()
            pitch_opt = {f"Pitch {p[0]} — {p[1] or '(no description)'}": p[0] for p in pitch_clips}
            pitch_sel = st.selectbox("Select Pitch Clip", list(pitch_opt.keys()), key="pitch_clip")

    # ---------------- Swing Side ----------------
    st.subheader("💥 Swing Side")
    teams_s = get_all("teams", "name")
    team_map_s = {t[1]: t[0] for t in teams_s}
    team_name_s = st.selectbox("Hitter Team", [""] + list(team_map_s.keys()), key="swing_team")

    if team_name_s:
        team_id_s = team_map_s[team_name_s]
        hitters = cur.execute("SELECT id, name FROM hitters WHERE team_id=?", (team_id_s,)).fetchall()
        hitter_map = {h[1]: h[0] for h in hitters}
        hitter_name = st.selectbox("Hitter", [""] + list(hitter_map.keys()), key="hitter_name")
        if hitter_name:
            swing_clips = cur.execute(
                "SELECT id, description, fps FROM swing_clips WHERE team_id=? AND hitter_id=? ORDER BY id DESC",
                (team_id_s, hitter_map[hitter_name])
            ).fetchall()
            swing_opt = {f"Swing {s[0]} — {s[1] or '(no description)'}": s[0] for s in swing_clips}
            swing_sel = st.selectbox("Select Swing Clip", list(swing_opt.keys()), key="swing_clip")

    desc = st.text_input("Extra Description (optional)")

    if st.button("Generate Matchup"):
        p_id = pitch_opt[pitch_sel]
        s_id = swing_opt[swing_sel]

        # Load blobs
        p_blob, fps_p = cur.execute("SELECT clip_blob, fps FROM pitch_clips WHERE id=?", (p_id,)).fetchone()
        s_blob, fps_s = cur.execute("SELECT clip_blob, fps FROM swing_clips WHERE id=?", (s_id,)).fetchone()

        # Temp files
        ptmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        stmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        ptmp.write(p_blob); stmp.write(s_blob)
        ptmp.close(); stmp.close()

        cap_p, cap_s = cv2.VideoCapture(ptmp.name), cv2.VideoCapture(stmp.name)
        fps = min(fps_p, fps_s)
        frames_p, frames_s = int(cap_p.get(7)), int(cap_s.get(7))
        swing_duration = round(frames_s / fps, 2)

        pad_frames = max(0, frames_p - frames_s)
        yellow_start, yellow_end = pad_frames, pad_frames + 3
        decision_frame = cur.execute(
            "SELECT decision_frame FROM swing_clips WHERE id=?", (s_id,)
        ).fetchone()[0]
        decision_global = pad_frames + int(decision_frame or -9999)


        # ---------- FILENAME + TITLE INFO ----------
        ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        matchup_name = f"{team_name_p}_{pitcher_name}_vs_{team_name_s}_{hitter_name}_{ts}"
        matchup_title = (
            f"PITCHER: {pitcher_name} ({team_name_p})\n"
            f"HITTER: {hitter_name} ({team_name_s})\n"
            f"Swing Duration: {swing_duration}s\n"
            f"Date: {ts}"
        )

        out_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        writer = cv2.VideoWriter(out_tmp.name, cv2.VideoWriter_fourcc(*"mp4v"), fps, (1280, 720))

        # ---------- TITLE SCREEN ----------
        black = np.zeros((720, 1280, 3), dtype=np.uint8)
        y0 = 220
        for i, line in enumerate(matchup_title.split("\n")):
            y = y0 + i * 80
            cv2.putText(black, line, (120, y), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 3, cv2.LINE_AA)
        for _ in range(int(fps * 5)):  # 5 seconds
            writer.write(black)

        # ---------- NORMAL SPEED SIDE-BY-SIDE ----------
        for i in range(frames_p):
            ret_p, fp = cap_p.read()
            if not ret_p:
                break
            fp = cv2.resize(fp, (640, 720))

            # Swing video frame selection
            if i < pad_frames:
                cap_s.set(1, 0)
            ret_s, fs = cap_s.read()
            if not ret_s:
                fs = np.zeros_like(fp)
            else:
                fs = cv2.resize(fs, (640, 720))

            # Yellow highlight for 3 frames at swing start
            if yellow_start <= i < yellow_end:
                overlay = np.full_like(fp, (0, 255, 255))
                fp = cv2.addWeighted(fp, 0.7, overlay, 0.3, 0)

            # Green highlight for 3 frames at swing decision
            if decision_global <= i < decision_global + 3:
                overlay = np.full_like(fp, (0, 255, 0))
                fp = cv2.addWeighted(fp, 0.7, overlay, 0.3, 0)

            # Pause 2 seconds when swing decision happens
            if i == decision_global:
                pause_frames = int(fps * 2)
                for _ in range(pause_frames):
                    writer.write(np.hstack((fp, fs)))


            combo = np.hstack((fp, fs))
            writer.write(combo)

            # Pause both videos for ~2 seconds when swing begins
            if i == pad_frames:
                pause_frames = int(fps * 2)
                for _ in range(pause_frames):
                    writer.write(combo)


        # ---------- FREEZE FINAL FRAME ----------
        # Move to last frames of both clips
        cap_p.set(cv2.CAP_PROP_POS_FRAMES, frames_p - 1)
        cap_s.set(cv2.CAP_PROP_POS_FRAMES, frames_s - 1)
        ret_p, fp = cap_p.read()
        ret_s, fs = cap_s.read()

        if ret_p and ret_s:
            fp = cv2.resize(fp, (640, 720))
            fs = cv2.resize(fs, (640, 720))
            combo = np.hstack((fp, fs))
            freeze_frames = int(fps * 3)  # 3-second hold
            for _ in range(freeze_frames):
                writer.write(combo)
        else:
            st.warning("⚠️ Could not read last frame for freeze effect.")

        writer.release()
        cap_p.release(); cap_s.release()

        with open(out_tmp.name, "rb") as f:
            matchup_bytes = f.read()

        cur.execute(
            "INSERT INTO matchups (pitch_clip_id, swing_clip_id, description, matchup_blob) VALUES (?,?,?,?)",
            (p_id, s_id, matchup_name, matchup_bytes)
        )
        conn.commit()
        st.success(f"✅ Matchup created: {matchup_name}")

        for fpath in (ptmp.name, stmp.name, out_tmp.name):
            try:
                os.unlink(fpath)
            except:
                pass

        st.rerun()

# ---------- LIBRARY ----------
elif menu == "Library":
    st.header("Library")
    tabs = st.tabs([""Matchups", Pitch Clips", "Swing Clips"])

    # Pitch
    with tabs[0]:
        rows = cur.execute("SELECT id, description, created_at FROM pitch_clips ORDER BY id DESC").fetchall()
        if not rows:
            st.info("No pitch clips found.")
        for row in rows:
            clip_id, desc, created = row
            st.write(f"**Pitch {clip_id}** — {desc or ''} ({created})")
            blob = cur.execute("SELECT clip_blob FROM pitch_clips WHERE id=?", (clip_id,)).fetchone()[0]
            col1, col2 = st.columns(2)
            col1.download_button(f"Download Pitch {clip_id}", blob, f"pitch_{clip_id}.mp4", "video/mp4")
            if col2.button(f"Delete Pitch {clip_id}", key=f"del_pitch_{clip_id}"):
                delete_record("pitch_clips", clip_id); st.rerun()

    # Swing
    with tabs[1]:
        rows = cur.execute("SELECT id, description, created_at FROM swing_clips ORDER BY id DESC").fetchall()
        if not rows:
            st.info("No swing clips found.")
        for row in rows:
            clip_id, desc, created = row
            st.write(f"**Swing {clip_id}** — {desc or ''} ({created})")
            blob = cur.execute("SELECT clip_blob FROM swing_clips WHERE id=?", (clip_id,)).fetchone()[0]
            col1, col2 = st.columns(2)
            col1.download_button(f"Download Swing {clip_id}", blob, f"swing_{clip_id}.mp4", "video/mp4")
            if col2.button(f"Delete Swing {clip_id}", key=f"del_swing_{clip_id}"):
                delete_record("swing_clips", clip_id); st.rerun()

    # Matchups
    # Matchups
    with tabs[2]:
        rows = cur.execute("SELECT id, description, created_at, pitch_clip_id, swing_clip_id FROM matchups ORDER BY id DESC").fetchall()
        if not rows:
            st.info("No matchups found.")
        for row in rows:
            matchup_id, desc, created, pitch_id, swing_id = row
            st.write(f"**Matchup {matchup_id}** — {desc or ''} ({created})")

            blob = cur.execute("SELECT matchup_blob FROM matchups WHERE id=?", (matchup_id,)).fetchone()[0]
            col1, col2, col3 = st.columns([1, 1, 2])

            col1.download_button(f"Download Matchup {matchup_id}", blob, f"matchup_{matchup_id}.mp4", "video/mp4")

            # --- Download pitcher frame at swing start ---
            if col2.button(f"Download Swing-Start Frame", key=f"frame_{matchup_id}"):

                # Get pitch/swing clips to calculate pad
                pitch_blob, fps_p = cur.execute("SELECT clip_blob, fps FROM pitch_clips WHERE id=?", (pitch_id,)).fetchone()
                swing_blob, fps_s = cur.execute("SELECT clip_blob, fps FROM swing_clips WHERE id=?", (swing_id,)).fetchone()
                ptmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
                ptmp.write(pitch_blob); ptmp.close()

                cap_p = cv2.VideoCapture(ptmp.name)
                frames_p = int(cap_p.get(cv2.CAP_PROP_FRAME_COUNT))
                stmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
                stmp.write(swing_blob)
                stmp.close()

                cap_s = cv2.VideoCapture(stmp.name)
                frames_s = int(cap_s.get(cv2.CAP_PROP_FRAME_COUNT))
                cap_s.release()
                os.unlink(stmp.name)

                pad_frames = max(0, frames_p - frames_s)

                # Seek to swing-start frame in pitcher video
                cap_p.set(cv2.CAP_PROP_POS_FRAMES, pad_frames)
                ret, frame = cap_p.read()
                if ret:
                    jpg_path = f"pitch_frame_{matchup_id}.jpg"
                    cv2.imwrite(jpg_path, frame)
                    with open(jpg_path, "rb") as f:
                        col2.download_button("Download Frame", f, jpg_path, "image/jpeg", key=f"dl_img_{matchup_id}")
                    os.remove(jpg_path)
                else:
                    st.warning(f"⚠️ Could not extract frame for matchup {matchup_id}")

                cap_p.release()
                os.unlink(ptmp.name)


            # --- Download pitcher frame at swing decision ---
            if col2.button(f"Download Swing-Decision Frame", key=f"frame_decision_{matchup_id}"):
                # Get pitch/swing clips and decision info
                pitch_blob, fps_p = cur.execute("SELECT clip_blob, fps FROM pitch_clips WHERE id=?", (pitch_id,)).fetchone()
                swing_blob, fps_s, decision_frame = cur.execute(
                    "SELECT clip_blob, fps, decision_frame FROM swing_clips WHERE id=?", (swing_id,)
                ).fetchone()

                # Write pitch clip to temp file
                ptmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
                ptmp.write(pitch_blob)
                ptmp.close()

                # Open pitch and swing to get frame counts
                cap_p = cv2.VideoCapture(ptmp.name)
                total_pitch_frames = int(cap_p.get(cv2.CAP_PROP_FRAME_COUNT))
                tmp_s = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
                tmp_s.write(swing_blob)
                tmp_s.close()
                cap_s = cv2.VideoCapture(tmp_s.name)
                total_swing_frames = int(cap_s.get(cv2.CAP_PROP_FRAME_COUNT))
                cap_s.release()
                os.unlink(tmp_s.name)

                # Figure out how many frames pad before swing starts
                pad_frames = max(0, total_pitch_frames - total_swing_frames)
                decision_global = pad_frames + int(decision_frame or 0)

                # Seek to that frame in the pitch video
                cap_p.set(cv2.CAP_PROP_POS_FRAMES, decision_global)
                ret, frame = cap_p.read()
                if ret:
                    jpg_path = f"pitch_decision_{matchup_id}.jpg"
                    cv2.imwrite(jpg_path, frame)
                    with open(jpg_path, "rb") as f:
                        col2.download_button(
                            "Download Decision Frame",
                            f,
                            file_name=jpg_path,
                            mime="image/jpeg",
                            key=f"dl_decision_{matchup_id}",
                        )
                    os.remove(jpg_path)
                else:
                    st.warning(f"⚠️ Could not extract decision frame for matchup {matchup_id}")

                cap_p.release()
                os.unlink(ptmp.name)


            if col3.button(f"Delete Matchup {matchup_id}", key=f"del_matchup_{matchup_id}"):
                delete_record("matchups", matchup_id)
                st.rerun()

