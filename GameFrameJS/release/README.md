# Hosted beta release runbook

Invited beta: December 7, 2026. Go/no-go: December 11. Public beta: December 14.
These are target dates, not automatic publication or background development jobs.
The dated work breakdown and ownership are in `schedule.json`.

## Architecture and current state

Set `GAMEFRAME_HOSTED=1` to select the hosted gateway. The desktop/local entrypoint
remains available when that flag is absent. The gateway owns accounts, browser
sessions, CSRF, billing and the durable processing ledger. Every account gets a
separate application instance, SQLite library, temporary directory and EV output
directory. Python communicates over stdio and opens no network listener. Only one
workspace's Python worker is active at a time. Legacy unowned libraries are never
mounted into the hosted gateway.

Successful EV matching and matchup renders consume one credit. Failed/interrupted
jobs are recorded as failed and return the reservation; users submit a new request
after a restart. Interrupted HTTP jobs are **not automatically replayed**. Account
pages show usage, job history and recovery messages. Background speculative EV
matching is disabled in hosted mode; each charged run asks for confirmation.

The gateway checks upload/workspace sizes and both Node and Python guard incoming
saved database blobs against the workspace allowance. Temporary renders use
processing headroom; failed saves do not bypass the saved-library allowance.
Customers can clear unused uploads explicitly without removing saved source
references. The storage gate still requires a production stress test covering
chunked uploads, generated outputs, database growth and concurrent requests.

Local verification completed during implementation:

- Two-account cookie authentication, CSRF and private library/video access.
- Credit reservation, deduplication, refund and restart behavior.
- Stripe signature verification and current-state handling using a mocked API.
- Snapshot verification and deliberate corruption detection.
- Real desktop/mobile browser sign-in, Account, EV startup and sign-out.
- Python source paths cannot resolve files in another workspace.

These do not certify live payments, Linux container compatibility, off-service
backup delivery or production capacity. All launch gates remain unrecorded until
their complete evidence is reviewed. The complete named JavaScript test suite now passes **146/146** checks. Fourteen
stale fixture checks initially failed and were reproduced against the original
application source (commit 647592e). Their async boundaries, helper mocks, function
extraction and half-frame timeline expectations have been updated to the current
contracts, without changing the underlying application behavior. The focused
hosted suite passes 10/10 checks, including real Python gateway isolation. Python
source/quota checks pass 2/2. Captured evidence lives in release-artifacts.

