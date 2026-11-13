const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function createPitchSourceStore(db, directory) {
  db.exec(`CREATE TABLE IF NOT EXISTS pitch_video_sources (
    id TEXT PRIMARY KEY, original_file_name TEXT NOT NULL, stored_file_name TEXT NOT NULL,
    sha256 TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  function get(id) {
    const row = db.prepare('SELECT * FROM pitch_video_sources WHERE id=?').get(String(id || ''));
    if (!row || path.basename(row.stored_file_name) !== row.stored_file_name) return null;
    return { ...row, path: path.join(directory, row.stored_file_name) };
  }
  async function retain(file, id, { move = false } = {}) {
    const originalName = path.win32.basename(path.posix.basename(String(file.originalname || 'video.mp4'))).replace(/[\x00-\x1f\x7f]/g, '') || 'video.mp4';
    const extension = path.extname(originalName).toLowerCase();
    const storedName = crypto.randomUUID() + (/^\.[a-z0-9]{1,12}$/.test(extension) ? extension : '.video');
    await fsp.mkdir(directory, { recursive: true });
    const target = path.join(directory, storedName);
    let moved = false;
    try {
      if (move) {
        try { await fsp.rename(file.path, target); moved = true; }
        catch (error) {
          if (error.code !== 'EXDEV') throw error;
          await fsp.copyFile(file.path, target, fs.constants.COPYFILE_EXCL);
        }
      } else await fsp.copyFile(file.path, target, fs.constants.COPYFILE_EXCL);
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(target)) hash.update(chunk);
      db.prepare('INSERT INTO pitch_video_sources(id,original_file_name,stored_file_name,sha256) VALUES(?,?,?,?)')
        .run(id, originalName, storedName, hash.digest('hex'));
      return get(id);
    } catch (error) {
      if (moved) await fsp.rename(target, file.path).catch(() => {});
      else await fsp.unlink(target).catch(() => {});
      throw error;
    }
  }
  return { get, retain };
}
module.exports = { createPitchSourceStore };
