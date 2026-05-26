const express = require("express");
const path = require("path");
const os = require("os");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const multer = require("multer");
const nunjucks = require("nunjucks");
const Database = require("better-sqlite3");

const app = express();
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, "app.db");
const TMP_DIR = os.tmpdir();
const db = new Database(DB_PATH);
const upload = multer({ dest: TMP_DIR });

app.use(express.urlencoded({ extended: true, limit: "200mb" }));
app.use(express.json({ limit: "200mb" }));
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
});
app.use("/static", express.static(path.join(ROOT, "static")));

const env = nunjucks.configure(path.join(ROOT, "templates"), {
  autoescape: true,
  express: app,
  noCache: true,
});
env.addFilter("tojson", (v) => new nunjucks.runtime.SafeString(JSON.stringify(v)));
env.addFilter("format", (fmt, value) => {
  const f = String(fmt || "");
  const m = /^%\.(\d+)f$/.exec(f);
  if (m) {
    const digits = Number(m[1]);
    const n = Number(value || 0);
    return Number.isFinite(n) ? n.toFixed(digits) : "0";
  }
  if (f === "%d" || f === "%i") return String(Math.trunc(Number(value || 0)));
  if (f === "%s") return String(value == null ? "" : value);
  return f;
});
env.addGlobal("none", null);

function sidOf(req) {
  return (req.query.sid || req.body.sid || "x").toString();
}

function tempPath(id) {
  return path.join(TMP_DIR, `gf_${id}.mp4`);
}

function sourceTempPath(id) {
  return path.join(TMP_DIR, `gf_src_${id}.mp4`);
}

function isSupportedImportUrl(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const allowed = [
      "youtube.com",
      "youtu.be",
      "twitter.com",
      "x.com",
      "instagram.com",
      "tiktok.com",
    ];
    return allowed.some((d) => host === d || host.endsWith(`.${d}`));
  } catch (_) {
    return false;
  }
}

function importKind(raw) {
  return raw === "pitch" ? "pitch" : "swing";
}

const SWING_CAMERA_VIEW_SIDE_CHEST = "side_hitter_chest";

function normalizeSwingCameraView(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === SWING_CAMERA_VIEW_SIDE_CHEST) return SWING_CAMERA_VIEW_SIDE_CHEST;
  if (value === "other") return "other";
  return "unknown";
}

function swingCameraViewAllowsPose(cameraView) {
  return normalizeSwingCameraView(cameraView) === SWING_CAMERA_VIEW_SIDE_CHEST;
}

function downloadExternalVideo(url, outputPath) {
  const ytdlpBin = process.env.YTDLP_BIN || "yt-dlp";
  runCmd(ytdlpBin, [
    "--no-playlist",
    "--no-warnings",
    // Use broad best-available formats; strict mp4-only selectors fail on some links.
    "--format", "bv*+ba/b",
    "--merge-output-format", "mp4",
    "-o", outputPath,
    url,
  ]);
}

function parseFraction(raw) {
  if (!raw) return 0;
  if (typeof raw === "number") return raw;
  const s = String(raw).trim();
  if (!s) return 0;
  if (s.includes("/")) {
    const [n, d] = s.split("/").map(Number);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
    return n / d;
  }
  const x = Number(s);
  return Number.isFinite(x) ? x : 0;
}

function runCmd(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: null,
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const err = (result.stderr || Buffer.from("")).toString("utf8");
    throw new Error(`${cmd} failed (${result.status}): ${err}`);
  }
  return result;
}

function ffprobeMeta(filePath) {
  try {
    const r = runCmd("ffprobe", [
      "-v", "error",
      "-count_frames",
      "-select_streams", "v:0",
      "-show_entries", "stream=nb_read_frames,nb_frames,avg_frame_rate,r_frame_rate,duration",
      "-show_entries", "format=duration",
      "-of", "json",
      filePath,
    ]);
    const j = JSON.parse((r.stdout || Buffer.from("")).toString("utf8") || "{}");
    const stream = (j.streams && j.streams[0]) || {};
    const fmt = j.format || {};
    const fps = parseFraction(stream.avg_frame_rate) || parseFraction(stream.r_frame_rate);
    let frameCount = Number(stream.nb_read_frames || stream.nb_frames || 0);
    const duration = Number(stream.duration || fmt.duration || 0);
    if ((!Number.isFinite(frameCount) || frameCount <= 0) && fps > 0 && duration > 0) {
      frameCount = Math.round(fps * duration);
    }
    return {
      fps: Number.isFinite(fps) && fps > 0 ? fps : 0,
      frameCount: Number.isFinite(frameCount) && frameCount > 0 ? frameCount : 0,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    };
  } catch (_) {
    return { fps: 0, frameCount: 0, duration: 0 };
  }
}

function swingEventSeconds(frameCount, fps, fallback = null) {
  const n = Number(frameCount || 0);
  const f = Number(fps || 0);
  if (Number.isFinite(n) && n > 1 && Number.isFinite(f) && f > 0) {
    return (n - 1) / f;
  }
  if (Number.isFinite(n) && n === 1 && Number.isFinite(f) && f > 0) {
    return 0;
  }
  const fb = Number(fallback);
  return Number.isFinite(fb) ? fb : null;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parsePoseCsvRows(poseData) {
  const lines = String(poseData || "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((h) => String(h || "").trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    for (let h = 0; h < headers.length; h += 1) row[headers[h]] = cols[h] == null ? "" : cols[h];
    rows.push(row);
  }
  return { headers, rows };
}

function poseGuideFromRows(rows) {
  if (!rows || !rows.length) return null;
  const n = rows.length;
  const toNum = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  let startIdx = -1;
  let decisionIdx = -1;
  let contactIdx = -1;
  let handSpeedPeak = 0;
  let visibleFrames = 0;
  for (let i = 0; i < n; i += 1) {
    const r = rows[i];
    if (startIdx < 0 && Number(r.event_swing_start || 0) === 1) startIdx = i;
    if (decisionIdx < 0 && Number(r.event_decision || 0) === 1) decisionIdx = i;
    if (contactIdx < 0 && Number(r.event_contact || 0) === 1) contactIdx = i;
    const hs = toNum(r.hand_speed);
    if (hs != null) handSpeedPeak = Math.max(handSpeedPeak, hs);
    const shoulder1x = toNum(r.shoulder1_x);
    const shoulder2x = toNum(r.shoulder2_x);
    const hip1x = toNum(r.hip1_x);
    const hip2x = toNum(r.hip2_x);
    if ([shoulder1x, shoulder2x, hip1x, hip2x].every((v) => v != null)) visibleFrames += 1;
  }
  const contactRatio = n > 1 && contactIdx >= 0 ? contactIdx / (n - 1) : null;
  const decisionToContactFrames = (decisionIdx >= 0 && contactIdx >= 0) ? (contactIdx - decisionIdx) : null;
  const startToContactFrames = (startIdx >= 0 && contactIdx >= 0) ? (contactIdx - startIdx) : null;
  return {
    frameCount: n,
    startIdx,
    decisionIdx,
    contactIdx,
    contactRatio,
    decisionToContactFrames,
    startToContactFrames,
    handSpeedPeak,
    torsoVisibleRatio: n > 0 ? (visibleFrames / n) : 0,
  };
}

function evaluatePoseDataQuality(poseData) {
  const parsed = parsePoseCsvRows(poseData);
  const rows = parsed.rows;
  if (!rows.length) {
    return {
      score: 0,
      status: "bad",
      reasons: ["No pose rows found"],
      metrics: null,
    };
  }
  const g = poseGuideFromRows(rows);
  const reasons = [];
  let score = 0;

  if (g.frameCount >= 35) score += 15;
  else if (g.frameCount >= 20) score += 8;
  else reasons.push("Too few frames");

  if (g.torsoVisibleRatio >= 0.75) score += 20;
  else if (g.torsoVisibleRatio >= 0.55) score += 12;
  else reasons.push("Low torso landmark visibility");

  const eventsOrdered = g.startIdx >= 0 && g.decisionIdx >= 0 && g.contactIdx >= 0
    && g.startIdx < g.decisionIdx && g.decisionIdx < g.contactIdx;
  if (eventsOrdered) score += 20;
  else reasons.push("Start/decision/contact markers are missing or out of order");

  if (g.decisionToContactFrames != null) {
    if (g.decisionToContactFrames >= 3 && g.decisionToContactFrames <= 10) score += 15;
    else if (g.decisionToContactFrames >= 2 && g.decisionToContactFrames <= 14) score += 8;
    else reasons.push("Decision-to-contact gap looks unrealistic");
  }

  if (g.startToContactFrames != null) {
    if (g.startToContactFrames >= 8 && g.startToContactFrames <= 35) score += 15;
    else if (g.startToContactFrames >= 5 && g.startToContactFrames <= 45) score += 8;
    else reasons.push("Start-to-contact span looks unrealistic");
  }

  if (g.contactRatio != null) {
    if (g.contactRatio >= 0.45 && g.contactRatio <= 0.92) score += 10;
    else reasons.push("Contact appears too early/late in clip");
  }

  if (g.handSpeedPeak > 0.01) score += 5;
  else reasons.push("Hand-speed signal is too flat");

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  let status = "bad";
  if (finalScore >= 65) status = "good";
  else if (finalScore >= 45) status = "review";
  return {
    score: finalScore,
    status,
    reasons,
    metrics: g,
  };
}

function extractLastFrameJpeg(filePath) {
  try {
    const r = runCmd("ffmpeg", [
      "-v", "error",
      "-sseof", "-0.05",
      "-i", filePath,
      "-frames:v", "1",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1",
    ]);
    return r.stdout && r.stdout.length > 0 ? r.stdout : null;
  } catch (_) {
    return null;
  }
}

function hasColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function ensureColumn(table, column, ddlType) {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddlType}`);
  }
}

function ensureBaseSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS pitchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE TABLE IF NOT EXISTS hitters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE TABLE IF NOT EXISTS pitch_clips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER,
      pitcher_id INTEGER,
      description TEXT,
      clip_blob BLOB,
      thumb BLOB,
      fps REAL,
      created_at TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (pitcher_id) REFERENCES pitchers(id)
    );

    CREATE TABLE IF NOT EXISTS swing_clips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER,
      hitter_id INTEGER,
      description TEXT,
      camera_view TEXT,
      clip_blob BLOB,
      library_clip_blob BLOB,
      thumb BLOB,
      pose_data TEXT,
      frame_count INTEGER,
      swing_seconds REAL,
      fps REAL,
      decision_frame INTEGER,
      created_at TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (hitter_id) REFERENCES hitters(id)
    );

    CREATE TABLE IF NOT EXISTS matchups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pitch_clip_id INTEGER,
      swing_clip_id INTEGER,
      description TEXT,
      matchup_blob BLOB,
      thumb BLOB,
      created_at TIMESTAMP,
      FOREIGN KEY (pitch_clip_id) REFERENCES pitch_clips(id),
      FOREIGN KEY (swing_clip_id) REFERENCES swing_clips(id)
    );
  `);
}

