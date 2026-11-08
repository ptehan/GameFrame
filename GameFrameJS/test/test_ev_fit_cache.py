import copy
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from flight_fit_cache import evidence_key, get_fit, put_fit, clear_fit_cache


class FitCacheTests(unittest.TestCase):
    def setUp(self):
        clear_fit_cache()
        self.rows = [dict(relative_time_s=0, image_x=100, image_y=200, source='HUMAN')]
        self.pose = dict(rotation=[[1,0,0],[0,1,0],[0,0,1]])

    def key(self, rows=None, pose=None, package=None, terminal=None):
        return evidence_key(rows or self.rows, pose or self.pose, -12, 1/30,
                            terminal, package or {}, .5, None)

    def test_distance_and_description_do_not_change_flight_evidence(self):
        package = dict(hit=dict(description='A', distance_observation=dict(distance_ft=319)))
        key = self.key(package=package)
        package['hit'].update(description='B',distance_observation=dict(distance_ft=322))
        self.assertEqual(key,self.key(package=package))

    def test_measurement_camera_and_terminal_changes_invalidate(self):
        key = self.key()
        rows = copy.deepcopy(self.rows); rows[0]['image_x'] += 1
        self.assertNotEqual(key,self.key(rows=rows))
        rows = copy.deepcopy(self.rows); rows[0]['relative_time_s'] += .033
        self.assertNotEqual(key,self.key(rows=rows))
        self.assertNotEqual(key,self.key(pose={'rotation':[[0,1,0],[1,0,0],[0,0,1]]}))
        self.assertNotEqual(key,self.key(terminal={'type':'FIRST_GROUND_CONTACT','relative_time_s':3.5}))

    def test_source_replacement_invalidates(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'hit.mp4'; source.write_bytes(b'first')
            package={'video_metadata':{'source_path':str(source)}}
            key=self.key(package=package)
            source.write_bytes(b'replacement')
            self.assertNotEqual(key,self.key(package=package))

    def test_cached_context_is_not_mutated_by_callers(self):
        context={'candidates':[{'score':1,'projected_pixels':[[1,2]]}]}
        put_fit('A',context)
        context['candidates'][0]['score']=9
        first=get_fit('A'); first['candidates'][0]['projected_pixels'][0][0]=7
        self.assertEqual(get_fit('A')['candidates'][0],{'score':1,'projected_pixels':[[1,2]]})

    def test_cache_is_bounded_and_failures_are_not_reused(self):
        for key in ('A','B','C'):put_fit(key,{'candidates':[{}]})
        self.assertIsNone(get_fit('A'))
        self.assertIsNotNone(get_fit('B'))
        put_fit('failed',{'candidates':[]})
        self.assertIsNone(get_fit('failed'))


if __name__=='__main__':unittest.main()
