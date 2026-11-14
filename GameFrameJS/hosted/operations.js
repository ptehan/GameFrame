const fs = require('node:fs');
const path = require('node:path');
const { nightly, within } = require('./backups');
const { entitlement, diskBytes } = require('./store');

async function email(to, subject, text) {
  if (!process.env.RESEND_API_KEY || !process.env.AUTH_FROM_EMAIL || !to) throw new Error('Operational email is not configured');
  const response = await fetch('https://api.resend.com/emails', { method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.AUTH_FROM_EMAIL, to: [to], subject, text }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Operational email delivery failed');
}
function installOperations({ db, directory, exclusive, evict, reconcile }) {
  db.exec(`CREATE TABLE IF NOT EXISTS hosted_operations(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hosted_deletions(account_id TEXT PRIMARY KEY,delete_after INTEGER NOT NULL,notice_at TEXT NOT NULL);`);
  const set = (key, value) => db.prepare('INSERT OR REPLACE INTO hosted_operations VALUES(?,?)').run(key, String(value));
  const get = key => db.prepare('SELECT value FROM hosted_operations WHERE key=?').get(key)?.value;
  let busy = false, closed = false, activeTick = Promise.resolve();
  async function alert(message) {
    console.error('GAMEFRAME ALERT:', message);
    if (Date.now() - Number(get('last_alert') || 0) < 3600000) return;
    try { await email(process.env.OPERATIONS_EMAIL, 'GameFrame needs attention', message); set('last_alert', Date.now()); }
    catch (error) { console.error(error.message); }
  }
  async function runTick() {
    if (busy) return; busy = true;
    try {
      const lastBackup = Number(get('last_backup') || 0), now = Date.now();
      const easternDay = time => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);
      const easternHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(now);
      if (!lastBackup || now - lastBackup >= 26 * 3600000 || easternHour === '03' && easternDay(lastBackup) !== easternDay(now)) {
        await exclusive(async () => {
          const result = await nightly(directory, process.env.BACKUP_DIRECTORY || path.join(path.dirname(directory), 'gameframe-backups'), process.env.BACKUP_REMOTE);
          set('last_backup', Date.now()); set('last_backup_path', result);
        });
      }
      const stats = fs.statfsSync(directory);
      if (Number(stats.bavail) * Number(stats.bsize) < 5 * 1024 ** 3) await alert('Less than 5 GB of disk space remains. New processing must be reviewed.');
      if (reconcile) await reconcile();
      for (const account of db.prepare('SELECT id,email FROM auth_accounts WHERE disabled_at IS NULL').all()) {
        const access = entitlement(db, account.id);
        if (!access.processing_allowed) {
          const existing = db.prepare('SELECT * FROM hosted_deletions WHERE account_id=?').get(account.id);
          if (!existing) {
            await email(account.email, 'Download your GameFrame footage', 'Your processing access has ended. You can download your saved clips for 30 days after access expires. We will retain your data for at least 30 days after this notice before deleting it. Renew your subscription to keep using GameFrame.');
            db.prepare('INSERT INTO hosted_deletions(account_id,delete_after,notice_at) VALUES(?,?,?)').run(account.id, Date.now() + 30 * 86400000, new Date().toISOString());
          }
        } else db.prepare('DELETE FROM hosted_deletions WHERE account_id=?').run(account.id);
      }
      for (const deletion of db.prepare('SELECT * FROM hosted_deletions WHERE delete_after<? AND purged_at IS NULL').all(Date.now())) {
        const account = db.prepare('SELECT * FROM auth_accounts WHERE id=?').get(deletion.account_id);
        if (!account) continue;
        if (!account.disabled_at && entitlement(db, account.id).processing_allowed) continue;
        await exclusive(async () => {
          const root = path.join(directory, 'workspaces'), target = path.resolve(root, account.id);
          if (!within(root, target) || !/^[a-f0-9-]{36}$/.test(account.id)) throw new Error('Invalid workspace deletion target');
          evict(account.id);
          if (fs.existsSync(target)) fs.rmSync(target, { recursive: true });
          db.prepare("UPDATE auth_sessions SET revoked_at=datetime('now') WHERE account_id=?").run(account.id);
          db.prepare('UPDATE hosted_deletions SET purged_at=? WHERE account_id=?').run(new Date().toISOString(), account.id);
        });
      }
      set('last_operations_check', Date.now());
    } catch (error) { set('last_error', error.message); await alert(error.message); }
    finally { busy = false; }
  }
  function tick() {
    if (closed || busy) return activeTick;
    activeTick = runTick();
    return activeTick;
  }
  const timer = setInterval(tick, 3600000); timer.unref();
  const initial = setTimeout(tick, 60000); initial.unref();
  return { tick, alert, close: async () => { closed = true; clearInterval(timer); clearTimeout(initial); await activeTick; },
    status: () => ({ last_backup: get('last_backup'), last_error: get('last_error'), workspace_bytes: diskBytes(path.join(directory, 'workspaces')) }) };
}
module.exports = { installOperations, email };