function ensureSchemaCompatibility() {
  ensureBaseSchema();
  ensureColumn("pitch_clips", "thumb", "BLOB");
  ensureColumn("swing_clips", "thumb", "BLOB");
  ensureColumn("swing_clips", "pose_data", "TEXT");
  ensureColumn("swing_clips", "frame_count", "INTEGER");
  ensureColumn("swing_clips", "swing_seconds", "REAL");
  ensureColumn("swing_clips", "library_clip_blob", "BLOB");
  ensureColumn("swing_clips", "pose_quality_score", "REAL");
  ensureColumn("swing_clips", "pose_quality_status", "TEXT");
  ensureColumn("swing_clips", "camera_view", "TEXT");
}

function ffmpegDrawtextEscape(text) {
  return String(text == null ? "" : text)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,");
}

function matchupFontFile() {
  const custom = process.env.GAMEFRAME_FONT_FILE;
  if (custom && fs.existsSync(custom)) return custom;
  const win = process.env.WINDIR || "C:\\Windows";
  const arial = path.join(win, "Fonts", "arial.ttf");
  return fs.existsSync(arial) ? arial : "";
}

function buildMatchupVideoServerSide({ pitchBlob, swingBlob, description, hitterName, pitcherName, swingSeconds, decisionFrame, swingContactFrame }) {
  const jobId = `gf_matchup_${crypto.randomUUID()}`;
  const dir = path.join(TMP_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  const pitchPath = path.join(dir, "pitch.mp4");
  const swingPath = path.join(dir, "swing.mp4");
  const titlePath = path.join(dir, "title.mp4");
  const outputPath = path.join(dir, "matchup.mp4");
  const fontfile = matchupFontFile().replace(/\\/g, "/");
  const segmentPaths = [];

  try {
    fs.writeFileSync(pitchPath, pitchBlob);
    fs.writeFileSync(swingPath, swingBlob);

    const pitchMeta = ffprobeMeta(pitchPath);
    const swingMeta = ffprobeMeta(swingPath);
    const commonFps = 30;
    const pitchFrameCount = Number(pitchMeta.frameCount || 0);
    const swingFrameCount = Number(swingMeta.frameCount || 0);
    if (!pitchFrameCount || !swingFrameCount) {
      throw new Error("Unable to read matchup clip timing.");
    }

    const pitchContactFrame = Math.max(0, pitchFrameCount - 1);
    const visualSwingLastIdx = Math.max(0, swingFrameCount - 1);
    const swingContactIdx = Number.isFinite(Number(swingContactFrame))
      ? Math.max(0, Math.min(visualSwingLastIdx, Math.round(Number(swingContactFrame))))
      : visualSwingLastIdx;
    const padCount = Math.max(0, pitchContactFrame - swingContactIdx);
    const rawDecisionFrame = Number(decisionFrame);
    const decisionLocal = Number.isFinite(rawDecisionFrame)
      ? Math.max(0, Math.min(swingContactIdx, Math.round(rawDecisionFrame)))
      : Math.max(0, swingContactIdx - 5);
    let decisionGlobal = decisionLocal + padCount;
    const contactGlobal = pitchContactFrame;
    if (decisionGlobal >= contactGlobal) {
      decisionGlobal = Math.max(padCount, contactGlobal - 1);
    }

    const FREEZE_FRAMES = 60;
    const END_DECISION_FREEZE_FRAMES = 90;
    const TITLE_SECONDS = 4;
    const OUTPUT_W = 1280;
    const OUTPUT_H = 720;
    const HALF_W = 640;
    const labelBoxW = 420;
    const labelBoxH = 72;
    const safeDesc = ffmpegDrawtextEscape(description || "Matchup");
    const safeTitle = ffmpegDrawtextEscape(`${hitterName} vs ${pitcherName}`);
    const safeSwingDuration = ffmpegDrawtextEscape(`Swing Duration: ${Number.isFinite(Number(swingSeconds)) ? Number(swingSeconds).toFixed(2) : "0.00"}s`);
    const safeDate = ffmpegDrawtextEscape(new Date().toLocaleDateString("en-US"));
    const labelX = `(w-${labelBoxW})/2`;
    const labelY = `h-${labelBoxH + 22}`;

    const drawtextBase = fontfile ? `fontfile='${ffmpegDrawtextEscape(fontfile)}':` : "";

    function framesToCloneSeconds(frameCount) {
      return Math.max(0, (Number(frameCount || 0) - 1) / commonFps);
    }

    function sideChain(inputIndex, sourceFrameCount, startFrame, endFrameExclusive, freezeFrames = 0, tint = null, outLabel = "tmp") {
      const desiredFrames = Math.max(1, endFrameExclusive - startFrame);
      const clampedStart = Math.max(0, Math.min(sourceFrameCount - 1, startFrame));
      const clampedEndExclusive = Math.max(
        clampedStart + 1,
        Math.min(sourceFrameCount, Math.max(startFrame + 1, endFrameExclusive))
      );
      const sourceFrames = Math.max(1, clampedEndExclusive - clampedStart);
      const outputFrames = freezeFrames > 0 ? freezeFrames : desiredFrames;
      const extraCloneFrames = Math.max(0, outputFrames - sourceFrames);
      let chain = `[${inputIndex}:v]trim=start_frame=${clampedStart}:end_frame=${clampedEndExclusive},setpts=PTS-STARTPTS`;
      if (extraCloneFrames > 0) {
        chain += `,tpad=stop_mode=clone:stop_duration=${framesToCloneSeconds(extraCloneFrames + 1)}`;
      }
      if (tint) {
        chain += `,drawbox=x=0:y=0:w=iw:h=ih:color=${tint}@0.25:t=fill`;
      }
      chain += `,fps=${commonFps},scale=${HALF_W}:${OUTPUT_H}:force_original_aspect_ratio=decrease,pad=${HALF_W}:${OUTPUT_H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
      return `${chain}[${outLabel}]`;
    }

    function pushSegment(filters, segments, key, pitchSpec, swingSpec, labelText = "") {
      const left = `${key}_l`;
      const right = `${key}_r`;
      const stacked = `${key}_s`;
      const out = `${key}_o`;
      filters.push(sideChain(0, pitchFrameCount, pitchSpec.start, pitchSpec.end, pitchSpec.freezeFrames || 0, pitchSpec.tint || null, left));
      filters.push(sideChain(1, swingFrameCount, swingSpec.start, swingSpec.end, swingSpec.freezeFrames || 0, swingSpec.tint || null, right));
      filters.push(`[${left}][${right}]hstack=inputs=2[${stacked}]`);
      if (labelText) {
        const safeLabel = ffmpegDrawtextEscape(labelText);
        filters.push(
          `[${stacked}]drawbox=x=${labelX}:y=${labelY}:w=${labelBoxW}:h=${labelBoxH}:color=black@0.72:t=fill,` +
          `drawtext=${drawtextBase}text='${safeLabel}':fontcolor=white:fontsize=34:x=(w-text_w)/2:y=h-${labelBoxH - 20},` +
          `format=yuv420p[${out}]`
        );
      } else {
        filters.push(`[${stacked}]format=yuv420p[${out}]`);
      }
      segments.push(`[${out}]`);
    }

    function pitchSpecForGlobalRange(globalStart, globalEndExclusive, opts = {}) {
      return {
        start: Math.min(globalStart, pitchFrameCount - 1),
        end: Math.min(globalEndExclusive, pitchFrameCount),
        freezeFrames: opts.freezeFrames || 0,
        tint: opts.tint || null,
      };
    }

    function swingSpecForGlobalRange(globalStart, globalEndExclusive, opts = {}) {
      if (globalEndExclusive <= padCount) {
        return {
          start: 0,
          end: 1,
          freezeFrames: opts.freezeFrames || Math.max(1, globalEndExclusive - globalStart),
          tint: opts.tint || null,
        };
      }
      const localStart = Math.max(0, Math.min(visualSwingLastIdx, globalStart - padCount));
      const localEndExclusive = Math.max(
        localStart + 1,
        Math.min(swingFrameCount, globalEndExclusive - padCount)
      );
      return {
        start: localStart,
        end: localEndExclusive,
        freezeFrames: opts.freezeFrames || 0,
        tint: opts.tint || null,
      };
    }

    function pushGlobalSegment(filters, segments, key, globalStart, globalEndExclusive, opts = {}) {
      if (globalEndExclusive <= globalStart) return;
      pushSegment(
        filters,
        segments,
        key,
        pitchSpecForGlobalRange(globalStart, globalEndExclusive, opts),
        swingSpecForGlobalRange(globalStart, globalEndExclusive, opts),
        opts.labelText || ""
      );
    }

    const filters = [];
    const segments = [];

    filters.push(
      `[2:v]drawtext=${drawtextBase}text='${safeDesc}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=180,` +
      `drawtext=${drawtextBase}text='${safeTitle}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=260,` +
      `drawtext=${drawtextBase}text='${safeSwingDuration}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=340,` +
      `drawtext=${drawtextBase}text='${safeDate}':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=420,` +
      `fps=${commonFps},trim=duration=${TITLE_SECONDS},setpts=PTS-STARTPTS,format=yuv420p[seg_title]`
    );
    segments.push("[seg_title]");

    if (padCount > 0) {
      pushGlobalSegment(filters, segments, "seg_lead", 0, padCount);
    }

    pushGlobalSegment(filters, segments, "seg_first", padCount, padCount + 1, {
      freezeFrames: FREEZE_FRAMES,
      tint: "yellow",
      labelText: "First Move",
    });

    if (decisionGlobal > padCount + 1) {
      pushGlobalSegment(filters, segments, "seg_motion_a", padCount + 1, decisionGlobal);
    }

    pushGlobalSegment(filters, segments, "seg_decision", decisionGlobal, decisionGlobal + 1, {
      freezeFrames: FREEZE_FRAMES,
      tint: "green",
      labelText: "Decision",
    });

    if (contactGlobal > decisionGlobal + 1) {
      pushGlobalSegment(filters, segments, "seg_motion_b", decisionGlobal + 1, contactGlobal + 1);
    }

    if (pitchFrameCount > contactGlobal + 1) {
      pushGlobalSegment(filters, segments, "seg_tail", contactGlobal + 1, pitchFrameCount);
    }

    pushGlobalSegment(filters, segments, "seg_contact", contactGlobal, contactGlobal + 1, {
      freezeFrames: FREEZE_FRAMES,
      labelText: "Contact",
    });

    pushGlobalSegment(filters, segments, "seg_first_end", padCount, padCount + 1, {
      freezeFrames: END_DECISION_FREEZE_FRAMES,
      labelText: "First Move",
    });

    filters.push(`${segments.join("")}concat=n=${segments.length}:v=1:a=0[outv]`);

    runCmd("ffmpeg", [
      "-y",
      "-i", pitchPath,
      "-i", swingPath,
      "-f", "lavfi",
      "-i", `color=c=black:s=${OUTPUT_W}x${OUTPUT_H}:r=${commonFps}:d=${TITLE_SECONDS}`,
      "-filter_complex", filters.join(";"),
      "-map", "[outv]",
      "-r", String(commonFps),
      "-threads", "1",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    ], { cwd: dir });

    return {
      blob: fs.readFileSync(outputPath),
      thumb: extractLastFrameJpeg(outputPath),
    };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
}

function backfillSwingClipMetrics() {
  const rows = db.prepare(`
    SELECT id, clip_blob, frame_count, swing_seconds, fps
    FROM swing_clips
    WHERE clip_blob IS NOT NULL
      AND (
        frame_count IS NULL OR frame_count <= 0 OR
        swing_seconds IS NULL OR swing_seconds <= 0 OR
        fps IS NULL OR fps <= 0
      )
  `).all();
  if (!rows.length) return;

  const updateStmt = db.prepare("UPDATE swing_clips SET frame_count=?, swing_seconds=?, fps=? WHERE id=?");
  for (const row of rows) {
    const tempFile = path.join(TMP_DIR, `gf_backfill_${crypto.randomUUID()}.mp4`);
    try {
      fs.writeFileSync(tempFile, row.clip_blob);
      const meta = ffprobeMeta(tempFile);
      const frameCount = Number(meta.frameCount || row.frame_count || 0);
      const fps = Number(meta.fps || row.fps || 0);
      const swingSeconds = swingEventSeconds(frameCount, fps, row.swing_seconds);
      updateStmt.run(
        Number.isFinite(frameCount) && frameCount > 0 ? frameCount : null,
        Number.isFinite(swingSeconds) && swingSeconds > 0 ? swingSeconds : null,
        Number.isFinite(fps) && fps > 0 ? fps : null,
        Number(row.id)
      );
    } catch (_) {
      // Leave the existing row untouched if metadata extraction fails.
    } finally {
      try { fs.unlinkSync(tempFile); } catch (_) {}
    }
  }
}

function safeIdent(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name || ""));
}

