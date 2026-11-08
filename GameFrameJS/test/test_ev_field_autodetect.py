import sys
import unittest
from pathlib import Path
import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ev-predictor/synthetic'))
from field_landmark_detect import detect_landmarks, find_mound_top, fit_white_baseline


class FieldAutoDetectTest(unittest.TestCase):
    def test_colored_surface_boundary_without_chalk_is_rejected(self):
        frame=np.full((540,960,3),(95,135,100),dtype=np.uint8)
        frame[300:]=(95,105,135)
        self.assertIsNone(fit_white_baseline(cv2.cvtColor(frame,cv2.COLOR_BGR2HSV),np.array([100,300]),np.array([800,300])))

    def test_boundary_seed_snaps_to_visible_white_chalk(self):
        frame=np.full((540,960,3),(95,135,100),dtype=np.uint8)
        frame[300:]=(95,105,135)
        cv2.line(frame,(100,298),(800,298),(175,175,175),2)
        found=fit_white_baseline(cv2.cvtColor(frame,cv2.COLOR_BGR2HSV),np.array([100,304]),np.array([800,304]))
        self.assertIsNotNone(found)
        self.assertLess(abs(found['a'][1]-298),2)
        self.assertLess(abs(found['b'][1]-298),2)
    def scene(self, scale=1):
        width,height=960,540
        camera=np.array([15.,-40.,6.]); contact=np.array([550.,370.])
        forward=np.array([0.,0.,3.])-camera;forward/=np.linalg.norm(forward)
        right=np.cross(forward,[0.,0.,1.]);right/=np.linalg.norm(right)
        down=np.cross(forward,right)
        def project(point):
            delta=np.array(point)-camera
            return tuple(np.round(np.array([delta@right,delta@down])*width*.9/(delta@forward)+contact).astype(int))
        frame=np.zeros((height,width,3),np.uint8);frame[:]=[45,100,45]
        home=project([0,0,0])
        for sign in (-1,1):
            cv2.line(frame,home,project([sign*64,64,0]),(245,245,245),4)
        rubber=project([0,60.5,0])
        cv2.ellipse(frame,rubber,(22,8),0,0,360,(40,70,140),-1)
        cv2.rectangle(frame,(rubber[0]-6,rubber[1]-2),(rubber[0]+6,rubber[1]+2),(255,255,255),-1)
        pkg={'camera':{'field_xy_ft':{'x':15,'y':-40},'height_ft':6},
             'ball_observations':[{'role':'CONTACT_POINT','image_x':550/scale,'image_y':370/scale}],
             'field':{'mound_distance_ft':60.5,'base_distance_ft':90}}
        return frame,pkg,home,rubber

    def test_painted_baselines_and_rubber_with_camera_contact_prior(self):
        frame,pkg,home,rubber=self.scene()
        rows={r['landmark']:r for r in detect_landmarks(frame,1,pkg)}
        self.assertEqual(set(rows),{'home_plate','pitching_rubber','first_baseline_near','first_baseline_far','third_baseline_near','third_baseline_far'})
        for name,expected in [('home_plate',home),('pitching_rubber',rubber)]:
            self.assertLess(np.linalg.norm(np.array([rows[name]['image_x'],rows[name]['image_y']])-expected),10)

    def test_no_visual_evidence_does_not_fabricate_marks(self):
        frame,pkg,_,_=self.scene()
        frame[:]=[45,100,45]
        self.assertEqual(detect_landmarks(frame,1,pkg),[])

    def test_source_pixel_scaling(self):
        frame,pkg,home,_=self.scene(.5)
        rows={r['landmark']:r for r in detect_landmarks(frame,.5,pkg)}
        self.assertLess(np.linalg.norm(np.array([rows['home_plate']['image_x'],rows['home_plate']['image_y']])-np.array(home)*2),20)

    def test_long_white_fence_does_not_replace_baselines(self):
        frame,pkg,home,_=self.scene()
        cv2.line(frame,(0,330),(959,330),(245,245,245),4)
        rows={r['landmark']:r for r in detect_landmarks(frame,1,pkg)}
        self.assertIn('home_plate',rows)
        self.assertLess(np.linalg.norm(np.array([rows['home_plate']['image_x'],rows['home_plate']['image_y']])-home),10)
        for side in ('first','third'):
            self.assertIn(side+'_baseline_near',rows)
            self.assertIn(side+'_baseline_far',rows)

    def test_hidden_rubber_suggests_visible_mound_with_larger_uncertainty(self):
        frame,pkg,home,rubber=self.scene()
        cv2.rectangle(frame,(rubber[0]-7,rubber[1]-3),(rubber[0]+7,rubber[1]+3),(40,70,140),-1)
        cv2.rectangle(frame,(rubber[0]-2,rubber[1]-30),(rubber[0]+2,rubber[1]+1),(30,30,30),-1)
        rows={r['landmark']:r for r in detect_landmarks(frame,1,pkg)}
        mound=rows['pitching_rubber']
        self.assertEqual(mound['estimate_kind'],'MOUND_TOP_APPROXIMATION')
        self.assertFalse(mound['rubber_visible'])
        self.assertGreater(mound['uncertainty_px'],45)
        self.assertLess(np.linalg.norm(np.array([mound['image_x'],mound['image_y']])-rubber),15)

    def test_large_infield_strip_is_not_a_mound(self):
        frame,pkg,home,rubber=self.scene()
        frame[:]=[45,100,45]
        cv2.rectangle(frame,(0,rubber[1]-10),(959,rubber[1]+10),(40,70,140),-1)
        self.assertIsNone(find_mound_top(cv2.cvtColor(frame,cv2.COLOR_BGR2HSV),np.array(rubber),np.array(home)))

    def test_mound_beats_nearer_short_basepath_fragment(self):
        frame=np.full((540,960,3),(45,100,45),dtype=np.uint8)
        cv2.ellipse(frame,(400,300),(70,9),0,0,360,(40,70,140),-1)
        cv2.rectangle(frame,(490,280),(610,286),(40,70,140),-1)
        point=find_mound_top(cv2.cvtColor(frame,cv2.COLOR_BGR2HSV),np.array([550,290]),np.array([600,450]))
        self.assertIsNotNone(point)
        self.assertLess(abs(point[0]-400),5)

    def test_marker_follows_top_contour_instead_of_inside_mound(self):
        frame=np.full((540,960,3),(45,100,45),dtype=np.uint8)
        cv2.ellipse(frame,(400,300),(60,15),0,0,360,(40,70,140),-1)
        # A pitcher can hide some of the middle; use the visible contour beside it.
        cv2.rectangle(frame,(398,260),(402,290),(30,30,30),-1)
        point=find_mound_top(cv2.cvtColor(frame,cv2.COLOR_BGR2HSV),np.array([410,300]),np.array([600,450]))
        self.assertIsNotNone(point)
        self.assertLessEqual(abs(point[1]-285),2)

    def test_short_batter_box_segments_are_not_baseline_pairs(self):
        frame,pkg,home,rubber=self.scene()
        frame[:]=[45,100,45]
        cv2.line(frame,(home[0]-30,home[1]),(home[0]+30,home[1]),(250,250,250),3)
        rows=detect_landmarks(frame,1,pkg)
        self.assertFalse(any('baseline' in row['landmark'] for row in rows))

    def test_mound_is_found_when_connected_to_a_thin_basepath(self):
        frame=np.full((540,960,3),(45,100,45),dtype=np.uint8)
        cv2.rectangle(frame,(0,300),(959,302),(40,70,140),-1)
        cv2.ellipse(frame,(400,302),(70,12),0,0,360,(40,70,140),-1)
        point=find_mound_top(cv2.cvtColor(frame,cv2.COLOR_BGR2HSV),np.array([410,300]),np.array([600,450]))
        self.assertIsNotNone(point)
        self.assertLess(abs(point[0]-400),5)
        self.assertLessEqual(point[1],292)

if __name__=='__main__':unittest.main()
