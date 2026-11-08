"""Known-truth geometry/recovery checks, independent image projection, read-only production DB."""
import json
import math
import os
from pathlib import Path
import sqlite3
import sys
from contextlib import closing
import tempfile
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from baseball_flight import Ball, Hit, StartPosition, simulate_trajectory
from path_distance_match import match_path_and_distance
from match_vantage_grid import project_with_camera_pose


def independent_pose(center, fov=60):
    center=np.array(center,dtype=float)
    forward=np.array([0.,45.,8.])-center; forward/=np.linalg.norm(forward)
    right=np.cross(forward,[0.,0.,1.]); right/=np.linalg.norm(right)
    up=np.cross(right,forward)
    rotation=np.array([right,-up,forward])
    focal=640/math.tan(math.radians(fov/2))
    return dict(intrinsics=np.array([[focal,0.,640],[0.,focal,360],[0.,0.,1.]]),rotation=rotation,translation=-rotation@center)


def independent_pixels(xyz,pose):
    # Separate scalar pinhole implementation, rather than the matching projector.
    answer=[]
    for point in xyz:
        p=pose['rotation'].dot(point)+pose['translation']
        answer.append([640+pose['intrinsics'][0,0]*p[0]/p[2],360+pose['intrinsics'][1,1]*p[1]/p[2]])
    return np.array(answer)

class SyntheticRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(); cls.db=Path(cls.temp.name)/'truth.sqlite'
        cls.results=[]; cls.flights={}
        with closing(sqlite3.connect(cls.db)) as c, c:
            c.execute('CREATE TABLE synthetic_hits(hit_id TEXT,exit_velocity_mph REAL,launch_angle_deg REAL,spray_angle_deg REAL,backspin_rpm REAL,sidespin_rpm REAL,batter_hand TEXT,estimate_spin INTEGER,landing_x_ft REAL,landing_y_ft REAL,distance_ft REAL,hang_time_s REAL,apex_ft REAL,apex_time_s REAL,landing_spray_angle_deg REAL)')
            c.execute('CREATE TABLE trajectory_points(hit_id TEXT,relative_time_s REAL,x_ft REAL,y_ft REAL,z_ft REAL)')
            c.execute('CREATE INDEX trajectory_time ON trajectory_points(hit_id,relative_time_s)')
            c.execute('CREATE TABLE generation_manifest(version TEXT)')
            for speed in [80,86,92]:
                for angle in [8,19,32]:
                    for spray in [-35,0,35]:
                        f=simulate_trajectory(Hit(speed,angle,spray,estimate_spin=False),start=StartPosition(0,0,3))
                        name=f'{speed}_{angle}_{spray}'; cls.flights[speed,angle,spray]=f
                        c.execute('INSERT INTO synthetic_hits VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(name,speed,angle,spray,0,0,'R',0,f.landing_x_ft,f.landing_y_ft,f.distance_ft,f.hang_time_s,f.apex_ft,f.apex_time_s,spray))
                        c.executemany('INSERT INTO trajectory_points VALUES(?,?,?,?,?)',[(name,p.t_s,p.x_ft,p.y_ft,p.z_ft) for p in f.points])
    @classmethod
    def tearDownClass(cls):
        if os.environ.get('EV_RECOVERY_REPORT'):
            Path(os.environ['EV_RECOVERY_REPORT']).write_text(json.dumps(cls.results,indent=2))
        cls.temp.cleanup()
    def observations(self,flight,pose,times=None):
        times=np.linspace(0,.3,7) if times is None else np.array(times)
        xyz=np.column_stack([np.interp(times,[p.t_s for p in flight.points],[getattr(p,a) for p in flight.points]) for a in ('x_ft','y_ft','z_ft')])
        uv=independent_pixels(xyz,pose)
        return [dict(relative_time_s=float(t),image_x=float(p[0]),image_y=float(p[1]),source='HUMAN',role='CONTACT_POINT' if t==0 else 'BALL',uncertainty_px=2) for t,p in zip(times,uv)]
    def test_drag_free_limit_matches_independent_gravity_equations(self):
        # The compatible flight engine uses the documented rounded 1.467
        # mph-to-ft/s factor. Test Newtonian motion independently of its loop.
        speed=86*1.467; angle=math.radians(19); spray=math.radians(-30)
        self.assertLess(abs(speed-86*5280/3600)/(86*5280/3600),.0003)
        flight=simulate_trajectory(Hit(86,19,-30,estimate_spin=False),ball=Ball(mass_oz=1e15),start=StartPosition(0,0,3))
        for p in flight.points:
            self.assertAlmostEqual(p.x_ft,speed*math.cos(angle)*math.sin(spray)*p.t_s,places=7)
            self.assertAlmostEqual(p.y_ft,speed*math.cos(angle)*math.cos(spray)*p.t_s,places=7)
            self.assertAlmostEqual(p.z_ft,3+speed*math.sin(angle)*p.t_s-.5*32.174*p.t_s**2,places=7)

    def test_rotating_ground_direction_preserves_true_launch_angle(self):
        for angle in [0,8,19,32,60]:
            for spray in [-80,-45,0,45,80]:
                a,s=map(math.radians,[angle,spray]); speed=86*5280/3600
                velocity=[speed*math.cos(a)*math.sin(s),speed*math.cos(a)*math.cos(s),speed*math.sin(a)]
                recovered=math.degrees(math.atan2(velocity[2],math.hypot(*velocity[:2])))
                self.assertAlmostEqual(recovered,angle,places=10)
                f=simulate_trajectory(Hit(86,angle,spray,estimate_spin=False),start=StartPosition(0,0,3))
                p=f.points[0]
                self.assertAlmostEqual(math.degrees(math.atan2(p.vz_ft_s,math.hypot(p.vx_ft_s,p.vy_ft_s))),angle,places=8)
    def test_full_recovery_across_spray_camera_height_zoom_and_launch(self):
        views=[([-20,-100,6],60),([-100,-70,12],60),([100,-70,6],45),([-40,-180,15],35)]
        for camera,fov in views:
            for spray in [-35,0,35]:
                for angle in [8,19,32]:
                    with self.subTest(camera=camera,fov=fov,spray=spray,angle=angle):
                        pose=independent_pose(camera,fov); f=self.flights[86,angle,spray]
                        rows=self.observations(f,pose)
                        r=match_path_and_distance(rows,pose,spray,self.db,refine=False)
                        best=r.get('best',{})
                        self.results.append(dict(camera=camera,fov=fov,true_launch=angle,true_spray=spray,true_speed=86,recovered_launch=best.get('launch_angle_deg'),recovered_speed=best.get('exit_velocity_mph'),acceptable=r.get('acceptable'),pixel_error=best.get('projected_path_rmse_px')))
                        self.assertTrue(r.get('acceptable'),r.get('reason'))
                        self.assertAlmostEqual(best['launch_angle_deg'],angle,places=5)
                        self.assertAlmostEqual(best['exit_velocity_mph'],86,places=5)
                        self.assertLess(best['projected_path_rmse_px'],1e-7)
    def test_off_grid_speed_and_launch_recovered_with_multiple_marks(self):
        for spray in [-33,2,33]:
            with self.subTest(spray=spray):
                f=simulate_trajectory(Hit(85.5,18.5,spray,estimate_spin=False),start=StartPosition(0,0,3))
                pose=independent_pose([-20,-100,10],50)
                r=match_path_and_distance(self.observations(f,pose),pose,spray,self.db,refine=True)
                b=r.get('best',{})
                self.results.append(dict(test='off_grid',true_launch=18.5,true_spray=spray,true_speed=85.5,recovered_launch=b.get('launch_angle_deg'),recovered_speed=b.get('exit_velocity_mph')))
                self.assertTrue(r.get('acceptable'),r.get('reason'))
                self.assertLess(abs(b['launch_angle_deg']-18.5),.5)
                self.assertLess(abs(b['exit_velocity_mph']-85.5),1)
    def test_fractional_contact_preserves_measured_positions_and_recovers_launch(self):
        from contact_timing import prepare_contact_observations
        for fps in [24,30,60]:
            for phase in [.25,.5,.75]:
                for center in [[-20,-100,6],[100,-70,12]]:
                    with self.subTest(fps=fps,phase=phase,camera=center):
                        pose=independent_pose(center,55)
                        rows=self.observations(self.flights[86,19,0],pose,phase/fps+np.linspace(0,.3,7))
                        rows[0].update(role='CONTACT_POINT',contact_timing_mode='BETWEEN_FRAMES')
                        before=json.dumps(rows)
                        prepared=prepare_contact_observations(rows)
                        self.assertEqual(json.dumps(rows),before)
                        self.assertEqual(prepared[0]['source'],'MODEL_ANCHOR')
                        self.assertFalse(prepared[0]['independent_observation'])
                        self.assertAlmostEqual(prepared[1]['relative_time_s'],phase/fps)
                        result=match_path_and_distance(rows,pose,0,self.db,refine=True)
                        b=result.get('best',{})
                        self.results.append(dict(test='fractional_contact',fps=fps,phase=phase,camera=center,recovered_launch=b.get('launch_angle_deg'),recovered_speed=b.get('exit_velocity_mph')))
                        self.assertTrue(result.get('acceptable'),result.get('reason'))
                        self.assertLess(abs(b['launch_angle_deg']-19),.5)
                        self.assertLess(abs(b['exit_velocity_mph']-86),1)
    def test_small_mark_errors_retain_true_flight_in_supported_range(self):
        pose=independent_pose([-20,-100,10],55)
        rows=self.observations(self.flights[86,19,0],pose)
        for i,row in enumerate(rows[1:]):
            row['image_x']+=.75*(-1)**i; row['image_y']+=.5*(-1)**i
        result=match_path_and_distance(rows,pose,0,self.db,refine=True)
        self.assertTrue(result['acceptable'])
        self.assertLessEqual(result['supported_ranges']['launch_angle_deg'][0],19)
        self.assertGreaterEqual(result['supported_ranges']['launch_angle_deg'][1],19)
        self.assertLessEqual(result['supported_ranges']['exit_velocity_mph'][0],86)
        self.assertGreaterEqual(result['supported_ranges']['exit_velocity_mph'][1],86)
    def test_explicit_bad_calibration_is_rejected(self):
        pose=independent_pose([-20,-100,10]); pose['calibration_diagnostics']={'usable_for_velocity':False}
        result=match_path_and_distance(self.observations(self.flights[86,19,0],pose),pose,0,self.db)
        self.assertFalse(result['used'])

    def test_display_resize_and_letterboxing_preserve_recovery(self):
        pose=independent_pose([-20,-100,10]); f=self.flights[86,19,0]
        rows=self.observations(f,pose)
        for scale,offset in [(.5,[0,100]),(1.5,[45,0])]:
            transformed={**pose,'intrinsics':np.array([[scale,0,offset[0]],[0,scale,offset[1]],[0,0,1]])@pose['intrinsics']}
            marks=[{**r,'image_x':r['image_x']*scale+offset[0],'image_y':r['image_y']*scale+offset[1]} for r in rows]
            result=match_path_and_distance(marks,transformed,0,self.db,refine=False)
            self.assertAlmostEqual(result['best']['launch_angle_deg'],19)
            self.assertAlmostEqual(result['best']['exit_velocity_mph'],86)

if __name__=='__main__': unittest.main(verbosity=2)
