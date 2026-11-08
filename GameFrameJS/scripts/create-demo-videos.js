const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const Database = require("better-sqlite3");

const root = path.resolve(__dirname, "..");
const ffmpeg = require("ffmpeg-static") || "ffmpeg";
const outDir = path.join(root, "demo-output", "generated-demos-current");
const tempDir = path.join(outDir, "_temp");
const dbPath = path.join(root, "app.db");
const fontPath = "C\\:/Windows/Fonts/arial.ttf";

fs.mkdirSync(tempDir, { recursive: true });

function run(args, label) {
  const result = spawnSync(ffmpeg, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${label || "ffmpeg"} failed with exit code ${result.status}`);
}

function escapeDrawtext(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%");
}

function writeBlob(name, blob) {
  if (!blob || !blob.length) throw new Error(`Missing video blob for ${name}`);
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, blob);
  return file;
}

function existingVideoPath(value) {
  if (!value) return null;
  const file = path.resolve(value);
  return fs.existsSync(file) ? file : null;
}

function titleCard(name, title, subtitle, seconds = 3.0) {
  const output = path.join(tempDir, name);
  const vf = [
    "format=yuv420p",
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x101820@1:t=fill",
    "drawbox=x=0:y=0:w=iw:h=76:color=0x1f6f62@1:t=fill",
    `drawtext=fontfile='${fontPath}':text='GAMEFRAME':fontcolor=white:fontsize=42:x=54:y=20`,
    `drawtext=fontfile='${fontPath}':text='${escapeDrawtext(title)}':fontcolor=white:fontsize=50:x=(w-text_w)/2:y=h/2-72`,
    `drawtext=fontfile='${fontPath}':text='${escapeDrawtext(subtitle)}':fontcolor=0xc9dad7:fontsize=28:x=(w-text_w)/2:y=h/2+16`,
  ].join(",");
  run(["-y", "-f", "lavfi", "-i", `color=c=0x101820:s=1280x720:d=${seconds}`, "-vf", vf, "-an", "-r", "30", output], `title ${title}`);
  return output;
}

function captionClip(input, outputName, caption, seconds = 7, options = {}) {
  const output = path.join(tempDir, outputName);
  const vf = [
    "scale=1280:720:force_original_aspect_ratio=decrease",
    "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x101820",
    "setsar=1",
    "drawbox=x=0:y=0:w=iw:h=76:color=0x101820@0.88:t=fill",
    `drawtext=fontfile='${fontPath}':text='GAMEFRAME':fontcolor=white:fontsize=38:x=48:y=22`,
    options.genericHitTitle
      ? [
          "drawbox=x=0:y=54:w=iw:h=148:color=0x101820@1:t=fill",
          `drawtext=fontfile='${fontPath}':text='GAMEFRAME HIT METRICS':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=96`,
          `drawtext=fontfile='${fontPath}':text='Sample player / sample hit':fontcolor=0xc9dad7:fontsize=28:x=(w-text_w)/2:y=150`,
        ].join(",")
      : null,
    "drawbox=x=0:y=h-92:w=iw:h=92:color=0x101820@0.76:t=fill",
    `drawtext=fontfile='${fontPath}':text='${escapeDrawtext(caption)}':fontcolor=white:fontsize=30:x=48:y=h-60`,
    "format=yuv420p",
  ].filter(Boolean).join(",");
  run(["-y", "-t", String(seconds), "-i", input, "-vf", vf, "-an", "-r", "30", output], `caption ${caption}`);
  return output;
}

function concatVideos(inputs, output) {
  const listPath = path.join(tempDir, `${path.basename(output)}.txt`);
  fs.writeFileSync(listPath, inputs.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  run(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", output], `concat ${output}`);
}

function getLatestRows() {
  const db = new Database(dbPath, { readonly: true });
  const matchup = db.prepare(`
    SELECT m.id, m.description, m.matchup_blob, pc.description AS pitch_description, sc.description AS swing_description
    FROM matchups m
    LEFT JOIN pitch_clips pc ON pc.id = m.pitch_clip_id
    LEFT JOIN swing_clips sc ON sc.id = m.swing_clip_id
    WHERE m.matchup_blob IS NOT NULL
    ORDER BY m.id DESC
    LIMIT 1
  `).get();
  const ev = db.prepare(`
    SELECT id, description, clip_blob, generated_clip_blob, generated_clip_path
    FROM ev_hit_tracks
    WHERE generated_clip_blob IS NOT NULL OR generated_clip_path IS NOT NULL OR clip_blob IS NOT NULL
    ORDER BY julianday(created_at) DESC, id DESC
    LIMIT 1
  `).get();
  return { matchup, ev };
}

function buildPitchTimingDemo(row) {
  if (!row?.matchup_blob) throw new Error("No current matchup video found in the library.");
  const matchupVideo = writeBlob(`matchup-${row.id}.mp4`, row.matchup_blob);
  const clips = [
    titleCard("pitch-current-00-title.mp4", "Pitch Timing", "Match pitch and swing videos for timing review."),
    captionClip(matchupVideo, "pitch-current-01-matchup.mp4", "Match separate pitch and swing clips to show timing at contact.", 8),
    titleCard("pitch-current-02-close.mp4", "Pitch Timing Library", "Saved matchups can be replayed, exported, and used for coaching review."),
  ];
  const output = path.join(outDir, "gameframe-pitch-timing-current-demo.mp4");
  concatVideos(clips, output);
  return output;
}

function buildHitMetricsDemo(row) {
  if (!row?.generated_clip_path && !row?.generated_clip_blob && !row?.clip_blob) {
    throw new Error("No current EV hit video found in the library.");
  }
  const sourceVideo = row.clip_blob ? writeBlob(`ev-source-${row.id}.mp4`, row.clip_blob) : null;
  const generatedVideo = existingVideoPath(row.generated_clip_path) || writeBlob(`ev-generated-${row.id}.mp4`, row.generated_clip_blob || row.clip_blob);
  const clips = [
    titleCard("ev-current-00-title.mp4", "Hit Metrics", "Estimate ball flight metrics from game video."),
    sourceVideo ? captionClip(sourceVideo, "ev-current-01-source.mp4", "Start with the selected source clip and guided setup.", 5) : null,
    captionClip(generatedVideo, "ev-current-02-generated.mp4", "Export a branded video with the measured flight path and metrics.", 8, { genericHitTitle: true }),
    titleCard("ev-current-03-close.mp4", "Hit Metrics Library", "Save source video, generated clip, JSON, and prediction together."),
  ].filter(Boolean);
  const output = path.join(outDir, "gameframe-hit-metrics-current-demo.mp4");
  concatVideos(clips, output);
  return output;
}

function buildOverviewDemo(pitch, ev) {
  const clips = [
    titleCard("overview-current-00-title.mp4", "GameFrame", "One app for pitch timing and hit metrics."),
    captionClip(pitch, "overview-current-01-pitch.mp4", "Pitch Timing shows when hitters need to make their move.", 7),
    captionClip(ev, "overview-current-02-ev.mp4", "Hit Metrics estimates ball flight from video and field geometry.", 7),
    titleCard("overview-current-03-close.mp4", "One Coaching Library", "Pitch timing and hit metrics stay linkable for review."),
  ];
  const output = path.join(outDir, "gameframe-overview-current-demo.mp4");
  concatVideos(clips, output);
  return output;
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const { matchup, ev } = getLatestRows();
  const pitch = buildPitchTimingDemo(matchup);
  const hitMetrics = buildHitMetricsDemo(ev);
  const overview = buildOverviewDemo(pitch, hitMetrics);
  console.log(JSON.stringify({ pitch, hitMetrics, overview }, null, 2));
}

main();
