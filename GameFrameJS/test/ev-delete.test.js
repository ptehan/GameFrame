const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');

test('EV selection enables bulk deletion', () => {
  const source = fs.readFileSync(path.join(__dirname,'../templates/library.html'),'utf8');
  const code = source.slice(source.indexOf('function refreshBulkSelectionUI()'),source.indexOf('function setMultiSelectMode('));
  const button = {style:{}};
  const context = {fType:{value:'ev'}, normalizeFilterValue:v=>v, getActiveSelectionSet:()=>new Set(['1']),
    multiSelectMode:true,bulkSelectionCount:{},enterMultiSelectBtn:{style:{}},selectVisibleBtn:{style:{}},clearVisibleBtn:{style:{}},deleteSelectedBtn:button,cancelMultiSelectBtn:{style:{}}};
  vm.runInNewContext(code+'\nrefreshBulkSelectionUI();', context);
  assert.equal(button.disabled,false);
  assert.equal(context.selectVisibleBtn.disabled,false);
});

test('single and bulk EV deletion detach links without deleting swings; modal stays embedded', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gf_ev_delete_'));
  process.env.DB_PATH=path.join(dir,'test.db');
  const {startServer,closeDatabase}=require('../server');
  const server=startServer(0,'127.0.0.1');
  await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
  const db=new Database(process.env.DB_PATH);
  try {
    db.exec(`CREATE TABLE ev_hit_tracks(id INTEGER PRIMARY KEY);
      CREATE TABLE ev_swing_links(source_key TEXT PRIMARY KEY,pending_swing_id INTEGER,swing_clip_id INTEGER,
        ev_hit_id INTEGER REFERENCES ev_hit_tracks(id));
      INSERT INTO teams(id,name) VALUES(1,'Test');
      INSERT INTO hitters(id,team_id,name) VALUES(1,1,'Test');
      INSERT INTO swing_clips(id,team_id,hitter_id,clip_blob) VALUES(1,1,1,X'01');
      INSERT INTO ev_hit_tracks VALUES(1),(2),(3);
      INSERT INTO ev_swing_links VALUES('first',10,1,1),('second',11,1,2);`);
    const url='http://127.0.0.1:'+server.address().port;
    const post=(route,body)=>fetch(url+route,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
    const single=await post('/library/ev/delete',{id:'1',return:'/library?type=ev&sid=x&embedded=1'});
    assert.equal(single.status,303);
    assert.match(single.headers.get('location'),/embedded=1/);
    assert.equal(db.prepare('SELECT ev_hit_id FROM ev_swing_links WHERE source_key=?').get('first').ev_hit_id,null);
    const bulk=await post('/library/bulk-delete',[['type','ev'],['ids','2'],['ids','3'],['return','/library?type=ev&embedded=1']]);
    assert.equal(bulk.status,303);
    assert.match(bulk.headers.get('location'),/embedded=1/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ev_hit_tracks').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM swing_clips WHERE id=1').get().n,1);
    assert.equal(db.prepare('SELECT swing_clip_id,ev_hit_id FROM ev_swing_links WHERE source_key=?').get('second').swing_clip_id,1);
    assert.equal(db.prepare('SELECT ev_hit_id FROM ev_swing_links WHERE source_key=?').get('second').ev_hit_id,null);
    for (const type of ['pitch', 'swing', 'matchup']) {
      const response = await post(`/library/${type}/delete`, {id:'999',return:`/library?type=${type}&embedded=1&search=kept`});
      assert.equal(response.status,303);
      assert.match(response.headers.get('location'),/embedded=1/);
      assert.match(response.headers.get('location'),/search=kept/);
    }
  } finally {
    await new Promise(resolve=>server.close(resolve));
    db.close();closeDatabase();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
