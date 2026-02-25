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

function downloadExternalVideo(url, outputPath) {
  const ytdlpBin = process.env.YTDLP_BIN || "yt-dlp";
  runCmd(ytdlpBin, [
    "--no-playlist",
    "--no-warnings",
    "--format", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
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
      clip_blob BLOB,
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
    const hint = msg.includes("yt-dlp")
      ? "Video import failed. Ensure yt-dlp is installed on the server."
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
    const rows = db.prepare(`
      SELECT sc.id, sc.description, sc.created_at, t.name AS team_name, h.name AS hitter_name, sc.fps,
             ${hasSwingSeconds ? "sc.swing_seconds" : "NULL"} AS swing_seconds,
             ${hasFrameCount ? "sc.frame_count" : "NULL"} AS frame_count,
             ${hasPoseData ? "CASE WHEN sc.pose_data IS NOT NULL AND TRIM(sc.pose_data) <> '' THEN 1 ELSE 0 END" : "0"} AS has_pose_data,
             sc.clip_blob
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
      if (swingSeconds == null && frameCount != null && fps > 0) {
        swingSeconds = frameCount / fps;
      } else if (swingSeconds == null && r.clip_blob) {
        const p = path.join(TMP_DIR, `gf_probe_${crypto.randomUUID()}.mp4`);
        await fsp.writeFile(p, r.clip_blob);
        const meta = ffprobeMeta(p);
        await fsp.unlink(p).catch(() => {});
        if (!frameCount && meta.frameCount > 0) frameCount = meta.frameCount;
        if (fps <= 0 && meta.fps > 0) fps = meta.fps;
        if (fps > 0 && frameCount && frameCount > 0) swingSeconds = frameCount / fps;
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
  const row = db.prepare("SELECT clip_blob FROM swing_clips WHERE id=?").get(Number(req.query.id));
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

app.post("/upload/swing/finalize", upload.single("file"), async (req, res) => {
  const blob = await fsp.readFile(req.file.path);
  const thumbBlob = extractLastFrameJpeg(req.file.path);
  await fsp.unlink(req.file.path).catch(() => {});
  db.prepare(`
    INSERT INTO swing_clips
    (team_id, hitter_id, description, decision_frame, clip_blob, thumb, pose_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    Number(req.body.team_id),
    Number(req.body.hitter_id),
    req.body.description || "",
    Number(req.body.decision_frame || 0),
    blob,
    thumbBlob,
    req.body.pose_data || ""
  );
  res.redirect(303, `/library?sid=${encodeURIComponent(sidOf(req))}`);
});

app.post("/library/pitch/delete", (req, res) => {
  db.prepare("DELETE FROM pitch_clips WHERE id=?").run(Number(req.body.id));
  res.redirect(303, `/library?sid=${encodeURIComponent(sidOf(req))}&type=pitch`);
});

app.post("/library/swing/delete", (req, res) => {
  db.prepare("DELETE FROM swing_clips WHERE id=?").run(Number(req.body.id));
  res.redirect(303, `/library?sid=${encodeURIComponent(sidOf(req))}&type=swing`);
});

app.post("/library/matchup/delete", (req, res) => {
  db.prepare("DELETE FROM matchups WHERE id=?").run(Number(req.body.id));
  res.redirect(303, `/library?sid=${encodeURIComponent(sidOf(req))}&type=matchup`);
});

app.post("/upload/common/add-team", (req, res) => {
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

app.post("/upload/common/add-hitter", (req, res) => {
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

app.post("/upload/common/add-pitcher", (req, res) => {
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

app.get("/api/swing_meta", async (req, res) => {
  const row = db.prepare("SELECT fps, decision_frame, swing_seconds, frame_count, clip_blob FROM swing_clips WHERE id=?").get(Number(req.query.id));
  if (!row) return res.json({ error: "bad_meta" });
  let fps = Number(row.fps || 0);
  let swingSeconds = row.swing_seconds == null ? null : Number(row.swing_seconds);
  let frameCount = row.frame_count == null ? null : Number(row.frame_count);
  if (swingSeconds == null && frameCount != null && fps > 0) {
    swingSeconds = frameCount / fps;
  } else if (swingSeconds == null && row.clip_blob) {
    const p = path.join(TMP_DIR, `gf_meta_${crypto.randomUUID()}.mp4`);
    await fsp.writeFile(p, row.clip_blob);
    const meta = ffprobeMeta(p);
    await fsp.unlink(p).catch(() => {});
    if (!frameCount && meta.frameCount > 0) frameCount = meta.frameCount;
    if (fps <= 0 && meta.fps > 0) fps = meta.fps;
    if (frameCount && fps > 0) swingSeconds = frameCount / fps;
  }
  res.json({
    fps,
    decision_frame: row.decision_frame,
    swing_seconds: swingSeconds,
    frame_count: frameCount,
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
  const blob = await fsp.readFile(req.file.path);
  const thumbBlob = extractLastFrameJpeg(req.file.path);
  await fsp.unlink(req.file.path).catch(() => {});
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
});

app.post("/dashboard/player/swing/delete", (req, res) => {
  db.prepare("DELETE FROM swing_clips WHERE id=?").run(Number(req.body.swing_id));
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
        swingSeconds = frameCount > 0 && fps > 0 ? frameCount / fps : 0;
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
