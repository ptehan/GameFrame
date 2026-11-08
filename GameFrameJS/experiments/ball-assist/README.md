# Ball assist lab

Run from the canonical GameFrameJS folder:

```powershell
node experiments/ball-assist/server.cjs
```

Open http://127.0.0.1:8017/. Uses the existing `.venv-ev` OpenCV runtime. Override `GAMEFRAME_BALL_LAB_PYTHON` or `GAMEFRAME_BALL_LAB_PORT` if needed.

## Try it

The sparse path reserves a short native-cadence launch window inside the same 60-image cap. It verifies launch from those fresh images before using a detected launch point to constrain sparse association. If launch cannot be verified, it falls back to interval tagging. This avoids selecting players/background features merely because they form a smooth sparse path. Contact uses the browser's presented frame timestamp; extraction preserves exact integer PTS/time-base timestamps. Review shows only matching-frame detections, with no fitted screen-space line or cross-frame cloud. Review arrows jump between detected frames; manual-tagging arrows retain their original behavior. `contact-frame-replay.cjs` reproduces the user's fractional seek, checks both early reference positions, verifies stepping/rendering, and tests manual fallback using a fresh real scan.

Normal-wizard detection now extracts at most 60 images in the 10 seconds following contact: every fifth native frame at 30 fps, with equivalent spacing at higher frame rates. It extracts 640-pixel previews and preserves actual decoder timestamps. The current video remains at full resolution for regular manual tagging. Immutable detector code is preloaded during preparation; every request scans its own images from scratch, with no saved candidate/result reuse. `sampled-scan-check.cjs` verifies the frame cap, fresh repeated inference, and deterministic results. Tracking quality still requires review.

Explicit acceptance marks automatic rows `human_reviewed: true`; the fitters accept these medium-confidence points without relabeling them as manual or raising confidence. Unreviewed medium-confidence detections remain excluded. `test_reviewed_fit.py` checks later reviewed points reach fitting and regular manual points still work. `normal-workflow-check.cjs` checks the review flag survives into the actual prediction package.

In the normal local EV wizard, clicking the ball at contact starts automatic detection inside the same wizard. The header then asks **Does this look right?** **Yes, continue** explicitly accepts the detected points and advances to field marking. **No, tag manually** discards the automatic proposals and opens the unchanged interval prompts, retaining contact. The **Tag manually** button is also available during processing. Detection errors and unsupported clips fall back to interval tagging. The wizard stays at `/ev/predictor.html`; no test-page navigation or handoff is required. Detection uses only the current source video and contact point. API calls are isolated under `/api/ball-assist`. Saved hit observations are not overwritten by detection or acceptance; subsequent explicit saves follow the normal app flow.

`normal-workflow-check.cjs` uses explicit detector fixtures to test acceptance, rejection, service failure, and cancellation through the real normal-wizard controls. Each manual branch marks frame 10, skips frame 15, marks frame 20, advances to frame 25, and continues to field marking without another detector request. It checks decision-button visibility on desktop and phone. `normal-real-scan.cjs` runs the actual unchanged frozen detector through the normal contact screen without detector fixtures, verifies review/acceptance, and compares original saved-hit JSON before and after. That check verifies integration, not tracking accuracy. Nets remain a known source of incorrect proposals; user review is required.

The older standalone page and `/test/ball-assist/` remain diagnostic tools, with no entry links added to normal saved-video screens.

`test-handoff.cjs` checks coordinate/time mapping and manual fallback. `decision-flow-check.cjs` uses explicit detector fixtures to verify both UI branches, decoded video playback, retained contact, discarded old flight points, and unchanged original saved observation JSON. These interaction checks make no detector-accuracy claim.

The integration is local-only and lazy-loaded. `GAMEFRAME_BALL_ASSIST_TEST=0` disables it. Production mode hides it unless explicitly enabled, and requests from remote clients remain blocked. Packaged builds without the experimental files continue normally with the test entry hidden. `app-integration-check.cjs` checks selected-source loading in a browser, namespaced requests, cross-origin rejection, and unchanged production database hash using a read-only database connection.

1. Use an example, or open a video. The remaining clip is extracted at its native frame rate (prototype limit: 60 seconds / 3600 frames). Set a start time for a long recording.
2. Find contact and click the contact point once. Detection automatically scans every following frame, including after gaps. Arrow keys step frames; wheel zooms and Shift-drag pans.
3. If a ground-contact review cue is available, the page goes straight to that window. Use the frame arrows, then click the ball or Confirm ground contact. Choose Not visible if you cannot see contact. An estimated search window is never a confirmed landing time.
4. Use the thumbnails to inspect the flight. Correct or remove individual points, then keep the detections with one action. No repeated seed points or batch approvals. Missing detections stay visible as gaps.
5. Export reviewed points and/or your ground-contact choice if useful. Unreviewed suggestions and estimated ground times are excluded. Ground timing uses half the native frame interval only after human confirmation. Export is a test JSON file, not an update to a real hit.

