"""Hosted Python source access must stay within the authenticated workspace."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ev-predictor'))
import clip_server
import workspace_quota

class HostedSourceTests(unittest.TestCase):
    def test_generated_blobs_are_rejected_before_saving_but_reads_and_deletes_remain_available(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'app.db'
            connection = workspace_quota.connect(file)
            connection.execute('CREATE TABLE clips(id INTEGER PRIMARY KEY, video BLOB)')
            connection.execute('INSERT INTO clips VALUES(1, ?)', (b'retained',))
            connection.commit()
            try:
                with patch.dict(os.environ, {'GAMEFRAME_WORKSPACE': directory, 'GAMEFRAME_STORAGE_LIMIT': '1'}):
                    connection.close()
                    connection = workspace_quota.connect(file)
                    with self.assertRaisesRegex(ValueError, 'storage allowance'):
                        connection.execute('INSERT INTO clips VALUES(2, ?)', (b'generated',))
                    self.assertEqual(connection.execute('SELECT video FROM clips').fetchone()[0], b'retained')
                    connection.execute('DELETE FROM clips WHERE id=1')
                    connection.commit()
            finally:
                connection.close()

    def test_cannot_resolve_another_workspace_or_a_parent_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            own = root / 'own'
            own.mkdir()
            source = own / 'video.mp4'
            source.write_bytes(b'own')
            other = root / 'private.mp4'
            other.write_bytes(b'private')
            with patch.dict(os.environ, {'GAMEFRAME_WORKSPACE': str(own)}):
                self.assertEqual(clip_server.locate_video(None, str(source)), source.resolve())
                self.assertIsNone(clip_server.locate_video(None, str(other)))
                self.assertIsNone(clip_server.locate_video(None, str(own / '..' / 'private.mp4')))
                self.assertIsNone(clip_server.locate_video(str(other)))
                package = {'video_metadata': {'source_path': str(other)}}
                self.assertNotIn('source_path', clip_server.add_source_path_to_package(package)['video_metadata'])

if __name__ == '__main__':
    unittest.main()
