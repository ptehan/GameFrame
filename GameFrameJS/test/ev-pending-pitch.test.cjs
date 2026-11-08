const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

test('pending pitch editors preserve contact and EV drafts open velocity with existing or new pitcher', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gf_ev_pitch_'));
  process.env.DB_PATH = path.join(directory, 'app.db');
  const { startServer, closeDatabase } = require('../server');
  const server = startServer(0, '127.0.0.1');
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  const db = new Database(process.env.DB_PATH);
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const team = db.prepare("INSERT INTO teams(name) VALUES('Pitch team')").run().lastInsertRowid;
    const pitcher = db.prepare("INSERT INTO pitchers(name,team_id) VALUES('Pitcher',?)").run(team).lastInsertRowid;
    const id = db.prepare(`INSERT INTO pending_pitch_clips(batch_id,description,clip_blob,fps,contact_frame)
      VALUES('batch-test','Pitch source',?,60,120)`).run(Buffer.from('test clip')).lastInsertRowid;
    const items = await (await fetch(origin + '/library/data?type=pitch')).json();
    assert.ok(items.some(item => item.id === Number(id) && item.is_pending === 1));
    const selection = await fetch(origin + `/multi-pitch/pending/tag?id=${id}&embedded=1`);
    assert.equal(selection.status, 200);
    const html = await selection.text();
    assert.ok(html.includes('Choose pitcher'));
    assert.ok(!html.includes('<aside id="sidebar">'));
    const edit = await fetch(origin + `/multi-pitch/pending/tag?id=${id}&pitcher_id=${pitcher}&embedded=1`, {redirect:'manual'});
    assert.equal(edit.status, 303);
    const target = new URL(edit.headers.get('location'), origin);
    assert.equal(target.pathname, '/upload/pitch/trim');
    assert.equal(target.searchParams.get('preset_contact_frame'), '120');
    assert.equal(target.searchParams.get('team_id'), String(team));
    assert.equal(target.searchParams.get('embedded'), '1');
    const editor = await fetch(target);
    assert.equal(editor.status, 200);
    assert.ok(!(await editor.text()).includes('<aside id="sidebar">'));
    for (const mode of ['existing','new']) {
      const pending = db.prepare(`INSERT INTO pending_pitch_clips(batch_id,description,clip_blob,fps,contact_frame)
        VALUES('ev-source','EV source',?,60,120)`).run(Buffer.from('EV source clip')).lastInsertRowid;
      const picker = await (await fetch(origin + `/multi-pitch/pending/tag?id=${pending}&embedded=1`)).text();
      assert.ok(picker.includes('New pitcher'));
      const response = await fetch(origin + '/multi-pitch/pending/speed', {method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({id:String(pending),player_mode:mode,pitcher_id:String(pitcher),team_id:String(team),new_pitcher_name:'New EV pitcher',embedded:'1'})});
      assert.equal(response.status,303);
      const speed = new URL(response.headers.get('location'),origin);
      assert.equal(speed.pathname,'/pitch/speed');
      const saved = db.prepare('SELECT * FROM pitch_clips WHERE id=?').get(Number(speed.searchParams.get('id')));
      assert.equal(saved.contact_frame,120);
      assert.equal(saved.fps,60);
      assert.equal(saved.clip_blob.toString(),'EV source clip');
      assert.equal(db.prepare('SELECT id FROM pending_pitch_clips WHERE id=?').get(pending),undefined);
      assert.equal((await fetch(speed)).status,200);
      if(mode==='new') assert.equal(db.prepare('SELECT name FROM pitchers WHERE id=?').get(saved.pitcher_id).name,'New EV pitcher');
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    closeDatabase();
    fs.rmSync(directory, {recursive:true,force:true});
  }
});