function deleteReferencingRows(parentTable, parentId) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  for (const t of tables) {
    const tableName = String(t.name || "");
    if (!safeIdent(tableName)) continue;
    const fkRows = db.prepare(`PRAGMA foreign_key_list(${tableName})`).all();
    for (const fk of fkRows) {
      if (String(fk.table || "") !== parentTable) continue;
      const fromCol = String(fk.from || "");
      if (!safeIdent(fromCol)) continue;
      db.prepare(`DELETE FROM ${tableName} WHERE ${fromCol}=?`).run(parentId);
    }
  }
}

function render(req, res, template, data = {}) {
  res.render(template, {
    request: { query_params: req.query || {} },
    ...data,
  });
}

function streamBlob(req, res, blob) {
  if (!blob) {
    res.status(404).send("not found");
    return;
  }
  const size = blob.length;
  const rangeHeader = req.headers.range;
  if (!rangeHeader) {
    res.status(200).set({
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
    });
    res.end(blob);
    return;
  }
  const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
  if (!m) {
    res.status(200).set({
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
    });
    res.end(blob);
    return;
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Number(m[2]);
  if (start >= size || start > end) {
    res.status(416).end();
    return;
  }
  const chunk = blob.subarray(start, end + 1);
  res.status(206).set({
    "Content-Type": "video/mp4",
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Content-Length": String(chunk.length),
    "Accept-Ranges": "bytes",
  });
  res.end(chunk);
}

function pct(sortedVals, p) {
  if (!sortedVals.length) return 0;
  if (sortedVals.length === 1) return Number(sortedVals[0]);
  const pos = (sortedVals.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return Number(sortedVals[lo]);
  const frac = pos - lo;
  return sortedVals[lo] * (1 - frac) + sortedVals[hi] * frac;
}

function buildSummary(swings) {
  const vals = swings.map((s) => Number(s.swing_seconds || 0)).filter((v) => v > 0);
  if (!vals.length) return null;
  const valsSorted = [...vals].sort((a, b) => a - b);
  const n = valsSorted.length;
  const avg = valsSorted.reduce((a, b) => a + b, 0) / n;
  const median = pct(valsSorted, 0.5);
  const p10 = pct(valsSorted, 0.1);
  const p25 = pct(valsSorted, 0.25);
  const p75 = pct(valsSorted, 0.75);
  const p90 = pct(valsSorted, 0.9);
  const iqr = p75 - p25;
  const stddev = Math.sqrt(valsSorted.reduce((a, v) => a + (v - avg) * (v - avg), 0) / n);
  const cv = avg > 0 ? stddev / avg : 0;
  const consistency = Math.max(0, Math.min(100, 100 - cv * 100));
  const lowFence = p25 - 1.5 * iqr;
  const highFence = p75 + 1.5 * iqr;
  const outlierCount = valsSorted.filter((v) => v < lowFence || v > highFence).length;
  const oldestToNewest = [...vals].reverse();
  let trendPerSwing = 0;
  if (oldestToNewest.length >= 2) {
    const xMean = (oldestToNewest.length - 1) / 2;
    const yMean = oldestToNewest.reduce((a, b) => a + b, 0) / oldestToNewest.length;
    let num = 0;
    let den = 0;
    oldestToNewest.forEach((y, i) => {
      const dx = i - xMean;
      num += dx * (y - yMean);
      den += dx * dx;
    });
    trendPerSwing = den ? num / den : 0;
  }
  const recent = vals.slice(0, 10);
  return {
    count: n,
    min: Math.min(...valsSorted),
    max: Math.max(...valsSorted),
    range: Math.max(...valsSorted) - Math.min(...valsSorted),
    avg,
    median,
    stddev,
    cv,
    p10,
    p25,
    p75,
    p90,
    iqr,
    outlier_count: outlierCount,
    consistency_score: consistency,
    last10_avg: recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : avg,
    trend_per_swing: trendPerSwing,
    series_desc: vals,
  };
}

ensureSchemaCompatibility();
backfillSwingClipMetrics();

app.get("/manifest.json", (req, res) => {
  res.type("application/manifest+json").sendFile(path.join(ROOT, "static", "manifest.json"));
});

app.get("/service-worker.js", (req, res) => {
  res.type("application/javascript").sendFile(path.join(ROOT, "static", "service-worker.js"));
});

app.get("/", (req, res) => render(req, res, "index.html", { sid: sidOf(req) }));
app.get("/external_video", (req, res) => render(req, res, "external_video.html", { sid: sidOf(req) }));
app.get("/logout", (req, res) => res.redirect(302, `/?sid=${encodeURIComponent(sidOf(req))}`));

app.post("/external_video/fetch", async (req, res) => {
  const sid = sidOf(req);
  const videoUrl = String(req.body.video_url || "").trim();
  const clipType = importKind(String(req.body.clip_type || "swing").trim());

  if (!isSupportedImportUrl(videoUrl)) {
    return render(req, res, "external_video.html", {
      sid,
      error: "Paste a valid YouTube, X/Twitter, Instagram, or TikTok link.",
      video_url: videoUrl,
      clip_type: clipType,
    });
  }

  const sourceId = crypto.randomUUID();
  const srcPath = sourceTempPath(sourceId);
  try {
    downloadExternalVideo(videoUrl, srcPath);
    const meta = ffprobeMeta(srcPath);
    if (!meta.duration || meta.duration <= 0) {
      throw new Error("Could not read video duration after download.");
    }
    return render(req, res, "external_video_trim.html", {
      sid,
      source_id: sourceId,
      clip_type: clipType,
      source_url: `/external/source?id=${encodeURIComponent(sourceId)}`,
      duration: meta.duration,
    });
  } catch (err) {
    await fsp.unlink(srcPath).catch(() => {});
    const msg = String(err && err.message ? err.message : err || "");
    const firstLine = (msg.split("\n").find((s) => s.trim()) || "").trim();
    const hint = firstLine
      ? `Video import failed: ${firstLine}`
      : "Video import failed. Try a public post link and retry.";
    return render(req, res, "external_video.html", {
      sid,
      error: hint,
      video_url: videoUrl,
      clip_type: clipType,
    });
  }
});

app.get("/external/source", (req, res) => {
  const p = sourceTempPath(req.query.id);
  if (!fs.existsSync(p)) return res.status(404).send("not found");
  res.type("video/mp4").sendFile(p);
});

app.post("/external_video/trim", async (req, res) => {
  const sid = sidOf(req);
  const sourceId = String(req.body.source_id || "").trim();
  const clipType = importKind(String(req.body.clip_type || "swing").trim());
  const startSec = Math.max(0, Number(req.body.start_sec || 0));
  const srcPath = sourceTempPath(sourceId);
  const outPath = tempPath(sourceId);

  if (!sourceId || !fs.existsSync(srcPath)) {
    return render(req, res, "external_video.html", {
      sid,
      error: "Source video expired. Paste the link again.",
      clip_type: clipType,
    });
  }

  try {
    const meta = ffprobeMeta(srcPath);
    const maxStart = Math.max(0, (meta.duration || 0) - 5);
    const clampedStart = Math.min(startSec, maxStart);
    runCmd("ffmpeg", [
      "-y",
      "-ss", String(clampedStart),
      "-i", srcPath,
      "-t", "5",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-an",
      outPath,
    ]);
    await fsp.unlink(srcPath).catch(() => {});
  } catch (_) {
    return render(req, res, "external_video.html", {
      sid,
      error: "Could not trim to 5 seconds. Try another link or clip.",
      clip_type: clipType,
    });
  }

  const q = new URLSearchParams({
    sid,
    from_yt: "1",
    temp_id: sourceId,
  });
  if (clipType === "pitch") {
    return res.redirect(303, `/upload/pitch?${q.toString()}`);
  }
  return res.redirect(303, `/upload/swing?${q.toString()}`);
});

app.get("/teams", (req, res) => {
  const items = db.prepare("SELECT id, name, description FROM teams ORDER BY name").all();
  render(req, res, "manage_entities.html", { sid: sidOf(req), view: "teams", items });
});

app.post("/teams/add", (req, res) => {
  db.prepare("INSERT INTO teams (name, description) VALUES (?, ?)").run(req.body.name, req.body.description || "");
  res.redirect(303, `/teams?sid=${encodeURIComponent(sidOf(req))}`);
});

app.post("/teams/delete", (req, res) => {
  db.prepare("DELETE FROM teams WHERE id=?").run(Number(req.body.item_id));
  res.redirect(303, `/teams?sid=${encodeURIComponent(sidOf(req))}`);
});

app.post("/teams/edit", (req, res) => {
  db.prepare("UPDATE teams SET name=?, description=? WHERE id=?").run(
    req.body.name,
    req.body.description || "",
    Number(req.body.item_id)
  );
  res.redirect(303, `/teams?sid=${encodeURIComponent(sidOf(req))}`);
});

app.get("/hitters", (req, res) => {
  const items = db.prepare(`
    SELECT
      hitters.id AS id,
      hitters.name AS hitter_name,
      hitters.description AS hitter_description,
      teams.name AS team_name,
      hitters.team_id AS team_id
    FROM hitters
    JOIN teams ON hitters.team_id = teams.id
    ORDER BY teams.name, hitters.name
  `).all();
  const teams = db.prepare("SELECT id, name FROM teams ORDER BY name").all();
  render(req, res, "manage_entities.html", { sid: sidOf(req), view: "hitters", items, teams });
});

app.post("/hitters/add", (req, res) => {
  db.prepare("INSERT INTO hitters (name, description, team_id) VALUES (?, ?, ?)").run(
    req.body.name,
    req.body.description || "",
    Number(req.body.team_id)
  );
  res.redirect(303, `/hitters?sid=${encodeURIComponent(sidOf(req))}`);
});

app.post("/hitters/edit", (req, res) => {
  db.prepare("UPDATE hitters SET team_id=?, name=?, description=? WHERE id=?").run(
    Number(req.body.team_id),
    req.body.name,
    req.body.description || "",
    Number(req.body.item_id)
  );
  res.redirect(303, `/hitters?sid=${encodeURIComponent(sidOf(req))}`);
});

app.post("/hitters/delete", (req, res) => {
  db.prepare("DELETE FROM hitters WHERE id=?").run(Number(req.body.item_id));
  res.redirect(303, `/hitters?sid=${encodeURIComponent(sidOf(req))}`);
});

app.get("/pitchers", (req, res) => {
  const items = db.prepare(`
    SELECT
      pitchers.id AS id,
      pitchers.name AS pitcher_name,
      pitchers.description AS pitcher_description,
      teams.name AS team_name,
      pitchers.team_id AS team_id
    FROM pitchers
    JOIN teams ON pitchers.team_id = teams.id
    ORDER BY teams.name, pitchers.name
  `).all();
  const teams = db.prepare("SELECT id, name FROM teams ORDER BY name").all();
  render(req, res, "manage_entities.html", { sid: sidOf(req), view: "pitchers", items, teams });
});

app.post("/pitchers/add", (req, res) => {
  db.prepare("INSERT INTO pitchers (name, description, team_id) VALUES (?, ?, ?)").run(
    req.body.name,
    req.body.description || "",
    Number(req.body.team_id)
  );
  res.redirect(303, `/pitchers?sid=${encodeURIComponent(sidOf(req))}`);
});

app.post("/pitchers/edit", (req, res) => {
  db.prepare("UPDATE pitchers SET team_id=?, name=?, description=? WHERE id=?").run(
    Number(req.body.team_id),
    req.body.name,
    req.body.description || "",
    Number(req.body.item_id)
  );
  res.redirect(303, `/pitchers?sid=${encodeURIComponent(sidOf(req))}`);
});

app.post("/pitchers/delete", (req, res) => {
  db.prepare("DELETE FROM pitchers WHERE id=?").run(Number(req.body.item_id));
  res.redirect(303, `/pitchers?sid=${encodeURIComponent(sidOf(req))}`);
});

app.get("/library", (req, res) => {
  render(req, res, "library.html", {
    sid: sidOf(req),
    type: (req.query.type || "matchup").toString(),
  });
});

app.get("/library/data", async (req, res) => {
  const type = (req.query.type || "").toString();
  const sid = sidOf(req);

  if (type === "pitch") {
    const rows = db.prepare(`
      SELECT pc.id, pc.description, pc.created_at, t.name AS team_name, p.name AS pitcher_name
      FROM pitch_clips pc
      JOIN pitchers p ON p.id = pc.pitcher_id
      JOIN teams t ON t.id = p.team_id
      ORDER BY pc.created_at DESC
    `).all();
    return res.json(rows.map((r) => ({
      type: "pitch",
      id: r.id,
      description: r.description,
      created_at: r.created_at,
      team_name: r.team_name,
      pitcher_name: r.pitcher_name,
      hitter_name: "",
      thumbnail: `/thumbnail/pitch?id=${r.id}`,
      play: `/play/pitch?id=${r.id}&sid=${encodeURIComponent(sid)}`,
      delete: "/library/pitch/delete",
    })));
  }

  if (type === "swing") {
    const hasSwingSeconds = hasColumn("swing_clips", "swing_seconds");
    const hasFrameCount = hasColumn("swing_clips", "frame_count");
    const hasPoseData = hasColumn("swing_clips", "pose_data");
    const hasPoseQualityScore = hasColumn("swing_clips", "pose_quality_score");
    const hasPoseQualityStatus = hasColumn("swing_clips", "pose_quality_status");
    const rows = db.prepare(`
      SELECT sc.id, sc.description, sc.created_at, t.name AS team_name, h.name AS hitter_name, sc.fps,
             ${hasSwingSeconds ? "sc.swing_seconds" : "NULL"} AS swing_seconds,
             ${hasFrameCount ? "sc.frame_count" : "NULL"} AS frame_count,
             ${hasPoseData ? "CASE WHEN sc.pose_data IS NOT NULL AND TRIM(sc.pose_data) <> '' THEN 1 ELSE 0 END" : "0"} AS has_pose_data,
             ${hasPoseQualityScore ? "sc.pose_quality_score" : "NULL"} AS pose_quality_score,
             ${hasPoseQualityStatus ? "sc.pose_quality_status" : "NULL"} AS pose_quality_status
      FROM swing_clips sc
      JOIN hitters h ON h.id = sc.hitter_id
      JOIN teams t ON t.id = h.team_id
      ORDER BY sc.created_at DESC
    `).all();

    const out = [];
    for (const r of rows) {
      let fps = Number(r.fps || 0);
      let swingSeconds = r.swing_seconds == null ? null : Number(r.swing_seconds);
      let frameCount = r.frame_count == null ? null : Number(r.frame_count);
      if (frameCount != null && fps > 0) {
        swingSeconds = swingEventSeconds(frameCount, fps, swingSeconds);
      }
      out.push({
        type: "swing",
        id: r.id,
        description: r.description,
        created_at: r.created_at,
        team_name: r.team_name,
        pitcher_name: "",
        hitter_name: r.hitter_name,
        swing_duration_seconds: swingSeconds,
        has_pose_data: Number(r.has_pose_data || 0),
        pose_quality_score: r.pose_quality_score == null ? null : Number(r.pose_quality_score),
        pose_quality_status: r.pose_quality_status == null ? null : String(r.pose_quality_status || ""),
        thumbnail: `/thumbnail/swing?id=${r.id}`,
        play: `/play/swing?id=${r.id}&sid=${encodeURIComponent(sid)}`,
        delete: "/library/swing/delete",
      });
    }
    return res.json(out);
  }

  if (type === "matchup") {
    const rows = db.prepare(`
      SELECT m.id, m.description, m.created_at,
             tp.name AS pitcher_team, p.name AS pitcher_name,
             th.name AS hitter_team, h.name AS hitter_name
      FROM matchups m
      LEFT JOIN pitch_clips pc ON pc.id = m.pitch_clip_id
      LEFT JOIN pitchers p ON p.id = pc.pitcher_id
      LEFT JOIN teams tp ON tp.id = p.team_id
      LEFT JOIN swing_clips sc ON sc.id = m.swing_clip_id
      LEFT JOIN hitters h ON h.id = sc.hitter_id
      LEFT JOIN teams th ON th.id = h.team_id
      ORDER BY m.created_at DESC
    `).all();
    return res.json(rows.map((r) => ({
      type: "matchup",
      id: r.id,
      description: r.description,
      created_at: r.created_at,
      pitcher_team: r.pitcher_team || "(deleted)",
      pitcher_name: r.pitcher_name || "(deleted)",
      hitter_team: r.hitter_team || "(deleted)",
      hitter_name: r.hitter_name || "(deleted)",
      team_name: "",
      thumbnail: `/thumbnail/matchup?id=${r.id}`,
      play: `/play/matchup?id=${r.id}&sid=${encodeURIComponent(sid)}`,
      delete: "/library/matchup/delete",
    })));
  }

  res.status(400).json({ error: "invalid type" });
});

app.get("/thumbnail/pitch", (req, res) => {
  if (!hasColumn("pitch_clips", "thumb")) return res.status(404).send("not found");
  const row = db.prepare("SELECT thumb FROM pitch_clips WHERE id=?").get(Number(req.query.id));
  if (!row || !row.thumb) return res.status(404).send("not found");
  res.type("image/jpeg").send(row.thumb);
});

app.get("/thumbnail/swing", (req, res) => {
  const row = db.prepare("SELECT thumb FROM swing_clips WHERE id=?").get(Number(req.query.id));
  if (!row || !row.thumb) return res.status(404).send("not found");
  res.type("image/jpeg").send(row.thumb);
});

app.get("/thumbnail/matchup", (req, res) => {
  const row = db.prepare("SELECT thumb FROM matchups WHERE id=?").get(Number(req.query.id));
  if (!row || !row.thumb) return res.status(404).send("not found");
  res.type("image/jpeg").send(row.thumb);
});

app.get("/play/pitch", (req, res) => render(req, res, "play_pitch.html", { sid: sidOf(req), id: Number(req.query.id) }));
app.get("/play/swing", (req, res) => render(req, res, "play_swing.html", { sid: sidOf(req), id: Number(req.query.id) }));
app.get("/play/matchup", (req, res) => render(req, res, "play_matchup.html", { sid: sidOf(req), id: Number(req.query.id) }));

app.get("/stream/pitch", (req, res) => {
  const row = db.prepare("SELECT clip_blob FROM pitch_clips WHERE id=?").get(Number(req.query.id));
  if (!row) return res.status(404).send("not found");
  streamBlob(req, res, row.clip_blob);
});

app.get("/stream/swing", (req, res) => {
  const row = db.prepare("SELECT COALESCE(library_clip_blob, clip_blob) AS clip_blob FROM swing_clips WHERE id=?").get(Number(req.query.id));
  if (!row) return res.status(404).send("not found");
  streamBlob(req, res, row.clip_blob);
});

app.get("/stream/matchup", (req, res) => {
  const row = db.prepare("SELECT matchup_blob FROM matchups WHERE id=?").get(Number(req.query.id));
  if (!row) return res.status(404).send("not found");
  streamBlob(req, res, row.matchup_blob);
});

app.get("/stream/pitch_clip", (req, res) => {
  const row = db.prepare("SELECT clip_blob FROM pitch_clips WHERE id=?").get(Number(req.query.id));
  if (!row) return res.status(404).send("not found");
  res.type("video/mp4").send(row.clip_blob);
});

app.get("/stream/swing_clip", (req, res) => {
  const row = db.prepare("SELECT clip_blob FROM swing_clips WHERE id=?").get(Number(req.query.id));
  if (!row) return res.status(404).send("not found");
  res.type("video/mp4").set("Accept-Ranges", "bytes").send(row.clip_blob);
});

app.get("/upload/pitch", (req, res) => {
  const teams = db.prepare("SELECT id, name FROM teams ORDER BY name").all();
  const pitchers = db.prepare("SELECT id, name, team_id FROM pitchers ORDER BY name").all();
  render(req, res, "upload_pitch.html", { sid: sidOf(req), teams, pitchers });
});

app.get("/upload/swing", (req, res) => {
  const teams = db.prepare("SELECT id, name FROM teams ORDER BY name").all();
  const hitters = db.prepare("SELECT id, name, team_id FROM hitters ORDER BY name").all();
  render(req, res, "upload_swing.html", { sid: sidOf(req), teams, hitters });
});

app.post("/upload/pitch", upload.single("file"), (req, res) => {
  const tempId = crypto.randomUUID();
  const origPath = req.file.path;
  const trimmedPath = tempPath(tempId);
  const start = Number(req.body.start_min || 0) * 60 + Number(req.body.start_sec || 0);
  try {
    runCmd("ffmpeg", [
      "-y", "-ss", String(start), "-i", origPath, "-t", "5",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-an", trimmedPath,
    ]);
  } finally {
    fsp.unlink(origPath).catch(() => {});
  }
  const q = new URLSearchParams({
    sid: sidOf(req),
    temp_id: tempId,
    team_id: String(req.body.team_id),
    pitcher_id: String(req.body.pitcher_id),
    description: String(req.body.description || ""),
  });
  res.redirect(303, `/upload/pitch/trim?${q.toString()}`);
});

app.post("/upload/swing", upload.single("file"), (req, res) => {
  const tempId = crypto.randomUUID();
  const origPath = req.file.path;
  const trimmedPath = tempPath(tempId);
  const start = Number(req.body.start_min || 0) * 60 + Number(req.body.start_sec || 0);
  try {
    runCmd("ffmpeg", [
      "-y", "-ss", String(start), "-i", origPath, "-t", "5",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-an", trimmedPath,
    ]);
  } finally {
    fsp.unlink(origPath).catch(() => {});
  }
  const q = new URLSearchParams({
    sid: sidOf(req),
    temp_id: tempId,
    team_id: String(req.body.team_id),
    hitter_id: String(req.body.hitter_id),
    description: String(req.body.description || ""),
  });
  res.redirect(303, `/upload/swing/trim?${q.toString()}`);
});

app.get("/upload/pitch/trim", (req, res) => {
  render(req, res, "upload_pitch_trim.html", {
    sid: sidOf(req),
    temp_id: req.query.temp_id,
    team_id: req.query.team_id,
    pitcher_id: req.query.pitcher_id,
    description: req.query.description || "",
  });
});

app.get("/upload/swing/trim", (req, res) => {
  render(req, res, "upload_swing_trim.html", {
    sid: sidOf(req),
    temp_id: req.query.temp_id,
    team_id: req.query.team_id,
    hitter_id: req.query.hitter_id,
    description: req.query.description || "",
    fps: Number(req.query.fps || 0),
    total: Number(req.query.total || 0),
  });
});

app.get("/raw/pitch", (req, res) => {
  const p = tempPath(req.query.id);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.type("video/mp4").sendFile(p);
});

app.get("/raw/swing", (req, res) => {
  const p = tempPath(req.query.id);
  if (!fs.existsSync(p)) return res.status(404).send("not found");
  res.type("video/mp4").sendFile(p);
});

app.get("/api/raw/swing-meta", (req, res) => {
  const p = tempPath(req.query.id);
  if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: "not found" });
  const meta = ffprobeMeta(p);
  res.json({
    ok: true,
    fps: Number(meta.fps || 0),
    frame_count: Number(meta.frameCount || 0),
    duration: Number(meta.duration || 0),
  });
});

