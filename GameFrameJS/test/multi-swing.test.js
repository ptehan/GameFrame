const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const Database = require("better-sqlite3");
const vm = require("node:vm");

test("multi-swing clips retain contact and return through the pending queue", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gameframe-multi-test-"));
  const databasePath = path.join(directory, "gameframe.db");
  const sourcePath = path.join(directory, "source.mp4");
  process.env.DB_PATH = databasePath;
  process.env.GAMEFRAME_DESKTOP = "0";
  process.env.FFMPEG_PATH = require("ffmpeg-static");
  process.env.FFPROBE_PATH = require("ffprobe-static").path;
  const made = spawnSync(process.env.FFMPEG_PATH, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:r=30:d=4",
    "-f", "lavfi", "-i", "sine=frequency=900:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath]);
  assert.equal(made.status, 0);

  const { startServer, closeDatabase } = require("../server");
  const seed = new Database(databasePath);
  const team = seed.prepare("INSERT INTO teams (name) VALUES (?)").run("Test Team");
  const hitter = seed.prepare("INSERT INTO hitters (team_id, name) VALUES (?, ?)").run(team.lastInsertRowid, "Test Hitter");
  const pitcher = seed.prepare("INSERT INTO pitchers (team_id, name) VALUES (?, ?)").run(team.lastInsertRowid, "Test Pitcher");
  seed.close();
  const server = startServer(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const analyzeForm = new FormData();
    analyzeForm.set("team_id", String(team.lastInsertRowid));
    analyzeForm.set("hitter_id", String(hitter.lastInsertRowid));
    analyzeForm.set("description", "Bulk swing");
    analyzeForm.set("file", new Blob([fs.readFileSync(sourcePath)], { type: "video/mp4" }), "source.mp4");
    const analyzedResponse = await fetch(`${base}/multi-swing/analyze`, { method: "POST", body: analyzeForm });
    assert.equal(analyzedResponse.status, 200);
    const analyzed = await analyzedResponse.json();
    assert.ok(analyzed.temp_id);
    assert.equal(Math.round(analyzed.fps), 30);

    const splitResponse = await fetch(`${base}/multi-swing/split`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temp_id: analyzed.temp_id, markers: [2, 3], suggested: [2.1], source_name: "source.mp4", team_id: team.lastInsertRowid,
        hitter_id: hitter.lastInsertRowid, description: "Bulk swing", swing_type: "game", video_created_at: "2026-08-01T12:00:00Z" }) });
    assert.equal(splitResponse.status, 200);
    const split = await splitResponse.json();
    const reviewLog = fs.readFileSync(path.join(directory, "contact-review-history.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(reviewLog[0].kind, "swing");
    assert.equal(reviewLog[0].suggested[0].frame, 63);
    assert.equal(reviewLog[0].approved[0].frame, 60);
    const pendingId = split.ids[0];
    const deleteResponse = await fetch(`${base}/multi-swing/pending/delete`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id: String(split.ids[1]), sid: "x" }), redirect: "manual",
    });
    assert.equal(deleteResponse.status, 303);
    assert.match(deleteResponse.headers.get("location"), /\/library\?.*type=swing/);
    const check = new Database(databasePath);
    const pending = check.prepare("SELECT * FROM pending_swing_clips WHERE id=?").get(pendingId);
    assert.equal(pending.status, "pending");
    assert.equal(pending.contact_frame, 60);
    assert.equal(pending.swing_type, "game");
    assert.equal(check.prepare("SELECT COUNT(*) AS count FROM pending_swing_clips WHERE id=?").get(split.ids[1]).count, 0);
    check.close();
    const pendingLibraryResponse = await fetch(`${base}/library/data?type=swing&sid=x`);
    assert.equal(pendingLibraryResponse.status, 200);
    const pendingLibrary = await pendingLibraryResponse.json();
    assert.equal(pendingLibrary.some((item) => item.id === pendingId && item.is_pending === 1), true);

    const tagResponse = await fetch(`${base}/multi-swing/pending/tag?id=${pendingId}&sid=x`, { redirect: "manual" });
    assert.equal(tagResponse.status, 303);
    const location = tagResponse.headers.get("location");
    assert.match(location, /preset_contact_frame=60/);
    const tempId = new URL(location, base).searchParams.get("temp_id");
    const exactFramesResponse = await fetch(`${base}/api/raw/tag-frames?id=${tempId}`);
    assert.equal(exactFramesResponse.status, 200);
    const exactFrames = new Uint8Array(await exactFramesResponse.arrayBuffer());
    let jpegStarts = 0;
    for (let i = 0; i < exactFrames.length - 1; i += 1) {
      if (exactFrames[i] === 0xff && exactFrames[i + 1] === 0xd8) jpegStarts += 1;
    }
    assert.equal(jpegStarts, 91);
    const helperSource = fs.readFileSync(path.join(__dirname, "../static/js/tag-frames.js"), "utf8");
    const helper = vm.runInNewContext(`${helperSource}\nloadExactTagFrames`, {
      window: {},
      setTimeout: () => 0,
      fetch: (url) => fetch(`${base}${url}`),
      Blob,
      Uint8Array,
      createImageBitmap: async (blob) => ({ size: blob.size }),
    });
    let lastProgress = 0;
    const decodedFrames = await helper(tempId, (done) => { lastProgress = done; });
    assert.equal(decodedFrames.length, 91);
    assert.equal(lastProgress, 91);
    const finalize = new FormData();
    finalize.set("sid", "x"); finalize.set("temp_id", tempId); finalize.set("team_id", String(team.lastInsertRowid));
    finalize.set("hitter_id", String(hitter.lastInsertRowid)); finalize.set("description", "Bulk swing 1");
    finalize.set("swing_type", "game");
    finalize.set("fps", "30"); finalize.set("start_frame", "10"); finalize.set("decision_frame_source", "50");
    finalize.set("contact_frame", "60"); finalize.set("pending_id", String(pendingId));
    const finalizedResponse = await fetch(`${base}/upload/swing/finalize`, { method: "POST", body: finalize });
    assert.equal(finalizedResponse.status, 200);
    const verified = new Database(databasePath, { readonly: true });
    assert.equal(verified.prepare("SELECT COUNT(*) AS count FROM pending_swing_clips WHERE id=?").get(pendingId).count, 0);
    const completedSwingId = verified.prepare("SELECT id FROM swing_clips ORDER BY id DESC LIMIT 1").get().id;
    assert.ok(completedSwingId > 0);
    assert.equal(verified.prepare("SELECT swing_type FROM swing_clips WHERE id=?").get(completedSwingId).swing_type, "game");
    verified.close();
    const finalizedLibrary = await (await fetch(`${base}/library/data?type=swing&sid=x`)).json();
    assert.equal(finalizedLibrary.some((item) => item.id === pendingId && item.is_pending === 1), false);

    const pitchAnalyzeForm = new FormData();
    pitchAnalyzeForm.set("team_id", String(team.lastInsertRowid));
    pitchAnalyzeForm.set("pitcher_id", String(pitcher.lastInsertRowid));
    pitchAnalyzeForm.set("description", "Bullpen");
    pitchAnalyzeForm.set("video_created_at", "2026-07-04T15:30:00Z");
    pitchAnalyzeForm.set("file", new Blob([fs.readFileSync(sourcePath)], { type: "video/mp4" }), "pitches.mp4");
    const pitchAnalyzedResponse = await fetch(`${base}/multi-pitch/analyze`, { method: "POST", body: pitchAnalyzeForm });
    assert.equal(pitchAnalyzedResponse.status, 200);
    const pitchAnalyzed = await pitchAnalyzedResponse.json();
    const pitchSplitResponse = await fetch(`${base}/multi-pitch/split`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temp_id: pitchAnalyzed.temp_id, markers: [2], team_id: team.lastInsertRowid,
        pitcher_id: pitcher.lastInsertRowid, description: "Bullpen", video_created_at: pitchAnalyzed.video_created_at }) });
    assert.equal(pitchSplitResponse.status, 200);
    const pitchPendingId = (await pitchSplitResponse.json()).ids[0];
    const pitchTagResponse = await fetch(`${base}/multi-pitch/pending/tag?id=${pitchPendingId}&sid=x`, { redirect: "manual" });
    assert.equal(pitchTagResponse.status, 303);
    const pitchLocation = pitchTagResponse.headers.get("location");
    assert.match(pitchLocation, /preset_contact_frame=60/);
    const pitchTempId = new URL(pitchLocation, base).searchParams.get("temp_id");
    const pitchFramesResponse = await fetch(`${base}/api/raw/tag-frames?id=${pitchTempId}`);
    assert.equal(pitchFramesResponse.status, 200);
    const pitchFrames = new Uint8Array(await pitchFramesResponse.arrayBuffer());
    let pitchJpegs = 0;
    for (let i = 0; i < pitchFrames.length - 1; i += 1) {
      if (pitchFrames[i] === 0xff && pitchFrames[i + 1] === 0xd8) pitchJpegs += 1;
    }
    assert.equal(pitchJpegs, 91);
    const pitchFinalize = new FormData();
    pitchFinalize.set("sid", "x"); pitchFinalize.set("temp_id", pitchTempId); pitchFinalize.set("team_id", String(team.lastInsertRowid));
    pitchFinalize.set("pitcher_id", String(pitcher.lastInsertRowid)); pitchFinalize.set("description", "Bullpen 1");
    pitchFinalize.set("fps", "30"); pitchFinalize.set("contact_frame", "60"); pitchFinalize.set("pending_pitch_id", String(pitchPendingId));
    pitchFinalize.set("video_created_at", pitchAnalyzed.video_created_at);
    const pitchFinalizedResponse = await fetch(`${base}/upload/pitch/finalize`, { method: "POST", body: pitchFinalize });
    assert.equal(pitchFinalizedResponse.status, 200);
    const pitchVerified = new Database(databasePath, { readonly: true });
    assert.equal(pitchVerified.prepare("SELECT COUNT(*) AS count FROM pending_pitch_clips WHERE id=?").get(pitchPendingId).count, 0);
    const completedPitchId = pitchVerified.prepare("SELECT id FROM pitch_clips ORDER BY id DESC LIMIT 1").get().id;
    assert.ok(completedPitchId > 0);
    const libraryPitch = pitchVerified.prepare("SELECT description, video_created_at FROM pitch_clips WHERE id=?").get(completedPitchId);
    assert.equal(libraryPitch.description, "Bullpen 1");
    assert.ok(libraryPitch.video_created_at);
    pitchVerified.close();

    const bulkBody = { pitch_ids: [completedPitchId], swing_ids: [completedSwingId], description: "Bulk test" };
    const bulkResponse = await fetch(`${base}/matchup/bulk`, { method: "POST", headers: { "Content-Type": "application/json", "Connection": "close" }, body: JSON.stringify(bulkBody) });
    assert.equal(bulkResponse.status, 404, 'Bulk matchup creation was deliberately removed.');
    const singleResponse = await fetch(`${base}/matchup/create`, {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({pitch_id:completedPitchId,swing_id:completedSwingId,description:'CODEX TEST single matchup'})});
    assert.equal(singleResponse.status,200,await singleResponse.clone().text());
    const matchup = await singleResponse.json();
    const bestDb = new Database(databasePath);
    bestDb.prepare("UPDATE swing_clips SET is_best=1 WHERE id=?").run(completedSwingId);
    bestDb.close();
    const matchupLibrary = await (await fetch(`${base}/library/data?type=matchup&sid=x`)).json();
    assert.equal(matchupLibrary.find((item) => item.id === matchup.id).swing_is_best, 1);

    const collisionDb = new Database(databasePath);
    collisionDb.prepare(`INSERT INTO pending_swing_clips
      (id, batch_id, team_id, hitter_id, description, clip_blob, fps, contact_frame, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
      .run(completedSwingId, "collision-test", team.lastInsertRowid, hitter.lastInsertRowid,
        "Pending with same ID", fs.readFileSync(sourcePath), 30, 60);
    collisionDb.close();
    const bulkDelete = await fetch(`${base}/library/bulk-delete`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ sid: "x", type: "swing", ids: `pending:${completedSwingId}` }),
      redirect: "manual",
    });
    assert.equal(bulkDelete.status, 303);
    const afterBulk = new Database(databasePath, { readonly: true });
    assert.equal(afterBulk.prepare("SELECT COUNT(*) AS count FROM pending_swing_clips WHERE id=?").get(completedSwingId).count, 0);
    assert.equal(afterBulk.prepare("SELECT COUNT(*) AS count FROM swing_clips WHERE id=?").get(completedSwingId).count, 1);
    afterBulk.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
