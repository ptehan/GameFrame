import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from evidence_analysis_cache import cached_analysis,clear_analysis_cache,source_identity

class EvidenceAnalysisCacheTests(unittest.TestCase):
    def setUp(self):clear_analysis_cache()

    def test_reuse_isolated_from_caller_mutation(self):
        calls=[]
        def calculate():
            calls.append(1)
            return {'points':[5]}
        first=cached_analysis('camera',{'click':[10,20]},calculate)
        first['points'][0]=999
        second=cached_analysis('camera',{'click':[10,20]},calculate)
        self.assertEqual(second,{'points':[5]})
        self.assertEqual(len(calls),1)

    def test_changed_click_direction_or_stage_recomputes(self):
        calls=[]
        def calculate():calls.append(1);return len(calls)
        for stage,evidence in [('angle',[10,20,30]),('angle',[11,20,30]),('angle',[11,20,31]),('camera',[11,20,31])]:
            cached_analysis(stage,evidence,calculate)
        self.assertEqual(len(calls),4)

    def test_replaced_source_invalidates_registration(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'source.mp4';meta={'source_path':str(p)}
            missing=source_identity(meta)
            p.write_bytes(b'first');first=source_identity(meta)
            p.write_bytes(b'new source');second=source_identity(meta)
            self.assertNotEqual(missing,first)
            self.assertNotEqual(first,second)

    def test_failed_analysis_is_not_cached(self):
        def fail():raise ValueError('failed')
        with self.assertRaises(ValueError):cached_analysis('camera',[1],fail)
        self.assertEqual(cached_analysis('camera',[1],lambda:42),42)

if __name__=='__main__':unittest.main()
