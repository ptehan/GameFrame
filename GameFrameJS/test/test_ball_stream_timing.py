"""Exercise fresh 30/60 fps and VFR decode independently of ball identity."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'experiments/ball-assist'))
import contact_scan
import stream_scan

FFMPEG = ROOT/'node_modules/ffmpeg-static/ffmpeg.exe'
FFPROBE = ROOT/'node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe'


class StreamTimingTests(unittest.TestCase):
    def test_source_numbering_timestamps_cadence_and_contact_scaling(self):
        with tempfile.TemporaryDirectory() as directory:
            for fps, vfr in [(30, False), (60, False), (30, True)]:
                with self.subTest(fps=fps, vfr=vfr):
                    video = Path(directory)/f'{fps}-{vfr}.mp4'
                    command = [str(FFMPEG), '-v', 'error', '-f', 'lavfi', '-i',
                               f'testsrc2=size=160x90:rate={fps}:duration=11', '-an']
                    if vfr:
                        command += ['-vf', 'select=not(eq(mod(n\\,7)\\,3))', '-fps_mode', 'vfr']
                    subprocess.run(command+['-c:v', 'libx264', '-threads', '1', str(video)],
                                   stdin=subprocess.DEVNULL, capture_output=True, check=True)
                    data = json.loads(subprocess.run([str(FFPROBE), '-v', 'error', '-select_streams', 'v:0',
                                      '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time',
                                      '-of', 'json', str(video)], stdin=subprocess.DEVNULL,
                                      capture_output=True, check=True).stdout)
                    times = [float(row['best_effort_timestamp_time']) for row in data['frames']]
                    # Avoid a rounded ffprobe decimal falling on a selection boundary.
                    start = .251
                    dense_end = start+(10+__import__('math').ceil(fps*.4))/fps
                    stride = max(5, round(fps/6))
                    indices = [i for i,t in enumerate(times) if start<=t<start+10 and (t<dense_end or i%stride==0)]
                    launch_seen = []

                    def launch(config):
                        launch_seen.append(config)
                        self.assertEqual(config['contact'], {'frame':0, 'x':80., 'y':45.})
                        self.assertEqual(len(config['_frames']), sum(times[i]<dense_end-1e-6 for i in indices))
                        return {'points':[]}

                    def hybrid(config, progress, launch):
                        self.assertEqual(len(config['_frames']), len(indices))
                        return {'points':[], 'last_scanned_frame':len(indices)-1}

                    with patch.object(contact_scan, 'scan', side_effect=launch), patch.object(contact_scan, 'scan_hybrid', side_effect=hybrid):
                        result = stream_scan.scan_video({'video_path':str(video), 'ffmpeg':str(FFMPEG),
                            'start':start, 'source_fps':fps, 'input_width':320, 'input_height':180,
                            'contact':{'frame':0,'x':160.,'y':90.}})
                    self.assertEqual(len(launch_seen), 1)
                    self.assertEqual(result['session']['frameNumbers'], indices)
                    self.assertEqual(len(result['session']['times']), len(indices))
                    for actual, expected in zip(result['session']['times'], [times[i] for i in indices]):
                        self.assertAlmostEqual(actual, expected, places=6)
                    self.assertGreater(result['session']['times'][-1]-start, 9.7)


if __name__ == '__main__':
    unittest.main()
