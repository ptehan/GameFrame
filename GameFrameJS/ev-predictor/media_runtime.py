"""Reuse loaded media code in the normal app worker; never reuse fitted results."""
import importlib
import threading
from pathlib import Path
from prediction_runtime import warm_estimator
from encoder_runtime import render_environment


class MediaRuntime:
    def __init__(self):
        self.render_lock = threading.Lock()
        self.warm_lock = threading.Lock()
        self.native_ready = False

    def warm(self):
        with self.warm_lock:
            warm_estimator()
            # Field detection and fitting both load native SciPy extensions.
            # Do this before worker.py waits on the Windows stdin pipe, rather
            # than importing them during a concurrent detection/preload burst.
            optimize = importlib.import_module('scipy.optimize')
            # Import native libraries before the Windows worker blocks on stdin.
            import cv2
            if not self.native_ready:
                cv2.setNumThreads(1)
                # Resolve lazy LAPACK/rotation extensions before the stdin reader
                # starts, including the rotation used by the exported animation.
                optimize.least_squares(lambda values: values-1., [0.,0.,0.], bounds=(-2.,2.))
                transform = importlib.import_module('scipy.spatial.transform')
                rotations = transform.Rotation.from_rotvec([[0.,0.,0.],[0.,0.,.01]])
                transform.Slerp([0.,1.], rotations)(.5).as_matrix()
                importlib.import_module('flight_plane')
                self.native_ready = True
            importlib.import_module('field_landmark_detect')
            importlib.import_module('clip_replay')

    def landmarks(self, source, time_s, package, max_width=960):
        self.warm()
        detector = importlib.import_module('field_landmark_detect')
        frame, scale = detector.read_frame(Path(source), time_s, max_width)
        return {'scale':scale, 'landmarks':detector.detect_landmarks(frame,scale,package)}

    def render(self, source, package, prediction, output, contact, pre, post, banner, on_progress, _background=False):
        # Bound concurrent exports while ordinary API requests remain responsive.
        with self.render_lock:
            self.warm()
            renderer = importlib.import_module('clip_replay')
            encoder = render_environment()['EV_VIDEO_ENCODER']
            renderer.render_clip(Path(source),package,prediction,Path(output),contact,pre,post,
                renderer.parse_lines(banner),max_width=1280,on_progress=on_progress,_encoder=encoder,_background=_background)
