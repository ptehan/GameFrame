const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');

test('real Python requests read and delete only the signed-in workspace and reject outside source paths', { timeout: 180000,
  skip: !fs.existsSync(path.resolve('.venv-ev', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')) }, async () => {
  process.env.NODE_ENV = 'test'; delete process.env.RESEND_API_KEY; delete process.env.AUTH_FROM_EMAIL; delete process.env.SITE_ORIGIN;
  process.env.AUTH_CODE_SECRET = 'python-isolation-test-only'; process.env.AUTH_ALLOW_DEV_CODE = 'true';
  process.env.GAMEFRAME_PREWARM_EV = '0'; process.env.OPENBLAS_NUM_THREADS = '1'; process.env.NUMBA_NUM_THREADS = '1';
  const server = require('node:http').createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { createHostedApplication } = require('../hosted/server');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-python-isolation-'));
  const hosted = createHostedApplication({ directory, origin }); server.on('request', hosted.app);
  async function request(url, who, body) {
    return fetch(origin + url, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin,
      ...(who ? { Cookie: who.cookie, 'X-CSRF-Token': who.csrf } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function login(email) {
    hosted.db.prepare('INSERT INTO hosted_invites VALUES(?)').run(email);
    const code = (await (await request('/api/v1/auth/request-code', null, { email })).json()).development_code;
    const response = await request('/api/v1/auth/verify-code', null, { email, code });
    assert.equal(response.status, 200);
    const who = { cookie: response.headers.get('set-cookie').split(';')[0] };
    who.csrf = (await (await request('/api/account', who)).json()).csrf;
    who.id = hosted.db.prepare('SELECT id FROM auth_accounts WHERE email=?').get(email).id;
    return who;
  }
  try {
    const a = await login('python-a@test.invalid'), b = await login('python-b@test.invalid');
    const first = await request('/api/gameframe/options', a);
    assert.equal(first.status, 200, await first.clone().text());
    const aPath = path.join(directory, 'workspaces', a.id, 'app.db');
    const aDb = new Database(aPath);
    aDb.prepare("INSERT INTO ev_hit_tracks(id,description,observation_package_json,prediction_json) VALUES(701,'Private EV','{}',?)")
      .run(JSON.stringify({ private_evidence: 'only-account-a' }));
    aDb.close();
    const own = await request('/api/gameframe/ev-json?id=701&kind=prediction', a);
    assert.equal(own.status, 200); assert.match(await own.text(), /only-account-a/);
    const other = await request('/api/gameframe/ev-json?id=701&kind=prediction', b);
    assert.equal(other.status, 404, await other.clone().text());
    await request('/api/gameframe/ev-hit/delete', b, { id: 701 });
    const check = new Database(aPath, { readonly: true });
    assert.equal(check.prepare('SELECT description FROM ev_hit_tracks WHERE id=701').get().description, 'Private EV'); check.close();
    const source = path.join(directory, 'workspaces', a.id, 'temporary', 'private.mp4'); fs.writeFileSync(source, 'not-public');
    const rejected = await request('/api/track', b, { video_metadata: { source_path: source, file_name: 'private.mp4' }, hit: { contact: { timestamp_s: 1 } } });
    assert.equal(rejected.status, 404, await rejected.clone().text());
  } finally { await new Promise(resolve => server.close(resolve)); hosted.close(); }
});
