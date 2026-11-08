import tempfile, unittest
from pathlib import Path
import cv2
import numpy as np
from bracket_refine import refine_between_detections, bracket_geometry

class BracketTests(unittest.TestCase):
    def run_scene(self, middle='ball', pan=0):
        with tempfile.TemporaryDirectory() as directory:
            files=[]; points=[]; cameras={}
            for frame in range(9):
                image=np.full((160,320),80,np.uint8)
                x,y=50+18*frame,80
                cameras[frame]=np.array([[1.,0.,pan*frame],[0.,1.,0.],[0.,0.,1.]])
                if frame!=4 or middle!='blank':
                    draw_y=y+25 if frame==4 and middle=='offpath' else y
                    draw_x=x+60 if frame==4 and middle=='wrongdistance' else x
                    cv2.circle(image,(draw_x+pan*frame,draw_y),2,235,-1)
                path=Path(directory)/f'{frame}.png';cv2.imwrite(str(path),image);files.append(path)
                if frame!=4:
                    points.append(dict(frame=frame,x=x+pan*frame,y=y,stabilized_x=x,stabilized_y=y,segment=0,evidence=1.,net_clear=True))
            return refine_between_detections(files,points,cameras,30,range(9))

    def test_recovers_visible_middle_from_pixels(self):
        points,report=self.run_scene()
        self.assertIn(4,report['refined_frames'])
        point=next(p for p in points if p['frame']==4)
        self.assertLess(np.hypot(point['x']-122,point['y']-80),2)

    def test_does_not_invent_ball_on_blank_frame(self):
        points,report=self.run_scene('blank')
        self.assertNotIn(4,[p['frame'] for p in points])

    def test_rejects_off_path_object(self):
        points,_=self.run_scene('offpath')
        self.assertNotIn(4,[p['frame'] for p in points])

    def test_rejects_wrong_distance_object(self):
        points,_=self.run_scene('wrongdistance')
        self.assertNotIn(4,[p['frame'] for p in points])

    def test_compensates_camera_pan(self):
        points,report=self.run_scene(pan=3)
        self.assertIn(4,report['refined_frames'])
        point=next(p for p in points if p['frame']==4)
        self.assertLess(abs(point['stabilized_x']-122),2)

if __name__=='__main__':unittest.main()