app.get("/import/youtube/tempfile", (req, res) => {
  const p = tempPath(req.query.temp_id);
  if (!fs.existsSync(p)) return res.status(404).send("not found");
  res.type("video/mp4").sendFile(p);
});

app.post("/upload/pitch/finalize", upload.single("file"), async (req, res) => {
  const blob = await fsp.readFile(req.file.path);
  const thumbBlob = extractLastFrameJpeg(req.file.path);
  await fsp.unlink(req.file.path).catch(() => {});
  db.prepare(`
    INSERT INTO pitch_clips (team_id, pitcher_id, description, clip_blob, thumb, fps, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    Number(req.body.team_id),
    Number(req.body.pitcher_id),
    req.body.description || "",
    blob,
    thumbBlob,
    Number(req.body.fps || 0)
  );
  res.redirect(303, `/library?sid=${encodeURIComponent(sidOf(req))}&type=pitch`);
});

app.post("/upload/swing/finalize", upload.fields([{ name: "file", maxCount: 1 }, { name: "library_file", maxCount: 1 }]), async (req, res) => {
  const mainFile = req.files && req.files.file && req.files.file[0];
  if (!mainFile) return res.status(400).send("missing file");
  const libraryFile = req.files && req.files.library_file && req.files.library_file[0];

  const blob = await fsp.readFile(mainFile.path);
  const libraryBlob = libraryFile ? await fsp.readFile(libraryFile.path) : blob;
  const thumbBlob = extractLastFrameJpeg(mainFile.path);
  await fsp.unlink(mainFile.path).catch(() => {});
  if (libraryFile) await fsp.unlink(libraryFile.path).catch(() => {});
  const cameraView = normalizeSwingCameraView(req.body.camera_view);
  const poseData = swingCameraViewAllowsPose(cameraView) ? String(req.body.pose_data || "") : "";
  const poseQuality = evaluatePoseDataQuality(poseData);
  const fps = Number(req.body.fps || 0);
  const frameCount = Number(req.body.frame_count || 0);
  const swingSeconds = Number(req.body.swing_seconds || 0);
  db.prepare(`
    INSERT INTO swing_clips
    (team_id, hitter_id, description, camera_view, decision_frame, clip_blob, library_clip_blob, thumb, pose_data, pose_quality_score, pose_quality_status, frame_count, swing_seconds, fps, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    Number(req.body.team_id),
    Number(req.body.hitter_id),
    req.body.description || "",
    cameraView,
    Number(req.body.decision_frame || 0),
    blob,
    libraryBlob,
    thumbBlob,
    poseData,
    poseData.trim() ? Number(poseQuality.score || 0) : null,
    poseData.trim() ? String(poseQuality.status || "") : null,
    Number.isFinite(frameCount) && frameCount > 0 ? frameCount : null,
    Number.isFinite(swingSeconds) && swingSeconds > 0 ? swingSeconds : null,
    Number.isFinite(fps) && fps > 0 ? fps : null
  );
  res.redirect(303, `/library?sid=${encodeURIComponent(sidOf(req))}`);
});

app.post("/library/pitch/delete", (req, res) => {
  db.prepare("DELETE FROM pitch_clips WHERE id=?").run(Number(req.body.id));
  res.redirect(303, `/library?sid=${encodeURIComponent(sidOf(req))}&type=pitch`);
});

app.post("/library/swing/delete", (req, res) => {
  const swingId = Number(req.body.id);
  const removeSwing = db.transaction((id) => {
    deleteReferencingRows("swing_clips", id);
    db.prepare("DELETE FROM swing_clips WHERE id=?").run(id);
  });
  removeSwing(swingId);
  res.redirect(303, `/library?sid=${encodeURIComponent(sidOf(req))}&type=swing`);
});

app.post("/library/matchup/delete", (req, res) => {
  db.prepare("DELETE FROM matchups WHERE id=?").run(Number(req.body.id));
  res.redirect(303, `/library?sid=${encodeURIComponent(sidOf(req))}&type=matchup`);
});

app.post("/upload/common/add-team", upload.none(), (req, res) => {
  const teamName = String(req.body.name || "").trim();
  if (!teamName) return res.status(400).json({ ok: false, error: "Team name is required." });
  const exists = db.prepare("SELECT id, name FROM teams WHERE name=? COLLATE NOCASE").get(teamName);
  if (exists) return res.status(400).json({ ok: false, error: "Team already exists." });
  try {
    db.prepare("INSERT INTO teams (name) VALUES (?)").run(teamName);
    const row = db.prepare("SELECT id, name FROM teams WHERE name=?").get(teamName);
    return res.json({ ok: true, id: row.id, name: row.name });
  } catch (_) {
    return res.status(400).json({ ok: false, error: "Team already exists or is invalid." });
  }
});

app.post("/upload/common/add-hitter", upload.none(), (req, res) => {
  const teamId = Number(req.body.team_id);
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ ok: false, error: "Hitter name is required." });
  const team = db.prepare("SELECT id FROM teams WHERE id=?").get(teamId);
  if (!team) return res.status(400).json({ ok: false, error: "Team not found." });
  const exists = db.prepare("SELECT id FROM hitters WHERE team_id=? AND name=? COLLATE NOCASE").get(teamId, name);
  if (exists) return res.status(400).json({ ok: false, error: "Hitter already exists on this team." });
  db.prepare("INSERT INTO hitters (team_id, name) VALUES (?, ?)").run(teamId, name);
  const row = db.prepare("SELECT id, name, team_id FROM hitters WHERE team_id=? AND name=? ORDER BY id DESC LIMIT 1").get(teamId, name);
  res.json({ ok: true, id: row.id, name: row.name, team_id: row.team_id });
});

