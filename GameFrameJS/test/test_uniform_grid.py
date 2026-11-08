from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from uniform_grid import cases, validate_batch
from rebuild_uniform_database import build, validate_database
from baseball_flight import Hit, simulate_trajectory
from path_distance_match import match_path_and_distance
from match_vantage_grid import project_with_camera_pose
from distance_review import build_distance_review


class UniformGridTests(unittest.TestCase):
    def test_reference_physics_and_sampling(self):
        result=validate_batch()
        self.assertEqual(result['reference_cases'],60)
        self.assertLess(result['maximum_absolute_difference'],1e-7)

    def test_default_axes_are_complete(self):
        rows=list(cases())
        self.assertEqual(len(rows),24518)
        self.assertEqual(len(set(rows)),24518)
        self.assertEqual({r[0] for r in rows},set(range(40,121,2)))
        self.assertEqual({r[1] for r in rows},set(range(0,51,2)))
        self.assertEqual({r[2] for r in rows},set(range(-33,34,3)))

    def test_build_retains_other_data_and_detects_holes(self):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'old.sqlite';target=Path(folder)/'new.sqlite'
            with closing(sqlite3.connect(source)) as c,c:
                c.execute('CREATE TABLE saved_hit_results (id INTEGER, value TEXT)')
                c.execute("INSERT INTO saved_hit_results VALUES(1,'preserve')")
            axes=(range(80,82),range(23,25),range(-13,-11))
            build(source,target,batch_size=4,speeds=axes[0],launches=axes[1],sprays=axes[2])
            rotation=np.array([[1.,0,0],[0,0,-1],[0,1,0]])
            pose={'intrinsics':np.array([[1200.,0,640],[0,1200.,360],[0,0,1.]]),
                  'rotation':rotation,'translation':-rotation@np.array([-12.,-44.,6.])}
            flight=simulate_trajectory(Hit(80,23,-13))
            times=np.arange(11)/30
            xyz=np.column_stack([np.interp(times,[p.t_s for p in flight.points],[getattr(p,a) for p in flight.points]) for a in ('x_ft','y_ft','z_ft')])
            xyz+=np.array([0.,0.,3.])-xyz[0]
            uv,_=project_with_camera_pose(xyz,**pose)
            observations=[{'relative_time_s':float(t),'image_x':float(p[0]),'image_y':float(p[1]),'source':'HUMAN'} for t,p in zip(times,uv)]
            with patch('path_distance_match.refine_candidates',side_effect=AssertionError('Uniform grid must use stored simulations')):
                result=match_path_and_distance(observations,pose,-16,target,distance_ft=flight.distance_ft)
            self.assertTrue(result['acceptable'])
            self.assertEqual(result['database_grid'],'uniform')
            self.assertFalse(result['refinement']['enabled'])
            self.assertEqual(result['best']['hit_id'],'g_80_23_-13')
            self.assertLess(result['best']['projected_path_rmse_px'],.05)
            rejected = match_path_and_distance(observations, pose, -16, target, distance_ft=1000)
            self.assertFalse(rejected['used'])
            independent = match_path_and_distance(observations, pose, -16, target, distance_ft=None)
            review = build_distance_review(rejected, independent, 1000)
            self.assertEqual(review['status'], 'distance_conflict')
            self.assertTrue(review['alternatives'])
            with closing(sqlite3.connect(target)) as c,c:
                self.assertEqual(c.execute('SELECT value FROM saved_hit_results').fetchone()[0],'preserve')
                self.assertEqual(validate_database(c,axes)['synthetic_hits'],8)
                with self.assertRaises(sqlite3.IntegrityError):
                    c.execute('INSERT INTO synthetic_hits SELECT * FROM synthetic_hits LIMIT 1')
                c.execute('DELETE FROM synthetic_hits WHERE hit_id=(SELECT hit_id FROM synthetic_hits LIMIT 1)')
                with self.assertRaises(AssertionError):validate_database(c,axes)
            with closing(sqlite3.connect(source)) as c:
                self.assertEqual(c.execute('SELECT value FROM saved_hit_results').fetchone()[0],'preserve')


if __name__=='__main__':unittest.main()
