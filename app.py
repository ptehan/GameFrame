import streamlit as st
import sqlite3
import cv2
import numpy as np
import tempfile
import os
import base64


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

import time

def show_persisted_message():
    if "saved_message" not in st.session_state:
        return

    msg = st.session_state.saved_message
    st.toast(msg["text"], icon=msg.get("icon", "✅"))
    st.success(msg["text"])

    # don't pop it immediately — let user see it until next manual action
    if st.button("Dismiss message"):
        st.session_state.pop("saved_message", None)
        st.rerun()
# ---------- UI ----------
st.set_page_config(page_title="SwingMatchup", layout="wide")
st.title("⚾ Pitch Timer Pro")

message_box = st.empty()

import streamlit as st

# --- Simple password gate ---
if "authenticated" not in st.session_state:
    st.session_state.authenticated = False

if not st.session_state.authenticated:
    password = st.text_input("Enter password", type="password")
    if password == st.secrets.get("app_password", "changeme"):
        st.session_state.authenticated = True
        st.rerun()
    else:
        if password:
            st.error("❌ Incorrect password")
    st.stop()


# ---------- FLAT, TEXT-ONLY SIDEBAR MENU (NO BORDERS, NO BOXES, NO BACKGROUND) ----------
st.markdown("""
    <style>
    /* Overwrite all Streamlit button styles in sidebar */
    div[data-testid="stSidebar"] button {
        all: unset !important;
        display: block !important;
        width: 100% !important;
        padding: 6px 4px !important;
        margin: 2px 0 !important;
        font-size: 16px !important;
        color: #e0e0e0 !important;
        cursor: pointer !important;
        border: none !important;
        background: none !important;
        box-shadow: none !important;
    }
    div[data-testid="stSidebar"] button:hover {
        color: #f8c10c !important;
        background: none !important;
    }
    div[data-testid="stSidebar"] button.active {
        color: #f8c10c !important;
        font-weight: 600 !important;
    }
    div[data-testid="stSidebar"] .block-container {
        padding-top: 0 !important;
    }
    </style>
""", unsafe_allow_html=True)

st.sidebar.markdown("### Menu")

st.markdown("""
<style>
/* Sidebar buttons: same width, centered text, underlined labels */
section[data-testid="stSidebar"] div[data-testid="stButton"] button {
    width: 100% !important;
    min-width: 100% !important;
    max-width: 100% !important;
    display: flex !important;
    justify-content: center !important;
    align-items: center !important;
    text-align: center !important;
    padding: 10px 0 !important;
    margin: 4px 0 !important;
    box-sizing: border-box !important;
    font-size: 16px !important;
    font-family: monospace !important;  /* equal-width characters */
    color: #444 !important;
    background: transparent !important;
    border: none !important;
}

/* Force uniform label width and underline */
section[data-testid="stSidebar"] div[data-testid="stButton"] button span {
    display: inline-block !important;
    width: 16ch !important;             /* adjust this until longest text fits */
    text-decoration: underline !important;
    text-underline-offset: 4px !important;
    text-align: center !important;
    overflow: hidden !important;
    white-space: nowrap !important;
}

/* Hover effect */
section[data-testid="stSidebar"] div[data-testid="stButton"] button:hover span {
    color: #f8c10c !important;
}
</style>
""", unsafe_allow_html=True)





options = [
    "Library",
    "Create Matchup",
    "Upload Pitch",
    "Upload Swing",
    "Pitchers",
    "Hitters",
    "Teams"
]

menu = st.session_state.get("menu", "Library")

for opt in options:
    clicked = st.sidebar.button(opt, key=f"menu_{opt}")
    if clicked:
        st.session_state["menu"] = opt
        menu = opt

