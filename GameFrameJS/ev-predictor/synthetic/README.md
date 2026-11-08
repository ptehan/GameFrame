# Synthetic Baseball Flight Data

## Complete simulation grid

The active grid is the Cartesian product of **40–120 mph**, **0–50° launch**,
and **−33–+33° spray**, inclusive, at increments of **2 mph, 2°, and 3°**:
**24,518 flights**. Every speed has 598 flights; every launch has 943;
every spray has 1,066. Every combination on these evenly spaced axes exists.
The existing default environment, ball, start position, and right-handed estimated
spin model are retained. Integration is 0.01 s; stored samples are 0.03 s apart,
with the final airborne sample retained. `landing_spray_angle_deg` stores the
actual atan2 landing bearing in degrees.

Build into a separate file, validate it, and only then replace the active file:

```powershell
.venv-ev/Scripts/python.exe ev-predictor/synthetic/rebuild_uniform_database.py --source ev-predictor/data/hittrax_from_video.sqlite --output ev-predictor/data/hittrax_uniform_pending.sqlite
```

The builder checks batched/scalar physics parity, a unique combination index,
all three axis counts, SQLite integrity, foreign keys, and initial samples.
Its manifest is stored in `generation_manifest` and beside the database as JSON.
It preserves calibration and saved analysis/clip tables; prior comparison runs
referencing obsolete flight IDs remain in the original database backup.
Staging uses unsafe journaling for bulk-build speed and must never serve the app
before validation. An interrupted unsafe write requires a fresh build. `--resume`
is only for staging files stopped cleanly under transactional journaling.

The matcher recognizes a completed uniform grid and compares stored simulations
without on-demand refinement. Both video and landing-distance limits must pass.
The historical append scripts refuse to modify a completed grid.

This folder contains a Python trajectory generator designed to match the public Baseball Flight Simulator model closely enough for validation and synthetic-data experiments.

The implementation is a direct port of the public `hit_class_module.js` trajectory logic used by Baseball Flight Sim:

- feet, seconds, mph, degrees, and rpm at the boundary
- default ball mass `5.02623 oz`
- default ball circumference `9.125 in`
- default environment `70 F`, `21 ft` elevation, `50%` relative humidity, no wind
- default start position `(x=0 ft, y=2 ft, z=2.5 ft)`
- time step `0.01 s`
- estimated spin formula from Baseball Flight Sim

Run:

```powershell
python synthetic/generate_synthetic.py --output-dir synthetic_output
```

Outputs:

- `synthetic_truth.csv`: one row per hit with EV, LA, spray, spin, distance, hang time, apex, and landing point.
- `synthetic_trajectories.csv`: high-frequency trajectory points with relative time, 3D position, velocity, speed, distance, and height.
- `synthetic_metadata.json`: model/environment/ball/start-position metadata.

These files are numerical synthetic truth. Camera projection and noisy observation-package generation should sit downstream from these trajectory tables.

## SQLite database

After generating CSVs, load them into SQLite:

```powershell
python synthetic/load_sqlite.py --input-dir synthetic_output --db data/hittrax_from_video.sqlite
```

Tables:

- `synthetic_hits`: one row per generated hit.
- `trajectory_points`: time-series trajectory points keyed by `hit_id`.

## Compare Real Observations

Run a first-pass comparison from a canonical observation package to synthetic trajectories:

```powershell
python synthetic/compare_observations.py "C:\Users\Patrick\Downloads\observation-package (1).json" --db data/hittrax_from_video.sqlite
```

This first comparison fits a simple affine projection from synthetic 3D trajectory points to observed image points. It is useful for shape/timing sanity checks, but it is not a calibrated camera model or final EV/LA inference.

## Project Synthetic Trajectories Through a Camera Prior

Generate synthetic image observations at the same timestamps as a real observation package:

```powershell
python synthetic/generate_projected_observations.py "C:\Users\Patrick\Downloads\observation-package (1).json" --db data/hittrax_from_video.sqlite
```

Tables:

- `synthetic_cameras`: rough camera prior derived from the field marker.
- `synthetic_projected_observations`: per-hit projected pixel coordinates at the real observation timestamps.

This is still a rough prior, not a solved camera calibration. Field landmarks are the next step for making the projection physically meaningful.

## Field Landmark Calibration

After exporting an observation package with at least four field landmarks:

```powershell
python synthetic/calibrate_field_homography.py "C:\Users\Patrick\Downloads\observation-package.json" --db data/hittrax_from_video.sqlite
```

This stores a `field_calibrations` row with a ground-plane homography and pixel residuals. A homography is not a full 3D camera pose, but it is the first useful calibration constraint from video landmarks.
