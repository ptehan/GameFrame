import sys, tempfile, unittest
from unittest.mock import patch, MagicMock
from pathlib import Path
import numpy as np
import cv2
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ev-predictor/synthetic'))
from camera_motion_observations import apply_registration, register_ball_observations,detector_reuse_neighbors,reuse_detector_registration


class CameraMotionTests(unittest.TestCase):
    def test_sparse_alignment_failure_retries_full_feature_set(self):
        # An inconclusive fast attempt must never suppress the original fallback.
        import camera_motion_observations as model
        frame = np.zeros((72,128,3), dtype=np.uint8)
        corners = np.zeros((1000,1,2), dtype=np.float32)
        capture = MagicMock()
        capture.get.return_value = 30.
        capture.read.return_value = (True, frame)
        rows = [dict(relative_time_s=t,video_time_s=t,image_x=60.,image_y=40.) for t in (0.,.3)]
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)/'source.mp4'
            source.touch()
            with (patch.object(cv2,'VideoCapture',return_value=capture),
                  patch.object(cv2,'goodFeaturesToTrack',return_value=corners),
                  patch.object(model,'distributed_background_points',return_value=corners[:320]),
                  patch.object(model,'tracked_background',return_value=(None,None)) as flow):
                corrected, evidence = model.register_ball_observations(
                    {'video_metadata':{'source_path':str(source),'width_px':128,'height_px':72}},rows)
            self.assertEqual([len(call.args[2]) for call in flow.call_args_list], [320,1000])
            self.assertFalse(evidence['frames'][1]['reliable'])
            self.assertNotIn('camera_registered',corrected[1])
            capture.release.assert_called_once()

    def test_detector_reuse_requires_review_reference_and_checked_anchors(self):
        contact=dict(relative_time_s=0,video_time_s=2)
        rows=[contact]+[dict(relative_time_s=i/30,video_time_s=2+i/30,source='COMPUTER_VISION',human_reviewed=True,
            background_alignment_reliable=True,reference_time_s=2,reference_image_x=500-i*5,reference_image_y=300-i*4) for i in range(1,11)]
        neighbors=detector_reuse_neighbors(rows,contact)
        self.assertEqual(len(neighbors),4)
        checks=[dict(reliable=True,point=[r.get('reference_image_x',0),r.get('reference_image_y',0)],uncertainty_px=.5) for r in rows]
        index=next(iter(neighbors))
        self.assertIsNotNone(reuse_detector_registration(rows,checks,index,neighbors))
        checks[neighbors[index][0]]['point'][0]+=10
        self.assertIsNone(reuse_detector_registration(rows,checks,index,neighbors))
        for row in rows[1:]:row['reference_time_s']=1
        self.assertEqual(detector_reuse_neighbors(rows,contact),{})

    def test_manual_or_unreliable_detector_points_are_never_reused(self):
        contact=dict(relative_time_s=0,video_time_s=2)
        rows=[dict(relative_time_s=i/30,source='HUMAN',human_reviewed=True,background_alignment_reliable=True,
                   reference_time_s=2,reference_image_x=500,reference_image_y=300) for i in range(1,11)]
        self.assertEqual(detector_reuse_neighbors(rows,contact),{})
        for row in rows:row.update(source='COMPUTER_VISION',background_alignment_reliable=False)
        self.assertEqual(detector_reuse_neighbors(rows,contact),{})
    def test_uncertain_later_positions_cannot_change_early_measurements(self):
        rows = [dict(relative_time_s=t, image_x=x, image_y=y) for t,x,y in [(0,500,500),(.3,400,300),(2,900,-800)]]
        corrected, excluded = apply_registration(rows, [{'reliable':False} for _ in rows])
        self.assertEqual(corrected, rows[:2])
        self.assertEqual([p['time_s'] for p in excluded], [2])

    def test_reliable_later_height_is_retained(self):
        rows = [dict(relative_time_s=2, image_x=900, image_y=100)]
        corrected, excluded = apply_registration(rows, [dict(reliable=True, point=[400,200], uncertainty_px=2)])
        self.assertEqual(corrected[0]['image_y'], 200)
        self.assertTrue(corrected[0]['camera_registered'])
        self.assertFalse(excluded)

    def test_missing_video_reports_reduced_late_evidence(self):
        rows = [dict(relative_time_s=t,video_time_s=t,image_x=100,image_y=100) for t in [0,.3,2]]
        corrected, evidence = register_ball_observations({}, rows)
        self.assertEqual(len(corrected),2)
        self.assertFalse(evidence['used'])
        self.assertEqual(len(evidence['excluded_late_points']),1)

    def test_real_background_registration_corrects_pan_and_vertical_motion(self):
        # Independent background pixels and known camera displacement; no hit
        # model or expected ball trajectory participates in registration.
        rng = np.random.default_rng(83)
        image = np.zeros((720,1280,3),np.uint8)
        for _ in range(1800):
            x,y=rng.integers([20,20],[1260,700]);c=int(rng.integers(60,255))
            cv2.rectangle(image,(int(x),int(y)),(int(x+5),int(y+5)),(c,c,c),-1)
        rows=[]
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'pan.avi'
            writer=cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'MJPG'),2.,(1280,720))
            self.assertTrue(writer.isOpened())
            for t,dx,dy,angle in [(0,0,0,0),(.5,40,-10,1),(1,90,-40,3)]:
                matrix=cv2.getRotationMatrix2D((640,360),angle,1)
                matrix[:,2]+=[dx,dy]
                writer.write(cv2.warpAffine(image,matrix,(1280,720)))
                point=matrix@np.array([600,180,1])
                rows.append(dict(relative_time_s=t,video_time_s=t,image_x=float(point[0]),image_y=float(point[1])))
            writer.release()
            corrected,evidence=register_ball_observations({'video_metadata':{'source_path':str(path),'width_px':1280,'height_px':720}},rows)
            sequential,sequence_evidence=register_ball_observations({'video_metadata':{
                'source_path':str(path),'width_px':1280,'height_px':720,
                'variable_frame_rate':False,'timing_source':'source_frame_timestamps'}},rows)
            self.assertEqual(sequence_evidence['excluded_late_points'],evidence['excluded_late_points'])
            self.assertEqual(len(sequential),len(corrected))
            for original,optimized in zip(corrected,sequential):
                np.testing.assert_allclose([original['image_x'],original['image_y']],
                                           [optimized['image_x'],optimized['image_y']],atol=1e-8,rtol=0)
        self.assertTrue(evidence['used'])
        self.assertEqual(len(corrected),3)
        self.assertFalse(evidence['excluded_late_points'])
        for row in corrected:
            self.assertAlmostEqual(row['image_x'],600,delta=2)
            self.assertAlmostEqual(row['image_y'],180,delta=2)


if __name__ == '__main__': unittest.main()