app.post("/upload/common/add-pitcher", upload.none(), (req, res) => {
  const teamId = Number(req.body.team_id);
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ ok: false, error: "Pitcher name is required." });
  const team = db.prepare("SELECT id FROM teams WHERE id=?").get(teamId);
  if (!team) return res.status(400).json({ ok: false, error: "Team not found." });
  const exists = db.prepare("SELECT id FROM pitchers WHERE team_id=? AND name=? COLLATE NOCASE").get(teamId, name);
  if (exists) return res.status(400).json({ ok: false, error: "Pitcher already exists on this team." });
  db.prepare("INSERT INTO pitchers (team_id, name) VALUES (?, ?)").run(teamId, name);
  const row = db.prepare("SELECT id, name, team_id FROM pitchers WHERE team_id=? AND name=? ORDER BY id DESC LIMIT 1").get(teamId, name);
  res.json({ ok: true, id: row.id, name: row.name, team_id: row.team_id });
});

app.get("/swing/pose-data", (req, res) => {
  if (!hasColumn("swing_clips", "pose_data")) return res.status(404).json({ ok: false, error: "pose_data field not available." });
  const row = db.prepare("SELECT pose_data FROM swing_clips WHERE id=?").get(Number(req.query.id));
  if (!row) return res.status(404).json({ ok: false, error: "Swing not found." });
  res.json({ ok: true, pose_data: row.pose_data || "" });
});

