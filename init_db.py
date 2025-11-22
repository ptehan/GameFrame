import sqlite3

schema = """
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE IF NOT EXISTS pitchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS hitters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS pitch_clips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER,
    pitcher_id INTEGER,
    description TEXT,
    clip_blob BLOB,
    fps REAL,
    created_at TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (pitcher_id) REFERENCES pitchers(id)
);

CREATE TABLE IF NOT EXISTS swing_clips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER,
    hitter_id INTEGER,
    description TEXT,
    clip_blob BLOB,
    fps REAL,
    decision_frame INTEGER,
    created_at TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (hitter_id) REFERENCES hitters(id)
);

CREATE TABLE IF NOT EXISTS matchups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pitch_clip_id INTEGER,
    swing_clip_id INTEGER,
    description TEXT,
    matchup_blob BLOB,
    thumb BLOB,
    created_at TIMESTAMP,
    FOREIGN KEY (pitch_clip_id) REFERENCES pitch_clips(id),
    FOREIGN KEY (swing_clip_id) REFERENCES swing_clips(id)
);
"""

conn = sqlite3.connect("app.db")
conn.executescript(schema)
conn.commit()
conn.close()

print("Database created.")
