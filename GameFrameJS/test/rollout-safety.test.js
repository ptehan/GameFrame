const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

test("desktop backup downloads and restores the local baseball library", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gameframe-backup-test-"));
  const databasePath = path.join(directory, "gameframe.db");
  const seed = new Database(databasePath);
  seed.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)");
  seed.prepare("INSERT INTO app_settings (key, value) VALUES ('auth_token', 'test-local-token')").run();
  seed.close();

  process.env.DB_PATH = databasePath;
  process.env.GAMEFRAME_DESKTOP = "1";
  process.env.GAMEFRAME_API_URL = "http://127.0.0.1:1";
  delete process.env.NODE_ENV;

  const { startServer, closeDatabase } = require("../server");
  const server = startServer(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const settings = await fetch(`${base}/settings/data`);
    assert.equal(settings.status, 200);

    const backupResponse = await fetch(`${base}/settings/data/backup`);
    assert.equal(backupResponse.status, 200);
    const backupBytes = await backupResponse.arrayBuffer();
    assert.ok(backupBytes.byteLength > 0);

    const live = new Database(databasePath);
    live.prepare("INSERT INTO teams (name, description) VALUES (?, ?)").run("REMOVE BY RESTORE", "test marker");
    assert.equal(live.prepare("SELECT COUNT(*) AS count FROM teams WHERE name='REMOVE BY RESTORE'").get().count, 1);
    live.close();

    const form = new FormData();
    form.set("backup", new Blob([backupBytes], { type: "application/octet-stream" }), "GameFrame-backup.db");
    const restoreResponse = await fetch(`${base}/settings/data/restore`, { method: "POST", body: form, redirect: "manual" });
    assert.equal(restoreResponse.status, 303);

    const verified = new Database(databasePath, { readonly: true });
    assert.equal(verified.prepare("SELECT COUNT(*) AS count FROM teams WHERE name='REMOVE BY RESTORE'").get().count, 0);
    assert.equal(verified.prepare("SELECT value FROM app_settings WHERE key='auth_token'").get().value, "test-local-token");
    verified.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
