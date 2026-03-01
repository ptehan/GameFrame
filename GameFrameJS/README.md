# GameFrameJS

Node/Express + HTML migration of the FastAPI GameFrame app, created in a separate folder so your original project remains untouched.

## What was copied

- `app.db` from the original project
- `templates/`
- `static/`

## Stack

- `express` for routing and HTTP
- `nunjucks` for Jinja-like template rendering
- `better-sqlite3` for SQLite access
- `multer` for multipart uploads
- `ffmpeg`/`ffprobe` CLI for trim, thumbnail, and video metadata

## Run

1. Install dependencies:
   `npm install`
2. Start server:
   `npm start`
3. Open:
   `http://localhost:8000`

## Notes

- This runs from `GameFrameJS` and does not modify your existing FastAPI app files.
- `ffmpeg` and `ffprobe` must be available in your system `PATH`.
- Route coverage includes library, upload/trim/finalize, matchup creation, streaming, thumbnails, admin entities, and player dashboard.
