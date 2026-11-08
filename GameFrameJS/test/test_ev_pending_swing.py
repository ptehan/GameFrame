import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ev-predictor"))
import clip_server
from pending_swing import save_pending_swing, save_pending_pitch


class PendingSwingTest(unittest.TestCase):
    def test_frame_exact_copy_and_deduplication(self):
        for fps in (30, 60):
            with self.subTest(fps=fps), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "source.mp4"
                database = Path(directory) / "test.db"
                subprocess.run([os.environ.get("FFMPEG_PATH", "ffmpeg"), "-y", "-v", "error",
                    "-f", "lavfi", "-i", f"testsrc2=s=96x128:r={fps}", "-t", "4",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source)], check=True)
                original = hashlib.sha256(source.read_bytes()).digest()
                args = (database, source, 3.0, 1, 1, "EV swing", {})
                pending = save_pending_swing(*args)
                pitch = save_pending_pitch(database, source, 3.0, "EV pitch", {})
                self.assertEqual(save_pending_pitch(database, source, 3.0, "EV pitch", {}), pitch)
                with closing(sqlite3.connect(database)) as conn:
                    p = conn.execute('SELECT contact_frame,fps,clip_blob,pitcher_id,team_id FROM pending_pitch_clips').fetchone()
                    self.assertEqual(p[0], 2 * fps)
                    self.assertAlmostEqual(p[1], fps)
                    self.assertEqual(p[3:], (None, None))
                    copy = Path(directory) / 'pitch.mp4'
                    copy.write_bytes(p[2])
                    probe = json.loads(subprocess.check_output([os.environ.get('FFPROBE_PATH','ffprobe'),
                        '-v','error','-count_frames','-select_streams','v:0','-show_entries',
                        'stream=nb_read_frames','-of','json',str(copy)]))
                    self.assertEqual(int(probe['streams'][0]['nb_read_frames']), p[0] + 1)
                self.assertEqual(save_pending_swing(*args), pending)
                with closing(sqlite3.connect(database)) as conn, conn:
                    row = conn.execute("SELECT contact_frame,fps,clip_blob,status FROM pending_swing_clips").fetchone()
                    self.assertEqual(row[0], 2 * fps)
                    self.assertAlmostEqual(row[1], fps)
                    self.assertEqual(row[3], "pending")
                    self.assertNotEqual(row[2], source.read_bytes())
                    conn.execute("DELETE FROM pending_swing_clips")
                replacement = save_pending_swing(*args)
                self.assertNotEqual(replacement, pending)
                self.assertEqual(save_pending_swing(*args), replacement)
                with closing(sqlite3.connect(database)) as conn, conn:
                    self.assertEqual(conn.execute("SELECT count(*) FROM pending_swing_clips").fetchone()[0], 1)
                    self.assertEqual(conn.execute("SELECT pending_swing_id FROM ev_swing_links").fetchone()[0], replacement)
                self.assertEqual(hashlib.sha256(source.read_bytes()).digest(), original)

    def test_ev_save_unchanged_even_if_swing_copy_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "test.db"
            source = Path(directory) / "source.mp4"
            raw = Path(directory) / "raw.mp4"
            rendered = Path(directory) / "ev.mp4"
            source.write_bytes(b"original")
            raw.write_bytes(b"raw ev clip")
            rendered.write_bytes(b"rendered ev clip")
            with closing(sqlite3.connect(database)) as conn, conn:
                conn.executescript("CREATE TABLE hitters(id INTEGER,team_id INTEGER,name TEXT); INSERT INTO hitters VALUES(1,2,'Test Player');")
                conn.execute('CREATE TABLE ev_swing_links(pending_swing_id INTEGER)')
            payload = {"hitter_id":1,"package":{"video_metadata":{"file_name":"source.mp4"},"hit":{"contact":{"timestamp_s":3}}}}
            responses = []
            handler = object.__new__(clip_server.ClipServerHandler)
            with patch.object(clip_server,"GAMEFRAME_DB",database), \
                 patch.object(clip_server,"handle_json_body",return_value=payload), \
                 patch.object(clip_server,"locate_video",return_value=source), \
                 patch.object(clip_server,"cleanup_temp_video_outputs"), \
                 patch.object(clip_server,"trim_source_clip",return_value=(raw,2,9,7)), \
                 patch.object(clip_server,"render_generated_clip",return_value=rendered), \
                 patch.object(clip_server,"save_pending_swing",side_effect=ValueError("copy failed")) as save_swing, \
                 patch.object(clip_server,"save_pending_pitch",return_value=8) as save_pitch, \
                 patch.object(clip_server,"json_response",side_effect=lambda handler,status,data:responses.append((status,data))):
                handler.handle_gameframe_save_hit()
                save_pitch.assert_not_called()
                payload['create_pitch'] = True
                save_swing.side_effect = None
                save_swing.return_value = 7
                handler.handle_gameframe_save_hit()
                save_pitch.assert_called_once_with(database, source, 3, '', payload['package']['video_metadata'])
                self.assertEqual(responses[1][1]['pending_pitch_id'],8)
                save_pitch.side_effect = ValueError('pitch copy failed')
                handler.handle_gameframe_save_hit()
                self.assertEqual(responses[2][0], 200)
                self.assertIn('pitch copy failed', responses[2][1]['pitch_warning'])
                self.assertEqual(save_swing.call_args.args[:5], (database, source, 3, 1, 2))
            self.assertEqual(responses[0][0],200)
            self.assertEqual(payload['package']['hit']['player_name'], 'Test Player')
            self.assertIn("copy failed",responses[0][1]["swing_warning"])
            self.assertEqual(responses[1][0],200)
            self.assertEqual(responses[1][1]["pending_swing_id"],7)
            self.assertIsNone(responses[1][1]["swing_warning"])
            with closing(sqlite3.connect(database)) as conn, conn:
                row = conn.execute("SELECT clip_blob,generated_clip_blob,contact_time_s FROM ev_hit_tracks").fetchone()
                self.assertEqual(row,(b"raw ev clip",b"rendered ev clip",3))


if __name__ == "__main__":
    unittest.main()
