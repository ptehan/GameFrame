const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'gf-timing-fixtures-'));
process.env.DB_PATH=path.join(directory,'test.db');
const {startServer,closeDatabase}=require('../server');
const db=new(require('better-sqlite3'))(process.env.DB_PATH);
db.prepare('INSERT INTO teams(id,name) VALUES(1,?)').run('CODEX TEST Timing');
const cases=[{name:'Short',times:[.4,.4,.4]},{name:'Long',times:[1.1,1.1,1.1]},
 {name:'Variable',times:[.4,.8,1.2]},{name:'Single',times:[.7]},
 {name:'Missing',times:[null,null]},{name:'Empty',times:[]}];
let clipId=0;
for(const [index,item] of cases.entries()){
 item.id=index+1;item.reference=clipId+1;
 db.prepare('INSERT INTO hitters(id,name,team_id) VALUES(?,?,1)').run(item.id,'CODEX TEST '+item.name);
 for(const time of item.times){
  const frames=time===null?null:Math.round(time*30)+1;
  db.prepare('INSERT INTO swing_clips(id,team_id,hitter_id,description,fps,frame_count,swing_seconds,decision_frame,created_at) VALUES(?,1,?,?,?,?,?,?,?)')
   .run(++clipId,item.id,'CODEX TEST '+item.name,frames===null?null:30,frames,time,frames===null?null:frames-7,'2026-10-21 12:00:00');
 }
}
db.close();
(async()=>{
 const server=startServer(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const errors=[];
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',e=>errors.push(e.message));
   const summaries=[];
   for(const item of cases){
    const response=await page.goto(`${origin}/dashboard/player?hid=${item.id}&window=all&ref=${item.reference}&embedded=1`,{waitUntil:'networkidle'});
    assert.equal(response.status(),200);
    const summary=JSON.parse(await page.locator('#dashboard_summary_json').textContent());summaries.push(summary);
    const narrative=JSON.parse(await page.locator('#dashboard_summary_narrative_json').textContent());
    if(['Missing','Empty'].includes(item.name)){assert.equal(summary,null);assert.equal(narrative,'');}
    else{
     assert.equal(summary.count,item.times.length);
     assert.ok(Math.abs(summary.median-item.times[Math.floor(item.times.length/2)])<1e-8);
     assert.doesNotMatch(narrative,/on target|desirable|very consistent|poor consistency/i);
     assert.doesNotMatch(await page.locator('.kpi').allInnerTexts().then(x=>x.join(' ')),/On target|s earlier|s later/);
     if(item.name==='Single'){assert.match(narrative,/One uploaded swing/);assert.ok(await page.getByText('Need 2 swings',{exact:true}).count()>=1);}
     if(item.name==='Variable')assert.match(await page.locator('.kpi').allInnerTexts().then(x=>x.join(' ')),/0.400s longer/);
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflow: '+item.name);
    await page.screenshot({path:path.join(directory,`${item.name}-${width}.png`),fullPage:true});
   }
   assert.ok(Math.abs(summaries[0].stddev-summaries[1].stddev)<1e-12);
   assert.ok(summaries[2].stddev>summaries[0].stddev);
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: isolated short/long consistent, variable, single, missing and empty timing fixtures on desktop/mobile. '+directory);
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1;});
