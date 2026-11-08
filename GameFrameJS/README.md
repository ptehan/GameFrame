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

EV modeling, the library, and matchups share this one app and HTTP server. `npm start`
also owns the internal Python processing worker; no separate EV server or port is
needed. `npm run start:all` is a compatibility alias for the same app. EV processing
uses `.venv-ev` when present, or `GAMEFRAME_EV_PYTHON` to select another Python with
the dependencies from `ev-predictor/requirements.txt` installed.

## Notes

- This runs from `GameFrameJS` and does not modify your existing FastAPI app files.
- `ffmpeg` and `ffprobe` must be available in your system `PATH`.
- Route coverage includes library, upload/trim/finalize, matchup creation, streaming, thumbnails, admin entities, and player dashboard.
# GameFrame

## Desktop authentication and usage

The hosted Render service continues to serve the existing web application. It also exposes the lightweight authentication and usage API used by the desktop build. Player data and video remain in the desktop SQLite database; the hosted database receives only accounts, device registrations, licenses, and usage events.

Configure these environment variables on the existing Render service:

```text
AUTH_CODE_SECRET=<long random value>
RESEND_API_KEY=<transactional email API key>
AUTH_FROM_EMAIL=GameFrame <signin@your-verified-domain.example>
ADMIN_API_KEY=<another long random value>
TRIAL_MATCHUP_LIMIT=3
TRIAL_DAYS=14
```

For a development-only deployment that returns the login code in the response instead of sending email:

```text
AUTH_ALLOW_DEV_CODE=true
```

Never enable `AUTH_ALLOW_DEV_CODE` on the public production service.

The desktop API address is stored in `desktop/config.json` and can be overridden when launching a development build with `GAMEFRAME_API_URL`. The production value should point to the existing Render URL or a stable custom domain routed to that same service.

Relevant endpoints:

```text
POST /api/v1/auth/request-code
POST /api/v1/auth/verify-code
GET  /api/v1/license/status
POST /api/v1/usage/authorize
POST /api/v1/usage/complete
GET  /api/v1/admin/usage
POST /api/v1/admin/licenses
```

The two admin endpoints require the `X-Admin-Key` request header. The usage endpoint returns aggregate totals and recent customer usage. The license endpoint grants a Season Pass after a customer has signed in at least once. Never ship `ADMIN_API_KEY`, `AUTH_CODE_SECRET`, or `RESEND_API_KEY` inside the desktop application.

Run the authentication and trial tests with:

```text
npm test
```

Build the Windows installer and portable executable with:

```text
npm run build:desktop
```

## Rollout safeguards

- The desktop app stores the baseball library locally and creates one startup backup per day, retaining five.
- Use **Manage → Backup & Restore** to download or restore a complete library backup.
- Failed matchup builds do not permanently consume an allowance. Authorizations abandoned for more than two hours are recovered automatically.
- **Auth → Account & Usage** shows the plan, allowance, version status, and registered devices.
- The hosted `/health` endpoint reports database and rollout-configuration readiness without exposing secrets.
- Production authentication fails closed when its signing secret or email service is unavailable. Set `GAMEFRAME_ENFORCE_PRODUCTION_CONFIG=true` after the Render secrets have been verified to make the hosted service refuse startup when configuration is incomplete.
- Set `DESKTOP_DOWNLOAD_URL` on Render when a stable installer download is available. Desktop clients will then display it when the hosted version differs.
- Video processing checks available temporary-disk capacity before expensive local work. `MAX_UPLOAD_MB` controls the maximum accepted input size.

The privacy and usage-terms pages are accurate technical drafts, but they still require legal review before public sale. Windows signing still requires a purchased signing certificate and payment activation still requires a payment-provider account and credentials.

### EV video exports

Video sections render concurrently (up to eight workers) and are joined without re-encoding the assembled video. Set `EV_RENDER_WORKERS=1` for sequential rendering or another value from 1 to 8 to limit concurrency. `EV_ENCODER_THREADS` limits threads per encoder (default 2, maximum 4). Exports use the calibrated flight-plane rotation when a saved trajectory and camera calibration are available, with the existing synthetic flight view as fallback.
