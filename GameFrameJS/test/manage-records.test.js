const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Database=require('better-sqlite3');

test('maintain teams and players with validation, safe deletion, and embedded navigation',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gf_records_'));
  process.env.DB_PATH=path.join(dir,'app.db');
  const {startServer,closeDatabase}=require('../server');
  const server=startServer(0,'127.0.0.1');
  await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
  const db=new Database(process.env.DB_PATH);
  const url='http://127.0.0.1:'+server.address().port;
  const post=(route,data)=>fetch(url+route,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({embedded:'1',sid:'x',...data})});
  try{
    for(const name of ['Alpha','Beta']) assert.equal((await post('/teams/add',{name})).status,303);
    const teams=db.prepare('SELECT id FROM teams WHERE name IN (?,?) ORDER BY name').all('Alpha','Beta');
    const a=teams[0].id,b=teams[1].id;
    for(const kind of ['hitters','pitchers']){
      let response=await post(`/${kind}/add`,{name:'Player',team_id:a});
      assert.match(response.headers.get('location'),/embedded=1/);
      const id=db.prepare(`SELECT id FROM ${kind} WHERE name='Player'`).get().id;
      await post(`/${kind}/edit`,{item_id:id,name:'Renamed',description:'Updated',team_id:b});
      assert.deepEqual(db.prepare(`SELECT name,description,team_id FROM ${kind} WHERE id=?`).get(id),{name:'Renamed',description:'Updated',team_id:b});
      response=await post('/teams/delete',{item_id:b});
      assert.match(response.headers.get('location'),/error=in_use/);
      const html=await(await fetch(url+`/${kind}?embedded=1`)).text();
      assert.ok(html.includes('aria-label="Record type"'));
      assert.ok(!html.includes('<aside id="sidebar">'));
      await post(`/${kind}/delete`,{item_id:id});
      assert.equal(db.prepare(`SELECT id FROM ${kind} WHERE id=?`).get(id),undefined);
    }
    assert.match((await post('/teams/add',{name:'  '})).headers.get('location'),/error=name/);
    assert.match((await post('/hitters/add',{name:'Invalid',team_id:99999})).headers.get('location'),/error=team/);
    await post('/teams/edit',{item_id:a,name:'Renamed team',description:'Notes'});
    assert.equal(db.prepare('SELECT name FROM teams WHERE id=?').get(a).name,'Renamed team');
    await post('/teams/delete',{item_id:a});
    assert.equal(db.prepare('SELECT id FROM teams WHERE id=?').get(a),undefined);
  }finally{
    await new Promise(resolve=>server.close(resolve));db.close();closeDatabase();fs.rmSync(dir,{recursive:true,force:true});
  }
});
