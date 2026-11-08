# HitTrax From Video Technical Documentation

## Current early-angle / later-height estimator

`synthetic/staged_flight_match.py` is used when at least two reviewed early flight marks (through 2/3 s) and one later mark are present. Early rays and field geometry produce fixed spatial-tangent angle/direction hypotheses, with **no speed, later-position, or landing-distance fit**. Speed is then fitted to later vertical positions only. Later horizontal positions never score the fit. Landing distance and ground-contact timing accept or reject already-fixed flights; they do not refit the early angles.

The source background can register horizontal panning in early frames. Vertical positions remain unchanged under the level-camera/no-zoom assumption. If source registration is unavailable, that fact is recorded. Model sensitivity includes early vertical marking perturbations and contact-depth perturbations; displayed ranges are not calibrated confidence intervals. Only nominal geometry can select the best estimate; perturbations contribute to sensitivity ranges.

Contact must reproject to the actual contact click. **Do not pin contact x/y to home plate or subtract a plate-to-ball pixel offset.** Single-camera depth uses the explicit soft prior recorded by `direction_first_match.py`; all tested depth alternatives stay on the clicked camera ray. The old home-plate lock is removed.

Shorter sequences retain the limited early-flight matcher, tagged `limited_early_flight_joint_fit` with conditional/low confidence. The staged path is tagged `early_geometry_then_late_height`; `launch_angle_evidence.locked_before_speed_matching` is true. Both paths retain the existing prediction/trajectory export schema. New results require recalculation; historical saved predictions are not rewritten.

Regression coverage: `test/test_ev_staged_flight.py`, `test/test_ev_contact_ray.py`, and `test/ev-staged-result-browser.cjs`. The browser check consumes a fresh production result generated from raw observations.


This project is a local research tool for turning ordinary baseball video into a structured observation package, then comparing that package against synthetic batted-ball flight data. The code is intentionally split into three layers:

- Browser annotation UI: `index.html`, `app.js`, `styles.css`
- Local HTTP/video server: `clip_server.py`
- Python analysis scripts: `synthetic/*.py`

The most important design rule is that the app must distinguish observed evidence from inferred estimates. User-tagged points, endpoint markers, apex frames, and field landmarks are evidence. Exit velocity, launch angle, distance, and synthetic matches are estimates derived from that evidence.

## Current calibrated matching rule

`synthetic/path_distance_match.py` selects database trajectories jointly by launch,
spray, and speed. It supersedes fixed-launch matching for calibrated predictions;
the legacy `direction_first_shared_synthetic_match` output name remains for UI and
export compatibility. A `selection_policy` object identifies the new rule.

1. Allow landing bearing within 6 degrees either way of the user's marked bearing.
   Compute landing bearing from database landing coordinates, not the legacy display-angle column.
2. Register contact separately for each candidate spray, holding camera calibration fixed.
   Compare projected ball centers at the saved early timestamps (up to 0.45 seconds).
3. Keep paths no more than 2 source-image pixels RMS worse than the best path,
   and no more than 12 pixels RMS overall. These are provisional matching tolerances,
   not statistically calibrated confidence bounds.
4. Among those paths, choose the closest database carry to the supplied distance;
   break ties by pixel error and hit ID. Without distance, use pixel error alone.
   When no path passes, retain a low-confidence diagnostic and do not fit distance.

The result is distance-assisted, not an independent measurement of speed or carry.
The separate path-only comparison omits distance preference. Exports retain the
selected stored trajectory. Matching uses one indexed batch read of interpolation
brackets and one vectorized projection; it does not simulate every candidate or
run the discarded legacy matching passes. Regression tests are in
`test/test_ev_path_distance.py`.

## Data Model

The main interchange format is an observation package JSON. The browser builds it in `app.js` with `buildPackage()`.

Important fields:

