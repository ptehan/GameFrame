const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { within } = require('./backups');
const { diskBytes } = require('./store');
function cleanup(directory) {
  const references = [];
  const db = new Database(path.join(directory, 'app.db'), { readonly: true });
  try {
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      const table = `"${name.replaceAll('"', '""')}"`;
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().filter(c => /path|json|pose_data/i.test(c.name));
      if (!columns.length) continue;
      for (const row of db.prepare(`SELECT ${columns.map(c => `"${c.name.replaceAll('"', '""')}"`).join(',')} FROM ${table}`).iterate()) {
        for (const value of Object.values(row)) if (typeof value === 'string') references.push(value);
      }
    }
  } finally { db.close(); }
  let removed = 0;
  function visit(folder) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const target = path.resolve(folder, entry.name);
      if (!within(directory, target) || entry.isSymbolicLink()) throw new Error('Unsafe workspace cleanup path');
      if (entry.isDirectory()) { visit(target); continue; }
      if (references.some(value => value.includes(entry.name))) continue;
      removed += fs.statSync(target).size;
      fs.unlinkSync(target);
    }
  }
  // Explicit user action: unsaved sessions can be discarded, saved source
  // references are preserved. No customer database or source-videos tree is removed.
  for (const name of ['temporary', 'ev/clips', 'ev/live']) visit(path.join(directory, name));
  return { removed_bytes: removed, storage_used: diskBytes(directory) };
}
module.exports = { cleanup };
