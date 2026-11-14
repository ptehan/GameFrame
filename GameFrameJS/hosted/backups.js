const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { spawn } = require('node:child_process');
async function rclone(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('rclone', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => child.kill(), 1800000); timeout.unref();
    child.stdout.on('data', data => { if (stdout.length < 2 * 1024 ** 2) stdout += data.toString(); });
    child.stderr.on('data', data => { if (stderr.length < 8192) stderr += data.toString(); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', (status, signal) => { clearTimeout(timeout); resolve({ status, stdout, stderr, signal }); });
  });
}

function within(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}
async function snapshot(source, destination) {
  source = path.resolve(source); destination = path.resolve(destination);
  if (destination === source || within(source, destination)) throw new Error('Backup destination must be outside the source');
  if (fs.existsSync(destination)) throw new Error('Backup destination already exists');
  fs.mkdirSync(destination, { recursive: true });
  const manifest = [];
  async function copy(folder, relative = '') {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Symbolic links cannot be backed up');
      const name = path.join(relative, entry.name), from = path.join(source, name), to = path.join(destination, name);
      if (entry.isDirectory()) { fs.mkdirSync(to, { recursive: true }); await copy(from, name); continue; }
      if (name === 'backup-manifest.json' || /\.(?:db|sqlite)-(?:wal|shm|journal)$/.test(name)) continue;
      if (/\.(?:db|sqlite)$/.test(name)) {
        const db = new Database(from, { readonly: true });
        try { await db.backup(to); } finally { db.close(); }
      } else fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(to)) hash.update(chunk);
      manifest.push({ path: name.split(path.sep).join('/'), size: fs.statSync(to).size, sha256: hash.digest('hex') });
    }
  }
  await copy(source);
  fs.writeFileSync(path.join(destination, 'backup-manifest.json'), JSON.stringify({ created_at: new Date().toISOString(), files: manifest }, null, 2));
  return destination;
}
async function verify(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'backup-manifest.json'), 'utf8'));
  for (const file of manifest.files) {
    const target = path.resolve(directory, file.path);
    if (!within(directory, target)) throw new Error('Unsafe backup entry');
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(target)) hash.update(chunk);
    if (fs.statSync(target).size !== file.size || hash.digest('hex') !== file.sha256) throw new Error(`Backup verification failed: ${file.path}`);
    if (/\.(?:db|sqlite)$/.test(file.path)) {
      const db = new Database(target, { readonly: true });
      try { if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Database integrity check failed'); }
      finally { db.close(); }
    }
  }
  return manifest;
}
async function nightly(source, backupRoot, remote, runRclone = rclone) {
  if (!/^[A-Za-z0-9_-]+:(?:[^/]+\/)*gameframe-backups\/?$/.test(remote || '')) throw new Error('BACKUP_REMOTE must be a dedicated remote:.../gameframe-backups prefix');
  fs.mkdirSync(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const previous = fs.readdirSync(backupRoot).filter(n => /^\d{4}-\d\d-\d\dT[\dTZ-]+$/.test(n)).sort().reverse()[0];
  let target;
  if (previous) {
    const candidate = path.join(backupRoot, previous), manifest = path.join(candidate, 'backup-manifest.json');
    if (fs.existsSync(manifest) && Date.now() - Date.parse(JSON.parse(fs.readFileSync(manifest)).created_at) < 23 * 3600000) target = candidate;
  }
  if (!target) target = await snapshot(source, path.join(backupRoot, stamp));
  await verify(target);
  // Bound staging space even during a prolonged remote outage. A verified local
  // snapshot can be retried without copying the entire workspace every hour.
  for (const name of fs.readdirSync(backupRoot).filter(n => /^\d{4}-\d\d-\d\dT[\dTZ-]+$/.test(n))) {
    const old = path.resolve(backupRoot, name);
    if (old !== path.resolve(target) && within(backupRoot, old)) fs.rmSync(old, { recursive: true });
  }
  const remoteStamp = path.basename(target);
  if (!remote) throw new Error('BACKUP_REMOTE must identify off-service storage');
  const copied = await runRclone(['copy', target, `${remote.replace(/\/$/, '')}/${remoteStamp}`, '--immutable']);
  if (copied.error || copied.status !== 0) throw new Error('Off-service backup transfer failed');
  const checked = await runRclone(['check', target, `${remote.replace(/\/$/, '')}/${remoteStamp}`, '--download']);
  if (checked.error || checked.status !== 0) throw new Error('Off-service backup verification failed');
  // Delete only verified, timestamp-named local snapshots under the explicit root.
  const names = fs.readdirSync(backupRoot).filter(n => /^\d{4}-\d\d-\d\dT[\dTZ-]+$/.test(n)).sort().reverse();
  for (const name of names.slice(1)) {
    const old = path.resolve(backupRoot, name);
    if (!within(backupRoot, old)) throw new Error('Unsafe backup cleanup path');
    fs.rmSync(old, { recursive: true });
  }
  // BACKUP_REMOTE is a dedicated GameFrame prefix, never a bucket root.
  const listing = await runRclone(['lsf', remote, '--dirs-only']);
  if (listing.error || listing.status !== 0) throw new Error('Could not list remote backup retention points');
  const remoteNames = listing.stdout.split(/\r?\n/).map(n => n.replace(/\/$/, '')).filter(n => /^\d{4}-\d\d-\d\dT[\dTZ-]+$/.test(n)).sort().reverse();
  for (const name of remoteNames.slice(7)) {
    const removed = await runRclone(['purge', `${remote.replace(/\/$/, '')}/${name}`]);
    if (removed.error || removed.status !== 0) throw new Error('Remote backup retention cleanup failed');
  }
  return target;
}
module.exports = { snapshot, verify, nightly, within, rclone };
