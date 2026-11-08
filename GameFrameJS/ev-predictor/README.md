# HitTrax From Video

Local research tools for turning baseball video into canonical observations that can be compared with synthetic trajectory data.

## Annotation tool

### Local Python environment (Windows)

From the GameFrameJS folder:

```powershell
python -m venv .venv-ev
.\.venv-ev\Scripts\python.exe -m pip install -r ev-predictor/requirements.txt
npm run start:all
```

The launcher and EV subprocesses use this project-local environment. Set
`GAMEFRAME_EV_PYTHON` to explicitly select another prepared Python executable.
Without a local environment, the service uses its own Python interpreter, never
an editor's private runtime. These requirements cover prediction, tracking, and
video overlays; FFmpeg and the synthetic database are also required.

Open `index.html` through a local web server, load a video from disk, set the contact frame, then click the video to add ball observations. You do not need to label every frame. Skipped frames are treated as missing observations.

The exports are:

- `observation-package.json`: the first-pass canonical package.
- `ball-observations.csv`: a flat table for quick inspection.

The browser video clock is good enough for annotation workflow testing. The research pipeline should still use `ffprobe` timestamps for final timing-sensitive work.

## Technical documentation

See [TECHNICAL_DOCUMENTATION.md](TECHNICAL_DOCUMENTATION.md) for the current architecture, data model, prediction logic, apex/distance evidence handling, trajectory tracker behavior, landmark review workflow, clip export, and known correctness boundaries.
