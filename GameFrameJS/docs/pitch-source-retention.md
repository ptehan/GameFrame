# Original pitch videos

New single-pitch and multi-pitch uploads retain an unchanged copy of the original video in `source-videos/`, beside the active database. `pitch_video_sources` records the upload filename, stored filename and SHA-256. Finished and pending pitch records reference that source, including after trimming and pending-clip completion.

The browser does not expose the original local folder. GameFrame records its own saved location rather than claiming to know that folder. Existing pitch records without source metadata remain unknown.

The pitch player displays the original filename as a download link. Library offers Original Video under More. `/original/pitch?id=…` downloads the original; `&pending=1` selects a pending pitch.

When moving or backing up all original uploads, copy the `source-videos/` folder together with `app.db`. Database-only backups retain the source metadata but do not contain these original files. Stored filenames are relative so the database and folder can move together.