app.get("/swing/pose-quality", (req, res) => {
  if (!hasColumn("swing_clips", "pose_data")) return res.status(404).json({ ok: false, error: "pose_data field not available." });
  const id = Number(req.query.id);
  const row = db.prepare(`
    SELECT pose_data,
           ${hasColumn("swing_clips", "pose_quality_score") ? "pose_quality_score" : "NULL"} AS pose_quality_score,
           ${hasColumn("swing_clips", "pose_quality_status") ? "pose_quality_status" : "NULL"} AS pose_quality_status
    FROM swing_clips
    WHERE id=?
  `).get(id);
  if (!row) return res.status(404).json({ ok: false, error: "Swing not found." });
  const poseData = String(row.pose_data || "");
  if (!poseData.trim()) {
    return res.json({ ok: true, score: null, status: "none", reasons: ["No pose data"], metrics: null });
  }
  const quality = evaluatePoseDataQuality(poseData);
  if (hasColumn("swing_clips", "pose_quality_score") && hasColumn("swing_clips", "pose_quality_status")) {
    db.prepare("UPDATE swing_clips SET pose_quality_score=?, pose_quality_status=? WHERE id=?")
      .run(Number(quality.score || 0), String(quality.status || ""), id);
  }
  res.json({
    ok: true,
    score: Number(quality.score || 0),
    status: String(quality.status || ""),
    reasons: quality.reasons || [],
    metrics: quality.metrics || null,
  });
});

