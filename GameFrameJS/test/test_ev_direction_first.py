from contextlib import closing
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'ev-predictor'/'synthetic'))
from baseball_flight import Hit, StartPosition, simulate_trajectory
from direction_first_match import match_direction_first, registered_origin, refine_spray_at_fixed_launch, home_plate_contact
from match_vantage_grid import project_with_camera_pose
from clip_replay import synthetic_flight_points
from direct_video_estimate import export_readiness_for_prediction
from clip_replay import prediction_confidence_sentence


class DirectionFirstTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name)/'flights.sqlite'
        rotation = np.array([[1.,0,0],[0,0,-1],[0,1,0]])
        self.pose = {'intrinsics':np.array([[1200.,0,640],[0,1200.,360],[0,0,1.]]),
                     'rotation':rotation,'translation':-rotation@np.array([-12.,-44.,6.])}
        self.origin = np.array([0.,0.,2.5])
        self.flights = {}
        with closing(sqlite3.connect(self.db)) as c, c:
            c.execute('CREATE TABLE synthetic_hits(hit_id TEXT,exit_velocity_mph REAL,launch_angle_deg REAL,spray_angle_deg REAL,backspin_rpm REAL,sidespin_rpm REAL,batter_hand TEXT,estimate_spin INTEGER,landing_x_ft REAL,landing_y_ft REAL,distance_ft REAL,hang_time_s REAL,apex_ft REAL,apex_time_s REAL)')
            c.execute('CREATE TABLE trajectory_points(hit_id TEXT,relative_time_s REAL,x_ft REAL,y_ft REAL,z_ft REAL)')
            for speed in (80,100):
                for launch,spray in ((24,-14),(23,-18)):
                    t = simulate_trajectory(Hit(speed,launch,spray))
                    name = f'{speed}_{launch}_{spray}'
                    self.flights[name] = t
                    c.execute('INSERT INTO synthetic_hits VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (name,speed,launch,spray,t.backspin_rpm,t.sidespin_rpm,'R',1,t.landing_x_ft,t.landing_y_ft,t.distance_ft,t.hang_time_s,t.apex_ft,t.apex_time_s))
                    c.executemany('INSERT INTO trajectory_points VALUES (?,?,?,?,?)',
                        [(name,p.t_s,p.x_ft,p.y_ft,p.z_ft) for p in t.points])

    def observations(self,speed):
        flight=self.flights[f'{speed}_24_-14']
        times=np.arange(11)/30
        xyz=np.column_stack([np.interp(times,[p.t_s for p in flight.points],[getattr(p,a) for p in flight.points]) for a in ('x_ft','y_ft','z_ft')])
        xyz += self.origin-xyz[0]
        uv,_=project_with_camera_pose(xyz,**self.pose)
        return [{'relative_time_s':float(t),'image_x':float(p[0]),'image_y':float(p[1]),'source':'MANUAL','role':'CONTACT_POINT' if t==0 else 'BALL'} for t,p in zip(times,uv)]

    def test_contact_click_moves_origin_off_plate_and_reprojects_exactly(self):
        for xyz in ([6.54173,-11.33061,4.94334],[0.,5.01,3.],[5.01,0.,3.]):
            pixel,_=project_with_camera_pose(np.array([xyz]),**{k:self.pose[k] for k in ['intrinsics','rotation','translation']})
            for bearing in (-90,-30,0,30,90):
                origin=registered_origin(pixel[0],self.pose,bearing)
                projected,_=project_with_camera_pose(origin[None,:],**{k:self.pose[k] for k in ['intrinsics','rotation','translation']})
                np.testing.assert_allclose(projected[0],pixel[0],atol=1e-8)
                self.assertGreater(np.linalg.norm(origin[:2]),.01)

    def test_small_pixel_change_moves_contact_without_a_pixel_offset(self):
        pixel,_=project_with_camera_pose(np.array([[0.,0.,3.]]),**{k:self.pose[k] for k in ['intrinsics','rotation','translation']})
        origin,error=home_plate_contact(pixel[0]+[3.,0.],self.pose)
        self.assertGreater(np.linalg.norm(origin[:2]),.001)
        self.assertLess(error,1e-8)

    def test_launch_diagnostic_uses_same_contact_ray(self):
        from direct_video_estimate import contact_origin_for_observed_pixel
        pixel,_=project_with_camera_pose(np.array([[6.,-5.,4.]]),**{k:self.pose[k] for k in ['intrinsics','rotation','translation']})
        for direction in ([0.,1.],[1.,0.],[-.5,.8]):
            origin,error=contact_origin_for_observed_pixel(pixel[0],**{k:self.pose[k] for k in ['intrinsics','rotation','translation']},package={},ground_direction_xy=np.array(direction))
            projected,_=project_with_camera_pose(origin,**{k:self.pose[k] for k in ['intrinsics','rotation','translation']})
            np.testing.assert_allclose(projected[0],pixel[0],atol=1e-8)
            self.assertLess(error,1e-8)

    def test_recovers_speed_without_changing_direction_or_origin(self):
        for speed in (80,100):
            result=match_direction_first(self.observations(speed),self.pose,-17,self.db)
            self.assertTrue(result['acceptable'])
            self.assertEqual(result['best']['exit_velocity_mph'],speed)
            self.assertEqual(result['common_launch_angle_deg'],24)
            self.assertEqual(result['common_spray_angle_deg'],-14)
            self.assertTrue(result['at_speed_boundary'])
            self.assertEqual(result['available_speed_range_mph'],[80,100])
            np.testing.assert_allclose(result['contact_origin_ft'],self.origin,atol=1e-8)
            self.assertEqual(len({(c['launch_angle_deg'],c['backspin_rpm'],c['sidespin_rpm']) for c in result['candidates']}),1)
            self.assertAlmostEqual(result['best']['projected_path_rmse_px'],min(c['projected_path_rmse_px'] for c in result['candidates']))
            self.assertLess(result['best']['projected_path_rmse_px'],1e-7)

    def test_rejects_missing_anchor_bad_pose_and_questionable_tracking(self):
        rows=self.observations(80)
        self.assertFalse(match_direction_first(rows[1:],self.pose,-17,self.db)['used'])
        bad={**self.pose,'calibration_diagnostics':{'usable_for_velocity':False}}
        self.assertFalse(match_direction_first(rows,bad,-17,self.db)['used'])
        for row in rows[1:]:
            row.update(source='COMPUTER_VISION',confidence='LOW')
        self.assertFalse(match_direction_first(rows,self.pose,-17,self.db)['used'])

    def test_recovers_speed_missing_inside_stored_family(self):
        seed = self.flights['80_24_-14']
        flight = simulate_trajectory(Hit(90,24,-14,estimate_spin=False,
            backspin_rpm=seed.backspin_rpm,sidespin_rpm=seed.sidespin_rpm),start=StartPosition(*self.origin))
        times = np.arange(11)/30
        xyz = np.column_stack([np.interp(times,[p.t_s for p in flight.points],[getattr(p,a) for p in flight.points])
                               for a in ('x_ft','y_ft','z_ft')])
        uv,_ = project_with_camera_pose(xyz,**self.pose)
        rows = [dict(relative_time_s=float(t),image_x=float(p[0]),image_y=float(p[1]),source='HUMAN') for t,p in zip(times,uv)]
        for points in (rows,[rows[0],rows[-1]]):
            result = match_direction_first(points,self.pose,-17,self.db)
            self.assertEqual(result['best']['exit_velocity_mph'],90)
            self.assertEqual(result['common_launch_angle_deg'],24)
            self.assertLess(result['pixel_error']['rmse_px'],1e-7)
            self.assertTrue(result['acceptable'])
            self.assertFalse(result['at_speed_boundary'])
            self.assertEqual({c['exit_velocity_mph'] for c in result['candidates']},set(range(80,101)))

    def test_export_uses_selected_physical_curve(self):
        result=match_direction_first(self.observations(80),self.pose,-17,self.db)
        points=synthetic_flight_points({'method':'direction_first_shared_synthetic_match','best_trajectory_points':result['trajectory_points']})
        self.assertEqual(len(points),len(result['trajectory_points']))
        np.testing.assert_allclose([points[0][a] for a in ('x','y','z')],self.origin,atol=1e-8)

    def test_two_manual_marks_work_without_auto_tracking(self):
        for speed in (80,100):
            rows=self.observations(speed)
            result=match_direction_first([rows[0],rows[-1]],self.pose,-17,self.db)
            self.assertTrue(result['acceptable'])
            self.assertEqual(result['best']['exit_velocity_mph'],speed)
            for row in rows[1:-1]:
                row.update(source='COMPUTER_VISION',confidence='HIGH')
            with_auto=match_direction_first(rows,self.pose,-17,self.db)
            self.assertEqual(with_auto['best']['exit_velocity_mph'],speed)
            self.assertEqual(with_auto['used_count'],10)

    def test_matching_direction_alone_is_not_accepted_as_matching_speed(self):
        rows=self.observations(80)
        anchor=np.array([rows[0]['image_x'],rows[0]['image_y']])
        for row in rows[1:]:
            pixel=anchor+3*(np.array([row['image_x'],row['image_y']])-anchor)
            row.update(image_x=float(pixel[0]),image_y=float(pixel[1]))
        result=match_direction_first(rows,self.pose,-17,self.db)
        self.assertTrue(result['used'])
        self.assertFalse(result['acceptable'])
        self.assertGreater(result['best']['projected_path_rmse_px'],12)
        self.assertAlmostEqual(result['pixel_error']['rmse_px'],result['best']['projected_path_rmse_px'])
        self.assertEqual(len(result['pixel_error']['points']),10)
        self.assertAlmostEqual(result['pixel_error']['rmse_px']**2,
            result['pixel_error']['along_path_rmse_px']**2 + result['pixel_error']['across_path_rmse_px']**2)

    def test_distance_cannot_change_video_launch_angle(self):
        rows=self.observations(80)
        for distance in (150,300,450):
            result=match_direction_first(rows,self.pose,-17,self.db,distance_ft=distance)
            self.assertEqual(result['common_launch_angle_deg'],24)
            self.assertEqual({c['launch_angle_deg'] for c in result['candidates']},{24})

    def test_spray_can_move_without_changing_launch_spin_camera_or_origin(self):
        seed=self.flights['80_24_-14']
        flight=simulate_trajectory(Hit(80,24,-12,estimate_spin=False,
            backspin_rpm=seed.backspin_rpm,sidespin_rpm=seed.sidespin_rpm))
        times=np.arange(11)/30
        xyz=np.column_stack([np.interp(times,[p.t_s for p in flight.points],[getattr(p,a) for p in flight.points])
                             for a in ('x_ft','y_ft','z_ft')])
        xyz+=self.origin-xyz[0]
        uv,_=project_with_camera_pose(xyz,**self.pose)
        candidates=[{'hit_id':str(s),'exit_velocity_mph':s,'launch_angle_deg':24,
                     'backspin_rpm':seed.backspin_rpm,'sidespin_rpm':seed.sidespin_rpm} for s in (80,100)]
        key=(24,-14,seed.backspin_rpm,seed.sidespin_rpm,'R',1)
        rows=refine_spray_at_fixed_launch(candidates,key,self.origin,self.pose,times[1:],uv[1:],uv[0],-17)
        best=min(rows,key=lambda r:r['projected_path_rmse_px'])
        self.assertEqual(best['spray_angle_deg'],-12)
        self.assertEqual(best['exit_velocity_mph'],80)
        self.assertLess(best['projected_path_rmse_px'],1e-7)
        self.assertEqual({r['launch_angle_deg'] for r in rows},{24})
        self.assertTrue(all(abs(r['landing_angle_residual_deg'])<=5 for r in rows))

    def test_poor_position_fit_is_disclosed_in_ui_and_export(self):
        prediction={'method':'direction_first_shared_synthetic_match',
            'direction_first_match':{'used':True,'acceptable':False,'direction_rmse_deg':0.5,
                                     'best':{'projected_path_rmse_px':21}},
            'ev_candidates':[{'launch_angle_deg':23,'exit_velocity_mph':86,'projected_path_rmse_px':21}]}
        readiness=export_readiness_for_prediction(prediction,[])
        self.assertTrue(readiness['allowed'])
        self.assertEqual(readiness['confidence'],'LOW')
        self.assertEqual(readiness['severity'],'warning')
        self.assertIn('21.0 px',prediction_confidence_sentence(prediction))
        self.assertIn('does not follow the ball positions',prediction_confidence_sentence(prediction))


if __name__=='__main__':
    unittest.main()
