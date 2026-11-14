const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const store = require('../hosted/store');
const { ensureUsageSchema } = require('../usage-auth');

function memory() { const db = new Database(':memory:'); ensureUsageSchema(db); store.initialize(db); return db; }
function account(db, id = crypto.randomUUID()) {
  db.prepare("INSERT INTO auth_accounts(id,email,normalized_email,trial_started_at) VALUES(?,?,?,datetime('now'))").run(id, `${id}@test.invalid`, `${id}@test.invalid`); return id;
}
test('credit reservations, one active job, refund, deduplication and restart recovery', () => {
  const db = memory(), id = account(db);
  try {
    const first = store.reserve(db, id, 'ev', 'same-request');
    assert.equal(store.entitlement(db, id).remaining, 2);
    assert.throws(() => store.reserve(db, id, 'ev', 'other'), /already have/);
    store.finish(db, first, false, 'test failure');
    assert.equal(store.entitlement(db, id).remaining, 3);
    assert.throws(() => store.reserve(db, id, 'ev', 'same-request'), /already been/);
    for (let n = 0; n < 3; n++) store.finish(db, store.reserve(db, id, 'matchup'), true);
    assert.throws(() => store.reserve(db, id, 'ev'), /exhausted/);
    store.finish(db, store.reserve(db, id, 'presentation', undefined, false), true);
    assert.equal(store.entitlement(db, id).remaining, 0, 'presentation rendering does not consume credits');
    const second = account(db); store.reserve(db, second, 'ev'); store.recover(db);
    assert.equal(store.entitlement(db, second).remaining, 3);
    for (let n = 0; n < 9; n++) store.finish(db, store.reserve(db, second, 'ev'), false);
    assert.throws(() => store.reserve(db, second, 'ev'), /Too many failed/);
  } finally { db.close(); }
});
test('generated database blobs cannot bypass workspace storage admission', () => {
  const { databaseWithQuota } = require('../hosted/quota');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-quota-test-'));
  const raw = new Database(path.join(folder, 'app.db')); raw.exec('CREATE TABLE clips(id INTEGER PRIMARY KEY,video BLOB)');
  raw.prepare('INSERT INTO clips VALUES(1,?)').run(Buffer.from('retained'));
  const db = databaseWithQuota(raw, folder, () => store.diskBytes(folder) + 65536 + 4);
  try {
    assert.throws(() => db.prepare('INSERT INTO clips VALUES(2,?)').run(Buffer.alloc(1024)), /storage allowance/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM clips').get().n, 1);
    assert.equal(db.prepare('SELECT video FROM clips WHERE id=1').get().video.toString(), 'retained');
    db.prepare('DELETE FROM clips WHERE id=1').run();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM clips').get().n, 0);
  } finally { db.close(); }
});
test('paid period allowances, past_due access horizon, retention and registration gates', () => {
  const db = memory(), id = account(db), now = Math.floor(Date.now() / 1000);
  try {
    db.prepare("INSERT INTO hosted_billing(account_id,subscription_id,status,period_start,paid_until) VALUES(?,'sub_1','past_due',?,?)").run(id, now - 100, now + 10);
    assert.equal(store.entitlement(db, id).remaining, 30);
    store.finish(db, store.reserve(db, id, 'ev'), true);
    assert.equal(store.entitlement(db, id).remaining, 29);
    assert.equal(store.entitlement(db, id, (now + 11) * 1000).processing_allowed, false);
    assert.equal(store.entitlement(db, id, (now + 11) * 1000).read_allowed, true);
    assert.equal(store.entitlement(db, id, (now + 31 * 86400) * 1000).read_allowed, false);
    db.prepare('UPDATE hosted_billing SET period_start=period_start+100,paid_until=paid_until+10000').run();
    assert.equal(store.entitlement(db, id).remaining, 30);
    assert.equal(store.missingGates(db).length, 10);
  } finally { db.close(); }
});
test('hosted HTTP authentication, CSRF, isolation, reports, failed-job refunds and logout', async () => {
  process.env.NODE_ENV = 'test'; delete process.env.RESEND_API_KEY; delete process.env.AUTH_FROM_EMAIL; delete process.env.SITE_ORIGIN;
  process.env.AUTH_ALLOW_DEV_CODE = 'true'; process.env.AUTH_CODE_SECRET = 'hosted-test-secret';
  process.env.GAMEFRAME_PREWARM_EV = '0';
  process.env.GAMEFRAME_SALES_OPEN = 'true'; process.env.GAMEFRAME_LEGAL_PUBLISHED = 'true';
  process.env.ADMIN_API_KEY = 'hosted-test-admin';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-hosted-test-'));
  const { createHostedApplication } = require('../hosted/server');
  // Origin is fixed before listen; bind first with an outer HTTP server.
  const http = require('node:http');
  const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const hosted = createHostedApplication({ directory, origin }); server.on('request', hosted.app);
  async function request(url, body, cookie, csrf, extra = {}) {
    return fetch(origin + url, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  async function login(email) {
    hosted.db.prepare('INSERT INTO hosted_invites VALUES(?)').run(email);
    const code = await (await request('/api/v1/auth/request-code', { email })).json();
    const response = await request('/api/v1/auth/verify-code', { email, code: code.development_code });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).access_token, undefined);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await request('/api/v1/auth/verify-code', { email, code: code.development_code })).status, 401, 'sign-in codes cannot be reused');
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const data = await (await request('/api/account', undefined, cookie)).json();
    return { cookie, csrf: data.csrf };
  }
  try {
    assert.equal(hosted.salesOpen(), false, 'flags cannot bypass missing release gates');
    assert.equal((await request('/library/data?type=ev')).status, 401);
    const publicPrivacy = await request('/privacy'); assert.equal(publicPrivacy.status, 200);
    assert.match(await publicPrivacy.text(), /hosted GameFrame beta/);
    const a = await login('a@test.invalid'), b = await login('b@test.invalid');
    const outsider = 'not-invited@test.invalid';
    const code = (await (await request('/api/v1/auth/request-code', { email: outsider })).json()).development_code;
    assert.equal((await request('/api/v1/auth/verify-code', { email: outsider, code })).status, 403);
    const expired = 'expired@test.invalid';
    const oldCode = (await (await request('/api/v1/auth/request-code', { email: expired })).json()).development_code;
    hosted.db.prepare("UPDATE auth_codes SET expires_at=datetime('now','-1 minute') WHERE normalized_email=?").run(expired);
    assert.equal((await request('/api/v1/auth/verify-code', { email: expired, code: oldCode })).status, 401);
    assert.equal((await request('/teams/add', { name: 'Private Team' }, a.cookie)).status, 403);
    assert.equal((await request('/teams/add', { name: 'Private Team' }, a.cookie, a.csrf)).status, 303);
    assert.match(await (await request('/teams', undefined, a.cookie)).text(), /Private Team/);
    assert.doesNotMatch(await (await request('/teams', undefined, b.cookie)).text(), /Private Team/);
    const aId = hosted.db.prepare("SELECT id FROM auth_accounts WHERE email='a@test.invalid'").get().id;
    const tenant = new Database(path.join(directory, 'workspaces', aId, 'app.db'));
    tenant.prepare("INSERT INTO pitch_clips(id,description,clip_blob) VALUES(91,'Private pitch',?)").run(Buffer.from('private-video'));
    tenant.close();
    assert.equal((await request('/stream/pitch?id=91', undefined, a.cookie)).status, 200);
    assert.equal((await request('/stream/pitch?id=91', undefined, b.cookie)).status, 404);
    const preview = await request('/api/pitch-release/preview', { pitch_id: 91 }, a.cookie, a.csrf);
    assert.equal(preview.status, 400); assert.match((await preview.json()).error, /contact marker/);
    for (const url of ['/settings/data/backup', '/debug/routes', '/api/v1/admin/usage', '/ev/clip_server.py', '/ev/data/hittrax_from_video.sqlite']) {
      assert.equal((await request(url, undefined, a.cookie)).status, 404, url);
    }
    const page = await (await request('/ev/predictor.html', undefined, a.cookie)).text();
    assert.match(page, /gameframe-csrf/); assert.match(page, /hosted-client.js/);
    const failed = await request('/matchup/create', { pitch_id: 999, swing_id: 999 }, a.cookie, a.csrf);
    assert.equal(failed.status, 400, await failed.clone().text());
    assert.equal((await (await request('/api/account', undefined, a.cookie)).json()).remaining, 3);
    const job = (await (await request('/api/jobs', undefined, a.cookie)).json())[0]; assert.equal(job.state, 'failed');
    assert.equal((await request('/api/billing/checkout', {}, a.cookie, a.csrf)).status, 503);
    assert.equal((await request('/api/admin/status', undefined, a.cookie)).status, 403);
    assert.equal((await request('/api/admin/status', undefined, undefined, undefined, { 'x-admin-key': 'hosted-test-admin' })).status, 200);
    for (let n = 0; n < 8; n++) account(hosted.db);
    const full = 'beta-full@test.invalid'; hosted.db.prepare('INSERT INTO hosted_invites VALUES(?)').run(full);
    const fullCode = (await (await request('/api/v1/auth/request-code', { email: full })).json()).development_code;
    assert.equal((await request('/api/v1/auth/verify-code', { email: full, code: fullCode })).status, 403);
    assert.equal((await request('/auth/logout', {}, a.cookie, a.csrf)).status, 200);
    assert.equal((await request('/api/account', undefined, a.cookie)).status, 401);
    assert.equal((await request('/api/account', undefined, b.cookie)).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); hosted.close(); }
});
test('backup snapshots verify and detect media corruption', async () => {
  const { snapshot, verify } = require('../hosted/backups');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-backup-test-'));
  const source = path.join(root, 'source'), dest = path.join(root, 'snapshot'); fs.mkdirSync(source);
  const db = new Database(path.join(source, 'app.db')); db.exec('CREATE TABLE sample(id); INSERT INTO sample VALUES(1)');
  fs.writeFileSync(path.join(source, 'clip.mp4'), 'sample-video');
  try {
    await snapshot(source, dest); assert.equal((await verify(dest)).files.length, 2);
    fs.writeFileSync(path.join(dest, 'clip.mp4'), 'changed');
    await assert.rejects(verify(dest), /verification failed/);
  } finally { db.close(); }
});