app.post("/swing/pose-data/delete", upload.none(), (req, res) => {
  const id = Number(req.body.id);
  if (!id) return res.status(400).json({ ok: false, error: "Missing id." });
  const hasScore = hasColumn("swing_clips", "pose_quality_score");
  const hasStatus = hasColumn("swing_clips", "pose_quality_status");
  if (hasScore && hasStatus) {
    db.prepare("UPDATE swing_clips SET pose_data='', pose_quality_score=NULL, pose_quality_status=NULL WHERE id=?").run(id);
  } else {
    db.prepare("UPDATE swing_clips SET pose_data='' WHERE id=?").run(id);
  }
  res.json({ ok: true });
});

app.get("/swing/reference-guide", (req, res) => {
  const hitterId = Number(req.query.hitter_id || 0);
  const teamId = Number(req.query.team_id || 0);
  let where = "WHERE pose_data IS NOT NULL AND TRIM(pose_data) <> ''";
  const args = [];
  if (hitterId > 0) {
    where += " AND hitter_id=?";
    args.push(hitterId);
  } else if (teamId > 0) {
    where += " AND team_id=?";
    args.push(teamId);
  }
  if (hasColumn("swing_clips", "pose_quality_status")) {
    where += " AND (pose_quality_status='good' OR pose_quality_status='review')";
  }
  const rows = db.prepare(`
    SELECT id, pose_data
    FROM swing_clips
    ${where}
    ORDER BY created_at DESC
    LIMIT 50
  `).all(...args);
  const guides = [];
  for (const r of rows) {
    const parsed = parsePoseCsvRows(String(r.pose_data || ""));
    const g = poseGuideFromRows(parsed.rows || []);
    if (!g || g.frameCount < 15 || g.contactRatio == null || g.decisionToContactFrames == null) continue;
    guides.push(g);
  }
  if (!guides.length) return res.json({ ok: true, count: 0, guide: null });
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
  const contactRatio = avg(guides.map((g) => g.contactRatio).filter(Number.isFinite));
  const decisionToContactFrames = avg(guides.map((g) => g.decisionToContactFrames).filter(Number.isFinite));
  const startToContactFrames = avg(guides.map((g) => g.startToContactFrames).filter(Number.isFinite));
  res.json({
    ok: true,
    count: guides.length,
    guide: {
      contact_ratio: Number.isFinite(contactRatio) ? contactRatio : null,
      decision_to_contact_frames: Number.isFinite(decisionToContactFrames) ? decisionToContactFrames : null,
      start_to_contact_frames: Number.isFinite(startToContactFrames) ? startToContactFrames : null,
    },
  });
});

app.get("/api/swing_meta", async (req, res) => {
  const row = db.prepare("SELECT fps, decision_frame, swing_seconds, frame_count, clip_blob FROM swing_clips WHERE id=?").get(Number(req.query.id));
  if (!row) return res.json({ error: "bad_meta" });
  let fps = Number(row.fps || 0);
  let swingSeconds = row.swing_seconds == null ? null : Number(row.swing_seconds);
  let frameCount = row.frame_count == null ? null : Number(row.frame_count);
  if (frameCount != null && fps > 0) {
    swingSeconds = swingEventSeconds(frameCount, fps, swingSeconds);
  } else if (swingSeconds == null && row.clip_blob) {
    const p = path.join(TMP_DIR, `gf_meta_${crypto.randomUUID()}.mp4`);
    await fsp.writeFile(p, row.clip_blob);
    const meta = ffprobeMeta(p);
    await fsp.unlink(p).catch(() => {});
    if (!frameCount && meta.frameCount > 0) frameCount = meta.frameCount;
    if (fps <= 0 && meta.fps > 0) fps = meta.fps;
    if (frameCount && fps > 0) swingSeconds = swingEventSeconds(frameCount, fps, swingSeconds);
  }
  res.json({
    fps,
    decision_frame: row.decision_frame,
    swing_seconds: swingSeconds,
    frame_count: frameCount,
  });
});

app.get("/api/pitch_meta", async (req, res) => {
  const row = db.prepare("SELECT fps, clip_blob FROM pitch_clips WHERE id=?").get(Number(req.query.id));
  if (!row) return res.json({ error: "bad_meta" });
  let fps = Number(row.fps || 0);
  let frameCount = null;
  let duration = null;
  if (row.clip_blob) {
    const p = path.join(TMP_DIR, `gf_pitch_meta_${crypto.randomUUID()}.mp4`);
    await fsp.writeFile(p, row.clip_blob);
    const meta = ffprobeMeta(p);
    await fsp.unlink(p).catch(() => {});
    if (meta.frameCount > 0) frameCount = meta.frameCount;
    if (meta.duration > 0) duration = meta.duration;
    if (fps <= 0 && meta.fps > 0) fps = meta.fps;
  }
  res.json({
    fps,
    frame_count: frameCount,
    duration,
  });
});

app.get("/matchup/select", (req, res) => {
  const teams = db.prepare("SELECT id, name FROM teams ORDER BY name").all();
  const pitcherRows = db.prepare("SELECT id, name, team_id FROM pitchers ORDER BY name").all();
  const pitchRows = db.prepare("SELECT id, pitcher_id, description, created_at FROM pitch_clips ORDER BY created_at DESC").all();
  const hitterRows = db.prepare("SELECT id, name, team_id FROM hitters ORDER BY name").all();
  const swingRows = db.prepare("SELECT id, hitter_id, description, created_at FROM swing_clips ORDER BY created_at DESC").all();

  const pitcherMap = {};
  pitcherRows.forEach((r) => {
    const k = String(r.team_id);
    if (!pitcherMap[k]) pitcherMap[k] = [];
    pitcherMap[k].push({ id: r.id, name: r.name });
  });
  const pitchClipMap = {};
  pitchRows.forEach((r) => {
    const k = String(r.pitcher_id);
    if (!pitchClipMap[k]) pitchClipMap[k] = [];
    const created = (r.created_at || "").toString().slice(0, 10);
    pitchClipMap[k].push({ id: r.id, label: `${created} - ${r.description || `Pitch ${r.id}`}` });
  });
  const hitterMap = {};
  hitterRows.forEach((r) => {
    const k = String(r.team_id);
    if (!hitterMap[k]) hitterMap[k] = [];
    hitterMap[k].push({ id: r.id, name: r.name });
  });
  const swingClipMap = {};
  swingRows.forEach((r) => {
    const k = String(r.hitter_id);
    if (!swingClipMap[k]) swingClipMap[k] = [];
    const created = (r.created_at || "").toString().slice(0, 10);
    swingClipMap[k].push({ id: r.id, label: `${created} - ${r.description || `Swing ${r.id}`}` });
  });

  render(req, res, "matchup_select.html", {
    sid: sidOf(req),
    teams,
    pitcher_map: pitcherMap,
    pitch_clip_map: pitchClipMap,
    hitter_map: hitterMap,
    swing_clip_map: swingClipMap,
  });
});