# Highlight current selection
st.markdown(f"""
    <script>
    const btns = window.parent.document.querySelectorAll('section[data-testid="stSidebar"] button');
    btns.forEach(btn => {{
        if (btn.innerText.trim() === "{menu}") {{
            btn.classList.add('active');
        }} else {{
            btn.classList.remove('active');
        }}
    }});
    </script>
""", unsafe_allow_html=True)



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
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, img = cap.read()
        if ret:
            st.image(
                cv2.cvtColor(img, cv2.COLOR_BGR2RGB),
                caption=f"Frame {frame_idx}",
                width=320
            )




        if st.button("Extract 2-second Clip"):
            try:
                start = max(0, frame_idx - int(2 * fps))
                clip = extract_clip(cap, start, frame_idx, fps)

                # --- save clip ---
                cur.execute(
                    "INSERT INTO pitch_clips (team_id,pitcher_id,description,clip_blob,fps) VALUES (?,?,?,?,?)",
                    (team_map[team_name], pitcher_map[pitcher_name], desc, clip, fps)
                )
                conn.commit()

                # --- show visible message ---
                message_box = st.empty()
                message_box.success(
                    f"✅ Pitch clip saved successfully!\n\n"
                    f"Team: {team_name} | Pitcher: {pitcher_name} | "
                    f"Time: {datetime.now().strftime('%I:%M:%S %p')}"
                )
                time.sleep(2)

                # --- optional download of saved clip ---
                preview_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
                preview_tmp.write(clip)
                preview_tmp.close()
                with open(preview_tmp.name, "rb") as f:
                    st.download_button(
                        "⬇️ Download Newly Created Pitch Clip",
                        f,
                        f"pitch_preview_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4",
                        "video/mp4"
                    )
                os.unlink(preview_tmp.name)

                # --- refresh only this section ---
                rows = cur.execute("SELECT id, description, created_at FROM pitch_clips ORDER BY id DESC").fetchall()

            finally:
                cap.release()
                os.unlink(tmp.name)


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

                        # --- show visible message ---
                        message_box = st.empty()
                        message_box.success(
                            f"✅ Swing clip saved successfully!\n\n"
                            f"Team: {team_name} | Hitter: {hitter_name} | "
                            f"Time: {datetime.now().strftime('%I:%M:%S %p')}"
                        )
                        time.sleep(2)

                        # --- optional download of saved clip ---
                        preview_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
                        preview_tmp.write(clip)
                        preview_tmp.close()
                        with open(preview_tmp.name, "rb") as f:
                            st.download_button(
                                "⬇️ Download Newly Created Swing Clip",
                                f,
                                f"swing_preview_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4",
                                "video/mp4"
                            )
                        os.unlink(preview_tmp.name)

                        # --- refresh only this section ---
                        rows = cur.execute(
                            "SELECT id, description, created_at FROM swing_clips ORDER BY id DESC"
                        ).fetchall()

                    finally:
                        cap.release()
                        os.unlink(tmp.name)
                        st.session_state.pop("swing_start", None)
                        st.session_state.pop("swing_contact", None)
                        st.session_state.pop("swing_decision", None)

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
            f"Date: {datetime.now().strftime('%b %d, %Y')}"
        )

        out_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        writer = cv2.VideoWriter(out_tmp.name, cv2.VideoWriter_fourcc(*"mp4v"), fps, (1280, 720))

        # ---------- TITLE SCREEN ----------
        black = np.zeros((720, 1280, 3), dtype=np.uint8)
        y0 = 220
        for i, line in enumerate(matchup_title.split("\n")):
            y = y0 + i * 80
            cv2.putText(black, line, (120, y), cv2.FONT_HERSHEY_COMPLEX, 1.4, (255, 255, 255), 3, cv2.LINE_AA)
        for _ in range(int(fps * 5)):  # 5 seconds
            writer.write(black)

        # ---------- NORMAL SPEED SIDE-BY-SIDE ----------
        for i in range(frames_p):
            ret_p, fp = cap_p.read()
            if not ret_p:
                break
            def letterbox(frame, target_size=(640, 720)):
                """Resize while keeping aspect ratio, add black bars."""
                if frame is None:
                    return np.zeros((target_size[1], target_size[0], 3), dtype=np.uint8)
                h, w = frame.shape[:2]
                tw, th = target_size
                scale = min(tw / w, th / h)
                nw, nh = int(w * scale), int(h * scale)
                resized = cv2.resize(frame, (nw, nh))
                # center with black bars
                result = np.zeros((th, tw, 3), dtype=np.uint8)
                x_off, y_off = (tw - nw) // 2, (th - nh) // 2
                result[y_off:y_off + nh, x_off:x_off + nw] = resized
                return result
            
            fp = letterbox(fp)
            
            # Swing video frame selection
            if i < pad_frames:
                cap_s.set(1, 0)
            ret_s, fs = cap_s.read()
            fs = letterbox(fs if ret_s else None)


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


            # --- During main loop ---
            combo = np.hstack((fp, fs))
            # ensure combo always exactly 1280x720 with letterboxing
            if combo.shape[0] != 720 or combo.shape[1] != 1280:
                combo = cv2.resize(combo, (1280, 720), interpolation=cv2.INTER_AREA)
            writer.write(combo)
            
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
            # ---------- FREEZE FINAL FRAME ----------
            cap_p.set(cv2.CAP_PROP_POS_FRAMES, frames_p - 1)
            cap_s.set(cv2.CAP_PROP_POS_FRAMES, frames_s - 1)
            ret_p, fp = cap_p.read()
            ret_s, fs = cap_s.read()
            
            if ret_p and ret_s:
                fp = letterbox(fp)
                fs = letterbox(fs)
                combo = np.hstack((fp, fs))
                if combo.shape[0] != 720 or combo.shape[1] != 1280:
                    combo = cv2.resize(combo, (1280, 720), interpolation=cv2.INTER_AREA)
                freeze_frames = int(fps * 3)
                for _ in range(freeze_frames):
                    writer.write(combo)
            else:
                st.warning("⚠️ Could not read last frame for freeze effect.")

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

        # show confirmation and direct link to this matchup
        matchup_id = cur.lastrowid
        st.success(
            f"✅ Matchup saved successfully!\n\n"
            f"**File:** {matchup_name}.mp4\n\n"
            f"**Pitcher:** {pitcher_name} ({team_name_p})  \n"
            f"**Hitter:** {hitter_name} ({team_name_s})  \n"
            f"**Time:** {datetime.now().strftime('%I:%M:%S %p')}"
        )

        # direct download only (no blank video)
        st.download_button(
            "⬇️ Download Matchup Video",
            matchup_bytes,
            file_name=f"{matchup_name}.mp4",
            mime="video/mp4",
            key=f"dl_new_matchup_{matchup_id}"
        )

        # link-style button to jump straight to Library
        if st.button("➡️ View This Matchup in Library", key=f"go_matchup_{matchup_id}"):
            st.session_state["menu"] = "Library"
            st.session_state["highlight_matchup_id"] = matchup_id
            st.rerun()

        # clean up temp files
        for fpath in (ptmp.name, stmp.name, out_tmp.name):
            try:
                os.unlink(fpath)
            except Exception:
                pass

        # refresh just this section (manual reload of matchups)
        rows = cur.execute("""
            SELECT id, description, created_at, pitch_clip_id, swing_clip_id
            FROM matchups ORDER BY id DESC
        """).fetchall()