- `video_metadata`: source filename, dimensions, duration, frame step assumption.
- `hit.contact`: contact timestamp and confidence.
- `hit.direction_observation`: user-selected broad direction such as `left_center`.
- `hit.distance_observation`: numeric distance if supplied, plus `field_marker_percent` from the draggable endpoint marker.
- `hit.apex_observation`: optional visually tagged apex frame. This is a calculation anchor, not a text input.
- `camera`: rough camera vantage, field marker position, and camera height.
- `landmarks`: accepted field landmarks only. Suggested landmarks are not exported until accepted.
- `terminal_event`: optional first ground/fielder/fence contact.
- `ball_observations`: user or CV ball points.

Pending field mark suggestions live only in browser state as `state.pendingLandmarks`. They are deliberately excluded from `buildPackage()` until the user accepts them.

## Local Server

`clip_server.py` serves the static app and provides analysis endpoints.

Endpoints:

- `POST /api/predict`
  - Writes the current package to `comparison_output/live`.
  - Runs `synthetic/direct_video_estimate.py`.
  - Returns the prediction JSON.

- `POST /api/track`
  - Locates the source video.
  - Runs `synthetic/trajectory_inference.py`.
  - Returns a tracked package plus debug image URLs.

- `POST /api/landmarks`
  - Runs `synthetic/field_landmark_detect.py` on the current frame.
  - Returns suggested field landmarks for review.

- `POST /api/clip`
  - Starts an ffmpeg clip-export job from contact minus 1 second through contact plus 6 seconds.
  - Adds a banner above the video, not over it.

- `GET /api/clip/status`
  - Polls clip-export progress.

- `GET /api/clip/download`
  - Downloads the finished MP4.

The server uses the bundled Codex Python runtime when available because it has OpenCV, NumPy, and SciPy installed.

## Prediction Pipeline

The central prediction script is `synthetic/direct_video_estimate.py`.

There are two broad modes.

### Calibrated Mode

Calibrated mode is used when there are at least four usable field landmarks. It estimates camera geometry through field homography and compares the observed ball path to synthetic flight trajectories with camera projection.

This is the path intended for stronger physical estimates.

### Uncalibrated Diagnostic Mode

If there are fewer than four accepted field landmarks, the script writes:

```json
{
  "method": "uncalibrated_path_shape_diagnostic"
}
```

This is not a calibrated physical EV estimate. It is a diagnostic comparison against synthetic path shapes and whatever real-world evidence exists.

It can still use:

- observed image path shape
- endpoint marker estimated distance
- numeric distance if supplied
- ground-contact hang time if supplied
- apex time/height if supplied or inferred with confidence

The UI must describe this as diagnostic-only because camera scale and pose are not fully identified.

## Distance Evidence

Distance evidence is resolved by `target_distance_from_package()`.

Priority:

1. Explicit numeric `distance_observation.distance_ft`
2. Endpoint marker distance from `field_marker_percent`
3. No distance evidence

If the numeric distance box is empty but the endpoint marker is placed, the marker-derived distance is used as distance evidence. Its source is reported as:

```json
"distance_evidence": {
  "source": "field_endpoint_marker",
  "distance_ft": 267.1,
  "uncertainty_ft": 60.0
}
```

This matters because path shape alone can match many trajectories. Distance evidence pulls the synthetic candidates toward the user’s endpoint estimate while still allowing uncertainty.

## Three-Point Path Diagnostic

Older code required at least four early ball points for uncalibrated path-shape diagnostics. That produced “No path-shape diagnostic candidates” for clips with only three visible/tracked points.

Current behavior:

- Three or more points are accepted.
- Four or more points use an uncalibrated affine path-shape fit.
- Exactly three points use a normalized arc-shape diagnostic.

The three-point fallback:

1. Translate the observed points so the first point is the origin.
2. Rotate and scale so the first-to-last chord has unit length.
3. Do the same for synthetic trajectory samples at matching times.
4. Compare the middle point’s normalized bend.
5. Try several 2D synthetic variants and mirrored variants because the camera view may flip apparent image direction.