The existing GitHub repository, ptehan/GameFrame, was verified **public** during
implementation. The connector has no visibility-update action, no GitHub browser
connection is exposed, and no non-interactive administration credential is
available locally. The owner must change repository visibility in
[GitHub repository settings](https://github.com/ptehan/GameFrame/settings) before
using it as the private production source. No source was pushed by this work.
Private hosting cannot retract copies of source already downloaded from a public
repository.

## Inventory and database preparation

For visual identification, run `node scripts/review-release-footage.cjs` and open
`release-artifacts/footage-review/index.html`. It copies playable private previews
without changing the database. Source-note selections are not publication consent;
unclear clips stay out of the release library.

The working domain recommendation is `gameframebaseball.com`, with a future
`support@gameframebaseball.com` address. `domain-research.json` records the checks:
the .com registry returned no registration record on November 13, but registrar
availability, price and naming review remain unconfirmed. Nothing was purchased.
Do not configure a live mailbox or app origin until the domain is actually owned.

The original library was backed up to
`release-artifacts/working-2026-11-13.db`. Its integrity check must read `ok`.
`release-artifacts/inventory-2026-11-13.json` records the full count-only inventory.
The original working database and source footage have not been cleaned or deleted.

Current candidates: 3 pitches, 2 saved swings, 6 matchups and 4 EV hits. An empty,
separate starter exists at `release-artifacts/release-starter/app.db`. It contains
no copied footage or customer credentials. A third approved swing is still needed.

```powershell
node scripts/release.cjs inventory app.db release-artifacts/inventory.json
node scripts/release.cjs backup-db app.db release-artifacts/working-backup.db
node scripts/release.cjs init release-artifacts/new-starter/app.db
```

Fill `release/footage-register.json` with explicit approved rows. Each requires an
owner, permission evidence, `permission: approved` and `app_distribution: true`.
Marketing permission is separate. Review faces, names and overlays in rendered
pixels; metadata sanitization does not remove them. Matchup source clips must also
be approved. The seed generator excludes account/session/payment tables and
removes paths, personal descriptions and identifying prediction metadata.

```powershell
node scripts/release.cjs seed app.db release/footage-register.json release-artifacts/approved/demo.db
```

Seed generation refuses an existing destination or an empty/unapproved manifest.
Use a new output filename to rebuild. Never reset the production accounts database.
Copy the approved seed to `/var/data/assets/demo.db`. Customers preview canonical
demos through authenticated read-only routes, then import private copies into an
empty workspace. Existing libraries cannot be overwritten by a demo import.

Footage research did not identify a verified reusable public Google Drive library.
`source-provenance.json` records the synthetic asset's generation manifest and the
engine header's Baseball Flight Simulator reference. Confirm existing reuse
permission/attribution or independent equation implementation during rights review;
this review has not established the source's commercial licensing status. The
[OpenBiomechanics owner's site](https://www.openbiomechanics.org/) expressly limits
its public data to non-commercial use without separate licensing, so it was not
selected as free footage for this paid app.
Useful source references:

- [Google Drive stock-media guidance](https://support.google.com/drive/answer/179622):
  verify the license covers the intended use.
- [Pexels license](https://www.pexels.com/license/): investigate individual footage
  for promotion; do not assume unrestricted app redistribution.
- [MLB footage conditions](https://img.mlbstatic.com/mlb-images/image/upload/mlb/uewhf68z4yyazojfl34k.pdf):
  broadcast access is not a commercial-footage license.

## Configuration and deployment

Copy `.env.example` to an untracked `.env` for local setup. Generate unique random
authentication/admin secrets. Use an authenticated business sender with Resend.
Never put credentials into source files, command arguments, screenshots or chat.

```powershell
node --env-file=.env server.js
node scripts/release.cjs invite hosted-data/accounts.db approved-tester@example.com
node scripts/release.cjs readiness hosted-data/accounts.db
```

Production uses the checked-in Dockerfile and Render Blueprint, a private Git
repository, HTTPS, one service and a persistent disk. Automatic deployments are
disabled. The 100 GB disk provides room for capped customer workspaces and backup
staging. Only runtime files enter the container; source footage, local databases,
experiments, credentials and build recordings are excluded.

The private 744 MB flight database is provisioned separately into
`/var/data/assets/hittrax.sqlite`, using an HTTPS download URL and a mandatory SHA-256
checksum. The URL is secret configuration. The application never serves this path.
Create the hash from the approved local asset before uploading it privately.

Docker is not available in the current workstation session. A fresh image build,
dependency install, Linux rendering and full restart/redeploy test remain required.

Render's listed 1 CPU / 2 GB service is $25/month and disks are $0.25/GB/month;
100 GB therefore budgets another $25/month. Verify the chosen dashboard plan and
workspace, bandwidth and backup charges before purchase. Keep the app/storage
allocation under $65, website/email under $15 and reserve $20.
[Render pricing](https://render.com/pricing), [persistent disks](https://render.com/docs/disks).

The workstation benchmark in `release-artifacts/benchmark/measurements.json`
recorded EV matching at 6.70 s first / 0.24 s warm, and software EV presentation
rendering at 33.95 s, using saved hit 100. These are local measurements; they do not
prove the Render cost gate. Run the same workload in staging and add peak memory,
matchup timing, two-user contention, retention, backups and bandwidth to the cost
model. Do not open sales unless a fully utilized paid account projects to at most
$3/month in variable processing/storage costs and the total stays below $100.

```powershell
.venv-ev/Scripts/python.exe scripts/benchmark-hosted.py --hit 100
node --test test/hosted.test.cjs test/hosted-billing.test.cjs test/hosted-release.test.cjs
.venv-ev/Scripts/python.exe test/hosted_source_test.py
```

## Stripe and operational recovery

Create one USD 9/month recurring Stripe price. Set `STRIPE_SECRET_KEY`,
`STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET`. Use test keys in staging and separate
live configuration in production. Enable subscription cancellation and payment
updates in the Customer Portal. Subscribe the webhook to Checkout completion,
subscription changes/deletions, paid invoices and failed invoices.

Routes: `POST /api/billing/checkout`, `POST /api/billing/portal`,
`POST /api/billing/webhook`, `GET /api/account`, `GET /api/jobs`.
The webhook must receive the raw request body. Checkout redirects never grant
access. Verified events retrieve current Stripe subscription/invoice state before
updating access. Only a paid invoice extends the paid horizon. Test duplicate and
delayed events, cancellation, renewals, failures, and recovery after email/API
outages with the actual account before recording the billing gate.

The operational loop runs hourly, takes a nightly SQLite/media snapshot inside
the global mutation lane, verifies it, transfers it with rclone and checks remote
bytes. Configure a dedicated encrypted off-service remote prefix named
`gameframe-backups`; mount rclone configuration as a Render secret file. Seven
remote snapshots and one verified local snapshot are retained. Configure provider
access controls and pricing, then perform an actual download/restore rehearsal.
Failed transfers never count as successful backups. Inspect disk headroom and
alert delivery during a prolonged remote outage; this is part of the operations
gate. Log alerts and operational email cover backup failures and low disk space.
Five server errors in ten minutes trigger an operational alert. Render uses the
health endpoint for service readiness. Verify alert delivery with the real sender.

```powershell
node scripts/release.cjs verify-backup downloaded-backup
node scripts/release.cjs restore downloaded-backup restored-gameframe
```

Restoration refuses an existing destination. Stop the service, verify the restored
data and then change the configured data directory or transfer the verified tree
into the stopped production volume. Never overwrite a live database.

On expired access, notices schedule deletion at least 30 days after notice. Account
deletion disables sign-in, schedules cancellation, emails confirmation and removes
footage after 30 days. Purging requires a successful operations/backup pass. Restore
procedures must reapply deletion records so old backups cannot resurrect deleted
accounts. Disabled account and billing identifiers remain for operational records.

## Website, channels and publishing

`release/content.json` contains 8 website pages, 3 full blog drafts, channel
descriptions, 3 YouTube outlines, 4 excerpt briefs and IG/Facebook/X copy. The
generator emits WordPress WXR XML, individual HTML previews and a channel kit.
Every WordPress item imports as a draft. Set domain, support email and backup
provider before generating the final import; preview defaults deliberately use
`example.invalid`. Privacy/Terms require owner review against the actual service.

```powershell
node scripts/build-launch-content.cjs
node scripts/prepare-launch-media.cjs
node scripts/prepare-channel-art.cjs
```

Import `release-artifacts/launch/wordpress-drafts.xml` into WordPress.com Personal.
Set Home as the front page and Blog as the posts page. Connect the main domain to
WordPress and its `app.` subdomain to Render. Publication stays manual until the
go/no-go review. Set GAMEFRAME_LEGAL_PUBLISHED=true only once the reviewed Privacy
and Terms pages are live; hosted links then redirect to the public website. Native WordPress authoring is not connected in this session.

Use `GameFrameBaseball`, then `GameFrameApp`, then `TrainWithGameFrame` as handle
candidates. Availability is unverified; no accounts or handles have been created.
Patrick owns signup, identity checks and the business accounts. Use 2FA and retain
recovery codes privately. No TikTok setup or launch content is included.

## Release gates

The ten gates are data, privacy, authentication, billing, limits, deployment,
usability, operations, cost and footage. Save concrete evidence for each, then:

```powershell
node scripts/release.cjs gate hosted-data/accounts.db privacy path-to-reviewed-evidence.txt
node scripts/release.cjs readiness hosted-data/accounts.db
```

Only set `GAMEFRAME_SALES_OPEN=true` after all gates and the December 11 review,
and after reviewed legal pages are live with `GAMEFRAME_LEGAL_PUBLISHED=true`.
Missing evidence keeps registration invitation-only and Checkout disabled even if
the flag is accidentally enabled. The gateway caps invited registration at 10
accounts and public registration at 25. Existing customers can still sign in.
Evidence files should identify the tested revision, environment and reviewer.
