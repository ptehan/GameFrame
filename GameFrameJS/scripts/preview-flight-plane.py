"""Preview a saved flight rotating from its calibrated video camera to a side view."""
import argparse
import json
import math
from pathlib import Path
import sqlite3
import sys
import subprocess

import cv2
import numpy as np
from scipy.spatial.transform import Rotation, Slerp

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ev-predictor' / 'synthetic'))
from direct_video_estimate import constrained_pose_from_three_landmarks
from match_vantage_grid import project_with_camera_pose
from clip_replay import draw_end_card

parser = argparse.ArgumentParser()
parser.add_argument('--id', type=int, default=77)
args = parser.parse_args()
out = ROOT / 'demo-output' / f'flight-plane-{args.id}'
out.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(f'file:{(ROOT / "app.db").as_posix()}?mode=ro', uri=True) as conn:
    conn.row_factory = sqlite3.Row
    row = conn.execute('SELECT * FROM ev_hit_tracks WHERE id=?', (args.id,)).fetchone()
pred = json.loads(row['prediction_json'])
package = json.loads(row['observation_package_json'])
cap = cv2.VideoCapture(row['source_video_path'])
cap.set(cv2.CAP_PROP_POS_MSEC, row['contact_time_s'] * 1000)
ok, background = cap.read()
cap.release()
if not ok:
    raise ValueError('Cannot read the source contact frame')
h, w = background.shape[:2]
pose = constrained_pose_from_three_landmarks(package, w, h)
if pose is None:
    raise ValueError('A calibrated camera is required')
xyz = np.array([[p['x_ft'], p['y_ft'], p['z_ft']] for p in pred['best_trajectory_points']], float)
best = pred['ev_candidates'][0]
angle = float(best['launch_angle_deg'])
# The vertical plane is defined by the launch heading, not the camera image slope.
heading = xyz[1, :2] - xyz[0, :2]
heading /= np.linalg.norm(heading)
right = np.r_[heading, 0.]
down = np.array([0., 0., -1.])
forward = np.cross(right, down)
end_rotation = np.stack([right, down, forward])
slerp = Slerp([0, 1], Rotation.from_matrix(np.stack([pose['rotation'], end_rotation])))
start_center = -pose['rotation'].T @ pose['translation']
center = (xyz.min(axis=0) + xyz.max(axis=0)) / 2
ranges = xyz @ right
scale = min(w * .76 / np.ptp(ranges), h * .58 / max(np.ptp(xyz[:,2]), 1.))
D = 600.
end_center = center - forward * D
K = pose['intrinsics']
origin = xyz[0]
tangent = origin + (right * math.cos(math.radians(angle)) - down * math.sin(math.radians(angle))) * 65
baseline = origin + right * 75
plane = np.array([origin, origin + right * np.ptp(ranges), origin + right * np.ptp(ranges) + [0,0,65], origin + [0,0,65]])

def raw_project(points, u):
    rotation = slerp(u).as_matrix()
    camera_center = start_center * (1-u) + end_center * u
    camera = (rotation @ (np.asarray(points)-camera_center).T).T
    denominator = (1-u) * camera[:,2] + u * D
    focal = (1-u) * K[0,0] + u * scale * D
    principal = (1-u) * K[:2,2] + u * np.array([w/2, h*.53])
    return camera[:,:2] * focal / denominator[:,None] + principal

def project(points, u):
    result = raw_project(points, u)
    if u <= 0:
        return result
    bounds = raw_project(xyz, u)
    middle = (bounds.min(axis=0) + bounds.max(axis=0)) / 2
    initial = raw_project(xyz, 0)
    initial_middle = (initial.min(axis=0) + initial.max(axis=0)) / 2
    weight = min(1., u * 3)
    target = initial_middle * (1-weight) + np.array([w/2, h*.53]) * weight
    span = np.ptp(bounds, axis=0)
    fit = min(1., w*.80/max(span[0],1.), h*.60/max(span[1],1.))
    zoom = 1 + weight * (fit-1)
    return (result-middle)*zoom + target

