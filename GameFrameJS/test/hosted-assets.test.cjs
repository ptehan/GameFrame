const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { provision } = require('../scripts/provision-assets.cjs');

test('private asset provisioning verifies content before installing and reuses valid files', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = Buffer.from('private simulation database');
  const file = path.join(root, 'flight.sqlite');
  const env = { GAMEFRAME_SYNTHETIC_DB: file, GAMEFRAME_SYNTHETIC_SHA256: crypto.createHash('sha256').update(data).digest('hex'), GAMEFRAME_SYNTHETIC_REMOTE: 'gameframe:GameFrameBaseball/assets/flight.sqlite' };
  let calls = 0;
  const runRclone = async args => {
    calls++;
    if (args[0] === 'lsjson') return { status: 0, stdout: JSON.stringify({ Size: data.length }) };
    assert.equal(args[0], 'copyto');
    assert.equal(fs.existsSync(file), false);
    fs.writeFileSync(args[2], data);
    return { status: 0 };
  };
  await provision({ env, runRclone });
  assert.deepEqual(fs.readFileSync(file), data);
  await provision({ env, runRclone });
  assert.equal(calls, 2);
});

test('private asset failures leave no database or partial downloads', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { GAMEFRAME_SYNTHETIC_DB: path.join(root, 'flight.sqlite'), GAMEFRAME_SYNTHETIC_SHA256: '0'.repeat(64), GAMEFRAME_SYNTHETIC_REMOTE: 'gameframe:GameFrameBaseball/assets/flight.sqlite' };
  await assert.rejects(provision({ env, runRclone: async () => ({ status: 0, stdout: JSON.stringify({ Size: 3 * 1024 ** 3 }) }) }), /invalid size/);
  for (const status of [0, 1]) {
    await assert.rejects(provision({ env, runRclone: async args => {
      if (args[0] === 'lsjson') return { status: 0, stdout: JSON.stringify({ Size: 3 }) };
      fs.writeFileSync(args[2], 'bad');
      return { status };
    } }), status ? /transfer failed/ : /checksum mismatch/);
    assert.deepEqual(fs.readdirSync(root), []);
  }
  await assert.rejects(provision({ env: { ...env, GAMEFRAME_SYNTHETIC_REMOTE: 'gameframe:bucket/../asset' } }), /Invalid private/);
});
