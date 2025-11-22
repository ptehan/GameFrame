# ============================
# CREATE FOLDER STRUCTURE
# ============================

$folders = @(
    "routers",
    "utils"
)

foreach ($f in $folders) {
    if (-not (Test-Path $f)) {
        New-Item -ItemType Directory -Path $f | Out-Null
        Write-Host "Created folder: $f"
    } else {
        Write-Host "Folder exists: $f"
    }
}

# ============================
# CREATE FILES (ONLY IF MISSING)
# ============================

$files = @{
    "main.py"                         = ""
    "utils/db.py"                     = ""
    "utils/video.py"                  = ""

    "routers/teams.py"                = ""
    "routers/pitchers.py"             = ""
    "routers/hitters.py"              = ""

    "routers/pitch_upload.py"         = ""
    "routers/swing_upload.py"         = ""

    "routers/pitch_library.py"        = ""
    "routers/swing_library.py"        = ""
    "routers/pitch_stream.py"         = ""
    "routers/swing_stream.py"         = ""

    "routers/matchup_select.py"       = ""
    "routers/matchup_build.py"        = ""
    "routers/matchup_library.py"      = ""
    "routers/matchup_download.py"     = ""
}

foreach ($file in $files.Keys) {
    if (-not (Test-Path $file)) {
        New-Item -ItemType File -Path $file -Force | Out-Null
        Write-Host "Created file: $file"
    } else {
        Write-Host "File exists: $file   (skipped)"
    }
}

Write-Host "---------------------------------------------"
Write-Host " Folder + file structure is now in place."
Write-Host " Ready for inserting actual code modules."
Write-Host "---------------------------------------------"
