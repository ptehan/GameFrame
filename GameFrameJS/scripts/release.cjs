const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createApplication } = require('../server');
const { normalizeEmail, ensureUsageSchema } = require('../usage-auth');
const store = require('../hosted/store');
const backups = require('../hosted/backups');
const root = path.resolve(__dirname, '..');
const [command, ...args] = process.argv.slice(2);
function open(file, readonly = false) { return new Database(path.resolve(file), { readonly, fileMustExist: readonly }); }
function table(db, name) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
function inventory(file) {
  const db = open(file, true);
  try {
    const result = { generated_at: new Date().toISOString(), database_bytes: fs.statSync(file).size, tables: {}, candidates: {} };
    for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      result.tables[row.name] = db.prepare(`SELECT COUNT(*) n FROM "${row.name.replaceAll('"', '""')}"`).get().n;
    }
    for (const [type, name, blob] of [['pitch', 'pitch_clips', 'clip_blob'], ['swing', 'swing_clips', 'clip_blob'], ['matchup', 'matchups', 'matchup_blob'], ['ev', 'ev_hit_tracks', 'clip_blob']]) {
      if (table(db, name)) result.candidates[type] = db.prepare(`SELECT id,length(${blob}) bytes FROM ${name} ORDER BY id`).all();
    }
    return result;
  } finally { db.close(); }
}
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/path|email|player|hitter|team|description|file_name|identity|debug|stdout/i.test(key))
    .map(([key, item]) => [key, sanitize(item)]));
  return value;
}
async function seed(sourceFile, manifestFile, destination) {
  sourceFile = path.resolve(sourceFile); destination = path.resolve(destination);
  if (sourceFile === destination || fs.existsSync(destination)) throw new Error('Seed destination must be new and separate from the working database');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (!Array.isArray(manifest.clips) || !manifest.clips.length) throw new Error('No approved demo clips. Complete the footage register first.');
  for (const clip of manifest.clips) {
    if (clip.permission !== 'approved' || !clip.owner || !clip.permission_evidence || !clip.app_distribution || !Number.isInteger(clip.id)) throw new Error('Each clip requires documented owner permission for app distribution');
  }
  const source = open(sourceFile, true);
  const app = createApplication({ databasePath: destination, dataDirectory: path.dirname(destination), hostedWorkspace: true });
  const target = open(destination);
  try {
    if (table(source, 'ev_hit_tracks')) {
      const schema = source.prepare("SELECT sql FROM sqlite_master WHERE name='ev_hit_tracks'").get().sql;
      target.exec(schema.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'));
    }
    target.exec('CREATE TABLE demo_manifest(type TEXT,id INTEGER,label TEXT,permission_evidence TEXT,PRIMARY KEY(type,id))');
    const names = { pitch: 'pitch_clips', swing: 'swing_clips', matchup: 'matchups', ev: 'ev_hit_tracks' };
    target.transaction(() => {
      const team = target.prepare("INSERT INTO teams(name,description) VALUES('Demo library','Approved demonstration examples')").run().lastInsertRowid;
      const actors = new Map();
      function actor(kind, originalId, clipId) {
        const key = `${kind}:${originalId || 'clip-' + clipId}`;
        if (!actors.has(key)) {
          const table = kind === 'pitcher' ? 'pitchers' : 'hitters';
          const number = [...actors.keys()].filter(k => k.startsWith(kind + ':')).length + 1;
          const id = target.prepare(`INSERT INTO ${table}(team_id,name,description) VALUES(?,?,?)`).run(team, `Demo ${kind} ${number}`, 'Demonstration identity; personal name removed').lastInsertRowid;
          actors.set(key, id);
        }
        return actors.get(key);
      }
      for (const clip of [...manifest.clips].sort((a, b) => Number(a.type === 'matchup') - Number(b.type === 'matchup'))) {
        const name = names[clip.type];
        if (!name) throw new Error('Unknown demo clip type');
        const row = source.prepare(`SELECT * FROM ${name} WHERE id=?`).get(clip.id);
        if (!row) throw new Error('Approved demo clip not found');
        if (clip.type === 'matchup' && (!target.prepare('SELECT id FROM pitch_clips WHERE id=?').get(row.pitch_clip_id) || !target.prepare('SELECT id FROM swing_clips WHERE id=?').get(row.swing_clip_id))) throw new Error('Matchup dependencies must also be approved and selected');
        if (clip.type === 'ev' && !row.prediction_json) throw new Error('EV demos require a saved matching prediction');
        const columns = new Set(target.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name));
        const cleaned = {};
        for (let [key, value] of Object.entries(row)) {
          if (!columns.has(key)) continue;
          if (/path|request_key|request_hash|render_token|render_error/.test(key)) value = null;
          if (['team_id', 'pitcher_id', 'hitter_id'].includes(key)) value = null;
          if (key === 'description') value = `Demo: ${clip.label || clip.type + ' ' + clip.id}`;
          if (key === 'source_file_name') value = `demo-${clip.id}.mp4`;
          if (key === 'observation_package_json' || key === 'prediction_json') value = JSON.stringify(sanitize(JSON.parse(value || '{}')));
          cleaned[key] = value;
        }
        if ('team_id' in cleaned) cleaned.team_id = team;
        if ('pitcher_id' in cleaned) cleaned.pitcher_id = actor('pitcher', row.pitcher_id, clip.id);
        if ('hitter_id' in cleaned) cleaned.hitter_id = actor('hitter', row.hitter_id, clip.id);
        if ('source_id' in cleaned) cleaned.source_id = null;
        const keys = Object.keys(cleaned);
        target.prepare(`INSERT INTO ${name} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(cleaned));
        target.prepare('INSERT INTO demo_manifest VALUES(?,?,?,?)').run(clip.type, clip.id, clip.label || `Demo ${clip.id}`, clip.permission_evidence);
      }
      for (const name of ['auth_accounts', 'auth_sessions', 'auth_codes', 'registered_devices', 'licenses', 'usage_events', 'app_settings']) {
        if (table(target, name)) target.exec(`DELETE FROM ${name}`);
      }
    })();
    if (target.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Seed database failed integrity verification');
    return inventory(destination);
  } finally { target.close(); app.closeDatabase(); source.close(); }
}
async function main() {
  if (command === 'init') {
    const destination = path.resolve(args[0]);
    if (fs.existsSync(destination)) throw new Error('Starter database destination must be new');
    const app = createApplication({ databasePath: destination, dataDirectory: path.dirname(destination), hostedWorkspace: true });
    app.closeDatabase();
    console.log('Created an empty release starter. No footage or customer data was copied.'); return;
  }
  if (command === 'inventory') {
    const result = inventory(path.resolve(args[0] || path.join(root, 'app.db')));
    if (args[1]) fs.writeFileSync(args[1], JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2)); return;
  }
  if (command === 'backup-db') {
    const source = open(args[0], true);
    try {
      if (fs.existsSync(args[1])) throw new Error('Backup destination exists');
      fs.mkdirSync(path.dirname(path.resolve(args[1])), { recursive: true });
      await source.backup(args[1]);
      console.log('Database backup created.');
    } finally { source.close(); } return;
  }
  if (command === 'seed') { console.log(JSON.stringify(await seed(...args), null, 2)); return; }
  if (command === 'verify-backup') { console.log(JSON.stringify(await backups.verify(args[0]), null, 2)); return; }
  if (command === 'restore') {
    await backups.verify(args[0]);
    if (fs.existsSync(args[1])) throw new Error('Restore only into a new directory; stop the service before switching directories.');
    fs.cpSync(args[0], args[1], { recursive: true, errorOnExist: true });
    console.log('Restored to a new directory. Verify before changing GAMEFRAME_DATA_DIR.'); return;
  }
  if (['invite', 'gate', 'readiness'].includes(command)) {
    const db = open(args[0]);
    try {
      ensureUsageSchema(db); store.initialize(db);
      if (command === 'invite') {
        const email = normalizeEmail(args[1]); if (!email) throw new Error('A valid invitation email is required');
        db.prepare('INSERT OR IGNORE INTO hosted_invites VALUES(?)').run(email); console.log('Invitation recorded.');
      } else if (command === 'gate') {
        if (!store.REQUIRED_GATES.includes(args[1]) || !args[2]) throw new Error('Gate name and evidence file are required');
        const evidence = fs.readFileSync(args[2], 'utf8');
        if (!evidence.trim()) throw new Error('Gate evidence cannot be empty');
        db.prepare('INSERT OR REPLACE INTO hosted_gates VALUES(?,?,?)').run(args[1], new Date().toISOString(), evidence);
        console.log('Release gate evidence recorded.');
      } else console.log(JSON.stringify({ missing_gates: store.missingGates(db), sales_flag: process.env.GAMEFRAME_SALES_OPEN === 'true' }, null, 2));
    } finally { db.close(); } return;
  }
  throw new Error('Usage: release.cjs init new-db | inventory [db] [json] | backup-db source dest | seed source manifest dest | invite accounts.db email | readiness accounts.db | gate accounts.db name evidence-file | verify-backup directory | restore backup new-directory');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { inventory, seed, sanitize };