app.post("/matchup/select", (req, res) => {
  const q = new URLSearchParams({
    sid: sidOf(req),
    pitch_id: String(req.body.pitch_id),
    swing_id: String(req.body.swing_id),
    description: String(req.body.description || ""),
  });
  res.redirect(303, `/matchup/build?${q.toString()}`);
});

app.get("/matchup/build", (req, res) => {
  const q = new URLSearchParams({
    sid: sidOf(req),
    pitch_id: String(req.query.pitch_id || ""),
    swing_id: String(req.query.swing_id || ""),
    description: String(req.query.description || ""),
  });
  res.redirect(302, `/matchup/select?${q.toString()}`);
});

app.post("/matchup/create", upload.single("file"), async (req, res) => {
  try {
    let blob = null;
    let thumbBlob = null;

    if (req.file) {
      blob = await fsp.readFile(req.file.path);
      thumbBlob = extractLastFrameJpeg(req.file.path);
      await fsp.unlink(req.file.path).catch(() => {});
    } else {
      const pitchId = Number(req.body.pitch_id);
      const swingId = Number(req.body.swing_id);
      const pitchRow = db.prepare(`
        SELECT pc.clip_blob, p.name AS pitcher_name
        FROM pitch_clips pc
        LEFT JOIN pitchers p ON p.id = pc.pitcher_id
        WHERE pc.id=?
      `).get(pitchId);
      const swingRow = db.prepare(`
       SELECT COALESCE(sc.library_clip_blob, sc.clip_blob) AS clip_blob,
               sc.swing_seconds,
               sc.decision_frame,
               sc.frame_count,
                h.name AS hitter_name
        FROM swing_clips sc
        LEFT JOIN hitters h ON h.id = sc.hitter_id
        WHERE sc.id=?
      `).get(swingId);
      if (!pitchRow || !pitchRow.clip_blob || !swingRow || !swingRow.clip_blob) {
        return res.status(400).json({ error: "Missing matchup source clip." });
      }
      const built = buildMatchupVideoServerSide({
        pitchBlob: pitchRow.clip_blob,
        swingBlob: swingRow.clip_blob,
        description: req.body.description || "",
        hitterName: swingRow.hitter_name || "Hitter",
        pitcherName: pitchRow.pitcher_name || "Pitcher",
        swingSeconds: swingRow.swing_seconds,
        decisionFrame: swingRow.decision_frame,
        swingContactFrame: Number(swingRow.frame_count || 0) > 0 ? (Number(swingRow.frame_count) - 1) : null,
      });
      blob = built.blob;
      thumbBlob = built.thumb;
    }

    const result = db.prepare(`
      INSERT INTO matchups (pitch_clip_id, swing_clip_id, description, matchup_blob, thumb, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      Number(req.body.pitch_id),
      Number(req.body.swing_id),
      req.body.description || "",
      blob,
      thumbBlob
    );
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    const message = err && err.message ? err.message : "Could not build matchup.";
    console.error("matchup/create failed:", message);
    res.status(500).json({ error: message });
  }
});

app.post("/dashboard/player/swing/delete", (req, res) => {
  const swingId = Number(req.body.swing_id);
  const removeSwing = db.transaction((id) => {
    deleteReferencingRows("swing_clips", id);
    db.prepare("DELETE FROM swing_clips WHERE id=?").run(id);
  });
  removeSwing(swingId);
  const sid = encodeURIComponent(sidOf(req));
  const tid = encodeURIComponent(String(req.body.tid || 0));
  const hid = encodeURIComponent(String(req.body.hid || 0));
  res.redirect(303, `/dashboard/player?sid=${sid}&tid=${tid}&hid=${hid}`);
});

app.get("/dashboard/player", async (req, res) => {
  const tid = Number(req.query.tid || 0);
  const hid = Number(req.query.hid || 0);
  const pq = String(req.query.pq || "");
  const playerQuery = pq.trim().toLowerCase();

  const teams = db.prepare("SELECT id, name FROM teams ORDER BY name").all();
  const hittersSql = tid
    ? `
      SELECT h.id, h.name, h.team_id, t.name AS team_name, COUNT(sc.id) AS swing_count, MAX(sc.created_at) AS last_swing_at
      FROM hitters h
      JOIN teams t ON t.id = h.team_id
      LEFT JOIN swing_clips sc ON sc.hitter_id = h.id
      WHERE h.team_id = ?
      GROUP BY h.id, h.name, h.team_id, t.name
      ORDER BY t.name, h.name
    `
    : `
      SELECT h.id, h.name, h.team_id, t.name AS team_name, COUNT(sc.id) AS swing_count, MAX(sc.created_at) AS last_swing_at
      FROM hitters h
      JOIN teams t ON t.id = h.team_id
      LEFT JOIN swing_clips sc ON sc.hitter_id = h.id
      GROUP BY h.id, h.name, h.team_id, t.name
      ORDER BY t.name, h.name
    `;
  let hitters = tid ? db.prepare(hittersSql).all(tid) : db.prepare(hittersSql).all();
  if (playerQuery) hitters = hitters.filter((h) => String(h.name || "").toLowerCase().includes(playerQuery));

  let selectedHitter = null;
  if (hid) {
    selectedHitter = db.prepare(`
      SELECT h.id, h.name, t.name
      FROM hitters h
      JOIN teams t ON t.id = h.team_id
      WHERE h.id=?
    `).get(hid);
  }

  const swingsView = [];
  if (hid) {
    const hasPoseData = hasColumn("swing_clips", "pose_data");
    const matchupRows = db.prepare(`
      SELECT swing_clip_id, COUNT(*) AS c, MAX(id) AS latest_id
      FROM matchups
      WHERE swing_clip_id IS NOT NULL
      GROUP BY swing_clip_id
    `).all();
    const matchupBySwing = {};
    matchupRows.forEach((r) => {
      matchupBySwing[Number(r.swing_clip_id)] = {
        count: Number(r.c || 0),
        latest_id: r.latest_id == null ? null : Number(r.latest_id),
      };
    });

    const rows = db.prepare(`
      SELECT id, description, fps, decision_frame, created_at, frame_count, swing_seconds,
             ${hasPoseData ? "CASE WHEN pose_data IS NOT NULL AND pose_data <> '' THEN 1 ELSE 0 END" : "0"} AS has_pose_data,
             clip_blob
      FROM swing_clips
      WHERE hitter_id=?
      ORDER BY created_at DESC
    `).all(hid);

    const updateStmt = db.prepare("UPDATE swing_clips SET frame_count=?, fps=?, swing_seconds=? WHERE id=?");
    for (const row of rows) {
      let frameCount = Number(row.frame_count || 0);
      let fps = Number(row.fps || 0);
      let swingSeconds = Number(row.swing_seconds || 0);
      const badMetrics = !frameCount || frameCount <= 0 || !swingSeconds || swingSeconds <= 0 || !fps || fps <= 0;
      if (badMetrics && row.clip_blob) {
        const p = path.join(TMP_DIR, `gf_dash_${crypto.randomUUID()}.mp4`);
        await fsp.writeFile(p, row.clip_blob);
        const meta = ffprobeMeta(p);
        await fsp.unlink(p).catch(() => {});
        frameCount = meta.frameCount || frameCount;
        fps = meta.fps || fps || 30;
        swingSeconds = swingEventSeconds(frameCount, fps, 0) || 0;
        updateStmt.run(frameCount, fps, swingSeconds, Number(row.id));
      }

      let decisionSeconds = null;
      let decisionPct = null;
      if (fps > 0 && row.decision_frame != null) {
        decisionSeconds = Number(row.decision_frame) / fps;
        if (swingSeconds > 0) decisionPct = (decisionSeconds / swingSeconds) * 100;
      }

      const m = matchupBySwing[Number(row.id)] || { count: 0, latest_id: null };
      swingsView.push({
        id: Number(row.id),
        description: String(row.description || "").trim() || "(no description)",
        fps,
        decision_frame: row.decision_frame,
        decision_seconds: decisionSeconds,
        decision_pct: decisionPct,
        created_at: row.created_at,
        frame_count: frameCount,
        swing_seconds: swingSeconds,
        has_pose_data: Number(row.has_pose_data || 0),
        matchup_count: m.count,
        latest_matchup_id: m.latest_id,
      });
    }
  }
  const summary = buildSummary(swingsView);

  render(req, res, "dashboard_player.html", {
    sid: sidOf(req),
    teams,
    tid,
    pq,
    hitters,
    hid,
    selected_hitter: selectedHitter,
    results: swingsView,
    summary,
  });
});

app.get("/debug/routes", (req, res) => {
  const routes = app._router.stack
    .filter((l) => l.route)
    .map((l) => ({
      path: l.route.path,
      methods: Object.keys(l.route.methods).map((m) => m.toUpperCase()),
      module: "server.js",
    }));
  res.json(routes);
});

app.use((err, req, res, next) => {
  const message = err && err.message ? err.message : "internal error";
  console.error(message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: message });
});

const port = Number(process.env.PORT || 8000);
app.listen(port, () => {
  console.log(`GameFrameJS listening on http://localhost:${port}`);
});