Tracking preserves spatial coverage so a small sky ball survives stronger foreground edges. It uses camera-registered motion, dark and bright contrast, three-frame presence checks, and recent image motion. Duplicate blob peaks are merged before ambiguity checking. It can recover a ball that leaves the frame, and keeps gaps where observations are unsupported. After an interior loss, it stops attaching unrelated objects; background registration still processes every remaining frame. Points remain unreviewed proposals. It does not use EV, landing distance, a physical flight model, saved candidates, or saved EV predictions to place points. The earlier two-seed experiment remains at `/batch.html` for development comparisons.

Ground review has two explicit outcomes: an observed motion reversal near the visible field can suggest a bounce for review; otherwise, ground contact remains undetected. Extrapolated ground-contact windows have been removed. A motion reversal does not confirm an impact. The user must confirm a frame or mark contact Not visible. Completed test results can be reopened with `?session=...&job=...` while this server is running; this displays unreviewed output and does not feed it into another detector run.

## Isolation

Short uncertain intervals can be revisited between fresh, image-supported automatic detections. Camera-stabilized path and elapsed travel restrict the candidate search; actual raw-frame motion and appearance agreement with both endpoints are required. No points are generated by interpolation, and refined points cannot become anchors in the same pass. Frozen per-job model snapshots record exactly which code ran. Later human labels are used only by the evaluator after detection.

The Cortland night triple is the default test clip. Its full-flight tracking has failed through foreground netting; this remains an experimental detector. The Cortland double is a separate development regression clip. The improved fresh full scan matches all five held-back manual flight marks within 1.9–3.6 source pixels. The ball is unobserved while above the frame and fades near the hills later; those sections remain gaps. The historical search cue near 5.93 seconds was an extrapolation, not a detected bounce, and has been removed. There is no saved ground-contact label on this clip, so exact ground-contact accuracy has not been established. This is a development clip used during tuning, not independent general validation. See `cortland-improved-test.json`, `performance-regression.json`, and the manual comparison images. Do not promote the experiment into production based on this single clip.

- Separate server and browser origin. Bound to loopback only.
- Does not import the main app server, open its database, create drafts, or save measurements.
- Uploads, frames, diagnostics and job JSON stay under `demo-output/ball-assist-lab/`.
- Production tracking files, routes, templates and normal workflows are unchanged.
- The experiment is outside the explicit desktop build file list.

## Checks

```powershell
.venv-ev/Scripts/python.exe experiments/ball-assist/test_tracker.py
.venv-ev/Scripts/python.exe experiments/ball-assist/collect_references.py
# Set PLAYWRIGHT_MODULE to the installed Playwright module if it is not on Node's module path.
node experiments/ball-assist/check_reference_frames.cjs
node experiments/ball-assist/benchmark.cjs
node experiments/ball-assist/browser_check.cjs
.venv-ev/Scripts/python.exe experiments/ball-assist/test_contact_scan.py
node experiments/ball-assist/contact_benchmark.cjs
node experiments/ball-assist/contact_browser_check.cjs
.venv-ev/Scripts/python.exe -m unittest discover -s experiments/ball-assist -p 'test_*.py'
node experiments/ball-assist/real_review_check.cjs
```

The reference collector alone opens `app.db`, in SQLite read-only mode, and selects only `observation_package_json`. The contact-only benchmark supplies contact alone; every later human mark is held out. The older batch benchmark supplies two later seeds and is a separate experiment. Raw decoded frames can be reused; inference is rerun. This is a two-recording development check, not a general accuracy claim. The contact UI check uses deterministic proposals to test interactions separately from detection quality.

Two stored seek times in the recent recording decode to the preceding video frame in Chrome. `check_reference_frames.cjs` measures this independently using `requestVideoFrameCallback`, without looking at tracker coordinates. Reports retain both nominal-time and displayed-frame errors. Saved annotations and production seeking are not modified. One later reference still differs by about 10 pixels, so review remains required.

Results: `demo-output/ball-assist-lab/benchmark.json`. Browser checks/screenshots: `demo-output/ball-assist-lab/browser-qa/`. The production isolation check compares hashes captured before testing, including the production database.

For Cortland-only evaluation, collect `--hit=85`, set `CONTACT_REFERENCE=selected-reference.json`, `CONTACT_ALIGNMENT=cortland-frame-times.json`, and `CONTACT_REPORT=cortland-improved-test.json`. `CONTACT_SESSION` may reuse only an already loaded raw-frame session; inference is fresh. UI fixture checks may set `CONTACT_QA_SESSION` to those raw frames to avoid competing video extraction jobs. Fixture checks test interactions, not vision accuracy; the real review check opens the completed fresh scan without confirming or exporting a measurement.

