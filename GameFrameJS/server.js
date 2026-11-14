const express = require("express");
const path = require("path");
const os = require("os");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const { spawn, spawnSync, execFile } = require("child_process");
const multer = require("multer");
const nunjucks = require("nunjucks");
const Database = require("better-sqlite3");
const { measurePitch, savedPitchSpeed } = require('./pitch-speed');
const { createEvWorker } = require('./ev-worker');
const {
  installUsageAuth,
  authorizeDesktopMatchup,
  completeDesktopMatchup,
} = require("./usage-auth");

function createApplication(options = {}) {
const app = express();
const ROOT = __dirname;
const APP_VERSION = require("./package.json").version;
const DESKTOP_MODE = process.env.GAMEFRAME_DESKTOP === "1";
const EV_PREDICTOR_URL = '/ev';
const ballAssistTest = fs.existsSync(path.join(ROOT, 'experiments/ball-assist/app-integration.cjs'))
  ? require('./experiments/ball-assist/app-integration.cjs')
  : { available: () => false, install: () => {} };
const DB_PATH = options.databasePath ? path.resolve(options.databasePath) : process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(ROOT, "app.db");
const CONTACT_REVIEW_LOG = path.join(path.dirname(DB_PATH), "contact-review-history.jsonl");
const TMP_DIR = options.dataDirectory ? path.join(options.dataDirectory, "temporary") : os.tmpdir();
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const rawDatabase = new Database(DB_PATH);
const db = options.storageLimit ? require('./hosted/quota').databaseWithQuota(rawDatabase, options.dataDirectory, options.storageLimit) : rawDatabase;
const pitchSources = require('./pitch-source').createPitchSourceStore(db, path.join(path.dirname(DB_PATH), 'source-videos'));
const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: Math.max(100, Number(options.hostedWorkspace ? 250 : process.env.MAX_UPLOAD_MB || 4096)) * 1024 * 1024 },
});

