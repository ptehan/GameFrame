import sqlite3

conn = sqlite3.connect("app.db")
cur = conn.cursor()

row = cur.execute("SELECT matchup_blob FROM matchups WHERE id=35").fetchone()
conn.close()

if not row or not row[0]:
    print("NO BLOB FOUND")
    quit()

with open("test35.mp4", "wb") as f:
    f.write(row[0])

print("DONE:", len(row[0]), "bytes")
