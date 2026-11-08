import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor'))
import clip_server as service

class VideoTimingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(); cls.folder=Path(cls.temp.name)
        cls.constant=cls.folder/'constant.mp4'; cls.variable=cls.folder/'variable.mp4'
        ffmpeg=shutil.which('ffmpeg')
        if not ffmpeg: raise unittest.SkipTest('ffmpeg unavailable')
        common=[ffmpeg,'-v','error','-f','lavfi','-i','testsrc2=size=128x72:rate=60','-t','2']
        subprocess.run(common+['-c:v','libx264',str(cls.constant)],check=True,capture_output=True)
        subprocess.run(common+['-vf',"select='if(lt(t,1),1,not(mod(n,2)))'",'-fps_mode','vfr','-c:v','libx264',str(cls.variable)],check=True,capture_output=True)
    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()
    def request(self,source,**values):
        payload=dict(file_name=source.name,source_path=str(source),file_size=source.stat().st_size,reference_time_s=1.5,**values)
        responses=[]; handler=object.__new__(service.ClipServerHandler)
        with patch.object(service,'handle_json_body',return_value=payload),patch.object(service,'json_response',side_effect=lambda h,status,data:responses.append((status,data))):
            handler.handle_video_timing()
        return responses[-1]
    def test_constant_rate_uses_actual_sixty_fps_timestamps(self):
        status,data=self.request(self.constant)
        self.assertEqual(status,200,data);self.assertAlmostEqual(data['fps'],60,places=3)
        self.assertFalse(data['variable_frame_rate']);self.assertEqual(data['timing_source'],'source_frame_timestamps')
        self.assertAlmostEqual(data['frame_step_assumption_s'],1/60,places=5)
    def test_variable_spacing_is_preserved_and_identified(self):
        status,data=self.request(self.variable)
        self.assertEqual(status,200,data);self.assertTrue(data['variable_frame_rate'])
        gaps=[b-a for a,b in zip(data['frame_times_s'],data['frame_times_s'][1:])]
        self.assertLess(min(gaps),.02);self.assertGreater(max(gaps),.03)
    def test_wrong_file_size_does_not_return_another_videos_timing(self):
        payload=dict(file_name=self.constant.name,source_path=str(self.constant),file_size=1,reference_time_s=1)
        results=[]; handler=object.__new__(service.ClipServerHandler)
        with patch.object(service,'handle_json_body',return_value=payload),patch.object(service,'json_response',side_effect=lambda h,status,data:results.append((status,data))):handler.handle_video_timing()
        self.assertEqual(results[-1][0],422)
if __name__=='__main__':unittest.main(verbosity=2)
