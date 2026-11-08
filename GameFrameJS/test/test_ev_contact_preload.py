import sys
import tempfile
import unittest
from pathlib import Path
from concurrent.futures import Future
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'ev-predictor'))
import pending_swing
import clip_server


class ContactPreloadTest(unittest.TestCase):
    def test_reuses_media_without_database_and_invalidates_contact_and_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)/'source.mp4'
            source.write_bytes(b'video')
            with patch.object(pending_swing, '_encode_swing_media', return_value=(b'clip',30,60)) as encode:
                a = pending_swing.prepare_swing_media(source,2)
                self.assertEqual(a.result(), (b'clip',30,60))
                self.assertIs(a,pending_swing.prepare_swing_media(source,2))
                pending_swing.prepare_swing_media(source,3).result()
                source.write_bytes(b'changed video')
                pending_swing.prepare_swing_media(source,2).result()
                self.assertEqual(encode.call_count,3)
                self.assertEqual(list(Path(directory).iterdir()),[source])

    def test_endpoint_prepares_both_media_without_saving(self):
        payload = {'package':{'video_metadata':{'file_name':'clip.mp4'},'hit':{'contact':{'timestamp_s':2}}}}
        responses=[]
        handler=object.__new__(clip_server.ClipServerHandler)
        handler.path='/api/gameframe/preload-contact'
        with patch.object(clip_server,'handle_json_body',return_value=payload), \
             patch.object(clip_server,'locate_video',return_value=Path('source.mp4')), \
             patch.object(clip_server,'prepare_swing_media') as swing, \
             patch.object(clip_server,'prepare_source_clip') as source, \
             patch.object(clip_server,'save_pending_swing') as save, \
             patch.object(clip_server,'json_response',side_effect=lambda _,status,data: responses.append(status)):
            handler.do_POST()
            swing.assert_called_once_with(Path('source.mp4'),2)
            source.assert_called_once()
            save.assert_not_called()
            self.assertEqual(responses,[202])

    def test_preliminary_anchor_does_not_require_or_save_confirmed_contact(self):
        payload={'preload_time_s':1.5,'package':{'video_metadata':{'file_name':'clip.mp4'},'hit':{'contact':None}}}
        handler=object.__new__(clip_server.ClipServerHandler);handler.path='/api/gameframe/preload-contact'
        with patch.object(clip_server,'handle_json_body',return_value=payload),patch.object(clip_server,'locate_video',return_value=Path('clip.mp4')),patch.object(clip_server,'prepare_swing_media') as prepare,patch.object(clip_server,'prepare_source_clip'),patch.object(clip_server,'json_response') as reply:
            handler.do_POST();prepare.assert_called_once_with(Path('clip.mp4'),1.5)
            self.assertEqual(reply.call_args.args[1],202)
            self.assertIsNone(payload['package']['hit']['contact'])

if __name__ == '__main__': unittest.main()