start, visible = project_with_camera_pose(xyz, K, pose['rotation'], pose['translation'])
assert np.max(np.abs(project(xyz, 0)-start)) < 1e-7
final_vectors = project(np.array([origin, baseline, tangent]), 1)
v = final_vectors[2]-final_vectors[0]
measured_angle = math.degrees(math.atan2(-v[1],v[0]))
assert abs(measured_angle-angle) < 1e-8
assert np.allclose(np.linalg.norm(end_rotation,axis=1),1)
for fraction in [.34,.5,.75,1.]:
    screen = project(xyz,fraction)
    assert screen[:,0].min() >= w*.09 and screen[:,0].max() <= w*.91
    assert screen[:,1].min() >= 0 and screen[:,1].max() <= h
initial_flight = project(xyz[:2],1)
delta = initial_flight[1]-initial_flight[0]
path_start_angle = math.degrees(math.atan2(-delta[1],delta[0]))
assert abs(path_start_angle-angle) < .2, 'Trajectory and launch ray disagree'

raw = out / 'preview-raw.mp4'
writer = cv2.VideoWriter(str(raw), cv2.VideoWriter_fourcc(*'mp4v'), 30, (w,h))
assert writer.isOpened()
for frame_index in range(270):
    t = frame_index / 30
    linear = np.clip((t-2)/4, 0, 1)
    u = float(linear*linear*(3-2*linear))
    fade = min(1., u*3)
    canvas = (background.astype(float)*(1-.94*fade)).astype(np.uint8)
    points = project(xyz,u)
    # Clip drawing to the image; never move the first camera-aligned projection.
    def path(world, color, thickness=2):
        projected = project(world,u)
        if np.isfinite(projected).all():
            cv2.polylines(canvas,[np.clip(projected,-100000,100000).astype(np.int32)],False,color,thickness,cv2.LINE_AA)
    if t >= 1:
        plane_pixels = project(plane,u).astype(np.int32)
        layer = canvas.copy()
        cv2.fillConvexPoly(layer, plane_pixels, (94,79,40), cv2.LINE_AA)
        cv2.addWeighted(layer,.22,canvas,.78,0,canvas)
        path(np.vstack([plane,plane[0]]),(130,119,78),1)
        path(xyz,(60,211,247),3)
        path([origin,baseline],(172,180,181),2)
        path([origin,tangent],(236,238,244),2)
        for point in project([origin],u):
            cv2.circle(canvas,tuple(point.astype(int)),5,(255,255,255),-1,cv2.LINE_AA)
        if u > .98:
            radius = 48.
            arc = np.array([origin+right*radius*math.cos(a)-down*radius*math.sin(a) for a in np.linspace(0,math.radians(angle),40)])
            path(arc,(236,238,244),2)
            label = project([origin+right*55-down*12],u)[0].astype(int)
            cv2.putText(canvas,f'{angle:.1f} deg',tuple(label),cv2.FONT_HERSHEY_SIMPLEX,.8,(245,245,245),2,cv2.LINE_AA)
    writer.write(canvas)
    if frame_index in [45,120,225]:
        cv2.imwrite(str(out / f'frame-{frame_index}.jpg'),canvas)
writer.release()
output = out / 'flight-plane-preview.mp4'
subprocess.run(['ffmpeg','-y','-v','error','-i',str(raw),'-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(output)],check=True)
check = cv2.VideoCapture(str(output))
assert int(check.get(cv2.CAP_PROP_FRAME_COUNT)) == 270
check.release()
lines = [row['description'] or '',f"EV {best['exit_velocity_mph']:.0f} mph",f"LA {angle:.0f} deg",f"DISTANCE {best['distance_ft']:.0f} ft"]
cv2.imwrite(str(out/'closing-preview.jpg'),draw_end_card(background,lines,[],pred))
report = {'hit_id':args.id,'output':str(output),'camera_start_projection_error_px':float(np.max(np.abs(project(xyz,0)-start))), 'launch_angle_deg':angle,'final_screen_angle_deg':measured_angle,'equal_axis_scale_px_per_ft':scale,'frames':270,'duration_s':9,'source_modified':False,'database_modified':False,'note':'Saved reconstructed trajectory; full flight includes modeled portions. Rotation does not add measurement evidence.'}
(out/'verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
