const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LIMITS = Object.freeze({ trialCredits: 3, paidCredits: 30, trialBytes: 250 * 1024 ** 2,
  paidBytes: 1024 ** 3, uploadBytes: 250 * 1024 ** 2, durationSeconds: 300 });
function initialize(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS hosted_invites (email TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS hosted_billing (
      account_id TEXT PRIMARY KEY, customer_id TEXT UNIQUE, subscription_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'none', subscription_created INTEGER NOT NULL DEFAULT 0, period_start INTEGER NOT NULL DEFAULT 0,
      paid_until INTEGER NOT NULL DEFAULT 0, updated_at TEXT, retention_notice_at TEXT
    );
    CREATE TABLE IF NOT EXISTS hosted_events (id TEXT PRIMARY KEY, processed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hosted_checkout(account_id TEXT PRIMARY KEY,request_key TEXT NOT NULL,session_id TEXT);
    CREATE TABLE IF NOT EXISTS hosted_jobs (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, request_key TEXT NOT NULL,
      kind TEXT NOT NULL, period TEXT NOT NULL, state TEXT NOT NULL, charged INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, completed_at TEXT, error TEXT,
      UNIQUE(account_id, request_key)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS hosted_one_active_job ON hosted_jobs(account_id)
      WHERE state IN ('queued','running');
    CREATE TABLE IF NOT EXISTS hosted_gates (name TEXT PRIMARY KEY, passed_at TEXT NOT NULL, evidence TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hosted_deletions(account_id TEXT PRIMARY KEY,delete_after INTEGER NOT NULL,notice_at TEXT NOT NULL,purged_at TEXT);
  `);
  if (!db.prepare('PRAGMA table_info(hosted_billing)').all().some(c => c.name === 'subscription_created')) db.exec('ALTER TABLE hosted_billing ADD COLUMN subscription_created INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(hosted_jobs)').all().some(c => c.name === 'charged')) db.exec('ALTER TABLE hosted_jobs ADD COLUMN charged INTEGER NOT NULL DEFAULT 1');
  if (!db.prepare('PRAGMA table_info(hosted_deletions)').all().some(c => c.name === 'purged_at')) db.exec('ALTER TABLE hosted_deletions ADD COLUMN purged_at TEXT');
}
function diskBytes(directory) {
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Workspace contains a symbolic link');
    return total + (entry.isDirectory() ? diskBytes(file) : fs.statSync(file).size);
  }, 0);
}
function entitlement(db, accountId, now = Date.now()) {
  const account = db.prepare('SELECT * FROM auth_accounts WHERE id=? AND disabled_at IS NULL').get(accountId);
  if (!account) throw Object.assign(new Error('Account unavailable'), { status: 401 });
  const billing = db.prepare('SELECT * FROM hosted_billing WHERE account_id=?').get(accountId);
  const paid = Boolean(billing && billing.paid_until * 1000 > now);
  const started = Date.parse((account.trial_started_at || account.created_at).replace(' ', 'T') + ((account.trial_started_at || account.created_at).includes('Z') ? '' : 'Z'));
  const trialEnd = started + 14 * 86400000;
  // A former subscriber cannot regain a trial by canceling.
  const trial = !billing?.paid_until && trialEnd > now;
  const period = paid ? `paid:${billing.period_start}` : 'trial';
  const limit = paid ? LIMITS.paidCredits : LIMITS.trialCredits;
  const used = db.prepare("SELECT COUNT(*) n FROM hosted_jobs WHERE account_id=? AND period=? AND charged=1 AND state IN ('queued','running','succeeded')").get(accountId, period).n;
  const expires = paid ? billing.paid_until * 1000 : billing?.paid_until ? billing.paid_until * 1000 : trialEnd;
  return { plan: paid ? 'founding' : trial ? 'trial' : 'expired', period, limit, used,
    remaining: Math.max(0, limit - used), storage_limit: paid ? LIMITS.paidBytes : LIMITS.trialBytes,
    processing_allowed: paid || trial, read_allowed: paid || trial || now < expires + 30 * 86400000,
    expires_at: new Date(expires).toISOString(), billing_status: billing?.status || 'none' };
}
function reserve(db, accountId, kind, key = crypto.randomUUID(), charged = true) {
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM hosted_jobs WHERE account_id=? AND request_key=?').get(accountId, key);
    if (existing) throw Object.assign(new Error('This request has already been submitted'), { status: 409, job: existing });
    const access = entitlement(db, accountId);
    if (!access.processing_allowed || (charged && !access.remaining)) throw Object.assign(new Error('Processing allowance exhausted or expired'), { status: 402 });
    if (db.prepare("SELECT id FROM hosted_jobs WHERE account_id=? AND state IN ('queued','running')").get(accountId)) {
      throw Object.assign(new Error('You already have a processing job queued or running'), { status: 409 });
    }
    if (db.prepare("SELECT COUNT(*) n FROM hosted_jobs WHERE account_id=? AND state='failed' AND created_at>?").get(accountId, new Date(Date.now() - 3600000).toISOString()).n >= 10) {
      throw Object.assign(new Error('Too many failed processing attempts. Please try again in an hour.'), { status: 429 });
    }
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO hosted_jobs(id,account_id,request_key,kind,period,state,created_at,charged) VALUES(?,?,?,?,?,'queued',?,?)")
      .run(id, accountId, key, kind, access.period, new Date().toISOString(), Number(charged));
    return id;
  }).immediate();
}
function finish(db, id, success, error = null) {
  db.prepare("UPDATE hosted_jobs SET state=?,completed_at=?,error=? WHERE id=? AND state IN ('queued','running')")
    .run(success ? 'succeeded' : 'failed', new Date().toISOString(), error, id);
}
function recover(db) {
  db.prepare("UPDATE hosted_jobs SET state='failed',error='Server restarted; allowance returned. Submit again.',completed_at=? WHERE state IN ('queued','running')")
    .run(new Date().toISOString());
}
const REQUIRED_GATES = ['data', 'privacy', 'authentication', 'billing', 'limits', 'deployment', 'usability', 'operations', 'cost', 'footage'];
function missingGates(db) {
  const passed = new Set(db.prepare('SELECT name FROM hosted_gates').all().map(r => r.name));
  return REQUIRED_GATES.filter(name => !passed.has(name));
}
module.exports = { LIMITS, initialize, entitlement, reserve, finish, recover, diskBytes, missingGates, REQUIRED_GATES };
