"""Backfill EV links only when the original source fingerprint matches exactly."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess


def backfill(database):
    with sqlite3.connect(database) as conn:
        conn.row_factory = sqlite3.Row
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='ev_swing_links'").fetchone():
            return 0
        columns = {r['name'] for r in conn.execute('PRAGMA table_info(ev_swing_links)')}
        if 'ev_hit_id' not in columns:
            conn.execute('ALTER TABLE ev_swing_links ADD COLUMN ev_hit_id INTEGER')
        unresolved = {r['source_key'] for r in conn.execute('SELECT source_key FROM ev_swing_links WHERE ev_hit_id IS NULL')}
        frames = {}
        count = 0
        for row in conn.execute('SELECT id,source_video_path,contact_time_s,hitter_id FROM ev_hit_tracks ORDER BY id DESC').fetchall():
            if not unresolved:
                break
            source = Path(row['source_video_path'] or '')
            if not source.is_file():
                continue
            if str(source) not in frames:
                result = subprocess.run([os.environ.get('FFPROBE_PATH','ffprobe'), '-v','error','-select_streams','v:0',
                    '-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',str(source)],
                    capture_output=True,text=True,check=True)
                frames[str(source)] = [float(f['best_effort_timestamp_time']) for f in json.loads(result.stdout)['frames']]
            times = frames[str(source)]
            if not times:
                continue
            contact = min(range(len(times)),key=lambda i:abs(times[i]-times[0]-row['contact_time_s']))
            stat = source.stat()
            key = hashlib.sha256(json.dumps([str(source.resolve()),stat.st_size,stat.st_mtime_ns,contact,row['hitter_id']]).encode()).hexdigest()
            if key in unresolved:
                conn.execute('UPDATE ev_swing_links SET ev_hit_id=? WHERE source_key=? AND ev_hit_id IS NULL',(row['id'],key))
                unresolved.remove(key)
                count += 1
        return count


if __name__ == '__main__':
    print(f"Linked {backfill(Path(__file__).resolve().parents[1]/'app.db')} existing EV swings.")
