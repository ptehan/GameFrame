const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');
const { createApplication } = require('../server');
const { seed } = require('../scripts/release.cjs');
const demos = require('../hosted/demos');

test('release seed requires permissions, excludes credentials, sanitizes metadata and makes private demo copies', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-release-test-'));
  const sourcePath = path.join(root, 'source.db');
  const sourceApp = createApplication({ databasePath: sourcePath, dataDirectory: path.join(root, 'source'), hostedWorkspace: true });
  const source = new Database(sourcePath);
  source.exec("CREATE TABLE auth_accounts(id,email); INSERT INTO auth_accounts VALUES('secret-account','private@example.invalid')");
  source.prepare("INSERT INTO pitch_clips(id,description,clip_blob) VALUES(1,'Personal title',?)").run(Buffer.from('example-video'));
  source.exec('CREATE TABLE ev_hit_tracks(id INTEGER PRIMARY KEY,description TEXT,source_file_name TEXT,source_video_path TEXT,observation_package_json TEXT,prediction_json TEXT,clip_blob BLOB,generated_clip_blob BLOB)');
  source.prepare('INSERT INTO ev_hit_tracks VALUES(?,?,?,?,?,?,?,?)').run(2, 'Personal EV', 'personal-name.mp4', 'C:/private/other.mp4',
    JSON.stringify({ video_metadata: { source_path: 'C:/private/other.mp4', file_name: 'personal-name.mp4', width_px: 1920 }, hit: { description: 'private name' } }),
    JSON.stringify({ ev_candidates: [{ hit_id: 'flight-1', exit_velocity_mph: 80 }], _debug: { output_path: 'C:/private/output' } }), Buffer.from('source'), Buffer.from('generated'));
  const before = source.prepare('SELECT description FROM pitch_clips WHERE id=1').get().description;
  const manifestPath = path.join(root, 'permissions.json'), destination = path.join(root, 'seed', 'demo.db');
  fs.writeFileSync(manifestPath, JSON.stringify({ clips: [{ type: 'pitch', id: 1, permission: 'pending' }] }));
  await assert.rejects(seed(sourcePath, manifestPath, destination), /permission/);
  assert.equal(fs.existsSync(destination), false);
  const approval = { permission: 'approved', owner: 'Test owner', permission_evidence: 'test-consent', app_distribution: true };
  fs.writeFileSync(manifestPath, JSON.stringify({ clips: [{ ...approval, type: 'pitch', id: 1 }, { ...approval, type: 'ev', id: 2 }] }));
  try {
    await seed(sourcePath, manifestPath, destination);
    const result = new Database(destination, { readonly: true });
    assert.equal(result.prepare("SELECT 1 FROM sqlite_master WHERE name='auth_accounts'").get(), undefined);
    const ev = result.prepare('SELECT * FROM ev_hit_tracks').get();
    assert.equal(ev.source_video_path, null); assert.doesNotMatch(ev.observation_package_json, /private|personal-name/);
    assert.doesNotMatch(ev.prediction_json, /private|output_path/);
    assert.equal(result.prepare('SELECT COUNT(*) n FROM demo_manifest').get().n, 2);
    result.close();
    const privatePath = path.join(root, 'private', 'app.db');
    const privateApp = createApplication({ databasePath: privatePath, dataDirectory: path.join(root, 'private'), hostedWorkspace: true });
    try {
      demos.copy(destination, privatePath, 250 * 1024 ** 2);
      const copy = new Database(privatePath); copy.prepare("UPDATE pitch_clips SET description='My private edit'").run(); copy.close();
      const canonical = new Database(destination, { readonly: true });
      assert.match(canonical.prepare('SELECT description FROM pitch_clips').get().description, /^Demo:/); canonical.close();
      assert.throws(() => demos.copy(destination, privatePath, 250 * 1024 ** 2), /empty library/);
    } finally { privateApp.closeDatabase(); }
    assert.equal(source.prepare('SELECT description FROM pitch_clips WHERE id=1').get().description, before);
    assert.equal(source.prepare('SELECT email FROM auth_accounts').get().email, 'private@example.invalid');
    await assert.rejects(seed(sourcePath, manifestPath, destination), /must be new/);
  } finally { source.close(); sourceApp.closeDatabase(); }
});

test('off-service backup rotation, retry staging and restore operate on verified snapshots', async () => {
  const backups = require('../hosted/backups');
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-backup-rotation-'));
  const source = path.join(root, 'source'), staging = path.join(root, 'staging'), remote = path.join(root, 'remote');
  fs.mkdirSync(source); fs.mkdirSync(remote);
  const db = new Database(path.join(source, 'app.db')); db.exec('CREATE TABLE sample(id);INSERT INTO sample VALUES(7)');
  fs.writeFileSync(path.join(source, 'clip.mp4'), 'retained-video');
  for (let n = 1; n <= 8; n++) fs.mkdirSync(path.join(remote, `2026-10-0${n}T00-00-00-000Z`));
  const prefix = 'test:gameframe-backups';
  const destination = value => {
    const suffix = value.slice(prefix.length).replace(/^\//, '');
    const file = path.resolve(remote, suffix);
    if (file !== remote && !backups.within(remote, file)) throw new Error('Unsafe mock remote target');
    return file;
  };
  async function transport(args) {
    if (args[0] === 'copy') fs.cpSync(args[1], destination(args[2]), { recursive: true });
    if (args[0] === 'check') await backups.verify(destination(args[2]));
    if (args[0] === 'lsf') return { status: 0, stdout: fs.readdirSync(remote).map(n => n + '/').join('\n') };
    if (args[0] === 'purge') fs.rmSync(destination(args[1]), { recursive: true });
    return { status: 0, stdout: '' };
  }
  try {
    const snapshot = await backups.nightly(source, staging, prefix, transport);
    assert.equal(fs.readdirSync(remote).length, 7);
    assert.equal(fs.readdirSync(staging).length, 1);
    await assert.rejects(backups.nightly(source, staging, prefix, async () => ({ status: 1 })), /transfer failed/);
    assert.equal(fs.readdirSync(staging).length, 1, 'remote outages do not accumulate full local snapshots');
    const restored = path.join(root, 'restored');
    const result = spawnSync(process.execPath, ['scripts/release.cjs', 'restore', snapshot, restored], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(restored, 'clip.mp4'), 'utf8'), 'retained-video');
    const restoredDb = new Database(path.join(restored, 'app.db'), { readonly: true });
    assert.equal(restoredDb.prepare('SELECT id FROM sample').get().id, 7); restoredDb.close();
    const overwrite = spawnSync(process.execPath, ['scripts/release.cjs', 'restore', snapshot, restored], { encoding: 'utf8', windowsHide: true });
    assert.equal(overwrite.status, 1);
    await assert.rejects(backups.nightly(source, staging, 'test:', transport), /dedicated/);
  } finally { db.close(); }
});
