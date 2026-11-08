import json
import sys
from pathlib import Path

import cv2
import numpy as np

cv2.setNumThreads(2)

root = Path(__file__).resolve().parents[1]
out = root / 'demo-output' / 'recreate-latest'
source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / 'Downloads' / '1000056365.mp4'
saved = cv2.VideoCapture(str(out / 'saved-pitch-60.mp4'))
saved.set(cv2.CAP_PROP_POS_FRAMES, 119)
ok, reference = saved.read()
assert ok
saved.release()
reference = cv2.resize(reference, (480, round(reference.shape[0] * 480 / reference.shape[1])))
capture = cv2.VideoCapture(str(source))
frames = []
while True:
    ok, frame = capture.read()
    if not ok:
        break
    frames.append(cv2.resize(frame, (640, 360)))
capture.release()
sift = cv2.SIFT_create(nfeatures=400)
ref_gray = cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY)
keypoints, descriptors = sift.detectAndCompute(ref_gray, None)
matcher = cv2.BFMatcher()
alignments = []
for index in [0, len(frames) // 2, len(frames) - 1]:
    points, desc = sift.detectAndCompute(cv2.cvtColor(frames[index], cv2.COLOR_BGR2GRAY), None)
    matches = [a for a, b in matcher.knnMatch(descriptors, desc, k=2) if a.distance < 0.7 * b.distance]
    a = np.float32([keypoints[m.queryIdx].pt for m in matches])
    b = np.float32([points[m.trainIdx].pt for m in matches])
    matrix, inliers = cv2.findHomography(a, b, cv2.RANSAC, 2)
    alignments.append((int(inliers.sum()), matrix))
inliers, matrix = max(alignments, key=lambda pair: pair[0])
height, width = ref_gray.shape
mask = cv2.warpPerspective(np.full((360, 640), 255, np.uint8), np.linalg.inv(matrix), (width, height)) > 250
mask[:5] = False
mask[-5:] = False
mask[:, :5] = False
mask[:, -5:] = False
scores = []
matrices = []
for index, frame in enumerate(frames):
    if index % 50 == 0:
        print(f'Matching source frame {index}/{len(frames)}', flush=True)
    if len(sys.argv) > 2 and abs(index - int(sys.argv[2])) > 6:
        matrices.append(None)
        continue
    points, desc = sift.detectAndCompute(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), None)
    matches = [a for a, b in matcher.knnMatch(descriptors, desc, k=2) if a.distance < 0.7 * b.distance]
    a = np.float32([keypoints[m.queryIdx].pt for m in matches])
    b = np.float32([points[m.trainIdx].pt for m in matches])
    current, _ = cv2.findHomography(a, b, cv2.RANSAC, 2)
    matrices.append(current)
    aligned = cv2.warpPerspective(frame, np.linalg.inv(current), (width, height))
    difference = np.abs(cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY).astype(float) - ref_gray.astype(float))
    scores.append((float(difference[mask].mean()), index))
ranked = sorted(scores)
best = ranked[0][1]
matrix = matrices[best]
corners = np.float32([[[0, 0], [width, 0], [width, height], [0, height]]])
mapped = cv2.perspectiveTransform(corners, matrix)[0]
aligned = cv2.warpPerspective(frames[best], np.linalg.inv(matrix), (width, height))
cv2.imwrite(str(out / 'contact-comparison.jpg'), np.hstack([reference, aligned]))
result = {'source_frame': best, 'inliers': inliers, 'ranked': ranked[:10], 'crop_corners_640x360': mapped.tolist()}
(out / 'contact-match.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
