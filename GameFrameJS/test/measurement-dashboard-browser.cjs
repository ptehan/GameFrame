const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gf-measurements-test-'));
process.env.DB_PATH=path.join(dir,'test.db');
const {startServer,closeDatabase}=require('../server');
const db=new(require('better-sqlite3'))(process.env.DB_PATH);
db.exec("INSERT INTO teams(id,name) VALUES(1,'CODEX TEST Team'); INSERT INTO pitchers(id,name,team_id) VALUES(1,'CODEX TEST Pitcher',1); INSERT INTO hitters(id,name,team_id) VALUES(1,'CODEX TEST Hitter',1),(2,'CODEX TEST Empty',1);");
for(const [id,speed] of [[1,80],[2,82],[3,null]]) db.prepare('INSERT INTO pitch_clips(id,team_id,pitcher_id,description,initial_mph,average_mph,created_at) VALUES(?,1,1,?,?,?,?)').run(id,'CODEX TEST Pitch '+id,speed,speed===null?null:speed/1.05,'2026-10-21 12:00:00');
db.exec('CREATE TABLE ev_hit_tracks(id INTEGER PRIMARY KEY,hitter_id INTEGER,description TEXT,created_at TEXT,best_exit_velocity_mph REAL,best_launch_angle_deg REAL,best_distance_ft REAL)');
db.prepare('INSERT INTO ev_hit_tracks VALUES(1,1,?,?,?,?,?)').run('CODEX TEST Hit','2026-10-21 12:00:00',84,30,324);
db.close();
(async()=>{
 const server=startServer(0,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const origin=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:900}});
   for(const view of ['pitching','hitting']){
    const response=await page.goto(`${origin}/dashboard/measurements?view=${view}&player=1&days=all&embedded=1`,{waitUntil:'networkidle'});
    assert.equal(response.status(),200);
    assert.equal(await page.locator('.measurement-table tbody tr').count(),view==='pitching'?3:1);
    assert.match(await page.locator('.measurement-stats').innerText(),view==='pitching'?/81.0 mph/:/84.0 mph/);
    assert.match(await page.locator('.measurement-note').innerText(),/not every pitch or hit/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow');
    await page.screenshot({path:path.join(dir,`${view}-${width}.png`),fullPage:true});
   }
   await page.goto(`${origin}/dashboard/measurements?view=hitting&player=2&days=all&embedded=1`);
   assert.match(await page.locator('.measurement-dashboard').innerText(),/No uploaded hits/);
   await page.close();
  }
  console.log('PASS: isolated CODEX TEST fixtures; pitching/hitting summaries, missing measurements, empty player, desktop/mobile. '+dir);
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1;});