This is weak evidence, but it is better than returning no candidates. The returned `projected_path_evidence.reason` makes that clear:

```text
three ball points; using normalized arc-shape diagnostic only
```

## Apex Evidence

Apex logic exists because depth-heavy camera views can make launch angle and exit velocity badly underconstrained.

Important rule:

If the user marks an apex frame, treat that frame as the physical apex anchor. Do not move it earlier just because image geometry is depth-heavy.

The app does not ask for typed apex height. The user only marks the apex frame. The code estimates height from time-to-apex physics when needed:

```text
height = start_height + 0.5 * g * apex_time^2
```

Relevant functions:

- `estimate_apex_evidence()`
- `uncalibrated_apex_evidence()`
- `apex_physics_estimate()`
- `apex_time_launch_angle_estimate()`
- `apex_ballistic_launch_estimate()`

When apex time and endpoint distance are both available, depth-heavy views can be ranked more meaningfully because the vertical component and horizontal travel constraint are both anchored.

## Trajectory Tracking

Trajectory tracking is implemented in `synthetic/trajectory_inference.py`.

The design goal is not “find a baseball-shaped blob in each frame.” At 30 fps the ball may appear as a white motion-blur streak or disappear entirely. The tracker scores coherent multi-frame trajectory hypotheses.

Pipeline:

1. Extract frames after contact with ffmpeg.
2. Optionally stabilize frames.
3. Build temporal median backgrounds.
4. Compute residual maps against those backgrounds.
5. Generate candidate white streak components.
6. Generate plausible trajectory hypotheses from contact.
7. Score whole trajectories instead of selecting independent per-frame detections.
8. Export the best hypothesis as `auto_tracking` observations.
9. Write debug overview and candidate-reasoning images.

### Candidate Requirements

Candidate generation is intentionally strict. A component must be:

- bright or white in the current frame
- brighter than the local temporal background
- not already bright in the median background
- small enough to plausibly be a ball streak
- line-like when area is larger
- close to the predicted frame-to-frame path segment

This avoids rewarding static net lines, fence rails, uniforms, and other background structures.

### Dashed Trail Logic

The code expects spaces between visible streaks. It does not require a continuous painted line.

Relevant functions:

- `row_is_supported()`
- `best_supported_segment()`
- `trajectory_tube_score()`

For unmarked tracking, support requires an actual candidate. Blur-only support is not enough. This prevents smooth fake arcs from being drawn through background junk.

### Marked Trail Prior

If the package already contains human-marked post-contact ball points, those points become strong priors through `marker_priors()`.

When good human marks exist, `marker_hypothesis()` preserves the marked dashed trail and uses video evidence as explanation, not permission to move the trail. This is important for retesting a JSON without re-entering points.

### Browser Trust Rule

`app.js` calls `/api/track` from `detectFlightWithTrajectoryServer()`.

The browser only draws a server result automatically when it is trusted:

- marked dashed trail prior results are trusted
- unmarked results need enough supported frames, few gaps, and tight candidate distances
- untrusted unmarked results are not drawn; the app shows debug links instead

This prevents wrong-but-pretty arcs from polluting the video overlay.

## Field Landmark Suggestions

Field mark detection is implemented in `synthetic/field_landmark_detect.py`.

It suggests:

- `home_plate`
- `pitching_rubber`
- `first_base`
- `second_base`
- `third_base`
- `left_foul_line_far`
- `right_foul_line_far`

The foul-line targets are the far foul-line endpoints near the fence/pole area, not necessarily the full visible foul pole.

These suggestions are not trusted automatically.

Browser flow:

1. Click `Suggest Field Marks`.
2. Suggestions are stored in `state.pendingLandmarks`.
3. Pending marks draw as orange dashed suggestions.
4. Click `Accept Suggestions` to move them into `state.landmarks`.
5. Click `Reject Suggestions` to clear them.

Only accepted landmarks are exported in the observation package.

## Clip Export