# ---------- LIBRARY ----------
elif menu == "Library":
    st.header("Library")
    tabs = st.tabs(["Matchups", "Pitch Clips", "Swing Clips"])

    # ---------- MATCHUPS ----------
    with tabs[0]:
        rows = cur.execute("""
            SELECT id, description, created_at, pitch_clip_id, swing_clip_id
            FROM matchups ORDER BY id DESC
        """).fetchall()
        if not rows:
            st.info("No matchups found.")
        else:
            for row in rows:
                matchup_id, desc, created, pitch_id, swing_id = row
                with st.expander(f"Matchup {matchup_id}: {desc or '(no description)'} — {created}", expanded=False):
                    # --- Info ---
                    pitch_info = cur.execute("""
                        SELECT t.name, p.name FROM pitch_clips pc
                        JOIN pitchers p ON pc.pitcher_id=p.id
                        JOIN teams t ON pc.team_id=t.id
                        WHERE pc.id=?
                    """, (pitch_id,)).fetchone()

                    swing_info = cur.execute("""
                        SELECT t.name, h.name FROM swing_clips sc
                        JOIN hitters h ON sc.hitter_id=h.id
                        JOIN teams t ON sc.team_id=t.id
                        WHERE sc.id=?
                    """, (swing_id,)).fetchone()

                    if pitch_info and swing_info:
                        st.markdown(
                            f"**Pitcher:** {pitch_info[1]} ({pitch_info[0]})  \n"
                            f"**Hitter:** {swing_info[1]} ({swing_info[0]})"
                        )
                    st.markdown(f"**Description:** {desc or '(none)'}")

                    # --- CONTROL ROW: TRUE ONE-LINE LAYOUT ---
                    # Fetch blobs
                    matchup_blob = cur.execute(
                        "SELECT matchup_blob FROM matchups WHERE id=?", (matchup_id,)
                    ).fetchone()[0]
                    pitch_blob, fps_p = cur.execute(
                        "SELECT clip_blob, fps FROM pitch_clips WHERE id=?", (pitch_id,)
                    ).fetchone()
                    swing_blob, fps_s, decision_frame = cur.execute(
                        "SELECT clip_blob, fps, decision_frame FROM swing_clips WHERE id=?", (swing_id,)
                    ).fetchone()

                    # Extract frames
                    ptmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
                    ptmp.write(pitch_blob)
                    ptmp.close()
                    cap_p = cv2.VideoCapture(ptmp.name)
                    total_pitch_frames = int(cap_p.get(cv2.CAP_PROP_FRAME_COUNT))

                    tmp_s = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
                    tmp_s.write(swing_blob)
                    tmp_s.close()
                    cap_s = cv2.VideoCapture(tmp_s.name)
                    total_swing_frames = int(cap_s.get(cv2.CAP_PROP_FRAME_COUNT))
                    cap_s.release()
                    os.unlink(tmp_s.name)

                    pad_frames = max(0, total_pitch_frames - total_swing_frames)
                    decision_global = pad_frames + int(decision_frame or 0)

                    # Capture start + decision frames
                    cap_p.set(cv2.CAP_PROP_POS_FRAMES, pad_frames)
                    ret_start, frame_start = cap_p.read()
                    cap_p.set(cv2.CAP_PROP_POS_FRAMES, decision_global)
                    ret_decision, frame_decision = cap_p.read()
                    cap_p.release()
                    os.unlink(ptmp.name)

                    # --- Overlay matchup info text ---
                    overlay_text = f"{pitch_info[1]} ({pitch_info[0]}) vs {swing_info[1]} ({swing_info[0]})"
                    duration_text = f"Swing Duration: {round(total_swing_frames / fps_s, 2)}s"

                    def annotate_image(img, main_text, sub_text):
                        if img is None:
                            return None
                        annotated = img.copy()
                        h, w = annotated.shape[:2]

                        # optional translucent background bar for readability
                        overlay = annotated.copy()
                        cv2.rectangle(overlay, (0, h - 80), (w, h), (0, 0, 0), -1)
                        cv2.addWeighted(overlay, 0.5, annotated, 0.5, 0, annotated)

                        # text lines
                        y_main = h - 45
                        y_sub = h - 15
                        cv2.putText(annotated, main_text, (25, y_main),
                                    cv2.FONT_HERSHEY_COMPLEX, 1.0, (255, 255, 255), 3, cv2.LINE_AA)
                        cv2.putText(annotated, sub_text, (25, y_sub),
                                    cv2.FONT_HERSHEY_COMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
                        return annotated

                    if ret_start:
                        frame_start = annotate_image(frame_start, overlay_text, duration_text)
                    if ret_decision:
                        frame_decision = annotate_image(frame_decision, overlay_text, duration_text)

                    # Encode to JPEG
                    start_bytes = decision_bytes = None
                    if ret_start:
                        _, buf = cv2.imencode(".jpg", frame_start)
                        start_bytes = buf.tobytes()
                    if ret_decision:
                        _, buf = cv2.imencode(".jpg", frame_decision)
                        decision_bytes = buf.tobytes()

                    # Build HTML layout
                    html = """
                    <style>
                        .button-bar {
                            display: flex;
                            flex-wrap: nowrap;
                            gap: 0.6rem;
                            margin-top: 10px;
                        }
                        .button-bar form {margin: 0;}
                        .stDownloadButton>button, .stButton>button {
                            white-space: nowrap;
                        }
                    </style>
                    <div class="button-bar">
                    """
                    st.markdown(html, unsafe_allow_html=True)

                    # Four buttons, inline
                    colA, colB, colC, colD = st.columns([1.3, 1, 1, 0.8])

                    with colA:
                        st.download_button(
                            "⬇️ Download Video",
                            matchup_blob,
                            file_name=f"matchup_{matchup_id}.mp4",
                            mime="video/mp4",
                            key=f"dl_vid_{matchup_id}"
                        )

                    with colB:
                        if start_bytes:
                            st.download_button(
                                "⬇️ Start Frame",
                                start_bytes,
                                file_name=f"pitch_start_{matchup_id}.jpg",
                                mime="image/jpeg",
                                key=f"dl_start_{matchup_id}"
                            )
                        else:
                            st.warning("⚠️")

                    with colC:
                        if decision_bytes:
                            st.download_button(
                                "⬇️ Decision Frame",
                                decision_bytes,
                                file_name=f"pitch_decision_{matchup_id}.jpg",
                                mime="image/jpeg",
                                key=f"dl_decision_{matchup_id}"
                            )
                        else:
                            st.warning("⚠️")

                    with colD:
                        if st.button("🗑️ Delete", key=f"del_matchup_{matchup_id}"):
                            delete_record("matchups", matchup_id)
                            st.rerun()

    # ---------- PITCH CLIPS ----------
    with tabs[1]:
        rows = cur.execute("SELECT id, description, created_at FROM pitch_clips ORDER BY id DESC").fetchall()
        if not rows:
            st.info("No pitch clips found.")
        else:
            for clip_id, desc, created in rows:
                with st.expander(f"Pitch {clip_id}: {desc or '(no description)'} — {created}", expanded=False):
                    blob = cur.execute("SELECT clip_blob FROM pitch_clips WHERE id=?", (clip_id,)).fetchone()[0]
                    col1, col2 = st.columns([2,1])
                    col1.download_button("Download Pitch Clip", blob, f"pitch_{clip_id}.mp4", "video/mp4")
                    if col2.button("Delete", key=f"del_pitch_{clip_id}"):
                        delete_record("pitch_clips", clip_id)
                        st.rerun()

    # ---------- SWING CLIPS ----------
    with tabs[2]:
        rows = cur.execute("SELECT id, description, created_at FROM swing_clips ORDER BY id DESC").fetchall()
        if not rows:
            st.info("No swing clips found.")
        else:
            for clip_id, desc, created in rows:
                with st.expander(f"Swing {clip_id}: {desc or '(no description)'} — {created}", expanded=False):
                    blob = cur.execute("SELECT clip_blob FROM swing_clips WHERE id=?", (clip_id,)).fetchone()[0]
                    col1, col2 = st.columns([2,1])
                    col1.download_button("Download Swing Clip", blob, f"swing_{clip_id}.mp4", "video/mp4")
                    if col2.button("Delete", key=f"del_swing_{clip_id}"):
                        delete_record("swing_clips", clip_id)
                        st.rerun()
