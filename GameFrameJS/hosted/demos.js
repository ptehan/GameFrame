const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const tables = { pitch: ['pitch_clips', 'clip_blob'], swing: ['swing_clips', 'clip_blob'], matchup: ['matchups', 'matchup_blob'], ev: ['ev_hit_tracks', 'generated_clip_blob'] };
function openSeed(file) {
  if (!file || !fs.existsSync(file)) return null;
  const seed = new Database(file, { readonly: true });
  if (!seed.prepare("SELECT 1 FROM sqlite_master WHERE name='demo_manifest'").get()) { seed.close(); throw new Error('Demo seed is not an approved release artifact'); }
  return seed;
}
function list(file) {
  const db = openSeed(file); if (!db) return [];
  try { return db.prepare('SELECT type,id,label FROM demo_manifest ORDER BY type,id').all(); } finally { db.close(); }
}
function copy(file, databasePath, storageLimit) {
  const seed = openSeed(file); if (!seed) throw Object.assign(new Error('Approved demo footage is not loaded yet.'), { status: 503 });
  const target = new Database(databasePath);
  try {
    if (fs.statSync(file).size + fs.statSync(databasePath).size > storageLimit) throw Object.assign(new Error('Demo library exceeds your remaining storage allowance.'), { status: 413 });
    target.transaction(() => {
      for (const [table] of Object.values(tables)) {
        const exists = target.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (exists && target.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) throw Object.assign(new Error('Add demos to an empty library. Your existing clips will not be overwritten.'), { status: 409 });
      }
      for (const table of ['teams', 'pitchers', 'hitters']) {
        if (target.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) throw Object.assign(new Error('Demo import requires an empty workspace.'), { status: 409 });
      }
      for (const table of ['teams', 'pitchers', 'hitters', 'pitch_clips', 'swing_clips', 'matchups', 'ev_hit_tracks']) {
        const schema = seed.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (!schema) continue;
        target.exec(schema.sql.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'));
        for (const row of seed.prepare(`SELECT * FROM ${table}`).iterate()) {
          const keys = Object.keys(row);
          target.prepare(`INSERT INTO ${table}(${keys.map(k => `"${k}"`).join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(row));
        }
      }
    })();
  } finally { target.close(); seed.close(); }
}
function preview(file, type, id, req, res) {
  const item = tables[type]; if (!item) return res.sendStatus(404);
  const db = openSeed(file); if (!db) return res.sendStatus(404);
  try {
    if (!db.prepare('SELECT 1 FROM demo_manifest WHERE type=? AND id=?').get(type, id)) return res.sendStatus(404);
    const row = db.prepare(`SELECT ${item[1]} AS blob FROM ${item[0]} WHERE id=?`).get(id);
    if (!row?.blob) return res.sendStatus(404);
    const blob = row.blob;
    res.type('video/mp4').set('Accept-Ranges', 'bytes');
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (!match) return res.send(blob);
    const start = Number(match[1]), end = Math.min(match[2] ? Number(match[2]) : blob.length - 1, blob.length - 1);
    if (start > end || start >= blob.length) return res.status(416).set('Content-Range', `bytes */${blob.length}`).end();
    res.status(206).set('Content-Range', `bytes ${start}-${end}/${blob.length}`).send(blob.subarray(start, end + 1));
  } finally { db.close(); }
}
module.exports = { list, copy, preview };