The clip export is server-side ffmpeg, not browser `MediaRecorder`.

Reason: browser recording produced choppy or incomplete MP4/WebM output.

`/api/clip` creates an MP4 from:

```text
contact_time - 1 second
through
contact_time + 6 seconds
```

It adds a banner above the video with best available EV, LA, and distance. The banner does not cover the video.

The app polls `/api/clip/status` and shows progress.

## Important UI State

Key browser state fields in `app.js`:

- `state.observations`: accepted ball observations
- `state.autoObservations`: detected but not accepted flight points
- `state.landmarks`: accepted field landmarks
- `state.pendingLandmarks`: suggested field landmarks waiting for accept/reject
- `state.terminalEvent`: ground/fielder/fence contact event
- `state.apexEvent`: marked apex frame
- `state.latestPrediction`: most recent prediction response

The exported package includes accepted observations and landmarks only. It does not include pending suggestions or rejected detector output.

## Common Failure Modes

### “No path-shape diagnostic candidates”

This used to happen when fewer than four ball points were present. Current code supports three-point diagnostic fallback.

If it still happens, check:

- fewer than three ball points
- missing `relative_time_s`
- missing `image_x` or `image_y`
- synthetic DB missing matching trajectory rows for the observed time span

### Wrong White-Streak Detection

If debug images show boxes on netting, uniforms, or fence rails, the candidate filter is too permissive for that clip.

Inspect:

- candidate `background`
- candidate `whiteness`
- candidate `line_like`
- candidate `distance_px`

Valid ball streaks should be white/moving relative to temporal background, not static bright features.

### Estimated EV Range Too Broad

This is expected when camera pose is uncalibrated and only path shape is available.

Add one or more of:

- endpoint marker or numeric distance
- apex frame
- ground-contact time
- accepted field landmarks
- more ball observations after contact

### Field Mark Suggestions Are Bad

This is expected in difficult camera angles or cluttered frames. They are suggestions only.

Reject the batch, move the video to a clearer frame, or mark landmarks manually.

## Recommended Testing Workflow

1. Start local server:

   ```powershell
   python clip_server.py --host 127.0.0.1 --port 8004
   ```

2. Open:

   ```text
   http://127.0.0.1:8004/index.html
   ```

3. Load video.
4. Set contact.
5. Mark several ball points.
6. Place endpoint marker.
7. Optionally mark apex frame.
8. Optionally suggest field marks, then accept only good ones.
9. Click `Load Prediction`.
10. If needed, click `Detect Flight` and inspect debug links before accepting.
11. Export JSON.
12. Export MP4 clip if needed.

## Source File Map

- `app.js`
  - Browser state, drawing, package export, prediction rendering, tracking/landmark calls.

- `clip_server.py`
  - Local HTTP server, prediction endpoint, tracker endpoint, landmark endpoint, ffmpeg clip endpoint.

- `synthetic/direct_video_estimate.py`
  - Main prediction/ranking logic.
  - Calibrated and uncalibrated modes.
  - Apex, distance, field marker, and synthetic-candidate scoring.

- `synthetic/trajectory_inference.py`
  - Server-side multi-frame ball/streak tracking.
  - Debug visualizations.

- `synthetic/field_landmark_detect.py`
  - Review-only field mark suggestions.

- `data/hittrax_from_video.sqlite`
  - Synthetic hit and trajectory database.

## Current Correctness Boundary

The current code is appropriate for research and review workflows. It should not present uncalibrated path-shape diagnostics as measured EV/LA. It should label weak estimates as diagnostic, expose why they are weak, and prefer explicit user evidence when available.

Correct behavior is:

- Use user-marked apex time when present.
- Use endpoint marker distance with uncertainty when numeric distance is absent.
- Accept three-point diagnostics, but label them weak.
- Never auto-accept field mark suggestions.
- Never draw untrusted trajectory detections as if they are real ball tracks.
- Keep generated clips smooth by using ffmpeg server-side MP4 export.