if (options.hostedWorkspace) app.use((req, res, next) => {
  // The gateway owns identity, billing and administration. A workspace cannot
  // restore a database supplied by a customer or expose desktop admin APIs.
  if (/^\/(?:settings|debug|auth|api\/v1)(?:\/|$)/.test(req.path) ||
      /^\/(?:external_video|external|import\/youtube|api\/pitch-vision\/analyze|api\/pitch-release\/yolo|pitch-release-test)/.test(req.path)) return res.sendStatus(404);
  next();
});
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
env.addFilter("tojson", (v) => new nunjucks.runtime.SafeString(JSON.stringify(v ?? null)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')));
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

function validateTemporaryId(id) {
  if (options.hostedWorkspace && !/^[a-zA-Z0-9_-]{1,100}$/.test(String(id))) throw new Error("Invalid temporary video identifier");
}
function tempPath(id) {
  validateTemporaryId(id);
  return path.join(TMP_DIR, `gf_${id}.mp4`);
}

function sourceTempPath(id) {
  validateTemporaryId(id);
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

function normalizeImportUrl(raw) {
  const input = String(raw || "").trim();
  if (!input) return "";
  try {
    const u = new URL(input);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = (u.pathname || "/").split("/").filter(Boolean)[0] || "";
      if (id) return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const parts = (u.pathname || "/").split("/").filter(Boolean);
      if (parts[0] === "shorts" && parts[1]) {
        return `https://www.youtube.com/watch?v=${encodeURIComponent(parts[1])}`;
      }
    }
    return u.toString();
  } catch (_) {
    return input;
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
  const baseArgs = [
    "--no-playlist",
    "--no-warnings",
    // Use broad best-available formats; strict mp4-only selectors fail on some links.
    "--format", "bv*+ba/b",
    "--merge-output-format", "mp4",
    "-o", outputPath,
  ];
  const host = (() => {
    try {
      return new URL(String(url || "")).hostname.toLowerCase();
    } catch (_) {
      return "";
    }
  })();
  const isYouTube = host.includes("youtube.com") || host.includes("youtu.be");
  const attempts = [];

  if (isYouTube) {
    attempts.push({
      label: "android",
      args: [...baseArgs, "--extractor-args", "youtube:player_client=android", url],
    });

    const cookieFileCandidates = [];
    if (process.env.YTDLP_COOKIES_FILE) {
      cookieFileCandidates.push(String(process.env.YTDLP_COOKIES_FILE));
    }
    cookieFileCandidates.push(
      path.join(ROOT, "youtube_cookies.txt"),
      path.join(ROOT, "cookies.txt")
    );
    for (const cookieFile of cookieFileCandidates) {
      if (!cookieFile || !fs.existsSync(cookieFile)) continue;
      attempts.push({
        label: `android+cookies-file:${cookieFile}`,
        args: [...baseArgs, "--extractor-args", "youtube:player_client=android", "--cookies", cookieFile, url],
      });
    }

    const browserCandidates = [];
    if (process.env.YTDLP_COOKIES_FROM_BROWSER) {
      browserCandidates.push(String(process.env.YTDLP_COOKIES_FROM_BROWSER));
    }
    browserCandidates.push("edge", "chrome", "firefox");
    for (const browser of browserCandidates) {
      attempts.push({
        label: `android+cookies-from-browser:${browser}`,
        args: [...baseArgs, "--extractor-args", "youtube:player_client=android", "--cookies-from-browser", browser, url],
      });
    }
  }

  attempts.push({ label: "plain", args: [...baseArgs, url] });

  const failures = [];
  for (const attempt of attempts) {
    const result = spawnSync(ytdlpBin, attempt.args, {
      encoding: null,
      maxBuffer: 50 * 1024 * 1024,
    });
    if (result.status === 0) return;
    failures.push({
      label: attempt.label,
      stderr: (result.stderr || Buffer.from("")).toString("utf8").trim(),
    });
  }

  const last = failures[failures.length - 1];
  const lastErr = last && last.stderr ? last.stderr : "unknown yt-dlp error";
  if (isYouTube) {
    throw new Error(
      `yt-dlp failed after browser-cookie retries. ` +
      `Try either signing into YouTube in Edge or Chrome on this machine, or place an exported cookies file at ` +
      `youtube_cookies.txt in the app folder. ` +
      `Last error: ${lastErr}`
    );
  }
  throw new Error(`yt-dlp failed: ${lastErr}`);
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
  const executable = cmd === "ffmpeg"
    ? (process.env.FFMPEG_PATH || cmd)
    : cmd === "ffprobe"
      ? (process.env.FFPROBE_PATH || cmd)
      : cmd;
  const result = spawnSync(executable, args, {
    encoding: null,
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
  if (result.error) {
    throw new Error(`${cmd} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const err = (result.stderr || Buffer.from("")).toString("utf8");
    throw new Error(`${cmd} failed (${result.status}): ${err}`);
  }
  return result;
}

function ffprobeMeta(filePath, settings) {
  const metadata = uncheckedFfprobeMeta(filePath, settings);
  if (typeof options !== 'undefined' && options.hostedWorkspace && metadata.duration > 300) throw Object.assign(new Error('Videos must be 5 minutes or shorter.'), { status: 413 });
  return metadata;
}

function uncheckedFfprobeMeta(filePath, { countFrames = true, requireExactFrameCount = false } = {}) {
  try {
    const r = runCmd("ffprobe", [
      "-v", "error",
      ...(countFrames ? ["-count_frames"] : []),
      "-select_streams", "v:0",
      "-show_entries", "stream=nb_read_frames,nb_frames,avg_frame_rate,r_frame_rate,duration:stream_tags=creation_time",
      "-show_entries", "format=duration:format_tags=creation_time",
      "-of", "json",
      filePath,
    ]);
    const j = JSON.parse((r.stdout || Buffer.from("")).toString("utf8") || "{}");
    const stream = (j.streams && j.streams[0]) || {};
    const fmt = j.format || {};
    const fps = parseFraction(stream.avg_frame_rate) || parseFraction(stream.r_frame_rate);
    let frameCount = Number(stream.nb_read_frames || stream.nb_frames || 0);
    if (!countFrames && requireExactFrameCount && (!Number.isFinite(frameCount) || frameCount <= 0)) {
      return ffprobeMeta(filePath, { countFrames: true });
    }
    const duration = Number(stream.duration || fmt.duration || 0);
    const creationTime = normalizedVideoDate(
      (stream.tags && stream.tags.creation_time) || (fmt.tags && fmt.tags.creation_time)
    );
    if ((!Number.isFinite(frameCount) || frameCount <= 0) && fps > 0 && duration > 0) {
      frameCount = Math.round(fps * duration);
    }
    return {
      fps: Number.isFinite(fps) && fps > 0 ? fps : 0,
      frameCount: Number.isFinite(frameCount) && frameCount > 0 ? frameCount : 0,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      creationTime,
    };
  } catch (_) {
    return { fps: 0, frameCount: 0, duration: 0, creationTime: null };
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

function poseFpsFromRows(rows) {
  if (!rows || !rows.length) return null;
  for (const r of rows) {
    const v = Number(r.fps);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
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

function hasTable(table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
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
      contact_frame INTEGER,
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
      is_best INTEGER NOT NULL DEFAULT 0,
      swing_type TEXT,
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
      collage_blob BLOB,
      created_at TIMESTAMP,
      FOREIGN KEY (pitch_clip_id) REFERENCES pitch_clips(id),
      FOREIGN KEY (swing_clip_id) REFERENCES swing_clips(id)
    );

    CREATE TABLE IF NOT EXISTS pending_swing_clips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      team_id INTEGER,
      hitter_id INTEGER,
      description TEXT,
      swing_type TEXT,
      clip_blob BLOB NOT NULL,
      fps REAL NOT NULL,
      contact_frame INTEGER NOT NULL,
      source_contact_seconds REAL,
      video_created_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      swing_clip_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pending_pitch_clips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      team_id INTEGER,
      pitcher_id INTEGER,
      description TEXT,
      clip_blob BLOB NOT NULL,
      fps REAL NOT NULL,
      contact_frame INTEGER NOT NULL,
      source_contact_seconds REAL,
      video_created_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      pitch_clip_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    );
  `);
}

function ensureSchemaCompatibility() {
  ensureBaseSchema();
  ensureColumn("pitch_clips", "thumb", "BLOB");
  ensureColumn("pitch_clips", "contact_frame", "INTEGER");
  for (const column of ['release_frame','release_extension','contact_adjustment','mound_distance','initial_mph','average_mph','speed_fps']) ensureColumn('pitch_clips',column,'REAL');
  ensureColumn('matchups','pitch_speed_json','TEXT');
  ensureColumn('pitch_clips','speed_export_blob','BLOB');
  ensureColumn('pitch_clips','speed_export_key','TEXT');
  ensureColumn("pitch_clips", "video_created_at", "TEXT");
  ensureColumn("pitch_clips", "source_video_id", "TEXT");
  ensureColumn("pending_pitch_clips", "source_video_id", "TEXT");
  ensureColumn("swing_clips", "thumb", "BLOB");
  ensureColumn("swing_clips", "pose_data", "TEXT");
  ensureColumn("swing_clips", "frame_count", "INTEGER");
  ensureColumn("swing_clips", "swing_seconds", "REAL");
  ensureColumn("swing_clips", "library_clip_blob", "BLOB");
  ensureColumn("swing_clips", "pose_quality_score", "REAL");
  ensureColumn("swing_clips", "pose_quality_status", "TEXT");
  ensureColumn("swing_clips", "camera_view", "TEXT");
  ensureColumn("swing_clips", "is_best", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("swing_clips", "video_created_at", "TEXT");
  ensureColumn("swing_clips", "swing_type", "TEXT");
  ensureColumn("matchups", "collage_blob", "BLOB");
  ensureColumn("pending_swing_clips", "thumb", "BLOB");
  ensureColumn("pending_swing_clips", "swing_type", "TEXT");
  ensureColumn("pending_pitch_clips", "thumb", "BLOB");
  // Completed bulk items already live in the permanent libraries. Keeping a
  // second video blob serves no purpose and makes the pending screens noisy.
  db.prepare("DELETE FROM pending_swing_clips WHERE status='completed'").run();
  db.prepare("DELETE FROM pending_pitch_clips WHERE status='completed'").run();
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function saveContactReview({ kind, batchId, sourceName, fps, duration, suggested, approved }) {
  const clean = (values) => (Array.isArray(values) ? values : [])
    .map(Number).filter((v) => Number.isFinite(v) && v >= 0 && v <= duration).slice(0, 100)
    .map((seconds) => ({ seconds, frame: Math.round(seconds * fps) }));
  const record = {
    recorded_at: new Date().toISOString(), kind, batch_id: batchId,
    source_name: path.basename(String(sourceName || "unknown-video")).slice(0, 240),
    fps, duration_seconds: duration,
    suggested: clean(suggested), approved: clean(approved),
  };
  await fsp.appendFile(CONTACT_REVIEW_LOG, `${JSON.stringify(record)}\n`, "utf8");
}

function analyzeSwingContactAudio(filePath, duration, fps) {
  const rate = 12000;
  const audio = runCmd("ffmpeg", ["-v", "error", "-i", filePath, "-vn", "-ac", "1", "-ar", String(rate), "-f", "f32le", "pipe:1"],
    { maxBuffer: 192 * 1024 * 1024 });
  const raw = audio.stdout || Buffer.alloc(0);
  if (raw.length < 8) return [];
  const samples = new Float32Array(Math.floor(raw.length / 4));
  for (let i = 0; i < samples.length; i += 1) samples[i] = raw.readFloatLE(i * 4);
  const hop = 60;
  const points = [];
  for (let start = hop; start + hop < samples.length; start += hop) {
    let energy = 0;
    for (let i = start; i < start + hop; i += 1) energy += Math.abs(samples[i] - samples[i - 1]);
    points.push({ index: points.length, time: start / rate, score: energy / hop });
  }
  if (!points.length) return [];
  const scores = points.map((p) => p.score);
  const floor = median(scores);
  const mad = median(scores.map((v) => Math.abs(v - floor))) || 0.000001;
  const ranked = points.filter((p, i) => p.time >= 0.4 && p.time <= duration - 0.2 &&
    p.score >= floor + mad * 8 && p.score >= (points[i - 1]?.score || 0) && p.score >= (points[i + 1]?.score || 0))
    .sort((a, b) => b.score - a.score);
  const selected = [];
  for (const peak of ranked) {
    if (selected.some((p) => Math.abs(p.time - peak.time) < 1.2)) continue;
    const baselineStart = Math.max(0, peak.index - Math.round(0.65 / (hop / rate)));
    const baselineEnd = Math.max(baselineStart + 1, peak.index - Math.round(0.15 / (hop / rate)));
    const baseline = points.slice(baselineStart, baselineEnd).map((p) => p.score);
    const localFloor = median(baseline);
    const localMad = Math.max(0.000001, median(baseline.map((v) => Math.abs(v - localFloor))));
    const threshold = Math.min(localFloor + Math.max(localMad * 7, (peak.score - localFloor) * 0.12), localFloor + (peak.score - localFloor) * 0.35);
    let onsetIndex = peak.index;
    const searchStart = Math.max(0, peak.index - Math.round(0.20 / (hop / rate)));
    for (let i = peak.index; i >= searchStart; i -= 1) {
      const prior = points.slice(Math.max(searchStart, i - 2), i + 1);
      if (prior.length && prior.every((p) => p.score < threshold)) { onsetIndex = Math.min(peak.index, i + 1); break; }
    }
    const time = points[onsetIndex].time;
    selected.push({ time, peakTime: peak.time, frame: Math.round(time * fps), confidence: peak.score / Math.max(floor + mad, 0.000001) });
    if (selected.length >= 40) break;
  }
  if (!selected.length) return [];

  // Audio identifies a small search window, but it does not determine contact:
  // the recorded crack arrives after visible impact and unrelated noises can be louder.
  // Confirm sustained, localized video motion and choose the visual event inside that window.
  const analysisFps = Math.min(30, Math.max(12, fps));
  const width = 64;
  const height = 36;
  const pixels = width * height;
  let visual;
  try {
    visual = runCmd("ffmpeg", ["-v", "error", "-i", filePath, "-an", "-vf",
      `fps=${analysisFps},scale=${width}:${height}:flags=area,format=gray`, "-f", "rawvideo", "pipe:1"],
      { maxBuffer: 384 * 1024 * 1024 }).stdout || Buffer.alloc(0);
  } catch (_) {
    return [];
  }
  const frameCount = Math.floor(visual.length / pixels);
  if (frameCount < 3) return [];
  const motion = new Array(frameCount).fill(0);
  const active = new Array(frameCount).fill(0);
  for (let fi = 1; fi < frameCount; fi += 1) {
    const a = (fi - 1) * pixels;
    const b = fi * pixels;
    let localized = 0;
    let changed = 0;
    for (let p = 0; p < pixels; p += 1) {
      const d = Math.abs(visual[b + p] - visual[a + p]);
      if (d >= 10) { localized += d - 9; changed += 1; }
    }
    motion[fi] = localized / pixels;
    active[fi] = changed / pixels;
  }
  const at = (seconds) => Math.max(1, Math.min(frameCount - 1, Math.round(seconds * analysisFps)));
  const range = (from, to) => motion.slice(at(from), Math.max(at(from) + 1, at(to) + 1));
  const visuallyConfirmed = [];
  for (const candidate of selected) {
    const peakTime = candidate.peakTime;
    const baselineValues = range(Math.max(0, peakTime - 1.0), Math.max(0, peakTime - 0.45));
    const actionValues = range(Math.max(0, peakTime - 0.38), Math.min(duration, peakTime + 0.08));
    const baseline = median(baselineValues);
    const baselineMad = median(baselineValues.map((v) => Math.abs(v - baseline))) || 0.01;
    const actionMedian = median(actionValues);
    const actionMax = Math.max(...actionValues, 0);
    const startFrame = at(Math.max(0, peakTime - 0.30));
    // Visible contact cannot be inferred from a frame after the recorded crack.
    // Search only at/before that sound and report the measured A/V lag.
    const endFrame = at(Math.min(duration, peakTime));
    let bestFrame = startFrame;
    let bestScore = -Infinity;
    let isCut = false;
    for (let fi = startFrame; fi <= endFrame; fi += 1) {
      if (active[fi] > 0.72) isCut = true;
      const localRise = motion[fi] - median(motion.slice(Math.max(1, fi - 3), fi));
      const beforeSound = fi / analysisFps <= peakTime ? 1.08 : 0.82;
      const score = (motion[fi] + Math.max(0, localRise) * 0.65) * beforeSound;
      if (score > bestScore) { bestScore = score; bestFrame = fi; }
    }
    const sustainedMotion = actionMedian >= baseline + Math.max(baselineMad * 1.6, 0.08);
    const strongMotion = actionMax >= baseline + Math.max(baselineMad * 3.2, 0.22);
    const unmistakableLocalizedBurst = actionMax >= baseline + Math.max(baselineMad * 5, 0.5);
    if (isCut || !strongMotion || (!sustainedMotion && !unmistakableLocalizedBurst)) continue;
    // The largest frame difference is commonly one or two follow-through frames
    // after the bat has crossed the ball. Within this candidate's own motion
    // burst, prefer the earliest local peak that is nearly as strong as the
    // maximum. This adapts to each clip instead of applying a fixed frame shift.
    const nearPeakFloor = motion[bestFrame] * 0.82;
    const earliestFrame = Math.max(startFrame, bestFrame - Math.round(0.13 * analysisFps));
    for (let fi = earliestFrame; fi <= bestFrame; fi += 1) {
      const previous = motion[Math.max(1, fi - 1)];
      const next = motion[Math.min(frameCount - 1, fi + 1)];
      if (motion[fi] >= nearPeakFloor && motion[fi] >= previous && motion[fi] >= next) {
        bestFrame = fi;
        break;
      }
    }
    const visualTime = bestFrame / analysisFps;
    visuallyConfirmed.push({
      time: visualTime,
      frame: Math.round(visualTime * fps),
      audio_lag_ms: Math.max(0, Math.round((peakTime - visualTime) * 1000)),
      confidence: candidate.confidence * Math.max(1, actionMax / Math.max(0.05, baseline + baselineMad)),
    });
  }
  // One swing can produce several later noises (ball, fence, voices). Keep only
  // the strongest visually confirmed event within the same short play window.
  const distinct = [];
  for (const candidate of [...visuallyConfirmed].sort((a, b) => b.confidence - a.confidence)) {
    if (distinct.some((kept) => Math.abs(kept.time - candidate.time) < 3)) continue;
    distinct.push(candidate);
  }
  return distinct.sort((a, b) => a.time - b.time);
}

function analyzeEvStyleContactAudio(filePath, duration, fps) {
  const rate = 44100;
  let audio;
  try {
    audio = runCmd("ffmpeg", ["-v", "error", "-i", filePath, "-vn", "-ac", "1", "-ar", String(rate), "-f", "f32le", "pipe:1"],
      { maxBuffer: 192 * 1024 * 1024 });
  } catch (error) {
    if (/does not contain any stream|matches no streams/i.test(error.message)) return null;
    throw error;
  }
  const raw = audio.stdout || Buffer.alloc(0);
  if (raw.length < 8) return null;
  const samples = new Float32Array(Math.floor(raw.length / 4));
  for (let i = 0; i < samples.length; i += 1) samples[i] = raw.readFloatLE(i * 4);
  const windowSize = Math.max(64, Math.round((rate * 8) / 1000));
  const hop = Math.max(16, Math.round(windowSize / 4));
  const rows = [];
  let prevRms = 0.000001;
  for (let start = 0; start + windowSize < samples.length; start += hop) {
    let sumSq = 0;
    let peak = 0;
    let crack = 0;
    for (let i = start; i < start + windowSize; i += 1) {
      const sample = samples[i];
      const abs = Math.abs(sample);
      sumSq += sample * sample;
      if (abs > peak) peak = abs;
      if (i > start) {
        const delta = Math.abs(samples[i] - samples[i - 1]);
        if (delta > crack) crack = delta;
      }
    }
    const rms = Math.sqrt(sumSq / windowSize);
    const rise = rms / Math.max(prevRms, 0.000001);
    rows.push({
      time: start / rate,
      peak,
      crack,
      rms,
      score: peak * 1.4 + crack * 2.2 + Math.min(rise, 8) * 0.08,
    });
    prevRms = Math.max(rms, 0.000001);
  }
  if (!rows.length) return null;
  const scores = rows.map((row) => row.score);
  const base = median(scores);
  const mad = median(scores.map((score) => Math.abs(score - base))) || 0.000001;
  const robustScale = 1.4826 * mad;
  const loudest = rows.reduce((winner, row) => (row.score > winner.score ? row : winner), rows[0]);
  const loudThreshold = Math.max(base + 3 * robustScale, loudest.score * 0.35);
  const best = rows.find((row) => row.time >= 0.15 && row.time <= Math.max(0.15, duration - 0.05) && row.score >= loudThreshold) || loudest;
  const robustZ = (best.score - base) / robustScale;
  const contactTime = Math.max(0, Math.min(duration, best.time - (fps > 0 ? 1 / fps : 0)));
  return {
    time: contactTime,
    frame: Math.round(contactTime * fps),
    confidence: robustZ >= 12 ? "HIGH" : robustZ >= 7 ? "MEDIUM" : "LOW",
    robust_z: robustZ,
  };
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

function wrapTitleLines(text, maxChars = 34, maxLines = 3) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : ["Matchup Summary"];
}

function matchupFontFile() {
  const custom = process.env.GAMEFRAME_FONT_FILE;
  if (custom && fs.existsSync(custom)) return custom;
  const win = process.env.WINDIR || "C:\\Windows";
  const arial = path.join(win, "Fonts", "arial.ttf");
  return fs.existsSync(arial) ? arial : "";
}

function savedSwingEv(swingId) {
  if (!hasTable('ev_swing_links') || !hasTable('ev_hit_tracks')) return null;
  if (!db.prepare('PRAGMA table_info(ev_swing_links)').all().some(c => c.name === 'ev_hit_id')) return null;
  const row = db.prepare(`SELECT e.best_exit_velocity_mph AS mph FROM ev_swing_links l
    JOIN ev_hit_tracks e ON e.id=l.ev_hit_id WHERE l.swing_clip_id=? ORDER BY e.id DESC LIMIT 1`).get(swingId);
  return row?.mph > 0 && Number.isFinite(Number(row.mph)) ? Number(row.mph) : null;
}

const {buildMatchupVideoServerSide,buildMatchupVideoAsync}=require('./matchup-renderer');

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
    embedded: String(req.query?.embedded || "") === "1",
    ev_predictor_url: EV_PREDICTOR_URL,
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

function buildMetricSummary(swings, valueOf) {
  const vals = swings.map(valueOf).map(Number).filter((v) => Number.isFinite(v) && v > 0);
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

function normalizedVideoDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function uploadedFiles(req) {
  if (req.file) return [req.file];
  if (!req.files) return [];
  return Object.values(req.files).flat().filter(Boolean);
}

function requireProcessingSpace(req, res, next) {
  if (options.hostedWorkspace) {
    try {
      for (const file of uploadedFiles(req)) {
        const metadata = ffprobeMeta(file.path, { countFrames: false });
        if (!(metadata.duration > 0) || !(metadata.fps > 0)) throw new Error('Upload a readable video of 5 minutes or less.');
      }
      if (options.storageLimit && require('./hosted/store').diskBytes(options.dataDirectory) > options.storageLimit()) throw new Error('Storage allowance reached. Delete footage to free space.');
    } catch (error) {
      for (const file of uploadedFiles(req)) { try { fs.unlinkSync(file.path); } catch (_) {} }
      return res.status(413).json({ error: error.message });
    }
  }
  try {
    if (typeof fs.statfsSync !== "function") return next();
    const files = uploadedFiles(req);
    const inputBytes = files.reduce((total, file) => total + Number(file.size || 0), 0);
    const stats = fs.statfsSync(TMP_DIR);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const requiredBytes = Math.max(512 * 1024 * 1024, inputBytes * 3);
    if (freeBytes >= requiredBytes) return next();
    files.forEach((file) => { try { fs.unlinkSync(file.path); } catch (_) {} });
    return res.status(507).json({
      error: `Not enough free disk space to process this video. Free at least ${Math.ceil(requiredBytes / 1073741824)} GB and try again.`,
      code: "INSUFFICIENT_STORAGE",
    });
  } catch (_) {
    return next();
  }
}

function parsePortraitCrop(raw, required = false) {
  let crop = null;
  try {
    crop = typeof raw === "string" && raw.trim() ? JSON.parse(raw) : raw;
  } catch (_) {
    crop = null;
  }
  if (!crop || !crop.enabled) {
    if (!required) return null;
    crop = { enabled: true, x: 0.235, y: 0.03, h: 0.94 };
  }
  const aspect = 9 / 16;
  let h = Number(crop.h);
  let w = Number(crop.w);
  if (!Number.isFinite(h) || h <= 0) h = 0.94;
  if (!Number.isFinite(w) || w <= 0) w = h * aspect;
  h = Math.max(0.35, Math.min(1, h));
  w = Math.max(0.01, Math.min(1, w));
  let x = Number(crop.x);
  let y = Number(crop.y);
  if (!Number.isFinite(x)) x = 0.5 - w / 2;
  if (!Number.isFinite(y)) y = 0.5 - h / 2;
  x = Math.max(0, Math.min(1 - w, x));
  y = Math.max(0, Math.min(1 - h, y));
  return { x, y, w, h };
}

function buildTrimFilter({ start, endFrame, crop }) {
  const filters = [`trim=start_frame=${start}:end_frame=${endFrame + 1}`, "setpts=PTS-STARTPTS"];
  if (crop) {
    filters.push(
      `crop=w='trunc(iw*${crop.w}/2)*2':h='trunc(ih*${crop.h}/2)*2':x='trunc(iw*${crop.x}/2)*2':y='trunc(ih*${crop.y}/2)*2'`,
      "scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2",
      "setsar=1"
    );
  }
  return filters.join(",");
}

function buildSummary(swings) {
  return buildMetricSummary(swings, (s) => s.swing_seconds);
}

function buildDecisionSummary(swings) {
  return buildMetricSummary(swings, (s) => s.commitment_to_contact_seconds);
}

function buildSummaryNarrative(summary, decisionSummary, referenceSwing) {
  if (!summary) return "";
  if (summary.count < 2) return "One uploaded swing is available. Add another to compare timing variation; at least five tagged swings are needed to show a decision-to-contact trend.";
  const consistencyBand = `varies by ${Number(summary.stddev || 0).toFixed(3)} seconds (standard deviation)`;
  let referenceBand = "Choose a reference swing to compare timing intervals.";
  if (referenceSwing && Number(referenceSwing.swing_seconds) > 0) {
    const delta = summary.median - Number(referenceSwing.swing_seconds);
    referenceBand = Math.abs(delta) < 0.015
      ? "The typical start-to-contact interval is similar to the reference swing."
      : `The typical start-to-contact interval is ${Math.abs(delta).toFixed(3)} seconds ${delta < 0 ? "shorter" : "longer"} than the reference swing.`;
  }
  let decisionBand = "Add more swings with decision markers to track the committed swing.";
  if (decisionSummary) {
    decisionBand = decisionSummary.trend_status === "insufficient"
      ? `Decision to contact has ${decisionSummary.count} measured swings; at least 5 are needed before showing a trend.`
      : decisionSummary.trend_status === "shorter"
      ? "Decision to contact is getting shorter in these uploaded swings; this is a timing change, not a performance grade."
      : decisionSummary.trend_status === "longer"
        ? "Decision to contact is getting longer."
        : "There is no clear decision-to-contact change beyond the video's measurement resolution.";
  }
  const outlierBand = summary.outlier_count === 0
    ? "There are no major outlier swings in this set."
    : summary.outlier_count === 1
      ? "There is 1 swing that stands out from the player's usual timing."
      : `There are ${summary.outlier_count} swings that stand out from the player's usual timing.`;
  return `Across ${summary.count} uploaded swings, start-to-contact timing ${consistencyBand}. ${referenceBand} ${decisionBand} ${outlierBand}`;
}

ensureSchemaCompatibility();
if (!options.hostedWorkspace) installUsageAuth(app, db);
app.post('/api/source', upload.single('file'), requireProcessingSpace, (req, res) => {
  if (!options.hostedWorkspace || !req.file) return res.sendStatus(404);
  res.json({ source_path: req.file.path, file_name: req.file.originalname });
});
const evWorker = createEvWorker({ root: ROOT, databasePath: DB_PATH, dataDirectory: options.dataDirectory, storageLimit: options.storageLimit });
app.use(['/api/predict', '/api/track', '/api/landmarks', '/api/clip', '/api/gameframe'], evWorker.handle);
app.get(['/ev', '/ev/', '/ev/index.html', '/index.html'], (req, res) => res.redirect('/'));
app.get('/predictor.html', (req, res) => res.redirect(`/ev/predictor.html${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`));
app.use('/ev', (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  if (!['/predictor.html', '/app.js', '/styles.css'].includes(req.path) && !req.path.startsWith('/assets/')) return res.sendStatus(404);
  next();
}, express.static(path.join(ROOT, 'ev-predictor')));
app.use('/comparison_output/live', express.static(options.dataDirectory ? path.join(options.dataDirectory, 'ev', 'live') : path.join(ROOT, 'ev-predictor', 'comparison_output', 'live')));
backfillSwingClipMetrics();

app.get("/manifest.json", (req, res) => {
  res.type("application/manifest+json").sendFile(path.join(ROOT, "static", "manifest.json"));
});

app.get("/service-worker.js", (req, res) => {
  res.type("application/javascript").sendFile(path.join(ROOT, "static", "service-worker.js"));
});

app.get("/", (req, res) => render(req, res, "index.html", { sid: sidOf(req) }));
app.get("/privacy", (req, res) => render(req, res, "privacy.html", { sid: sidOf(req) }));
app.get("/terms", (req, res) => render(req, res, "terms.html", { sid: sidOf(req) }));
app.get("/health", (req, res) => {
  let databaseOk = false;
  try { databaseOk = db.prepare("SELECT 1 AS ok").get().ok === 1; } catch (_) {}
  const productionConfigReady = !!(process.env.AUTH_CODE_SECRET && process.env.RESEND_API_KEY && process.env.AUTH_FROM_EMAIL && process.env.ADMIN_API_KEY && process.env.AUTH_ALLOW_DEV_CODE !== "true");
  res.status(databaseOk ? 200 : 503).json({
    ok: databaseOk,
    version: APP_VERSION,
    mode: DESKTOP_MODE ? "desktop" : "hosted",
    email_configured: !!(process.env.RESEND_API_KEY && process.env.AUTH_FROM_EMAIL),
    authentication_configured: !!process.env.AUTH_CODE_SECRET,
    production_ready: productionConfigReady,
    download_url: String(process.env.DESKTOP_DOWNLOAD_URL || ""),
  });
});

app.get("/settings/data", (req, res) => {
  if (!DESKTOP_MODE) return res.status(404).send("Not available.");
  let databaseBytes = 0;
  try { databaseBytes = fs.statSync(DB_PATH).size; } catch (_) {}
  const automaticBackupDirectory = path.join(path.dirname(DB_PATH), "backups");
  let automaticBackups = [];
  try {
    automaticBackups = fs.readdirSync(automaticBackupDirectory)
      .filter((name) => /^GameFrame-auto-\d{4}-\d{2}-\d{2}\.db$/.test(name))
      .sort().reverse().map((name) => ({ name, bytes: fs.statSync(path.join(automaticBackupDirectory, name)).size }));
  } catch (_) {}
  render(req, res, "data_settings.html", {
    sid: sidOf(req),
    database_bytes: databaseBytes,
    message: String(req.query.message || ""),
    error: String(req.query.error || ""),
    automatic_backups: automaticBackups,
  });
});

app.get("/settings/data/automatic", (req, res) => {
  if (!DESKTOP_MODE) return res.status(404).send("Not available.");
  const name = String(req.query.name || "");
  if (!/^GameFrame-auto-\d{4}-\d{2}-\d{2}\.db$/.test(name)) return res.status(400).send("Invalid backup name.");
  const backupPath = path.resolve(path.dirname(DB_PATH), "backups", name);
  const expectedDirectory = path.resolve(path.dirname(DB_PATH), "backups") + path.sep;
  if (!backupPath.startsWith(expectedDirectory)) return res.status(400).send("Invalid backup path.");
  res.download(backupPath, name);
});

app.get("/settings/data/backup", async (req, res, next) => {
  if (!DESKTOP_MODE) return res.status(404).send("Not available.");
  const backupPath = path.join(TMP_DIR, `GameFrame-backup-${Date.now()}.db`);
  try {
    await db.backup(backupPath);
    res.download(backupPath, `GameFrame-backup-${new Date().toISOString().slice(0, 10)}.db`, () => {
      fsp.unlink(backupPath).catch(() => {});
    });
  } catch (error) {
    await fsp.unlink(backupPath).catch(() => {});
    next(error);
  }
});

app.post("/settings/data/restore", upload.single("backup"), async (req, res) => {
  if (!DESKTOP_MODE) return res.status(404).send("Not available.");
  if (!req.file) return res.redirect(303, "/settings/data?error=Choose+a+GameFrame+backup+file.");
  const restorePath = req.file.path;
  const coreTables = ["teams", "pitchers", "hitters", "pitch_clips", "swing_clips", "matchups"];
  let source = null;
  try {
    source = new Database(restorePath, { readonly: true, fileMustExist: true });
    const integrity = source.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error("The selected database did not pass its integrity check.");
    const sourceTables = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    if (!coreTables.every((table) => sourceTables.has(table))) throw new Error("This is not a complete GameFrame backup.");
    source.close(); source = null;

    db.prepare("ATTACH DATABASE ? AS restore_source").run(restorePath);
    try {
      const restore = db.transaction(() => {
        for (const table of [...coreTables].reverse()) db.prepare(`DELETE FROM ${table}`).run();
        for (const table of coreTables) {
          const currentColumns = db.prepare(`PRAGMA main.table_info(${table})`).all().map((c) => c.name);
          const backupColumns = new Set(db.prepare(`PRAGMA restore_source.table_info(${table})`).all().map((c) => c.name));
          const shared = currentColumns.filter((name) => backupColumns.has(name) && safeIdent(name));
          if (!shared.length) throw new Error(`Backup table ${table} has no compatible fields.`);
          const columns = shared.join(", ");
          db.prepare(`INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM restore_source.${table}`).run();
        }
      });
      restore();
    } finally {
      db.prepare("DETACH DATABASE restore_source").run();
    }
    res.redirect(303, "/settings/data?message=Backup+restored+successfully.");
  } catch (error) {
    if (source) source.close();
    res.redirect(303, `/settings/data?error=${encodeURIComponent(error.message || "Restore failed.")}`);
  } finally {
    await fsp.unlink(restorePath).catch(() => {});
  }
});
app.get("/external_video", (req, res) => render(req, res, "external_video.html", { sid: sidOf(req) }));
app.get("/logout", (req, res) => res.redirect(302, `/?sid=${encodeURIComponent(sidOf(req))}`));

app.post("/external_video/fetch", async (req, res) => {
  const sid = sidOf(req);
  const rawVideoUrl = String(req.body.video_url || "").trim();
  const videoUrl = normalizeImportUrl(rawVideoUrl);
  const clipType = importKind(String(req.body.clip_type || "swing").trim());

  if (String(req.body.rights_confirmed || "") !== "1") {
    return render(req, res, "external_video.html", {
      sid,
      error: "Confirm that you are authorized to download and process this video.",
      video_url: rawVideoUrl,
      clip_type: clipType,
    });
  }

  if (!isSupportedImportUrl(videoUrl)) {
    return render(req, res, "external_video.html", {
      sid,
      error: "Paste a valid YouTube, X/Twitter, Instagram, or TikTok link.",
      video_url: rawVideoUrl,
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
      video_url: videoUrl,
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
      video_url: rawVideoUrl,
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

function recordReturn(req, kind, error) {
  const query = new URLSearchParams({sid:sidOf(req)});
  if (String(req.body.embedded || req.query.embedded || '') === '1') query.set('embedded','1');
  if (error) query.set('error',error);
  return `/${kind}?${query}`;
}

app.post(/^\/(teams|hitters|pitchers)\/(add|edit|delete)$/, (req,res,next) => {
  const [kind, action] = [req.params[0],req.params[1]];
  const fail = error => res.redirect(303,recordReturn(req,kind,error));
  if (action !== 'add' && !db.prepare(`SELECT id FROM ${kind} WHERE id=?`).get(Number(req.body.item_id))) return fail('missing');
  if (action !== 'delete') {
    req.body.name = String(req.body.name || '').trim();
    if (!req.body.name) return fail('name');
    if (kind !== 'teams' && !db.prepare('SELECT id FROM teams WHERE id=?').get(Number(req.body.team_id))) return fail('team');
  } else {
    const references = kind === 'teams' ? ['hitters','pitchers','pitch_clips','swing_clips','pending_swing_clips','ev_hit_tracks']
      : kind === 'hitters' ? ['swing_clips','pending_swing_clips','ev_hit_tracks'] : ['pitch_clips'];
    const column = kind === 'teams' ? 'team_id' : kind === 'hitters' ? 'hitter_id' : 'pitcher_id';
    if (references.some(table => hasTable(table) && hasColumn(table,column)
      && db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`).get(Number(req.body.item_id)))) return fail('in_use');
  }
  next();
});

app.get("/teams", (req, res) => {
  const items = db.prepare("SELECT id, name, description FROM teams ORDER BY name").all();
  render(req, res, "manage_entities.html", { sid: sidOf(req), view: "teams", items });
});

app.post("/teams/add", (req, res) => {
  db.prepare("INSERT INTO teams (name, description) VALUES (?, ?)").run(req.body.name, req.body.description || "");
  res.redirect(303, recordReturn(req,'teams'));
});

app.post("/teams/delete", (req, res) => {
  db.prepare("DELETE FROM teams WHERE id=?").run(Number(req.body.item_id));
  res.redirect(303, recordReturn(req,'teams'));
});

app.post("/teams/edit", (req, res) => {
  db.prepare("UPDATE teams SET name=?, description=? WHERE id=?").run(
    req.body.name,
    req.body.description || "",
    Number(req.body.item_id)
  );
  res.redirect(303, recordReturn(req,'teams'));
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
  res.redirect(303, recordReturn(req,'hitters'));
});

app.post("/hitters/edit", (req, res) => {
  db.prepare("UPDATE hitters SET team_id=?, name=?, description=? WHERE id=?").run(
    Number(req.body.team_id),
    req.body.name,
    req.body.description || "",
    Number(req.body.item_id)
  );
  res.redirect(303, recordReturn(req,'hitters'));
});

app.post("/hitters/delete", (req, res) => {
  db.prepare("DELETE FROM hitters WHERE id=?").run(Number(req.body.item_id));
  res.redirect(303, recordReturn(req,'hitters'));
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
  res.redirect(303, recordReturn(req,'pitchers'));
});

app.post("/pitchers/edit", (req, res) => {
  db.prepare("UPDATE pitchers SET team_id=?, name=?, description=? WHERE id=?").run(
    Number(req.body.team_id),
    req.body.name,
    req.body.description || "",
    Number(req.body.item_id)
  );
  res.redirect(303, recordReturn(req,'pitchers'));
});

app.post("/pitchers/delete", (req, res) => {
  db.prepare("DELETE FROM pitchers WHERE id=?").run(Number(req.body.item_id));
  res.redirect(303, recordReturn(req,'pitchers'));
});

app.get("/library", (req, res) => {
  render(req, res, "library.html", {
    sid: sidOf(req),
    type: (req.query.type || "matchup").toString(),
  });
});

app.get('/library/ev/report', (req, res) => {
  if (!hasTable('ev_hit_tracks')) return res.status(404).send('EV hit not found');
  const hit = db.prepare('SELECT id, description, source_file_name, created_at, prediction_json FROM ev_hit_tracks WHERE id=?').get(Number(req.query.id));
  if (!hit) return res.status(404).send('EV hit not found');
  let prediction = {};
  let unavailable = 'No prediction was saved for this hit. Open the EV editor and run matching to save a report.';
  try { prediction = JSON.parse(hit.prediction_json || '{}') || {}; }
  catch (_) { unavailable = 'The saved prediction could not be read. Run matching again in the EV editor.'; }
  const fit = prediction.direction_first_match || {};
  const candidates = Array.isArray(prediction.ev_candidates) ? prediction.ev_candidates : [];
  const evidence = {};
  for (const key of ['method', 'estimation_pipeline', 'evidence_policy', 'identifiability', 'primary_result', 'warnings', 'blockers', 'projected_path_evidence']) {
    if (prediction[key] != null) evidence[key] = prediction[key];
  }
  for (const key of ['selection_policy', 'assumptions', 'acceptable', 'supported_ranges', 'supported_candidate_count', 'hang_time_evidence', 'rejected_observations', 'pixel_error', 'at_speed_boundary']) {
    if (fit[key] != null) evidence[key] = fit[key];
  }
  const scorePolicy = candidates[0]?.score_policy || '';
  const scoring = scorePolicy.startsWith('joint_path_and_distance')
    ? 'Candidates must meet the video path and landing-distance tolerances. The score adds (path error / path tolerance)² and (distance error / distance tolerance)².'
    : scorePolicy.startsWith('timed_pixel_error')
      ? 'Candidates are ranked by error between projected and marked video positions. Landing distance did not contribute to this score.' : '';
  render(req, res, 'ev_report.html', { hit, candidates: candidates.slice(0, 25), scoring,
    hangScored: scorePolicy.endsWith('_and_hang_time'),
    policies: Object.entries(prediction.evidence_policy || {}),
    reason: prediction.identifiability?.reason || '',
    diagnostic: fit.acceptable === false || fit.selection_policy?.joint_fit_found === false,
    evidence: JSON.stringify(evidence, null, 2), unavailable,
    back: `/library?type=ev&sid=${encodeURIComponent(sidOf(req))}` });
});

app.get("/library/data", async (req, res) => {
  const type = (req.query.type || "").toString();
  const sid = sidOf(req);

  if (type === "pitch") {
    const rows = db.prepare(`
      SELECT pc.id, pc.source_video_id, pc.description, pc.created_at, pc.video_created_at, pc.release_frame, pc.initial_mph, pc.average_mph, length(pc.speed_export_blob)>0 AS speed_export_saved, t.name AS team_name, p.name AS pitcher_name
      FROM pitch_clips pc
      JOIN pitchers p ON p.id = pc.pitcher_id
      JOIN teams t ON t.id = p.team_id
      ORDER BY pc.created_at DESC
    `).all();
    const pending = db.prepare(`SELECT id, source_video_id, description, created_at, video_created_at FROM pending_pitch_clips
      WHERE status='pending' ORDER BY id DESC`).all().map(r => ({ ...r, type: 'pitch', is_pending: 1,
      thumbnail: `/thumbnail/pending-pitch?id=${r.id}`,
      source_video: r.source_video_id ? `/original/pitch?id=${r.id}&pending=1` : null,
      play: `/multi-pitch/pending/tag?id=${r.id}&sid=${encodeURIComponent(sid)}` }));
    return res.json(pending.concat(rows.map((r) => ({
      type: "pitch",
      id: r.id,
      description: r.description,
      created_at: r.created_at,
      video_created_at: r.video_created_at,
      team_name: r.team_name,
      pitcher_name: r.pitcher_name,
      hitter_name: "",
      thumbnail: `/thumbnail/pitch?id=${r.id}`,
      play: `/play/pitch?id=${r.id}&sid=${encodeURIComponent(sid)}`,
      speed_review: `/pitch/speed?id=${r.id}&sid=${encodeURIComponent(sid)}`,
      speed_export: r.speed_export_saved ? `/download/pitch-speed?id=${r.id}` : r.release_frame != null ? `/export/pitch-speed?id=${r.id}` : null,
      speed_export_saved: !!r.speed_export_saved,
      source_file_name: pitchSources.get(r.source_video_id)?.original_file_name || null,
      source_video: r.source_video_id ? `/original/pitch?id=${r.id}` : null,
      initial_mph: r.initial_mph,
      average_mph: r.average_mph,
      delete: "/library/pitch/delete",
    }))));
  }

  if (type === "swing") {
    const hasSwingSeconds = hasColumn("swing_clips", "swing_seconds");
    const hasFrameCount = hasColumn("swing_clips", "frame_count");
    const hasPoseData = hasColumn("swing_clips", "pose_data");
    const hasPoseQualityScore = hasColumn("swing_clips", "pose_quality_score");
    const hasPoseQualityStatus = hasColumn("swing_clips", "pose_quality_status");
    const hasBestSwing = hasColumn("swing_clips", "is_best");
    const rows = db.prepare(`
      SELECT sc.id, sc.description, sc.swing_type, sc.created_at, sc.video_created_at, t.name AS team_name, h.name AS hitter_name, sc.fps,
             ${hasSwingSeconds ? "sc.swing_seconds" : "NULL"} AS swing_seconds,
             ${hasFrameCount ? "sc.frame_count" : "NULL"} AS frame_count,
             ${hasPoseData ? "CASE WHEN sc.pose_data IS NOT NULL AND TRIM(sc.pose_data) <> '' THEN 1 ELSE 0 END" : "0"} AS has_pose_data,
             ${hasPoseQualityScore ? "sc.pose_quality_score" : "NULL"} AS pose_quality_score,
             ${hasPoseQualityStatus ? "sc.pose_quality_status" : "NULL"} AS pose_quality_status,
             ${hasBestSwing ? "COALESCE(sc.is_best, 0)" : "0"} AS is_best
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
        swing_type: r.swing_type || "",
        created_at: r.created_at,
        video_created_at: r.video_created_at,
        team_name: r.team_name,
        pitcher_name: "",
        hitter_name: r.hitter_name,
        swing_duration_seconds: swingSeconds,
        has_pose_data: Number(r.has_pose_data || 0),
        pose_quality_score: r.pose_quality_score == null ? null : Number(r.pose_quality_score),
        pose_quality_status: r.pose_quality_status == null ? null : String(r.pose_quality_status || ""),
        is_best: Number(r.is_best || 0),
        thumbnail: `/thumbnail/swing?id=${r.id}`,
        play: `/play/swing?id=${r.id}&sid=${encodeURIComponent(sid)}`,
        delete: "/library/swing/delete",
      });
    }
    const pendingRows = db.prepare(`
      SELECT ps.id, ps.description, ps.swing_type, ps.created_at, ps.video_created_at, ps.contact_frame,
             t.name AS team_name, h.name AS hitter_name
      FROM pending_swing_clips ps
      JOIN hitters h ON h.id=ps.hitter_id JOIN teams t ON t.id=h.team_id
      WHERE ps.status='pending' ORDER BY ps.id DESC
    `).all();
    for (const r of pendingRows.reverse()) {
      out.unshift({
        type: "swing", id: r.id, description: r.description, created_at: r.created_at,
        video_created_at: r.video_created_at, team_name: r.team_name, hitter_name: r.hitter_name,
        swing_type: r.swing_type || "",
        pitcher_name: "", swing_duration_seconds: null, has_pose_data: 0, is_best: 0,
        is_pending: 1, contact_frame: r.contact_frame,
        thumbnail: `/thumbnail/pending-swing?id=${r.id}`,
        play: `/multi-swing/pending/tag?id=${r.id}&sid=${encodeURIComponent(sid)}&library_type=swing`,
        delete: "/multi-swing/pending/delete",
      });
    }
    return res.json(out);
  }

  if (type === "matchup") {
    const rows = db.prepare(`
      SELECT m.id, m.description, m.created_at,
             tp.name AS pitcher_team, p.name AS pitcher_name,
             th.name AS hitter_team, h.name AS hitter_name,
             COALESCE(sc.is_best, 0) AS swing_is_best
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
      swing_is_best: Number(r.swing_is_best || 0),
      team_name: "",
      thumbnail: `/thumbnail/matchup?id=${r.id}`,
      play: `/play/matchup?id=${r.id}&sid=${encodeURIComponent(sid)}`,
      delete: "/library/matchup/delete",
    })));
  }

  if (type === "ev") {
    if (!hasTable("ev_hit_tracks")) return res.json([]);
    const swingLinks = new Map();
    if (hasTable('ev_swing_links') && db.prepare('PRAGMA table_info(ev_swing_links)').all().some(c => c.name === 'ev_hit_id')) {
      const links = db.prepare(`SELECT link.ev_hit_id, ps.id AS pending_id, ps.contact_frame,
          sc.id AS swing_id FROM ev_swing_links link
          LEFT JOIN pending_swing_clips ps ON ps.id=link.pending_swing_id AND ps.status='pending'
          LEFT JOIN swing_clips sc ON sc.id=link.swing_clip_id
          WHERE link.ev_hit_id IS NOT NULL`).all();
      for (const link of links) if (link.pending_id || link.swing_id) swingLinks.set(link.ev_hit_id, link);
    }
    const renderStateColumn = db.prepare('PRAGMA table_info(ev_hit_tracks)').all().some(c=>c.name==='video_render_status') ? 'e.video_render_status' : 'NULL';
    const rows = db.prepare(`
      SELECT e.generated_clip_blob IS NOT NULL AS video_ready, ${renderStateColumn} AS video_status,
             e.id, e.description, e.source_file_name, e.contact_time_s,
             e.clip_start_time_s, e.clip_end_time_s,
             e.best_exit_velocity_mph, e.best_launch_angle_deg, e.best_distance_ft,
             e.best_hang_time_s, e.best_hit_id, e.created_at,
             t.name AS team_name, h.name AS hitter_name
      FROM ev_hit_tracks e
      LEFT JOIN hitters h ON h.id = e.hitter_id
      LEFT JOIN teams t ON t.id = e.team_id
      ORDER BY e.created_at DESC, e.id DESC
    `).all();
    return res.json(rows.map((r) => ({
      type: "ev",
      id: r.id,
      description: r.description,
      created_at: r.created_at,
      video_created_at: "",
      team_name: r.team_name || "",
      pitcher_name: "",
      hitter_name: r.hitter_name || "",
      source_file_name: r.source_file_name || "",
      contact_time_s: r.contact_time_s,
      clip_start_time_s: r.clip_start_time_s,
      clip_end_time_s: r.clip_end_time_s,
      video_ready: Boolean(r.video_ready),
      video_status: r.video_status,
      best_exit_velocity_mph: r.best_exit_velocity_mph,
      best_launch_angle_deg: r.best_launch_angle_deg,
      best_distance_ft: r.best_distance_ft,
      best_hang_time_s: r.best_hang_time_s,
      best_hit_id: r.best_hit_id,
      thumbnail: `/thumbnail/ev?id=${r.id}`,
      play: `/play/ev?id=${r.id}&sid=${encodeURIComponent(sid)}`,
      open_ev: `${EV_PREDICTOR_URL}/predictor.html?ev_hit_id=${r.id}`,
      pending_swing_id: swingLinks.get(r.id)?.pending_id || null,
      swing_clip_id: swingLinks.get(r.id)?.swing_id || null,
      swing_contact_frame: swingLinks.get(r.id)?.contact_frame ?? null,
      finish_swing: swingLinks.get(r.id)?.pending_id
        ? `/multi-swing/pending/tag?id=${swingLinks.get(r.id).pending_id}&sid=${encodeURIComponent(sid)}&library_type=ev` : null,
      matchup_swing: swingLinks.get(r.id)?.swing_id
        ? `/matchup/select?swing_id=${swingLinks.get(r.id).swing_id}&sid=${encodeURIComponent(sid)}` : null,
      source_clip: "",
      generated_clip: "",
      observation_json: `/api/gameframe/ev-json?id=${r.id}&kind=package`,
      prediction_json: `/api/gameframe/ev-json?id=${r.id}&kind=prediction`,
      delete: "/library/ev/delete",
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

app.get("/thumbnail/ev", async (req, res, next) => {
  try {
    if (!hasTable("ev_hit_tracks")) return res.status(404).send("not found");
    const row = db.prepare("SELECT generated_clip_blob, clip_blob FROM ev_hit_tracks WHERE id=?").get(Number(req.query.id));
    const blob = row?.generated_clip_blob || row?.clip_blob;
    if (!blob) return res.status(404).send("not found");
    const temp = path.join(TMP_DIR, `gf_ev_thumb_${crypto.randomUUID()}.mp4`);
    try {
      await fsp.writeFile(temp, blob);
      // Thumbnail decoding must not block video streams or other library requests.
      const thumb = await new Promise((resolve, reject) => {
        execFile(process.env.FFMPEG_PATH || 'ffmpeg', [
          '-v', 'error', '-threads', '1', '-sseof', '-0.05', '-i', temp,
          '-frames:v', '1', '-vf', 'scale=320:-2', '-threads', '1',
          '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
        ], { encoding: 'buffer', windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
        (error, stdout) => error ? reject(error) : resolve(stdout));
      });
      if (!thumb) return res.status(404).send("thumbnail unavailable");
      res.type("image/jpeg").send(thumb);
    } finally {
      await fsp.unlink(temp).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
});

app.get("/play/pitch", (req, res) => {
  const row = db.prepare('SELECT * FROM pitch_clips WHERE id=?').get(Number(req.query.id));
  if (!row) return res.status(404).send('Pitch not found.');
  render(req,res,'play_pitch.html',{sid:sidOf(req),id:row.id,pitch_speed:savedPitchSpeed(row),speed_export_saved:!!row.speed_export_blob?.length,original_source:pitchSources.get(row.source_video_id)});
});

app.get('/original/pitch', (req,res,next) => {
  const table = req.query.pending === '1' ? 'pending_pitch_clips' : 'pitch_clips';
  const id = Number(req.query.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).send('Pitch not found.');
  const pitch = db.prepare(`SELECT source_video_id FROM ${table} WHERE id=?`).get(id);
  const source = pitchSources.get(pitch?.source_video_id);
  if (!source) return res.status(404).send('The original upload was not retained for this pitch.');
  res.download(source.path, source.original_file_name, error => {
    if (!error) return;
    if (!res.headersSent && error.code === 'ENOENT') return res.status(404).send('The original video is missing from its saved location.');
    next(error);
  });
});

app.get('/pitch/speed', (req,res) => {
  const row = db.prepare('SELECT pc.*, p.name AS pitcher_name FROM pitch_clips pc LEFT JOIN pitchers p ON p.id=pc.pitcher_id WHERE pc.id=?').get(Number(req.query.id));
  if (!row) return res.status(404).send('Pitch not found.');
  const speed = savedPitchSpeed(row);
  render(req,res,'pitch_release_test.html',{sid:sidOf(req),pitches:[row],integration:{id:row.id,speed,locked:!!row.speed_export_blob?.length,
    continue_url:`/library?sid=${encodeURIComponent(sidOf(req))}&type=pitch&pitch_id=${row.id}${req.query.embedded === '1' ? '&embedded=1' : ''}`}});
});

app.post('/api/pitch/speed', (req,res) => {
  const row = db.prepare('SELECT contact_frame,fps,length(speed_export_blob)>0 AS locked FROM pitch_clips WHERE id=?').get(Number(req.body.pitch_id));
  if (!row) return res.status(404).json({error:'Pitch not found.'});
  if (row.locked) return res.status(409).json({error:'Pitch speed is locked because its export has been saved.'});
  try {
    const speed = measurePitch(row,req.body);
    db.prepare(`UPDATE pitch_clips SET release_frame=?,release_extension=?,contact_adjustment=?,mound_distance=?,initial_mph=?,average_mph=?,speed_fps=? WHERE id=?`)
      .run(speed.release,speed.extension,speed.contactDistance,speed.mound,speed.mph,speed.average,speed.fps,Number(req.body.pitch_id));
    res.json({ok:true,speed});
  } catch(error) { res.status(400).json({error:error.message}); }
});

app.get('/download/pitch-speed', (req,res) => {
  const row = db.prepare('SELECT speed_export_blob FROM pitch_clips WHERE id=?').get(Number(req.query.id));
  if (!row?.speed_export_blob?.length) return res.status(404).json({error:'No saved pitch-speed export.'});
  res.type('video/mp4').set('Cache-Control','no-store').set('X-Pitch-Export-Cache','hit')
    .set('Content-Disposition',`attachment; filename="pitch_${Number(req.query.id)}_speed.mp4"`).send(row.speed_export_blob);
});

app.get('/export/pitch-speed', (req,res,next) => {
  const row = db.prepare('SELECT pc.*,p.name AS pitcher_name FROM pitch_clips pc LEFT JOIN pitchers p ON p.id=pc.pitcher_id WHERE pc.id=?').get(Number(req.query.id));
  if (!row) return res.status(404).send('Pitch not found.');
  const send = (blob,cached) => res.type('video/mp4').set('Cache-Control','no-store')
    .set('X-Pitch-Export-Cache',cached ? 'hit' : 'miss')
    .set('Content-Disposition',`attachment; filename="pitch_${row.id}_speed.mp4"`).send(blob);
  if (row.speed_export_blob?.length) return send(row.speed_export_blob,true);
  const speed = savedPitchSpeed(row);
  if (!speed) return res.status(400).send('Save pitch speed before exporting.');
  const key = crypto.createHash('sha256').update('pitch-speed-export-v1').update(row.clip_blob)
    .update(JSON.stringify({speed,name:row.pitcher_name,description:row.description})).digest('hex');
  return requireProcessingSpace(req,res,() => {
  const dir = fs.mkdtempSync(path.join(TMP_DIR,'gf_pitch_speed_'));
  try {
    const {buildPitchSpeedExport} = require('./pitch-speed-export');
    const blob = buildPitchSpeedExport({dir,blob:row.clip_blob,speed,name:row.pitcher_name,description:row.description,
      logo:fs.existsSync(path.join(ROOT,'static','logo','gameframe-logo-video.png')) ? path.join(ROOT,'static','logo','gameframe-logo-video.png') : path.join(ROOT,'ev-predictor','assets','gameframe-logo-video.png'),font:matchupFontFile(),run:runCmd});
    db.prepare('UPDATE pitch_clips SET speed_export_blob=?,speed_export_key=? WHERE id=?').run(blob,key,row.id);
    send(blob,false);
  } catch(error) { next(error); }
  finally { fs.rmSync(dir,{recursive:true,force:true}); }
  });
});

let pitchVisionBusy = false;
app.post(["/api/pitch-vision/analyze", "/api/pitch-vision/preview", "/api/pitch-release/preview"], upload.none(), requireProcessingSpace, async (req, res) => {
  let source;
  let ownsLock = false;
  try {
    const previewOnly = req.path.endsWith("/preview");
    if (!previewOnly && !process.env.OPENAI_API_KEY) return res.status(503).json({ error: "Set OPENAI_API_KEY on the server, then restart to enable analysis." });
    if (pitchVisionBusy) return res.status(409).json({ error: "A pitch analysis is already running. Please wait." });
    pitchVisionBusy = true;
    ownsLock = true;
    const row = db.prepare("SELECT clip_blob, contact_frame FROM pitch_clips WHERE id=?").get(Number(req.body.pitch_id));
    if (!row) return res.status(404).json({ error: "Pitch not found." });
    if (!Number.isInteger(row.contact_frame) || row.contact_frame < 1) return res.status(400).json({ error: "This pitch needs a saved contact marker." });
    source = path.join(TMP_DIR, `gf_vision_source_${crypto.randomUUID()}.mp4`);
    await fsp.writeFile(source, row.clip_blob);
    const { analyzePitch } = require("./pitch-vision");
    res.set("Cache-Control", "no-store").json(await analyzePitch(source, { settings:req.body, contactFrame:row.contact_frame, previewOnly, manualOnly:req.path === '/api/pitch-release/preview' }));
  } catch (error) {
    res.status(502).json({ error: error.message || "Pitch analysis failed." });
  } finally {
    if (ownsLock) pitchVisionBusy = false;
    if (source) await fsp.unlink(source).catch(() => {});
  }
});

app.get("/pitch-release-test", (req, res) => {
  const pitches = db.prepare(`
    SELECT
      pc.id,
      pc.description,
      pc.created_at,
      pc.video_created_at,
      pc.fps,
      pc.contact_frame,
      p.name AS pitcher_name,
      t.name AS team_name
    FROM pitch_clips pc
    LEFT JOIN pitchers p ON p.id = pc.pitcher_id
    LEFT JOIN teams t ON t.id = pc.team_id
    ORDER BY pc.created_at DESC, pc.id DESC
  `).all().map((row) => ({
    id: Number(row.id),
    description: row.description || "",
    created_at: row.created_at || "",
    video_created_at: row.video_created_at || "",
    fps: Number(row.fps || 0),
    contact_frame: row.contact_frame == null ? null : Number(row.contact_frame),
    pitcher_name: row.pitcher_name || "Pitcher",
    team_name: row.team_name || "",
  }));
  render(req, res, "pitch_release_test.html", {
    sid: sidOf(req),
    pitches,
    vision_ready: !!process.env.OPENAI_API_KEY,
    vision_model: process.env.PITCH_VISION_MODEL || "gpt-4.1",
  });
});

app.post("/api/pitch-release/yolo", async (req, res) => {
  const pitchId = Number(req.body.pitch_id || 0);
  const tempId = String(req.body.temp_id || "").trim();
  const startFrame = Number(req.body.start_frame || 0);
  const endFrame = Number(req.body.end_frame || startFrame + 30);
  const fps = Number(req.body.fps || 30);

  const runId = crypto.randomUUID();
  let videoPath = "";
  let shouldDeleteVideo = false;
  if (tempId) {
    videoPath = tempPath(tempId);
    if (!fs.existsSync(videoPath)) return res.status(404).json({ ok: false, error: "temporary pitch clip not found" });
  } else {
    const row = db.prepare("SELECT clip_blob FROM pitch_clips WHERE id=?").get(pitchId);
    if (!row?.clip_blob) return res.status(404).json({ ok: false, error: "pitch clip not found" });
    videoPath = path.join(TMP_DIR, `gf_pitch_release_${runId}.mp4`);
    shouldDeleteVideo = true;
    await fsp.writeFile(videoPath, row.clip_blob);
  }
  const scriptPath = path.join(ROOT, "scripts", "pitch_release_yolo.py");
  const defaultPitchModel = path.join(ROOT, "models", "ball_trackingv4.pt");
  const modelPath = process.env.GAMEFRAME_PITCH_YOLO_MODEL || (fs.existsSync(defaultPitchModel) ? defaultPitchModel : "yolo11n.pt");
  const pythonExe = process.env.PYTHON || "python";
  const args = [
    scriptPath,
    "--video", videoPath,
    "--start", String(Math.max(0, Math.floor(startFrame))),
    "--end", String(Math.max(0, Math.floor(endFrame))),
    "--fps", String(Number.isFinite(fps) && fps > 0 ? fps : 30),
    "--model", modelPath,
  ];
  for (const [flag, key] of [["--crop-x", "crop_x"], ["--crop-y", "crop_y"], ["--crop-w", "crop_w"], ["--crop-h", "crop_h"]]) {
    const value = Number(req.body[key]);
    if (Number.isFinite(value)) args.push(flag, String(value));
  }

  const child = spawn(pythonExe, args, { cwd: ROOT, windowsHide: true });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const timeoutMs = Math.max(5000, Number(process.env.GAMEFRAME_PITCH_YOLO_TIMEOUT_MS || 30000));
  const timeout = setTimeout(() => {
    timedOut = true;
    try { child.kill("SIGKILL"); } catch {}
  }, timeoutMs);
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.on("error", async (err) => {
    clearTimeout(timeout);
    if (shouldDeleteVideo) {
      try { await fsp.unlink(videoPath); } catch {}
    }
    res.status(500).json({ ok: false, error: err.message || "could not run YOLO worker" });
  });
  child.on("close", async (code) => {
    clearTimeout(timeout);
    if (shouldDeleteVideo) {
      try { await fsp.unlink(videoPath); } catch {}
    }
    if (res.headersSent) return;
    if (timedOut) {
      return res.json({
        ok: false,
        accepted: false,
        error: `YOLO worker timed out after ${Math.round(timeoutMs / 1000)} seconds`,
        detections: [],
        tracks: [],
      });
    }
    if (code !== 0 && !stdout.trim()) {
      return res.status(500).json({ ok: false, error: stderr.trim() || `YOLO worker exited with ${code}` });
    }
    try {
      const trimmed = stdout.trim();
      const jsonStart = trimmed.indexOf("{");
      const jsonEnd = trimmed.lastIndexOf("}");
      const parsed = JSON.parse(jsonStart >= 0 && jsonEnd >= jsonStart ? trimmed.slice(jsonStart, jsonEnd + 1) : trimmed);
      parsed.stderr = stderr.trim();
      res.json(parsed);
    } catch (err) {
      res.status(500).json({ ok: false, error: "YOLO worker returned invalid JSON", stdout, stderr });
    }
  });
});

app.get("/play/swing", (req, res) => render(req, res, "play_swing.html", { sid: sidOf(req), id: Number(req.query.id) }));
app.get("/play/matchup", (req, res) => {
  const id = Number(req.query.id);
  const matchup = db.prepare(`SELECT COALESCE(sc.is_best, 0) AS swing_is_best,
      sc.swing_seconds AS swing_seconds,
      sc.decision_frame AS decision_frame,
      sc.frame_count AS frame_count,
      sc.fps AS swing_fps, m.pitch_speed_json, m.swing_clip_id, m.pitch_clip_id
    FROM matchups m LEFT JOIN swing_clips sc ON sc.id=m.swing_clip_id WHERE m.id=?`).get(id);
  const swingSeconds = Number(matchup?.swing_seconds);
  const fps = Number(matchup?.swing_fps);
  const decisionFrame = Number(matchup?.decision_frame);
  const contactFrame = Number(matchup?.frame_count) > 0 ? Number(matchup.frame_count) - 1 : null;
  const decisionToContactSeconds = fps > 0 && Number.isFinite(decisionFrame) && Number.isFinite(contactFrame)
    ? Math.max(0, (contactFrame - decisionFrame) / fps)
    : null;
  render(req, res, "play_matchup.html", {
    sid: sidOf(req),
    id,
    pitch_speed: matchup?.pitch_speed_json ? JSON.parse(matchup.pitch_speed_json) : savedPitchSpeed(db.prepare('SELECT * FROM pitch_clips WHERE id=?').get(matchup?.pitch_clip_id || 0)),
    swing_ev: savedSwingEv(matchup?.swing_clip_id || 0),
    swing_is_best: Number(matchup?.swing_is_best || 0),
    swing_seconds_display: Number.isFinite(swingSeconds) ? `${swingSeconds.toFixed(2)}s` : "--",
    decision_to_contact_display: Number.isFinite(decisionToContactSeconds) ? `${decisionToContactSeconds.toFixed(2)}s` : "--",
  });
});

app.get("/stream/pitch", (req, res) => {
  const row = db.prepare(`SELECT CASE WHEN length(speed_export_blob)>0 THEN speed_export_blob ELSE clip_blob END AS clip_blob
    FROM pitch_clips WHERE id=?`).get(Number(req.query.id));
  if (!row) return res.status(404).send("not found");
  res.set('Cache-Control','no-store');
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

ballAssistTest.install(app, id => hasTable('ev_hit_tracks') ? db.prepare('SELECT source_file_name, contact_time_s, clip_start_time_s, clip_blob FROM ev_hit_tracks WHERE id=?').get(id) : null);

app.get("/play/ev", (req, res) => {
  const id = Number(req.query.id);
  const row = hasTable('ev_hit_tracks') && db.prepare('SELECT id,generated_clip_blob IS NOT NULL AS video_ready,best_exit_velocity_mph,best_launch_angle_deg,best_distance_ft FROM ev_hit_tracks WHERE id=?').get(id);
  if (!row) return res.status(404).send('Saved EV video not found.');
  render(req, res, 'play_ev.html', { id, sid: sidOf(req), video_ready: !!row.video_ready, ev:row.best_exit_velocity_mph, launch:row.best_launch_angle_deg, distance:row.best_distance_ft });
});

app.get("/stream/ev-clip", (req, res) => {
  if (!hasTable("ev_hit_tracks")) return res.status(404).send("not found");
  const kind = String(req.query.kind || "generated").toLowerCase();
  const row = db.prepare(`SELECT source_file_name, clip_blob, clip_mime_type, generated_clip_blob, generated_clip_mime_type
    FROM ev_hit_tracks WHERE id=?`).get(Number(req.query.id));
  if (!row) return res.status(404).send("not found");
  const useGenerated = ["generated", "replay", "final"].includes(kind);
  const blob = useGenerated ? row.generated_clip_blob : row.clip_blob;
  const mime = (useGenerated ? row.generated_clip_mime_type : row.clip_mime_type) || "video/mp4";
  if (!blob) return res.status(404).send("not found");
  const disposition = String(req.query.inline || "") === "1" ? "inline" : "attachment";
  const suffix = useGenerated ? "generated" : "source-trim";
  const stem = String(row.source_file_name || `ev-hit-${Number(req.query.id)}`).replace(/[^\w.-]+/g, "_").replace(/\.[^.]+$/, "");
  res.setHeader("Content-Disposition", `${disposition}; filename="${stem}-ev-track-${Number(req.query.id)}-${suffix}.mp4"`);
  if (mime === 'video/mp4') return streamBlob(req, res, blob);
  res.type(mime).send(blob);
});

app.get("/collage/matchup", (req, res) => {
  const id = Number(req.query.id);
  const row = db.prepare("SELECT collage_blob FROM matchups WHERE id=?").get(id);
  if (!row || !row.collage_blob) return res.status(404).send("collage not found");
  if (String(req.query.download || "") === "1") {
    res.setHeader("Content-Disposition", `attachment; filename=matchup_${id}_collage.jpg`);
  }
  res.type("image/jpeg").send(row.collage_blob);
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

app.post("/upload/pitch", upload.single("file"), requireProcessingSpace, async (req, res, next) => {
  try {
  if (!req.file) return res.status(400).send('Choose a video first.');
  const tempId = crypto.randomUUID();
  const origPath = req.file.path;
  const trimmedPath = tempPath(tempId);
  const start = Number(req.body.start_min || 0) * 60 + Number(req.body.start_sec || 0);
  const sourceMeta = ffprobeMeta(origPath, { countFrames: false });
  const videoCreatedAt = sourceMeta.creationTime || normalizedVideoDate(req.body.video_created_at) || "";
  if (!Number.isFinite(start) || start < 0 || !sourceMeta.duration || start >= sourceMeta.duration + 0.05) {
    fsp.unlink(origPath).catch(() => {});
    return res.status(400).send(`That start time is too late. Choose a time before the video ends (${sourceMeta.duration.toFixed(1)} seconds).`);
  }
  const retainedSource = await pitchSources.retain(req.file, tempId, { move: true });
  try {
    runCmd("ffmpeg", [
      "-y", "-ss", String(start), "-i", retainedSource.path, "-t", "5",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-an", trimmedPath,
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
    video_created_at: videoCreatedAt,
  });
  if (String(req.body.embedded || req.query.embedded || "") === "1") q.set("embedded", "1");
  res.redirect(303, `/upload/pitch/trim?${q.toString()}`);
  } catch (error) { next(error); }
});

app.post("/upload/swing", upload.single("file"), requireProcessingSpace, (req, res) => {
  const tempId = crypto.randomUUID();
  const origPath = req.file.path;
  const trimmedPath = tempPath(tempId);
  const start = Number(req.body.start_min || 0) * 60 + Number(req.body.start_sec || 0);
  const sourceMeta = ffprobeMeta(origPath, { countFrames: false });
  const videoCreatedAt = sourceMeta.creationTime || normalizedVideoDate(req.body.video_created_at) || "";
  if (!Number.isFinite(start) || start < 0 || !sourceMeta.duration || start + 5 > sourceMeta.duration + 0.05) {
    fsp.unlink(origPath).catch(() => {});
    return res.status(400).send(`That start time is too late. Choose a time at least 5 seconds before the video ends (${sourceMeta.duration.toFixed(1)} seconds).`);
  }
  try {
    runCmd("ffmpeg", [
      "-y", "-ss", String(start), "-i", origPath, "-t", "5",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-an", trimmedPath,
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
    video_created_at: videoCreatedAt,
  });
  if (String(req.body.embedded || req.query.embedded || "") === "1") q.set("embedded", "1");
  res.redirect(303, `/upload/swing/trim?${q.toString()}`);
});

app.get("/upload/pitch/trim", (req, res) => {
  render(req, res, "upload_pitch_trim.html", {
    sid: sidOf(req),
    temp_id: req.query.temp_id,
    team_id: req.query.team_id,
    pitcher_id: req.query.pitcher_id,
    description: req.query.description || "",
    swing_type: req.query.swing_type || "",
    video_created_at: req.query.video_created_at || "",
    preset_contact_frame: Number(req.query.preset_contact_frame),
    has_preset_contact: req.query.preset_contact_frame !== undefined && req.query.preset_contact_frame !== "",
    pending_pitch_id: Number(req.query.pending_pitch_id || 0),
    return_url: req.query.return_url || "",
  });
});

app.get("/upload/swing/trim", (req, res) => {
  const pendingId = Number(req.query.pending_id || 0);
  let pendingSwings = [];
  let pendingPosition = 0;
  if (pendingId > 0) {
    const current = db.prepare("SELECT batch_id FROM pending_swing_clips WHERE id=? AND status='pending'").get(pendingId);
    if (current) {
      pendingSwings = db.prepare(`SELECT id, description, contact_frame
        FROM pending_swing_clips WHERE batch_id=? AND status='pending' ORDER BY id`).all(current.batch_id);
      pendingPosition = Math.max(0, pendingSwings.findIndex((item) => Number(item.id) === pendingId));
    }
  }
  render(req, res, "upload_swing_trim.html", {
    sid: sidOf(req),
    temp_id: req.query.temp_id,
    team_id: req.query.team_id,
    hitter_id: req.query.hitter_id,
    description: req.query.description || "",
    swing_type: req.query.swing_type || "",
    video_created_at: req.query.video_created_at || "",
    fps: Number(req.query.fps || 0),
    total: Number(req.query.total || 0),
    preset_contact_frame: Number(req.query.preset_contact_frame),
    has_preset_contact: req.query.preset_contact_frame !== undefined && req.query.preset_contact_frame !== "",
    pending_id: pendingId,
    pending_swings: pendingSwings,
    pending_position: pendingPosition,
    pending_count: pendingSwings.length,
    return_url: req.query.return_url || "",
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

app.get("/api/raw/pitch-meta", (req, res) => {
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

app.post("/upload/pitch/finalize", upload.single("file"), requireProcessingSpace, async (req, res, next) => {
  try {
  let clipPath = req.file && req.file.path;
  let generatedPath = null;
  let storedContactFrame = Number(req.body.contact_frame);
  const tempId = String(req.body.temp_id || "").trim();

  if (!clipPath && tempId) {
    const sourcePath = tempPath(tempId);
    if (!fs.existsSync(sourcePath)) return res.status(404).send("source clip expired");
    const meta = ffprobeMeta(sourcePath);
    const sourceFps = Number(meta.fps || req.body.fps || 30);
    const sourceLast = Math.max(0, Number(meta.frameCount || 1) - 1);
    const contact = Math.max(0, Math.min(sourceLast, Math.round(Number(req.body.contact_frame || 0))));
    const start = Math.max(0, contact - Math.floor(2 * sourceFps));
    const portraitCrop = parsePortraitCrop(req.body.portrait_crop, true);
    generatedPath = path.join(TMP_DIR, `gf_pitch_final_${crypto.randomUUID()}.mp4`);
    runCmd("ffmpeg", [
      "-y", "-i", sourcePath,
      "-vf", buildTrimFilter({ start, endFrame: contact, crop: portraitCrop }),
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", generatedPath,
    ]);
    clipPath = generatedPath;
    storedContactFrame = contact - start;
  }

  if (!clipPath) return res.status(400).send("missing source clip");
  const blob = await fsp.readFile(clipPath);
  const outputMeta = ffprobeMeta(clipPath);
  const thumbBlob = extractLastFrameJpeg(clipPath);
  if (req.file) await fsp.unlink(req.file.path).catch(() => {});
  if (generatedPath) await fsp.unlink(generatedPath).catch(() => {});
  const insertedPitch = db.prepare(`
    INSERT INTO pitch_clips (team_id, pitcher_id, description, clip_blob, thumb, fps, contact_frame, video_created_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    Number(req.body.team_id),
    Number(req.body.pitcher_id),
    req.body.description || "",
    blob,
    thumbBlob,
    Number(outputMeta.fps || req.body.fps || 0),
    storedContactFrame,
    normalizedVideoDate(req.body.video_created_at)
  );
    const pendingPitchId = Number(req.body.pending_pitch_id || 0);
    const sourceId = pendingPitchId > 0
      ? db.prepare('SELECT source_video_id FROM pending_pitch_clips WHERE id=?').get(pendingPitchId)?.source_video_id
      : tempId;
    if (pitchSources.get(sourceId)) db.prepare('UPDATE pitch_clips SET source_video_id=? WHERE id=?').run(sourceId, insertedPitch.lastInsertRowid);
    if (pendingPitchId > 0) {
      db.prepare("DELETE FROM pending_pitch_clips WHERE id=?").run(pendingPitchId);
    }
    if (tempId) await fsp.unlink(tempPath(tempId)).catch(() => {});
    const q = new URLSearchParams({ sid: sidOf(req) });
    q.set('id',String(insertedPitch.lastInsertRowid));
    if (String(req.body.embedded || req.query.embedded || "") === "1") q.set("embedded", "1");
    if (tempId) return res.json({ok:true,pitch_id:Number(insertedPitch.lastInsertRowid),speed_url:`/pitch/speed?${q.toString()}`});
    res.redirect(303, `/pitch/speed?${q.toString()}`);
  } catch (err) {
    next(err);
  }
});

// Taggers need decoded source frames, not browser timestamp seeks or a
// real-time captureStream (both can duplicate/drop frames under load).
app.get("/api/raw/tag-frames", (req, res) => {
  const id = String(req.query.id || "");
  if (!/^[a-f0-9-]{20,}$/i.test(id)) return res.status(400).send("invalid clip id");
  const source = tempPath(id);
  if (!fs.existsSync(source)) return res.status(404).send("source clip expired");
  const meta = ffprobeMeta(source);
  if (!meta.frameCount || meta.frameCount > 600) {
    return res.status(400).send("Tagging clips must contain 1–600 frames.");
  }
  const ffmpeg = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
    "-v", "error", "-i", source, "-map", "0:v:0", "-fps_mode", "passthrough",
    "-frames:v", String(meta.frameCount),
    "-vf", "scale=w='min(1280,iw)':h=-2:flags=fast_bilinear",
    "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
  ], { windowsHide: true });
  let errorText = "";
  let startedStreaming = false;
  ffmpeg.stderr.on("data", (chunk) => { errorText = (errorText + chunk.toString()).slice(-4000); });
  ffmpeg.on("error", (error) => {
    if (!res.headersSent) res.status(500).send(`Frame decoder could not start: ${error.message}`);
    else res.destroy(error);
  });
  ffmpeg.stdout.on("data", (chunk) => {
    if (!startedStreaming) {
      startedStreaming = true;
      res.type("application/octet-stream").set({ "Cache-Control": "no-store", "X-Frame-Count": String(meta.frameCount) });
    }
    if (!res.destroyed) res.write(chunk);
  });
  ffmpeg.on("close", (code) => {
    if (res.destroyed) return;
    if (code !== 0 && !startedStreaming) return res.status(500).send(errorText || `Frame decoder exited ${code}`);
    if (!startedStreaming) return res.status(500).send("Frame decoder produced no frames.");
    if (code !== 0) return res.destroy(new Error(errorText || `Frame decoder exited ${code}`));
    res.end();
  });
  res.on("close", () => { if (!ffmpeg.killed) ffmpeg.kill(); });
});

app.get("/multi-swing", (req, res) => {
  const teams = db.prepare("SELECT id, name FROM teams ORDER BY name").all();
  const hitters = db.prepare("SELECT id, name, team_id FROM hitters ORDER BY name").all();
  const pending = db.prepare(`SELECT p.id, p.batch_id, p.description, p.fps, p.contact_frame,
    p.source_contact_seconds, p.video_created_at, p.status, p.swing_clip_id, p.created_at,
    h.name AS hitter_name, t.name AS team_name FROM pending_swing_clips p
    LEFT JOIN hitters h ON h.id=p.hitter_id LEFT JOIN teams t ON t.id=p.team_id
    WHERE p.status='pending' ORDER BY p.id DESC`).all();
  render(req, res, "multi_swing.html", { sid: sidOf(req), teams, hitters, pending });
});

app.get("/multi-pitch", (req, res) => {
  const teams = db.prepare("SELECT id, name FROM teams ORDER BY name").all();
  const pitchers = db.prepare("SELECT id, name, team_id FROM pitchers ORDER BY name").all();
  const pending = db.prepare(`SELECT p.id, p.batch_id, p.description, p.fps, p.contact_frame,
    p.source_contact_seconds, p.video_created_at, p.status, p.pitch_clip_id, p.created_at,
    r.name AS pitcher_name, t.name AS team_name FROM pending_pitch_clips p
    LEFT JOIN pitchers r ON r.id=p.pitcher_id LEFT JOIN teams t ON t.id=p.team_id
    WHERE p.status='pending' ORDER BY p.id DESC`).all();
  render(req, res, "multi_pitch.html", { sid: sidOf(req), teams, pitchers, pending });
});

app.post("/multi-pitch/analyze", upload.single("file"), requireProcessingSpace, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Choose a video first." });
    const tempId = crypto.randomUUID();
    const target = tempPath(tempId);
    try { await fsp.rename(req.file.path, target); }
    catch (_) { await fsp.copyFile(req.file.path, target); await fsp.unlink(req.file.path).catch(() => {}); }
    const meta = ffprobeMeta(target, { countFrames: false });
    if (!meta.fps || !meta.duration) throw new Error("GameFrame could not read this video's frame rate or duration.");
    if (meta.duration > 1800) throw new Error("Multi-pitch videos are currently limited to 30 minutes.");
    await pitchSources.retain({ ...req.file, path: target }, tempId);
    const candidates = analyzeSwingContactAudio(target, meta.duration, meta.fps);
    res.json({ ok: true, temp_id: tempId, fps: meta.fps, duration: meta.duration,
      source_name: path.basename(req.file.originalname || "video.mp4"),
      video_created_at: meta.creationTime || normalizedVideoDate(req.body.video_created_at) || "", candidates });
  } catch (err) { next(err); }
});

app.post("/multi-pitch/split", async (req, res, next) => {
  try {
    const tempId = String(req.body.temp_id || "");
    if (!/^[a-f0-9-]{20,}$/i.test(tempId)) return res.status(400).json({ error: "Invalid source video." });
    const source = tempPath(tempId);
    if (!fs.existsSync(source)) return res.status(404).json({ error: "The source video expired. Load it again." });
    const meta = ffprobeMeta(source, { countFrames: false });
    const markers = (Array.isArray(req.body.markers) ? req.body.markers : []).map(Number)
      .filter((v) => Number.isFinite(v) && v >= 0 && v <= meta.duration).sort((a, b) => a - b).slice(0, 100);
    if (!markers.length) return res.status(400).json({ error: "Keep at least one contact marker." });
    const batchId = crypto.randomUUID();
    const insert = db.prepare(`INSERT INTO pending_pitch_clips
      (batch_id, team_id, pitcher_id, description, clip_blob, fps, contact_frame, source_contact_seconds, video_created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`);
    const ids = [];
    for (let i = 0; i < markers.length; i += 1) {
      const contact = markers[i];
      const sourceContactFrame = Math.max(0, Math.min(meta.frameCount - 1, Math.round(contact * meta.fps)));
      const sourceStartFrame = Math.max(0, sourceContactFrame - Math.round(2 * meta.fps));
      const sourceEndFrame = Math.min(meta.frameCount, sourceContactFrame + Math.round(meta.fps) + 1);
      const out = path.join(TMP_DIR, `gf_pending_pitch_${crypto.randomUUID()}.mp4`);
      runCmd("ffmpeg", ["-v", "error", "-y", "-i", source,
        "-vf", `trim=start_frame=${sourceStartFrame}:end_frame=${sourceEndFrame},setpts=PTS-STARTPTS`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-an", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
      const outMeta = ffprobeMeta(out);
      const contactFrame = Math.max(0, Math.min(Math.max(0, outMeta.frameCount - 1), sourceContactFrame - sourceStartFrame));
      const label = `${String(req.body.description || "Pitch").trim() || "Pitch"} ${i + 1}`;
      const info = insert.run(batchId, Number(req.body.team_id), Number(req.body.pitcher_id), label,
        await fsp.readFile(out), outMeta.fps, contactFrame, contact, normalizedVideoDate(req.body.video_created_at));
      if (pitchSources.get(tempId)) db.prepare('UPDATE pending_pitch_clips SET source_video_id=? WHERE id=?').run(tempId, info.lastInsertRowid);
      ids.push(Number(info.lastInsertRowid));
      await fsp.unlink(out).catch(() => {});
    }
    await saveContactReview({ kind: "pitch", batchId, sourceName: req.body.source_name,
      fps: meta.fps, duration: meta.duration, suggested: req.body.suggested, approved: markers });
    await fsp.unlink(source).catch(() => {});
    res.json({ ok: true, batch_id: batchId, count: ids.length, ids });
  } catch (err) { next(err); }
});

app.get("/multi-pitch/pending/video", (req, res) => {
  const row = db.prepare("SELECT clip_blob FROM pending_pitch_clips WHERE id=?").get(Number(req.query.id));
  if (!row) return res.status(404).send("pending clip not found");
  streamBlob(req, res, row.clip_blob);
});

app.get("/multi-pitch/pending/tag", async (req, res, next) => {
  try {
    const row = db.prepare("SELECT * FROM pending_pitch_clips WHERE id=?").get(Number(req.query.id));
    if (!row) return res.status(404).send("pending clip not found");
    const pitcher = db.prepare('SELECT id, team_id FROM pitchers WHERE id=?').get(Number(req.query.pitcher_id || row.pitcher_id || 0));
    if (!pitcher || String(row.batch_id).startsWith('ev-')) return render(req, res, 'pending_pitch_player.html', {
      sid: sidOf(req), pending: row,
      is_ev: String(row.batch_id).startsWith('ev-'),
      teams: db.prepare('SELECT id,name FROM teams ORDER BY name').all(),
      pitchers: db.prepare('SELECT p.id, p.name, t.name AS team_name FROM pitchers p JOIN teams t ON t.id=p.team_id ORDER BY t.name,p.name').all(),
    });
    row.pitcher_id = pitcher.id;
    row.team_id = pitcher.team_id;
    const tempId = crypto.randomUUID();
    await fsp.writeFile(tempPath(tempId), row.clip_blob);
    const q = new URLSearchParams({ sid: sidOf(req), temp_id: tempId, team_id: String(row.team_id || ""),
      pitcher_id: String(row.pitcher_id || ""), description: row.description || "", video_created_at: row.video_created_at || "",
      fps: String(row.fps || 0), preset_contact_frame: String(row.contact_frame), pending_pitch_id: String(row.id),
      return_url: `/multi-pitch?sid=${encodeURIComponent(sidOf(req))}` });
    if (String(req.query.embedded || "") === "1") q.set("embedded", "1");
    res.redirect(303, `/upload/pitch/trim?${q.toString()}`);
  } catch (err) { next(err); }
});

app.post('/multi-pitch/pending/speed', (req,res,next) => {
  try {
    const id = Number(req.body.id);
    const row = db.prepare("SELECT * FROM pending_pitch_clips WHERE id=? AND status='pending'").get(id);
    if (!row || !String(row.batch_id).startsWith('ev-')) return res.status(404).send('Pending EV pitch not found.');
    const pitchId = db.transaction(() => {
      let pitcher = db.prepare('SELECT id,team_id FROM pitchers WHERE id=?').get(Number(req.body.pitcher_id || 0));
      if (req.body.player_mode === 'new') {
        const name = String(req.body.new_pitcher_name || '').trim();
        const team = db.prepare('SELECT id FROM teams WHERE id=?').get(Number(req.body.team_id || 0));
        if (!name || !team) throw new Error('Enter a pitcher name and choose a team.');
        const inserted = db.prepare('INSERT INTO pitchers(name,team_id,description) VALUES(?,?,?)').run(name,team.id,'');
        pitcher = {id:Number(inserted.lastInsertRowid),team_id:team.id};
      }
      if (!pitcher) throw new Error('Choose a pitcher.');
      const inserted = db.prepare(`INSERT INTO pitch_clips(team_id,pitcher_id,description,clip_blob,thumb,fps,contact_frame,video_created_at,created_at)
        VALUES(?,?,?,?,?,?,?,?,datetime('now'))`).run(pitcher.team_id,pitcher.id,row.description,row.clip_blob,row.thumb || null,row.fps,row.contact_frame,row.video_created_at);
      if (pitchSources.get(row.source_video_id)) db.prepare('UPDATE pitch_clips SET source_video_id=? WHERE id=?').run(row.source_video_id, inserted.lastInsertRowid);
      if (hasTable('ev_pitch_links')) db.prepare('UPDATE ev_pitch_links SET pitch_clip_id=? WHERE pending_pitch_id=?').run(inserted.lastInsertRowid,id);
      db.prepare('DELETE FROM pending_pitch_clips WHERE id=?').run(id);
      return Number(inserted.lastInsertRowid);
    })();
    const query = new URLSearchParams({id:String(pitchId),sid:sidOf(req),embedded:'1'});
    res.redirect(303, `/pitch/speed?${query}`);
  } catch (error) { next(error); }
});

app.post("/multi-pitch/pending/delete", (req, res) => {
  db.prepare("DELETE FROM pending_pitch_clips WHERE id=? AND status='pending'").run(Number(req.body.id));
  res.redirect(303, `/multi-pitch?sid=${encodeURIComponent(sidOf(req))}`);
});

app.post("/multi-swing/analyze", upload.single("file"), requireProcessingSpace, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Choose a video first." });
    const tempId = crypto.randomUUID();
    const target = tempPath(tempId);
    try { await fsp.rename(req.file.path, target); }
    catch (_) { await fsp.copyFile(req.file.path, target); await fsp.unlink(req.file.path).catch(() => {}); }
    const meta = ffprobeMeta(target, { countFrames: false });
    if (!meta.fps || !meta.duration) throw new Error("GameFrame could not read this video's frame rate or duration.");
    if (meta.duration > 1800) throw new Error("Multi-swing videos are currently limited to 30 minutes.");
    const candidates = analyzeSwingContactAudio(target, meta.duration, meta.fps);
    res.json({ ok: true, temp_id: tempId, fps: meta.fps, duration: meta.duration,
      source_name: path.basename(req.file.originalname || "video.mp4"),
      video_created_at: meta.creationTime || normalizedVideoDate(req.body.video_created_at) || "", candidates });
  } catch (err) { next(err); }
});

app.post("/multi-swing/prepare-tag", upload.single("file"), requireProcessingSpace, async (req, res, next) => {
  let sourcePath = "";
  let shortPath = "";
  try {
    if (!req.file) return res.status(400).json({ error: "Choose a video first." });
    const sourceId = crypto.randomUUID();
    sourcePath = tempPath(sourceId);
    try { await fsp.rename(req.file.path, sourcePath); }
    catch (_) { await fsp.copyFile(req.file.path, sourcePath); await fsp.unlink(req.file.path).catch(() => {}); }
    const meta = ffprobeMeta(sourcePath, { countFrames: false, requireExactFrameCount: true });
    if (!meta.fps || !meta.duration || !meta.frameCount) {
      throw new Error("GameFrame could not read this video's frame rate or duration.");
    }
    const contact = analyzeEvStyleContactAudio(sourcePath, meta.duration, meta.fps);
    const sourceContactFrame = contact ? Math.max(0, Math.min(meta.frameCount - 1, Math.round(contact.time * meta.fps))) : null;
    const sourceStartFrame = contact ? Math.max(0, sourceContactFrame - Math.round(2 * meta.fps)) : 0;
    const maxFrames = 600;
    const sourceEndFrame = Math.min(
      meta.frameCount,
      sourceStartFrame + maxFrames,
      contact ? sourceContactFrame + Math.round(meta.fps) + 1 : maxFrames
    );
    const shortId = crypto.randomUUID();
    shortPath = tempPath(shortId);
    runCmd("ffmpeg", ["-v", "error", "-y", "-i", sourcePath,
      "-vf", `trim=start_frame=${sourceStartFrame}:end_frame=${sourceEndFrame},setpts=PTS-STARTPTS`,
      "-frames:v", String(sourceEndFrame - sourceStartFrame),
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", shortPath]);
    const shortMeta = ffprobeMeta(shortPath);
    const localContactFrame = contact ? Math.max(0, Math.min(Math.max(0, shortMeta.frameCount - 1), sourceContactFrame - sourceStartFrame)) : null;
    await fsp.unlink(sourcePath).catch(() => {});
    res.json({
      ok: true,
      temp_id: shortId,
      fps: shortMeta.fps || meta.fps,
      frame_count: shortMeta.frameCount,
      duration: shortMeta.duration,
      preset_contact_frame: localContactFrame,
      source_contact_seconds: contact?.time ?? null,
      confidence: contact?.confidence ?? null,
      video_created_at: meta.creationTime || normalizedVideoDate(req.body.video_created_at) || "",
    });
  } catch (err) {
    if (sourcePath) await fsp.unlink(sourcePath).catch(() => {});
    if (shortPath) await fsp.unlink(shortPath).catch(() => {});
    next(err);
  }
});

app.get("/multi-swing/source", (req, res) => {
  const id = String(req.query.id || "");
  if (!/^[a-f0-9-]{20,}$/i.test(id)) return res.status(400).send("invalid video id");
  const p = tempPath(id);
  if (!fs.existsSync(p)) return res.status(404).send("source video expired");
  res.type("video/mp4").sendFile(p);
});

app.get("/multi-pitch/source", (req, res) => {
  const id = String(req.query.id || "");
  if (!/^[a-f0-9-]{20,}$/i.test(id)) return res.status(400).send("invalid video id");
  const p = tempPath(id);
  if (!fs.existsSync(p)) return res.status(404).send("source video expired");
  res.type("video/mp4").sendFile(p);
});

app.post("/multi-swing/split", async (req, res, next) => {
  try {
    const tempId = String(req.body.temp_id || "");
    if (!/^[a-f0-9-]{20,}$/i.test(tempId)) return res.status(400).json({ error: "Invalid source video." });
    const source = tempPath(tempId);
    if (!fs.existsSync(source)) return res.status(404).json({ error: "The source video expired. Load it again." });
    const meta = ffprobeMeta(source, { countFrames: false, requireExactFrameCount: true });
    const markers = (Array.isArray(req.body.markers) ? req.body.markers : []).map(Number)
      .filter((v) => Number.isFinite(v) && v >= 0 && v <= meta.duration).sort((a, b) => a - b).slice(0, 100);
    if (!markers.length) return res.status(400).json({ error: "Keep at least one contact marker." });
    const batchId = crypto.randomUUID();
    const swingType = ["game", "batting_practice", "tee"].includes(String(req.body.swing_type || ""))
      ? String(req.body.swing_type) : "";
    const insert = db.prepare(`INSERT INTO pending_swing_clips
      (batch_id, team_id, hitter_id, description, swing_type, clip_blob, thumb, fps, contact_frame, source_contact_seconds, video_created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`);
    const ids = [];
    for (let i = 0; i < markers.length; i += 1) {
      const contact = markers[i];
      const sourceContactFrame = Math.max(0, Math.min(meta.frameCount - 1, Math.round(contact * meta.fps)));
      const sourceStartFrame = Math.max(0, sourceContactFrame - Math.round(2 * meta.fps));
      const sourceEndFrame = Math.min(meta.frameCount, sourceContactFrame + Math.round(meta.fps) + 1);
      const out = path.join(TMP_DIR, `gf_pending_${crypto.randomUUID()}.mp4`);
      runCmd("ffmpeg", ["-v", "error", "-y", "-i", source,
        "-vf", `trim=start_frame=${sourceStartFrame}:end_frame=${sourceEndFrame},setpts=PTS-STARTPTS`,
        "-frames:v", String(sourceEndFrame - sourceStartFrame),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-an", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
      const outMeta = ffprobeMeta(out);
      const contactFrame = Math.max(0, Math.min(Math.max(0, outMeta.frameCount - 1), sourceContactFrame - sourceStartFrame));
      const label = `${String(req.body.description || "Swing").trim() || "Swing"} ${i + 1}`;
      const info = insert.run(batchId, Number(req.body.team_id), Number(req.body.hitter_id), label, swingType,
        await fsp.readFile(out), extractLastFrameJpeg(out), outMeta.fps, contactFrame, contact, normalizedVideoDate(req.body.video_created_at));
      ids.push(Number(info.lastInsertRowid));
      await fsp.unlink(out).catch(() => {});
    }
    await saveContactReview({ kind: "swing", batchId, sourceName: req.body.source_name,
      fps: meta.fps, duration: meta.duration, suggested: req.body.suggested, approved: markers });
    await fsp.unlink(source).catch(() => {});
    res.json({ ok: true, batch_id: batchId, count: ids.length, ids });
  } catch (err) { next(err); }
});

app.get("/multi-swing/pending/video", (req, res) => {
  const row = db.prepare("SELECT clip_blob FROM pending_swing_clips WHERE id=?").get(Number(req.query.id));
  if (!row) return res.status(404).send("pending clip not found");
  streamBlob(req, res, row.clip_blob);
});

app.get(["/thumbnail/pending-swing", "/thumbnail/pending-pitch"], async (req, res) => {
  const table = req.path.endsWith('pending-pitch') ? 'pending_pitch_clips' : 'pending_swing_clips';
  const row = db.prepare(`SELECT thumb, clip_blob FROM ${table} WHERE id=?`).get(Number(req.query.id));
  if (!row) return res.status(404).send("pending clip not found");
  if (row.thumb) return res.type("image/jpeg").send(row.thumb);
  const temp = path.join(TMP_DIR, `gf_pending_thumb_${crypto.randomUUID()}.mp4`);
  try {
    await fsp.writeFile(temp, row.clip_blob);
    const thumb = extractLastFrameJpeg(temp);
    if (!thumb) return res.status(404).send("thumbnail unavailable");
    db.prepare(`UPDATE ${table} SET thumb=? WHERE id=?`).run(thumb, Number(req.query.id));
    res.type("image/jpeg").send(thumb);
  } finally { await fsp.unlink(temp).catch(() => {}); }
});

const pendingSwingSourceWrites = new Map();
app.get("/multi-swing/pending/tag", async (req, res, next) => {
  try {
    let row = db.prepare("SELECT * FROM pending_swing_clips WHERE id=?").get(Number(req.query.id));
    if (!row) {
      const completed = hasTable('ev_swing_links') && db.prepare(`SELECT sc.* FROM ev_swing_links link
        JOIN swing_clips sc ON sc.id=link.swing_clip_id WHERE link.pending_swing_id=?`).get(Number(req.query.id));
      if (completed) {
        row = { ...completed, id: Number(req.query.id), batch_id: '',
          contact_frame: Math.max(0, Number(completed.frame_count) - 1) };
      }
      if (!row) return res.status(404).send("This pending swing was removed. Open the library to select a saved swing.");
    }
    // Exact media identity lets a recently opened tagger reuse its decoded
    // frames, including after navigating away and returning to the same swing.
    const tempId = crypto.createHash('sha256').update(row.clip_blob).digest('hex');
    let preparation = pendingSwingSourceWrites.get(tempId);
    if (!preparation) {
      preparation = (async () => {
        if (!fs.existsSync(tempPath(tempId))) await fsp.writeFile(tempPath(tempId), row.clip_blob);
        else await fsp.utimes(tempPath(tempId),new Date(),new Date());
      })();
      pendingSwingSourceWrites.set(tempId,preparation);
    }
    try { await preparation; }
    finally { if (pendingSwingSourceWrites.get(tempId) === preparation) pendingSwingSourceWrites.delete(tempId); }
    const nextPending = db.prepare(`SELECT id FROM pending_swing_clips
      WHERE batch_id=? AND status='pending' AND id<>?
      ORDER BY CASE WHEN id>? THEN 0 ELSE 1 END, id LIMIT 1`).get(row.batch_id, row.id, row.id);
    const embeddedSuffix = String(req.query.embedded || "") === "1" ? "&embedded=1" : "";
    let returnUrl = nextPending
      ? `/multi-swing/pending/tag?id=${nextPending.id}&sid=${encodeURIComponent(sidOf(req))}${embeddedSuffix}`
      : `/matchup/select?sid=${encodeURIComponent(sidOf(req))}${embeddedSuffix}`;
    if (['ev', 'swing'].includes(req.query.library_type)) {
      returnUrl = `/library?type=${req.query.library_type}&sid=${encodeURIComponent(sidOf(req))}${embeddedSuffix}`;
    }
    const matchupPitch = Number(req.query.matchup_pitch_id);
    if (matchupPitch > 0 && db.prepare('SELECT id FROM pitch_clips WHERE id=?').get(matchupPitch)) {
      const resume = new URLSearchParams({sid: sidOf(req), pitch_id: String(matchupPitch),
        description: String(req.query.matchup_description || ''), resume: '1'});
      if (embeddedSuffix) resume.set('embedded', '1');
      returnUrl = `/matchup/select?${resume}`;
    }
    const q = new URLSearchParams({ sid: sidOf(req), temp_id: tempId, team_id: String(row.team_id || ""),
      hitter_id: String(row.hitter_id || ""), description: row.description || "", swing_type: row.swing_type || "", video_created_at: row.video_created_at || "",
      fps: String(row.fps || 0), preset_contact_frame: String(row.contact_frame), pending_id: String(row.id),
      return_url: returnUrl });
    if (String(req.query.embedded || "") === "1") q.set("embedded", "1");
    res.redirect(303, `/upload/swing/trim?${q.toString()}`);
  } catch (err) { next(err); }
});

app.post("/multi-swing/pending/delete", (req, res) => {
  const result = db.prepare("DELETE FROM pending_swing_clips WHERE id=? AND status='pending'").run(Number(req.body.id));
  if (!result.changes) return res.status(404).send("Pending swing not found.");
  res.redirect(303, `/library?sid=${encodeURIComponent(sidOf(req))}&type=swing`);
});

app.post("/upload/swing/finalize", upload.fields([{ name: "file", maxCount: 1 }, { name: "library_file", maxCount: 1 }]), requireProcessingSpace, async (req, res, next) => {
  try {
  const uploadedMain = req.files && req.files.file && req.files.file[0];
  const uploadedLibrary = req.files && req.files.library_file && req.files.library_file[0];
  let mainPath = uploadedMain && uploadedMain.path;
  let libraryPath = uploadedLibrary && uploadedLibrary.path;
  let generatedDir = null;
  const tempId = String(req.body.temp_id || "").trim();
  let nativeFrameCount = 0;
  let nativeFps = 0;
  let nativeSwingSeconds = 0;
  let storedDecisionFrame = Number(req.body.decision_frame || 0);

  if (!mainPath && tempId) {
    const sourcePath = tempPath(tempId);
    if (!fs.existsSync(sourcePath)) return res.status(404).send("source clip expired");
    const meta = ffprobeMeta(sourcePath);
    nativeFps = Number(meta.fps || req.body.fps || 30);
    const sourceLast = Math.max(0, Number(meta.frameCount || 1) - 1);
    const start = Math.max(0, Math.min(sourceLast, Math.round(Number(req.body.start_frame || 0))));
    const contact = Math.max(start + 1, Math.min(sourceLast, Math.round(Number(req.body.contact_frame || sourceLast))));
    const decision = Math.max(start, Math.min(contact, Math.round(Number(req.body.decision_frame_source || start))));
    const libraryEnd = Math.min(sourceLast, contact + Math.round(nativeFps * 0.5));
    const portraitCrop = parsePortraitCrop(req.body.portrait_crop, true);
    generatedDir = path.join(TMP_DIR, `gf_swing_final_${crypto.randomUUID()}`);
    fs.mkdirSync(generatedDir, { recursive: true });
    mainPath = path.join(generatedDir, "swing.mp4");
    libraryPath = path.join(generatedDir, "library.mp4");
    const encodeRange = (endFrame, outputPath) => runCmd("ffmpeg", [
      "-y", "-i", sourcePath,
      "-vf", buildTrimFilter({ start, endFrame, crop: portraitCrop }),
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath,
    ]);
    encodeRange(contact, mainPath);
    encodeRange(libraryEnd, libraryPath);
    nativeFrameCount = contact - start + 1;
    nativeSwingSeconds = nativeFrameCount > 1 ? (nativeFrameCount - 1) / nativeFps : 0;
    storedDecisionFrame = decision - start;
  }

  if (!mainPath) return res.status(400).send("missing source clip");
  if (!libraryPath) libraryPath = mainPath;
  const blob = await fsp.readFile(mainPath);
  const libraryBlob = await fsp.readFile(libraryPath);
  const thumbBlob = extractLastFrameJpeg(mainPath);
  if (uploadedMain) await fsp.unlink(uploadedMain.path).catch(() => {});
  if (uploadedLibrary) await fsp.unlink(uploadedLibrary.path).catch(() => {});
  if (generatedDir) {
    await fsp.unlink(mainPath).catch(() => {});
    if (libraryPath !== mainPath) await fsp.unlink(libraryPath).catch(() => {});
    await fsp.rmdir(generatedDir).catch(() => {});
  }
  const cameraView = normalizeSwingCameraView(req.body.camera_view);
  const swingType = ["game", "batting_practice", "tee"].includes(String(req.body.swing_type || ""))
    ? String(req.body.swing_type) : null;
  const poseData = swingCameraViewAllowsPose(cameraView) ? String(req.body.pose_data || "") : "";
  const poseQuality = evaluatePoseDataQuality(poseData);
  const fps = nativeFps || Number(req.body.fps || 0);
  const frameCount = nativeFrameCount || Number(req.body.frame_count || 0);
  const swingSeconds = nativeSwingSeconds || Number(req.body.swing_seconds || 0);
  const pendingId = Number(req.body.pending_id || 0);
  const existingSwing = pendingId > 0 && hasTable('ev_swing_links') && db.prepare(`
    SELECT sc.id FROM ev_swing_links link JOIN swing_clips sc ON sc.id=link.swing_clip_id
    WHERE link.pending_swing_id=?`).get(pendingId);
  const insertedSwing = db.prepare(`
    INSERT INTO swing_clips
    (id, team_id, hitter_id, description, swing_type, camera_view, decision_frame, clip_blob, library_clip_blob, thumb, pose_data, pose_quality_score, pose_quality_status, frame_count, swing_seconds, fps, video_created_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id, hitter_id=excluded.hitter_id,
      description=excluded.description, swing_type=excluded.swing_type, camera_view=excluded.camera_view,
      decision_frame=excluded.decision_frame, clip_blob=excluded.clip_blob, library_clip_blob=excluded.library_clip_blob,
      thumb=excluded.thumb, pose_data=excluded.pose_data, pose_quality_score=excluded.pose_quality_score,
      pose_quality_status=excluded.pose_quality_status, frame_count=excluded.frame_count,
      swing_seconds=excluded.swing_seconds, fps=excluded.fps, video_created_at=excluded.video_created_at
  `).run(
    existingSwing ? existingSwing.id : null,
    Number(req.body.team_id),
    Number(req.body.hitter_id),
    req.body.description || "",
    swingType,
    cameraView,
    storedDecisionFrame,
    blob,
    libraryBlob,
    thumbBlob,
    poseData,
    poseData.trim() ? Number(poseQuality.score || 0) : null,
    poseData.trim() ? String(poseQuality.status || "") : null,
    Number.isFinite(frameCount) && frameCount > 0 ? frameCount : null,
    Number.isFinite(swingSeconds) && swingSeconds > 0 ? swingSeconds : null,
    Number.isFinite(fps) && fps > 0 ? fps : null,
    normalizedVideoDate(req.body.video_created_at)
  );
    if (pendingId > 0) {
      if (hasTable('ev_swing_links')) db.prepare('UPDATE ev_swing_links SET swing_clip_id=? WHERE pending_swing_id=?').run(existingSwing ? existingSwing.id : Number(insertedSwing.lastInsertRowid),pendingId);
      db.prepare("DELETE FROM pending_swing_clips WHERE id=?").run(pendingId);
    }
    if (tempId) await fsp.unlink(tempPath(tempId)).catch(() => {});
    const savedSwingId = existingSwing ? existingSwing.id : Number(insertedSwing.lastInsertRowid);
    if (tempId || String(req.get('accept') || '').includes('application/json')) return res.json({ ok: true, swing_id: savedSwingId });
    const q = new URLSearchParams({ sid: sidOf(req) });
    if (String(req.body.embedded || req.query.embedded || "") === "1") q.set("embedded", "1");
    res.redirect(303, `/matchup/select?${q.toString()}`);
  } catch (err) {
    next(err);
  }
});

app.post("/library/pitch/delete", (req, res) => {
  const pitchId = Number(req.body.id);
  const removePitch = db.transaction((id) => {
    deleteReferencingRows("pitch_clips", id);
    db.prepare("DELETE FROM pitch_clips WHERE id=?").run(id);
  });
  removePitch(pitchId);
  res.redirect(303, libraryDeleteReturn(req, 'pitch'));
});

app.post("/library/swing/delete", (req, res) => {
  const swingId = Number(req.body.id);
  const removeSwing = db.transaction((id) => {
    deleteReferencingRows("swing_clips", id);
    db.prepare("DELETE FROM swing_clips WHERE id=?").run(id);
  });
  removeSwing(swingId);
  res.redirect(303, libraryDeleteReturn(req, 'swing'));
});

app.post("/library/matchup/delete", (req, res) => {
  db.prepare("DELETE FROM matchups WHERE id=?").run(Number(req.body.id));
  res.redirect(303, libraryDeleteReturn(req, 'matchup'));
});

function detachEvSwingLink(id) {
  if (hasTable('ev_swing_links') && hasColumn('ev_swing_links', 'ev_hit_id')) {
    db.prepare('UPDATE ev_swing_links SET ev_hit_id=NULL WHERE ev_hit_id=?').run(id);
  }
}

function libraryDeleteReturn(req, type) {
  const target = new URL('/library', 'http://localhost');
  target.searchParams.set('sid', sidOf(req));
  if (type) target.searchParams.set('type', type);
  try {
    const previous = new URL(String(req.body.return || ''), 'http://localhost');
    if (previous.origin === target.origin && previous.pathname === '/library') {
      target.search = previous.search;
    }
  } catch (_) {}
  if (String(req.body.embedded || req.query.embedded || '') === '1') target.searchParams.set('embedded', '1');
  return target.pathname + target.search;
}

app.post("/library/ev/delete", (req, res) => {
  db.transaction((id) => {
    detachEvSwingLink(id);
    db.prepare("DELETE FROM ev_hit_tracks WHERE id=?").run(id);
  })(Number(req.body.id));
  res.redirect(303, libraryDeleteReturn(req, 'ev'));
});

app.post("/library/bulk-delete", (req, res) => {
  const type = String(req.body.type || "").trim().toLowerCase();
  const rawIds = Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids];
  const ids = rawIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
  const pendingSwingIds = type === "swing" ? rawIds
    .map((v) => /^pending:(\d+)$/.exec(String(v || "")))
    .filter(Boolean).map((match) => Number(match[1]))
    .filter((v) => Number.isInteger(v) && v > 0) : [];

  if (!ids.length && !pendingSwingIds.length) {
    return res.redirect(303, `/library?sid=${encodeURIComponent(sidOf(req))}${type ? `&type=${encodeURIComponent(type)}` : ""}`);
  }

  if (type === "pitch") {
    const stmt = db.prepare("DELETE FROM pitch_clips WHERE id=?");
    const tx = db.transaction((rowIds) => {
      for (const id of rowIds) {
        deleteReferencingRows("pitch_clips", id);
        stmt.run(id);
      }
    });
    tx(ids);
  } else if (type === "swing") {
    const stmt = db.prepare("DELETE FROM swing_clips WHERE id=?");
    const pendingStmt = db.prepare("DELETE FROM pending_swing_clips WHERE id=? AND status='pending'");
    const tx = db.transaction((rowIds, pendingIds) => {
      for (const id of rowIds) {
        deleteReferencingRows("swing_clips", id);
        stmt.run(id);
      }
      for (const id of pendingIds) pendingStmt.run(id);
    });
    tx(ids, pendingSwingIds);
  } else if (type === "matchup") {
    const stmt = db.prepare("DELETE FROM matchups WHERE id=?");
    const tx = db.transaction((rowIds) => {
      for (const id of rowIds) stmt.run(id);
    });
    tx(ids);
  } else if (type === "ev") {
    const stmt = db.prepare("DELETE FROM ev_hit_tracks WHERE id=?");
    const tx = db.transaction((rowIds) => {
      for (const id of rowIds) {
        detachEvSwingLink(id);
        stmt.run(id);
      }
    });
    tx(ids);
  }

  res.redirect(303, libraryDeleteReturn(req, type));
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
  const swingRows = db.prepare("SELECT id, hitter_id, description, created_at, COALESCE(is_best, 0) AS is_best FROM swing_clips ORDER BY created_at DESC").all();

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
    pitchClipMap[k].push({
      id: r.id,
      label: `${created} - ${r.description || `Pitch ${r.id}`}`,
      created_at: r.created_at || "",
      thumbnail: `/thumbnail/pitch?id=${r.id}`,
    });
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
    const bestLabel = Number(r.is_best || 0) === 1 ? "★ BEST SWING — " : "";
    swingClipMap[k].push({
      id: r.id,
      label: `${bestLabel}${created} - ${r.description || `Swing ${r.id}`}`,
      created_at: r.created_at || "",
      is_best: Number(r.is_best || 0),
      thumbnail: `/thumbnail/swing?id=${r.id}`,
    });
  });
  const pendingSwings = db.prepare(`SELECT id, hitter_id, description, created_at FROM pending_swing_clips
    WHERE status='pending' ORDER BY created_at DESC`).all();
  pendingSwings.forEach(r => {
    const key = String(r.hitter_id);
    if (!swingClipMap[key]) swingClipMap[key] = [];
    swingClipMap[key].push({id: `pending:${r.id}`, pending_id: r.id,
      label: `${r.description || `Swing ${r.id}`} - Needs timing`, created_at: r.created_at || '',
      thumbnail: `/thumbnail/pending-swing?id=${r.id}`});
  });

  const newestPitch = pitchRows[0] || null;
  const newestPitcher = newestPitch
    ? pitcherRows.find((row) => Number(row.id) === Number(newestPitch.pitcher_id))
    : null;
  const newestSwing = swingRows[0] || null;
  const newestHitter = newestSwing
    ? hitterRows.find((row) => Number(row.id) === Number(newestSwing.hitter_id))
    : null;

  render(req, res, "matchup_select.html", {
    sid: sidOf(req),
    teams,
    pitcher_map: pitcherMap,
    pitch_clip_map: pitchClipMap,
    hitter_map: hitterMap,
    swing_clip_map: swingClipMap,
    default_pitch_team_id: newestPitcher ? newestPitcher.team_id : null,
    default_pitcher_id: newestPitcher ? newestPitcher.id : null,
    default_pitch_clip_id: newestPitch ? newestPitch.id : null,
    default_swing_team_id: newestHitter ? newestHitter.team_id : null,
    default_hitter_id: newestHitter ? newestHitter.id : null,
    default_swing_clip_id: newestSwing ? newestSwing.id : null,
  });
});


app.post("/matchup/select", (req, res) => {
  const q = new URLSearchParams({
    sid: sidOf(req),
    pitch_id: String(req.body.pitch_id),
    swing_id: String(req.body.swing_id),
    description: String(req.body.description || ""),
  });
  if (String(req.body.embedded || req.query.embedded || "") === "1") q.set("embedded", "1");
  res.redirect(303, `/matchup/build?${q.toString()}`);
});

app.get("/matchup/build", (req, res) => {
  const q = new URLSearchParams({
    sid: sidOf(req),
    pitch_id: String(req.query.pitch_id || ""),
    swing_id: String(req.query.swing_id || ""),
    description: String(req.query.description || ""),
  });
  if (String(req.query.embedded || "") === "1") q.set("embedded", "1");
  res.redirect(302, `/matchup/select?${q.toString()}`);
});

app.post("/matchup/create", upload.single("file"), requireProcessingSpace, async (req, res) => {
  const usageRequestId = crypto.randomUUID();
  const usageStartedAt = Date.now();
  let usageAuthorization = null;
  try {
    usageAuthorization = await authorizeDesktopMatchup(db, usageRequestId);
    let blob = null;
    let thumbBlob = null;
    let collageBlob = null;
    let pitchSpeed = null;

    if (req.file) {
      pitchSpeed = savedPitchSpeed(db.prepare('SELECT * FROM pitch_clips WHERE id=?').get(Number(req.body.pitch_id)));
      blob = await fsp.readFile(req.file.path);
      thumbBlob = extractLastFrameJpeg(req.file.path);
      await fsp.unlink(req.file.path).catch(() => {});
    } else {
      const pitchId = Number(req.body.pitch_id);
      const swingId = Number(req.body.swing_id);
      const pitchRow = db.prepare(`
        SELECT pc.*, p.name AS pitcher_name
        FROM pitch_clips pc
        LEFT JOIN pitchers p ON p.id = pc.pitcher_id
        WHERE pc.id=?
      `).get(pitchId);
      const swingRow = db.prepare(`
       SELECT sc.clip_blob,
               sc.description AS swing_description,
               sc.created_at AS swing_created_at,
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
      pitchSpeed = savedPitchSpeed(pitchRow);
      const built = await buildMatchupVideoAsync({
        pitchSpeed,
        swingEv: savedSwingEv(swingId),
        pitchBlob: pitchRow.clip_blob,
        swingBlob: swingRow.clip_blob,
        description: req.body.description || "",
        hitterName: swingRow.hitter_name || "Hitter",
        pitcherName: pitchRow.pitcher_name || "Pitcher",
        swingLabel: `Swing #${swingId} • ${swingRow.swing_description || "Untitled swing"} • ${swingRow.swing_created_at || "date unknown"}`,
        swingSeconds: swingRow.swing_seconds,
        decisionFrame: swingRow.decision_frame,
        swingContactFrame: Number(swingRow.frame_count || 0) > 0 ? (Number(swingRow.frame_count) - 1) : null,
        pitchContactFrame: pitchRow.contact_frame,
      });
      blob = built.blob;
      thumbBlob = built.thumb;
      collageBlob = built.collage;
    }

    const result = db.prepare(`
      INSERT INTO matchups (pitch_clip_id, swing_clip_id, description, matchup_blob, thumb, collage_blob, pitch_speed_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      Number(req.body.pitch_id),
      Number(req.body.swing_id),
      req.body.description || "",
      blob,
      thumbBlob,
      collageBlob,
      JSON.stringify(pitchSpeed)
    );
    if (usageAuthorization) {
      await completeDesktopMatchup(db, usageAuthorization.usage_id, true, Date.now() - usageStartedAt).catch(() => {});
    }
    res.json({ id: result.lastInsertRowid, entitlement: usageAuthorization ? usageAuthorization.entitlement : undefined });
  } catch (err) {
    if (usageAuthorization) {
      await completeDesktopMatchup(db, usageAuthorization.usage_id, false, Date.now() - usageStartedAt, "MATCHUP_FAILED").catch(() => {});
    }
    const message = err && err.message ? err.message : "Could not build matchup.";
    console.error("matchup/create failed:", message);
    res.status(Number(err && err.status) || 500).json({ error: message, code: err && err.code });
  }
});

app.post("/library/swing/best", (req, res) => {
  const swingId = Number(req.body.id);
  const isBest = String(req.body.is_best || "") === "1" ? 1 : 0;
  if (!Number.isInteger(swingId) || swingId <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid swing." });
  }
  const result = db.prepare("UPDATE swing_clips SET is_best=? WHERE id=?").run(isBest, swingId);
  if (!result.changes) return res.status(404).json({ ok: false, error: "Swing not found." });
  return res.json({ ok: true, id: swingId, is_best: isBest });
});

app.post("/library/swing/type", (req, res) => {
  const swingId = Number(req.body.id);
  const swingType = String(req.body.swing_type || "");
  const isPending = String(req.body.is_pending || "") === "1";
  if (!Number.isInteger(swingId) || swingId <= 0 || !["", "game", "batting_practice", "tee"].includes(swingType)) {
    return res.status(400).json({ ok: false, error: "Invalid swing type." });
  }
  const table = isPending ? "pending_swing_clips" : "swing_clips";
  const result = db.prepare(`UPDATE ${table} SET swing_type=? WHERE id=?`).run(swingType || null, swingId);
  if (!result.changes) return res.status(404).json({ ok: false, error: "Swing not found." });
  return res.json({ ok: true, id: swingId, swing_type: swingType, is_pending: isPending ? 1 : 0 });
});

app.post("/library/description", (req, res) => {
  const id = Number(req.body.id);
  const type = String(req.body.type || "").trim().toLowerCase();
  const description = String(req.body.description || "").trim().slice(0, 500);
  const tables = { pitch: "pitch_clips", swing: "swing_clips", matchup: "matchups", ev: "ev_hit_tracks" };
  const table = tables[type];
  if (!table || !Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid library item." });
  }
  const result = db.prepare(`UPDATE ${table} SET description=? WHERE id=?`).run(description, id);
  if (!result.changes) return res.status(404).json({ ok: false, error: "Library item not found." });
  return res.json({ ok: true, id, type, description });
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

app.get('/dashboard/measurements', (req, res) => {
  const {summarizeMeasurements,measurementWindow} = require('./measurement-summary');
  const view = req.query.view === 'pitching' ? 'pitching' : 'hitting';
  const pitching = view === 'pitching';
  const player = Number(req.query.player || 0);
  const days = ['7','30','90','all'].includes(String(req.query.days)) ? String(req.query.days) : 'all';
  const people = db.prepare(`SELECT p.id,p.name,t.name AS team_name FROM ${pitching?'pitchers':'hitters'} p LEFT JOIN teams t ON t.id=p.team_id ORDER BY p.name`).all();
  let rows = [];
  if (player && people.some(p=>p.id===player)) {
    if (pitching) rows = db.prepare('SELECT id,description,created_at AS measured_at,initial_mph,average_mph FROM pitch_clips WHERE pitcher_id=? ORDER BY created_at DESC,id DESC').all(player);
    else if (hasTable('ev_hit_tracks')) rows = db.prepare('SELECT id,description,created_at AS measured_at,best_exit_velocity_mph,best_launch_angle_deg,best_distance_ft FROM ev_hit_tracks WHERE hitter_id=? ORDER BY created_at DESC,id DESC').all(player);
  }
  rows = measurementWindow(rows,days);
  const specs = pitching ? [['initial_mph','Out-of-hand speed (estimated)','mph'],['average_mph','Average flight speed','mph']]
    : [['best_exit_velocity_mph','Exit velocity (estimated)','mph'],['best_launch_angle_deg','Launch angle (estimated)','deg'],['best_distance_ft','Carry (estimated)','ft']];
  const format = (value,unit) => typeof value==='number' && Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : '--';
  const metrics = specs.map(([key,label,unit])=>{
    const summary=summarizeMeasurements(rows.map(row=>row[key]));
    return {label,summary,display:{mean:format(summary.mean,unit),median:format(summary.median,unit),range:summary.count?`${format(summary.min,unit)} - ${format(summary.max,unit)}`:'--',deviation:format(summary.standardDeviation,unit)}};
  });
  rows = rows.map(row=>({...row,description:row.description||`${pitching?'Pitch':'Hit'} #${row.id}`,url:`/play/${pitching?'pitch':'ev'}?id=${row.id}&sid=${encodeURIComponent(sidOf(req))}`,values:specs.map(([key,,unit])=>format(row[key],unit))}));
  render(req,res,'dashboard_measurements.html',{sid:sidOf(req),view,player,people,days,rows,metrics,title: pitching?'Pitching measurements':'Hitting measurements',player_label:pitching?'Pitcher':'Hitter',noun:pitching?'pitches':'hits',windows:[{value:'all',label:'All uploads'},{value:'7',label:'Last 7 days'},{value:'30',label:'Last 30 days'},{value:'90',label:'Last 90 days'}]});
});

app.get("/dashboard/player", async (req, res) => {
  const tid = Number(req.query.tid || 0);
  const hid = Number(req.query.hid || 0);
  const requestedWindow = String(req.query.window || "10");
  const windowMode = /^(5|10|20|50|days7|days30|days90|all)$/.test(requestedWindow) ? requestedWindow : "10";
  const referenceId = Number(req.query.ref || 0);
  const requestedSwingType = String(req.query.swing_type || "all");
  const swingTypeFilter = ["all", "game", "batting_practice", "tee", "unclassified"].includes(requestedSwingType)
    ? requestedSwingType : "all";
  const pq = String(req.query.pq || "");
  const playerQuery = pq.trim().toLowerCase();
  const hasEvTracks = hasTable("ev_hit_tracks");

  const teams = db.prepare("SELECT id, name FROM teams ORDER BY name").all();
  const hitterActivityJoin = hasEvTracks
    ? `LEFT JOIN ev_hit_tracks ev ON ev.hitter_id = h.id`
    : "";
  const hitterActivityHaving = hasEvTracks
    ? "HAVING COUNT(sc.id) > 0 OR COUNT(ev.id) > 0"
    : "HAVING COUNT(sc.id) > 0";
  const hittersSql = `
      SELECT h.id, h.name, h.team_id, t.name AS team_name,
             COUNT(DISTINCT sc.id) AS swing_count,
             ${hasEvTracks ? "COUNT(DISTINCT ev.id)" : "0"} AS ev_track_count,
             datetime(MAX(julianday(COALESCE(sc.video_created_at, sc.created_at)))) AS last_swing_at
      FROM hitters h
      JOIN teams t ON t.id = h.team_id
      LEFT JOIN swing_clips sc ON sc.hitter_id = h.id
      ${hitterActivityJoin}
      ${tid ? "WHERE h.team_id = ?" : ""}
      GROUP BY h.id, h.name, h.team_id, t.name
      ${hitterActivityHaving}
      ORDER BY t.name, h.name
    `;
  let hitters = tid ? db.prepare(hittersSql).all(tid) : db.prepare(hittersSql).all();
  if (playerQuery) hitters = hitters.filter((h) => String(h.name || "").toLowerCase().includes(playerQuery));

  let selectedHitter = null;
  if (hid) {
    selectedHitter = db.prepare(`
      SELECT h.id, h.name AS hitter_name, t.name AS team_name
      FROM hitters h
      JOIN teams t ON t.id = h.team_id
      WHERE h.id=?
    `).get(hid);
  }

  const swingsView = [];
  const evTracks = [];
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
      SELECT id, description, swing_type, fps, decision_frame,
             COALESCE(video_created_at, created_at) AS created_at,
             created_at AS uploaded_at,
             video_created_at,
             frame_count, swing_seconds, COALESCE(is_best, 0) AS is_best,
             ${hasPoseData ? "CASE WHEN pose_data IS NOT NULL AND pose_data <> '' THEN 1 ELSE 0 END" : "0"} AS has_pose_data,
             ${hasPoseData ? "pose_data" : "NULL"} AS pose_data,
             clip_blob
      FROM swing_clips
      WHERE hitter_id=?
      ORDER BY julianday(COALESCE(video_created_at, created_at)) DESC, id DESC
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
      let decisionToContactSeconds = null;
      let commitmentToContactSeconds = null;
      if (fps > 0 && row.decision_frame != null) {
        decisionSeconds = Number(row.decision_frame) / fps;
      }
      if (row.pose_data) {
        const parsedPose = parsePoseCsvRows(String(row.pose_data || ""));
        const guide = poseGuideFromRows(parsedPose.rows || []);
        const poseFps = poseFpsFromRows(parsedPose.rows || []) || fps || null;
        if (guide && guide.decisionToContactFrames != null && poseFps && poseFps > 0) {
          decisionToContactSeconds = guide.decisionToContactFrames / poseFps;
          commitmentToContactSeconds = decisionToContactSeconds;
        }
      }
      if (commitmentToContactSeconds == null && fps > 0 && frameCount > 0 && row.decision_frame != null) {
        const decisionFrame = Number(row.decision_frame);
        const contactFrame = Math.max(0, frameCount - 1);
        if (Number.isFinite(decisionFrame) && decisionFrame >= 0 && decisionFrame < contactFrame) {
          decisionToContactSeconds = (contactFrame - decisionFrame) / fps;
          commitmentToContactSeconds = decisionToContactSeconds;
        }
      }

      const m = matchupBySwing[Number(row.id)] || { count: 0, latest_id: null };
      const commitmentToContactDisplay = commitmentToContactSeconds != null
        ? commitmentToContactSeconds.toFixed(3)
        : "";
      const commitmentToContactFrames = commitmentToContactSeconds != null && fps > 0
        ? commitmentToContactSeconds * fps
        : null;
      swingsView.push({
        id: Number(row.id),
        description: String(row.description || "").trim() || "(no description)",
        swing_type: String(row.swing_type || ""),
        fps,
        decision_frame: row.decision_frame,
        decision_seconds: decisionSeconds,
        decision_to_contact_seconds: decisionToContactSeconds,
        commitment_to_contact_seconds: commitmentToContactSeconds,
        commitment_to_contact_display: commitmentToContactDisplay,
        commitment_to_contact_frames: commitmentToContactFrames,
        created_at: row.created_at,
        uploaded_at: row.uploaded_at,
        video_created_at: row.video_created_at,
        frame_count: frameCount,
        swing_seconds: swingSeconds,
        has_pose_data: Number(row.has_pose_data || 0),
        matchup_count: m.count,
        latest_matchup_id: m.latest_id,
        is_best: Number(row.is_best || 0),
      });
    }
    if (hasEvTracks) {
      const evRows = db.prepare(`
        SELECT id, description, source_file_name, contact_time_s, clip_start_time_s, clip_end_time_s,
               best_exit_velocity_mph, best_launch_angle_deg, best_distance_ft, best_hang_time_s,
               best_hit_id, created_at
        FROM ev_hit_tracks
        WHERE hitter_id=?
        ORDER BY julianday(created_at) DESC, id DESC
      `).all(hid);
      for (const row of evRows) {
        evTracks.push({
          id: Number(row.id),
          description: String(row.description || "").trim() || "(no description)",
          source_file_name: row.source_file_name,
          contact_time_s: row.contact_time_s,
          clip_start_time_s: row.clip_start_time_s,
          clip_end_time_s: row.clip_end_time_s,
          best_exit_velocity_mph: row.best_exit_velocity_mph,
          best_launch_angle_deg: row.best_launch_angle_deg,
          best_distance_ft: row.best_distance_ft,
          best_hang_time_s: row.best_hang_time_s,
          best_hit_id: row.best_hit_id,
          created_at: row.created_at,
        });
      }
    }
  }
  const typeFilteredSwings = swingTypeFilter === "all"
    ? swingsView
    : swingTypeFilter === "unclassified"
      ? swingsView.filter((s) => !s.swing_type)
      : swingsView.filter((s) => s.swing_type === swingTypeFilter);
  let scopedSwings = typeFilteredSwings;
  if (/^\d+$/.test(windowMode)) {
    scopedSwings = typeFilteredSwings.slice(0, Number(windowMode));
  } else if (windowMode.startsWith("days")) {
    const days = Number(windowMode.slice(4));
    const cutoff = Date.now() - days * 86400000;
    scopedSwings = typeFilteredSwings.filter((s) => {
      const created = Date.parse(String(s.created_at || ""));
      return Number.isFinite(created) && created >= cutoff;
    });
  }
  const selectedReference = swingsView.find((s) => s.id === referenceId)
    || swingsView.find((s) => s.is_best)
    || null;
  const summary = buildSummary(scopedSwings);
  const decisionSummary = buildDecisionSummary(scopedSwings);
  if (summary) {
    summary.reference_delta = selectedReference ? summary.median - Number(selectedReference.swing_seconds || 0) : null;
    summary.reference_delta_abs = summary.reference_delta == null ? null : Math.abs(summary.reference_delta);
    const overallFps = scopedSwings.map((s) => Number(s.fps)).filter((v) => v > 0).sort((a, b) => a - b);
    summary.measurement_fps = overallFps.length ? pct(overallFps, 0.5) : 30;
    summary.variation_frames = summary.stddev * summary.measurement_fps;
    summary.pitch_variation_ratio = summary.stddev / 0.1;
    summary.pitch_variation_percent_capped = Math.min(100, summary.pitch_variation_ratio * 100);
  }
  if (decisionSummary) {
    decisionSummary.trend_total = decisionSummary.trend_per_swing * Math.max(0, decisionSummary.count - 1);
    decisionSummary.trend_total_abs = Math.abs(decisionSummary.trend_total);
    const measuredFps = scopedSwings
      .filter((s) => Number(s.commitment_to_contact_seconds) > 0 && Number(s.fps) > 0)
      .map((s) => Number(s.fps))
      .sort((a, b) => a - b);
    decisionSummary.measurement_fps = measuredFps.length ? pct(measuredFps, 0.5) : 30;
    decisionSummary.median_frames = decisionSummary.median * decisionSummary.measurement_fps;
    decisionSummary.trend_frames = decisionSummary.trend_total * decisionSummary.measurement_fps;
    decisionSummary.trend_frames_abs = Math.abs(decisionSummary.trend_frames);
    decisionSummary.minimum_clear_change_seconds = 2 / decisionSummary.measurement_fps;
    decisionSummary.trend_status = decisionSummary.count < 5
      ? "insufficient"
      : decisionSummary.trend_frames <= -2
        ? "shorter"
        : decisionSummary.trend_frames >= 2
          ? "longer"
          : "no_clear_change";
    decisionSummary.resolution_label = decisionSummary.measurement_fps >= 60 ? "Higher-resolution estimate" : "Limited by video frame rate";
  }
  const summaryNarrative = buildSummaryNarrative(summary, decisionSummary, selectedReference);

  render(req, res, "dashboard_player.html", {
    sid: sidOf(req),
    teams,
    tid,
    pq,
    hitters,
    hid,
    selected_hitter: selectedHitter,
    results: scopedSwings,
    ev_tracks: evTracks,
    reference_swings: swingsView,
    reference_swing: selectedReference,
    reference_id: selectedReference ? selectedReference.id : 0,
    window_mode: windowMode,
    swing_type_filter: swingTypeFilter,
    summary,
    decision_summary: decisionSummary,
    summary_narrative: summaryNarrative,
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
  const rawMessage = err && err.message ? err.message : "internal error";
  console.error(rawMessage);
  if (res.headersSent) return next(err);
  if (options.hostedWorkspace && err?.status === 413) return res.status(413).json({ error: err.message });
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "That video exceeds the configured upload limit.", code: "FILE_TOO_LARGE" });
  }
  const message = process.env.NODE_ENV === "production"
    ? "GameFrame could not complete that operation. Your existing library was not removed. Please retry or contact support."
    : rawMessage;
  res.status(500).json({ error: message, code: "INTERNAL_ERROR" });
});

function startServer(port = Number(process.env.PORT || 8000), host) {
  const server = app.listen(port, host, () => {
    const address = server.address();
    const listeningPort = address && typeof address === "object" ? address.port : port;
    console.log(`GameFrameJS listening on http://localhost:${listeningPort}`);
    if (port !== 0 && process.env.GAMEFRAME_PREWARM_EV !== '0') evWorker.warm();
  });
  server.on('close', evWorker.stop);
  return server;
}

return {
  app, startServer, buildMatchupVideoServerSide,
  closeDatabase: () => { evWorker.stop(); db.close(); },
  stopWorker: evWorker.stop,
  compact: () => db.exec("VACUUM"),
};
}

let defaultApplication;
function getDefaultApplication() {
  if (!defaultApplication) defaultApplication = createApplication();
  return defaultApplication;
}
module.exports = {
  createApplication,
  get app() { return getDefaultApplication().app; },
  get startServer() { return getDefaultApplication().startServer; },
  buildMatchupVideoServerSide: (...args) => getDefaultApplication().buildMatchupVideoServerSide(...args),
  closeDatabase: () => { if (defaultApplication) defaultApplication.closeDatabase(); },
};
if (require.main === module) {
  if (process.env.GAMEFRAME_HOSTED === '1') require('./hosted/server').startHostedServer();
  else getDefaultApplication().startServer();
}
